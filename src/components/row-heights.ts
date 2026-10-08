/**
 * Row heights for the virtualised lists, in CSS pixels.
 *
 * Virtualisation here does not measure anything: the height of a row is COMPUTED from its data and
 * then FORCED on the row with an inline style. That buys a precise scrollbar and not one
 * ResizeObserver per row — which matters on a PDT — at the price of these numbers having to be
 * kept in step with the markup by hand. tests/unit/row-heights.test.ts locks them, and every
 * screen's step in the plan lists the exact classes each line of text must carry.
 *
 * Two rules make that safe:
 *
 * 1. EVERY line of text inside a virtual row carries an explicit `leading-*`. `src/styles/app.css`
 *    sets `body { font-size: 18px }` without a line-height, so an element with no text-size class
 *    inherits 18px with `line-height: normal` — a value the font and the WebView version decide.
 *    The constants below name the class each one maps to.
 * 2. Every total is rounded UP to a multiple of 4. The only visible failure is a height that is
 *    too SMALL (text clipped by `overflow-hidden`); a height that is too large shows as a few
 *    pixels of card padding, which nobody can see.
 */

/** `text-lg` + `leading-7`. */
const LINE_LG = 28
/** Inherited 18px body text + `leading-6`. */
const LINE_BASE = 24
/** `text-sm` + `leading-5`. */
const LINE_SM = 20
/** `text-xs` or `text-[11px]` + `leading-4`. */
const LINE_XS = 16
/** `Badge` from ui.tsx: py-1 (8) plus one `text-sm` line (20). */
const BADGE = 28
/** `SegmentedProgress` inside the fixed `h-9 overflow-hidden` box its callers wrap it in. */
const PROGRESS = 36

function roundUp4(value: number): number {
  return Math.ceil(value / 4) * 4
}

/**
 * PO card on /pos. One height for every card: the number, the vendor and the date are all
 * `truncate`, and the progress line lives in a fixed box.
 *
 * border 2 + p-3 24 + number 28 + vendor 24 + date 20 + mt-3 12 + progress 36 + gap below 12
 */
export const PO_CARD_HEIGHT = roundUp4(
  2 + 24 + LINE_LG + LINE_BASE + LINE_SM + 12 + PROGRESS + 12,
)

/**
 * PO line on /pos/$purchaseId. Two lines are RESERVED for the item name (`line-clamp-2`): that
 * name is what the operator matches against the box in their hands, so truncating it to one line
 * would defeat the screen.
 *
 * border-b 1 + py-3 24 + name 2x24 + code/unit 20 + gap-1 4 + progress 36
 */
export const PO_ITEM_ROW_HEIGHT = roundUp4(1 + 24 + 2 * LINE_BASE + LINE_SM + 4 + PROGRESS)

/**
 * Row in ItemPicker. Two lines reserved for the name, two for the qty line ("Sudah 12 di sesi ini
 * · 4 di sesi lain · 6 di sistem" does not fit one line at 360px), and two more for the "data
 * barang belum lengkap" warning when the master row is missing.
 *
 * border-b 1 + py-3 24 + name 2x24 + code 20 + qty 2x20 [ + warning 2x20 ]
 */
export function pickerRowHeight(row: { selectable: boolean }): number {
  const base = 1 + 24 + 2 * LINE_BASE + LINE_SM + 2 * LINE_SM
  return roundUp4(row.selectable ? base : base + 2 * LINE_SM)
}

/**
 * Session line in the scan cockpit.
 *
 * `convFound === false` appends "• konversi tidak ditemukan (faktor 1)" to the code line, which
 * pushes it to a second line; `hasOrderedLine` is the "Dipesan N" line, rendered only when the PO
 * line could be resolved.
 *
 * border-b 1 + py-3 24 + name 2x24 + code 20 + stock-unit 20 [ + code wrap 20 ] [ + ordered 20 ]
 */
export function sessionLineRowHeight(row: {
  convFound: boolean
  hasOrderedLine: boolean
}): number {
  let height = 1 + 24 + 2 * LINE_BASE + LINE_SM + LINE_SM
  if (!row.convFound) height += LINE_SM
  if (row.hasOrderedLine) height += LINE_SM
  return roundUp4(height)
}

/**
 * Log entry on /diagnostics. The message and the JSON detail are both clamped to two lines; the
 * full detail leaves the device through the CSV export, which is the path the IT team actually
 * uses.
 *
 * border 2 + p-2 16 + badge row 28 + mt-1 4 + category 16 + mt-0.5 2 + message 2x20 + gap below 8
 * [ + mt-0.5 2 + session id 16 ] [ + mt-0.5 2 + detail 2x16 ]
 */
export function diagnosticsRowHeight(row: {
  hasSessionId: boolean
  hasDetail: boolean
}): number {
  let height = 2 + 16 + BADGE + 4 + LINE_XS + 2 + 2 * LINE_SM + 8
  if (row.hasSessionId) height += 2 + LINE_XS
  if (row.hasDetail) height += 2 + 2 * LINE_XS
  return roundUp4(height)
}

/**
 * Document row on /sessions. The status sentence is clamped to two lines because a rejection
 * reason is a whole sentence; the server's own error text and the over-receive line get two lines
 * each as well, and both are only present on the states that carry them.
 *
 * border 2 + p-3 24 + number/badge row 28 + vendor 20 + status 2x20 + gap below 8
 * [ + owner 20 ] [ + server error 2x20 ] [ + over-receive 2x20 ]
 */
export function sessionStatusRowHeight(row: {
  hasForeignOwner: boolean
  hasFailureText: boolean
  hasOverReceive: boolean
}): number {
  let height = 2 + 24 + BADGE + LINE_SM + 2 * LINE_SM + 8
  if (row.hasForeignOwner) height += LINE_SM
  if (row.hasFailureText) height += 2 * LINE_SM
  if (row.hasOverReceive) height += 2 * LINE_SM
  return roundUp4(height)
}
