import { localRepo } from '~/client/db/local-repo'
import type { DiagEntryInput } from './events'

/**
 * Fire-and-forget writer for the diagnostics trail, for callers that cannot await: the global
 * error listeners and the service-worker handshake.
 *
 * The sync engine does NOT use this. It receives a `LocalRepository` as a parameter (the sync
 * tests inject one backed by their own Dexie database), so it keeps its own `safeLog`; a singleton
 * here would make those tests write to the wrong database.
 */

/**
 * Consecutive failed writes, and the kill switch they trip.
 *
 * This is the recursion guard. If writing the trail itself throws, that error can reach the global
 * error listener, which would try to write again — and again. Three consecutive failures turn the
 * trail off for the rest of the session.
 *
 * A counter, deliberately, and not a boolean mutex held during the write: a mutex would drop
 * healthy entries that merely arrive at the same time, and two errors in one tick is precisely
 * when the log earns its keep.
 */
let consecutiveFailures = 0
let disabled = false

const MAX_CONSECUTIVE_FAILURES = 3

export function recordDiag(entry: DiagEntryInput): void {
  if (disabled) return
  // No IndexedDB: the SPA shell is prerendered in Node, where there is nothing to write to.
  if (typeof indexedDB === 'undefined') return
  void localRepo.logEvent(entry).then(
    () => {
      consecutiveFailures = 0
    },
    () => {
      consecutiveFailures += 1
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) disabled = true
    },
  )
}
