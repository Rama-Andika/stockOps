/** Pemformatan tampilan (bahasa Indonesia). */

// Formatter dibuat SEKALI di level modul (Intl mahal bila dibuat tiap panggilan).
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

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}
