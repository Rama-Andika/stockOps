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
  const runningInfo = useLive(async () => {
    const sessions = await localRepo.runningSessions()
    return Promise.all(
      sessions.map(async (session) => {
        const [purchase, items] = await Promise.all([
          localRepo.getPurchase(session.purchaseId),
          localRepo.sessionItems(session.sessionId),
        ])
        return {
          sessionId: session.sessionId,
          purchaseId: session.purchaseId,
          purchaseNumber: purchase?.number ?? session.purchaseId,
          vendorName: purchase?.vendorName ?? '-',
          itemCount: items.length,
          qtyTotal: items.reduce((acc, line) => acc + line.qty, 0),
        }
      }),
    )
  }, [], [])

  const filtered = useMemo(() => {
    const runningIds = new Set(runningInfo.map((info) => info.purchaseId))
    const sorted = [...summaries].sort((a, b) => {
      const aRunning = runningIds.has(a.purchaseId) ? 0 : 1
      const bRunning = runningIds.has(b.purchaseId) ? 0 : 1
      if (aRunning !== bRunning) return aRunning - bRunning
      return (a.number ?? '').localeCompare(b.number ?? '')
    })
    const needle = term.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter(
      (row) =>
        (row.number ?? '').toLowerCase().includes(needle) ||
        row.vendorName.toLowerCase().includes(needle),
    )
  }, [summaries, term, runningInfo])

  return (
    <div className="flex flex-col gap-3">
      {runningInfo.length > 0 ? (
        <Card title="Sesi Berjalan">
          <ul className="flex flex-col divide-y divide-slate-800">
            {runningInfo.map((info) => (
              <li key={info.sessionId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-100">
                    {info.purchaseNumber} • {info.vendorName}
                  </p>
                  <p className="text-sm tabular-nums text-slate-400">
                    {info.itemCount} item • qty {formatQty(info.qtyTotal)}
                  </p>
                </div>
                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: info.sessionId }}
                  className="touch-target flex shrink-0 items-center justify-center rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-400"
                >
                  Lanjutkan
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

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
