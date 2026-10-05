import { and, eq, gte, inArray, like, lte, sql } from 'drizzle-orm'
import { getDb, withNamedLock, type Database } from '../db/client'
import { invalidateCache } from '../db/cache'
import { rowsOf } from '../db/rows'
import {
  documentHistory,
  posItemMaster,
  posPurchase,
  posPurchaseItem,
  posReceive,
  posReceiveItem,
  posVendorItem,
  vendor,
} from '../db/schema'
import { addDays, toMysqlDate, toMysqlDateTime } from '../db/sql-utils'
import { serverEnv } from '../env'
import { checkCredentialRevocations } from './auth-service'
import { buildNumber, buildPrefix } from '~/shared/doc-number'
import { IdGenerator, maxIdForApp, minIdForApp } from '~/shared/ids'
import {
  buildOverReceiveMemo,
  buildSessionNote,
  extractSessionId,
  isOverReceiveMemo,
  parseOverReceiveMemo,
} from '~/shared/memo'
import { resolveConvQty, type VendorItemRow } from '~/shared/uom'
import { computeHeaderFinance, computeLineFinance } from '~/shared/receive-finance'
import { dec2 } from '~/shared/num'
import { evaluateSession, type LineEvaluation } from '~/shared/over-receive'
import { sanitizeReceiveDate } from '~/shared/receive-date'
import {
  PULLABLE_PURCHASE_STATUS,
  RECEIVE_STATUS_DRAFT,
  NOTE_SESSION_PREFIX,
} from '~/shared/constants'
import type {
  PushInput,
  PushResult,
  ReceiveSessionInput,
  SyncSessionResult,
} from '~/shared/schemas'

type Row = Record<string, unknown>

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export interface SyncContext {
  db: Database
  now: () => Date
  prefix: string
  pdtAppIdx: number
  receiveIdGen: IdGenerator
  itemIdGen: IdGenerator
  docHistoryIdGen: IdGenerator
}

export interface SyncOptions {
  db?: Database
  now?: () => Date
  prefix?: string
  pdtAppIdx?: number
  receiveIdGen?: IdGenerator
  itemIdGen?: IdGenerator
  docHistoryIdGen?: IdGenerator
}

// Per-process generator registry so IDs remain monotonic & unique across calls
// (two concurrent requests must not generate the same ID).
const generatorRegistry = new Map<
  number,
  { receive: IdGenerator; item: IdGenerator; docHistory: IdGenerator }
>()

function generatorsFor(appIdx: number): {
  receive: IdGenerator
  item: IdGenerator
  docHistory: IdGenerator
} {
  let entry = generatorRegistry.get(appIdx)
  if (!entry) {
    entry = {
      receive: new IdGenerator(appIdx),
      item: new IdGenerator(appIdx),
      docHistory: new IdGenerator(appIdx),
    }
    generatorRegistry.set(appIdx, entry)
  }
  return entry
}

function buildContext(options: SyncOptions): SyncContext {
  const pdtAppIdx = options.pdtAppIdx ?? serverEnv.pdtAppIdx
  const fallback = generatorsFor(pdtAppIdx)
  return {
    db: options.db ?? getDb(),
    now: options.now ?? (() => new Date()),
    prefix: options.prefix ?? serverEnv.receivePrefix,
    pdtAppIdx,
    receiveIdGen: options.receiveIdGen ?? fallback.receive,
    itemIdGen: options.itemIdGen ?? fallback.item,
    docHistoryIdGen: options.docHistoryIdGen ?? fallback.docHistory,
  }
}

interface ExistingReceive {
  receiveId: bigint
  number: string | null
  note: string | null
}

