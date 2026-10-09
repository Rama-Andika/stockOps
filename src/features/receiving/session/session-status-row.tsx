import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Badge } from '~/ui/primitives'
import {
  SESSION_STATUS,
  SESSION_STATUS_LABEL,
  type SessionStatus,
} from '~/core/contracts/constants'
import { formatDateTime, formatQty } from '~/core/format'
import { rejectionReasonText } from '~/features/receiving/logic/session-view'
import { isOwnedBy, ownerName } from '~/features/receiving/logic/session-owner'

/** Only the fields the row shows — so a test can build one without a whole Dexie session. */
export interface SessionRowInput {
  sessionId: string
  status: SessionStatus
  /** Owner of the session. `LocalSession` satisfies these three without importing it. */
  userId: string
  userFullName: string | null
  userLoginId: string | null
  number: string | null
  purchaseNumber: string | null
  purchaseId: string
  vendorName: string | null
  finalizedAt: string | null
  lastError: string | null
  failureCode: string | null
  overReceive: boolean
  excessTotal: number
}

function toneFor(status: SessionStatus): 'neutral' | 'info' | 'success' | 'warn' | 'danger' {
  switch (status) {
    case SESSION_STATUS.SYNCED:
      return 'success'
    case SESSION_STATUS.FAILED:
    case SESSION_STATUS.REJECTED:
      return 'danger'
    case SESSION_STATUS.SYNCING:
      return 'info'
    case SESSION_STATUS.PENDING:
      return 'warn'
    default:
      return 'neutral'
  }
}

/**
 * The sentence under the badge. The badge already names the state in operator language
 * (SESSION_STATUS_LABEL); this says what it MEANS for the document in front of them — whether it
 * is still on the device, already official, or never going anywhere.
 */
function detailLine(session: SessionRowInput): string {
  switch (session.status) {
    case SESSION_STATUS.RUNNING:
      return 'Belum selesai — buka untuk melanjutkan.'
    case SESSION_STATUS.PENDING:
      return session.finalizedAt
        ? `Selesai ${formatDateTime(session.finalizedAt)} · masih di perangkat.`
        : 'Masih di perangkat, menunggu dikirim.'
    case SESSION_STATUS.SYNCING:
      return 'Sedang dikirim ke server…'
    case SESSION_STATUS.SYNCED:
      return 'Nomor resmi dari server · baca-saja di perangkat.'
    case SESSION_STATUS.FAILED:
      return 'Gagal kirim · akan dicoba lagi otomatis.'
    case SESSION_STATUS.REJECTED:
      return rejectionReasonText(session.failureCode, session.lastError)
  }
}

export function SessionStatusRow({
  session,
  itemCount,
  currentUserId,
}: {
  session: SessionRowInput
  itemCount: number
  /** `null` while no operator is logged in — then no row is "mine". */
  currentUserId: string | null
}) {
  const rejected = session.status === SESSION_STATUS.REJECTED
  // Rendered ONLY on a row that belongs to somebody else. On this operator's own rows it would
  // repeat the group heading above them ("Sesi saya") once per row, and this list is the one
  // screen where vertical space should pay for documents rather than for labels.
  const foreignOwner = isOwnedBy(session, currentUserId) ? null : ownerName(session)
  return (
    /* `h-full overflow-hidden`, every line with an explicit `leading-*`, and three lines clamped to
       two: this row is rendered inside a virtualised list whose row heights are COMPUTED from the
       same three conditions (sessionStatusRowHeight in features/receiving/row-heights.ts) and then forced.
       Where `line-clamp-2` was added, `block` was REMOVED on purpose — line-clamp sets
       `display: -webkit-box`, and Tailwind v4 resolves two classes for one property by stylesheet
       order, not by their order in this string. */
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: session.sessionId }}
      className="touch-target flex h-full items-start gap-2 overflow-hidden rounded-xl border border-line bg-surface/60 p-3 transition hover:border-line-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-1.5">
          {/* The official number once the server assigned one, the PO number until then: that is
              the identifier the operator can actually match against paperwork at each stage. */}
          <span className="min-w-0 truncate text-base leading-6 font-bold tabular-nums text-fg">
            {session.number ?? session.purchaseNumber ?? session.purchaseId}
          </span>
          <Badge tone={toneFor(session.status)}>{SESSION_STATUS_LABEL[session.status]}</Badge>
        </span>
        <span className="block truncate text-sm leading-5 text-fg-subtle">
          {session.vendorName ?? '-'} · {itemCount} item
        </span>
        {foreignOwner ? (
          <span className="block truncate text-sm leading-5 font-semibold text-warn-text">
            Milik {foreignOwner}
          </span>
        ) : null}
        <span
          className={`line-clamp-2 text-sm leading-5 ${rejected ? 'text-danger-soft' : 'text-fg-muted'}`}
        >
          {detailLine(session)}
        </span>
        {/* FAILED keeps the server's own words as well: unlike a rejection it is temporary, and
            the reason is the only clue about what to wait for. */}
        {session.status === SESSION_STATUS.FAILED && session.lastError ? (
          <span className="line-clamp-2 text-sm leading-5 text-danger-soft">
            {session.lastError}
          </span>
        ) : null}
        {/* Moved here from SessionContextStrip: overReceive and excessTotal are written only by
            markSynced, so they are only ever true on a document that already reached the server —
            and that is this screen's subject, not the scan cockpit's. */}
        {session.overReceive ? (
          <span className="line-clamp-2 text-sm leading-5 font-semibold tabular-nums text-warn-text">
            Kelebihan terima {formatQty(session.excessTotal)} — menunggu persetujuan admin.
          </span>
        ) : null}
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
    </Link>
  )
}
