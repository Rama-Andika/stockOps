/**
 * Document number (BR-8, FR-5.2).
 *
 * Format: <PREFIX><MMYY><NNNN>  example: IN04260001
 * - prefix_number = "IN" + MMYY  (example: IN0426)
 * - counter       = monthly sequential counter (example: 1)
 * - number        = prefix + counter zero-padded to 4 digits
 */

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** MMYY period part of a date. */
export function docPeriod(date: Date): string {
  return `${pad2(date.getMonth() + 1)}${pad2(date.getFullYear() % 100)}`
}

/** Builds prefix_number, e.g. buildPrefix('IN', new Date(2026, 3, 1)) === 'IN0426'. */
export function buildPrefix(prefix: string, date: Date): string {
  return `${prefix}${docPeriod(date)}`
}

/** Builds full document number. */
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

/** Parses document number into prefix + counter. */
export function parseDocNumber(number: string): ParsedDocNumber | null {
  const match = /^(.*?)(\d{4})$/.exec(number.trim())
  if (!match) return null
  const prefixNumber = match[1]
  const counterText = match[2]
  if (!prefixNumber || !counterText) return null
  return { prefixNumber, counter: Number.parseInt(counterText, 10) }
}
