/**
 * The shared metrics behind every computed row height in the virtualised lists, in CSS pixels.
 *
 * Virtualisation here does not measure anything: the height of a row is COMPUTED from its data and
 * then FORCED on the row with an inline style. That buys a precise scrollbar and not one
 * ResizeObserver per row — which matters on a PDT — at the price of these numbers having to be
 * kept in step with the markup by hand.
 *
 * Two rules make that safe, and both live here rather than in a feature because they are what
 * keeps the row heights of DIFFERENT screens consistent with one another:
 *
 * 1. EVERY line of text inside a virtual row carries an explicit `leading-*`. `src/styles/app.css`
 *    sets `body { font-size: 18px }` without a line-height, so an element with no text-size class
 *    inherits 18px with `line-height: normal` — a value the font and the WebView version decide.
 *    The constants below name the class each one maps to.
 * 2. Every total is rounded UP to a multiple of 4. The only visible failure is a height that is
 *    too SMALL (text clipped by `overflow-hidden`); a height that is too large shows as a few
 *    pixels of card padding, which nobody can see.
 *
 * The heights themselves are NOT here. Each feature owns its own `row-heights.ts` next to the rows
 * it describes, because one file that knows about PO cards, session lines, picker rows AND log
 * entries at the same time is a hidden coupling point between four features.
 * `tests/unit/row-heights.test.ts` locks the arithmetic of all of them in one place.
 */

/** `text-lg` + `leading-7`. */
export const LINE_LG = 28
/** Inherited 18px body text + `leading-6`. */
export const LINE_BASE = 24
/** `text-sm` + `leading-5`. */
export const LINE_SM = 20
/** `text-xs` or `text-[11px]` + `leading-4`. */
export const LINE_XS = 16
/** `Badge` from ui/primitives.tsx: py-1 (8) plus one `text-sm` line (20). */
export const BADGE = 28
/** `SegmentedProgress` inside the fixed `h-9 overflow-hidden` box its callers wrap it in. */
export const PROGRESS = 36

export function roundUp4(value: number): number {
  return Math.ceil(value / 4) * 4
}
