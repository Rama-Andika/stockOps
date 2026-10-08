import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { localRepo } from '~/data/local-repo'
import { useLive } from '~/data/use-live'
import { useAppStore } from '~/app/store/app-store'
import { toast } from '~/platform/toast'
import { SendStatusStrip } from '~/features/sync/send-status-strip'
import { SessionGroupList } from '~/features/receiving/session/session-group-list'
import { Card, EmptyState, Loading } from '~/ui/primitives'
import { SESSION_STATUS } from '~/core/contracts/constants'
import { isOwnedBy } from '~/features/receiving/logic/session-owner'

/**
 * One surface for sending: what is still on the device, what the server refused, and every
 * document with a sentence saying what its state means. It replaces a list that showed status
 * badges and nothing else.
 */
export function SessionList() {
  const online = useAppStore((state) => state.online)
  const user = useAppStore((state) => state.user)
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
  // Kept separate from `runningCount` on purpose. `runningCount` feeds SendStatusStrip, which
  // states a fact about the DEVICE ("1 sesi masih berjalan … belum dikirim") and is right to
  // count everybody's. The line below the strip speaks TO the operator ("selesaikan satu per
  // satu") and would be an instruction they cannot follow if it counted sessions they are not
  // allowed to finish.
  const myRunningCount = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.status === SESSION_STATUS.RUNNING && isOwnedBy(session, user?.userId ?? null),
      ).length,
    [sessions, user?.userId],
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

  // Same window the cockpit and the review screen guard: with no logged-in user the shell is one
  // effect away from redirecting to /login (app/shell.tsx), and `splitByOwner` with a null
  // id puts EVERY row under "Operator lain" — so for one render the operator would be told their
  // own documents belong to somebody else and are read-only.
  if (!user) return <Loading label="Memuat dokumen…" />

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
            Dokumen ini tidak bisa dikirim lagi. Buka dokumennya untuk melihat alasannya, lalu hapus
            dari perangkat atau laporkan ke admin.
          </p>
        </div>
      ) : null}

      <SendStatusStrip
        pendingCount={pendingCount}
        runningCount={runningCount}
        syncing={syncing}
        online={online}
        lastSyncedAt={lastSyncedAt}
        onSend={() => void handleSend()}
      />

      {/* Still `> 1`: the strip now speaks for running sessions in general, and this line adds
          the one thing it does not say — that the PO list can only offer one of them. */}
      {myRunningCount > 1 ? (
        <p className="text-sm font-semibold text-warn-text">
          {myRunningCount} sesi milikmu masih berjalan. Selesaikan satu per satu.
        </p>
      ) : null}

      {sessions.length === 0 ? (
        <Card>
          <EmptyState>
            Belum ada dokumen penerimaan. Silakan buat dokumen baru dari daftar PO.
          </EmptyState>
        </Card>
      ) : (
        // `user.userId`, not `user?.userId ?? null`: the guard above has already returned for a
        // missing user, and a null here would silently regroup every row as somebody else's.
        <SessionGroupList sessions={sessions} itemCounts={itemCounts} currentUserId={user.userId} />
      )}
    </div>
  )
}
