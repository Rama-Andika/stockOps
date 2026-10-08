import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Button } from '~/ui/primitives'
import { formatDateTime } from '~/core/format'

/**
 * Asked when the operator presses "Mulai Penerimaan" on a PO they ALREADY have a running session
 * for — "dedupe sesi per PO". The duplicate it guards against is expensive and quiet: two documents
 * for one delivery, each holding part of the scanned qty, both pushed as separate `pos_receive`
 * rows that only the server's cross-document over-receive flagging would ever notice.
 *
 * A bottom sheet, built the same way as `LineEditSheet` in
 * `features/receiving/cockpit/line-edit-sheet.tsx` (scrim button outside the panel, `bg-sheet`
 * panel, manual Tab trap, Escape to close): that is the one dialog shape this project already
 * ships. It is allowed to be a sheet — unlike `SessionOwnerGate`,
 * which had to be a whole screen — because the PO detail screen behind it has no barcode field and
 * installs no scanner wedge, so there is no scanner focus for a dialog to steal. If this sheet is
 * ever reused inside the scan cockpit, that reasoning has to be redone.
 *
 * "Lanjutkan" takes the focus on mount because it is the safe answer: an operator who presses
 * Enter or the PDT's select key without reading gets the right outcome in the common case.
 *
 * The dangerous answer is deliberately a plain `Button`, not a `ConfirmButton`: the sheet IS the
 * confirmation, and a hold-to-confirm on top of it would punish the operator who genuinely has a
 * second delivery note in hand.
 */
export function DuplicateSessionSheet({
  purchaseLabel,
  createdAt,
  lineCount,
  onContinue,
  onCreateNew,
  onClose,
}: {
  /** PO number, or the raw id when the PO row carries no number. */
  purchaseLabel: string
  /** Tolerates `null` so a session row from an older build cannot blank out the sheet. */
  createdAt: string | null
  lineCount: number
  onContinue: () => void
  onCreateNew: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  /**
   * Focus the safe answer on the way in, and hand the focus back on the way out.
   *
   * Queried from the panel instead of passing a ref to `<Button>`: `ui/primitives.tsx` types that
   * component's props as `ButtonHTMLAttributes`, which does not include `ref`, and widening a
   * component used on every screen for the sake of one sheet is a bigger change than reading the
   * DOM node already held here. The continue button is the panel's first button — the scrim button
   * is a SIBLING of the panel, not a child.
   *
   * The cleanup is what makes every exit usable on a keypad. Without it, cancelling drops the focus
   * on `<body>`, so the next Enter does nothing and reaching "Mulai Penerimaan" again costs a Tab
   * walk past the back link, the PO card and every notice. `document.contains` is checked because
   * the trigger is gone when the sheet closes by navigating away.
   */
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const panel = dialogRef.current
    if (!panel) return
    const list = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled])'))
    if (list.length === 0) return
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement
    /**
     * Focus resting on the panel itself — which is where a tap on the sheet's heading or paragraph
     * puts it, thanks to `tabIndex={-1}` below — is not in the button list, and letting the browser
     * take it from there walks straight out of the dialog. Pull it back in instead.
     */
    if (!(active instanceof HTMLElement) || !list.includes(active)) {
      event.preventDefault()
      if (event.shiftKey) last?.focus()
      else first?.focus()
      return
    }
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    /* `onKeyDown` sits on the OUTER container, not on the panel: a React handler only sees events
       that pass through its own node, so one mounted on the panel alone goes deaf the moment the
       focus is anywhere else in the sheet — and Escape is the exit a PDT keypad reaches for first. */
    <div className="fixed inset-0 z-40 flex flex-col justify-end" onKeyDown={handleKeyDown}>
      {/* `tabIndex={-1}`: the scrim duplicates "Batal" and Escape, so it stays clickable and stays
          in the accessibility tree, but it must not be the tab stop that sits BEFORE the panel in
          document order — from there Shift+Tab leaves the dialog for the screen behind it. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Tutup konfirmasi sesi ganda"
        className="absolute inset-0 bg-scrim/60"
        onClick={onClose}
      />
      {/* `tabIndex={-1}` makes the panel itself focusable, so a tap on its text parks the focus here
          instead of on `<body>`, where no keystroke would reach the handler above. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-session-title"
        tabIndex={-1}
        className="relative rounded-t-2xl border-t border-line bg-sheet p-4 pb-[env(safe-area-inset-bottom)] focus:outline-none"
      >
        <h2 id="duplicate-session-title" className="text-lg font-bold text-fg">
          Sesi untuk PO ini sudah ada
        </h2>
        <p className="mt-1 text-base text-fg-soft">
          Kamu masih punya sesi berjalan untuk {purchaseLabel}. Lanjutkan sesi itu supaya barang
          yang sama tidak tercatat dua kali.
        </p>
        {/* The qty count and the timestamp are what let an operator recognise the session as theirs
            without leaving this screen. `createdAt` is omitted rather than printed as "-" so a row
            from an older build reads as "we do not know", not as a broken date. */}
        <p className="mt-1 text-sm text-fg-subtle">
          {lineCount} item sudah discan{createdAt ? ` · dibuat ${formatDateTime(createdAt)}` : ''}.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button className="w-full" onClick={onContinue}>
            Lanjutkan sesi berjalan
          </Button>
          <Button variant="secondary" className="w-full" onClick={onCreateNew}>
            Buat dokumen baru
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Batal
          </Button>
        </div>
      </div>
    </div>
  )
}