async function findExistingReceive(
  db: Database,
  sessionId: string,
  pdtAppIdx: number,
): Promise<ExistingReceive | null> {
  // Constrain lookup to PDT ID namespace (using PK index) for efficiency,
  // then match sessionId EXACTLY in JS (avoids LIKE wildcard issues).
  const pattern = `%${NOTE_SESSION_PREFIX}${escapeLike(sessionId)};%`
  const rows = await db
    .select({
      receiveId: posReceive.receiveId,
      number: posReceive.number,
      note: posReceive.note,
    })
    .from(posReceive)
    .where(
      and(
        gte(posReceive.receiveId, minIdForApp(pdtAppIdx)),
        lte(posReceive.receiveId, maxIdForApp(pdtAppIdx)),
        like(posReceive.note, pattern),
      ),
    )
    .limit(200)

  for (const row of rows) {
    if (extractSessionId(row.note) === sessionId) {
      return { receiveId: row.receiveId, number: row.number, note: row.note }
    }
  }
  return null
}

async function readReceiveItems(db: Database, receiveId: bigint) {
  return db
    .select({
      receiveItemId: posReceiveItem.receiveItemId,
      purchaseItemId: posReceiveItem.purchaseItemId,
      itemMasterId: posReceiveItem.itemMasterId,
      qty: posReceiveItem.qty,
      memo: posReceiveItem.memo,
    })
    .from(posReceiveItem)
    .where(eq(posReceiveItem.receiveId, receiveId))
    .orderBy(posReceiveItem.receiveItemId)
}

function failed(
  session: ReceiveSessionInput,
  code: NonNullable<SyncSessionResult['code']>,
  message: string,
): SyncSessionResult {
  return {
    sessionId: session.sessionId,
    status: 'FAILED',
    receiveId: null,
    number: null,
    overReceive: false,
    excessTotal: 0,
    lines: [],
    code,
    message,
  }
}

function lineResult(
  clientLineId: string,
  evaluation: LineEvaluation,
  memo: string | null,
) {
  return {
    clientLineId,
    purchaseItemId: evaluation.purchaseItemId,
    orderedQty: evaluation.orderedQty,
    previousQty: evaluation.previousQty,
    sessionQty: evaluation.sessionQty,
    newTotal: evaluation.newTotal,
    overReceive: evaluation.overReceive,
    excess: evaluation.excess,
    memo,
  }
}

function buildSuccessResult(
  session: ReceiveSessionInput,
  receiveId: bigint,
  number: string,
  lines: SyncSessionResult['lines'],
  code: NonNullable<SyncSessionResult['code']>,
  message: string,
): SyncSessionResult {
  return {
    sessionId: session.sessionId,
    status: 'SYNCED',
    receiveId: receiveId.toString(),
    number,
    overReceive: lines.some((line) => line.overReceive),
    excessTotal: lines.reduce((acc, line) => acc + line.excess, 0),
    lines,
    code,
    message,
  }
}

async function buildReplayResult(
  db: Database,
  session: ReceiveSessionInput,
  existing: ExistingReceive,
): Promise<SyncSessionResult> {
  const items = await readReceiveItems(db, existing.receiveId)
  const lines = items.map((item, index) => {
    const memo = item.memo
    const parsedMemo = parseOverReceiveMemo(memo)
    const qty = Number(item.qty ?? 0)
    return {
      clientLineId: session.items[index]?.clientLineId ?? String(item.purchaseItemId),
      purchaseItemId: String(item.purchaseItemId),
      orderedQty: parsedMemo?.orderedQty ?? 0,
      previousQty: parsedMemo ? Math.max(0, parsedMemo.newTotal - qty - (parsedMemo.excess ?? 0)) : 0,
      sessionQty: qty,
      newTotal: parsedMemo?.newTotal ?? qty,
      overReceive: isOverReceiveMemo(memo),
      excess: parsedMemo?.excess ?? 0,
      memo,
    }
  })
  return buildSuccessResult(
    session,
    existing.receiveId,
    existing.number ?? '',
    lines,
    'IDEMPOTENT_REPLAY',
    'Sesi sudah pernah diproses; tidak ada dokumen ganda.',
  )
}

