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

// APP_VERSION, BUILD_TIME, BASE_PATH, and TENANT_SLUG are rewritten in dist/client/sw.js by
// scripts/stamp-sw.mjs, which runs as the last step of `npm run build`. This file — public/sw.js —
// keeps the 'dev' / default values and is never modified by the build.
//
// Do NOT change the SHAPE of the next four marker lines (one declaration per line, literal matching):
// stamp-sw.mjs matches them as literal text and FAILS the build when it cannot find each of them
// exactly once.
const APP_VERSION = 'dev'
const BUILD_TIME = 'dev'
const BASE_PATH = '/'
const TENANT_SLUG = ''

// CACHE_PREFIX scopes the cache per tenant/client subpath (e.g. stockops-unclejo).
// This guarantees that activating an update on one tenant will NEVER delete the cached
// shell or assets of another tenant hosted under a different subpath on the same domain.
const CACHE_PREFIX = TENANT_SLUG ? `stockops-${TENANT_SLUG}` : 'stockops'
const CACHE_VERSION = `${CACHE_PREFIX}-${APP_VERSION}-${BUILD_TIME}`
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const ASSET_CACHE = `${CACHE_VERSION}-assets`
const SHELL_URL = `${BASE_PATH}_shell.html`
const OFFLINE_URL = `${BASE_PATH}offline.html`
const PRECACHE_MANIFEST = `${BASE_PATH}precache-manifest.json`

const PRECACHE_URLS = [
  BASE_PATH,
  SHELL_URL,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}icon.svg`,
  `${BASE_PATH}icon-192.png`,
  `${BASE_PATH}icon-512.png`,
  OFFLINE_URL,
]

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

      // NO skipWaiting() here, ON PURPOSE. This is the one line that turns a forced update into
      // a requested one: the new worker stops in `waiting` and changes nothing until the operator
      // accepts the banner (the 'message' listener below).
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      // Only delete older caches belonging to THIS tenant/client. Never delete caches of
      // another tenant on the same origin.
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

/**
 * The ONLY way this worker ever activates while another one is in control. The app posts
 * SKIP_WAITING when the operator accepts the "Versi baru siap" banner — see activateUpdate() in
 * src/client/pwa.ts.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

function isServerCall(pathname) {
  return pathname.includes('/_serverFn/') || pathname.includes('/api/')
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
    // Only handle navigation requests within this subpath scope.
    if (!url.pathname.startsWith(BASE_PATH)) return
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
          const shell = (await cache.match(SHELL_URL)) ?? (await cache.match(BASE_PATH))
          if (shell) return shell
          const offline = await cache.match(OFFLINE_URL)
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
        return (await shellCache.match(OFFLINE_URL)) ?? Response.error()
      }
    })(),
  )
})
