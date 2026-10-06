import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { localRepo } from '~/client/db/local-repo'
import { useLive } from '~/client/hooks/use-live'
import { useAppStore } from '~/client/state/store/app-store'
import { toast } from '~/client/toast'
import { SendStatusStrip } from '~/components/send-status-strip'
import { SessionStatusRow } from '~/components/session-status-row'
import { Card, EmptyState } from '~/components/ui'
import { SESSION_STATUS } from '~/shared/constants'

export const Route = createFileRoute('/sessions/')({
  component: SessionsPage,
})

/**
 * One surface for sending: what is still on the device, what the server refused, and every
 * document with a sentence saying what its state means. It replaces a list that showed status
 * badges and nothing else.
 */
function SessionsPage() {
  const online = useAppStore((state) => state.online)
  const syncing = useAppStore((state) => state.syncing)
  const pendingCount = useAppStore((state) => state.pendingCount)
  const sync = useAppStore((state) => state.sync)

  const sessions = useLive(() => localRepo.listSessions(), [], [])
  const itemCounts = useLive(() => localRepo.countItemsBySession(), [], new Map<string, number>())

  const rejectedCount = useMemo(
    () => sessions.filter((session) => session.status === SESSION_STATUS.REJECTED).length,
    [sessions],
  )
  const runningCount = useMemo(
    () => sessions.filter((session) => session.status === SESSION_STATUS.RUNNING).length,
    [sessions],
  )
  // The newest syncedAt across every session, not the time of the last sync ATTEMPT: it answers
  // "when did my work last land", and it needs no new state because every synced session already
  // carries its own timestamp. `listSessions` orders by sequence, which is not the same order.
  const lastSyncedAt = useMemo(() => {
    let newest: string | null = null
    for (const session of sessions) {
      if (session.syncedAt && (newest === null || session.syncedAt > newest)) {
        newest = session.syncedAt
      }
    }
    return newest
  }, [sessions])

  const handleSend = async () => {
    const result = await sync()
    toast(result.ok ? 'success' : online ? 'danger' : 'warn', result.message)
  }

  return (
    <div className="flex flex-col gap-3">
      {rejectedCount > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger-line bg-danger-wash/40 p-3"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-soft" aria-hidden="true" />
          <p className="min-w-0 text-sm text-fg-soft">
            <span className="block font-bold text-danger-soft">
              {rejectedCount} dokumen ditolak server
            </span>
            Dokumen ini tidak bisa dikirim lagi. Buka dokumennya untuk melihat alasannya, lalu
            hapus dari perangkat atau laporkan ke admin.
          </p>
        </div>
      ) : null}

      <SendStatusStrip
        pendingCount={pendingCount}
        syncing={syncing}
        online={online}
        lastSyncedAt={lastSyncedAt}
        onSend={() => void handleSend()}
      />

      {runningCount > 1 ? (
        <p className="text-sm font-semibold text-warn-text">
          {runningCount} sesi masih berjalan. Selesaikan satu per satu.
        </p>
      ) : null}

      {sessions.length === 0 ? (
        <Card>
          <EmptyState>
            Belum ada dokumen penerimaan, silahkan buat dokumen baru dari daftar PO.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((session) => (
            <SessionStatusRow
              key={session.sessionId}
              session={session}
              itemCount={itemCounts.get(session.sessionId) ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
