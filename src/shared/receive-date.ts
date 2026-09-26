/**
 * Sanitasi tanggal penerimaan (menutup celah "jam device salah").
 *
 * Sesi dibuat offline, sehingga `receiveDate` berasal dari jam device. Bila
 * jam device jelas tidak masuk akal (masa depan atau terlalu lampau), server
 * memakai waktu server dan menandainya `adjusted`.
 */

const MS_PER_DAY = 86_400_000

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Date -> 'YYYY-MM-DD HH:MM:SS' (waktu lokal). */
export function toLocalDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

export function parseReceiveDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const text = raw.trim().replace(' ', 'T')
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export type DateAdjustReason = 'INVALID' | 'FUTURE' | 'TOO_OLD'

export interface SanitizedReceiveDate {
  value: string
  parsed: Date
  adjusted: boolean
  reason?: DateAdjustReason
}

export interface SanitizeReceiveDateOptions {
  maxFutureDays?: number
  maxAgeDays?: number
}

export function sanitizeReceiveDate(
  raw: string | null | undefined,
  now: Date,
  options: SanitizeReceiveDateOptions = {},
): SanitizedReceiveDate {
  const maxFutureDays = options.maxFutureDays ?? 1
  const maxAgeDays = options.maxAgeDays ?? 45
  const parsed = parseReceiveDate(raw)

  if (!parsed) {
    return { value: toLocalDateTime(now), parsed: now, adjusted: true, reason: 'INVALID' }
  }
  if (parsed.getTime() > now.getTime() + maxFutureDays * MS_PER_DAY) {
    return { value: toLocalDateTime(now), parsed: now, adjusted: true, reason: 'FUTURE' }
  }
  if (parsed.getTime() < now.getTime() - maxAgeDays * MS_PER_DAY) {
    return { value: toLocalDateTime(now), parsed: now, adjusted: true, reason: 'TOO_OLD' }
  }
  return { value: toLocalDateTime(parsed), parsed, adjusted: false }
}
