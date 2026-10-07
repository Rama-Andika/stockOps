import { RefreshCw, X } from 'lucide-react'
import { localRepo } from '~/client/db/local-repo'
import { useLive } from '~/client/hooks/use-live'
import { activateUpdate } from '~/client/pwa'
import { requestScanFocus } from '~/client/scan-focus'
import { useAppStore } from '~/client/state/store/app-store'
import { ConfirmButton } from './confirm-button'
import { Button } from './ui'

/**
 * "Versi baru siap" — the one place where a deployed build becomes the operator's decision.
 *
 * It lives in the app bar (TopBar in app-shell.tsx) and shares ONE row with `SyncStatus`, which
 * always wins; that is why this component carries no padding of its own beyond the row's
 * `px-3 pb-2`, copied from `SyncStatus`: it is standing in the same slot.
 *
 * It renders on EVERY screen, the scan cockpit included. Two consequences are load-bearing:
 *
 *  - Height. While the row was empty — the normal case during scanning — this adds one row to the
 *    app bar, so the cockpit's middle section, its only scroller, gets that much shorter. The scan
 *    field and the tab bar live in the cockpit's own `shrink-0` footer and cannot be pushed off
 *    screen, so the loop keeps working; it just has less room for the item list. That trade is the
 *    price of showing the offer everywhere, and it was chosen deliberately.
 *  - Focus. Every button here is a focusable element INSIDE the scan screen. "Nanti" therefore
 *    hands the focus back to the barcode field through `requestScanFocus()`, or the scanner's
 *    closing Enter would press this button again instead of submitting a scan. "Muat ulang" needs
 *    no such thing — the page is about to be replaced.
 */
export function UpdateBanner() {
  const updateReady = useAppStore((state) => state.updateReady)
  const updateSnoozed = useAppStore((state) => state.updateSnoozed)

  // Gate and body are TWO components on purpose, and the split is load-bearing. The body's
  // `useLive` subscribes to the `sessions` table, and `addOrIncrementLine` writes that table via
  // `touchSession` on EVERY scan (src/client/db/local-repo.ts) — so a subscription mounted up
  // here would cost one IndexedDB query plus one render of this component per scan, throughout
  // the 99% of the time the banner is not shown at all. That is exactly the cost `pickerDetail`
  // in routes/sessions/$sessionId.tsx refuses: "the scan loop must not pay for a list it is not
  // showing". Merging these two back into one component brings it straight back.
  if (!updateReady || updateSnoozed) return null

  return <UpdateBannerBody />
}

function UpdateBannerBody() {
  const snoozeUpdate = useAppStore((state) => state.snoozeUpdate)
  const pendingCount = useAppStore((state) => state.pendingCount)
  // Device-level on purpose, exactly like the outbox it sits next to: the question is "is this PDT
  // in the middle of something", not "is the CURRENT operator". A colleague's running session is
  // just as good a reason to make this operator stop and read the button.
  const runningCount = useLive(async () => (await localRepo.runningSessions()).length, [], 0)

  /**
   * One short reason, not a list: it has to fit inside the button while the operator is holding
   * it, on a 360px screen.
   *
   * The `pendingCount` branch is currently SHADOWED by the row-sharing rule in `TopBar` — a
   * non-empty outbox makes `SyncStatus` win, and then this banner does not render at all. It
   * stays because it is the honest condition: whoever reverses that priority later should not
   * also have to rediscover that a pending outbox deserves a confirmation.
   *
   * The screen that DOES have to know about that shadow is Pengaturan: its "Cek Pembaruan" toast
   * would otherwise send the operator looking for a button this row is hiding. See
   * `handleCheckUpdate` in routes/settings.tsx.
   */
  const heldReason =
    pendingCount > 0
      ? `${pendingCount} dokumen belum terkirim`
      : runningCount > 0
        ? 'ada sesi yang masih berjalan'
        : null

  const handleSnooze = () => {
    snoozeUpdate()
    requestScanFocus()
  }

  return (
    <div className="flex items-center justify-between gap-2 px-3 pb-2">
      {/* `role="status"` belongs on the TEXT, not on this container. As a live region the
          container would also contain the two buttons, and `ConfirmButton` rewrites its own label
          while the operator arms it ("Muat ulang" → "Tekan lagi untuk mengonfirmasi") — so every
          arming would be announced all over again, unasked. */}
      <span
        role="status"
        className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-info-text"
      >
        <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Versi baru siap</span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {/* Both branches are 56px tall (`touch-target`, see src/styles/app.css), so switching
            between them never moves the layout — which is the only reason the confirmation is
            allowed to be conditional at all.

            No colour, width or padding class is passed to ConfirmButton: it carries all of them
            itself, and Tailwind v4 resolves such conflicts by stylesheet order rather than by the
            order written here. */}
        {heldReason ? (
          <ConfirmButton
            tone="primary"
            className="shrink-0 font-semibold"
            label="Muat ulang"
            confirmLabel={`Tahan terus… ${heldReason}`}
            onConfirm={activateUpdate}
          />
        ) : (
          <Button variant="primary" className="shrink-0" onClick={activateUpdate}>
            Muat ulang
          </Button>
        )}
        <button
          type="button"
          aria-label="Nanti — sembunyikan tawaran ini 15 menit"
          className="touch-target w-14 shrink-0 rounded-lg bg-control text-fg transition hover:bg-control-off"
          onClick={handleSnooze}
        >
          <X className="mx-auto h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
