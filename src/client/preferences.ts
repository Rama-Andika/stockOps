/** Device preferences configurable by operators/IT on the Settings screen. */

export interface Preferences {
  /** 'pad' = numeric keypad starts open; 'keyboard' = use PDT physical keyboard. */
  qtyInput: 'pad' | 'keyboard'
  /** Beep sound on scan success/reject. */
  feedbackBeep: boolean
  /** Vibration on scan success/reject. */
  feedbackVibrate: boolean
  /** Solid surfaces + stronger borders, for a bright loading dock. */
  highContrast: boolean
}

const STORAGE_KEY = 'stockops.preferences'

const DEFAULTS: Preferences = {
  qtyInput: 'keyboard',
  feedbackBeep: true,
  feedbackVibrate: true,
  highContrast: false,
}

/** Read preferences from localStorage. Safe to call during prerender (without `window`). */
export function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return { ...DEFAULTS }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }

    const value = parsed as Partial<Preferences>
    return {
      qtyInput: value.qtyInput === 'pad' ? 'pad' : 'keyboard',
      feedbackBeep: typeof value.feedbackBeep === 'boolean' ? value.feedbackBeep : DEFAULTS.feedbackBeep,
      feedbackVibrate:
        typeof value.feedbackVibrate === 'boolean' ? value.feedbackVibrate : DEFAULTS.feedbackVibrate,
      highContrast:
        typeof value.highContrast === 'boolean' ? value.highContrast : DEFAULTS.highContrast,
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
