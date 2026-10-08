/**
 * One-way request to put the focus back into the scan cockpit's barcode field.
 *
 * It exists because the "Versi baru siap" banner lives in the app bar (src/app/shell.tsx)
 * while `scanRef` is local state of the cockpit route — siblings, not parent and
 * child. Tapping "Nanti" leaves the focus on a button inside the scan screen, and from there the
 * scanner's closing Enter would press that button again instead of submitting a scan.
 *
 * Module singleton, the same shape as src/platform/toast.ts: the cockpit registers a handler while
 * it is mounted, anything may call `requestScanFocus()`, and with no cockpit mounted the call is a
 * no-op. Safe during prerender — it touches no browser API at all.
 *
 * ONE handler, not a Set: exactly one cockpit can be mounted at a time (it is a route), and a Set
 * would only make it possible for a stale unmounted screen to steal the focus.
 */

let handler: (() => void) | null = null

export function setScanFocusHandler(next: (() => void) | null): void {
  handler = next
}

export function requestScanFocus(): void {
  handler?.()
}
