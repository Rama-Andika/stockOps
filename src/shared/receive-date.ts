/**
 * Receive date sanitization (closes the "wrong device clock" loophole).
 *
 * Sessions are created offline, so `receiveDate` comes from the device clock. If
 * the device clock is clearly unreasonable (future or too far in the past), the server
 * falls back to server time and marks it `adjusted`.
 */

const MS_PER_DAY = 86_400_000

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Date -> 'YYYY-MM-DD HH:MM:SS' (local time). */
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
