// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DuplicateSessionSheet } from '~/features/receiving/session/duplicate-session-sheet'

/**
 * Dedupe sesi per PO — lembar konfirmasinya. Yang dipaku di sini bukan tampilannya, tapi ARAH
 * jawabannya: jawaban aman ("Lanjutkan") yang memegang fokus saat lembar muncul, dan setiap jalan
 * keluar (Escape, klik scrim, "Batal") yang HANYA menutup — tidak satu pun di antaranya membuat
 * dokumen baru. Kalau salah satu arah itu terbalik, ketukan refleks di dermaga bongkar justru
 * menghasilkan dokumen kedua, yaitu persis hal yang mau dicegah fitur ini.
 */

type Props = Parameters<typeof DuplicateSessionSheet>[0]

function setup(overrides: Partial<Props> = {}) {
  const onContinue = vi.fn()
  const onCreateNew = vi.fn()
  const onClose = vi.fn()
  render(
    <DuplicateSessionSheet
      purchaseLabel="PO10250001"
      createdAt="2026-10-06T01:00:00.000Z"
      lineCount={3}
      onContinue={onContinue}
      onCreateNew={onCreateNew}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { onContinue, onCreateNew, onClose }
}

describe('DuplicateSessionSheet', () => {
  it('menyebut PO, jumlah item, dan waktu pembuatan', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Sesi untuk PO ini sudah ada')
    expect(dialog).toHaveTextContent('PO10250001')
    expect(dialog).toHaveTextContent('3 item sudah discan')
    expect(dialog).toHaveTextContent('dibuat')
  })

  it('tanpa createdAt, waktu pembuatan tidak disebut sama sekali', () => {
    // Bukan "-": baris sesi dari build lama harus terbaca sebagai "tidak diketahui", bukan sebagai
    // tanggal yang rusak.
    setup({ createdAt: null })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('3 item sudah discan')
    expect(dialog).not.toHaveTextContent('dibuat')
  })

  it('fokus awal ada di jawaban yang aman', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Lanjutkan sesi berjalan' })).toHaveFocus()
  })

  it('Tab dari tombol terakhir berputar kembali ke tombol pertama', () => {
    setup()
    screen.getByRole('button', { name: 'Batal' }).focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Lanjutkan sesi berjalan' })).toHaveFocus()
  })

  it('Shift+Tab dari tombol pertama berputar ke tombol terakhir', () => {
    // Arah yang berlawanan, dan satu-satunya yang menjaga fokus tidak lolos ke konten di belakang
    // lembar lewat tepi atas.
    setup()
    screen.getByRole('button', { name: 'Lanjutkan sesi berjalan' }).focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Batal' })).toHaveFocus()
  })

  it('panel fokusabel dan scrim di luar urutan Tab', () => {
    // Keduanya memaku perbaikan yang sama: sentuhan pada teks lembar harus memarkir fokus pada
    // panel (bukan pada <body>, yang keystroke-nya tidak akan pernah mencapai handler), dan scrim
    // tidak boleh menjadi tab stop sebelum panel — dari sana Shift+Tab keluar dari dialog.
    setup()
    expect(screen.getByRole('dialog')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: 'Tutup konfirmasi sesi ganda' })).toHaveAttribute(
      'tabindex',
      '-1',
    )
  })

  it('Tab saat fokus ada di panel itu sendiri masuk ke tombol, tidak keluar dari lembar', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    dialog.focus()
    expect(dialog).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Lanjutkan sesi berjalan' })).toHaveFocus()

    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Batal' })).toHaveFocus()
  })

  it('Escape tetap menutup saat fokus ada di panel, bukan di tombol', () => {
    // Inilah jalur yang dulu mati: handler hanya terpasang di panel, jadi begitu fokus pindah dari
    // tombol, Escape (tombol back keypad PDT) tidak melakukan apa pun.
    const { onClose } = setup()
    const dialog = screen.getByRole('dialog')
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mengembalikan fokus ke tombol pemicu saat lembar ditutup', () => {
    // Tanpa ini, setiap pembatalan membuang fokus ke <body>: Enter berikutnya tidak melakukan apa
    // pun, dan operator keypad harus Tab dari awal dokumen untuk kembali ke aksi utama.
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Mulai Penerimaan
          </button>
          {open ? (
            <DuplicateSessionSheet
              purchaseLabel="PO10250001"
              createdAt={null}
              lineCount={1}
              onContinue={() => undefined}
              onCreateNew={() => undefined}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      )
    }

    render(<Harness />)
    const pemicu = screen.getByRole('button', { name: 'Mulai Penerimaan' })
    pemicu.focus()
    fireEvent.click(pemicu)

    expect(screen.getByRole('button', { name: 'Lanjutkan sesi berjalan' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(pemicu).toHaveFocus()
  })

  it('Escape hanya menutup — tidak membuat apa pun', () => {
    const { onClose, onContinue, onCreateNew } = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onContinue).not.toHaveBeenCalled()
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('klik scrim hanya menutup — tidak membuat apa pun', () => {
    const { onClose, onContinue, onCreateNew } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Tutup konfirmasi sesi ganda' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onContinue).not.toHaveBeenCalled()
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('"Batal" hanya menutup — tidak membuat apa pun', () => {
    const { onClose, onContinue, onCreateNew } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onContinue).not.toHaveBeenCalled()
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('dua pilihan memanggil penangannya masing-masing', () => {
    const { onContinue, onCreateNew } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan sesi berjalan' }))
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onCreateNew).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Buat dokumen baru' }))
    expect(onCreateNew).toHaveBeenCalledTimes(1)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
