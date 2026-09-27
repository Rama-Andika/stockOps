import { createFileRoute, Link } from '@tanstack/react-router'
import { localRepo } from '~/client/db/local-repo'
import { useAppStore } from '~/client/state/store/app-store'
import { useLive } from '~/client/hooks/use-live'
import { Badge, Button, Card, EmptyState } from '~/components/ui'
import { SESSION_STATUS_LABEL, type SessionStatus } from '~/shared/constants'
import { formatDateTime } from '~/shared/format'

export const Route = createFileRoute('/sessions/')({
  component: SessionsPage,
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

function SessionsPage() {
  const sync = useAppStore((state) => state.sync)
  const syncing = useAppStore((state) => state.syncing)
  const online = useAppStore((state) => state.online)
  const sessions = useLive(() => localRepo.listSessions(), [], [])

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="Sesi Penerimaan"
        actions={
          <Button className="!px-3 !py-2 text-sm" disabled={!online || syncing} onClick={() => void sync()}>
            {syncing ? 'Mengirim…' : 'Sinkronkan'}
          </Button>
        }
      >
        <p className="text-sm text-slate-400">Pantau status dan tindakan sesi pada daftar.</p>
      </Card>

      {sessions.length === 0 ? (
        <Card>
          <EmptyState>Belum ada sesi penerimaan.</EmptyState>
        </Card>
      ) : null}

      {sessions.map((session) => {
        return (
          <Card key={session.sessionId}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-lg font-bold text-slate-100">
                  {session.number ?? 'ID sementara'}
                </p>
                <p className="text-slate-300">
                  {session.purchaseNumber ?? session.purchaseId} • {session.vendorName ?? '-'}
                </p>
                <p className="text-sm text-slate-400">
                  {session.syncedAt
                    ? `Tersinkron ${formatDateTime(session.syncedAt)}`
                    : `Dibuat ${formatDateTime(session.createdAt)}`}
                </p>
                {session.lastError ? (
                  <p className="text-sm text-red-300">Error: {session.lastError}</p>
                ) : null}
              </div>
              <Badge tone={toneFor(session.status)}>{SESSION_STATUS_LABEL[session.status]}</Badge>
            </div>
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: session.sessionId }}
              className="touch-target mt-3 flex w-full items-center justify-center rounded-lg bg-slate-700 px-5 py-3 font-semibold text-slate-100 transition hover:bg-slate-600"
            >
              Buka Sesi
            </Link>
          </Card>
        )
      })}
    </div>
  )
}
