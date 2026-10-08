import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { localRepo, sessionTabKey } from '~/client/db/local-repo'
import { useLive } from '~/client/hooks/use-live'
import { useSessionData } from '~/client/hooks/use-session-data'
import { useAppStore } from '~/client/state/store/app-store'
import { loadPreferences } from '~/client/preferences'
import { addPickedItem, addScannedItem } from '~/client/services/scanning'
import type { LocalSessionItem } from '~/client/db/local-db'
import { playFeedback } from '~/client/feedback'
import { setScanFocusHandler } from '~/client/scan-focus'
import { toast } from '~/client/toast'
import { AppBar } from '~/components/app-bar'
import { ConfirmButton } from '~/components/confirm-button'
import { ItemPicker } from '~/components/item-picker'
import { ScanBar } from '~/components/scan-bar'
import { ScanHero, type ScanHeroState } from '~/components/scan-hero'
import { sessionLineRowHeight } from '~/components/row-heights'
import { ScrollContainerProvider } from '~/components/scroll-container'
import { SessionContextStrip } from '~/components/session-context-strip'
import { SessionOwnerGate } from '~/components/session-owner-gate'
import { VendorDocCard } from '~/components/vendor-doc-card'
import { Badge, Button, Card, EmptyState, Loading, Notice, inputClass } from '~/components/ui'
import { VirtualList } from '~/components/virtual-list'
import { SESSION_STATUS, SESSION_STATUS_LABEL, type SessionStatus } from '~/shared/constants'
import { formatQty } from '~/shared/format'
import { buildPickerItems } from '~/shared/item-picker'
import {
  canEditSession,
  findRunningSessionForPurchase,
  isOwnedBy,
  ownerName,
} from '~/shared/session-owner'

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
  /**
   * What the last successful addition did, so undo can take back exactly that much. A ref, not
   * state: it is never rendered, and as state every scan would cost one extra render of the whole
   * cockpit.
   *
   * `clearPickedOnUndo` is true only for a pick that RAISED the line's manual flag — i.e. the line
   * was not flagged before. Undo then lowers it again, so the badge never claims "part of this qty
   * was never scanned" about a line that, after the undo, is pure scan. It is false for every scan,
   * because a scan never raises the flag and must never lower one that was already up.
   */
  const lastScanRef = useRef<{
    lineId: string
    addedQty: number
    clearPickedOnUndo: boolean
  } | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  /**
   * Whether the PO item picker is open. It is BOTH the render switch and the guard on the two
   * effects below — see P-9.7/P-9.8 and the comment in `components/item-picker.tsx`: while this
   * overlay is up, the barcode field must not take focus back and the scanner wedge must not
   * redirect keystrokes into it, or the picker's search field cannot be typed into at all.
   */
  const [pickerOpen, setPickerOpen] = useState(false)
  /**
   * Read ONCE per mount, not subscribed. Pengaturan is a different route, so coming back from it
   * remounts this component and picks up the new value; `playFeedback` reads preferences the same
   * way, on every call, with no subscription anywhere.
   */
  const [manualPickEnabled] = useState(() => loadPreferences().manualPick)
  // Lives here, not in ScanBar: ScanBar unmounts on every tab switch, so keeping it there would
  // reopen the keypad each time the operator comes back to the scan tab. It always starts closed —
  // the "123" button is the only way in, and the qty field itself is always typable.
  const [padOpen, setPadOpen] = useState(false)
  const tabMetaKey = sessionTabKey(sessionId)
  const savedTab = useLive(() => localRepo.getMeta(tabMetaKey), [tabMetaKey], null)
  /**
   * The PO's own lines, loaded ONLY while the picker is open: this component re-renders on every
   * character the scanner types, and the scan loop must not pay for a list it is not showing.
   *
   * `getPurchaseDetail` is reused as-is instead of getting a leaner sibling. It already returns,
   * per PO line, the master row (name, code, all three barcodes) and the three qty numbers that
   * `buildPickerItems` needs — so a new repository method would only be a second definition of the
   * same query, free to drift.
   */
  const pickerDetail = useLive(
    async () => (pickerOpen && session ? localRepo.getPurchaseDetail(session.purchaseId) : null),
    [pickerOpen, session?.purchaseId],
    null,
  )
  /**
   * `lines` is this session's own lines, which is what makes "sudah N di sesi ini" honest — see the
   * note on `buildPickerItems` about `localPendingQty` counting a colleague's running session too.
   */
  const pickerItems = useMemo(
    () =>
      pickerDetail
        ? buildPickerItems(pickerDetail.items, lines, (uomId) => unitMap.get(uomId) ?? uomId)
        : [],
    [pickerDetail, lines, unitMap],
  )
  /**
   * The session's lines, each carrying the one fact outside the line itself that decides how tall
   * its row is: whether the PO line could be resolved, which is what renders the "Dipesan N" line.
   *
   * It is bundled into the array rather than read from a closure because the identity of the array
   * handed to `VirtualList` is the ONLY thing that invalidates its measurements — see the contract
   * on `rows` in components/virtual-list.tsx. `purchaseItems` is loaded from `session.purchaseId`
   * while `lines` is loaded from `sessionId`, so the map arrives a Dexie round AFTER the lines:
   * without this, every row is measured while the map is still empty, and the "Dipesan" line that
   * appears a moment later is clipped by the height those measurements fixed. A pull that calls
   * `replacePurchases` can reopen the same gap at any time.
   */
  const lineRows = useMemo(
    () =>
      lines.map((line) => ({
        line,
        hasOrderedLine: purchaseItemMap.has(line.purchaseItemId),
      })),
    [lines, purchaseItemMap],
  )
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
  /**
   * The cockpit's own scroller, handed to the session-line list so it can render only the rows on
   * screen. It cannot use the shell's <main>: on this route <main> is overflow-hidden
   * (`isSessionFlow` in components/app-shell.tsx) and the element below is what actually scrolls.
   * Declared here, with the other refs and before the early returns, because this file's hook
   * order is load-bearing.
   */
  const scrollRef = useRef<HTMLDivElement>(null)
  const user = useAppStore((state) => state.user)
  // Acknowledgement of the ownership gate below. Route state on purpose — not a search param,
  // not persisted: it lasts exactly as long as this screen stays open, so reopening the session
  // asks again. It is the cheap half of the rule; the half that actually protects the document is
  // `canEdit`, which does not depend on it at all.
  const [ownerAcknowledged, setOwnerAcknowledged] = useState(false)
  const currentUserId = user?.userId ?? null
  // Plain consts, deliberately computed HERE: the two effects below guard on "may this operator
  // scan into this session", and they cannot read `editable`, which is declared after the early
  // return for a missing session.
  const isOwner = Boolean(session && isOwnedBy(session, currentUserId))
  const canEdit = Boolean(session && canEditSession(session, currentUserId))

  // Keep the scanner's keystrokes landing in the barcode field. While the qty editor is open
  // focus belongs to it; when it closes the field gets focus back, otherwise the scanner's Enter
  // would press the previously focused button and reopen the sheet.
  // `tab` is in the deps because the barcode field only exists on the scan tab: coming back from
  // the item tab remounts it, and without this the focus would stay on the tab button.
  useEffect(() => {
    // `pickerOpen` belongs in this condition for the same reason `editingLineId` does: while a
    // dialog with its own text field is up, the focus is ITS business. Without it, this effect
    // would pull the focus out of the picker's search field on every re-render.
    if (!canEdit || editingLineId || pickerOpen) return
    if (tab !== 'scan') return
    const frame = window.requestAnimationFrame(() => scanRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [canEdit, tab, editingLineId, pickerOpen])

  // Scanner wedge. The effect above only runs when one of its deps changes, so a tap on dead space
  // (the context strip, the empty area of the scan result, the app bar title) drops focus to <body>
  // and nothing brings it back: the scanner then types into nowhere and the scan is lost in silence.
  // This catches printable keystrokes that landed outside any text field and redirects them — the
  // triggering character included — into the barcode field. From the second character onwards the
  // field has focus and receives them normally, and the scanner's closing Enter lands there too.
  useEffect(() => {
    // `pickerOpen` again, and here it is the one that actually breaks things when forgotten: this
    // listener sits on `window`, so it fires for keystrokes typed into the picker's search field
    // too — `event.target` is that `<input>`, which the guard below lets through, but the moment the
    // operator taps the picker's heading the focus is on a non-field element and every character
    // gets redirected into the barcode field BEHIND the overlay. Invisible, and it reads as a broken
    // keyboard.
    if (!canEdit || editingLineId || pickerOpen) return
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
  }, [canEdit, tab, editingLineId, pickerOpen])

  // Lets the app bar put the focus back into the barcode field — see src/client/scan-focus.ts.
  // The "Nanti" button of the update banner lives in the app bar, which is a SIBLING of this
  // route, so it has no other way to reach `scanRef`.
  //
  // The condition and the deps are deliberately IDENTICAL to the two effects above. A read-only
  // cockpit must not claim the scanner, and while the qty sheet or the picker is open the focus is
  // THEIRS: with no handler registered, `requestScanFocus()` is simply a no-op, which is the right
  // answer — better a focus that stays put than one yanked out of the picker's search field.
  useEffect(() => {
    if (!canEdit || editingLineId || pickerOpen) return
    if (tab !== 'scan') return
    setScanFocusHandler(() => scanRef.current?.focus())
    return () => setScanFocusHandler(null)
  }, [canEdit, tab, editingLineId, pickerOpen])

  const dismissHero = useCallback(() => setHeroState({ kind: 'IDLE' }), [])

  if (!session) return <Loading label="Memuat sesi…" />
  // No logged-in user means the shell is about to redirect to /login (app-shell.tsx:119-123).
  // Showing the ownership gate in that window would claim a session is somebody else's purely
  // because nobody is logged in yet.
  if (!user) return <Loading label="Memuat sesi…" />

  // Step 1 of the rule: acknowledge whose session this is. Shown for every status — a colleague's
  // finished document is no more mine than their running one — and shown INSTEAD of the cockpit,
  // so the scanner wedge above never runs for a non-owner.
  if (!isOwner && !ownerAcknowledged) {
    return (
      <SessionOwnerGate
        ownerName={ownerName(session)}
        createdAt={session.createdAt}
        onAcknowledge={() => setOwnerAcknowledged(true)}
      />
    )
  }

  // Step 2: `editable` now means "RUNNING **and** mine". Every control that can change the
  // session already keys off it — scan bar, tab bar, qty sheet, the per-line button, the cancel
  // button — so a non-owner gets the read-only cockpit without any of them learning a new rule.
  const editable = canEdit
  const editingLine = editingLineId
    ? (lines.find((line) => line.lineId === editingLineId) ?? null)
    : null
  const editingPurchaseItem = editingLine
    ? purchaseItemMap.get(editingLine.purchaseItemId)
    : undefined
  const editingItem = editingLine ? items[editingLine.itemMasterId] : undefined

  /**
   * The OK/OVER card for ONE successful addition. Shared by the scanner and the PO picker, so both
   * report a receipt the same way — over-receive included.
   *
   * Keeping it in one place is what stops the picker from quietly skipping the OVER card, which is
   * the only warning the operator gets at the moment a qty goes above the order. A second copy of
   * "excess = serverReceived + line.qty − ordered" is exactly the kind of duplication that drifts.
   *
   * Declared inside the component because it reads `unitMap`. It holds no state of its own.
   */
  const addedHero = (
    itemName: string,
    itemCode: string | null,
    addedQty: number,
    line: LocalSessionItem,
    ordered: number,
    serverReceived: number,
  ): ScanHeroState => {
    // `line.qty` is the line's total AFTER the merge, so this is the item's new total, not the
    // addition. That is what both cards report.
    const itemTotal = serverReceived + line.qty
    const excess = itemTotal - ordered
    const purchaseUnit = unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId
    if (excess > 0) {
      return { kind: 'OVER', itemName, ordered, newTotal: itemTotal, excess, unit: purchaseUnit }
    }
    return {
      kind: 'OK',
      itemName,
      itemCode,
      addedQty,
      purchaseUnit,
      stockQty: addedQty * line.convQty,
      stockUnit: unitMap.get(line.uomId) ?? line.uomId,
      itemOrdered: ordered,
      itemTotal,
      itemServerReceived: serverReceived,
    }
  }

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
        const hero = addedHero(
          result.resolution.item.name,
          result.resolution.item.code,
          addedQty,
          line,
          Number(purchaseItem.qty ?? 0),
          Number(purchaseItem.receivedQty ?? 0),
        )
        // A scan never raises the manual flag, so undo of a scan must never lower one that was
        // already up: that flag belongs to an earlier pick this undo has nothing to do with.
        lastScanRef.current = { lineId: line.lineId, addedQty, clearPickedOnUndo: false }
        setHeroState(hero)
        playFeedback(hero.kind === 'OVER' ? 'over' : 'success')
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
   * Undo takes back exactly the qty the last addition added — a scan or a pick, the same way.
   * `addOrIncrementLine` merges repeated additions for one item into a single line, so removing the
   * whole line would delete more than the last addition; the line is only removed when nothing
   * would be left.
   *
   * The manual flag is lowered only when `clearPickedOnUndo` says this very addition raised it.
   * Nothing else in the app lowers it — see `addOrIncrementLine`, where it can only go up.
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
      if (next > 0) {
        await localRepo.setLineQty(target.lineId, next)
        if (target.clearPickedOnUndo) await localRepo.setLinePickedManually(target.lineId, false)
      } else {
        // The whole line goes, and the flag goes with it. No second write needed.
        await localRepo.removeLine(target.lineId)
      }
      // "Penambahan", not "Scan": one undo serves both paths now, and on the picker path there was
      // no scan to speak of.
      toast('info', 'Penambahan terakhir dibatalkan.')
    } catch {
      toast('danger', 'Gagal membatalkan penambahan terakhir.')
    } finally {
      scanRef.current?.focus()
    }
  }

  /**
   * "Buka PO itu" on the NOT_IN_PO card. When this operator already has a RUNNING session of their
   * OWN for that PO, go straight to it instead of to the PO detail screen.
   *
   * Since "dedupe sesi per PO" the PO screen would catch the duplicate too — it asks
   * `findRunningSessionForPurchase` before creating anything and opens `DuplicateSessionSheet`. So
   * this is no longer the only guard against recording one delivery twice; it is the shorter road.
   * Keep it: dropping it turns one tap into three, and it lands the operator back in the session
   * they were already filling instead of in a sheet asking about it.
   *
   * The owner filter inside the helper is what keeps the shortcut useful: a colleague's RUNNING
   * session for that PO is not something this operator may continue, so jumping into it would
   * strand them on the ownership gate, whose only exits are "look" and "back to the list" — never
   * the PO screen, which is exactly where they ARE allowed to start a session of their own (with
   * the warning that names the other operator). Either way the session being left stays RUNNING in
   * Dexie and is reachable from the session list.
   */
  const openPurchase = async (purchaseId: string) => {
    const existing = findRunningSessionForPurchase(
      await localRepo.runningSessions(),
      purchaseId,
      currentUserId,
    )
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

  /**
   * Writes one picked line. Deliberately shaped like `processScan`: same resolution type, same
   * card, same sound, same return of focus to the barcode field.
   *
   * The failure branch does NOT show the NOT_FOUND card. That card is about a barcode, and this
   * path never had one — `addPickedItem`'s two failures are both "the device's data is incomplete",
   * which is a sentence, not a card. They are also not reachable through the picker's UI, which
   * disables a row whose master row is missing.
   */
  const processPick = async (purchaseItemId: string, pickedQty: number) => {
    try {
      /**
       * Read from the DATABASE, here inside the queued task, immediately before the write — never
       * from the `pickerItems` snapshot the operator tapped.
       *
       * `clearPickedOnUndo` is `!pickedBefore`, so a stale `false` does not fail safe: it would make
       * undo CLEAR a flag an earlier pick had legitimately raised, leaving a line whose remaining qty
       * never saw a barcode without the badge that says so. The opposite staleness cannot happen —
       * only `handleUndo` ever lowers the flag, and it empties `lastScanRef` first. Inside the serial
       * queue this read is also ordered after every addition already in flight.
       */
      const existing = await localRepo.findSessionLine(session.sessionId, purchaseItemId)
      const pickedBefore = existing?.pickedManually ?? false
      const result = await addPickedItem(
        localRepo,
        session.sessionId,
        session.purchaseId,
        purchaseItemId,
        pickedQty,
      )
      const item = result.resolution.item
      const purchaseItem = result.resolution.purchaseItem
      if (result.ok && result.line && purchaseItem && item) {
        const line = result.line
        const hero = addedHero(
          item.name,
          item.code,
          pickedQty,
          line,
          Number(purchaseItem.qty ?? 0),
          Number(purchaseItem.receivedQty ?? 0),
        )
        // Undo lowers the flag again only when THIS addition is what raised it.
        lastScanRef.current = {
          lineId: line.lineId,
          addedQty: pickedQty,
          clearPickedOnUndo: !pickedBefore,
        }
        setHeroState(hero)
        playFeedback(hero.kind === 'OVER' ? 'over' : 'success')
      } else {
        lastScanRef.current = null
        toast('danger', result.message)
        playFeedback('danger')
      }
    } catch (error) {
      lastScanRef.current = null
      toast('danger', error instanceof Error ? error.message : 'Gagal menyimpan item.')
      playFeedback('danger')
    } finally {
      scanRef.current?.focus()
    }
  }

  /**
   * "Tambahkan ke sesi" in the picker.
   *
   * It goes through the SAME serial queue as `handleAdd`, so a pick cannot interleave with a burst
   * the scanner already fired — `addOrIncrementLine` is transactional either way, but the card and
   * `lastScanRef` would otherwise be able to describe a different addition than the last one.
   *
   * It deliberately carries NO state of its own into the queue — not even whether the line was
   * already flagged as manual. `processPick` reads that from the database at the moment it writes;
   * see the comment there for why a snapshot taken at tap time is the wrong source.
   */
  const handlePick = (purchaseItemId: string, pickedQty: number) => {
    setPickerOpen(false)
    scanQueueRef.current = scanQueueRef.current
      .then(() => processPick(purchaseItemId, pickedQty))
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
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        role={editable ? 'tabpanel' : undefined}
        id={editable ? 'session-tab-panel' : undefined}
        aria-labelledby={editable ? `session-tab-${tab}` : undefined}
      >
        {/* The sentence deliberately says nothing about SENDING. Sending is a device-level action
            by design — pressing Kirim pushes the whole outbox, a colleague's finalized documents
            included — so "only the owner can send" would be false, and on a PENDING document it
            would sit directly above the notice below that says the opposite. */}
        {isOwner ? null : (
          <div className="mb-2">
            <Notice tone="warn">
              Dokumen milik {ownerName(session)} — hanya bisa dilihat.
              {session.status === SESSION_STATUS.RUNNING
                ? ' Scan dan penyelesaian dokumen ini hanya bisa dilakukan oleh pemiliknya.'
                : ' Dokumen ini sudah difinalisasi, jadi tidak bisa diubah oleh siapa pun.'}
            </Notice>
          </div>
        )}

        {editable && tab === 'scan' ? (
          <ScanHero
            state={heroState}
            onUndo={() => void handleUndo()}
            onDismiss={dismissHero}
            onOpenPurchase={(purchaseId) => void openPurchase(purchaseId)}
            // Only the NOT_FOUND card uses this — see the prop's own comment in scan-hero.tsx.
            onPickFromPo={manualPickEnabled ? () => setPickerOpen(true) : undefined}
          />
        ) : null}

        {!editable || tab === 'items' ? (
          /* The provider wraps only this card, not the whole scroller: the scroller's children run
             for a couple of hundred lines of JSX, and a wrapper around all of them would be an edit
             on two far-apart places for no gain. A provider only has to be an ANCESTOR of the
             list. */
          <ScrollContainerProvider value={scrollRef}>
            <Card title={`Item dalam sesi (${lines.length})`}>
              {editable ? (
                <p className="mb-1 text-sm text-fg-subtle">Ketuk item untuk mengubah qty atau menghapus.</p>
              ) : null}
              {/* The empty state moved out of the list: it used to be a <p> directly inside <ul>,
                  which is invalid markup, and VirtualList owns the <ul> now. */}
              {lines.length === 0 ? (
                <EmptyState>Belum ada item. Scan barcode untuk menambah.</EmptyState>
              ) : (
                /* Windowed: the server accepts up to 5000 lines in one session
                   (MAX_SESSION_LINES), and a scan session that long is exactly the one running on
                   the weakest device at the end of a shift.

                   Height is computed from the row's own data, never measured — the code line grows
                   to two lines when the conversion factor was not found, and the "Dipesan" line
                   exists only when the PO line could be resolved. Both of those inputs live in
                   `lineRows` rather than in a closure, because that array's identity is what
                   invalidates the measurements. See components/row-heights.ts. */
                <VirtualList
                  as="ul"
                  rows={lineRows}
                  label="Item dalam sesi"
                  getKey={(row) => row.line.lineId}
                  rowHeight={(row) =>
                    sessionLineRowHeight({
                      convFound: row.line.convFound,
                      hasOrderedLine: row.hasOrderedLine,
                    })
                  }
                  rowClassName="border-b border-line-soft"
                  renderRow={({ line }) => {
                    const purchaseItem = purchaseItemMap.get(line.purchaseItemId)
                    const item = items[line.itemMasterId]
                    const isOver = overLineIds.has(line.lineId)
                    return (
                      <button
                        type="button"
                        className="touch-target h-full w-full overflow-hidden py-3 text-left"
                        disabled={!editable}
                        onClick={() => setEditingLineId(line.lineId)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="line-clamp-2 font-semibold leading-6 text-fg">
                              {item?.name ?? line.itemMasterId}
                            </p>
                            {/* The clamp follows the height branch exactly: a second line is only
                                BUDGETED when the conversion note is appended, so allowing one
                                anywhere else would let it be cut in half by `overflow-hidden`.
                                `truncate` is also the better failure here — an ellipsis says the
                                text continues, half a second line just looks broken. */}
                            <p
                              className={`${line.convFound ? 'truncate' : 'line-clamp-2'} text-sm leading-5 text-fg-subtle`}
                            >
                              {item?.code ?? '-'} • {formatQty(line.qty)}{' '}
                              {unitMap.get(line.uomPurchaseId) ?? line.uomPurchaseId}
                              {line.convFound ? '' : ' • konversi tidak ditemukan (faktor 1)'}
                            </p>
                            <p className="truncate text-sm leading-5 tabular-nums text-fg-subtle">
                              = {formatQty(line.qty * line.convQty)} {unitMap.get(line.uomId) ?? line.uomId}
                            </p>
                            {purchaseItem ? (
                              <p className="truncate text-sm leading-5 tabular-nums text-fg-muted">
                                Dipesan {formatQty(purchaseItem.qty)} {unitMap.get(purchaseItem.uomId) ?? ''}
                              </p>
                            ) : null}
                          </div>
                          {/* Stacked, not side by side: a line can be both over-received and partly
                              manual, and at 360px two badges in a row push the item name into a
                              third line of wrapping. */}
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {isOver ? <Badge tone="danger">Over-receive</Badge> : null}
                            {line.pickedManually ? <Badge tone="neutral">Manual</Badge> : null}
                          </div>
                        </div>
                      </button>
                    )
                  }}
                />
              )}
            </Card>
          </ScrollContainerProvider>
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

        {/* Read-only only: on a RUNNING session these numbers are edited on the review screen.
            The condition is the STATUS, not `editable`: now that `editable` also means "mine", a
            colleague's RUNNING session would render this card with two empty disabled fields,
            which reads as "the vendor's paperwork has no numbers" rather than "they have not
            typed them in yet". */}
        {session.status !== SESSION_STATUS.RUNNING ? (
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
                {/* Gated on OWNERSHIP, not on `editable`. `editable` is false for every rejected
                    session — that is what this whole block hangs off — so without this check the
                    delete button also rendered on a colleague's document: a second write path
                    around the ownership rule, and the only one that destroys data, since
                    `deleteSession` removes the session together with every scanned line. */}
                {isOwner ? (
                  <ConfirmButton
                    tone="danger"
                    className="w-full"
                    label="Hapus sesi dari perangkat"
                    confirmLabel="Tahan terus… sesi akan dihapus"
                    onConfirm={() => void handleCancel()}
                  />
                ) : (
                  <p className="text-sm text-fg-subtle">
                    Hanya {ownerName(session)} yang bisa menghapus dokumen ini dari perangkat.
                  </p>
                )}
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
                // `undefined` when the operator turned the feature off in Pengaturan: that is the
                // whole switch, and ScanBar then renders exactly the old disabled "+".
                onOpenPicker={manualPickEnabled ? () => setPickerOpen(true) : undefined}
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

      {/* Rendered last and positioned `fixed`, so it covers the scan bar and the tab bar instead of
          being clipped by them. Gated on `editable`, so a colleague's document and a finalised one
          have no way in — the same gate every other control that writes to the session uses. */}
      {editable && pickerOpen ? (
        <ItemPicker
          purchaseLabel={session.purchaseNumber ?? session.purchaseId}
          items={pickerItems}
          onPick={handlePick}
          onClose={() => setPickerOpen(false)}
        />
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

