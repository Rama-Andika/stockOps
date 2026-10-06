import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Badge } from './ui'
import { SESSION_STATUS, SESSION_STATUS_LABEL, type SessionStatus } from '~/shared/constants'
import { formatDateTime, formatQty } from '~/shared/format'
import { rejectionReasonText } from '~/shared/session-view'

/** Only the fields the row shows — so a test can build one without a whole Dexie session. */
export interface SessionRowInput {
  sessionId: string
  status: SessionStatus
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
}: {
  session: SessionRowInput
  itemCount: number
}) {
  const rejected = session.status === SESSION_STATUS.REJECTED
  return (
    <Link
      to="/sessions/$sessionId"
      params={{ sessionId: session.sessionId }}
      className="touch-target flex items-start gap-2 rounded-xl border border-line bg-surface/60 p-3 transition hover:border-line-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          {/* The official number once the server assigned one, the PO number until then: that is
              the identifier the operator can actually match against paperwork at each stage. */}
          <span className="min-w-0 truncate text-base font-bold tabular-nums text-fg">
            {session.number ?? session.purchaseNumber ?? session.purchaseId}
          </span>
          <Badge tone={toneFor(session.status)}>{SESSION_STATUS_LABEL[session.status]}</Badge>
        </span>
        <span className="block truncate text-sm text-fg-subtle">
          {session.vendorName ?? '-'} · {itemCount} item
        </span>
        <span className={`block text-sm ${rejected ? 'text-danger-soft' : 'text-fg-muted'}`}>
          {detailLine(session)}
        </span>
        {/* FAILED keeps the server's own words as well: unlike a rejection it is temporary, and
            the reason is the only clue about what to wait for. */}
        {session.status === SESSION_STATUS.FAILED && session.lastError ? (
          <span className="block text-sm text-danger-soft">{session.lastError}</span>
        ) : null}
        {/* Moved here from SessionContextStrip: overReceive and excessTotal are written only by
            markSynced, so they are only ever true on a document that already reached the server —
            and that is this screen's subject, not the scan cockpit's. */}
        {session.overReceive ? (
          <span className="block text-sm font-semibold tabular-nums text-warn-text">
            Kelebihan terima {formatQty(session.excessTotal)} — menunggu persetujuan admin.
          </span>
        ) : null}
      </span>
      <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-fg-subtle" aria-hidden="true" />
    </Link>
  )
}
