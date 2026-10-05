/*
 * StockOps service worker (handwritten, zero dependencies).
 *
 * Purpose: allow the application to OPEN while offline (SPA shell + ALL
 * build assets, including per-route chunks, stored in cache). Working data
 * is stored in IndexedDB (Dexie), and server function calls are
 * ALWAYS network-only (never cached).
 *
 * The build asset list is read from /precache-manifest.json generated
 * by scripts/generate-precache.mjs (run after `vite build`).
 */

const CACHE_VERSION = 'stockops-v4'
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const ASSET_CACHE = `${CACHE_VERSION}-assets`
const SHELL_URL = '/_shell.html'
const PRECACHE_MANIFEST = '/precache-manifest.json'

const PRECACHE_URLS = ['/', SHELL_URL, '/manifest.webmanifest', '/icon.svg', '/offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE)
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: 'reload' }))
            if (response && response.ok) await shell.put(url, response)
          } catch {
            // Ignore: a single asset failure should not fail installation.
          }
        }),
      )

      // Precache ALL build assets (including per-route chunks) so that
      // offline navigation to any route does not fail loading chunks.
      try {
        const manifestResponse = await fetch(new Request(PRECACHE_MANIFEST, { cache: 'reload' }))
        if (manifestResponse.ok) {
          const urls = await manifestResponse.json()
          if (Array.isArray(urls)) {
            const assets = await caches.open(ASSET_CACHE)
            await Promise.all(
              urls.map(async (url) => {
                try {
                  const response = await fetch(new Request(url, { cache: 'reload' }))
                  if (response && response.ok) await assets.put(url, response)
                } catch {
                  // ignore
                }
              }),
            )
          }
        }
      } catch {
        // Manifest not yet available (e.g. during dev) — proceed without asset precaching.
      }

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
  // Data/auth must always be fresh from server (offline-first uses IndexedDB).
  if (isServerCall(url.pathname)) return
  // Precache manifest does not need to be cached.
  if (url.pathname === PRECACHE_MANIFEST) return

  // Navigation: network-first, fallback to stored shell.
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
              // ignore
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

  // Static assets (hashed) & route chunks: cache-first.
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
            // ignore
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
