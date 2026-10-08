// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Badge, Button, Field, Notice } from '~/ui/primitives'

describe('komponen UI (keypad-first)', () => {
  it('Button memanggil handler saat diklik', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Kirim</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Button disabled tidak bisa diklik', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Kirim
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Kirim' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('Badge menampilkan teks status', () => {
    render(<Badge tone="warn">Menunggu Sinkronisasi</Badge>)
    expect(screen.getByText('Menunggu Sinkronisasi')).toBeInTheDocument()
  })

  it('Notice memakai role status agar terbaca alat bantu', () => {
    render(<Notice tone="success">Berhasil</Notice>)
    expect(screen.getByRole('status')).toHaveTextContent('Berhasil')
  })

  it('Field menampilkan label dan petunjuk', () => {
    render(
      <Field label="Nomor Invoice" hint="Wajib diisi">
        <input aria-label="invoice" />
      </Field>,
    )
    expect(screen.getByText('Nomor Invoice')).toBeInTheDocument()
    expect(screen.getByText('Wajib diisi')).toBeInTheDocument()
  })
})
