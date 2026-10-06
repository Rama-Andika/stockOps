import { SESSION_STATUS, type SessionStatus } from './constants'

/**
 * Who a local receiving session belongs to, and what somebody else may do with it.
 *
 * This file lives in `src/shared/` and imports nothing from `client/`: the input types below are
 * structural, so the Dexie row type `LocalSession` satisfies them without either side importing
 * the other — the same arrangement as `session-view.ts`.
 *
 * One PDT is handed between operators per shift, so five surfaces end up asking the same two
 * questions ("whose session is this?" and "may I change it?"): the receiving list, the scan
 * cockpit, the review step, the PO list banner and the PO detail screen. Each answering on its
 * own would guarantee that two of them eventually disagree.
 *
 * IMPORTANT — this is a mistake guard, not access control. Everything here runs on the device,
 * `session.userId` is still written by the client, and the server does not check ownership at all
 * (README section 7). It stops an operator from continuing a colleague's document by accident; it
 * does not stop anyone determined from editing IndexedDB.
 */

/** The owner fields every session row carries. */
export interface SessionOwnerInput {
  userId: string
  /**
   * The owner's name as it was when the session was created, or `null` for a session whose owner
   * could not be resolved during the v1 -> v2 migration. Optional on the type AND read
   * defensively below, so a row written by an older build cannot crash a screen.
   */
  userFullName?: string | null
  userLoginId?: string | null
}

/** Shown when neither the stored name nor the login id is known. */
export const UNKNOWN_OWNER_LABEL = 'Operator lain'

/** Shown instead of the current operator's own name: shorter, and it reads as an answer. */
export const SELF_OWNER_LABEL = 'Saya'

/**
 * `currentUserId` is nullable on purpose: the store holds `user: CurrentUser | null`, and every
 * caller would otherwise repeat the same `?? null`. No logged-in user means nothing is owned by
 * anybody — never "everything is mine".
 */
export function isOwnedBy(
  session: Pick<SessionOwnerInput, 'userId'>,
  currentUserId: string | null | undefined,
): boolean {
  if (!currentUserId) return false
  return session.userId === currentUserId
}

/**
 * The owner's name: the one stored on the session, then the login id, then a generic label. Never
 * the raw `userId` — a bigint means nothing to an operator holding a paper delivery note.
 */
export function ownerName(session: SessionOwnerInput): string {
  const fullName = session.userFullName?.trim()
  if (fullName) return fullName
  const loginId = session.userLoginId?.trim()
  if (loginId) return loginId
  return UNKNOWN_OWNER_LABEL
}

/** `ownerName`, except that the current operator reads as "Saya". */
export function ownerLabel(
  session: SessionOwnerInput,
  currentUserId: string | null | undefined,
): string {
  return isOwnedBy(session, currentUserId) ? SELF_OWNER_LABEL : ownerName(session)
}

/**
 * The whole rule, in one place: a session may only be changed while it is RUNNING **and** it
 * belongs to the operator who is logged in. The status half already existed — the cockpit computed
 * `session.status === SESSION_STATUS.RUNNING` inline — and the ownership half is the new part.
 *
 * Every screen asks this instead of comparing ids itself, so "may I change this" has exactly one
 * definition on the device.
 */
export function canEditSession(
  session: SessionOwnerInput & { status: SessionStatus },
  currentUserId: string | null | undefined,
): boolean {
  return session.status === SESSION_STATUS.RUNNING && isOwnedBy(session, currentUserId)
}

/**
 * Splits a session list into the operator's own and everybody else's, keeping the incoming order
 * within each group: callers pass lists that are already sorted (`listSessions` by `sequence`
 * descending, `runningSessions` newest first) and that order is what the screens rely on.
 */
export function splitByOwner<T extends Pick<SessionOwnerInput, 'userId'>>(
  sessions: readonly T[],
  currentUserId: string | null | undefined,
): { mine: T[]; others: T[] } {
  const mine: T[] = []
  const others: T[] = []
  for (const session of sessions) {
    if (isOwnedBy(session, currentUserId)) mine.push(session)
    else others.push(session)
  }
  return { mine, others }
}
