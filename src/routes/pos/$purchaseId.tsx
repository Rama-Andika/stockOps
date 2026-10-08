import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { localRepo } from '~/client/db/local-repo'
import { useAppStore } from '~/client/state/store/app-store'
import { useLive } from '~/client/hooks/use-live'
import { AppBar } from '~/components/app-bar'
import { DuplicateSessionSheet } from '~/components/duplicate-session-sheet'
import { PO_ITEM_ROW_HEIGHT } from '~/components/row-heights'
import { SegmentedProgress } from '~/components/segmented-progress'
import { Badge, Button, Card, EmptyState, Loading, Notice } from '~/components/ui'
import { VirtualList } from '~/components/virtual-list'
import { PROGRESS_LABEL, type ProgressStatus } from '~/shared/constants'
import { formatDate } from '~/shared/format'
import { findRunningSessionForPurchase, isOwnedBy, ownerName } from '~/shared/session-owner'

export const Route = createFileRoute('/pos/$purchaseId')({
  component: PosDetailPage,
})

function toneFor(progress: ProgressStatus): 'neutral' | 'info' | 'success' | 'danger' {
  if (progress === 'FULL') return 'success'
  if (progress === 'OVER') return 'danger'
  if (progress === 'PARTIAL') return 'info'
  return 'neutral'
}

