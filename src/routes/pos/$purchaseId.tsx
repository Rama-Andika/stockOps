import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useAppStore } from '~/client/state/store/app-store'
import { useLive } from '~/client/hooks/use-live'
import { Badge, Button, Card, EmptyState, Loading, Notice, Progress } from '~/components/ui'
import { PROGRESS_LABEL, type ProgressStatus } from '~/shared/constants'
import { formatDate, formatQty } from '~/shared/format'

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
  const unitMap = new Map(unitRows.map((row) => [row.uomId, row.unit]))

  if (!detail) return <Loading label="Memuat detail PO…" />
  if (!detail.purchase) {
    return (
      <Card title="PO tidak ditemukan">
        <EmptyState>PO ini tidak ada di data lokal. Unduh ulang data saat online.</EmptyState>
      </Card>
    )
  }

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
      <Card title={detail.purchase.number ?? purchaseId}>
        <p className="text-slate-300">{detail.purchase.vendorName}</p>
        <p className="text-sm text-slate-400">Tanggal PO: {formatDate(detail.purchase.purchDate)}</p>
        <div className="mt-3 flex items-center gap-3">
          <Badge tone={toneFor(detail.progress.progress)}>{PROGRESS_LABEL[detail.progress.progress]}</Badge>
          <span className="text-sm text-slate-300">
            {formatQty(detail.progress.totalReceivedTotal)} / {formatQty(detail.progress.orderedTotal)}
          </span>
        </div>
        <div className="mt-2">
          <Progress value={detail.progress.totalReceivedTotal} max={detail.progress.orderedTotal} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Angka sisa bersifat perkiraan lokal; angka resmi dihitung server saat sinkronisasi.
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
              <p className="text-sm text-slate-300">
                Dipesan {formatQty(row.orderedQty)} • Diterima {formatQty(row.totalReceivedQty)}
                {row.localPendingQty > 0 ? ` (termasuk ${formatQty(row.localPendingQty)} belum terkirim)` : ''}
              </p>
            </li>
          ))}
          {detail.items.length === 0 ? <EmptyState>Tidak ada item pada PO ini.</EmptyState> : null}
        </ul>
      </Card>

      <Button className="w-full" disabled={busy} onClick={() => void startReception()}>
        {busy ? 'Menyiapkan…' : 'Mulai Penerimaan'}
      </Button>

      <Notice tone="info">
        Satu sesi = satu dokumen penerimaan. Sesi bisa dijeda dan dilanjutkan kapan saja.
      </Notice>
    </div>
  )
}
