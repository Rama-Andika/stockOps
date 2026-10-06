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
import { isOwnedBy, ownerName } from '~/shared/session-owner'

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
  // Device-wide here, filtered to this PO further down. Called next to the other live queries
  // because the two early returns below must not sit between a hook and its siblings.
  const runningSessions = useLive(() => localRepo.runningSessions(), [], [])
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

  // Other operators' RUNNING sessions for THIS PO. Their scanned qty is already inside
  // `localPendingQty` — `getPurchaseDetail` counts every session that is neither SYNCED nor
  // REJECTED — so it moves the meters above and can even make `allItemsFull` true while nothing
  // has reached the server. Naming the owner turns that into something the operator can act on
  // instead of a number that does not match the paperwork in their hand.
  const foreignRunning = runningSessions.filter(
    (row) => row.purchaseId === purchaseId && !isOwnedBy(row, user?.userId ?? null),
  )
  let foreignOwnerLabel: string | null = null
  const firstForeign = foreignRunning[0]
  if (firstForeign) {
    const extra = foreignRunning.length - 1
    // "(+N sesi lain)", not "+N operator lain": several of them can belong to one operator.
    foreignOwnerLabel =
      extra > 0 ? `${ownerName(firstForeign)} (+${extra} sesi lain)` : ownerName(firstForeign)
  }

  const startReception = async () => {
    if (!user) return
    const device = deviceId ?? (await localRepo.ensureDeviceId())
    setBusy(true)
    try {
      const session = await localRepo.createSession({
        purchaseId,
        userId: user.userId,
        // Denormalized once, never refreshed: the document should name the operator as they were
        // when the goods were received, and the credential this comes from can be revoked by the
        // admin and deleted from the device (`removeCredentialsForUsers`).
        userFullName: user.fullName,
        userLoginId: user.loginId,
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
        <p className="text-sm text-fg-subtle">Tanggal PO: {formatDate(detail.purchase.purchDate)}</p>
        <div className="mt-3">
          <SegmentedProgress
            ordered={detail.progress.orderedTotal}
            serverReceived={detail.progress.serverReceivedTotal}
            localPending={detail.progress.localPendingTotal}
          />
        </div>
        <p className="mt-2 text-xs text-fg-subtle">
          Angka ini dihitung di perangkat. Jumlah resmi mengikuti server setelah dokumen terkirim.
        </p>
      </Card>

      <Card title="Item PO">
        <ul className="flex flex-col divide-y divide-line-soft">
          {detail.items.map((row) => (
            <li key={row.purchaseItemId} className="flex flex-col gap-1 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-fg">{row.item?.name ?? row.itemMasterId}</p>
                  <p className="text-sm text-fg-subtle">
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

      {foreignOwnerLabel ? (
        <div className="mb-2">
          <Notice tone="warn">
            {foreignOwnerLabel} sedang menerima PO ini di perangkat ini dan sesinya belum dikirim.
            Qty-nya sudah ikut dihitung pada angka di atas. Kamu masih boleh memulai penerimaan
            sendiri — pastikan tidak menghitung barang yang sama dua kali.
          </Notice>
        </div>
      ) : null}

      {allItemsFull ? (
        <Notice tone="warn">
          Semua item sudah diterima penuh — tidak bisa memulai penerimaan baru.
          {foreignOwnerLabel
            ? ` Angka itu termasuk sesi berjalan milik ${foreignOwnerLabel} yang belum dikirim, jadi belum tentu sudah masuk sistem.`
            : ''}
        </Notice>
      ) : (
        <Notice tone="info">Sesi bisa dijeda dan dilanjutkan kapan saja.</Notice>
      )}

      {/* The primary action stays reachable on a PO with twenty lines: it sticks to the bottom of
          the scroll container instead of sitting at the end of the list. */}
      <div className="sticky bottom-0 -mx-3 border-t border-line bg-chrome/95 px-3 py-2 backdrop-blur">
        <Button className="w-full" disabled={busy || allItemsFull} onClick={() => void startReception()}>
          {busy ? 'Menyiapkan…' : allItemsFull ? 'Semua item sudah diterima penuh' : 'Mulai Penerimaan'}
        </Button>
      </div>
    </div>
  )
}
