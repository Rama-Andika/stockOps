/**
 * Registrasi service worker. Hanya di build produksi (agar pengembangan
 * tidak terganggu cache aset yang basi).
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // PWA opsional: aplikasi tetap berfungsi tanpa service worker.
    })
  })
}
