/**
 * Normalisasi hasil `db.execute()` Drizzle.
 * Bergantung versi driver, hasilnya bisa berupa array baris ATAU tuple
 * [rows, fields] ATAU objek { rows }. Helper ini menerima ketiganya.
 */
export function rowsOf<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) {
    if (
      result.length === 2 &&
      Array.isArray(result[0]) &&
      Array.isArray(result[1])
    ) {
      return result[0] as T[]
    }
    return result as T[]
  }
  if (result && typeof result === 'object') {
    const maybeRows = (result as { rows?: unknown }).rows
    if (Array.isArray(maybeRows)) return maybeRows as T[]
  }
  return []
}
