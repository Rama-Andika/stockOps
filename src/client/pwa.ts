/**
 * Service worker registration in all environments (dev/staging/prod).
 * In dev, asset caches can become stale on code changes — bump CACHE_VERSION
 * in public/sw.js if necessary. Full offline verification should use
 * build/preview (npm run build && npm start).
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  // Register immediately (without waiting for the `load` event) so the SW is guaranteed to register
  // even if the `load` event fired before the component mounted.
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    // PWA is optional: application still works without a service worker.
  })
}
