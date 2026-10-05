// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmButton } from '~/components/confirm-button'
import { NumericPad } from '~/components/numeric-pad'
import { ScanHero } from '~/components/scan-hero'
import { loadPreferences, savePreferences } from '~/client/preferences'

describe('NumericPad', () => {
  it('menambah digit dan menghapus dengan tombol backspace', () => {
    const onChange = vi.fn()
    const { rerender } = render(<NumericPad value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    expect(onChange).toHaveBeenLastCalledWith('2')

    rerender(<NumericPad value="2" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hapus digit terakhir' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('tombol +1 menaikkan qty sebesar satu', () => {
    const onChange = vi.fn()
    render(<NumericPad value="1.5" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+1 (satuan PO)' }))
    expect(onChange).toHaveBeenLastCalledWith('2.5')
  })
})

describe('ConfirmButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('memanggil onConfirm setelah ditahan selama durasi penuh', () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Batalkan Sesi" confirmLabel="Tahan…" onConfirm={onConfirm} />)
    const button = screen.getByRole('button', { name: 'Batalkan Sesi' })
    fireEvent.pointerDown(button, { button: 0 })
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('tidak memanggil onConfirm bila dilepas sebelum durasi selesai', () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Batalkan Sesi" confirmLabel="Tahan…" onConfirm={onConfirm} />)
    const button = screen.getByRole('button', { name: 'Batalkan Sesi' })
    fireEvent.pointerDown(button, { button: 0 })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    fireEvent.pointerUp(button)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('menyediakan konfirmasi dua langkah bagi aktivasi non-pointer', () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Batalkan Sesi" confirmLabel="Tahan…" onConfirm={onConfirm} />)
    const button = screen.getByRole('button', { name: 'Batalkan Sesi' })
    fireEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /tekan lagi untuk mengonfirmasi/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('preferensi perangkat', () => {
  afterEach(() => {
    window.localStorage.removeItem('stockops.preferences')
  })

  it('memakai default keyboard, bunyi, getar, dan kontras normal', () => {
    window.localStorage.removeItem('stockops.preferences')
    expect(loadPreferences()).toEqual({
      qtyInput: 'keyboard',
      feedbackBeep: true,
      feedbackVibrate: true,
      highContrast: false,
    })
  })

  it('menyimpan dan membaca preferensi operator', () => {
    savePreferences({
      qtyInput: 'keyboard',
      feedbackBeep: false,
      feedbackVibrate: true,
      highContrast: true,
    })
    expect(loadPreferences()).toEqual({
      qtyInput: 'keyboard',
      feedbackBeep: false,
      feedbackVibrate: true,
      highContrast: true,
    })
  })

  it('preferensi lama tanpa highContrast tetap terbaca', () => {
    window.localStorage.setItem(
      'stockops.preferences',
      JSON.stringify({ qtyInput: 'pad', feedbackBeep: true, feedbackVibrate: false }),
    )
    expect(loadPreferences().highContrast).toBe(false)
  })
})

describe('ScanHero', () => {
  it('menampilkan hasil scan sukses beserta konversi satuan', () => {
    render(
      <ScanHero
        state={{
          kind: 'OK',
          itemName: 'BERAS PREMIUM 5KG',
          itemCode: 'BRS-PRM-05',
          addedQty: 2,
          purchaseUnit: 'KRT',
          stockQty: 24,
          stockUnit: 'PCS',
          itemOrdered: 10,
          itemTotal: 8,
        }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('BERAS PREMIUM 5KG')
    expect(screen.getByRole('status')).toHaveTextContent('24 PCS')
  })

  it('barcode tidak dikenal memakai role alert dan tidak menawarkan undo', () => {
    render(
      <ScanHero
        state={{ kind: 'NOT_FOUND', scannedCode: '8991002103458' }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('8991002103458')
    expect(screen.queryByRole('button', { name: 'Batalkan scan ini' })).toBeNull()
  })

  it('kelebihan terima memanggil onUndo saat dibatalkan', () => {
    const onUndo = vi.fn()
    render(
      <ScanHero
        state={{
          kind: 'OVER',
          itemName: 'MINYAK GORENG 2L',
          ordered: 12,
          newTotal: 14,
          excess: 2,
          unit: 'KRT',
        }}
        onUndo={onUndo}
        onDismiss={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan scan ini' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})
