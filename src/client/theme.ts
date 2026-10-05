import { loadPreferences } from './preferences'

/**
 * Applies the contrast preference to <html> as data-contrast. Safe to call during
 * prerender in Node (no document), where it does nothing.
 */
export function applyContrastPreference(): void {
  if (typeof document === 'undefined') return
  const { highContrast } = loadPreferences()
  if (highContrast) document.documentElement.setAttribute('data-contrast', 'high')
  else document.documentElement.removeAttribute('data-contrast')
}
