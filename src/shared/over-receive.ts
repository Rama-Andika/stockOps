/**
 * Perhitungan over-receive (BR-5, BR-6, FR-6.1, FR-5.4).
 *
 * Aturan: TOTAL qty semua penerimaan untuk satu item PO tidak boleh melebihi
 * qty yang dipesan item PO tersebut. Perbandingan memakai satuan yang sama
 * (satuan PO). Dihitung lintas semua dokumen/device => ini fungsi murni yang
 * menerima snapshot "sudah diterima" dari server.
 */

import { PROGRESS_STATUS, type ProgressStatus } from './constants'
import { dec2, gtDec2, sumDec2 } from './num'

export interface OrderedLine {
  purchaseItemId: string
  orderedQty: number
}

export interface ReceiveLine {
  purchaseItemId: string
  qty: number
}

export interface AlreadyReceivedLine {
  purchaseItemId: string
  receivedQty: number
}

export interface LineEvaluation {
  purchaseItemId: string
  orderedQty: number
  previousQty: number
  sessionQty: number
  newTotal: number
  overReceive: boolean
  excess: number
}

export interface SessionEvaluationSummary {
  lines: LineEvaluation[]
  orderedTotal: number
  previousTotal: number
  sessionTotal: number
  newTotal: number
  overReceive: boolean
  excessTotal: number
  overReceiveLineIds: string[]
}

function toMap(lines: readonly OrderedLine[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const line of lines) {
    map.set(line.purchaseItemId, dec2(line.orderedQty))
  }
  return map
}

function receivedMap(lines: readonly AlreadyReceivedLine[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const line of lines) {
    map.set(line.purchaseItemId, dec2((map.get(line.purchaseItemId) ?? 0) + dec2(line.receivedQty)))
  }
  return map
}

/** Evaluasi satu baris penerimaan. */
export function evaluateLine(
  line: ReceiveLine,
  ordered: Map<string, number>,
  already: Map<string, number>,
): LineEvaluation {
  const orderedQty = ordered.get(line.purchaseItemId) ?? 0
  const previousQty = already.get(line.purchaseItemId) ?? 0
  const sessionQty = dec2(line.qty)
  const newTotal = dec2(previousQty + sessionQty)
  const overReceive = gtDec2(newTotal, orderedQty)
  return {
    purchaseItemId: line.purchaseItemId,
    orderedQty,
    previousQty,
    sessionQty,
    newTotal,
    overReceive,
    excess: overReceive ? dec2(newTotal - orderedQty) : 0,
  }
}

/** Evaluasi seluruh baris satu sesi. */
export function evaluateSession(
  lines: readonly ReceiveLine[],
  ordered: readonly OrderedLine[],
  already: readonly AlreadyReceivedLine[],
): SessionEvaluationSummary {
  const orderedMap = toMap(ordered)
  const alreadyMap = receivedMap(already)
  const evaluations = lines.map((line) => evaluateLine(line, orderedMap, alreadyMap))

  const overReceiveLines = evaluations.filter((line) => line.overReceive)
  return {
    lines: evaluations,
    orderedTotal: sumDec2(evaluations.map((line) => line.orderedQty)),
    previousTotal: sumDec2(evaluations.map((line) => line.previousQty)),
    sessionTotal: sumDec2(evaluations.map((line) => line.sessionQty)),
    newTotal: sumDec2(evaluations.map((line) => line.newTotal)),
    overReceive: overReceiveLines.length > 0,
    excessTotal: sumDec2(evaluations.map((line) => line.excess)),
    overReceiveLineIds: overReceiveLines.map((line) => line.purchaseItemId),
  }
}

/** FR-3.2: status kemajuan PO berdasarkan total dipesan vs total diterima. */
export function progressOf(orderedTotal: number, receivedTotal: number): ProgressStatus {
  const ordered = dec2(orderedTotal)
  const received = dec2(receivedTotal)
  if (gtDec2(received, ordered)) return PROGRESS_STATUS.OVER
  if (received <= 0) return PROGRESS_STATUS.NONE
  if (gtDec2(ordered, received)) return PROGRESS_STATUS.PARTIAL
  return PROGRESS_STATUS.FULL
}
