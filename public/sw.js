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

// APP_VERSION and BUILD_TIME are rewritten in dist/client/sw.js by scripts/stamp-sw.mjs, which
// runs as the last step of `npm run build`. This file — public/sw.js — keeps the 'dev' values
// and is never modified by the build.
//
// Do NOT change the SHAPE of the next two lines (one declaration per line, single quotes, value
// exactly 'dev'): stamp-sw.mjs matches them as literal text and FAILS the build when it cannot
// find each of them exactly once.
//
// BUILD_TIME is part of CACHE_VERSION on purpose. It makes this file's bytes differ on every
// build, and that is the only thing that makes the browser run `install` again — `install` being
// the only moment the precache manifest is read. It replaces the old manual "bump CACHE_VERSION
// before every release" step, which silently did nothing whenever it was forgotten.
//
// Consequence, accepted: every update invalidates every cache (see `activate` below) and the
// device re-downloads all assets. Over a warehouse LAN that is fine, but a rollout does need the
// PDT to be online.
const APP_VERSION = 'dev'
const BUILD_TIME = 'dev'
const CACHE_VERSION = `stockops-${APP_VERSION}-${BUILD_TIME}`
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const ASSET_CACHE = `${CACHE_VERSION}-assets`
const SHELL_URL = '/_shell.html'
const PRECACHE_MANIFEST = '/precache-manifest.json'

const PRECACHE_URLS = ['/', SHELL_URL, '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/offline.html']

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
      //
      // What activating by itself used to do: `activate` deletes every cache that does not belong
      // to the current CACHE_VERSION, so it pulled the route chunks out from under a tab that was
      // still lazy-loading them — in the middle of a scan session, with no warning the operator
      // could act on.
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

/**
 * The ONLY way this worker ever activates while another one is in control. The app posts
 * SKIP_WAITING when the operator accepts the "Versi baru siap" banner — see activateUpdate() in
 * src/client/pwa.ts.
 *
 * Deliberately narrow: one message type, no reply, no payload. The banner does not show the new
 * version number, which is precisely why no two-way protocol with this worker is needed.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
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
