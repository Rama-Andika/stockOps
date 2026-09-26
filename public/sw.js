/*
 * Service worker StockOps (ditulis manual, tanpa dependensi).
 *
 * Tujuan: aplikasi tetap bisa DIBUKA saat offline (shell SPA + aset statis
 * tersimpan di cache). Data kerja sendiri disimpan di IndexedDB (Dexie),
 * dan panggilan server function SELALU network-only (tidak pernah di-cache).
 */

const CACHE_VERSION = 'stockops-v1'
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const ASSET_CACHE = `${CACHE_VERSION}-assets`
const SHELL_URL = '/_shell.html'

const PRECACHE_URLS = ['/', SHELL_URL, '/manifest.webmanifest', '/icon.svg', '/offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: 'reload' }))
            if (response && response.ok) await cache.put(url, response)
          } catch {
            // Abaikan: satu aset gagal tidak boleh menggagalkan instalasi.
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

function isServerCall(pathname) {
  return pathname.startsWith('/_serverFn/') || pathname.startsWith('/api/')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Data/auth harus selalu segar dari server (offline-first pakai IndexedDB).
  if (isServerCall(url.pathname)) return

  // Navigasi: network-first, fallback ke shell yang tersimpan.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response && response.ok) {
            const cache = await caches.open(SHELL_CACHE)
            try {
              await cache.put(SHELL_URL, response.clone())
            } catch {
              // abaikan
            }
          }
          return response
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          const shell = (await cache.match(SHELL_URL)) ?? (await cache.match('/'))
          if (shell) return shell
          const offline = await cache.match('/offline.html')
          return offline ?? Response.error()
        }
      })(),
    )
    return
  }

  // Aset statis (nama file ber-hash): cache-first.
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE)
      const cached = await cache.match(request)
      if (cached) return cached
      try {
        const response = await fetch(request)
        if (response && response.ok) {
          try {
            await cache.put(request, response.clone())
          } catch {
            // abaikan
          }
        }
        return response
      } catch {
        const shellCache = await caches.open(SHELL_CACHE)
        return (await shellCache.match('/offline.html')) ?? Response.error()
      }
    })(),
  )
})
