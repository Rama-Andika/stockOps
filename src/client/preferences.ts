/** Preferensi perangkat yang bisa diatur operator/IT di layar Pengaturan. */

export interface Preferences {
  /** 'pad' = tampilkan keypad numerik di layar; 'keyboard' = pakai keyboard fisik PDT. */
  qtyInput: 'pad' | 'keyboard'
  /** Bunyi beep saat scan sukses/ditolak. */
  feedbackBeep: boolean
  /** Getar saat scan sukses/ditolak. */
  feedbackVibrate: boolean
}

const STORAGE_KEY = 'stockops.preferences'

const DEFAULTS: Preferences = {
  qtyInput: 'pad',
  feedbackBeep: true,
  feedbackVibrate: true,
}

/** Baca preferensi dari localStorage. Aman dipanggil saat prerender (tanpa `window`). */
export function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return { ...DEFAULTS }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }

    const value = parsed as Partial<Preferences>
    return {
      qtyInput: value.qtyInput === 'keyboard' ? 'keyboard' : 'pad',
      feedbackBeep: typeof value.feedbackBeep === 'boolean' ? value.feedbackBeep : DEFAULTS.feedbackBeep,
      feedbackVibrate:
        typeof value.feedbackVibrate === 'boolean' ? value.feedbackVibrate : DEFAULTS.feedbackVibrate,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Simpan preferensi ke localStorage. Aman dipanggil saat prerender (tanpa `window`). */
export function savePreferences(next: Preferences): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Preferensi bukan data kerja; kegagalan penyimpanan tidak boleh memblokir operator.
  }
}
