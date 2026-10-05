import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useAppStore } from '~/client/state/store/app-store'
import { useLive } from '~/client/hooks/use-live'
import { addScannedItem } from '~/client/services/scanning'
import type { LocalSessionItem } from '~/client/db/local-db'
import { loadPreferences, type Preferences } from '~/client/preferences'
import { playFeedback } from '~/client/feedback'
import { toast } from '~/client/toast'
import { Upload } from 'lucide-react'
import { AppBar } from '~/components/app-bar'
import { ConfirmButton } from '~/components/confirm-button'
import { NumericPad } from '~/components/numeric-pad'
import { ScanHero, type ScanHeroState } from '~/components/scan-hero'
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

  const purchaseItemMap = useMemo(
    () => new Map(purchaseItems.map((row) => [row.purchaseItemId, row])),
    [purchaseItems],
  )
  const unitMap = useMemo(() => new Map(units.map((row) => [row.uomId, row.unit])), [units])

  const [scan, setScan] = useState('')
  const [qty, setQty] = useState('1')
  const [qtyTouched, setQtyTouched] = useState(false)
  const [heroState, setHeroState] = useState<ScanHeroState>({ kind: 'IDLE' })
  // What the last successful scan added, so undo can subtract exactly that much.
  const [lastScan, setLastScan] = useState<{ lineId: string; addedQty: number } | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences())
  const [invoice, setInvoice] = useState('')
  const [doNumber, setDoNumber] = useState('')
  const [confirmingFinalize, setConfirmingFinalize] = useState(false)
  const tabMetaKey = `sessionTab:${sessionId}`
  const savedTab = useLive(() => localRepo.getMeta(tabMetaKey), [tabMetaKey], null)
  const tab: SessionTab = savedTab === 'items' || savedTab === 'docs' ? savedTab : 'scan'
  const setTab = (next: SessionTab) => {
    void localRepo.setMeta(tabMetaKey, next)
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
  useEffect(() => {
    if (session?.status !== SESSION_STATUS.RUNNING || editingLineId || confirmingFinalize) return
    const frame = window.requestAnimationFrame(() => scanRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [session?.status, editingLineId, confirmingFinalize])

  const dismissHero = useCallback(() => setHeroState({ kind: 'IDLE' }), [])

  const totalOver = useMemo(() => {
    const qtyByPurchaseItem = new Map<string, number>()
    for (const line of lines) {
      qtyByPurchaseItem.set(
        line.purchaseItemId,
        (qtyByPurchaseItem.get(line.purchaseItemId) ?? 0) + line.qty,
      )
    }
    return lines.filter((line) => {
      const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
      if (!purchaseItem) return false
      const received = Number(purchaseItem.receivedQty ?? 0)
      const localQty = qtyByPurchaseItem.get(line.purchaseItemId) ?? 0
      return received + localQty > Number(purchaseItem.qty ?? 0)
    })
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
        setLastScan({ lineId: line.lineId, addedQty })
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
          })
          playFeedback('success')
        }
        setQty('1')
        setQtyTouched(false)
      } else if (result.resolution.status === 'ITEM_NOT_FOUND') {
        setLastScan(null)
        setHeroState({ kind: 'NOT_FOUND', scannedCode: code })
        playFeedback('danger')
      } else {
        setLastScan(null)
        setHeroState({
          kind: 'NOT_IN_PO',
          itemName: result.resolution.item?.name ?? code,
        })
        playFeedback('warn')
      }
    } catch (error) {
      setLastScan(null)
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
    const target = lastScan
    if (!target) return
    setLastScan(null)
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
    <div className="flex flex-col gap-3">
      <AppBar
        title="Terima barang"
        backTo="/sessions"
        backLabel="Kembali ke daftar sesi"
        actions={<Badge tone={toneFor(session.status)}>{SESSION_STATUS_LABEL[session.status]}</Badge>}
      />
      <Card title={session.number ?? 'Sesi baru'}>
        <p className="text-slate-300">
          {session.purchaseNumber ?? session.purchaseId} • {session.vendorName ?? '-'}
        </p>
        <p className="text-xs text-slate-400">ID sesi: {session.sessionId}</p>
        {session.receiveDate ? (
          <p className="text-sm text-slate-400">Tanggal penerimaan: {session.receiveDate}</p>
        ) : null}
        {session.overReceive ? (
          <p className="mt-2 text-sm text-amber-300">
            Terdapat kelebihan terima {formatQty(session.excessTotal)} — menunggu persetujuan admin.
          </p>
        ) : null}
      </Card>

      {editable ? (
        <SessionTabs
          value={tab}
          onChange={setTab}
          itemCount={lines.length}
          docsComplete={Boolean(invoice.trim() && doNumber.trim())}
        />
      ) : null}

      {editable && tab === 'scan' ? (
        <ScanHero state={heroState} onUndo={() => void handleUndo()} onDismiss={dismissHero} />
      ) : null}

      {editable && tab === 'scan' ? (
        <ScanCard
          scan={scan}
          qty={qty}
          qtyTouched={qtyTouched}
          scanRef={scanRef}
          qtyInput={preferences.qtyInput}
          onScanChange={setScan}
          onQtyChange={(value) => {
            setQty(value)
            setQtyTouched(true)
          }}
          onAdd={() => void handleAdd()}
        />
      ) : null}

      {editable && tab === 'scan' && lines.length > 0 ? (
        <Button variant="secondary" className="w-full" onClick={() => setTab('docs')}>
          Selesai scan — lanjut ke dokumen ({lines.length} item)
        </Button>
      ) : null}

      {!editable || tab === 'items' ? (
        <Card title={`Item dalam sesi (${lines.length})`}>
          {editable ? (
            <p className="mb-1 text-sm text-slate-400">Ketuk item untuk mengubah qty atau menghapus.</p>
          ) : null}
          <ul className="flex flex-col divide-y divide-slate-800">
            {lines.map((line) => {
              const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
              const item = items[line.itemMasterId]
              const isOver = totalOver.some((row) => row.lineId === line.lineId)
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
                        <p className="font-semibold text-slate-100">{item?.name ?? line.itemMasterId}</p>
                        <p className="text-sm text-slate-400">
                          {item?.code ?? '-'} • {formatQty(line.qty)}{' '}
                          {unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId}
                          {line.convFound ? '' : ' • konversi tidak ditemukan (faktor 1)'}
                        </p>
                        <p className="text-sm tabular-nums text-slate-400">
                          = {formatQty(line.qty * line.convQty)} {unitMap.get(line.uomId) ?? line.uomId}
                        </p>
                        {purchaseItem ? (
                          <p className="text-sm tabular-nums text-slate-300">
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
      ) : null}

      {editable && tab === 'docs' ? (
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
          <p className="text-center text-sm text-slate-400">
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

/** Qty shortcuts for the common cases; anything else goes through the keypad. */
const QTY_CHIPS = [1, 2, 5, 12] as const

function ScanCard({
  scan,
  qty,
  qtyTouched,
  scanRef,
  qtyInput,
  onScanChange,
  onQtyChange,
  onAdd,
}: {
  scan: string
  qty: string
  qtyTouched: boolean
  scanRef: RefObject<HTMLInputElement | null>
  qtyInput: 'pad' | 'keyboard'
  onScanChange: (value: string) => void
  onQtyChange: (value: string) => void
  onAdd: () => void
}) {
  // The 'pad' preference now means "keypad already open", not "keypad always visible".
  const [padOpen, setPadOpen] = useState(qtyInput === 'pad')

  return (
    <Card title="Scan barang">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Barcode / Kode Barang" hint="Scan lalu Enter otomatis.">
          <input
            ref={scanRef}
            className={inputClass}
            value={scan}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onAdd()
              }
            }}
            onChange={(event) => onScanChange(event.target.value)}
          />
        </Field>
        <Field label="Qty">
          <input
            className={inputClass}
            inputMode="decimal"
            value={qty}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onQtyChange(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-sm font-semibold text-slate-300">Qty</span>
        <div className="flex flex-1 gap-2">
          {QTY_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              aria-pressed={qty === String(chip)}
              aria-label={`Qty ${chip} satuan PO`}
              className={`touch-target flex-1 rounded-lg px-2 font-semibold transition ${
                qty === String(chip)
                  ? 'bg-cyan-500 text-slate-900'
                  : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
              }`}
              onClick={() => onQtyChange(String(chip))}
            >
              ×{chip}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={padOpen}
          aria-label={padOpen ? 'Tutup keypad angka' : 'Buka keypad angka'}
          className="touch-target w-14 shrink-0 rounded-lg bg-slate-700 font-semibold text-slate-100 transition hover:bg-slate-600"
          onClick={() => setPadOpen((open) => !open)}
        >
          123
        </button>
      </div>
      {padOpen ? (
        <div className="mt-3">
          <NumericPad value={qtyTouched ? qty : ''} onChange={onQtyChange} />
        </div>
      ) : null}
      <Button className="mt-3 w-full" disabled={!scan.trim()} onClick={onAdd}>
        Tambah ke sesi
      </Button>
    </Card>
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
            className={`${inputClass} ${invoiceError ? 'border-red-500' : ''}`}
            value={invoice}
            disabled={!editable}
            onChange={(event) => onInvoiceChange(event.target.value)}
          />
          {invoiceError ? <span className="mt-1 block text-xs text-red-400">Nomor invoice wajib diisi.</span> : null}
        </Field>
        <Field label="Nomor Surat Jalan / DO (wajib)">
          <input
            className={`${inputClass} ${doNumberError ? 'border-red-500' : ''}`}
            value={doNumber}
            disabled={!editable}
            onChange={(event) => onDoNumberChange(event.target.value)}
          />
          {doNumberError ? <span className="mt-1 block text-xs text-red-400">Nomor surat jalan (DO) wajib diisi.</span> : null}
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
        className="absolute inset-0 bg-slate-950/60"
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${itemName}`}
        className="relative rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-[env(safe-area-inset-bottom)]"
        onKeyDown={handleKeyDown}
      >
        <p className="text-lg font-bold text-slate-100">{itemName}</p>
        <p className="text-sm text-slate-400">
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
            className={`${inputClass} text-center text-xl font-bold tabular-nums`}
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
        <p className="mt-2 text-sm tabular-nums text-slate-300">
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
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <button
        type="button"
        aria-label="Batal finalisasi"
        className="absolute inset-0 bg-slate-950/60"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Konfirmasi selesaikan sesi"
        className="relative w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4"
        onKeyDown={handleKeyDown}
      >
        <p className="text-lg font-bold text-slate-100">Selesaikan sesi?</p>
        <div className="mt-3 flex flex-col gap-1 text-sm text-slate-300">
          <p>PO: {purchaseLabel}</p>
          <p>Invoice: {invoice}</p>
          <p>DO: {doNumber}</p>
          <p>Item: {itemCount}</p>
        </div>
        <p className="mt-2 text-xs text-slate-400">Setelah diselesaikan, sesi tidak bisa diubah lagi.</p>
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
  const tabClass = (active: boolean): string =>
    `touch-target flex-1 rounded-lg px-2 text-sm font-semibold transition ${
      active ? 'bg-cyan-500 text-slate-900' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
    }`

  return (
    <div role="tablist" aria-label="Bagian sesi penerimaan" className="flex gap-2">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'scan'}
        className={tabClass(value === 'scan')}
        onClick={() => onChange('scan')}
      >
        Scan
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'items'}
        className={tabClass(value === 'items')}
        onClick={() => onChange('items')}
      >
        Item ({itemCount})
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'docs'}
        className={tabClass(value === 'docs')}
        onClick={() => onChange('docs')}
      >
        <span className="inline-flex items-center gap-1.5">
          Dokumen
          {docsComplete ? null : (
            <span
              aria-label="belum lengkap"
              className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400"
            />
          )}
        </span>
      </button>
    </div>
  )
}

