import { DIAG_EVENT, DIAG_STACK_MAX } from '~/core/contracts/diag-events'
import { recordDiag } from '~/features/diagnostics/trail'

/**
 * Global error listeners, installed once from the app shell.
 *
 * Silent by design: an operator mid-receipt gets no toast and no badge, so the trail is only ever
 * read because IT went looking. The trade is accepted (see the plan's decision table) — the
 * alternative floods the scan screen when one error repeats.
 */

/**
 * Installed once per page load, tracked at module level rather than by effect dependencies:
 * React StrictMode runs effects twice in development, and two listeners would record every error
 * twice — which reads as "it happened twice", not as a double registration.
 */
let installed = false

/**
 * `undefined` rather than an empty string when there is no stack, because `detailJson` in csv.ts
 * only drops a `detail` that is undefined or has no keys: returning `''` wrote a useless
 * `{"stack":""}` into the CSV column — and into IndexedDB — for every error without one.
 */
function stackOf(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined
  // Truncated HERE, not in the CSV: a full stack is kilobytes and would eat ring-buffer slots
  // without adding anything the first frames do not already say.
  return error.stack.slice(0, DIAG_STACK_MAX)
}

export function installErrorTrap(): void {
  if (installed) return
  // Prerendered in Node: there is no window to listen on.
  if (typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    const where = event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : ''
    const stack = stackOf(event.error)
    recordDiag({
      level: 'error',
      category: 'app',
      event: DIAG_EVENT.UNHANDLED_ERROR,
      message: `${event.message || 'Kesalahan tanpa pesan'}${where}`,
      detail: stack ? { stack } : undefined,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Promise ditolak tanpa alasan'
    const stack = stackOf(reason)
    recordDiag({
      level: 'error',
      category: 'app',
      event: DIAG_EVENT.UNHANDLED_REJECTION,
      message,
      detail: stack ? { stack } : undefined,
    })
  })
}
