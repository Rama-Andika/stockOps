import { useLiveQuery } from 'dexie-react-hooks'

/**
 * Wrapper for `useLiveQuery` that is safe for SPA prerendering in Node:
 * when `indexedDB` is unavailable, the querier is not executed and the initial value
 * (fallback) is returned.
 */
export function useLive<T>(querier: () => Promise<T>, deps: readonly unknown[], fallback: T): T {
  const result = useLiveQuery(
    () => (typeof indexedDB === 'undefined' ? Promise.resolve(fallback) : querier()),
    deps as unknown[],
    fallback,
  )
  return (result ?? fallback) as T
}
