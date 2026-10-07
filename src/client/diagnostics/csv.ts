import { formatDateTime } from '~/shared/format'
import type { DiagDetail } from './events'
import type { DiagnosticsExport } from './read'

/**
 * The exported file: ONE table, one row per fact, with a `tipe` column saying which kind of fact
 * it is. One file cannot be separated from its context on the way through a chat app.
 *
 * Semicolon-separated with a UTF-8 BOM, because the reader is the IT team in Excel on a Windows
 * machine with Indonesian locale: Excel splits on the system list separator (`;` there), and
 * without the BOM it guesses the encoding and turns vendor names into mojibake.
 */
export const CSV_SEPARATOR = ';'
export const CSV_EOL = '\r\n'
export const CSV_BOM = '\uFEFF'

export const CSV_COLUMNS = [
  'tipe',
  'waktu',
  'waktuLokal',
  'level',
  'kategori',
  'event',
  'pesan',
  'sessionId',
  'detail',
] as const

type CsvValue = string | number | boolean | null | undefined

/**
 * One cell, escaped.
 *
 * Two separate jobs, and both are load-bearing:
 *  - RFC-style quoting, because `message` carries server error text and WILL contain `;`, quotes
 *    and sometimes a newline. One unescaped cell ruins the whole file in Excel.
 *  - A formula guard: Excel executes a cell starting with `=`, `+` or `@`. `-` is deliberately NOT
 *    in that set — an Indonesian message may legitimately start with a dash, and prefixing those
 *    would corrupt readable text to defend against a case Excel does not treat as a formula here.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+@]/.test(text)) text = `'${text}`
  if (!/[;"\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(CSV_SEPARATOR)
}

function detailJson(detail: DiagDetail | undefined): string {
  if (!detail) return ''
  if (Object.keys(detail).length === 0) return ''
  return JSON.stringify(detail)
}

/**
 * `now` is a parameter so the test can pin the timestamp; every caller in the app passes none.
 */
export function buildDiagnosticsCsv(payload: DiagnosticsExport, now: Date = new Date()): string {
  const snapshot = payload.snapshot
  const nowIso = now.toISOString()
  const nowLocal = formatDateTime(now)

  const meta: Array<[string, CsvValue]> = [
    ['deviceId', snapshot.deviceId],
    ['appVersion', snapshot.appVersion],
    ['appBuildTime', snapshot.appBuildTime],
    ['online', snapshot.online],
    ['lastPushAt', snapshot.lastPushAt],
    ['lastPullAt', snapshot.lastPullAt],
    ['purchasesStale', snapshot.purchasesStale],
    ['logEntries', snapshot.totalEntries],
    ['logProblems', snapshot.problemEntries],
    ['logMax', snapshot.logMax],
  ]
  for (const [status, count] of Object.entries(snapshot.statusCounts)) {
    meta.push([`sessions.${status}`, count])
  }

  const rows: string[] = [CSV_COLUMNS.join(CSV_SEPARATOR)]

  for (const [key, value] of meta) {
    rows.push(csvRow(['META', nowIso, nowLocal, '', '', key, value, '', '']))
  }

  for (const session of payload.sessions) {
    rows.push(
      csvRow([
        'SESSION',
        session.updatedAt,
        formatDateTime(session.updatedAt),
        '',
        session.status,
        session.failureCode,
        `${session.purchaseNumber ?? '-'} / ${session.vendorName ?? '-'}`,
        session.sessionId,
        detailJson({
          number: session.number,
          lines: session.lines,
          overReceive: session.overReceive,
          excessTotal: session.excessTotal,
          userLoginId: session.userLoginId,
          lastError: session.lastError,
        }),
      ]),
    )
  }

  // Oldest first: the screen reads backwards ("what just happened"), a spreadsheet reads forwards.
  // Both directions are pinned by tests, because flipping either one silently misleads a reader.
  for (const entry of payload.entries) {
    rows.push(
      csvRow([
        'LOG',
        entry.at,
        formatDateTime(entry.at),
        entry.level,
        entry.category,
        entry.event,
        entry.message,
        entry.sessionId,
        detailJson(entry.detail),
      ]),
    )
  }

  return CSV_BOM + rows.join(CSV_EOL) + CSV_EOL
}

/**
 * Plain-text digest for the clipboard: what fits in ONE chat message.
 *
 * It exists because the whole CSV does not. Two thousand rows is a few hundred kilobytes, which a
 * chat app will truncate or refuse — so the clipboard path carries the snapshot plus the newest
 * problems, which is exactly what gets read out over the phone anyway.
 */
export function buildDiagnosticsSummary(payload: DiagnosticsExport, maxEntries = 20): string {
  const snapshot = payload.snapshot
  const sessions = Object.entries(snapshot.statusCounts)
    .map(([status, count]) => `${status}=${count}`)
    .join(' ')
  const lines = [
    'StockOps — diagnostik',
    `Device: ${snapshot.deviceId ?? '-'}`,
    `Versi: ${snapshot.appVersion}`,
    `Online: ${snapshot.online ? 'ya' : 'tidak'}`,
    `Kirim terakhir: ${formatDateTime(snapshot.lastPushAt)}`,
    `Unduh terakhir: ${formatDateTime(snapshot.lastPullAt)}`,
    `Daftar PO perlu disegarkan: ${snapshot.purchasesStale ? 'ya' : 'tidak'}`,
    `Sesi: ${sessions}`,
    `Log: ${snapshot.totalEntries} entri, ${snapshot.problemEntries} bermasalah`,
    '',
    `Masalah terakhir (maks ${maxEntries}):`,
  ]
  // payload.entries is oldest first, so the newest problems are at the END.
  const problems = payload.entries
    .filter((entry) => entry.level !== 'info')
    .slice(-maxEntries)
    .reverse()
  if (problems.length === 0) {
    lines.push('- tidak ada')
  } else {
    for (const entry of problems) {
      lines.push(`- ${formatDateTime(entry.at)} [${entry.level}] ${entry.event ?? '-'}: ${entry.message}`)
    }
  }
  return lines.join('\n')
}

/**
 * `stockops-diag-<8 karakter deviceId>-<YYYYMMDD-HHmm>.csv`, stamped from the DEVICE's local
 * clock.
 *
 * The device id is cut to eight characters so the name stays readable; the full id is inside the
 * file as a META row. That is the answer to the weakness of putting context in a file name — if
 * someone renames the file while forwarding it, nothing is lost.
 */
export function diagnosticsFileName(deviceId: string | null, now: Date): string {
  const device = (deviceId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `stockops-diag-${device || 'unknown'}-${stamp}.csv`
}
