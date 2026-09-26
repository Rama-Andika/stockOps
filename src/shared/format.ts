/** Pemformatan tampilan (bahasa Indonesia). */

export function formatQty(value: string | number): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return '0'
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n)
}

export function formatCurrency(value: string | number): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return 'Rp 0'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(date)
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}
