import { loadPreferences, savePreferences, type Theme } from '~/platform/preferences'

/**
 * The device's colour theme, as a module singleton with subscribers — the same shape as
 * src/platform/toast.ts and src/platform/scan-focus.ts.
 *
 * It is a singleton and not component state because the SAME switch exists in two places that are
 * never in one React subtree: the icon in the app bar (src/app/theme-toggle.tsx, owned by
 * AppShell) and the row in Pengaturan (owned by the /settings route). With local state the app-bar
 * icon would keep showing whatever it read when it mounted, long after Pengaturan changed it.
 *
 * It is NOT in the zustand store on purpose: the theme has to be on <html> BEFORE React mounts at
 * all (see the inline script in src/routes/__root.tsx), so its real home is the document, and the
 * store would only be a second copy of it.
 */

/**
 * Browser/OS chrome colour per theme, for the `theme-color` meta tag. These are hex, and
 * deliberately so: a meta tag cannot read var(), so they APPROXIMATE --color-ground in
 * src/styles/app.css and must be changed together with it. (The PWA manifest keeps its own copy:
 * it is read at install time and cannot follow a runtime switch, so it carries the DEFAULT theme's
 * colour.)
 */
const THEME_COLOR: Record<Theme, string> = {
  dark: '#0b1220',
  light: '#e2e8f0',
}

/**
 * Read at module load, not left at a hard-coded default: on the client this module is first
 * imported during hydration, when localStorage is already readable, so the app-bar icon renders
 * with the right face on its very first paint. During prerender in Node there is no window and
 * `loadPreferences` returns the defaults.
 */
let theme: Theme = loadPreferences().theme
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function apply(next: Theme): void {
  if (typeof document === 'undefined') return
  // Dark is the absence of the attribute, not `data-theme="dark"`. That keeps the dark theme
  // exactly as it was — plain `:root`. Light being the DEFAULT does not change that: the inline
  // script in __root.tsx sets the attribute up front and removes it only for a stored 'dark'.
  if (next === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')
  // Keeps the Android status bar in step with the page. `?.` because the tag is absent in tests
  // and in any document that did not come from __root.tsx — a missing meta tag is not an error.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next])
}

/**
 * Read the stored theme and apply it. Called once from AppShell's mount effect, which is what
 * makes this module agree with whatever the inline script already put on <html>. It notifies
 * subscribers too: the app-bar button renders BEFORE that effect runs, so without the notification
 * a device whose stored theme differs from this module's value would show a stale icon.
 *
 * Safe during prerender in Node (no document), where `apply` does nothing.
 */
export function applyThemePreference(): void {
  theme = loadPreferences().theme
  apply(theme)
  emit()
}

export function getTheme(): Theme {
  return theme
}

/**
 * Snapshot for useSyncExternalStore's server/prerender pass. A constant on purpose: prerender has
 * no localStorage, so `loadPreferences()` returns the defaults there — and this must name the SAME
 * theme those defaults do, or the server snapshot disagrees with this module's own value and the
 * app-bar button renders the wrong face on the first paint. It moves when DEFAULTS.theme moves.
 */
export function getServerTheme(): Theme {
  return 'light'
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Switch the theme, persist it, and notify every screen that shows the switch. */
export function setTheme(next: Theme): void {
  theme = next
  savePreferences({ ...loadPreferences(), theme: next })
  apply(next)
  emit()
}
