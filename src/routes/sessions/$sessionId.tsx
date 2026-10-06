import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { localRepo, sessionTabKey } from '~/client/db/local-repo'
import { useAppStore } from '~/client/state/store/app-store'
import { useLive } from '~/client/hooks/use-live'
import { addScannedItem } from '~/client/services/scanning'
import type { LocalSessionItem } from '~/client/db/local-db'
import { playFeedback } from '~/client/feedback'
import { toast } from '~/client/toast'
import { Upload } from 'lucide-react'
import { AppBar } from '~/components/app-bar'
import { ConfirmButton } from '~/components/confirm-button'
import { ScanBar } from '~/components/scan-bar'
import { ScanHero, type ScanHeroState } from '~/components/scan-hero'
import { SessionContextStrip } from '~/components/session-context-strip'
import { Badge, Button, Card, EmptyState, Field, Loading, Notice, inputClass } from '~/components/ui'
import { SESSION_STATUS, SESSION_STATUS_LABEL, type SessionStatus } from '~/shared/constants'
import { formatQty } from '~/shared/format'
import { toLocalDateTime } from '~/shared/receive-date'

export const Route = createFileRoute('/sessions/$sessionId')({
  component: SessionDetailPage,
})

function toneFor(status: SessionStatus): 'neutral' | 'info' | 'success' | 'warn' | 'danger' {
  switch (status) {
    case 'SYNCED':
      return 'success'
    case 'FAILED':
      return 'danger'
    case 'REJECTED':
      return 'danger'
    case 'SYNCING':
      return 'info'
    case 'PENDING':
      return 'warn'
    default:
      return 'neutral'
  }
}

type SessionTab = 'scan' | 'items' | 'docs'

