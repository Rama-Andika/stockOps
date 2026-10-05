import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useAppStore } from '~/client/state/store/app-store'
import { useLive } from '~/client/hooks/use-live'
import { AppBar } from '~/components/app-bar'
import { SegmentedProgress } from '~/components/segmented-progress'
import { Badge, Button, Card, EmptyState, Loading, Notice } from '~/components/ui'
import { PROGRESS_LABEL, type ProgressStatus } from '~/shared/constants'
import { formatDate } from '~/shared/format'

export const Route = createFileRoute('/pos/$purchaseId')({
  component: PosDetailPage,
})

function toneFor(progress: ProgressStatus): 'neutral' | 'info' | 'success' | 'danger' {
  if (progress === 'FULL') return 'success'
  if (progress === 'OVER') return 'danger'
  if (progress === 'PARTIAL') return 'info'
  return 'neutral'
}

function PosDetailPage() {
  const { purchaseId } = Route.useParams()
  const user = useAppStore((state) => state.user)
  const deviceId = useAppStore((state) => state.deviceId)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const detail = useLive(() => localRepo.getPurchaseDetail(purchaseId), [purchaseId], undefined)
  const unitRows = useLive(() => localRepo.db.units.toArray(), [], [])
  const unitMap = useMemo(() => new Map(unitRows.map((row) => [row.uomId, row.unit])), [unitRows])

  if (!detail) return <Loading label="Memuat detail PO…" />
  if (!detail.purchase) {
    return (
      <Card title="PO tidak ditemukan">
        <EmptyState>PO ini tidak ada di data lokal. Unduh ulang data saat online.</EmptyState>
      </Card>
    )
  }

  const allItemsFull =
    detail.items.length > 0 &&
    detail.items.every(
      (row) =>
        Number.isFinite(row.totalReceivedQty) &&
        Number.isFinite(row.orderedQty) &&
        row.totalReceivedQty >= row.orderedQty,
    )

  const startReception = async () => {
    if (!user) return
    const device = deviceId ?? (await localRepo.ensureDeviceId())
    setBusy(true)
    try {
      const session = await localRepo.createSession({
        purchaseId,
        userId: user.userId,
        deviceId: device,
      })
      void navigate({ to: '/sessions/$sessionId', params: { sessionId: session.sessionId } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <AppBar
        title={detail.purchase.number ?? purchaseId}
        backTo="/pos"
        backLabel="Kembali ke daftar PO"
        actions={<Badge tone={toneFor(detail.progress.progress)}>{PROGRESS_LABEL[detail.progress.progress]}</Badge>}
      />
      <Card title={detail.purchase.vendorName}>
        <p className="text-sm text-slate-400">Tanggal PO: {formatDate(detail.purchase.purchDate)}</p>
        <div className="mt-3">
          <SegmentedProgress
            ordered={detail.progress.orderedTotal}
            serverReceived={detail.progress.serverReceivedTotal}
            localPending={detail.progress.localPendingTotal}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Angka ini dihitung di perangkat. Jumlah resmi mengikuti server setelah dokumen terkirim.
        </p>
      </Card>

      <Card title="Item PO">
        <ul className="flex flex-col divide-y divide-slate-800">
          {detail.items.map((row) => (
            <li key={row.purchaseItemId} className="flex flex-col gap-1 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-100">{row.item?.name ?? row.itemMasterId}</p>
                  <p className="text-sm text-slate-400">
                    {row.item?.code ?? '-'} • {unitMap.get(row.uomId) ?? row.uomId}
                  </p>
                </div>
                <Badge tone={toneFor(row.progress)}>{PROGRESS_LABEL[row.progress]}</Badge>
              </div>
              <SegmentedProgress
                ordered={row.orderedQty}
                serverReceived={row.serverReceivedQty}
                localPending={row.localPendingQty}
                unit={unitMap.get(row.uomId) ?? ''}
              />
            </li>
          ))}
          {detail.items.length === 0 ? <EmptyState>Tidak ada item pada PO ini.</EmptyState> : null}
        </ul>
      </Card>

      <Button className="w-full" disabled={busy || allItemsFull} onClick={() => void startReception()}>
        {busy ? 'Menyiapkan…' : allItemsFull ? 'Semua item sudah diterima penuh' : 'Mulai Penerimaan'}
      </Button>
      {allItemsFull ? (
        <Notice tone="warn">Semua item sudah diterima penuh — tidak bisa memulai penerimaan baru.</Notice>
      ) : null}

      <Notice tone="info">Sesi bisa dijeda dan dilanjutkan kapan saja.</Notice>
    </div>
  )
}
