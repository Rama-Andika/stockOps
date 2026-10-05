import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useLive } from '~/client/hooks/use-live'
import { useAppStore } from '~/client/state/store/app-store'
import { toast } from '~/client/toast'
import { Badge, Button, Card, EmptyState, Progress, inputClass } from '~/components/ui'
import { PROGRESS_LABEL, type ProgressStatus } from '~/shared/constants'
import { formatDate, formatQty } from '~/shared/format'

export const Route = createFileRoute('/pos/')({
  component: PosListPage,
})

function toneFor(progress: ProgressStatus): 'neutral' | 'info' | 'success' | 'danger' {
  if (progress === 'FULL') return 'success'
  if (progress === 'OVER') return 'danger'
  if (progress === 'PARTIAL') return 'info'
  return 'neutral'
}

function PosListPage() {
  const [term, setTerm] = useState('')
  const summaries = useLive(() => localRepo.listPurchaseSummaries(), [], [])
  const online = useAppStore((state) => state.online)
  const pullProgress = useAppStore((state) => state.pullProgress)
  const downloadData = useAppStore((state) => state.downloadData)

  const handleDownload = async () => {
    const result = await downloadData()
    toast(result.ok ? 'success' : 'danger', result.message)
  }

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase()
    const list = [...summaries].sort((a, b) => {
      const timeA = a.purchDate ? new Date(a.purchDate.replace(' ', 'T')).getTime() || 0 : 0
      const timeB = b.purchDate ? new Date(b.purchDate.replace(' ', 'T')).getTime() || 0 : 0
      if (timeB !== timeA) return timeB - timeA
      return (b.number ?? '').localeCompare(a.number ?? '')
    })
    if (!needle) return list
    return list.filter(
      (row) =>
        (row.number ?? '').toLowerCase().includes(needle) ||
        row.vendorName.toLowerCase().includes(needle),
    )
  }, [summaries, term])

  return (
    <div className="flex flex-col gap-3">
      <Card title="Daftar PO (CHECKED)">
        <input
          className={inputClass}
          aria-label="Cari PO"
          placeholder="Cari nomor PO atau vendor…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </Card>

      {summaries.length === 0 ? (
        <Card>
          <EmptyState>Belum ada data PO di perangkat ini.</EmptyState>
          <Button
            className="w-full"
            disabled={!online || pullProgress.running}
            onClick={() => void handleDownload()}
          >
            {pullProgress.running ? 'Mengunduh…' : 'Unduh data sekarang'}
          </Button>
          {online ? null : (
            <p className="mt-2 text-center text-sm text-slate-400">
              Sambungkan perangkat ke jaringan dulu untuk mengunduh data.
            </p>
          )}
        </Card>
      ) : null}

      {filtered.map((row) => (
        <Link
          key={row.purchaseId}
          to="/pos/$purchaseId"
          params={{ purchaseId: row.purchaseId }}
          className="block rounded-xl border border-slate-700 bg-slate-900/60 p-4 transition hover:border-slate-500"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-100">{row.number ?? row.purchaseId}</p>
              <p className="text-slate-300">{row.vendorName}</p>
              <p className="text-sm text-slate-400">{formatDate(row.purchDate)}</p>
            </div>
            <Badge tone={toneFor(row.progress)}>{PROGRESS_LABEL[row.progress]}</Badge>
          </div>

          <div className="mt-3">
            <Progress value={row.totalReceivedTotal} max={row.orderedTotal} />
            <p className="mt-1 text-sm tabular-nums text-slate-400">
              Diterima {formatQty(row.totalReceivedTotal)} dari {formatQty(row.orderedTotal)}
            </p>
          </div>
        </Link>
      ))}
    </div>
  )
}
