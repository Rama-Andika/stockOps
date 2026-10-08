import type { KeyboardEvent } from 'react'

export type SessionTab = 'scan' | 'items'

const SESSION_TAB_IDS: readonly SessionTab[] = ['scan', 'items']

export function SessionTabs({
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
