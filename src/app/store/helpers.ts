export const CURRENT_USER_KEY = 'stockops.currentUser'

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}
