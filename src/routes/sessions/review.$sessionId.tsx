import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { localRepo, sessionTabKey } from '~/client/db/local-repo'
import { useSessionData } from '~/client/hooks/use-session-data'
import { useAppStore } from '~/client/state/store/app-store'
import { toast } from '~/client/toast'
import { AppBar } from '~/components/app-bar'
import { ConfirmButton } from '~/components/confirm-button'
import { ReviewSummary } from '~/components/review-summary'
import { VendorDocCard } from '~/components/vendor-doc-card'
import { Button, Card, EmptyState, Loading, Notice } from '~/components/ui'
import { SESSION_STATUS } from '~/shared/constants'
import { formatQty } from '~/shared/format'
import { toLocalDateTime } from '~/shared/receive-date'

export const Route = createFileRoute('/sessions/review/$sessionId')({
  component: SessionReviewPage,
})

/** Which cockpit tab to open on the way back. Mirrors `SessionTab` in the cockpit route. */
type SessionTabTarget = 'scan' | 'items'

/**
 * Step 2 of receiving: read back what was counted, fill in the vendor's document numbers, send.
 *
 * A route of its own, not a tab of the cockpit, so that finalizing cannot be reached without the
 * recap being on screen — and so the scanner wedge and the barcode focus effect, both of which
 * live in the cockpit, are structurally absent here instead of being switched off by a flag.
 *
 * This screen is allowed to scroll. The "never scrolls" invariant covers the scan loop, where the
 * operator works one-handed and repeatedly; this one is read once per session and a recap of
 * twenty lines must not be cut off to satisfy a height budget that does not apply.
 */
