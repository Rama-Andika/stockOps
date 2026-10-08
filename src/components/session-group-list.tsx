import { useMemo } from 'react'
import { sessionStatusRowHeight } from './row-heights'
import { SessionStatusRow, type SessionRowInput } from './session-status-row'
import { VirtualList } from './virtual-list'
import { SESSION_STATUS } from '~/shared/constants'
import { isOwnedBy, splitByOwner } from '~/shared/session-owner'

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
  /**
   * Memoised because `splitByOwner` returns two NEW arrays on every call, and VirtualList keys its
   * size/key lookups off the identity of the array it is given.
   */
  const { mine, others } = useMemo(
    () => splitByOwner(sessions, currentUserId),
    [sessions, currentUserId],
  )

  /**
   * One windowed list per group. Two lists rather than one flat list with heading rows, so the
   * <section>/<h2> structure the groups are built on stays exactly as it was — and on a
   * single-operator device both groups are far below the threshold anyway and render plainly.
   *
   * The height conditions are the same three the row's markup branches on
   * (sessionStatusRowHeight). When a condition is added to one, it is added to the other.
   */
  const renderGroup = (group: readonly SessionRowInput[], label: string) => (
    <VirtualList
      rows={group}
      label={label}
      getKey={(session) => session.sessionId}
      rowHeight={(session) =>
        sessionStatusRowHeight({
          hasForeignOwner: !isOwnedBy(session, currentUserId),
          hasFailureText:
            session.status === SESSION_STATUS.FAILED && Boolean(session.lastError),
          hasOverReceive: session.overReceive,
        })
      }
      rowClassName="pb-2"
      renderRow={(session) => (
        <SessionStatusRow
          session={session}
          itemCount={itemCounts.get(session.sessionId) ?? 0}
          currentUserId={currentUserId}
        />
      )}
    />
  )

  // The common case on a single-operator device: exactly the list as it was before this feature.
  if (others.length === 0) {
    return renderGroup(mine, 'Dokumen penerimaan')
  }

  return (
    <div className="flex flex-col gap-4">
      {mine.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-fg-muted">Sesi saya</h2>
          {renderGroup(mine, 'Sesi saya')}
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
        {renderGroup(others, 'Dokumen operator lain')}
      </section>
    </div>
  )
}
