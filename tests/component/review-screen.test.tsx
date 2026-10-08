// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReviewSummary } from '~/features/receiving/review/review-summary'
import { VendorDocCard } from '~/features/receiving/session/vendor-doc-card'

describe('ReviewSummary', () => {
  it('menampilkan PO, vendor, jumlah item, dan total per satuan', () => {
    render(
      <ReviewSummary
        purchaseLabel="PO10250003"
        vendorName="BALI LESTARI KOSMETIK"
        itemCount={12}
        qtySummary="40 KRT · 6 DUS"
        ordered={100}
        serverReceived={20}
        localPending={40}
        overItemCount={0}
      />,
    )

    expect(screen.getByText('PO10250003')).toBeInTheDocument()
    expect(screen.getByText('BALI LESTARI KOSMETIK')).toBeInTheDocument()
    expect(screen.getByText('12 item')).toBeInTheDocument()
    // Totals are joined per purchase unit, never summed across units.
    expect(screen.getByText('40 KRT · 6 DUS')).toBeInTheDocument()
  })

  it('tanpa kelebihan terima tidak memunculkan callout', () => {
    render(
      <ReviewSummary
        purchaseLabel="PO10250003"
        vendorName="BALI LESTARI KOSMETIK"
        itemCount={3}
        qtySummary="10 KRT"
        ordered={10}
        serverReceived={0}
        localPending={10}
        overItemCount={0}
      />,
    )

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('kelebihan terima memunculkan callout berisi jumlah ITEM, bukan jumlah qty', () => {
    render(
      <ReviewSummary
        purchaseLabel="PO10250003"
        vendorName="BALI LESTARI KOSMETIK"
        itemCount={12}
        qtySummary="42 KRT"
        ordered={100}
        serverReceived={20}
        localPending={42}
        overItemCount={2}
      />,
    )

    const callout = screen.getByRole('alert')
    expect(callout).toHaveTextContent('2 item lebih dari pesanan')
    expect(callout).toHaveTextContent('menunggu persetujuan admin')
  })

  it('baris total dilewati sepenuhnya saat qtySummary kosong', () => {
    const base = {
      purchaseLabel: 'PO10250003',
      vendorName: 'BALI LESTARI KOSMETIK',
      ordered: 100,
      serverReceived: 0,
      localPending: 0,
      overItemCount: 0,
    }
    // Differential, not an absence check on an empty string: asserting that "" is not on screen
    // would pass even if the guard rendered an empty <p>. Counting proves the line is skipped.
    const withTotal = render(<ReviewSummary {...base} itemCount={3} qtySummary="10 KRT" />)
    const paragraphsWithTotal = withTotal.container.querySelectorAll('p').length
    withTotal.unmount()

    const without = render(<ReviewSummary {...base} itemCount={0} qtySummary="" />)
    expect(without.container.querySelectorAll('p').length).toBe(paragraphsWithTotal - 1)
    expect(screen.getByText('0 item')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('VendorDocCard', () => {
  it('meneruskan perubahan kedua kolom ke pemanggil', () => {
    const onInvoiceChange = vi.fn()
    const onDoNumberChange = vi.fn()
    render(
      <VendorDocCard
        invoice=""
        doNumber=""
        editable
        onInvoiceChange={onInvoiceChange}
        onDoNumberChange={onDoNumberChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Nomor Invoice (wajib)'), {
      target: { value: 'INV-001' },
    })
    expect(onInvoiceChange).toHaveBeenCalledWith('INV-001')

    fireEvent.change(screen.getByLabelText('Nomor Surat Jalan / DO (wajib)'), {
      target: { value: 'DO-77' },
    })
    expect(onDoNumberChange).toHaveBeenCalledWith('DO-77')
  })

  it('menampilkan pesan wajib pada kolom yang kosong saja', () => {
    render(
      <VendorDocCard invoice="" doNumber="DO-77" editable invoiceError doNumberError={false} />,
    )

    expect(screen.getByText('Nomor invoice wajib diisi.')).toBeInTheDocument()
    expect(screen.queryByText('Nomor surat jalan (DO) wajib diisi.')).toBeNull()
  })

  it('sesi baca-saja mematikan kedua kolom dan tidak butuh handler', () => {
    render(<VendorDocCard invoice="INV-001" doNumber="DO-77" editable={false} />)

    expect(screen.getByLabelText('Nomor Invoice (wajib)')).toBeDisabled()
    expect(screen.getByLabelText('Nomor Surat Jalan / DO (wajib)')).toBeDisabled()
  })
})