async function resolveServerConv(
  db: Database,
  vendorId: bigint,
  itemIds: bigint[],
): Promise<VendorItemRow[]> {
  if (itemIds.length === 0) return []
  const rows = await db
    .select({
      vendorId: posVendorItem.vendorId,
      itemMasterId: posVendorItem.itemMasterId,
      uomPurchase: posVendorItem.uomPurchase,
      convQty: posVendorItem.convQty,
    })
    .from(posVendorItem)
    .where(and(eq(posVendorItem.vendorId, vendorId), inArray(posVendorItem.itemMasterId, itemIds)))

  return rows.map((row) => ({
    vendorId: String(row.vendorId),
    itemMasterId: String(row.itemMasterId),
    uomPurchase: String(row.uomPurchase),
    convQty: String(row.convQty ?? '0'),
  }))
}

async function processSession(
  ctx: SyncContext,
  session: ReceiveSessionInput,
): Promise<SyncSessionResult> {
  const sessionLockName = `stockops:sess:${session.sessionId}`

  return withNamedLock(sessionLockName, async () => {
    // 1) Fast idempotency check (FR-5.3).
    const existing = await findExistingReceive(ctx.db, session.sessionId, ctx.pdtAppIdx)
    if (existing) return buildReplayResult(ctx.db, session, existing)

    // 2) PO validation (BR-1).
    const purchaseRows = await ctx.db
      .select({
        purchaseId: posPurchase.purchaseId,
        status: posPurchase.status,
        vendorId: posPurchase.vendorId,
        locationId: posPurchase.locationId,
        companyId: posPurchase.companyId,
        includeTax: posPurchase.includeTax,
        taxPercent: posPurchase.taxPercent,
        discountPercent: posPurchase.discountPercent,
        paymentType: posPurchase.paymentType,
        currencyId: posPurchase.currencyId,
        priceIncludeTax: posPurchase.priceIncludeTax,
      })
      .from(posPurchase)
      .where(eq(posPurchase.purchaseId, BigInt(session.purchaseId)))
      .limit(1)
    const purchase = purchaseRows[0]
    if (!purchase) {
      return failed(session, 'PURCHASE_NOT_FOUND', 'PO tidak ditemukan di database pusat.')
    }
    if (purchase.status !== PULLABLE_PURCHASE_STATUS) {
      return failed(
        session,
        'PURCHASE_NOT_CHECKED',
        `PO sudah tidak berstatus ${PULLABLE_PURCHASE_STATUS} dan tidak boleh diterima.`,
      )
    }

    const vendorId = purchase.vendorId ?? BigInt(0)

    // 3) Fetch referenced PO items & verify they belong to this PO (BR-14).
    const purchaseItemIds = [...new Set(session.items.map((item) => BigInt(item.purchaseItemId)))]
    const purchaseItemRows = await ctx.db
      .select({
        purchaseItemId: posPurchaseItem.purchaseItemId,
        purchaseId: posPurchaseItem.purchaseId,
        itemMasterId: posPurchaseItem.itemMasterId,
        qty: posPurchaseItem.qty,
        uomId: posPurchaseItem.uomId,
        amount: posPurchaseItem.amount,
        discountAmount: posPurchaseItem.discountAmount,
      })
      .from(posPurchaseItem)
      .where(
        and(
          inArray(posPurchaseItem.purchaseItemId, purchaseItemIds),
          eq(posPurchaseItem.purchaseId, BigInt(session.purchaseId)),
        ),
      )

    const byPurchaseItem = new Map(purchaseItemRows.map((row) => [String(row.purchaseItemId), row]))
    for (const line of session.items) {
      const purchaseItem = byPurchaseItem.get(line.purchaseItemId)
      if (!purchaseItem) {
        return failed(
          session,
          'VALIDATION',
          `Barang (item PO ${line.purchaseItemId}) bukan bagian dari PO ini.`,
        )
      }
      if (String(purchaseItem.itemMasterId) !== line.itemMasterId) {
        return failed(
          session,
          'VALIDATION',
          `Barang (item PO ${line.purchaseItemId}) tidak cocok dengan master barang.`,
        )
      }
    }

    // 4) Smallest stock unit per item (PRD 12.4).
    const itemIds = [...new Set(session.items.map((item) => BigInt(item.itemMasterId)))]
    const itemRows = await ctx.db
      .select({ itemMasterId: posItemMaster.itemMasterId, uomStockId: posItemMaster.uomStockId })
      .from(posItemMaster)
      .where(inArray(posItemMaster.itemMasterId, itemIds))
    const stockUomByItem = new Map(itemRows.map((row) => [String(row.itemMasterId), row.uomStockId]))

    // 5) Total already received across all documents (FR-5.4, BR-4, BR-6).
    const alreadyRows = await ctx.db
      .select({
        purchaseItemId: posReceiveItem.purchaseItemId,
        receivedQty: sql<string>`COALESCE(SUM(${posReceiveItem.qty}), 0)`,
      })
      .from(posReceiveItem)
      .where(inArray(posReceiveItem.purchaseItemId, purchaseItemIds))
      .groupBy(posReceiveItem.purchaseItemId)

    const evaluation = evaluateSession(
      session.items.map((item) => ({ purchaseItemId: item.purchaseItemId, qty: item.qty })),
      purchaseItemRows.map((row) => ({
        purchaseItemId: String(row.purchaseItemId),
        orderedQty: Number(row.qty ?? 0),
      })),
      alreadyRows.map((row) => ({
        purchaseItemId: String(row.purchaseItemId),
        receivedQty: Number(row.receivedQty ?? 0),
      })),
    )

    // 5b) Document finances: compute per-line & total (data sourced from PO).
    //     - item discount prorated against received qty
    //     - tax follows PO price_include_tax (0 = price excludes tax)
    //     - all figures rounded to 2 decimals (round half-up) via dec2()
    const lineFinancials: ReturnType<typeof computeLineFinance>[] = []
    let itemsTotalAmount = 0
    for (let index = 0; index < evaluation.lines.length; index += 1) {
      const line = evaluation.lines[index]!
      const purchaseItem = byPurchaseItem.get(line.purchaseItemId)!
      const finance = computeLineFinance({
        qtyReceived: line.sessionQty,
        qtyOrdered: Number(purchaseItem.qty ?? 0),
        amount: Number(purchaseItem.amount ?? 0),
        discountAmountOrdered: Number(purchaseItem.discountAmount ?? 0),
      })
      lineFinancials.push(finance)
      itemsTotalAmount = dec2(itemsTotalAmount + finance.totalAmount)
    }
    const headerFinance = computeHeaderFinance({
      itemsTotalAmount,
      discountPercent: Number(purchase.discountPercent ?? 0),
      taxPercent: Number(purchase.taxPercent ?? 0),
      priceIncludeTax: Number(purchase.priceIncludeTax ?? 0),
    })

    // 6) Receive date & document number prefix.
    const now = ctx.now()
    const sanitized = sanitizeReceiveDate(session.receiveDate, now)
    const prefixNumber = buildPrefix(ctx.prefix, sanitized.parsed)

    // 7) Save in a single transaction (FR-5.7), numbering serialized by lock (BR-8).
    return withNamedLock(`stockops:doc:${prefixNumber}`, async () =>
      ctx.db.transaction(async (tx) => {
        // Re-check idempotency inside the lock.
        const existingInTx = await findExistingReceive(tx, session.sessionId, ctx.pdtAppIdx)
        if (existingInTx) return buildReplayResult(tx, session, existingInTx)

        const counterRows = rowsOf<Row>(
          await tx.execute(
            sql`SELECT COALESCE(MAX(counter), 0) AS max_counter FROM pos_receive WHERE prefix_number = ${prefixNumber}`,
          ),
        )
        const counter = Number(counterRows[0]?.max_counter ?? 0) + 1
        const number = buildNumber(prefixNumber, counter)
        const receiveId = ctx.receiveIdGen.next()

        // Due date follows vendor terms (vendor.due_date = number of days).
        const vendorRows = await tx
          .select({ dueDate: vendor.dueDate })
          .from(vendor)
          .where(eq(vendor.vendorId, vendorId))
          .limit(1)
        const dueDays = Number(vendorRows[0]?.dueDate ?? 0)
        const dueDate = toMysqlDate(dueDays > 0 ? addDays(sanitized.parsed, dueDays) : sanitized.parsed)

        await tx.insert(posReceive).values({
          receiveId,
          status: RECEIVE_STATUS_DRAFT,
          note: buildSessionNote({
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            userId: session.userId,
          }),
          approval1: BigInt(0),
          approval2: BigInt(0),
          approval3: BigInt(0),
          includeTax: purchase.includeTax ?? 0,
          totalTax: String(headerFinance.totalTax),
          totalAmount: String(headerFinance.totalAmount),
          taxPercent: purchase.taxPercent ?? '0',
          discountPercent: purchase.discountPercent ?? '0',
          discountTotal: String(headerFinance.discountTotal),
          paymentType: purchase.paymentType ?? null,
          locationId: BigInt(session.locationId),
          userId: BigInt(session.userId),
          number,
          counter,
          vendorId,
          date: sanitized.value,
          currencyId: purchase.currencyId ?? null,
          prefixNumber,
          purchaseId: BigInt(session.purchaseId),
          dueDate,
          invoiceNumber: session.invoiceNumber,
          doNumber: session.doNumber,
          type: 1,
          priceIncludeTax: purchase.priceIncludeTax ?? 0,
          createdAt: sanitized.value,
        })

        // Document history for admin system: new incoming receipt created from PDT.
        await tx.insert(documentHistory).values({
          documentHistoryId: ctx.docHistoryIdGen.next(),
          type: 2,
          userId: BigInt(session.userId),
          employeeId: BigInt(0),
          description: `New incoming document ${number} created from PDT device ${session.deviceId}.`,
          refId: receiveId,
          date: toMysqlDateTime(now),
        })

        const vendorItemRows = await resolveServerConv(tx, vendorId, itemIds)

        const resultLines: SyncSessionResult['lines'] = []
        for (let index = 0; index < evaluation.lines.length; index += 1) {
          const line = evaluation.lines[index]!
          const input = session.items[index]!
          const purchaseItem = byPurchaseItem.get(line.purchaseItemId)!
          const finance = lineFinancials[index]!
          const uomPurchaseId = String(purchaseItem.uomId ?? 0)
          const conv = resolveConvQty(vendorItemRows, {
            vendorId: String(purchase.vendorId ?? 0),
            itemMasterId: input.itemMasterId,
            uomPurchaseId,
          })
          const memo = line.overReceive
            ? buildOverReceiveMemo({
                orderedQty: line.orderedQty,
                newTotal: line.newTotal,
                excess: line.excess,
              })
            : null

          await tx.insert(posReceiveItem).values({
            receiveItemId: ctx.itemIdGen.next(),
            itemMasterId: BigInt(input.itemMasterId),
            qty: String(line.sessionQty),
            totalAmount: String(finance.totalAmount),
            amount: String(finance.amount),
            discountAmount: String(finance.discountAmount),
            deliveryDate: sanitized.value,
            uomId: stockUomByItem.get(input.itemMasterId) ?? BigInt(0),
            receiveId,
            purchaseItemId: BigInt(line.purchaseItemId),
            expiredDate: toMysqlDate(sanitized.parsed),
            apCoaId: BigInt(0),
            type: 0,
            companyId: BigInt(session.companyId),
            isBonus: 0,
            memo,
            status: null,
            priceImport: '0.00',
            transport: '0.00',
            bea: '0.00',
            komisi: '0.00',
            lainLain: '0.00',
            segment1Id: BigInt(0),
            convUnit: '1',
            dis1Percent: '0.00',
            dis1Val: '0.00',
            dis2Percent: '0.00',
            dis2Val: '0.00',
            dis3Percent: '0.00',
            dis3Val: '0.00',
            dis4Percent: '0.00',
            dis4Val: '0.00',
            uomPurchaseId: BigInt(uomPurchaseId),
            qtyPurchase: String(conv.convQty),
            expiredCheckStatus: 0,
            expiredCheckId: BigInt(0),
          })

          resultLines.push(
            lineResult(input.clientLineId, line, memo),
          )
          void conv
        }

        const overCount = resultLines.filter((line) => line.overReceive).length
        const message =
          overCount > 0
            ? `${overCount} item melebihi pesanan dan menunggu persetujuan admin.`
            : 'Dokumen penerimaan berhasil dikirim.'

        return buildSuccessResult(session, receiveId, number, resultLines, 'OK', message)
      }),
    )
  })
}