function SessionReviewPage() {
  const { sessionId } = Route.useParams()
  const navigate = useNavigate()
  const sync = useAppStore((state) => state.sync)
  const online = useAppStore((state) => state.online)
  const {
    session,
    lines,
    items,
    purchaseItemMap,
    unitMap,
    purchaseProgress,
    excessByPurchaseItem,
    qtySummary,
  } = useSessionData(sessionId)

  const [invoice, setInvoice] = useState('')
  const [doNumber, setDoNumber] = useState('')
  const [invoiceError, setInvoiceError] = useState(false)
  const [doNumberError, setDoNumberError] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (session) {
      setInvoice(session.invoiceNumber)
      setDoNumber(session.doNumber)
    }
  }, [session?.invoiceNumber, session?.doNumber])

  if (!session) return <Loading label="Memuat sesi…" />

  const toCockpit = () => {
    void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
  }

  // Everything that leaves this screen saves the draft first: this is its own route, so going
  // back unmounts it and the typed numbers would be gone. In the old three-tab cockpit the same
  // state survived a tab switch because the route component never unmounted.
  const saveDraftAndLeave = async (openTab?: SessionTabTarget) => {
    try {
      await localRepo.updateSessionDraft(session.sessionId, {
        invoiceNumber: invoice.trim(),
        doNumber: doNumber.trim(),
      })
    } catch {
      // Staying put is the point: the numbers are still on screen, so they can be written down
      // or the button pressed again. Leaving would drop them in silence, and the operator has no
      // reason to expect that pressing back can erase what they just typed.
      toast('danger', 'Nomor dokumen gagal disimpan. Jangan keluar dulu — coba lagi.')
      return
    }
    // The tab preference is a convenience, not data: if this write fails the operator simply
    // lands on the scan tab, so it must never block leaving.
    if (openTab) {
      await localRepo.setMeta(sessionTabKey(sessionId), openTab).catch(() => undefined)
    }
    toCockpit()
  }

  // A finalized session must not be able to walk back into this screen and send again:
  // `finalizeSession` does not check status, so it would push a SYNCED session back to PENDING.
  if (session.status !== SESSION_STATUS.RUNNING) {
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 px-3 pt-2">
          <AppBar title="Review & kirim" onBack={toCockpit} backLabel="Kembali ke sesi" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <Notice tone="info">
            Sesi ini sudah diselesaikan, jadi tidak bisa diubah atau dikirim lagi dari sini.
          </Notice>
          <Button className="mt-3 w-full" onClick={toCockpit}>
            Lihat sesi
          </Button>
        </div>
      </div>
    )
  }

  const handleSend = async () => {
    const invoiceMissing = !invoice.trim()
    const doMissing = !doNumber.trim()
    // Both flags are set on every attempt, not only when something is missing, so a field that
    // was filled in since the last attempt stops being red.
    setInvoiceError(invoiceMissing)
    setDoNumberError(doMissing)
    if (invoiceMissing || doMissing) {
      toast('danger', 'Nomor invoice dan nomor DO wajib diisi.')
      return
    }
    if (lines.length === 0) {
      // Back to the scan tab, the way the pre-F5d flow did it: this screen cannot accept a scan,
      // so leaving the operator here is a soft dead end.
      toast('danger', 'Belum ada item yang discan.')
      void saveDraftAndLeave('scan')
      return
    }
    setSending(true)
    try {
      await localRepo.updateSessionDraft(session.sessionId, {
        invoiceNumber: invoice.trim(),
        doNumber: doNumber.trim(),
      })
      await localRepo.finalizeSession(session.sessionId, {
        invoiceNumber: invoice.trim(),
        doNumber: doNumber.trim(),
        receiveDate: session.receiveDate || toLocalDateTime(new Date()),
      })
      const result = await sync()
      if (result.ok) {
        toast('success', 'Sesi selesai & tersinkron.')
      } else if (!online) {
        toast('info', 'Sesi disimpan. Menunggu sinkronisasi (offline).')
      } else {
        toast('danger', result.message)
      }
      // Back to the session either way: it is read-only now and shows its own status and, when
      // the push failed, the Upload button.
      toCockpit()
    } catch (error) {
      // Without this the only failure the operator can see is the absence of a change: the hold
      // completes, the progress bar fills, and nothing happens. A write can genuinely fail here
      // (quota exceeded, the database blocked by another tab), and the session stays RUNNING, so
      // retrying is the right move — but only if they are told to.
      toast('danger', error instanceof Error ? error.message : 'Gagal menyimpan sesi. Coba lagi.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Fixed header. The shell gives this route no padding of its own — see `isReview` in
          app-shell.tsx — so the horizontal gutter is stated here. */}
      <div className="shrink-0 px-3 pt-2">
        <AppBar
          title="Review & kirim"
          onBack={() => void saveDraftAndLeave()}
          backLabel="Kembali ke layar scan"
        />
      </div>

      {/* The only scrollable region. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <ReviewSummary
          purchaseLabel={session.purchaseNumber ?? session.purchaseId}
          vendorName={session.vendorName ?? '-'}
          itemCount={lines.length}
          qtySummary={qtySummary}
          ordered={purchaseProgress?.orderedTotal ?? 0}
          serverReceived={purchaseProgress?.serverReceivedTotal ?? 0}
          localPending={purchaseProgress?.localPendingTotal ?? 0}
          overItemCount={excessByPurchaseItem.size}
        />

        <div className="mt-3">
          <VendorDocCard
            invoice={invoice}
            doNumber={doNumber}
            editable
            invoiceError={invoiceError}
            doNumberError={doNumberError}
            onInvoiceChange={(value) => {
              setInvoice(value)
              setInvoiceError(false)
            }}
            onDoNumberChange={(value) => {
              setDoNumber(value)
              setDoNumberError(false)
            }}
          />
        </div>

        <div className="mt-3">
          {/* The recap rows are plain text, not buttons. Every row would have done the same
              thing — leave for the item tab — so N rows meant N keyboard stops between the DO
              field and the send button, 21 Tab presses on a twenty-line session, which is NF-8
              backwards on a keypad device. One button in the header says it once. */}
          <Card
            title={`Rekap item (${lines.length})`}
            actions={
              lines.length > 0 ? (
                <button
                  type="button"
                  className="touch-target shrink-0 rounded-lg px-3 text-sm font-semibold text-brand-soft transition hover:bg-raised"
                  onClick={() => void saveDraftAndLeave('items')}
                >
                  Ubah item
                </button>
              ) : null
            }
          >
            <ul className="flex flex-col divide-y divide-line-soft">
              {lines.map((line) => {
                const item = items[line.itemMasterId]
                const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
                const excess = excessByPurchaseItem.get(line.purchaseItemId) ?? 0
                const purchaseUnit = unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId
                return (
                  <li key={line.lineId} className="py-3">
                    <p className="font-semibold text-fg">{item?.name ?? line.itemMasterId}</p>
                    <p className="text-sm tabular-nums text-fg-subtle">
                      {formatQty(line.qty)} {purchaseUnit}
                      {purchaseItem
                        ? ` · dipesan ${formatQty(purchaseItem.qty)} ${unitMap.get(purchaseItem.uomId) ?? ''}`
                        : ' · item tidak ada di PO ini'}
                    </p>
                    {excess > 0 ? (
                      <p className="text-sm font-semibold tabular-nums text-warn-text">
                        Lebih {formatQty(excess)} {purchaseUnit} dari pesanan
                      </p>
                    ) : null}
                  </li>
                )
              })}
              {lines.length === 0 ? (
                <li>
                  {/* Wrapped in <li>: a <p> as a direct child of <ul> is invalid, and a screen
                      reader walking the list role can skip it. */}
                  <EmptyState>Belum ada item. Kembali ke bagian Scan untuk menambah.</EmptyState>
                </li>
              ) : null}
            </ul>
          </Card>
        </div>
      </div>

      {/* Fixed footer: the send button must be reachable without scrolling past a twenty-line
          recap first. */}
      {/* `pt-2` with the 8px folded into the calc below, rather than `py-2` next to a separate
          safe-area padding class: Tailwind resolves two classes touching padding-bottom by
          stylesheet order, and the arbitrary-value one comes later, so `py-2` lost. On a PDT the
          inset is 0px, which left the helper text flush against the bottom edge.
          Write no bracket utility inside a comment — Tailwind scans source text, so the example
          itself would be compiled into a junk CSS rule. */}
      <div className="shrink-0 border-t border-line bg-chrome/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <ConfirmButton
          tone="primary"
          className="w-full"
          label="Selesaikan & kirim"
          confirmLabel="Tahan terus… sesi akan dikirim"
          disabled={sending}
          onConfirm={() => void handleSend()}
        />
        <p className="mt-1 text-center text-sm text-fg-subtle">
          Tahan 1,5 detik. Setelah diselesaikan, sesi tidak bisa diubah; dokumen terkirim otomatis
          saat perangkat online.
        </p>
      </div>
    </div>
  )
}
