import { describe, expect, it } from 'vitest'
import {
  evaluateLine,
  evaluateSession,
  progressOf,
} from '~/shared/over-receive'
import { PROGRESS_STATUS } from '~/shared/constants'

describe('evaluateLine', () => {
  const ordered = new Map([['PI-1', 10]])
  const already = new Map([['PI-1', 6]])

  it('lolos bila total masih <= dipesan', () => {
    const result = evaluateLine({ purchaseItemId: 'PI-1', qty: 4 }, ordered, already)
    expect(result.newTotal).toBe(10)
    expect(result.overReceive).toBe(false)
    expect(result.excess).toBe(0)
  })

  it('menandai over-receive dan menghitung kelebihan (Skenario B)', () => {
    // Device 1 receives 6, device 2 receives 5, ordered 10 -> total 11 > 10
    const result = evaluateLine({ purchaseItemId: 'PI-1', qty: 5 }, ordered, already)
    expect(result.newTotal).toBe(11)
    expect(result.overReceive).toBe(true)
    expect(result.excess).toBe(1)
  })

  it('tidak ada toleransi: kelebihan 0.01 tetap over-receive (BR-5)', () => {
    const result = evaluateLine({ purchaseItemId: 'PI-1', qty: 4.01 }, ordered, already)
    expect(result.overReceive).toBe(true)
    expect(result.excess).toBe(0.01)
  })

  it('item tanpa data pesanan dianggap over-receive (0 dipesan)', () => {
    const result = evaluateLine({ purchaseItemId: 'UNKNOWN', qty: 1 }, ordered, already)
    expect(result.orderedQty).toBe(0)
    expect(result.overReceive).toBe(true)
    expect(result.excess).toBe(1)
  })
})

describe('evaluateSession', () => {
  const ordered = [
    { purchaseItemId: 'A', orderedQty: 10 },
    { purchaseItemId: 'B', orderedQty: 5 },
  ]
  const already = [
    { purchaseItemId: 'A', receivedQty: 10 },
    { purchaseItemId: 'B', receivedQty: 0 },
  ]

  it('menggabungkan hasil lintas dokumen/device', () => {
    const summary = evaluateSession(
      [
        { purchaseItemId: 'A', qty: 1 },
        { purchaseItemId: 'B', qty: 3 },
      ],
      ordered,
      already,
    )
    expect(summary.overReceive).toBe(true)
    expect(summary.excessTotal).toBe(1)
    expect(summary.overReceiveLineIds).toEqual(['A'])
    expect(summary.sessionTotal).toBe(4)
    expect(summary.previousTotal).toBe(10)
    expect(summary.newTotal).toBe(14)
  })

  it('agregasi receivedQty duplikat untuk item yang sama', () => {
    const summary = evaluateSession(
      [{ purchaseItemId: 'B', qty: 1 }],
      ordered,
      [
        { purchaseItemId: 'B', receivedQty: 2 },
        { purchaseItemId: 'B', receivedQty: 2 },
      ],
    )
    expect(summary.lines[0]?.previousQty).toBe(4)
    expect(summary.lines[0]?.newTotal).toBe(5)
    expect(summary.overReceive).toBe(false)
  })

  it('sesi kosong aman', () => {
    const summary = evaluateSession([], ordered, already)
    expect(summary.overReceive).toBe(false)
    expect(summary.lines).toEqual([])
  })
})

describe('progressOf', () => {
  it('NONE saat belum ada penerimaan', () => {
    expect(progressOf(10, 0)).toBe(PROGRESS_STATUS.NONE)
  })
  it('PARTIAL saat sebagian', () => {
    expect(progressOf(10, 4)).toBe(PROGRESS_STATUS.PARTIAL)
  })
  it('FULL saat tepat', () => {
    expect(progressOf(10, 10)).toBe(PROGRESS_STATUS.FULL)
  })
  it('OVER saat melebihi', () => {
    expect(progressOf(10, 11)).toBe(PROGRESS_STATUS.OVER)
  })
})
