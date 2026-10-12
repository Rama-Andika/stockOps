import { getStorageKey } from '~/core/base-path'

export const CURRENT_USER_KEY = getStorageKey('stockops.currentUser')

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}
