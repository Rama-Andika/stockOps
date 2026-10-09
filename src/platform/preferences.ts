/** Device preferences configurable by operators/IT on the Settings screen. */

export type Theme = 'dark' | 'light'

export interface Preferences {
  /** Beep sound on scan success/reject. */
  feedbackBeep: boolean
  /** Vibration on scan success/reject. */
  feedbackVibrate: boolean
  /**
   * Colour theme, applied as `data-theme` on <html> by src/platform/theme.ts.
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
  /**
   * Keep the on-screen keyboard from opening on the scan bar's two fields: the barcode field and
   * the qty field (`ScanBar` sets `inputMode="none"` on both).
   *
   * Default OFF, so a device that is updated in the field behaves exactly as before and IT turns
   * it on per PDT. It lives in the app instead of in Android settings because the Android toggle
   * ("show the on-screen keyboard") was greyed out on the Sunmi PDT this was written for.
   *
   * It only asks the browser not to open the SOFT keyboard. The fields stay focusable, enabled and
   * writable — the scanner types into them like a physical keyboard — and qty entry still has the
   * "123" keypad. Fields where typing is the whole point (login, search, invoice/DO) never read it.
   */
  hideScanKeyboard: boolean
}

const STORAGE_KEY = 'stockops.preferences'

const DEFAULTS: Preferences = {
  feedbackBeep: true,
  feedbackVibrate: true,
  theme: 'light',
  manualPick: true,
  hideScanKeyboard: false,
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
      feedbackBeep:
        typeof value.feedbackBeep === 'boolean' ? value.feedbackBeep : DEFAULTS.feedbackBeep,
      feedbackVibrate:
        typeof value.feedbackVibrate === 'boolean'
          ? value.feedbackVibrate
          : DEFAULTS.feedbackVibrate,
      // A missing or unrecognised value reads as the default theme, which is LIGHT. A device set
      // up before this key existed therefore moves to light on the next update — accepted
      // knowingly: light is the bright-dock mode this app is built for, and an operator who wants
      // dark has the switch in the app bar and in Pengaturan.
      theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : DEFAULTS.theme,
      // Same treatment as every other key here: missing reads as the default, ON — the one that
      // leaves the feature discoverable.
      manualPick: typeof value.manualPick === 'boolean' ? value.manualPick : DEFAULTS.manualPick,
      // Same treatment as every other key here: a missing or non-boolean value reads as the
      // default, which is OFF — a device that never touched this switch keeps its soft keyboard.
      hideScanKeyboard:
        typeof value.hideScanKeyboard === 'boolean'
          ? value.hideScanKeyboard
          : DEFAULTS.hideScanKeyboard,
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
