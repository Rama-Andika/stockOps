import { useLiveQuery } from 'dexie-react-hooks'

/**
 * Pembungkus `useLiveQuery` yang aman untuk prerender SPA di Node:
 * saat `indexedDB` tidak tersedia, querier tidak dijalankan dan nilai awal
 * (fallback) dikembalikan.
 */
export function useLive<T>(
  querier: () => Promise<T>,
  deps: readonly unknown[],
  fallback: T,
): T {
  const result = useLiveQuery(
    () => (typeof indexedDB === 'undefined' ? Promise.resolve(fallback) : querier()),
    deps as unknown[],
    fallback,
  )
  return (result ?? fallback) as T
}
