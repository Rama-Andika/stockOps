/**
 * Service worker registration, plus the update handshake behind the "Versi baru siap" banner
 * (src/app/update-banner.tsx).
 *
 * The flow end to end:
 *   1. `registerServiceWorker(onUpdateReady)` registers /sw.js and watches the registration.
 *   2. Every build produces a different sw.js (scripts/stamp-sw.mjs stamps the build time into
 *      CACHE_VERSION), so the browser installs it. public/sw.js no longer calls skipWaiting(),
 *      so the new worker stops in `waiting` and changes nothing.
 *   3. A worker that reaches `installed` while a controller ALREADY EXISTS is an update, and
 *      `onUpdateReady` fires. With no controller it is this device's FIRST install, where there
 *      is nothing to offer the operator.
 *   4. `activateUpdate()` posts SKIP_WAITING and reloads once the controller changes.
 *
 * Dev note: under `npm run dev` the file is served straight from public/ and never changes, so no
 * update is ever detected and the cached shell can go stale. The escape hatch is the browser, not
 * a version bump: DevTools → Application → Service Workers → "Update on reload" / "Unregister".
 * Full offline behaviour must be verified on a build (`npm run build && npm start`).
 */

import { APP_VERSION } from '~/app/app-version'
import { DIAG_EVENT } from '~/core/contracts/diag-events'
import { recordDiag } from '~/features/diagnostics/trail'

let registration: ServiceWorkerRegistration | null = null
/** Guards the reload: `controllerchange` and the timeout fallback must never both fire it. */
let reloading = false

function reloadOnce(): void {
  if (reloading) return
  reloading = true
  window.location.reload()
}

export function registerServiceWorker(onUpdateReady?: () => void): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const notifyIfUpdate = () => {
    // No controller means this is the first install on this device, not a new version. Without
    // this guard a brand-new operator would be asked to reload an app that is already current.
    if (!navigator.serviceWorker.controller) return
    // Logged where the decision is made, not in the banner: this fires once per detected update,
    // while the banner can be re-rendered, snoozed and shown again for the same worker.
    recordDiag({
      level: 'info',
      category: 'pwa',
      event: DIAG_EVENT.SW_UPDATE_READY,
      message: `Versi baru siap dipasang (terpasang saat ini: ${APP_VERSION}).`,
    })
    onUpdateReady?.()
  }

  // Register immediately (without waiting for the `load` event) so the SW is guaranteed to register
  // even if the `load` event fired before the component mounted.
  void navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      registration = reg
      // A worker can already be waiting from an earlier visit: its `updatefound` fired then, long
      // before this listener existed, so the event alone would miss it.
      if (reg.waiting) notifyIfUpdate()
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing ?? reg.waiting
        if (!incoming) return
        if (incoming.state === 'installed') {
          notifyIfUpdate()
          return
        }
        incoming.addEventListener('statechange', () => {
          // Only `installed` counts. A failed install ends in `redundant` and must stay silent.
          if (incoming.state === 'installed') notifyIfUpdate()
        })
      })
    })
    .catch(() => {
      // PWA is optional: application still works without a service worker.
    })
}

/**
 * Asks the browser whether a newer sw.js exists.
 *
 * Two callers, both in src/app/shell.tsx: an effect on `online`, so a device that
 * comes back on the network picks up a build deployed mid-shift, and the "Cek Pembaruan" button
 * in Pengaturan. The third moment — app start — needs no call at all: `register()` below is
 * itself an update check, performed every time it runs.
 *
 * Offline it fails and says nothing; there is no news to give the operator either way. It is also
 * a no-op before `register()` has resolved, which is why app start is covered by the registration
 * and not by this function.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    await registration?.update()
  } catch {
    // Offline, or the server is unreachable.
  }
}

/**
 * Hands control to the waiting worker and reloads.
 *
 * The reload deliberately waits for `controllerchange` instead of happening right here: posting
 * the message only STARTS the handover, and reloading immediately would re-fetch the page from
 * the OLD worker, which still holds the old caches.
 */
export function activateUpdate(): void {
  const waiting = registration?.waiting
  if (!waiting) {
    // Nothing waiting — an older build that still called skipWaiting() itself, or a worker that
    // died. The operator asked for the new version; a plain reload is still the honest answer.
    reloadOnce()
    return
  }
  // Armed HERE, not at registration time. `clients.claim()` in sw.js also fires `controllerchange`
  // on a device's very first install, and a listener armed earlier would reload the app during the
  // operator's first ever visit.
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce)
  // Fallback: a worker that never reports back must not leave a dead button on screen. `reloading`
  // makes the two paths mutually exclusive, so this can never cause a second reload.
  window.setTimeout(reloadOnce, 2000)
  waiting.postMessage({ type: 'SKIP_WAITING' })
}
