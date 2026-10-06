import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { localRepo, sessionTabKey } from '~/client/db/local-repo'
import { useLive } from '~/client/hooks/use-live'
import { useSessionData } from '~/client/hooks/use-session-data'
import { addScannedItem } from '~/client/services/scanning'
import type { LocalSessionItem } from '~/client/db/local-db'
import { playFeedback } from '~/client/feedback'
import { toast } from '~/client/toast'
import { AppBar } from '~/components/app-bar'
import { ConfirmButton } from '~/components/confirm-button'
import { ScanBar } from '~/components/scan-bar'
import { ScanHero, type ScanHeroState } from '~/components/scan-hero'
import { SessionContextStrip } from '~/components/session-context-strip'
import { VendorDocCard } from '~/components/vendor-doc-card'
import { Badge, Button, Card, EmptyState, Loading, Notice, inputClass } from '~/components/ui'
import { SESSION_STATUS, SESSION_STATUS_LABEL, type SessionStatus } from '~/shared/constants'
import { formatQty } from '~/shared/format'

export const Route = createFileRoute('/sessions/$sessionId')({
  component: SessionDetailPage,
})

function toneFor(status: SessionStatus): 'neutral' | 'info' | 'success' | 'warn' | 'danger' {
  switch (status) {
    case 'SYNCED':
      return 'success'
    case 'FAILED':
      return 'danger'
    case 'REJECTED':
      return 'danger'
    case 'SYNCING':
      return 'info'
    case 'PENDING':
      return 'warn'
    default:
      return 'neutral'
  }
}

type SessionTab = 'scan' | 'items'