function SessionDetailPage() {
  const { sessionId } = Route.useParams()
  const sync = useAppStore((state) => state.sync)
  const syncing = useAppStore((state) => state.syncing)
  const online = useAppStore((state) => state.online)
  const navigate = useNavigate()

  const session = useLive(() => localRepo.getSession(sessionId), [sessionId], undefined)
  const lines = useLive(() => localRepo.sessionItems(sessionId), [sessionId], [])
  const purchaseItems = useLive(
    async () => {
      return session ? localRepo.getPurchaseItems(session.purchaseId) : []
    },
    [session?.purchaseId],
    [],
  )
  const itemIds = useMemo(
    () => [...new Set(lines.map((line) => line.itemMasterId))].sort(),
    [lines],
  )
  const itemIdsKey = useMemo(() => JSON.stringify(itemIds), [itemIds])
  const items = useLive(
    async () => {
      if (itemIds.length === 0) return {}
      const entries = await Promise.all(
        itemIds.map(async (id) => [id, await localRepo.getItemMaster(id)] as const),
      )
      return Object.fromEntries(entries) as Record<string, { name: string; code: string | null } | undefined>
    },
    [itemIdsKey],
    {},
  )
  const units = useLive(() => localRepo.db.units.toArray(), [], [])
  const purchaseProgress = useLive(
    async () => (session ? localRepo.getPurchaseProgress(session.purchaseId) : null),
    [session?.purchaseId],
    null,
  )

  const purchaseItemMap = useMemo(
    () => new Map(purchaseItems.map((row) => [row.purchaseItemId, row])),
    [purchaseItems],
  )
  const unitMap = useMemo(() => new Map(units.map((row) => [row.uomId, row.unit])), [units])

  const [scan, setScan] = useState('')
  const [qty, setQty] = useState('1')
  const [qtyTouched, setQtyTouched] = useState(false)
  const [heroState, setHeroState] = useState<ScanHeroState>({ kind: 'IDLE' })
  // What the last successful scan added, so undo can subtract exactly that much. A ref, not state:
  // it is never rendered, and as state every scan would cost one extra render of the whole cockpit.
  const lastScanRef = useRef<{ lineId: string; addedQty: number } | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  // Lives here, not in ScanBar: ScanBar unmounts on every tab switch, so keeping it there would
  // reopen the keypad each time the operator comes back to the scan tab. It always starts closed —
  // the "123" button is the only way in, and the qty field itself is always typable.
  const [padOpen, setPadOpen] = useState(false)
  const [invoice, setInvoice] = useState('')
  const [doNumber, setDoNumber] = useState('')
  const [confirmingFinalize, setConfirmingFinalize] = useState(false)
  const tabMetaKey = sessionTabKey(sessionId)
  const savedTab = useLive(() => localRepo.getMeta(tabMetaKey), [tabMetaKey], null)
  const tab: SessionTab = savedTab === 'items' || savedTab === 'docs' ? savedTab : 'scan'
  const setTab = (next: SessionTab) => {
    localRepo.setMeta(tabMetaKey, next).catch(() => {
      toast('danger', 'Gagal berpindah bagian. Coba lagi.')
    })
  }
  const [invoiceError, setInvoiceError] = useState(false)
  const [doNumberError, setDoNumberError] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)
  // Scans are saved strictly one after another (FIFO), even when the scanner is faster than IndexedDB.
  const scanQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (session) {
      setInvoice(session.invoiceNumber)
      setDoNumber(session.doNumber)
    }
  }, [session?.invoiceNumber, session?.doNumber])

  // Keep the scanner's keystrokes landing in the barcode field. While a dialog is open focus
  // belongs to it; when it closes (e.g. finalize cancelled) the field gets focus back, otherwise
  // the scanner's Enter would press the previously focused button and reopen the dialog.
  // `tab` is in the deps because the barcode field only exists on the scan tab: coming back from
  // the item or document tab remounts it, and without this the focus would stay on the tab button.
  useEffect(() => {
    if (session?.status !== SESSION_STATUS.RUNNING || editingLineId || confirmingFinalize) return
    if (tab !== 'scan') return
    const frame = window.requestAnimationFrame(() => scanRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [session?.status, tab, editingLineId, confirmingFinalize])

  // Scanner wedge. The effect above only runs when one of its deps changes, so a tap on dead space
  // (the context strip, the empty area of the scan result, the app bar title) drops focus to <body>
  // and nothing brings it back: the scanner then types into nowhere and the scan is lost in silence.
  // This catches printable keystrokes that landed outside any text field and redirects them — the
  // triggering character included — into the barcode field. From the second character onwards the
  // field has focus and receives them normally, and the scanner's closing Enter lands there too.
  useEffect(() => {
    if (session?.status !== SESSION_STATUS.RUNNING || editingLineId || confirmingFinalize) return
    if (tab !== 'scan') return
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // Printable characters only: Enter, Tab, Escape and the arrows must keep working.
      if (event.key.length !== 1) return
      // Space activates a focused button; swallowing it would break keyboard operation.
      if (event.key === ' ') return
      const target = event.target
      // Every element that legitimately swallows typing. `<select>` and contenteditable do not
      // exist in this screen today; they are listed so that adding one later cannot silently
      // start redirecting its keystrokes into the barcode field.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      const field = scanRef.current
      if (!field) return
      event.preventDefault()
      field.focus()
      setScan((previous) => previous + event.key)
    }
    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [session?.status, tab, editingLineId, confirmingFinalize])

  const dismissHero = useCallback(() => setHeroState({ kind: 'IDLE' }), [])

  const overLineIds = useMemo(() => {
    const qtyByPurchaseItem = new Map<string, number>()
    for (const line of lines) {
      qtyByPurchaseItem.set(
        line.purchaseItemId,
        (qtyByPurchaseItem.get(line.purchaseItemId) ?? 0) + line.qty,
      )
    }
    // A Set, not an array: the item list looks this up once per rendered line.
    const overLineIds = new Set<string>()
    for (const line of lines) {
      const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
      if (!purchaseItem) continue
      const received = Number(purchaseItem.receivedQty ?? 0)
      const localQty = qtyByPurchaseItem.get(line.purchaseItemId) ?? 0
      if (received + localQty > Number(purchaseItem.qty ?? 0)) overLineIds.add(line.lineId)
    }
    return overLineIds
  }, [lines, purchaseItemMap])

  if (!session) return <Loading label="Memuat sesi…" />

  const editable = session.status === SESSION_STATUS.RUNNING
  const editingLine = editingLineId
    ? (lines.find((line) => line.lineId === editingLineId) ?? null)
    : null
  const editingPurchaseItem = editingLine
    ? purchaseItemMap.get(editingLine.purchaseItemId)
    : undefined
  const editingItem = editingLine ? items[editingLine.itemMasterId] : undefined

  const processScan = async (code: string, qtyText: string) => {
    try {
      const addedQty = Number(qtyText)
      const result = await addScannedItem(
        localRepo,
        session.sessionId,
        session.purchaseId,
        code,
        addedQty,
      )
      if (result.ok && result.line && result.resolution.purchaseItem && result.resolution.item) {
        const purchaseItem = result.resolution.purchaseItem
        const line = result.line
        const ordered = Number(purchaseItem.qty ?? 0)
        const serverReceived = Number(purchaseItem.receivedQty ?? 0)
        const itemTotal = serverReceived + line.qty
        const excess = itemTotal - ordered
        const purchaseUnit = unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId
        lastScanRef.current = { lineId: line.lineId, addedQty }
        if (excess > 0) {
          setHeroState({
            kind: 'OVER',
            itemName: result.resolution.item.name,
            ordered,
            newTotal: itemTotal,
            excess,
            unit: purchaseUnit,
          })
          playFeedback('over')
        } else {
          setHeroState({
            kind: 'OK',
            itemName: result.resolution.item.name,
            itemCode: result.resolution.item.code,
            addedQty,
            purchaseUnit,
            stockQty: addedQty * line.convQty,
            stockUnit: unitMap.get(line.uomId) ?? line.uomId,
            itemOrdered: ordered,
            itemTotal,
            itemServerReceived: serverReceived,
          })
          playFeedback('success')
        }
        setQty('1')
        setQtyTouched(false)
      } else if (result.resolution.status === 'ITEM_NOT_FOUND') {
        lastScanRef.current = null
        setHeroState({ kind: 'NOT_FOUND', scannedCode: code })
        playFeedback('danger')
      } else if (result.resolution.status === 'NOT_IN_PO') {
        lastScanRef.current = null
        // Sounded BEFORE the lookup below, like the three other branches do. In a noisy dock the
        // beep is what the operator goes by, and until the lookup resolves the card still shows
        // the PREVIOUS scan — so waiting would leave a stale success on screen, unannounced.
        playFeedback('warn')
        // Only reachable when the item resolved, so this lookup runs at most once per rejected
        // scan — and it uses the itemMasterId index, so it does not scan the table.
        const scannedItem = result.resolution.item
        const others = scannedItem
          ? await localRepo.findPurchasesWithItem(scannedItem.itemMasterId, session.purchaseId)
          : null
        const [firstOther] = others?.rows ?? []
        setHeroState({
          kind: 'NOT_IN_PO',
          itemName: scannedItem?.name ?? code,
          otherPurchase: firstOther ?? null,
          // `total`, not `rows.length`: the list is capped at five POs, the count is not.
          otherCount: Math.max(0, (others?.total ?? 0) - 1),
        })
      } else {
        // Resolution succeeded but the line was rejected (today: qty <= 0). Show the real reason
        // instead of mislabelling it as "not part of this PO".
        lastScanRef.current = null
        toast('danger', result.message)
        playFeedback('danger')
      }
    } catch (error) {
      lastScanRef.current = null
      setHeroState({ kind: 'NOT_FOUND', scannedCode: code })
      toast('danger', error instanceof Error ? error.message : 'Gagal menyimpan hasil scan.')
      playFeedback('danger')
    } finally {
      scanRef.current?.focus()
    }
  }

  /**
   * Undo subtracts exactly the qty the last scan added. `addOrIncrementLine` merges repeated
   * scans of one item into a single line, so removing the whole line would delete more than
   * the last scan; the line is only removed when nothing would be left.
   */
  const handleUndo = async () => {
    const target = lastScanRef.current
    if (!target) return
    lastScanRef.current = null
    setHeroState({ kind: 'IDLE' })
    try {
      const line = await localRepo.db.sessionItems.get(target.lineId)
      if (!line) return
      const next = line.qty - target.addedQty
      if (next > 0) await localRepo.setLineQty(target.lineId, next)
      else await localRepo.removeLine(target.lineId)
      toast('info', 'Scan terakhir dibatalkan.')
    } catch {
      toast('danger', 'Gagal membatalkan scan terakhir.')
    } finally {
      scanRef.current?.focus()
    }
  }

  /**
   * "Buka PO itu" on the NOT_IN_PO card. When this device already has a RUNNING session for that
   * PO, go straight to the session instead of to the PO detail screen: that screen carries no
   * "Lanjutkan sesi berjalan" banner — that one lives on the PO LIST (routes/pos/index.tsx) — and
   * its "Mulai Penerimaan" button calls `createSession` unconditionally, which has no dedupe. So
   * landing there would let the operator start a SECOND session for a PO already being received
   * and record the same delivery twice. Either way the session being left stays RUNNING in Dexie
   * and is reachable from the session list.
   */
  const openPurchase = async (purchaseId: string) => {
    const running = await localRepo.runningSessions()
    const existing = running.find((row) => row.purchaseId === purchaseId)
    if (existing) {
      void navigate({ to: '/sessions/$sessionId', params: { sessionId: existing.sessionId } })
      return
    }
    void navigate({ to: '/pos/$purchaseId', params: { purchaseId } })
  }

  const handleAdd = () => {
    const code = scan.trim()
    if (!code) return
    const qtyText = qty
    // Scanners type like a keyboard: clear the field synchronously so the next burst
    // starts on an empty input, then save scans one after another.
    setScan('')
    // processScan handles its own errors; the catch only keeps the queue alive should its
    // error handling itself throw (e.g. in the feedback), so later scans are never dropped.
    scanQueueRef.current = scanQueueRef.current
      .then(() => processScan(code, qtyText))
      .catch(() => undefined)
  }

  const requestFinalize = () => {
    const invoiceMissing = !invoice.trim()
    const doMissing = !doNumber.trim()
    if (invoiceMissing || doMissing) {
      setInvoiceError(invoiceMissing)
      setDoNumberError(doMissing)
      toast('danger', 'Nomor invoice dan nomor DO wajib diisi.')
      return
    }
    if (lines.length === 0) {
      toast('danger', 'Belum ada item yang discan.')
      setTab('scan')
      return
    }
    setConfirmingFinalize(true)
  }

  const doFinalize = async () => {
    setConfirmingFinalize(false)
    await localRepo.updateSessionDraft(session.sessionId, {
      invoiceNumber: invoice.trim(),
      doNumber: doNumber.trim(),
    })
    await localRepo.finalizeSession(session.sessionId, {
      invoiceNumber: invoice.trim(),
      doNumber: doNumber.trim(),
      receiveDate: session.receiveDate || toLocalDateTime(new Date()),
    })
    const result = await sync()
    if (result.ok) {
      toast('success', 'Sesi selesai & tersinkron.')
    } else if (!online) {
      toast('info', 'Sesi disimpan. Menunggu sinkronisasi (offline).')
    } else {
      toast('danger', result.message)
    }
  }

  const handleRetrySync = async () => {
    const result = await sync()
    if (result.ok) toast('success', result.message)
    else toast(online ? 'danger' : 'warn', result.message)
  }

  const handleCancel = async () => {
    await localRepo.deleteSession(session.sessionId)
    void navigate({ to: '/sessions' })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Fixed header: never scrolls. */}
      <div className="shrink-0 px-3 pt-2">
        <AppBar
          title="Terima barang"
          backTo="/sessions"
          backLabel="Kembali ke daftar sesi"
          actions={<Badge tone={toneFor(session.status)}>{SESSION_STATUS_LABEL[session.status]}</Badge>}
        />
        <SessionContextStrip
          purchaseLabel={session.purchaseNumber ?? session.purchaseId}
          vendorName={session.vendorName ?? '-'}
          itemCount={lines.length}
          ordered={purchaseProgress?.orderedTotal ?? 0}
          serverReceived={purchaseProgress?.serverReceivedTotal ?? 0}
          localPending={purchaseProgress?.localPendingTotal ?? 0}
          overReceive={session.overReceive}
          excessTotal={session.excessTotal}
        />
      </div>

      {/* The only scrollable region. It is the tab panel while the session is editable. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        role={editable ? 'tabpanel' : undefined}
        id={editable ? 'session-tab-panel' : undefined}
        aria-labelledby={editable ? `session-tab-${tab}` : undefined}
      >
        {editable && tab === 'scan' ? (
          <ScanHero
            state={heroState}
            onUndo={() => void handleUndo()}
            onDismiss={dismissHero}
            onOpenPurchase={(purchaseId) => void openPurchase(purchaseId)}
          />
        ) : null}

        {!editable || tab === 'items' ? (
          <Card title={`Item dalam sesi (${lines.length})`}>
            {editable ? (
              <p className="mb-1 text-sm text-fg-subtle">Ketuk item untuk mengubah qty atau menghapus.</p>
            ) : null}
            <ul className="flex flex-col divide-y divide-line-soft">
              {lines.map((line) => {
                const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
                const item = items[line.itemMasterId]
                const isOver = overLineIds.has(line.lineId)
                return (
                  <li key={line.lineId}>
                    <button
                      type="button"
                      className="touch-target w-full py-3 text-left"
                      disabled={!editable}
                      onClick={() => setEditingLineId(line.lineId)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-fg">{item?.name ?? line.itemMasterId}</p>
                          <p className="text-sm text-fg-subtle">
                            {item?.code ?? '-'} • {formatQty(line.qty)}{' '}
                            {unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId}
                            {line.convFound ? '' : ' • konversi tidak ditemukan (faktor 1)'}
                          </p>
                          <p className="text-sm tabular-nums text-fg-subtle">
                            = {formatQty(line.qty * line.convQty)} {unitMap.get(line.uomId) ?? line.uomId}
                          </p>
                          {purchaseItem ? (
                            <p className="text-sm tabular-nums text-fg-muted">
                              Dipesan {formatQty(purchaseItem.qty)} {unitMap.get(purchaseItem.uomId) ?? ''}
                            </p>
                          ) : null}
                        </div>
                        {isOver ? <Badge tone="danger">Over-receive</Badge> : null}
                      </div>
                    </button>
                  </li>
                )
              })}
              {lines.length === 0 ? <EmptyState>Belum ada item. Scan barcode untuk menambah.</EmptyState> : null}
            </ul>
          </Card>
        ) : null}

        {!editable || tab === 'docs' ? (
          <div className={!editable || tab === 'items' ? 'mt-2' : ''}>
            <VendorDocCard
              invoice={invoice}
              doNumber={doNumber}
              editable={editable}
              invoiceError={invoiceError}
              doNumberError={doNumberError}
              onInvoiceChange={(value) => {
                setInvoice(value)
                setInvoiceError(false)
              }}
              onDoNumberChange={(value) => {
                setDoNumber(value)
                setDoNumberError(false)
              }}
            />
            {session.receiveDate ? (
              <p className="mt-2 text-sm text-fg-subtle">
                Tanggal penerimaan: {session.receiveDate}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-fg-subtle">ID sesi: {session.sessionId}</p>
          </div>
        ) : null}

        {!editable || tab === 'docs' ? (
          <div className="mt-2">
            {editable ? (
              <div className="flex flex-col gap-2">
                <Button className="w-full" onClick={requestFinalize}>
                  Selesaikan &amp; kirim
                </Button>
                <ConfirmButton
                  tone="danger"
                  className="w-full"
                  label="Batalkan sesi ini"
                  confirmLabel="Tahan terus… sesi akan dibatalkan"
                  onConfirm={() => void handleCancel()}
                />
                <p className="text-center text-sm text-fg-subtle">
                  Tombol merah perlu ditahan 1,5 detik supaya tidak tersenggol.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {session.status === SESSION_STATUS.PENDING || session.status === SESSION_STATUS.FAILED ? (
                  <>
                    {session.lastError ? <Notice tone="danger">{session.lastError}</Notice> : null}
                    <Button
                      className="flex w-full items-center justify-center gap-1"
                      aria-label="Upload"
                      disabled={syncing}
                      onClick={() => void handleRetrySync()}
                    >
                      <Upload className="h-5 w-5" aria-hidden="true" />  Upload
                    </Button>
                  </>
                ) : null}
                {session.status === SESSION_STATUS.REJECTED ? (
                  <>
                    <Notice tone="danger">
                      Sesi ditolak server: {session.lastError ?? 'PO tidak dapat diterima.'}
                    </Notice>
                    <ConfirmButton
                      tone="danger"
                      className="w-full"
                      label="Hapus sesi dari perangkat"
                      confirmLabel="Tahan terus… sesi akan dihapus"
                      onConfirm={() => void handleCancel()}
                    />
                  </>
                ) : null}
                {session.status === SESSION_STATUS.SYNCED ? (
                  <Notice tone="success">
                    Tersinkron sebagai {session.number}. Dokumen bersifat baca-saja di perangkat.
                  </Notice>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Fixed bottom: scan bar + tab bar. Never scrolls. */}
      {editable ? (
        <div className="shrink-0 border-t border-line bg-chrome/95 pb-[env(safe-area-inset-bottom)]">
          {tab === 'scan' ? (
            <div className="px-3 py-2">
              <ScanBar
                scan={scan}
                qty={qty}
                qtyTouched={qtyTouched}
                scanRef={scanRef}
                padOpen={padOpen}
                onPadOpenChange={setPadOpen}
                onScanChange={setScan}
                onQtyChange={(value) => {
                  setQty(value)
                  setQtyTouched(true)
                }}
                onAdd={() => void handleAdd()}
                // Escape clears a result that is WAITING for the operator. The success card is
                // not waiting — it is replaced by the next scan — and clearing it would remove
                // "Batalkan scan ini", the only route to the precise undo of the last increment.
                onEscape={() => {
                  if (heroState.kind !== 'OK') dismissHero()
                }}
              />
            </div>
          ) : null}
          <SessionTabs
            value={tab}
            onChange={setTab}
            itemCount={lines.length}
            docsComplete={Boolean(invoice.trim() && doNumber.trim())}
          />
        </div>
      ) : null}

      {editable && editingLine && editingItem ? (
        <LineEditSheet
          key={editingLine.lineId}
          line={editingLine}
          itemName={editingItem.name}
          purchaseUnit={unitMap.get(editingLine.uomPurchaseId) ?? editingLine.uomPurchaseId}
          stockUnit={unitMap.get(editingLine.uomId) ?? editingLine.uomId}
          orderedText={
            editingPurchaseItem
              ? `Dipesan ${formatQty(editingPurchaseItem.qty)} ${unitMap.get(editingPurchaseItem.uomId) ?? ''}`
              : 'Item tidak ditemukan pada PO'
          }
          onQtyChange={(nextQty) => void localRepo.setLineQty(editingLine.lineId, nextQty)}
          onRemove={() => void localRepo.removeLine(editingLine.lineId)}
          onClose={() => setEditingLineId(null)}
        />
      ) : null}
      {confirmingFinalize ? (
        <FinalizeDialog
          purchaseLabel={session.purchaseNumber ?? session.purchaseId}
          invoice={invoice.trim()}
          doNumber={doNumber.trim()}
          itemCount={lines.length}
          onConfirm={() => void doFinalize()}
          onCancel={() => setConfirmingFinalize(false)}
        />
      ) : null}
    </div>
  )
}

