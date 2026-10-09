// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { ConfirmButton } from '~/ui/confirm-button'
import { NumericPad } from '~/ui/numeric-pad'
import { ScanBar } from '~/features/receiving/cockpit/scan-bar'
import { ScanHero } from '~/features/receiving/cockpit/scan-hero'
import { loadPreferences, savePreferences } from '~/platform/preferences'

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

  it('memakai default bunyi, getar, dan tema terang', () => {
    window.localStorage.removeItem('stockops.preferences')
    expect(loadPreferences()).toEqual({
      feedbackBeep: true,
      feedbackVibrate: true,
      theme: 'light',
      manualPick: true,
      hideScanKeyboard: false,
    })
  })

  it('menyimpan dan membaca preferensi operator', () => {
    savePreferences({
      feedbackBeep: false,
      feedbackVibrate: true,
      theme: 'light',
      manualPick: true,
      hideScanKeyboard: true,
    })
    expect(loadPreferences()).toEqual({
      feedbackBeep: false,
      feedbackVibrate: true,
      theme: 'light',
      manualPick: true,
      hideScanKeyboard: true,
    })
  })

  // Two preferences have been removed over time: `qtyInput` when the keypad toggle was dropped
  // from Settings, and `highContrast` when the light theme replaced the high-contrast layer. A
  // device upgraded from either version still has them in localStorage, so loading must ignore
  // them silently rather than carry them through or throw — which is also why removing a
  // preference needs no migration step.
  it('preferensi lama (qtyInput, highContrast) diabaikan, bukan dibawa ikut', () => {
    window.localStorage.setItem(
      'stockops.preferences',
      JSON.stringify({
        qtyInput: 'pad',
        highContrast: true,
        feedbackBeep: true,
        feedbackVibrate: false,
      }),
    )
    expect(loadPreferences()).toEqual({
      feedbackBeep: true,
      feedbackVibrate: false,
      theme: 'light',
      manualPick: true,
      hideScanKeyboard: false,
    })
  })

  // A stored theme that is neither 'dark' nor 'light' (hand-edited storage, or a value from a
  // future version) falls back to the default instead of reaching <html> as an unknown attribute.
  it('nilai tema yang tidak dikenal jatuh ke default terang', () => {
    window.localStorage.setItem('stockops.preferences', JSON.stringify({ theme: 'sepia' }))
    expect(loadPreferences().theme).toBe('light')
  })

  // The switch is a boolean, but storage is hand-editable and other versions may write other things.
  // Anything that is not a real boolean must read as the default (OFF), never as "truthy".
  it('nilai hideScanKeyboard yang bukan boolean jatuh ke default mati', () => {
    window.localStorage.setItem('stockops.preferences', JSON.stringify({ hideScanKeyboard: 'ya' }))
    expect(loadPreferences().hideScanKeyboard).toBe(false)
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
          itemServerReceived: 6,
        }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
        onOpenPurchase={vi.fn()}
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
        onOpenPurchase={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('8991002103458')
    expect(screen.queryByRole('button', { name: 'Batalkan scan ini' })).toBeNull()
  })

  it('bukan item PO ini menyebut PO lain dan membukanya', () => {
    const onOpenPurchase = vi.fn()
    render(
      <ScanHero
        state={{
          kind: 'NOT_IN_PO',
          itemName: 'KECAP MANIS 600ML',
          otherPurchase: {
            purchaseId: '720593553977261000',
            number: 'PO10250003',
            vendorName: 'CV Berkah Jaya',
          },
          otherCount: 2,
        }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
        onOpenPurchase={onOpenPurchase}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('PO10250003')
    // Nama vendor ikut diassert: tanpa ini `· {vendorName}` bisa dibuang dari kartunya tanpa
    // satu test pun gagal, padahal identitas vendor bagian dari gunanya kartu ini.
    expect(screen.getByRole('alert')).toHaveTextContent('CV Berkah Jaya')
    expect(screen.getByRole('alert')).toHaveTextContent('+2 PO lain')

    fireEvent.click(screen.getByRole('button', { name: 'Buka PO itu' }))
    expect(onOpenPurchase).toHaveBeenCalledWith('720593553977261000')
  })

  it('bukan item PO ini tanpa PO lain hanya menawarkan lanjut scan', () => {
    render(
      <ScanHero
        state={{
          kind: 'NOT_IN_PO',
          itemName: 'KECAP MANIS 600ML',
          otherPurchase: null,
          otherCount: 0,
        }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
        onOpenPurchase={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Buka PO itu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mengerti, lanjut scan' })).toBeInTheDocument()
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
        onOpenPurchase={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan scan ini' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})

describe('ScanBar', () => {
  // The qty field is a controlled input, so the test needs a holder that owns the value. The
  // optional spy lets a test assert what the component tried to do, not only what survived.
  function Harness({ onQtyChange }: { onQtyChange?: (value: string) => void }) {
    const scanRef = useRef<HTMLInputElement>(null)
    const [qty, setQty] = useState('1')
    return (
      <ScanBar
        scan=""
        qty={qty}
        qtyTouched={false}
        scanRef={scanRef}
        padOpen={false}
        onPadOpenChange={() => undefined}
        onScanChange={() => undefined}
        onQtyChange={(value) => {
          setQty(value)
          onQtyChange?.(value)
        }}
        onAdd={() => undefined}
      />
    )
  }

  it('Enter di kolom qty mengembalikan fokus ke field barcode', () => {
    render(<Harness />)
    const qtyInput = screen.getByLabelText('Qty dalam satuan PO')
    const barcodeInput = screen.getByLabelText('Barcode atau kode barang')

    qtyInput.focus()
    expect(document.activeElement).toBe(qtyInput)

    fireEvent.keyDown(qtyInput, { key: 'Enter' })
    expect(document.activeElement).toBe(barcodeInput)
  })

  it('kolom qty menolak deretan digit sepanjang barcode', () => {
    const onQtyChange = vi.fn()
    render(<Harness onQtyChange={onQtyChange} />)
    const qtyInput = screen.getByLabelText('Qty dalam satuan PO')

    fireEvent.change(qtyInput, { target: { value: '8991102000016' } })
    expect(onQtyChange).not.toHaveBeenCalled()
    expect(qtyInput).toHaveValue('1')

    fireEvent.change(qtyInput, { target: { value: '12' } })
    expect(onQtyChange).toHaveBeenLastCalledWith('12')
    expect(qtyInput).toHaveValue('12')
  })

  it('kolom qty menerima desimal dan menormalkan koma menjadi titik', () => {
    const onQtyChange = vi.fn()
    render(<Harness onQtyChange={onQtyChange} />)
    const qtyInput = screen.getByLabelText('Qty dalam satuan PO')

    fireEvent.change(qtyInput, { target: { value: '1.5' } })
    expect(onQtyChange).toHaveBeenLastCalledWith('1.5')

    fireEvent.change(qtyInput, { target: { value: '2,5' } })
    expect(onQtyChange).toHaveBeenLastCalledWith('2.5')
  })

  it('kolom qty menjaga batas tepat 5 digit bulat dan 2 desimal', () => {
    const onQtyChange = vi.fn()
    render(<Harness onQtyChange={onQtyChange} />)
    const qtyInput = screen.getByLabelText('Qty dalam satuan PO')

    fireEvent.change(qtyInput, { target: { value: '99999' } })
    expect(onQtyChange).toHaveBeenLastCalledWith('99999')

    onQtyChange.mockClear()
    fireEvent.change(qtyInput, { target: { value: '999999' } })
    expect(onQtyChange).not.toHaveBeenCalled()

    fireEvent.change(qtyInput, { target: { value: '1.99' } })
    expect(onQtyChange).toHaveBeenLastCalledWith('1.99')

    onQtyChange.mockClear()
    fireEvent.change(qtyInput, { target: { value: '1.999' } })
    expect(onQtyChange).not.toHaveBeenCalled()
  })

  it('kolom qty boleh dikosongkan, karena kosong adalah keadaan tidak valid yang sah', () => {
    const onQtyChange = vi.fn()
    render(<Harness onQtyChange={onQtyChange} />)
    const qtyInput = screen.getByLabelText('Qty dalam satuan PO')

    // If the guard ever became \d{1,5}, clearing the field would be impossible and the red
    // aria-invalid state would become unreachable — with no other test failing.
    fireEvent.change(qtyInput, { target: { value: '' } })
    expect(onQtyChange).toHaveBeenLastCalledWith('')
  })
})

describe('ScanBar — slot kanan: picker vs tambah', () => {
  // A harness of its own, with `scan` as a parameter: the one above hard-codes an empty barcode
  // field, which is exactly the state these tests have to vary.
  function SlotHarness({ scan, onOpenPicker }: { scan: string; onOpenPicker?: () => void }) {
    const scanRef = useRef<HTMLInputElement>(null)
    return (
      <ScanBar
        scan={scan}
        qty="1"
        qtyTouched={false}
        scanRef={scanRef}
        padOpen={false}
        onPadOpenChange={() => undefined}
        onScanChange={() => undefined}
        onQtyChange={() => undefined}
        onAdd={() => undefined}
        onOpenPicker={onOpenPicker}
      />
    )
  }

  it('field barcode kosong menampilkan tombol picker, bukan tombol tambah', () => {
    const onOpenPicker = vi.fn()
    render(<SlotHarness scan="" onOpenPicker={onOpenPicker} />)

    fireEvent.click(screen.getByLabelText('Pilih item dari daftar PO'))
    expect(onOpenPicker).toHaveBeenCalledTimes(1)
    // Satu slot, dua fungsi — tidak ada tombol kelima di baris ini.
    expect(screen.queryByLabelText('Tambah ke sesi')).toBeNull()
  })

  it('field barcode berisi menampilkan tombol tambah yang aktif', () => {
    render(<SlotHarness scan="8991002103458" onOpenPicker={() => undefined} />)

    expect(screen.getByLabelText('Tambah ke sesi')).toBeEnabled()
    expect(screen.queryByLabelText('Pilih item dari daftar PO')).toBeNull()
  })

  it('tanpa onOpenPicker, slot itu berperilaku persis seperti sebelum fitur ini ada', () => {
    render(<SlotHarness scan="" />)

    expect(screen.queryByLabelText('Pilih item dari daftar PO')).toBeNull()
    expect(screen.getByLabelText('Tambah ke sesi')).toBeDisabled()
  })
})

describe('ScanHero — pintu picker pada kartu tidak dikenal', () => {
  it('kartu tidak dikenal menawarkan pilih dari PO dan lanjut scan', () => {
    const onPickFromPo = vi.fn()
    const onDismiss = vi.fn()
    render(
      <ScanHero
        state={{ kind: 'NOT_FOUND', scannedCode: '8991002103458' }}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
        onOpenPurchase={vi.fn()}
        onPickFromPo={onPickFromPo}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pilih dari PO' }))
    expect(onPickFromPo).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Lanjut scan' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('tanpa onPickFromPo, kartu tidak dikenal kembali ke satu tombol', () => {
    render(
      <ScanHero
        state={{ kind: 'NOT_FOUND', scannedCode: '8991002103458' }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
        onOpenPurchase={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Pilih dari PO' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mengerti, lanjut scan' })).toBeInTheDocument()
  })

  it('kartu BUKAN ITEM PO INI tidak pernah menawarkan picker, meski prop-nya diberikan', () => {
    render(
      <ScanHero
        state={{
          kind: 'NOT_IN_PO',
          itemName: 'KECAP MANIS 600ML',
          otherPurchase: null,
          otherCount: 0,
        }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
        onOpenPurchase={vi.fn()}
        onPickFromPo={vi.fn()}
      />,
    )

    // Barcode-nya SUDAH dikenali dan barangnya memang bukan bagian dari PO ini, jadi picker — yang
    // hanya memuat baris PO ini — dijamin tidak memuatnya. Test ini yang menjaga keputusan itu.
    expect(screen.queryByRole('button', { name: 'Pilih dari PO' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mengerti, lanjut scan' })).toBeInTheDocument()
  })
})

describe('ScanBar — keyboard layar', () => {
  // A harness of its own: the prop under test is one the two harnesses above never pass, and
  // adding it to them would widen helpers that unrelated tests share.
  function KeyboardHarness({ hideKeyboard }: { hideKeyboard?: boolean }) {
    const scanRef = useRef<HTMLInputElement>(null)
    return (
      <ScanBar
        scan=""
        qty="1"
        qtyTouched={false}
        scanRef={scanRef}
        padOpen={false}
        onPadOpenChange={() => undefined}
        onScanChange={() => undefined}
        onQtyChange={() => undefined}
        onAdd={() => undefined}
        hideKeyboard={hideKeyboard}
      />
    )
  }

  it('tanpa prop, kolom barcode tidak membawa inputmode dan kolom qty tetap decimal', () => {
    render(<KeyboardHarness />)

    expect(screen.getByLabelText('Barcode atau kode barang')).not.toHaveAttribute('inputmode')
    expect(screen.getByLabelText('Qty dalam satuan PO')).toHaveAttribute('inputmode', 'decimal')
  })

  it('hideKeyboard menyetel inputmode none pada kolom barcode DAN kolom qty', () => {
    render(<KeyboardHarness hideKeyboard />)

    expect(screen.getByLabelText('Barcode atau kode barang')).toHaveAttribute('inputmode', 'none')
    expect(screen.getByLabelText('Qty dalam satuan PO')).toHaveAttribute('inputmode', 'none')
  })

  it('hideKeyboard tidak membuat kolom barcode read-only atau disabled', () => {
    render(<KeyboardHarness hideKeyboard />)
    const barcode = screen.getByLabelText('Barcode atau kode barang')

    // The scanner types into this field like a physical keyboard. A read-only or disabled field
    // would swallow every scan without a sound, which is the one way this feature can go wrong.
    expect(barcode).toBeEnabled()
    expect(barcode).not.toHaveAttribute('readonly')
  })

  it('tombol keypad 123 tetap tersedia saat keyboard disembunyikan', () => {
    render(<KeyboardHarness hideKeyboard />)

    expect(screen.getByRole('button', { name: 'Buka keypad angka' })).toBeInTheDocument()
  })
})
