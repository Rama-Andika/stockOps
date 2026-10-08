/** Display formatting (Indonesian locale). */

// Formatters are created ONCE at the module level (Intl is expensive if recreated on each call).
const qtyFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })
const currencyFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
})
const dateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const dateFormatter = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' })
const timeFormatter = new Intl.DateTimeFormat('id-ID', { timeStyle: 'short' })

export function formatQty(value: string | number): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return '0'
  return qtyFormatter.format(n)
}

export function formatCurrency(value: string | number): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return 'Rp 0'
  return currencyFormatter.format(n)
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return dateTimeFormatter.format(date)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return dateFormatter.format(date)
}

export function formatRelativeDateTime(
  value: string | Date | null | undefined,
  baseDate: Date = new Date(),
): string {
  if (!value) return 'Belum pernah diunduh'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Belum pernah diunduh'

  const diffMs = baseDate.getTime() - date.getTime()
  if (diffMs < 60_000) return 'Baru saja'

  const diffMinutes = Math.floor(diffMs / 60_000)
  if (diffMinutes < 60) return `${diffMinutes} menit yang lalu`

  const timeStr = timeFormatter.format(date)

  const isToday =
    date.getFullYear() === baseDate.getFullYear() &&
    date.getMonth() === baseDate.getMonth() &&
    date.getDate() === baseDate.getDate()

  if (isToday) {
    const diffHours = Math.floor(diffMinutes / 60)
    return `Hari ini, pukul ${timeStr} (${diffHours} jam yang lalu)`
  }

  const yesterday = new Date(baseDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()

  if (isYesterday) {
    return `Kemarin, pukul ${timeStr}`
  }

  return `${dateFormatter.format(date)}, pukul ${timeStr}`
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}
