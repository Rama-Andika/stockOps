import { BADGE, LINE_SM, LINE_XS, roundUp4 } from '~/ui/virtual/row-metrics'

/**
 * Log entry on /diagnostics. The message and the JSON detail are both clamped to two lines; the
 * full detail leaves the device through the CSV export, which is the path the IT team actually
 * uses.
 *
 * border 2 + p-2 16 + badge row 28 + mt-1 4 + category 16 + mt-0.5 2 + message 2x20 + gap below 8
 * [ + mt-0.5 2 + session id 16 ] [ + mt-0.5 2 + detail 2x16 ]
 */
export function diagnosticsRowHeight(row: { hasSessionId: boolean; hasDetail: boolean }): number {
  let height = 2 + 16 + BADGE + 4 + LINE_XS + 2 + 2 * LINE_SM + 8
  if (row.hasSessionId) height += 2 + LINE_XS
  if (row.hasDetail) height += 2 + 2 * LINE_XS
  return roundUp4(height)
}
