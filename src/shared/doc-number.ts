/**
 * Official number of a receiving document: <PREFIX><MMYY><NNNN>, e.g. IN04260001.
 *
 * - prefix_number = "IN" + MMYY   (e.g. IN0426)
 * - counter       = sequential within one prefix, so it restarts every month
 * - number        = prefix_number + counter zero-padded to 4 digits
 *
 * Both parts are assigned by the server at sync time and never on the device. The counter is
 * MAX(counter) + 1 for that prefix, which only holds while a single writer owns the numbering
 * lock; a device numbering its own documents offline would hand out duplicates the moment two
 * PDTs synced in the same month. Until a session is synced it carries a local UUID instead.
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
