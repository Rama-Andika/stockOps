import type { StateCreator } from 'zustand'
import type { AppBootstrapState, AppState } from '~/app/store/types'

/**
 * How long "Nanti" silences the update banner. Short enough that a build rolled out mid-shift
 * still reaches the operator, long enough not to nag: the offer comes back at most a handful of
 * times per shift, and in the scan cockpit it is the only interruption the app bar ever makes.
 */
export const UPDATE_SNOOZE_MS = 15 * 60_000

export const createAppSlice: StateCreator<AppState, [], [], AppBootstrapState> = (set) => ({
  ready: false,
  setReady: (ready) => set({ ready }),
  updateReady: false,
  updateSnoozed: false,
  markUpdateReady: () => set({ updateReady: true }),
  snoozeUpdate: () => {
    set({ updateSnoozed: true })
    // A plain timer, not a stored timestamp. A timestamp would still need something to re-render
    // the banner once it expires, and this IS that something.
    //
    // The guard is `typeof window`, NOT the store's usual `isBrowser()`. `isBrowser()` also
    // demands IndexedDB, which is the right question everywhere else in this store but the wrong
    // one here: all this needs is `setTimeout`. With `isBrowser()` a browser whose IndexedDB is
    // blocked would silently never arm the timer, and "Nanti" would become PERMANENT for that app
    // session. All that must be kept out is the SPA prerender in Node, where there is no `window`.
    //
    // Deliberately never cleared: the store outlives every component, and a `set` arriving late
    // on a live store is harmless (it writes the value the state already has).
    if (typeof window === 'undefined') return
    window.setTimeout(() => set({ updateSnoozed: false }), UPDATE_SNOOZE_MS)
  },
  clearUpdateSnooze: () => set({ updateSnoozed: false }),
})
