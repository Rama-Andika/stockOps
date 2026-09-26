// Server produksi sederhana untuk StockOps (SPA + server functions).
//
// Sesuai desain SPA mode TanStack Start:
// - aset statis & shell SPA dilayani dari dist/client
// - permintaan /_serverFn/* dan /api/* diteruskan ke handler fetch hasil build
//
// Jalankan: npm run build && npm start

import { createServer } from 'node:http'
import { stat, readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const clientDir = join(rootDir, 'dist', 'client')
const serverEntry = pathToFileURL(join(rootDir, 'dist', 'server', 'server.js')).href
const port = Number.parseInt(process.env.PORT ?? '3000', 10)

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
  const url = `http://${host}${req.url ?? '/'}`
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

  // Fallback SPA: rute apa pun yang bukan aset statis dilayani oleh shell.
  if (!filePath) filePath = join(clientDir, '_shell.html')

  try {
    const data = await readFile(filePath)
    res.statusCode = 200
    res.setHeader('Content-Type', MIME_TYPES[extname(filePath)] ?? 'application/octet-stream')
    res.setHeader(
      'Cache-Control',
      filePath.includes(`${sep}assets${sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    )
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end('Not found')
  }
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      if (isServerRequest(url.pathname)) {
        const mod = await getHandler()
        const response = await mod.default.fetch(toWebRequest(req))
        await sendWebResponse(res, response)
        return
      }
      await serveStatic(res, url.pathname)
    } catch (error) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`Internal error: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
})

server.listen(port, '0.0.0.0', () => {
  console.log(`StockOps berjalan di http://localhost:${port}`)
  console.log('Akses dari PDT di jaringan yang sama memakai IP komputer ini.')
})
