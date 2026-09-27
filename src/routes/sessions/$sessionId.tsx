import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useAppStore } from '~/client/state/store/app-store'
import { useLive } from '~/client/hooks/use-live'
import { addScannedItem } from '~/client/services/scanning'
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
  const [notice, setNotice] = useState<{ tone: 'success' | 'warn' | 'danger' | 'info'; text: string } | null>(null)
  const [invoice, setInvoice] = useState('')
  const [doNumber, setDoNumber] = useState('')
  const scanRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (session) {
      setInvoice(session.invoiceNumber)
      setDoNumber(session.doNumber)
    }
  }, [session?.sessionId, session?.invoiceNumber, session?.doNumber, session])

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

  const handleAdd = async () => {
    if (!scan.trim()) return
    const result = await addScannedItem(
      localRepo,
      session.sessionId,
      session.purchaseId,
      scan.trim(),
      Number(qty),
    )
    if (result.ok) {
      setNotice({ tone: 'success', text: `Ditambahkan: ${result.message}` })
      setScan('')
      setQty('1')
      scanRef.current?.focus()
    } else {
      setNotice({
        tone: result.resolution.status === 'ITEM_NOT_FOUND' ? 'danger' : 'warn',
        text: result.message,
      })
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
          scanRef={scanRef}
          onScanChange={setScan}
          onQtyChange={setQty}
          onAdd={() => void handleAdd()}
        />
      ) : null}

      <Card title={`Item dalam Sesi (${lines.length})`}>
        <ul className="flex flex-col divide-y divide-slate-800">
          {lines.map((line) => {
            const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
            const item = items[line.itemMasterId]
            const isOver = totalOver.some((row) => row.lineId === line.lineId)
            return (
              <li key={line.lineId} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-100">{item?.name ?? line.itemMasterId}</p>
                    <p className="text-sm text-slate-400">
                      {item?.code ?? '-'} • {unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId}
                      {line.convFound ? '' : ' • konversi tidak ditemukan (faktor 1)'}
                    </p>
                  </div>
                  {isOver ? <Badge tone="danger">Over-receive</Badge> : null}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    className={`${inputClass} max-w-35`}
                    inputMode="decimal"
                    aria-label={`Qty ${item?.name ?? line.itemMasterId}`}
                    value={String(line.qty)}
                    disabled={!editable}
                    onChange={(event) => {
                      const raw = event.target.value
                      if (raw.trim() === '') return
                      const parsed = Number(raw)
                      if (!Number.isFinite(parsed) || parsed <= 0) return
                      void localRepo.setLineQty(line.lineId, parsed)
                    }}
                  />
                  <span className="text-slate-400">
                    → {formatQty(line.qty * line.convQty)}{' '}
                    {unitMap.get(line.uomId) ?? line.uomId}
                  </span>
                  {editable ? (
                    <Button
                      variant="danger"
                      className="!px-3 !py-2 text-sm"
                      onClick={() => void localRepo.removeLine(line.lineId)}
                    >
                      Hapus
                    </Button>
                  ) : null}
                </div>
                {purchaseItem ? (
                  <p className="text-xs text-slate-500">
                    Dipesan {formatQty(purchaseItem.qty)} {unitMap.get(purchaseItem.uomId) ?? ''}
                  </p>
                ) : null}
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
          <Button variant="danger" className="w-full" onClick={() => void handleCancel()}>
            Batalkan Sesi
          </Button>
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
              <Button variant="danger" className="w-full" onClick={() => void handleCancel()}>
                Hapus Sesi
              </Button>
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
  )
}

function ScanCard({
  scan,
  qty,
  scanRef,
  onScanChange,
  onQtyChange,
  onAdd,
}: {
  scan: string
  qty: string
  scanRef: RefObject<HTMLInputElement | null>
  onScanChange: (value: string) => void
  onQtyChange: (value: string) => void
  onAdd: () => void
}) {
  return (
    <Card title="Scan Barang">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Barcode / Kode Barang" hint="Scanner PDT mengisi field ini lalu menekan Enter otomatis.">
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
            onChange={(event) => onQtyChange(event.target.value)}
          />
        </Field>
      </div>
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
