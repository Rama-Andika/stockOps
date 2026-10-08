/**
 * Deciding whether a session receives more of an item than was ordered.
 *
 * The rule: for one PO item, the qty of ALL receipts added together must not exceed the
 * ordered qty, both sides in the PO unit. Exceeding it is flagged and left for admin to
 * approve, never rejected — a delivery that is physically in the warehouse has to be
 * recordable, and there is currently no tolerance band.
 *
 * "All receipts" means every document from every device, which is why this is a pure function
 * fed an already-received snapshot instead of reading anything itself: the only place that
 * knows the real total is the server at sync time. The device can show a warning from its own
 * last pull, but it is an estimate, and two PDTs on one PO will each see less than the truth.
 */

import { PROGRESS_STATUS, type ProgressStatus } from '~/core/contracts/constants'
import { dec2, gtDec2, sumDec2 } from '~/core/money/num'

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

/** Evaluate a single receipt line. */
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

/** Evaluate all lines of a session. */
export function evaluateSession(
  lines: readonly ReceiveLine[],
  ordered: readonly OrderedLine[],
  already: readonly AlreadyReceivedLine[],
): SessionEvaluationSummary {
  const orderedMap = toMap(ordered)
  // Running total per PO item: a second line for the same item in this session starts
  // from the first line's new total, so duplicate lines cannot hide an over-receive.
  const runningMap = receivedMap(already)
  const seenInSession = new Set<string>()
  const evaluations = lines.map((line) => {
    const evaluation = evaluateLine(line, orderedMap, runningMap)
    runningMap.set(line.purchaseItemId, evaluation.newTotal)
    const repeated = seenInSession.has(line.purchaseItemId)
    seenInSession.add(line.purchaseItemId)
    if (!repeated || !evaluation.overReceive) return evaluation
    // A repeated line only reports the excess ADDED by itself. `excess` is cumulative
    // (newTotal - ordered), so summing it over duplicate lines would count the earlier
    // lines' excess again and inflate excessTotal. The first line of an item keeps the
    // cumulative meaning, so per item the lines add up to (final total - ordered).
    const alreadyOver = Math.max(evaluation.previousQty, evaluation.orderedQty)
    return { ...evaluation, excess: dec2(evaluation.newTotal - alreadyOver) }
  })

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

/**
 * PO progress from its ordered and received totals. Compared through gtDec2 rather than `>`
 * so a line that is short by a rounding artefact does not read as PARTIAL forever.
 */
export function progressOf(orderedTotal: number, receivedTotal: number): ProgressStatus {
  const ordered = dec2(orderedTotal)
  const received = dec2(receivedTotal)
  if (gtDec2(received, ordered)) return PROGRESS_STATUS.OVER
  if (received <= 0) return PROGRESS_STATUS.NONE
  if (gtDec2(ordered, received)) return PROGRESS_STATUS.PARTIAL
  return PROGRESS_STATUS.FULL
}
