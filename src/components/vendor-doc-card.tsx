import { Card, Field, inputClass } from './ui'

/**
 * Invoice and delivery-note numbers from the vendor's paperwork. Both are required before a
 * session can be finalized, which is why the error state is a prop rather than local: the
 * screen that validates owns it.
 *
 * The change handlers are optional so a read-only session can render the same card without
 * supplying two no-op functions.
 */
export function VendorDocCard({
  invoice,
  doNumber,
  editable,
  invoiceError = false,
  doNumberError = false,
  onInvoiceChange,
  onDoNumberChange,
}: {
  invoice: string
  doNumber: string
  editable: boolean
  invoiceError?: boolean
  doNumberError?: boolean
  onInvoiceChange?: (value: string) => void
  onDoNumberChange?: (value: string) => void
}) {
  return (
    <Card title="Dokumen Vendor">
      <div className="flex flex-col gap-3">
        <Field label="Nomor Invoice (wajib)">
          <input
            className={`${inputClass} w-full ${invoiceError ? 'border-danger-line' : 'border-line-strong'}`}
            value={invoice}
            disabled={!editable}
            onChange={(event) => onInvoiceChange?.(event.target.value)}
          />
          {invoiceError ? <span className="mt-1 block text-xs text-danger-text">Nomor invoice wajib diisi.</span> : null}
        </Field>
        <Field label="Nomor Surat Jalan / DO (wajib)">
          <input
            className={`${inputClass} w-full ${doNumberError ? 'border-danger-line' : 'border-line-strong'}`}
            value={doNumber}
            disabled={!editable}
            onChange={(event) => onDoNumberChange?.(event.target.value)}
          />
          {doNumberError ? <span className="mt-1 block text-xs text-danger-text">Nomor surat jalan (DO) wajib diisi.</span> : null}
        </Field>
      </div>
    </Card>
  )
}