function VendorDocCard({
  invoice,
  doNumber,
  editable,
  invoiceError,
  doNumberError,
  onInvoiceChange,
  onDoNumberChange,
}: {
  invoice: string
  doNumber: string
  editable: boolean
  invoiceError: boolean
  doNumberError: boolean
  onInvoiceChange: (value: string) => void
  onDoNumberChange: (value: string) => void
}) {
  return (
    <Card title="Dokumen Vendor">
      <div className="flex flex-col gap-3">
        <Field label="Nomor Invoice (wajib)">
          <input
            className={`${inputClass} w-full ${invoiceError ? 'border-danger-line' : 'border-line-strong'}`}
            value={invoice}
            disabled={!editable}
            onChange={(event) => onInvoiceChange(event.target.value)}
          />
          {invoiceError ? <span className="mt-1 block text-xs text-danger-text">Nomor invoice wajib diisi.</span> : null}
        </Field>
        <Field label="Nomor Surat Jalan / DO (wajib)">
          <input
            className={`${inputClass} w-full ${doNumberError ? 'border-danger-line' : 'border-line-strong'}`}
            value={doNumber}
            disabled={!editable}
            onChange={(event) => onDoNumberChange(event.target.value)}
          />
          {doNumberError ? <span className="mt-1 block text-xs text-danger-text">Nomor surat jalan (DO) wajib diisi.</span> : null}
        </Field>
      </div>
    </Card>
  )
}

