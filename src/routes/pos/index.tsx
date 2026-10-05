import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useLive } from '~/client/hooks/use-live'
import { Badge, Card, EmptyState, Progress, inputClass } from '~/components/ui'
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
          <EmptyState>
            Belum ada data PO di perangkat ini. Buka <strong>Pengaturan → Unduh Data</strong> saat online.
          </EmptyState>
        </Card>
      ) : null}

      {filtered.map((row) => (
        <Card key={row.purchaseId}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
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

          <Link
            to="/pos/$purchaseId"
            params={{ purchaseId: row.purchaseId }}
            className="touch-target mt-3 flex w-full items-center justify-center rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-900 transition hover:bg-cyan-400"
          >
            Buka Detail PO
          </Link>
        </Card>
      ))}
    </div>
  )
}
