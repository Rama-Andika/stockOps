import { SessionStatusRow, type SessionRowInput } from './session-status-row'
import { splitByOwner } from '~/shared/session-owner'

/**
 * The receiving list, split into "my sessions" and "other operators'". One PDT is handed between
 * operators per shift, so a flat list makes an operator read every row before finding their own.
 *
 * Both headings appear together or not at all: with nothing from anybody else, a lone "Sesi saya"
 * heading is noise above a list that is entirely theirs.
 *
 * A component rather than markup inside the route, because the route cannot be rendered in a test
 * without a router AND a live IndexedDB (jsdom has none, so `useLive` would return empty lists).
 * See tests/component/session-owner.test.tsx.
 */
export function SessionGroupList({
  sessions,
  itemCounts,
  currentUserId,
}: {
  /** Already ordered by the caller — `listSessions()` returns newest first. */
  sessions: readonly SessionRowInput[]
  /** Line counts keyed by sessionId; a session with no lines is absent, so read it with `?? 0`. */
  itemCounts: ReadonlyMap<string, number>
  currentUserId: string | null
}) {
  const { mine, others } = splitByOwner(sessions, currentUserId)

  const renderRows = (group: readonly SessionRowInput[]) =>
    group.map((session) => (
      <SessionStatusRow
        key={session.sessionId}
        session={session}
        itemCount={itemCounts.get(session.sessionId) ?? 0}
        currentUserId={currentUserId}
      />
    ))

  // The common case on a single-operator device: exactly the list as it was before this feature.
  if (others.length === 0) {
    return <div className="flex flex-col gap-2">{renderRows(mine)}</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {mine.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-fg-muted">Sesi saya</h2>
          {renderRows(mine)}
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-fg-muted">
          Operator lain ({others.length})
        </h2>
        {/* Says the one thing the rows cannot: these documents are NOT waiting for their owner to
            come back before they can be sent. Pressing Kirim pushes the whole outbox, which is a
            device-level action by design — see the note in routes/sessions/$sessionId.tsx. */}
        <p className="text-sm text-fg-subtle">
          Hanya bisa dilihat. Dokumen yang sudah selesai tetap ikut terkirim saat kamu menekan
          Kirim.
        </p>
        {renderRows(others)}
      </section>
    </div>
  )
}
