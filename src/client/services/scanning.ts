import type { LocalItem, LocalPurchase, LocalPurchaseItem, LocalSessionItem } from '../db/local-db'
import type { LocalRepository } from '../db/local-repo'
import { MAX_SCAN_QTY } from '~/shared/constants'
import { resolveConvQty } from '~/shared/uom'

export type ScanStatus = 'OK' | 'ITEM_NOT_FOUND' | 'NOT_IN_PO'

export interface ScanResolution {
  status: ScanStatus
  message: string
  item?: LocalItem
  purchaseItem?: LocalPurchaseItem
  convQty: number
  convFound: boolean
}

/**
 * FR-4.3 / BR-14: Resolves scan result into item + PO line + conversion factor.
 * Items not part of the PO are rejected with a message (not an exception).
 */
export async function resolveScan(
  repo: LocalRepository,
  purchaseId: string,
  scannedCode: string,
): Promise<ScanResolution> {
  const item = await repo.getItemByBarcodeOrCode(scannedCode)
  if (!item) {
    return {
      status: 'ITEM_NOT_FOUND',
      message: `Barcode/kode "${scannedCode}" tidak dikenali.`,
      convQty: 1,
      convFound: false,
    }
  }

  const [purchase, purchaseItems] = await Promise.all([
    repo.getPurchase(purchaseId),
    repo.getPurchaseItems(purchaseId),
  ])
  const purchaseItem = purchaseItems.find((row) => row.itemMasterId === item.itemMasterId)
  if (!purchaseItem || !purchase) {
    return {
      status: 'NOT_IN_PO',
      message: `"${item.name}" bukan bagian dari PO ini.`,
      item,
      convQty: 1,
      convFound: false,
    }
  }

  return resolveWithConversion(repo, purchase, purchaseItem, item)
}

/**
 * The tail both entry points share: the conversion factor for (vendor, item, PO unit), and the
 * resolution built from it.
 *
 * Split out because this is the one thing that silently changes a stored qty. If the picker resolved
 * its own conv factor, the two paths could drift — a scan and a pick of the same item would write
 * different `convQty` into `qty_purchase`, and nothing on screen would say so.
 */
async function resolveWithConversion(
  repo: LocalRepository,
  purchase: LocalPurchase,
  purchaseItem: LocalPurchaseItem,
  item: LocalItem,
): Promise<ScanResolution> {
  const vendorItems = await repo.getVendorItems(purchase.vendorId, item.itemMasterId)
  const conv = resolveConvQty(vendorItems, {
    vendorId: purchase.vendorId,
    itemMasterId: item.itemMasterId,
    uomPurchaseId: purchaseItem.uomId,
  })

  return {
    status: 'OK',
    message: conv.found
      ? item.name
      : `${item.name} (konversi satuan tidak ditemukan, dipakai faktor 1)`,
    item,
    purchaseItem,
    convQty: conv.convQty,
    convFound: conv.found,
  }
}

/**
 * FR-4.3 companion: resolves a PO line the operator PICKED from the list instead of scanning.
 *
 * It starts from the `purchaseItemId` the picker already holds, so no barcode is involved at any
 * point — and it ends in the same `ScanResolution`, so everything downstream cannot tell the two
 * apart. The two failure modes are both "the device's data is incomplete", not operator error, so
 * both messages say what to do about it. Neither is reachable through the picker's UI, which
 * disables a row whose master row is missing; they exist for the window between a live query and a
 * tap, and for a PO that was removed by a refresh in between.
 */
