import { describe, expect, it } from 'vitest'
import { diagnosticsRowHeight } from '~/features/diagnostics/row-heights'
import { PO_CARD_HEIGHT, PO_ITEM_ROW_HEIGHT } from '~/features/purchase-orders/row-heights'
import {
  pickerRowHeight,
  sessionLineRowHeight,
  sessionStatusRowHeight,
} from '~/features/receiving/row-heights'

/**
 * These numbers are a contract with the markup, not a calculation worth re-deriving here: the rows
 * are FORCED to this height with an inline style and clipped with `overflow-hidden`, so a height
 * that drifts below what the markup needs cuts text off on a PDT where nobody will file a bug.
 *
 * If a row's markup gains or loses a line of text, this file and the features' row-heights.ts files change together,
 * in the same step. A failure here means exactly that: somebody changed one of the two.
 */
describe('tinggi baris daftar tervirtualisasi', () => {
  it('semua tinggi adalah kelipatan 4 dan cukup untuk target sentuh 56px', () => {
    const every = [
      PO_CARD_HEIGHT,
      PO_ITEM_ROW_HEIGHT,
      pickerRowHeight({ selectable: true }),
      pickerRowHeight({ selectable: false }),
      sessionLineRowHeight({ convFound: true, hasOrderedLine: false }),
      sessionLineRowHeight({ convFound: false, hasOrderedLine: true }),
      diagnosticsRowHeight({ hasSessionId: false, hasDetail: false }),
      diagnosticsRowHeight({ hasSessionId: true, hasDetail: true }),
      sessionStatusRowHeight({
        hasForeignOwner: false,
        hasFailureText: false,
        hasOverReceive: false,
      }),
      sessionStatusRowHeight({
        hasForeignOwner: true,
        hasFailureText: true,
        hasOverReceive: true,
      }),
    ]
    for (const height of every) {
      expect(height % 4).toBe(0)
      expect(height).toBeGreaterThanOrEqual(56)
    }
  })

  it('kartu PO dan baris item PO punya satu tinggi tetap', () => {
    expect(PO_CARD_HEIGHT).toBe(160)
    expect(PO_ITEM_ROW_HEIGHT).toBe(136)
  })

  it('baris picker menyediakan dua baris ekstra hanya saat master barang hilang', () => {
    expect(pickerRowHeight({ selectable: true })).toBe(136)
    expect(pickerRowHeight({ selectable: false })).toBe(176)
  })

  it('baris sesi tumbuh untuk catatan konversi dan untuk baris "Dipesan"', () => {
    expect(sessionLineRowHeight({ convFound: true, hasOrderedLine: false })).toBe(116)
    expect(sessionLineRowHeight({ convFound: true, hasOrderedLine: true })).toBe(136)
    expect(sessionLineRowHeight({ convFound: false, hasOrderedLine: false })).toBe(136)
    expect(sessionLineRowHeight({ convFound: false, hasOrderedLine: true })).toBe(156)
  })

  it('baris log tumbuh untuk id sesi dan untuk detail JSON', () => {
    expect(diagnosticsRowHeight({ hasSessionId: false, hasDetail: false })).toBe(116)
    expect(diagnosticsRowHeight({ hasSessionId: true, hasDetail: false })).toBe(136)
    expect(diagnosticsRowHeight({ hasSessionId: false, hasDetail: true })).toBe(152)
    expect(diagnosticsRowHeight({ hasSessionId: true, hasDetail: true })).toBe(168)
  })

  it('baris dokumen tumbuh untuk pemilik lain, pesan server, dan over-receive', () => {
    expect(
      sessionStatusRowHeight({
        hasForeignOwner: false,
        hasFailureText: false,
        hasOverReceive: false,
      }),
    ).toBe(124)
    expect(
      sessionStatusRowHeight({
        hasForeignOwner: true,
        hasFailureText: false,
        hasOverReceive: false,
      }),
    ).toBe(144)
    // Synthetic maximum: all three conditions at once. 122 + 20 + 40 + 40 = 222, rounded up to 224.
    // In real data `hasFailureText` and `hasOverReceive` never hold together — `overReceive` is
    // written only by markSynced, so such a document is SYNCED, not FAILED. What is under test here
    // is the arithmetic, not a reachable combination.
    expect(
      sessionStatusRowHeight({
        hasForeignOwner: true,
        hasFailureText: true,
        hasOverReceive: true,
      }),
    ).toBe(224)
  })
})
