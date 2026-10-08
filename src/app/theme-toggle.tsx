import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { requestScanFocus } from '~/platform/scan-focus'
import { getServerTheme, getTheme, setTheme, subscribeTheme } from '~/platform/theme'

/**
 * The theme switch in the app bar (TopBar in src/app/top-bar.tsx).
 *
 * THREE things about it are load-bearing:
 *
 *  - It sits in the TITLE row, not in the status row below it. That row is shared by `SyncStatus`
 *    and `UpdateBanner`, and `SyncStatus` always wins (`useSendStatus()` in sync-status.tsx is the
 *    single definition of "quiet", read by TopBar). A third tenant there would hide the "Kirim"
 *    button or the update offer. The title row is free at 360px, where the operator's name is
 *    hidden by `sm:inline`.
 *  - It is a 40px touch target that costs the layout NOTHING, and the negative margin is what
 *    makes that true. Do the arithmetic before changing either number. The title row is
 *    `items-center` with `py-2`, so its height is (tallest child) + 16px, and before this button
 *    existed the tallest child was 28px — both the `text-lg` wordmark (line-height 1.75rem) and
 *    the status pill (`text-sm` 20px + `py-1` 8px). That makes the row 44px. A bare `h-10` child
 *    is 40px, which would make the row 56px: +12px on EVERY screen, permanently, and what pays
 *    for it is the scan cockpit's height — the only scroller on a 640px screen, where 12px is
 *    about a third of a list row. `-my-1.5` (−6px top and bottom) brings the button's LAYOUT
 *    height back to 28px while the button itself stays 40×40 and fully tappable, so the row
 *    stays 44px. Dropping the margin, or reaching for `touch-target` (56px) "for consistency",
 *    silently takes that height away from the cockpit again.
 *  - It hands the focus back to the barcode field. This button renders on every screen, the scan
 *    cockpit included, so it is a focusable element INSIDE that screen — exactly the situation
 *    "Nanti" in UpdateBanner is in. Without `requestScanFocus()` the scanner's closing Enter would
 *    press this button again instead of submitting a scan, and the operator would watch the theme
 *    flip on every scan. That reads as a broken scanner, not as a focus bug.
 *
 * The theme comes from `useSyncExternalStore`, not `useState`, because the SAME switch also exists
 * in Pengaturan and the two are never in one subtree; a local copy here would go stale the moment
 * it is used there. See the header comment in src/platform/theme.ts.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme)
  const light = theme === 'light'

  return (
    <button
      type="button"
      aria-label={light ? 'Ganti ke tema gelap' : 'Ganti ke tema terang'}
      className="-my-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-fg-soft transition hover:bg-raised"
      onClick={() => {
        setTheme(light ? 'dark' : 'light')
        requestScanFocus()
      }}
    >
      {light ? (
        <Moon className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Sun className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  )
}
