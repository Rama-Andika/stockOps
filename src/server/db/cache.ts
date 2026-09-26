/** Cache in-memory TTL kecil untuk agregat yang mahal (mis. total diterima per item PO). */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

export async function memoize<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expiresAt > now) {
    return hit.value as T
  }
  const value = await factory()
  store.set(key, { value, expiresAt: now + ttlMs })
  return value
}

export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

export function cacheSize(): number {
  return store.size
}
