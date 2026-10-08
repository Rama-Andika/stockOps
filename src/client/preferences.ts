/** Device preferences configurable by operators/IT on the Settings screen. */

export type Theme = 'dark' | 'light'

export interface Preferences {
  /** Beep sound on scan success/reject. */
  feedbackBeep: boolean
  /** Vibration on scan success/reject. */
  feedbackVibrate: boolean
  /**
   * Colour theme, applied as `data-theme` on <html> by src/client/theme.ts.
   *
   * This replaced a `highContrast` flag, which was an override layer on top of the dark theme
   * rather than a theme of its own. There is deliberately NO third "high contrast" value: the
   * light theme IS the bright-dock mode now, and its text and border steps are picked so the
   * smallest text still clears WCAG AA on paper grey — see the `[data-theme='light']` block in
   * src/styles/app.css, where every step carries its measured ratio. The consequence, accepted
   * knowingly: there is no contrast booster left for the dark theme.
   */
  theme: Theme
  /**
   * Allow adding a session line by picking it from the PO item list instead of scanning it.
   *
   * Default ON: it is the only way to record goods whose barcode cannot be scanned. Per device, and
   * flippable by whoever holds the PDT — a mistake guard, not access control, like every other rule
   * in this app that runs on the device.
   */
  manualPick: boolean
}

const STORAGE_KEY = 'stockops.preferences'

const DEFAULTS: Preferences = {
  feedbackBeep: true,
  feedbackVibrate: true,
  theme: 'dark',
  manualPick: true,
}

/** Read preferences from localStorage. Safe to call during prerender (without `window`). */
export function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return { ...DEFAULTS }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }

    // Unknown keys left behind by older versions (the removed `qtyInput` and `highContrast`) are
    // ignored: only the fields listed here are read back. That is also why dropping a preference
    // needs no migration step anywhere — the key simply stops being read.
    const value = parsed as Partial<Preferences>
    return {
      feedbackBeep: typeof value.feedbackBeep === 'boolean' ? value.feedbackBeep : DEFAULTS.feedbackBeep,
      feedbackVibrate:
        typeof value.feedbackVibrate === 'boolean' ? value.feedbackVibrate : DEFAULTS.feedbackVibrate,
      // A device set up before this key existed reads as 'dark' — the theme it is already showing,
      // so an update never changes the screen under the operator's hands.
      theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : DEFAULTS.theme,
      // Same treatment as every other key here: missing reads as the default, ON — the one that
      // leaves the feature discoverable.
      manualPick: typeof value.manualPick === 'boolean' ? value.manualPick : DEFAULTS.manualPick,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Save preferences to localStorage. Safe to call during prerender (without `window`). */
export function savePreferences(next: Preferences): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Preferences are not working data; storage failure must not block the operator.
  }
}
