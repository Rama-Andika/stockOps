import { BADGE, LINE_BASE, LINE_SM, roundUp4 } from '~/ui/virtual/row-metrics'

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
export function sessionLineRowHeight(row: { convFound: boolean; hasOrderedLine: boolean }): number {
  let height = 1 + 24 + 2 * LINE_BASE + LINE_SM + LINE_SM
  if (!row.convFound) height += LINE_SM
  if (row.hasOrderedLine) height += LINE_SM
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
