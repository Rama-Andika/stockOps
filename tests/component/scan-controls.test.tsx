// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmButton } from '~/components/confirm-button'
import { NumericPad } from '~/components/numeric-pad'
import { ScanFeedback } from '~/components/scan-feedback'
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

  it('memakai default keyboard, bunyi, dan getar', () => {
    window.localStorage.removeItem('stockops.preferences')
    expect(loadPreferences()).toEqual({ qtyInput: 'keyboard', feedbackBeep: true, feedbackVibrate: true })
  })

  it('menyimpan dan membaca preferensi operator', () => {
    savePreferences({ qtyInput: 'keyboard', feedbackBeep: false, feedbackVibrate: true })
    expect(loadPreferences()).toEqual({ qtyInput: 'keyboard', feedbackBeep: false, feedbackVibrate: true })
  })
})

describe('ScanFeedback', () => {
  it('mengumumkan feedback scan dan menutupnya otomatis', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(
      <ScanFeedback
        feedback={{ tone: 'success', text: 'Barang ditambahkan', key: 1 }}
        onDismiss={onDismiss}
        durationMs={1000}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Barang ditambahkan')
    act(() => vi.advanceTimersByTime(1000))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('pesan error menunggu operator dan hanya tertutup lewat tombol', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(
      <ScanFeedback
        feedback={{ tone: 'danger', text: 'Barcode tidak dikenali', key: 2 }}
        onDismiss={onDismiss}
        durationMs={1000}
      />,
    )
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Tutup pesan hasil scan' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
