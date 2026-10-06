import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppBar } from '~/components/app-bar'
import { Card, EmptyState, Loading } from '~/components/ui'
import { formatQty } from '~/shared/format'
import { localRepo } from '~/client/db/local-repo'
import { serverAdminTransport } from '~/client/sync/admin-transport'
import type { OverReceiveWorklistRow } from '~/shared/schemas'

export const Route = createFileRoute('/over-receive')({
  component: OverReceivePage,
})

function OverReceivePage() {
  const [rows, setRows] = useState<OverReceiveWorklistRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cached = await localRepo.listCredentials()
        const credentials = cached.map((credential) => ({
          userId: credential.userId,
          loginId: credential.loginId,
          fingerprint: credential.fingerprint,
        }))
        const data = await serverAdminTransport.overReceiveWorklist({
          limit: 50,
          credentials,
        })
        if (!cancelled) setRows(data)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Gagal memuat data.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <Card title="Kelebihan terima">
        <EmptyState>{error}</EmptyState>
      </Card>
    )
  }
  if (!rows) return <Loading label="Memuat daftar kelebihan terima…" />

  return (
    <div className="flex flex-col gap-3">
      <AppBar title="Kelebihan terima" backTo="/sessions" backLabel="Kembali ke daftar sesi" />
      <Card>
        <p className="text-sm text-fg-subtle">
          Daftar ini dibaca langsung dari server dan butuh koneksi. Hanya untuk melihat; persetujuan
          dilakukan di website admin.
        </p>
      </Card>
      {rows.length === 0 ? (
        <Card>
          <EmptyState>Tidak ada kelebihan terima yang menunggu.</EmptyState>
        </Card>
      ) : null}
      {rows.map((row) => (
        <Card key={row.receiveItemId}>
          <p className="font-semibold text-fg">{row.itemName}</p>
          <p className="text-sm text-fg-subtle">
            {row.purchaseNumber ?? row.purchaseId} · {row.vendorName}
          </p>
          <p className="mt-2 text-sm tabular-nums text-fg-muted">
            {formatQty(row.newTotal)} dari {formatQty(row.orderedQty)} ·{' '}
            <span className="font-semibold text-warn-text">+{formatQty(row.excess)} lebih</span>
          </p>
          <p className="mt-1 text-xs tabular-nums text-fg-subtle">Dokumen {row.number ?? '-'}</p>
        </Card>
      ))}
    </div>
  )
}