function LineEditSheet({
  line,
  itemName,
  purchaseUnit,
  stockUnit,
  orderedText,
  onQtyChange,
  onRemove,
  onClose,
}: {
  line: LocalSessionItem
  itemName: string
  purchaseUnit: string
  stockUnit: string
  orderedText: string
  onQtyChange: (qty: number) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [draftQty, setDraftQty] = useState(String(line.qty))
  const dialogRef = useRef<HTMLDivElement>(null)
  const qtyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    qtyInputRef.current?.focus()
  }, [])

  const commit = () => {
    const parsed = Number(draftQty)
    if (Number.isFinite(parsed) && parsed > 0) onQtyChange(parsed)
  }

  const close = () => {
    commit()
    onClose()
  }

  const step = (amount: number) => {
    const current = Number(draftQty)
    const base = Number.isFinite(current) && current > 0 ? current : line.qty
    const next = base + amount
    if (next <= 0) return
    setDraftQty(String(next))
    onQtyChange(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled])',
    )
    if (!focusables || focusables.length === 0) return
    const list = Array.from(focusables)
    const first = list[0]
    const last = list[list.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Tutup editor qty"
        className="absolute inset-0 bg-scrim/60"
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${itemName}`}
        className="relative rounded-t-2xl border-t border-line bg-sheet p-4 pb-[env(safe-area-inset-bottom)]"
        onKeyDown={handleKeyDown}
      >
        <p className="text-lg font-bold text-fg">{itemName}</p>
        <p className="text-sm text-fg-subtle">
          {orderedText} • 1 {purchaseUnit} = {formatQty(line.convQty)} {stockUnit}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="secondary"
            className="px-5! py-3! text-xl"
            aria-label="Kurangi qty satu satuan PO"
            onClick={() => step(-1)}
          >
            −1
          </Button>
          <input
            ref={qtyInputRef}
            className={`${inputClass} w-full border-line-strong text-center text-xl font-bold tabular-nums`}
            inputMode="decimal"
            aria-label={`Qty ${itemName}`}
            value={draftQty}
            onChange={(event) => {
              const raw = event.target.value
              if (/^\d*(?:[.,]\d*)?$/.test(raw)) setDraftQty(raw.replace(',', '.'))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                close()
              }
            }}
          />
          <Button
            variant="secondary"
            className="px-5! py-3! text-xl"
            aria-label="Tambah qty satu satuan PO"
            onClick={() => step(1)}
          >
            +1
          </Button>
        </div>
        <p className="mt-2 text-sm tabular-nums text-fg-muted">
          {formatQty(Number(draftQty) > 0 ? Number(draftQty) : line.qty)} {purchaseUnit} ={' '}
          {formatQty((Number(draftQty) > 0 ? Number(draftQty) : line.qty) * line.convQty)} {stockUnit}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <ConfirmButton
            tone="danger"
            className="w-full"
            label="Hapus item ini"
            confirmLabel="Tahan terus… item akan dihapus"
            onConfirm={() => {
              onRemove()
              onClose()
            }}
          />
          <Button variant="ghost" className="w-full" onClick={close}>
            Tutup
          </Button>
        </div>
      </div>
    </div>
  )
}

function FinalizeDialog({
  purchaseLabel,
  invoice,
  doNumber,
  itemCount,
  onConfirm,
  onCancel,
}: {
  purchaseLabel: string
  invoice: string
  doNumber: string
  itemCount: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // NF-8: move focus into the dialog (onto "Batal", the safe choice) and give it back on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])')
    if (!focusables || focusables.length === 0) return
    const list = Array.from(focusables)
    const first = list[0]
    const last = list[list.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3">
      <button
        type="button"
        aria-label="Batal finalisasi"
        className="absolute inset-0 bg-scrim/60"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Konfirmasi selesaikan sesi"
        className="relative w-full max-w-sm rounded-2xl border border-line bg-sheet p-4"
        onKeyDown={handleKeyDown}
      >
        <p className="text-lg font-bold text-fg">Selesaikan sesi?</p>
        <div className="mt-3 flex flex-col gap-1 text-sm text-fg-muted">
          <p>PO: {purchaseLabel}</p>
          <p>Invoice: {invoice}</p>
          <p>DO: {doNumber}</p>
          <p>Item: {itemCount}</p>
        </div>
        <p className="mt-2 text-xs text-fg-subtle">Setelah diselesaikan, sesi tidak bisa diubah lagi.</p>
        <div className="mt-4 flex flex-col gap-2">
          <Button className="w-full" onClick={onConfirm}>
            Ya, Selesaikan
          </Button>
          <Button variant="ghost" className="w-full" data-autofocus onClick={onCancel}>
            Batal
          </Button>
        </div>
      </div>
    </div>
  )
}

const SESSION_TAB_IDS: readonly SessionTab[] = ['scan', 'items', 'docs']

function SessionTabs({
  value,
  onChange,
  itemCount,
  docsComplete,
}: {
  value: SessionTab
  onChange: (next: SessionTab) => void
  itemCount: number
  docsComplete: boolean
}) {
  // Bottom tab bar: a top border marks the active tab instead of a pill, so the bar reads as
  // part of the shell rather than as three floating buttons.
  const tabClass = (active: boolean): string =>
    `touch-target flex-1 border-t-2 px-2 text-sm font-semibold transition ${
      active
        ? 'border-brand-bright bg-raised text-brand-soft'
        : 'border-transparent text-fg-muted hover:bg-raised'
    }`

  // Roving tabindex + arrow keys: on a keypad-first device, reaching the third tab must not cost
  // three Tab presses.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = SESSION_TAB_IDS.indexOf(value)
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = SESSION_TAB_IDS[(index + delta + SESSION_TAB_IDS.length) % SESSION_TAB_IDS.length]
    if (!next) return
    onChange(next)
    // The scan tab is excluded on purpose: its own focus effect puts focus in the barcode field,
    // and moving it to the tab button here would fight that. For the other two, the new `tab`
    // value only arrives on a later commit (it round-trips through Dexie), hence the frame wait.
    if (next !== 'scan') {
      window.requestAnimationFrame(() => {
        document.getElementById(`session-tab-${next}`)?.focus()
      })
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Bagian sesi penerimaan"
      className="flex"
      onKeyDown={handleKeyDown}
    >
      {SESSION_TAB_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`session-tab-${id}`}
          aria-selected={value === id}
          aria-controls="session-tab-panel"
          tabIndex={value === id ? 0 : -1}
          className={tabClass(value === id)}
          onClick={() => onChange(id)}
        >
          {id === 'scan' ? 'Scan' : null}
          {id === 'items' ? `Item (${itemCount})` : null}
          {id === 'docs' ? (
            <span className="inline-flex items-center gap-1.5">
              Dokumen
              {docsComplete ? null : (
                <span
                  aria-label="belum lengkap"
                  className="inline-block h-2.5 w-2.5 rounded-full bg-warn"
                />
              )}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

