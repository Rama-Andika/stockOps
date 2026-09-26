/** Utilitas angka desimal (qty DB = decimal(10,2) / decimal(22,2)). */

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/** Bulatkan ke 2 desimal, aman dari galat floating point. */
export function dec2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function sumDec2(values: readonly number[]): number {
  return dec2(values.reduce((acc, value) => acc + dec2(value), 0))
}

const EPSILON = 1e-9

export function eqDec2(a: number, b: number): boolean {
  return Math.abs(dec2(a) - dec2(b)) < EPSILON
}

export function gtDec2(a: number, b: number): boolean {
  return dec2(a) - dec2(b) > EPSILON
}

export function ltDec2(a: number, b: number): boolean {
  return dec2(b) - dec2(a) > EPSILON
}

export function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value
}
