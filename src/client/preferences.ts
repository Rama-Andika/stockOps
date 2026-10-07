/** Device preferences configurable by operators/IT on the Settings screen. */

export interface Preferences {
  /** Beep sound on scan success/reject. */
  feedbackBeep: boolean
  /** Vibration on scan success/reject. */
  feedbackVibrate: boolean
  /** Solid surfaces + stronger borders, for a bright loading dock. */
  highContrast: boolean
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
  highContrast: false,
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

    // Unknown keys left behind by older versions (e.g. the removed `qtyInput`) are ignored:
    // only the fields listed here are read back.
    const value = parsed as Partial<Preferences>
    return {
      feedbackBeep: typeof value.feedbackBeep === 'boolean' ? value.feedbackBeep : DEFAULTS.feedbackBeep,
      feedbackVibrate:
        typeof value.feedbackVibrate === 'boolean' ? value.feedbackVibrate : DEFAULTS.feedbackVibrate,
      highContrast:
        typeof value.highContrast === 'boolean' ? value.highContrast : DEFAULTS.highContrast,
      // A device that was set up before this key existed reads as the default, ON — the same
      // treatment every other key here gets, and the one that leaves the feature discoverable.
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
