/**
 * Normalization of Drizzle `db.execute()` results.
 * Depending on the driver version, the result can be a row array OR a tuple
 * [rows, fields] OR an object { rows }. This helper accepts all three.
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
