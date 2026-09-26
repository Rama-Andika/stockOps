import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { localRepo, useApp } from '~/client/state/app-context'
import { useLive } from '~/client/hooks/use-live'
import { Badge, Button, Card, EmptyState, Notice } from '~/components/ui'
import { formatDateTime } from '~/shared/format'
import { isCredentialExpired, remainingDays } from '~/client/auth/offline-auth'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(1)} ${units[index]}`
}

function SettingsPage() {
  const {
    online,
    downloadData,
    pulling,
    lastPullAt,
    refreshPurchasesNow,
    logout,
    credentials,
    refreshState,
    deviceId,
  } = useApp()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)

  const counts = useLive(() => localRepo.masterCounts(), [], {})
  const sessionCount = useLive(() => localRepo.db.sessions.count(), [], 0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return
      const estimate = await navigator.storage.estimate()
      if (!cancelled) {
        setUsage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [counts])

  const handleDownload = async () => {
    const result = await downloadData()
    setMessage({ tone: result.ok ? 'success' : 'danger', text: result.message })
  }

  const handleRefreshPo = async () => {
    const result = await refreshPurchasesNow()
    setMessage({ tone: result.ok ? 'success' : 'danger', text: result.message })
  }

  const handleCleanup = async () => {
    const removed = await localRepo.deleteSyncedSessions()
    await refreshState()
    setMessage({ tone: 'info', text: `${removed} sesi tersinkron dibersihkan. Data master dipertahankan.` })
  }

  return (
    <div className="flex flex-col gap-3">
      <Card title="Data Lokal">
        <dl className="grid grid-cols-2 gap-2 text-sm text-slate-300">
          <dt>PO</dt>
          <dd>{counts.purchases ?? 0}</dd>
          <dt>Item PO</dt>
          <dd>{counts.purchaseItems ?? 0}</dd>
          <dt>Master barang</dt>
          <dd>{counts.items ?? 0}</dd>
          <dt>Satuan</dt>
          <dd>{counts.units ?? 0}</dd>
          <dt>Vendor</dt>
          <dd>{counts.vendors ?? 0}</dd>
          <dt>Vendor item</dt>
          <dd>{counts.vendorItems ?? 0}</dd>
          <dt>Sesi tersimpan</dt>
          <dd>{sessionCount}</dd>
          <dt>Pemakaian penyimpanan</dt>
          <dd>{formatBytes(usage?.usage)}</dd>
        </dl>
        <p className="mt-2 text-xs text-slate-500">Unduh terakhir: {formatDateTime(lastPullAt)}</p>
      </Card>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Card title="Sinkronisasi Data">
        <div className="flex flex-col gap-2">
          <Button disabled={!online || pulling.running} onClick={() => void handleDownload()}>
            {pulling.running ? 'Mengunduh…' : 'Unduh Ulang Data (PO & Master)'}
          </Button>
          {pulling.running ? (
            <p className="text-sm text-slate-400">
              {pulling.kind}: {pulling.fetched}
              {pulling.total ? ` / ${pulling.total}` : ''}
            </p>
          ) : null}
          <Button variant="secondary" disabled={!online} onClick={() => void handleRefreshPo()}>
            Segarkan Daftar PO
          </Button>
          <Button variant="secondary" onClick={() => void handleCleanup()}>
            Bersihkan Sesi Tersinkron
          </Button>
        </div>
      </Card>

      <Card title="Kredensial Offline (per perangkat)">
        {credentials.length === 0 ? (
          <EmptyState>Belum ada kredensial tersimpan.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-800">
            {credentials.map((credential) => {
              const expired = isCredentialExpired(credential, new Date())
              const days = remainingDays(credential, new Date())
              return (
                <li key={credential.key} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-semibold text-slate-100">{credential.fullName}</p>
                    <p className="text-sm text-slate-400">{credential.loginId}</p>
                  </div>
                  <Badge tone={expired ? 'danger' : days <= 2 ? 'warn' : 'success'}>
                    {expired ? 'Kedaluwarsa' : `${days} hari`}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Password tidak disimpan sebagai teks biasa — hanya hash bersalt. Perubahan kredensial di pusat akan dicabut
          pada sinkronisasi berikutnya.
        </p>
      </Card>

      <Card title="Perangkat & Sesi">
        <p className="text-sm text-slate-400">Device ID: {deviceId ?? '-'}</p>
        <Button variant="danger" className="mt-3 w-full" onClick={() => void logout()}>
          Logout
        </Button>
      </Card>
    </div>
  )
}