function SessionDetailPage() {
  const { sessionId } = Route.useParams()
  const navigate = useNavigate()

  // Shared with the review screen — see src/client/hooks/use-session-data.ts. Called before any
  // early return, like every other hook in this component.
  const { session, lines, items, purchaseItemMap, unitMap, purchaseProgress, overLineIds } =
    useSessionData(sessionId)

  const [scan, setScan] = useState('')
  const [qty, setQty] = useState('1')
  const [qtyTouched, setQtyTouched] = useState(false)
  const [heroState, setHeroState] = useState<ScanHeroState>({ kind: 'IDLE' })
  // What the last successful scan added, so undo can subtract exactly that much. A ref, not state:
  // it is never rendered, and as state every scan would cost one extra render of the whole cockpit.
  const lastScanRef = useRef<{ lineId: string; addedQty: number } | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  // Lives here, not in ScanBar: ScanBar unmounts on every tab switch, so keeping it there would
  // reopen the keypad each time the operator comes back to the scan tab. It always starts closed —
  // the "123" button is the only way in, and the qty field itself is always typable.
  const [padOpen, setPadOpen] = useState(false)
  const tabMetaKey = sessionTabKey(sessionId)
  const savedTab = useLive(() => localRepo.getMeta(tabMetaKey), [tabMetaKey], null)
  // Anything other than 'items' falls back to 'scan', which also migrates a device that still has
  // 'docs' saved from before the review screen existed: the value stays in Dexie until the
  // session is deleted, so it must not be able to select a tab that is gone.
  const tab: SessionTab = savedTab === 'items' ? 'items' : 'scan'
  const setTab = (next: SessionTab) => {
    localRepo.setMeta(tabMetaKey, next).catch(() => {
      toast('danger', 'Gagal berpindah bagian. Coba lagi.')
    })
  }
  const scanRef = useRef<HTMLInputElement>(null)
  // Scans are saved strictly one after another (FIFO), even when the scanner is faster than IndexedDB.
  const scanQueueRef = useRef<Promise<void>>(Promise.resolve())

  // Keep the scanner's keystrokes landing in the barcode field. While the qty editor is open
  // focus belongs to it; when it closes the field gets focus back, otherwise the scanner's Enter
  // would press the previously focused button and reopen the sheet.
  // `tab` is in the deps because the barcode field only exists on the scan tab: coming back from
  // the item tab remounts it, and without this the focus would stay on the tab button.
  useEffect(() => {
    if (session?.status !== SESSION_STATUS.RUNNING || editingLineId) return
    if (tab !== 'scan') return
    const frame = window.requestAnimationFrame(() => scanRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [session?.status, tab, editingLineId])

  // Scanner wedge. The effect above only runs when one of its deps changes, so a tap on dead space
  // (the context strip, the empty area of the scan result, the app bar title) drops focus to <body>
  // and nothing brings it back: the scanner then types into nowhere and the scan is lost in silence.
  // This catches printable keystrokes that landed outside any text field and redirects them — the
  // triggering character included — into the barcode field. From the second character onwards the
  // field has focus and receives them normally, and the scanner's closing Enter lands there too.
  useEffect(() => {
    if (session?.status !== SESSION_STATUS.RUNNING || editingLineId) return
    if (tab !== 'scan') return
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // Printable characters only: Enter, Tab, Escape and the arrows must keep working.
      if (event.key.length !== 1) return
      // Space activates a focused button; swallowing it would break keyboard operation.
      if (event.key === ' ') return
      const target = event.target
      // Every element that legitimately swallows typing. `<select>` and contenteditable do not
      // exist in this screen today; they are listed so that adding one later cannot silently
      // start redirecting its keystrokes into the barcode field.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      const field = scanRef.current
      if (!field) return
      event.preventDefault()
      field.focus()
      setScan((previous) => previous + event.key)
    }
    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [session?.status, tab, editingLineId])

  const dismissHero = useCallback(() => setHeroState({ kind: 'IDLE' }), [])

  if (!session) return <Loading label="Memuat sesi…" />

  const editable = session.status === SESSION_STATUS.RUNNING
  const editingLine = editingLineId
    ? (lines.find((line) => line.lineId === editingLineId) ?? null)
    : null
  const editingPurchaseItem = editingLine
    ? purchaseItemMap.get(editingLine.purchaseItemId)
    : undefined
  const editingItem = editingLine ? items[editingLine.itemMasterId] : undefined

  const processScan = async (code: string, qtyText: string) => {
    try {
      const addedQty = Number(qtyText)
      const result = await addScannedItem(
        localRepo,
        session.sessionId,
        session.purchaseId,
        code,
        addedQty,
      )
      if (result.ok && result.line && result.resolution.purchaseItem && result.resolution.item) {
        const purchaseItem = result.resolution.purchaseItem
        const line = result.line
        const ordered = Number(purchaseItem.qty ?? 0)
        const serverReceived = Number(purchaseItem.receivedQty ?? 0)
        const itemTotal = serverReceived + line.qty
        const excess = itemTotal - ordered
        const purchaseUnit = unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId
        lastScanRef.current = { lineId: line.lineId, addedQty }
        if (excess > 0) {
          setHeroState({
            kind: 'OVER',
            itemName: result.resolution.item.name,
            ordered,
            newTotal: itemTotal,
            excess,
            unit: purchaseUnit,
          })
          playFeedback('over')
        } else {
          setHeroState({
            kind: 'OK',
            itemName: result.resolution.item.name,
            itemCode: result.resolution.item.code,
            addedQty,
            purchaseUnit,
            stockQty: addedQty * line.convQty,
            stockUnit: unitMap.get(line.uomId) ?? line.uomId,
            itemOrdered: ordered,
            itemTotal,
            itemServerReceived: serverReceived,
          })
          playFeedback('success')
        }
        setQty('1')
        setQtyTouched(false)
      } else if (result.resolution.status === 'ITEM_NOT_FOUND') {
        lastScanRef.current = null
        setHeroState({ kind: 'NOT_FOUND', scannedCode: code })
        playFeedback('danger')
      } else if (result.resolution.status === 'NOT_IN_PO') {
        lastScanRef.current = null
        // Sounded BEFORE the lookup below, like the three other branches do. In a noisy dock the
        // beep is what the operator goes by, and until the lookup resolves the card still shows
        // the PREVIOUS scan — so waiting would leave a stale success on screen, unannounced.
        playFeedback('warn')
        // Only reachable when the item resolved, so this lookup runs at most once per rejected
        // scan — and it uses the itemMasterId index, so it does not scan the table.
        const scannedItem = result.resolution.item
        const others = scannedItem
          ? await localRepo.findPurchasesWithItem(scannedItem.itemMasterId, session.purchaseId)
          : null
        const [firstOther] = others?.rows ?? []
        setHeroState({
          kind: 'NOT_IN_PO',
          itemName: scannedItem?.name ?? code,
          otherPurchase: firstOther ?? null,
          // `total`, not `rows.length`: the list is capped at five POs, the count is not.
          otherCount: Math.max(0, (others?.total ?? 0) - 1),
        })
      } else {
        // Resolution succeeded but the line was rejected (today: qty <= 0). Show the real reason
        // instead of mislabelling it as "not part of this PO".
        lastScanRef.current = null
        toast('danger', result.message)
        playFeedback('danger')
      }
    } catch (error) {
      lastScanRef.current = null
      setHeroState({ kind: 'NOT_FOUND', scannedCode: code })
      toast('danger', error instanceof Error ? error.message : 'Gagal menyimpan hasil scan.')
      playFeedback('danger')
    } finally {
      scanRef.current?.focus()
    }
  }

  /**
   * Undo subtracts exactly the qty the last scan added. `addOrIncrementLine` merges repeated
   * scans of one item into a single line, so removing the whole line would delete more than
   * the last scan; the line is only removed when nothing would be left.
   */
  const handleUndo = async () => {
    const target = lastScanRef.current
    if (!target) return
    lastScanRef.current = null
    setHeroState({ kind: 'IDLE' })
    try {
      const line = await localRepo.db.sessionItems.get(target.lineId)
      if (!line) return
      const next = line.qty - target.addedQty
      if (next > 0) await localRepo.setLineQty(target.lineId, next)
      else await localRepo.removeLine(target.lineId)
      toast('info', 'Scan terakhir dibatalkan.')
    } catch {
      toast('danger', 'Gagal membatalkan scan terakhir.')
    } finally {
      scanRef.current?.focus()
    }
  }

  /**
   * "Buka PO itu" on the NOT_IN_PO card. When this device already has a RUNNING session for that
   * PO, go straight to the session instead of to the PO detail screen: that screen carries no
   * "Lanjutkan sesi berjalan" banner — that one lives on the PO LIST (routes/pos/index.tsx) — and
   * its "Mulai Penerimaan" button calls `createSession` unconditionally, which has no dedupe. So
   * landing there would let the operator start a SECOND session for a PO already being received
   * and record the same delivery twice. Either way the session being left stays RUNNING in Dexie
   * and is reachable from the session list.
   */
  const openPurchase = async (purchaseId: string) => {
    const running = await localRepo.runningSessions()
    const existing = running.find((row) => row.purchaseId === purchaseId)
    if (existing) {
      void navigate({ to: '/sessions/$sessionId', params: { sessionId: existing.sessionId } })
      return
    }
    void navigate({ to: '/pos/$purchaseId', params: { purchaseId } })
  }

  const handleAdd = () => {
    const code = scan.trim()
    if (!code) return
    const qtyText = qty
    // Scanners type like a keyboard: clear the field synchronously so the next burst
    // starts on an empty input, then save scans one after another.
    setScan('')
    // processScan handles its own errors; the catch only keeps the queue alive should its
    // error handling itself throw (e.g. in the feedback), so later scans are never dropped.
    scanQueueRef.current = scanQueueRef.current
      .then(() => processScan(code, qtyText))
      .catch(() => undefined)
  }

  // Step 2 of receiving lives on its own route. The draft is saved there, on the way out, so
  // nothing needs to be written here first.
  const openReview = () => {
    void navigate({ to: '/sessions/review/$sessionId', params: { sessionId } })
  }

  const handleCancel = async () => {
    await localRepo.deleteSession(session.sessionId)
    void navigate({ to: '/sessions' })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Fixed header: never scrolls. */}
      <div className="shrink-0 px-3 pt-2">
        <AppBar
          title="Terima barang"
          backTo="/sessions"
          backLabel="Kembali ke daftar sesi"
          actions={<Badge tone={toneFor(session.status)}>{SESSION_STATUS_LABEL[session.status]}</Badge>}
        />
        {/* No over-receive line here any more: session.overReceive is written only by markSynced,
            so it could only ever be true on a document that already reached the server — never
            while scanning. The warning BEFORE sending is the review screen's callout, and the
            one AFTER is on the send-status row. */}
        <SessionContextStrip
          purchaseLabel={session.purchaseNumber ?? session.purchaseId}
          vendorName={session.vendorName ?? '-'}
          itemCount={lines.length}
          ordered={purchaseProgress?.orderedTotal ?? 0}
          serverReceived={purchaseProgress?.serverReceivedTotal ?? 0}
          localPending={purchaseProgress?.localPendingTotal ?? 0}
        />
      </div>

      {/* The only scrollable region. It is the tab panel while the session is editable. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        role={editable ? 'tabpanel' : undefined}
        id={editable ? 'session-tab-panel' : undefined}
        aria-labelledby={editable ? `session-tab-${tab}` : undefined}
      >
        {editable && tab === 'scan' ? (
          <ScanHero
            state={heroState}
            onUndo={() => void handleUndo()}
            onDismiss={dismissHero}
            onOpenPurchase={(purchaseId) => void openPurchase(purchaseId)}
          />
        ) : null}

        {!editable || tab === 'items' ? (
          <Card title={`Item dalam sesi (${lines.length})`}>
            {editable ? (
              <p className="mb-1 text-sm text-fg-subtle">Ketuk item untuk mengubah qty atau menghapus.</p>
            ) : null}
            <ul className="flex flex-col divide-y divide-line-soft">
              {lines.map((line) => {
                const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
                const item = items[line.itemMasterId]
                const isOver = overLineIds.has(line.lineId)
                return (
                  <li key={line.lineId}>
                    <button
                      type="button"
                      className="touch-target w-full py-3 text-left"
                      disabled={!editable}
                      onClick={() => setEditingLineId(line.lineId)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-fg">{item?.name ?? line.itemMasterId}</p>
                          <p className="text-sm text-fg-subtle">
                            {item?.code ?? '-'} • {formatQty(line.qty)}{' '}
                            {unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId}
                            {line.convFound ? '' : ' • konversi tidak ditemukan (faktor 1)'}
                          </p>
                          <p className="text-sm tabular-nums text-fg-subtle">
                            = {formatQty(line.qty * line.convQty)} {unitMap.get(line.uomId) ?? line.uomId}
                          </p>
                          {purchaseItem ? (
                            <p className="text-sm tabular-nums text-fg-muted">
                              Dipesan {formatQty(purchaseItem.qty)} {unitMap.get(purchaseItem.uomId) ?? ''}
                            </p>
                          ) : null}
                        </div>
                        {isOver ? <Badge tone="danger">Over-receive</Badge> : null}
                      </div>
                    </button>
                  </li>
                )
              })}
              {lines.length === 0 ? <EmptyState>Belum ada item. Scan barcode untuk menambah.</EmptyState> : null}
            </ul>
          </Card>
        ) : null}

        {/* Hold-to-cancel sits on the item tab, not in the review screen's footer: nothing
            destructive should share a row with the send button. */}
        {editable && tab === 'items' ? (
          <div className="mt-2 flex flex-col gap-2">
            <ConfirmButton
              tone="danger"
              className="w-full"
              label="Batalkan sesi ini"
              confirmLabel="Tahan terus… sesi akan dibatalkan"
              onConfirm={() => void handleCancel()}
            />
            <p className="text-center text-sm text-fg-subtle">
              Tombol merah perlu ditahan 1,5 detik supaya tidak tersenggol.
            </p>
          </div>
        ) : null}

        {/* Read-only only: on a RUNNING session these numbers are edited on the review screen. */}
        {!editable ? (
          <div className="mt-2">
            <VendorDocCard
              invoice={session.invoiceNumber}
              doNumber={session.doNumber}
              editable={false}
            />
            {session.receiveDate ? (
              <p className="mt-2 text-sm text-fg-subtle">
                Tanggal penerimaan: {session.receiveDate}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-fg-subtle">ID sesi: {session.sessionId}</p>
          </div>
        ) : null}

        {!editable ? (
          <div className="mt-2 flex flex-col gap-2">
            {session.status === SESSION_STATUS.PENDING || session.status === SESSION_STATUS.FAILED ? (
              <>
                {session.lastError ? <Notice tone="danger">{session.lastError}</Notice> : null}
                {/* No per-document send button here. The one that used to sit on this spot called
                    sync(), which pushes the WHOLE outbox — so a button next to one document was
                    sending all of them. Sending is a device-level action, and it lives on the
                    screen that shows every document's state. */}
                <Notice tone="warn">
                  Dokumen ini belum terkirim. Pengiriman berlaku untuk semua dokumen sekaligus.
                </Notice>
                <Link
                  to="/sessions"
                  className="touch-target flex w-full items-center justify-center gap-1 rounded-lg bg-brand font-semibold text-on-brand transition hover:bg-brand-bright"
                >
                  Buka daftar Penerimaan
                </Link>
              </>
            ) : null}
            {session.status === SESSION_STATUS.REJECTED ? (
              <>
                <Notice tone="danger">
                  Sesi ditolak server: {session.lastError ?? 'PO tidak dapat diterima.'}
                </Notice>
                <ConfirmButton
                  tone="danger"
                  className="w-full"
                  label="Hapus sesi dari perangkat"
                  confirmLabel="Tahan terus… sesi akan dihapus"
                  onConfirm={() => void handleCancel()}
                />
              </>
            ) : null}
            {session.status === SESSION_STATUS.SYNCED ? (
              <Notice tone="success">
                Tersinkron sebagai {session.number}. Dokumen bersifat baca-saja di perangkat.
              </Notice>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Fixed bottom: scan bar + tab bar. Never scrolls. */}
      {editable ? (
        <div className="shrink-0 border-t border-line bg-chrome/95 pb-[env(safe-area-inset-bottom)]">
          {tab === 'scan' ? (
            <div className="px-3 py-2">
              <ScanBar
                scan={scan}
                qty={qty}
                qtyTouched={qtyTouched}
                scanRef={scanRef}
                padOpen={padOpen}
                onPadOpenChange={setPadOpen}
                onScanChange={setScan}
                onQtyChange={(value) => {
                  setQty(value)
                  setQtyTouched(true)
                }}
                onAdd={() => void handleAdd()}
                // Escape clears a result that is WAITING for the operator. The success card is
                // not waiting — it is replaced by the next scan — and clearing it would remove
                // "Batalkan scan ini", the only route to the precise undo of the last increment.
                onEscape={() => {
                  if (heroState.kind !== 'OK') dismissHero()
                }}
              />
            </div>
          ) : null}
          <SessionTabs
            value={tab}
            onChange={setTab}
            itemCount={lines.length}
            onReview={openReview}
            docsComplete={Boolean(session.invoiceNumber.trim() && session.doNumber.trim())}
          />
        </div>
      ) : null}

      {editable && editingLine && editingItem ? (
        <LineEditSheet
          key={editingLine.lineId}
          line={editingLine}
          itemName={editingItem.name}
          purchaseUnit={unitMap.get(editingLine.uomPurchaseId) ?? editingLine.uomPurchaseId}
          stockUnit={unitMap.get(editingLine.uomId) ?? editingLine.uomId}
          orderedText={
            editingPurchaseItem
              ? `Dipesan ${formatQty(editingPurchaseItem.qty)} ${unitMap.get(editingPurchaseItem.uomId) ?? ''}`
              : 'Item tidak ditemukan pada PO'
          }
          onQtyChange={(nextQty) => void localRepo.setLineQty(editingLine.lineId, nextQty)}
          onRemove={() => void localRepo.removeLine(editingLine.lineId)}
          onClose={() => setEditingLineId(null)}
        />
      ) : null}
    </div>
  )
}


function LineEditSheet({
  line,
  itemName,
  purchaseUnit,
  stockUnit,
  orderedText,
  onQtyChange,
  onRemove,
  onClose,
}: {
  line: LocalSessionItem
  itemName: string
  purchaseUnit: string
  stockUnit: string
  orderedText: string
  onQtyChange: (qty: number) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [draftQty, setDraftQty] = useState(String(line.qty))
  const dialogRef = useRef<HTMLDivElement>(null)
  const qtyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    qtyInputRef.current?.focus()
  }, [])

  const commit = () => {
    const parsed = Number(draftQty)
    if (Number.isFinite(parsed) && parsed > 0) onQtyChange(parsed)
  }

  const close = () => {
    commit()
    onClose()
  }

  const step = (amount: number) => {
    const current = Number(draftQty)
    const base = Number.isFinite(current) && current > 0 ? current : line.qty
    const next = base + amount
    if (next <= 0) return
    setDraftQty(String(next))
    onQtyChange(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled])',
    )
    if (!focusables || focusables.length === 0) return
    const list = Array.from(focusables)
    const first = list[0]
    const last = list[list.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Tutup editor qty"
        className="absolute inset-0 bg-scrim/60"
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${itemName}`}
        className="relative rounded-t-2xl border-t border-line bg-sheet p-4 pb-[env(safe-area-inset-bottom)]"
        onKeyDown={handleKeyDown}
      >
        <p className="text-lg font-bold text-fg">{itemName}</p>
        <p className="text-sm text-fg-subtle">
          {orderedText} • 1 {purchaseUnit} = {formatQty(line.convQty)} {stockUnit}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="secondary"
            className="px-5! py-3! text-xl"
            aria-label="Kurangi qty satu satuan PO"
            onClick={() => step(-1)}
          >
            −1
          </Button>
          <input
            ref={qtyInputRef}
            className={`${inputClass} w-full border-line-strong text-center text-xl font-bold tabular-nums`}
            inputMode="decimal"
            aria-label={`Qty ${itemName}`}
            value={draftQty}
            onChange={(event) => {
              const raw = event.target.value
              if (/^\d*(?:[.,]\d*)?$/.test(raw)) setDraftQty(raw.replace(',', '.'))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                close()
              }
            }}
          />
          <Button
            variant="secondary"
            className="px-5! py-3! text-xl"
            aria-label="Tambah qty satu satuan PO"
            onClick={() => step(1)}
          >
            +1
          </Button>
        </div>
        <p className="mt-2 text-sm tabular-nums text-fg-muted">
          {formatQty(Number(draftQty) > 0 ? Number(draftQty) : line.qty)} {purchaseUnit} ={' '}
          {formatQty((Number(draftQty) > 0 ? Number(draftQty) : line.qty) * line.convQty)} {stockUnit}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <ConfirmButton
            tone="danger"
            className="w-full"
            label="Hapus item ini"
            confirmLabel="Tahan terus… item akan dihapus"
            onConfirm={() => {
              onRemove()
              onClose()
            }}
          />
          <Button variant="ghost" className="w-full" onClick={close}>
            Tutup
          </Button>
        </div>
      </div>
    </div>
  )
}

const SESSION_TAB_IDS: readonly SessionTab[] = ['scan', 'items']

function SessionTabs({
  value,
  onChange,
  itemCount,
  onReview,
  docsComplete,
}: {
  value: SessionTab
  onChange: (next: SessionTab) => void
  itemCount: number
  /** Leaves the cockpit for step 2. Not a tab — see the note on the button below. */
  onReview: () => void
  /** Drives the "something is still missing" dot, which now sits on the Review button. */
  docsComplete: boolean
}) {
  // Bottom tab bar: a top border marks the active tab instead of a pill, so the bar reads as
  // part of the shell rather than as three floating buttons.
  const tabClass = (active: boolean): string =>
    `touch-target flex-1 border-t-2 px-2 text-sm font-semibold transition ${
      active
        ? 'border-brand-bright bg-raised text-brand-soft'
        : 'border-transparent text-fg-muted hover:bg-raised'
    }`

  // Roving tabindex + arrow keys: on a keypad-first device, reaching the third tab must not cost
  // three Tab presses.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = SESSION_TAB_IDS.indexOf(value)
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = SESSION_TAB_IDS[(index + delta + SESSION_TAB_IDS.length) % SESSION_TAB_IDS.length]
    if (!next) return
    onChange(next)
    // The scan tab is excluded on purpose: its own focus effect puts focus in the barcode field,
    // and moving it to the tab button here would fight that. For the other two, the new `tab`
    // value only arrives on a later commit (it round-trips through Dexie), hence the frame wait.
    if (next !== 'scan') {
      window.requestAnimationFrame(() => {
        document.getElementById(`session-tab-${next}`)?.focus()
      })
    }
  }

  return (
    <div className="flex">
      {/* `flex-[2]`, not `flex-1`: this row has only TWO flex items — the tablist and the Review
          button — so `flex-1` on both would give the tablist half the bar and split that half
          between two tabs, i.e. 80/80/160 px at 320 px instead of three equal parts. Weighting
          the tablist by two makes each of the three controls 1/3 wide. */}
      <div
        role="tablist"
        aria-label="Bagian sesi penerimaan"
        className="flex flex-[2]"
        onKeyDown={handleKeyDown}
      >
        {SESSION_TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`session-tab-${id}`}
            aria-selected={value === id}
            aria-controls="session-tab-panel"
            tabIndex={value === id ? 0 : -1}
            className={tabClass(value === id)}
            onClick={() => onChange(id)}
          >
            {id === 'scan' ? 'Scan' : null}
            {id === 'items' ? `Item (${itemCount})` : null}
          </button>
        ))}
      </div>
      {/* A navigation button, NOT a third tab: it leaves this route for the review screen, so it
          must sit outside the tablist — inside it, a screen reader would announce it as a tab
          that never becomes selected, and the arrow-key roving index would try to focus it.
          `flex-1` against the tablist's `flex-[2]` is what makes it exactly one third; the bar's
          height is unchanged because it carries `.touch-target` like the tabs do. */}
      <button
        type="button"
        className="touch-target flex-1 border-t-2 border-transparent px-2 text-sm font-semibold text-fg-muted transition hover:bg-raised"
        onClick={onReview}
      >
        <span className="inline-flex items-center gap-1.5">
          Review
          {docsComplete ? null : (
            <span
              aria-label="dokumen belum lengkap"
              className="inline-block h-2.5 w-2.5 rounded-full bg-warn"
            />
          )}
        </span>
      </button>
    </div>
  )
}

