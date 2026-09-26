/**
 * Nomor dokumen (BR-8, FR-5.2).
 *
 * Format: <PREFIX><MMYY><NNNN>  contoh: IN04260001
 * - prefix_number = "IN" + MMYY  (contoh: IN0426)
 * - counter       = urutan per bulan (contoh: 1)
 * - number        = prefix + counter bernilai 0-4 digit
 */

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Bagian periode MMYY dari sebuah tanggal. */
export function docPeriod(date: Date): string {
  return `${pad2(date.getMonth() + 1)}${pad2(date.getFullYear() % 100)}`
}

/** Membentuk prefix_number, contoh buildPrefix('IN', new Date(2026, 3, 1)) === 'IN0426'. */
export function buildPrefix(prefix: string, date: Date): string {
  return `${prefix}${docPeriod(date)}`
}

/** Membentuk nomor dokumen lengkap. */
export function buildNumber(prefixNumber: string, counter: number, pad = 4): string {
  if (!Number.isInteger(counter) || counter < 1) {
    throw new Error(`counter harus integer >= 1 (diterima: ${counter})`)
  }
  const digits = String(counter).padStart(pad, '0')
  const number = `${prefixNumber}${digits}`
  if (number.length > 20) {
    throw new Error(`nomor dokumen melebihi 20 karakter: ${number}`)
  }
  return number
}

export interface ParsedDocNumber {
  prefixNumber: string
  counter: number
}

/** Membalik nomor dokumen menjadi prefix + counter. */
export function parseDocNumber(number: string): ParsedDocNumber | null {
  const match = /^(.*?)(\d{4})$/.exec(number.trim())
  if (!match) return null
  const prefixNumber = match[1]
  const counterText = match[2]
  if (!prefixNumber || !counterText) return null
  return { prefixNumber, counter: Number.parseInt(counterText, 10) }
}