export async function resolvePickedItem(
  repo: LocalRepository,
  purchaseId: string,
  purchaseItemId: string,
): Promise<ScanResolution> {
  const [purchase, purchaseItems] = await Promise.all([
    repo.getPurchase(purchaseId),
    repo.getPurchaseItems(purchaseId),
  ])
  const purchaseItem = purchaseItems.find((row) => row.purchaseItemId === purchaseItemId)
  if (!purchase || !purchaseItem) {
    return {
      status: 'NOT_IN_PO',
      message: 'Baris ini sudah tidak ada di PO. Unduh ulang data PO lewat Pengaturan.',
      convQty: 1,
      convFound: false,
    }
  }

  const item = await repo.getItemMaster(purchaseItem.itemMasterId)
  if (!item) {
    return {
      status: 'ITEM_NOT_FOUND',
      message: 'Data barang belum lengkap di perangkat. Unduh ulang data lewat Pengaturan.',
      convQty: 1,
      convFound: false,
    }
  }

  return resolveWithConversion(repo, purchase, purchaseItem, item)
}

export interface AddScanResult {
  ok: boolean
  message: string
  resolution: ScanResolution
  line?: LocalSessionItem
}

/** FR-4.4/FR-4.5: Adds scanned item to receiving session. */
export async function addScannedItem(
  repo: LocalRepository,
  sessionId: string,
  purchaseId: string,
  scannedCode: string,
  qty: number,
): Promise<AddScanResult> {
  const resolution = await resolveScan(repo, purchaseId, scannedCode)
  if (resolution.status !== 'OK' || !resolution.item || !resolution.purchaseItem) {
    return { ok: false, message: resolution.message, resolution }
  }
  const rejection = qtyRejection(qty)
  if (rejection) return { ok: false, message: rejection, resolution }

  const line = await repo.addOrIncrementLine(sessionId, {
    purchaseItemId: resolution.purchaseItem.purchaseItemId,
    itemMasterId: resolution.item.itemMasterId,
    barcode: scannedCode,
    qty,
    uomPurchaseId: resolution.purchaseItem.uomId,
    uomId: resolution.item.uomStockId,
    convQty: resolution.convQty,
    convFound: resolution.convFound,
  })

  return { ok: true, message: resolution.message, resolution, line }
}

/**
 * The two qty guard rails both entry points share. Returns the message to show, or `null` when the
 * qty is acceptable.
 *
 * `MAX_SCAN_QTY` is not a business rule but a guard rail (see its own comment): without it a stuck
 * scanner — or, now, a fat-fingered qty panel — writes an absurd qty into the session, which is then
 * pushed and prorated into the document's financial fields. Both paths must have it, and one copy is
 * how they stay identical.
 */
function qtyRejection(qty: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return 'Qty harus lebih dari 0.'
  if (qty > MAX_SCAN_QTY) {
    return `Qty ${qty} tidak masuk akal (maksimum ${MAX_SCAN_QTY}). Periksa kolom qty.`
  }
  return null
}

/**
 * FR-4.4/FR-4.5 companion: adds a PO line the operator picked from the list.
 *
 * `qty` is ADDED to whatever the session already holds for that PO line, exactly like a scan —
 * `addOrIncrementLine` merges them into one row either way, so "replace" was never an option that
 * could be implemented honestly here.
 */
export async function addPickedItem(
  repo: LocalRepository,
  sessionId: string,
  purchaseId: string,
  purchaseItemId: string,
  qty: number,
): Promise<AddScanResult> {
  const resolution = await resolvePickedItem(repo, purchaseId, purchaseItemId)
  if (resolution.status !== 'OK' || !resolution.item || !resolution.purchaseItem) {
    return { ok: false, message: resolution.message, resolution }
  }
  const rejection = qtyRejection(qty)
  if (rejection) return { ok: false, message: rejection, resolution }

  const line = await repo.addOrIncrementLine(sessionId, {
    purchaseItemId: resolution.purchaseItem.purchaseItemId,
    itemMasterId: resolution.item.itemMasterId,
    // Null, because nothing was scanned. Storing the item code here instead would make the row
    // indistinguishable from a scan of that code in the local data, and the whole point of this
    // path is that it is distinguishable.
    barcode: null,
    qty,
    uomPurchaseId: resolution.purchaseItem.uomId,
    uomId: resolution.item.uomStockId,
    convQty: resolution.convQty,
    convFound: resolution.convFound,
    pickedManually: true,
  })

  return { ok: true, message: resolution.message, resolution, line }
}