function PosDetailPage() {
  const { purchaseId } = Route.useParams()
  const user = useAppStore((state) => state.user)
  const deviceId = useAppStore((state) => state.deviceId)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  /**
   * The duplicate the operator still has to answer for, or `null` while no sheet is open. Only the
   * three things the sheet shows are kept here, not the whole session row: nothing in an open sheet
   * can then quietly disagree with the row it came from.
   */
  const [duplicate, setDuplicate] = useState<{
    sessionId: string
    createdAt: string | null
    lineCount: number
  } | null>(null)

  const detail = useLive(() => localRepo.getPurchaseDetail(purchaseId), [purchaseId], undefined)
  const unitRows = useLive(() => localRepo.db.units.toArray(), [], [])
  // Device-wide here, filtered to this PO further down. Called next to the other live queries
  // because the two early returns below must not sit between a hook and its siblings.
  const runningSessions = useLive(() => localRepo.runningSessions(), [], [])
  const unitMap = useMemo(() => new Map(unitRows.map((row) => [row.uomId, row.unit])), [unitRows])

  if (!detail) return <Loading label="Memuat detail PO…" />
  if (!detail.purchase) {
    return (
      <Card title="PO tidak ditemukan">
        <EmptyState>PO ini tidak ada di data lokal. Unduh ulang data saat online.</EmptyState>
      </Card>
    )
  }

  const allItemsFull =
    detail.items.length > 0 &&
    detail.items.every(
      (row) =>
        Number.isFinite(row.totalReceivedQty) &&
        Number.isFinite(row.orderedQty) &&
        row.totalReceivedQty >= row.orderedQty,
    )

  // Other operators' RUNNING sessions for THIS PO. Their scanned qty is already inside
  // `localPendingQty` — `getPurchaseDetail` counts every session that is neither SYNCED nor
  // REJECTED — so it moves the meters above and can even make `allItemsFull` true while nothing
  // has reached the server. Naming the owner turns that into something the operator can act on
  // instead of a number that does not match the paperwork in their hand.
  const foreignRunning = runningSessions.filter(
    (row) => row.purchaseId === purchaseId && !isOwnedBy(row, user?.userId ?? null),
  )
  let foreignOwnerLabel: string | null = null
  const firstForeign = foreignRunning[0]
  if (firstForeign) {
    const extra = foreignRunning.length - 1
    // "(+N sesi lain)", not "+N operator lain": several of them can belong to one operator.
    foreignOwnerLabel =
      extra > 0 ? `${ownerName(firstForeign)} (+${extra} sesi lain)` : ownerName(firstForeign)
  }

  /**
   * Creates the session and opens the cockpit. Shared by the plain path and by the sheet's "Buat
   * dokumen baru", and it deliberately does two things LESS than its callers: it does not touch
   * `busy` (every caller already holds it) and it does not re-run the duplicate check — the sheet
   * IS that check, and re-running it there would reopen the sheet the operator just answered.
   */
  const createAndOpen = async () => {
    if (!user) return
    const device = deviceId ?? (await localRepo.ensureDeviceId())
    const session = await localRepo.createSession({
      purchaseId,
      userId: user.userId,
      // Denormalized once, never refreshed: the document should name the operator as they were
      // when the goods were received, and the credential this comes from can be revoked by the
      // admin and deleted from the device (`removeCredentialsForUsers`).
      userFullName: user.fullName,
      userLoginId: user.loginId,
      deviceId: device,
    })
    void navigate({ to: '/sessions/$sessionId', params: { sessionId: session.sessionId } })
  }

  /**
   * "Mulai Penerimaan" — dedupe sesi per PO.
   *
   * The running sessions are read from Dexie again here instead of reusing the `runningSessions`
   * live query above: `useLive` can be a tick behind the database, and `busy` is the only other
   * thing standing between a double tap and two documents for one delivery.
   *
   * A colleague's running session for this PO is NOT a duplicate —
   * `findRunningSessionForPurchase` filters by owner. Receiving the same PO yourself is allowed,
   * the warning that names them is already on this screen, and a second message about it here
   * would read as a contradiction of the first.
   */
  const startReception = async () => {
    if (!user) return
    setBusy(true)
    try {
      const existing = findRunningSessionForPurchase(
        await localRepo.runningSessions(),
        purchaseId,
        user.userId,
      )
      if (!existing) {
        await createAndOpen()
        return
      }
      // Counted through the `sessionId` index rather than loading the rows: the sheet only needs
      // the number, and `localRepo.db` is already read directly on this screen (`db.units`).
      const lineCount = await localRepo.db.sessionItems
        .where('sessionId')
        .equals(existing.sessionId)
        .count()
      setDuplicate({
        sessionId: existing.sessionId,
        createdAt: existing.createdAt,
        lineCount,
      })
    } finally {
      setBusy(false)
    }
  }

  /** "Lanjutkan sesi berjalan" on the sheet. */
  const continueExisting = (sessionId: string) => {
    setDuplicate(null)
    void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
  }

  /**
   * "Buat dokumen baru" on the sheet — the escape hatch for a genuine second delivery. The sheet is
   * closed FIRST: `createAndOpen` navigates away, and leaving the panel mounted through that
   * navigation keeps the scrim over the next screen for a frame on a slow PDT.
   */
  const createDespiteDuplicate = async () => {
    setDuplicate(null)
    setBusy(true)
    try {
      await createAndOpen()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <AppBar
        title={detail.purchase.number ?? purchaseId}
        backTo="/pos"
        backLabel="Kembali ke daftar PO"
        actions={<Badge tone={toneFor(detail.progress.progress)}>{PROGRESS_LABEL[detail.progress.progress]}</Badge>}
      />
      <Card title={detail.purchase.vendorName}>
        <p className="text-sm text-fg-subtle">Tanggal PO: {formatDate(detail.purchase.purchDate)}</p>
        <div className="mt-3">
          <SegmentedProgress
            ordered={detail.progress.orderedTotal}
            serverReceived={detail.progress.serverReceivedTotal}
            localPending={detail.progress.localPendingTotal}
          />
        </div>
        <p className="mt-2 text-xs text-fg-subtle">
          Angka ini dihitung di perangkat. Jumlah resmi mengikuti server setelah dokumen terkirim.
        </p>
      </Card>

      <Card title="Item PO">
        {/* The empty state moved OUT of the list: it used to be a <p> directly inside <ul>, which
            is invalid markup, and VirtualList owns the <ul> now. */}
        {detail.items.length === 0 ? (
          <EmptyState>Tidak ada item pada PO ini.</EmptyState>
        ) : (
          /* Windowed: a PO may carry a thousand lines. This list sits in the MIDDLE of the page —
             the progress card above it, a Notice and a sticky action bar below — so the scroller is
             still the shell's <main> and VirtualList measures how far down the page the list starts
             (scrollMargin). It re-measures on every render, which matters here: the "operator lain
             sedang menerima PO ini" Notice appears and disappears above this card.

             Two lines are RESERVED for the item name (`line-clamp-2`): that name is what the
             operator matches against the box in their hands, so the row's computed height pays for
             two lines whether or not they are used. The progress meter lives in a fixed `h-9` box
             because its number line ("18 dari 40 · 5 belum terkirim · +3 lebih") can wrap at 360px,
             and a wrapping line is the one source of height that cannot be computed from data. */
          <VirtualList
            as="ul"
            rows={detail.items}
            label="Item PO"
            getKey={(row) => row.purchaseItemId}
            rowHeight={() => PO_ITEM_ROW_HEIGHT}
            rowClassName="border-b border-line-soft"
            renderRow={(row) => (
              <div className="flex h-full flex-col gap-1 overflow-hidden py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-semibold leading-6 text-fg">
                      {row.item?.name ?? row.itemMasterId}
                    </p>
                    <p className="truncate text-sm leading-5 text-fg-subtle">
                      {row.item?.code ?? '-'} • {unitMap.get(row.uomId) ?? row.uomId}
                    </p>
                  </div>
                  <Badge tone={toneFor(row.progress)}>{PROGRESS_LABEL[row.progress]}</Badge>
                </div>
                <div className="h-9 overflow-hidden">
                  <SegmentedProgress
                    ordered={row.orderedQty}
                    serverReceived={row.serverReceivedQty}
                    localPending={row.localPendingQty}
                    unit={unitMap.get(row.uomId) ?? ''}
                  />
                </div>
              </div>
            )}
          />
        )}
      </Card>

      {foreignOwnerLabel ? (
        <div className="mb-2">
          <Notice tone="warn">
            {foreignOwnerLabel} sedang menerima PO ini di perangkat ini dan sesinya belum dikirim.
            Qty-nya sudah ikut dihitung pada angka di atas. Kamu masih boleh memulai penerimaan
            sendiri — pastikan tidak menghitung barang yang sama dua kali.
          </Notice>
        </div>
      ) : null}

      {allItemsFull ? (
        <Notice tone="warn">
          Semua item sudah diterima penuh — tidak bisa memulai penerimaan baru.
          {foreignOwnerLabel
            ? ` Angka itu termasuk sesi berjalan milik ${foreignOwnerLabel} yang belum dikirim, jadi belum tentu sudah masuk sistem.`
            : ''}
        </Notice>
      ) : (
        <Notice tone="info">Sesi bisa dijeda dan dilanjutkan kapan saja.</Notice>
      )}

      {/* The primary action stays reachable on a PO with twenty lines: it sticks to the bottom of
          the scroll container instead of sitting at the end of the list. */}
      <div className="sticky bottom-0 -mx-3 border-t border-line bg-chrome/95 px-3 py-2 backdrop-blur">
        {/* `duplicate !== null` too: `busy` is released the moment the sheet opens, and leaving the
            primary action live behind the scrim means it is guarded by pixels, not by focus. */}
        <Button
          className="w-full"
          disabled={busy || allItemsFull || duplicate !== null}
          onClick={() => void startReception()}
        >
          {busy ? 'Menyiapkan…' : allItemsFull ? 'Semua item sudah diterima penuh' : 'Mulai Penerimaan'}
        </Button>
      </div>

      {/* Last in the tree and positioned `fixed`, so it covers the sticky action bar above instead
          of being clipped by it. */}
      {duplicate ? (
        <DuplicateSessionSheet
          purchaseLabel={detail.purchase.number ?? purchaseId}
          createdAt={duplicate.createdAt}
          lineCount={duplicate.lineCount}
          onContinue={() => continueExisting(duplicate.sessionId)}
          onCreateNew={() => void createDespiteDuplicate()}
          onClose={() => setDuplicate(null)}
        />
      ) : null}
    </div>
  )
}