/**
 * FR-5.1/5.3/5.4/5.5/5.6/5.7: session synchronization (FIFO) + credential revocation check.
 */
export async function syncPush(input: PushInput, options: SyncOptions = {}): Promise<PushResult> {
  const ctx = buildContext(options)

  // BR-19: check credentials first (applies to all cached users).
  const revoked = await checkCredentialRevocations(input.credentials, ctx.db)

  const results: SyncSessionResult[] = []
  for (const session of input.sessions) {
    try {
      results.push(await processSession(ctx, session))
    } catch (error) {
      results.push(
        failed(
          session,
          'SERVER_ERROR',
          error instanceof Error ? error.message : 'Kesalahan server tidak dikenal.',
        ),
      )
    }
  }

  // "Already received" aggregate changed => bust cache so subsequent pulls are accurate.
  invalidateCache('receivedAggregate')

  return { results, revoked, serverTime: new Date().toISOString() }
}

/** Over-receive worklist for admin (FR-6.4) — used for verification & demo. */
export async function overReceiveWorklist(db: Database = getDb(), limit = 50) {
  const rows = await db
    .select({
      receiveId: posReceive.receiveId,
      number: posReceive.number,
      receiveItemId: posReceiveItem.receiveItemId,
      purchaseId: posReceive.purchaseId,
      purchaseNumber: posPurchase.number,
      vendorName: vendor.name,
      itemMasterId: posReceiveItem.itemMasterId,
      itemName: posItemMaster.name,
      memo: posReceiveItem.memo,
    })
    .from(posReceiveItem)
    .innerJoin(posReceive, eq(posReceive.receiveId, posReceiveItem.receiveId))
    .leftJoin(posPurchase, eq(posPurchase.purchaseId, posReceive.purchaseId))
    .leftJoin(vendor, eq(vendor.vendorId, posReceive.vendorId))
    .leftJoin(posItemMaster, eq(posItemMaster.itemMasterId, posReceiveItem.itemMasterId))
    .where(like(posReceiveItem.memo, 'PDT|OVER%'))
    .limit(limit)

  return rows.map((row) => {
    const parsed = parseOverReceiveMemo(row.memo)
    return {
      receiveId: str(row.receiveId),
      number: row.number ?? null,
      receiveItemId: str(row.receiveItemId),
      purchaseId: str(row.purchaseId),
      purchaseNumber: row.purchaseNumber ?? null,
      vendorName: row.vendorName ?? '',
      itemMasterId: str(row.itemMasterId),
      itemName: row.itemName ?? '',
      orderedQty: parsed?.orderedQty ?? 0,
      newTotal: parsed?.newTotal ?? 0,
      excess: parsed?.excess ?? 0,
      memo: row.memo ?? '',
    }
  })
}
