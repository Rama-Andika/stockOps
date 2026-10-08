import { describe, expect, it } from 'vitest'
import { evaluateLine, evaluateSession, progressOf } from '~/core/receiving/over-receive'
import { PROGRESS_STATUS } from '~/core/contracts/constants'

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

  it('tidak ada toleransi: kelebihan 0.01 tetap over-receive', () => {
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
    const summary = evaluateSession([{ purchaseItemId: 'B', qty: 1 }], ordered, [
      { purchaseItemId: 'B', receivedQty: 2 },
      { purchaseItemId: 'B', receivedQty: 2 },
    ])
    expect(summary.lines[0]?.previousQty).toBe(4)
    expect(summary.lines[0]?.newTotal).toBe(5)
    expect(summary.overReceive).toBe(false)
  })

  it('mengakumulasi baris ganda untuk item PO yang sama dalam satu sesi', () => {
    const summary = evaluateSession(
      [
        { purchaseItemId: 'B', qty: 3 },
        { purchaseItemId: 'B', qty: 3 },
      ],
      ordered,
      already,
    )
    // B ordered 5, already 0: first line 3 (ok), second line 3 -> total 6 (over by 1).
    expect(summary.lines[0]?.overReceive).toBe(false)
    expect(summary.lines[1]?.previousQty).toBe(3)
    expect(summary.lines[1]?.newTotal).toBe(6)
    expect(summary.lines[1]?.overReceive).toBe(true)
    expect(summary.lines[1]?.excess).toBe(1)
    expect(summary.excessTotal).toBe(1)
  })

  it('excessTotal tidak menghitung ganda saat baris ganda sudah over sejak baris pertama', () => {
    // B ordered 5, already 0, lines 3 + 3 + 3: totals 3, 6, 9 -> real excess is 4.
    const three = evaluateSession(
      [
        { purchaseItemId: 'B', qty: 3 },
        { purchaseItemId: 'B', qty: 3 },
        { purchaseItemId: 'B', qty: 3 },
      ],
      ordered,
      already,
    )
    expect(three.lines.map((line) => line.excess)).toEqual([0, 1, 3])
    expect(three.excessTotal).toBe(4)

    // B ordered 5: lines 6 + 2 -> first line already over by 1, real excess is 3.
    const overFirst = evaluateSession(
      [
        { purchaseItemId: 'B', qty: 6 },
        { purchaseItemId: 'B', qty: 2 },
      ],
      ordered,
      already,
    )
    expect(overFirst.lines.map((line) => line.excess)).toEqual([1, 2])
    expect(overFirst.excessTotal).toBe(3)
  })

  it('baris ganda yang sebelumnya sudah over di dokumen lain: total tetap = total akhir - dipesan', () => {
    // A ordered 10, already 10 (other documents); this session adds 2 + 3 -> final 15, excess 5.
    const summary = evaluateSession(
      [
        { purchaseItemId: 'A', qty: 2 },
        { purchaseItemId: 'A', qty: 3 },
      ],
      ordered,
      already,
    )
    expect(summary.excessTotal).toBe(5)
    expect(summary.lines[0]?.excess).toBe(2)
    expect(summary.lines[1]?.excess).toBe(3)
  })

  it('tanpa baris ganda, excess per baris tetap kumulatif seperti sebelumnya', () => {
    const summary = evaluateSession(
      [
        { purchaseItemId: 'A', qty: 1 },
        { purchaseItemId: 'B', qty: 3 },
      ],
      ordered,
      already,
    )
    expect(summary.lines.map((line) => line.excess)).toEqual([1, 0])
    expect(summary.excessTotal).toBe(1)
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
