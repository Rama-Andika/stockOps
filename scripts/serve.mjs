// Simple production server for StockOps (SPA + server functions).
//
// According to TanStack Start SPA mode design:
// - static assets & SPA shell are served from dist/client
// - /_serverFn/* and /api/* requests are forwarded to the build fetch handler
//
// Run: npm run build && npm start

import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { stat, readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const clientDir = join(rootDir, 'dist', 'client')
const serverEntry = pathToFileURL(join(rootDir, 'dist', 'server', 'server.js')).href
const port = Number.parseInt(process.env.PORT ?? '3000', 10)

// This script is the production entry point: enable the production checks in
// src/server/env.ts (secrets and DB credentials must be explicitly configured).
process.env.NODE_ENV ??= 'production'

// Optional HTTPS (strongly recommended for PDT devices). Browsers only expose service
// workers and crypto.subtle on https:// or localhost, so plain http://<LAN-IP> cannot
// log in or work offline. Set both variables in the shell environment (not in .env).
const tlsCertFile = process.env.TLS_CERT_FILE?.trim()
const tlsKeyFile = process.env.TLS_KEY_FILE?.trim()
const useTls = Boolean(tlsCertFile && tlsKeyFile)
const protocol = useTls ? 'https' : 'http'

// Fail closed on a half-configured TLS setup: silently falling back to http would leave
// the operator believing https is active while PDT devices still cannot log in.
if (Boolean(tlsCertFile) !== Boolean(tlsKeyFile)) {
  console.error(
    '[serve] TLS_CERT_FILE dan TLS_KEY_FILE harus diisi bersamaan (hanya satu yang terisi).',
  )
  console.error('[serve] Isi keduanya untuk https, atau kosongkan keduanya untuk http.')
  process.exit(1)
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

let handlerPromise
function getHandler() {
  handlerPromise ??= import(serverEntry)
  return handlerPromise
}

function isServerRequest(pathname) {
  return pathname.startsWith('/_serverFn/') || pathname.startsWith('/api/')
}

function toWebRequest(req) {
  const host = req.headers.host ?? `localhost:${port}`
  const url = `${protocol}://${host}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(',') : value)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url, {
    method,
    headers,
    body: hasBody ? req : undefined,
    duplex: hasBody ? 'half' : undefined,
  })
}

async function sendWebResponse(res, response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  if (!response.body) {
    res.end()
    return
  }
  for await (const chunk of response.body) {
    res.write(Buffer.from(chunk))
  }
  res.end()
}

async function serveStatic(res, pathname) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '')
  const candidate = resolve(join(clientDir, safePath))
  if (!candidate.startsWith(clientDir + sep) && candidate !== clientDir) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  let filePath = null
  try {
    const info = await stat(candidate)
    if (info.isFile()) {
      filePath = candidate
    } else if (info.isDirectory()) {
      const indexFile = join(candidate, 'index.html')
      try {
        const indexInfo = await stat(indexFile)
        if (indexInfo.isFile()) filePath = indexFile
      } catch {
        filePath = null
      }
    }
  } catch {
    filePath = null
  }

  // SPA fallback: any route that is not a static asset is served by the shell.
  if (!filePath) filePath = join(clientDir, '_shell.html')

  try {
    const data = await readFile(filePath)
    res.statusCode = 200
    res.setHeader('Content-Type', MIME_TYPES[extname(filePath)] ?? 'application/octet-stream')
    res.setHeader(
      'Cache-Control',
      filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    )
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end('Not found')
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url ?? '/', `${protocol}://${req.headers.host ?? 'localhost'}`)
    if (isServerRequest(url.pathname)) {
      const mod = await getHandler()
      const response = await mod.default.fetch(toWebRequest(req))
      await sendWebResponse(res, response)
      return
    }
    await serveStatic(res, url.pathname)
  } catch (error) {
    // Details stay in the server log; the client only receives a generic message.
    console.error('[serve] request gagal:', error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Internal error')
  }
}

const listener = (req, res) => {
  void handleRequest(req, res)
}

async function loadTlsOptions() {
  try {
    return { cert: await readFile(tlsCertFile), key: await readFile(tlsKeyFile) }
  } catch (error) {
    // Clear message instead of a raw stack trace; never fall back to http.
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'ERROR'
    console.error(`[serve] Gagal membaca file TLS (${code}).`)
    console.error(`[serve] TLS_CERT_FILE=${tlsCertFile}`)
    console.error(`[serve] TLS_KEY_FILE=${tlsKeyFile}`)
    console.error(
      '[serve] Periksa path, hak akses file, dan pastikan private key tidak terenkripsi (tanpa passphrase).',
    )
    process.exit(1)
  }
}

const server = useTls ? createHttpsServer(await loadTlsOptions(), listener) : createServer(listener)

server.listen(port, '0.0.0.0', () => {
  console.log(`StockOps berjalan di ${protocol}://localhost:${port}`)
  if (useTls) {
    console.log(`Akses dari PDT: https://<IP-komputer-ini>:${port}`)
  } else {
    console.log(
      'PERINGATAN: mode http. PDT yang membuka http://<IP-LAN> tidak bisa login maupun bekerja offline.',
    )
    console.log('Isi TLS_CERT_FILE dan TLS_KEY_FILE untuk mengaktifkan https (lihat README).')
  }
})
