import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useAppStore } from '~/client/state/store/app-store'
import { useLive } from '~/client/hooks/use-live'
import { addScannedItem } from '~/client/services/scanning'
import type { LocalSessionItem } from '~/client/db/local-db'
import { loadPreferences, type Preferences } from '~/client/preferences'
import { playFeedback } from '~/client/feedback'
import { ConfirmButton } from '~/components/confirm-button'
import { NumericPad } from '~/components/numeric-pad'
import { ScanFeedback, type ScanFeedbackData } from '~/components/scan-feedback'
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

function SessionDetailPage() {
  const { sessionId } = Route.useParams()
  const sync = useAppStore((state) => state.sync)
  const syncing = useAppStore((state) => state.syncing)
  const online = useAppStore((state) => state.online)
  const navigate = useNavigate()

  const session = useLive(() => localRepo.getSession(sessionId), [sessionId], undefined)
  const lines = useLive(() => localRepo.sessionItems(sessionId), [sessionId], [])
  const purchase = useLive(
    async () => {
      const current = await localRepo.getSession(sessionId)
      return current ? localRepo.getPurchase(current.purchaseId) : undefined
    },
    [sessionId],
    undefined,
  )
  const purchaseItems = useLive(
    async () => {
      const current = await localRepo.getSession(sessionId)
      return current ? localRepo.getPurchaseItems(current.purchaseId) : []
    },
    [sessionId],
    [],
  )
  const items = useLive(
    async () => {
      const sessionLines = await localRepo.sessionItems(sessionId)
      const ids = [...new Set(sessionLines.map((line) => line.itemMasterId))]
      const entries = await Promise.all(
        ids.map(async (id) => [id, await localRepo.getItemMaster(id)] as const),
      )
      return Object.fromEntries(entries) as Record<string, { name: string; code: string | null } | undefined>
    },
    [sessionId, lines.length],
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
  const [notice, setNotice] = useState<{ tone: 'success' | 'warn' | 'danger' | 'info'; text: string } | null>(null)
  const [scanFeedback, setScanFeedback] = useState<ScanFeedbackData | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<Preferences>({
    qtyInput: 'pad',
    feedbackBeep: true,
    feedbackVibrate: true,
  })
  const [invoice, setInvoice] = useState('')
  const [doNumber, setDoNumber] = useState('')
  const scanRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (session) {
      setInvoice(session.invoiceNumber)
      setDoNumber(session.doNumber)
    }
  }, [session?.sessionId, session?.invoiceNumber, session?.doNumber, session])

  useEffect(() => {
    setPreferences(loadPreferences())
  }, [])

  useEffect(() => {
    if (session?.status !== SESSION_STATUS.RUNNING || editingLineId) return
    const frame = window.requestAnimationFrame(() => scanRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [session?.status, editingLineId])

  const dismissScanFeedback = useCallback(() => setScanFeedback(null), [])

  if (!session) return <Loading label="Memuat sesi…" />

  const editable = session.status === SESSION_STATUS.RUNNING
  const totalOver = lines.filter((line) => {
    const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
    if (!purchaseItem) return false
    const received = Number(purchaseItem.receivedQty ?? 0)
    const localQty = lines
      .filter((other) => other.purchaseItemId === line.purchaseItemId)
      .reduce((acc, other) => acc + other.qty, 0)
    return received + localQty > Number(purchaseItem.qty ?? 0)
  })
  const editingLine = editingLineId
    ? (lines.find((line) => line.lineId === editingLineId) ?? null)
    : null
  const editingPurchaseItem = editingLine
    ? purchaseItemMap.get(editingLine.purchaseItemId)
    : undefined
  const editingItem = editingLine ? items[editingLine.itemMasterId] : undefined

  const handleAdd = async () => {
    if (!scan.trim()) return
    try {
      const result = await addScannedItem(
        localRepo,
        session.sessionId,
        session.purchaseId,
        scan.trim(),
        Number(qty),
      )
      if (result.ok) {
        const text = `Ditambahkan: ${result.message} × ${formatQty(qty)}`
        setScanFeedback({ tone: 'success', text, key: Date.now() })
        playFeedback('success')
        setScan('')
        setQty('1')
        setQtyTouched(false)
        scanRef.current?.focus()
      } else {
        const tone = result.resolution.status === 'ITEM_NOT_FOUND' ? 'danger' : 'warn'
        setScanFeedback({ tone, text: result.message, key: Date.now() })
        playFeedback(tone)
        // Scanner mengirim karakter seperti keyboard; selalu kosongkan field agar
        // scan berikutnya tidak tertempel pada barcode yang ditolak.
        setScan('')
        scanRef.current?.focus()
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Gagal menyimpan hasil scan.'
      setScanFeedback({ tone: 'danger', text, key: Date.now() })
      playFeedback('danger')
      setScan('')
      scanRef.current?.focus()
    }
  }

  const handleFinalize = async () => {
    if (!invoice.trim() || !doNumber.trim()) {
      setNotice({ tone: 'danger', text: 'Nomor invoice dan nomor DO wajib diisi.' })
      return
    }
    if (lines.length === 0) {
      setNotice({ tone: 'danger', text: 'Belum ada item yang discan.' })
      return
    }
    await localRepo.updateSessionDraft(session.sessionId, {
      invoiceNumber: invoice.trim(),
      doNumber: doNumber.trim(),
    })
    await localRepo.finalizeSession(session.sessionId, {
      invoiceNumber: invoice.trim(),
      doNumber: doNumber.trim(),
      receiveDate: session.receiveDate || toLocalDateTime(new Date()),
    })
    setNotice({ tone: 'info', text: 'Sesi difinalisasi & masuk antrian sinkronisasi.' })
    await sync()
  }

  const handleCancel = async () => {
    await localRepo.deleteSession(session.sessionId)
    void navigate({ to: '/sessions' })
  }

  return (
    <div className="flex flex-col gap-3">
      <ScanFeedback feedback={scanFeedback} onDismiss={dismissScanFeedback} />
      <Card
        title={session.number ?? 'Sesi Baru'}
        actions={<Badge tone={toneFor(session.status)}>{SESSION_STATUS_LABEL[session.status]}</Badge>}
      >
        <p className="text-slate-300">
          {purchase?.number ?? session.purchaseId} • {purchase?.vendorName ?? '-'}
        </p>
        {session.receiveDate ? (
          <p className="text-sm text-slate-400">Tanggal penerimaan: {session.receiveDate}</p>
        ) : null}
        {session.overReceive ? (
          <p className="mt-2 text-sm text-amber-300">
            Terdapat kelebihan terima {formatQty(session.excessTotal)} — menunggu persetujuan admin.
          </p>
        ) : null}
      </Card>

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      {editable ? (
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

      <Card title={`Item dalam Sesi (${lines.length})`}>
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
                        <p className="text-xs text-slate-500">
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

      <VendorDocCard
        invoice={invoice}
        doNumber={doNumber}
        editable={editable}
        onInvoiceChange={setInvoice}
        onDoNumberChange={setDoNumber}
      />

      {editable ? (
        <div className="flex flex-col gap-2">
          <Button className="w-full" onClick={() => void handleFinalize()}>
            Selesai / Finalisasi
          </Button>
          <ConfirmButton
            tone="danger"
            className="w-full"
            label="Tahan 1,5 dtk: Batalkan Sesi"
            confirmLabel="Tahan… sesi akan dibatalkan"
            onConfirm={() => void handleCancel()}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {session.status === SESSION_STATUS.PENDING || session.status === SESSION_STATUS.FAILED ? (
            <>
              {session.lastError ? <Notice tone="danger">{session.lastError}</Notice> : null}
              <Button className="w-full" disabled={!online || syncing} onClick={() => void sync()}>
                {syncing ? 'Mengirim…' : 'Sinkronkan Sekarang'}
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
                label="Tahan 1,5 dtk: Hapus Sesi"
                confirmLabel="Tahan… sesi akan dihapus"
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
    </div>
  )
}

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
  return (
    <Card title="Scan Barang">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Barcode / Kode Barang" hint="Scan lalu Enter otomatis.">
          <input
            ref={scanRef}
            className={inputClass}
            value={scan}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onAdd()
              }
            }}
            onChange={(event) => onScanChange(event.target.value)}
          />
        </Field>
        <Field label="Qty (satuan PO)">
          <input
            className={inputClass}
            inputMode="decimal"
            value={qty}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onQtyChange(event.target.value)}
          />
        </Field>
      </div>
      {qtyInput === 'pad' ? (
        <div className="mt-3">
          <NumericPad
            value={qtyTouched ? qty : ''}
            onChange={(value) => {
              onQtyChange(value)
              // Kembalikan fokus ke scanner agar scan berikutnya langsung diterima.
              window.setTimeout(() => scanRef.current?.focus(), 0)
            }}
          />
        </div>
      ) : null}
      <Button className="mt-3 w-full" disabled={!scan.trim()} onClick={onAdd}>
        Tambah ke Sesi
      </Button>
    </Card>
  )
}

function VendorDocCard({
  invoice,
  doNumber,
  editable,
  onInvoiceChange,
  onDoNumberChange,
}: {
  invoice: string
  doNumber: string
  editable: boolean
  onInvoiceChange: (value: string) => void
  onDoNumberChange: (value: string) => void
}) {
  return (
    <Card title="Dokumen Vendor">
      <div className="flex flex-col gap-3">
        <Field label="Nomor Invoice (wajib)">
          <input
            className={inputClass}
            value={invoice}
            disabled={!editable}
            onChange={(event) => onInvoiceChange(event.target.value)}
          />
        </Field>
        <Field label="Nomor Surat Jalan / DO (wajib)">
          <input
            className={inputClass}
            value={doNumber}
            disabled={!editable}
            onChange={(event) => onDoNumberChange(event.target.value)}
          />
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

  useEffect(() => {
    setDraftQty(String(line.qty))
  }, [line.lineId, line.qty])

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

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-slate-950/60"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${itemName}`}
        className="rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-[env(safe-area-inset-bottom)]"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-lg font-bold text-slate-100">{itemName}</p>
        <p className="text-sm text-slate-400">
          {orderedText} • 1 {purchaseUnit} = {formatQty(line.convQty)} {stockUnit}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="secondary"
            className="!px-5 !py-3 text-xl"
            aria-label="Kurangi qty satu satuan PO"
            onClick={() => step(-1)}
          >
            −1
          </Button>
          <input
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
            className="!px-5 !py-3 text-xl"
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
            label="Tahan 1,5 dtk: Hapus Item"
            confirmLabel="Tahan… item akan dihapus"
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
