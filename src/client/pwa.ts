/**
 * Registrasi service worker di semua environment (dev/staging/prod).
 * Di dev, cache aset bisa basi saat kode berubah — naikkan CACHE_VERSION
 * di public/sw.js bila perlu. Verifikasi offline penuh tetap pakai
 * build/preview (npm run build && npm start).
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // PWA opsional: aplikasi tetap berfungsi tanpa service worker.
    })
  })
}
