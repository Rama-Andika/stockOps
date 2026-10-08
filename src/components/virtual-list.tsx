import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useScrollContainer } from './scroll-container'

/**
 * Windowed list: only the rows on screen are in the DOM.
 *
 * Why it exists: `pull` may bring 2000 POs and a PO may carry 1000 lines, one session may hold
 * 5000 lines (MAX_SESSION_LINES) and the diagnostics ring buffer holds 2000 entries. Rendering all
 * of them is a hang on a low-end PDT, and a hang reads as a broken app rather than as a long list.
 *
 * ONE component for all six lists on purpose: the threshold, the scroller lookup, the scrollMargin
 * measurement, the scroll-position memory and the a11y attributes all live here, so they cannot
 * drift apart between screens. Callers bring only their row markup (`renderRow`) and their row
 * height (`rowHeight`, from row-heights.ts).
 *
 * TWO render paths, ONE appearance. Below `threshold` rows, or with no scroller at all, every row
 * is rendered plainly; above it, a window is rendered. Both paths call the SAME `renderRow` and
 * force the SAME `rowHeight`, so row 61 must not look different from row 60. The plain path is
 * also what keeps the existing component tests meaningful: their fixtures are 2–5 rows.
 *
 * Nothing here measures a row. See row-heights.ts for why, and for what that costs.
 */
export const VIRTUAL_THRESHOLD = 60

/** Rows rendered beyond each edge of the viewport. Kept small: a PDT CPU pays for every one. */
const OVERSCAN = 4

/** Scroll offsets remembered per `restoreKey`. */
const SCROLL_MEMORY_MAX = 30
const scrollMemory = new Map<string, number>()

/**
 * `useLayoutEffect` warns when React renders outside a browser, and this app prerenders its SPA
 * shell in Node. There is nothing to measure there anyway.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function rememberOffset(key: string, offset: number): void {
  // Delete first, then set: a Map keeps insertion order, so this also refreshes the key's age.
  scrollMemory.delete(key)
  if (offset > 0) scrollMemory.set(key, offset)
  // A restore key carries the active filter, so typing in a search field mints a new key on every
  // keystroke. Without this bound the map would grow for a whole shift.
  while (scrollMemory.size > SCROLL_MEMORY_MAX) {
    const oldest = scrollMemory.keys().next()
    if (oldest.done) break
    scrollMemory.delete(oldest.value)
  }
}

/** Test seam: the memory is module state and would otherwise leak between cases. */
export function clearScrollMemory(): void {
  scrollMemory.clear()
}

export interface VirtualListProps<T> {
  rows: readonly T[]
  /** Stable identity per row. Used as the React key on both paths. */
  getKey: (row: T) => string
  /** Height in CSS pixels, computed from the row's data — never measured. */
  rowHeight: (row: T, index: number) => number
  renderRow: (row: T, index: number) => ReactNode
  /** 'ul' renders <li> rows, 'div' renders <div> rows with explicit list roles. */
  as?: 'ul' | 'div'
  className?: string
  /** Classes for the row wrapper itself — this is where a separator or a bottom gap belongs. */
  rowClassName?: string
  /**
   * Remembers the scroll offset under this key and restores it when the same key comes back.
   * The CALLER builds the key and must fold the active filter/search into it, so that narrowing a
   * list starts at the top instead of leaving the scroller parked past the end of the new results.
   */
  restoreKey?: string
  /** Row to keep on screen, e.g. a keyboard highlight. */
  activeIndex?: number | null
  threshold?: number
  label?: string
}

export function VirtualList<T>({
  rows,
  getKey,
  rowHeight,
  renderRow,
  as = 'div',
  className = '',
  rowClassName = '',
  restoreKey,
  activeIndex = null,
  threshold = VIRTUAL_THRESHOLD,
  label,
}: VirtualListProps<T>) {
  const scrollRef = useScrollContainer()
  /**
   * State, not a ref, for two reasons: attaching the container has to cause one more render so the
   * measurement below runs against a real element, and a setState callback ref is the only way to
   * type ONE ref for both <ul> and <div> without a cast.
   */
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useEffect(() => {
    setScroller(scrollRef.current)
  }, [scrollRef])

  const virtualize = scroller !== null && rows.length >= threshold

  /**
   * `rowHeight` and `getKey` are read through refs so that the two callbacks below keep a STABLE
   * identity across renders that do not change `rows`.
   *
   * That stability is load-bearing, not tidiness. react-virtual calls `setOptions` from its render
   * body, and virtual-core memoises its measurements on `options.getItemKey` among other things —
   * so a getItemKey whose identity changes every render makes it rebuild EVERY row's measurement
   * on every render: at 2000 POs that is 2000 getKey plus 2000 estimateSize calls and two array
   * allocations, on renders where nothing about the data changed (a sync progress tick, an
   * online/offline toggle, a live-query re-emit). Callers pass inline arrows, which is ordinary
   * React and should stay cheap, so the stability is bought here once instead of becoming a rule
   * every call site has to remember.
   *
   * `[rows]` is deliberately the ONLY dependency. A new rows array is exactly when measurements
   * must be rebuilt, and it is the only signal available: virtual-core's own key is `count`, which
   * cannot see a list that changed its contents without changing its length.
   *
   * The refs are assigned during render on purpose — the virtualizer calls estimateSize while
   * rendering, so a ref updated from an effect would be one render behind.
   */
  const rowHeightRef = useRef(rowHeight)
  const getKeyRef = useRef(getKey)
  rowHeightRef.current = rowHeight
  getKeyRef.current = getKey

  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index]
      // `noUncheckedIndexedAccess` is on, and this really can be undefined for one render while a
      // filter shortens the list.
      return row ? rowHeightRef.current(row, index) : 0
    },
    [rows],
  )

  const getItemKey = useCallback(
    (index: number) => {
      const row = rows[index]
      return row ? getKeyRef.current(row) : index
    },
    [rows],
  )

  /**
   * Called unconditionally — hooks must be. `count: 0` is what keeps it inert on the plain path:
   * no measurements, and no ResizeObserver, because it only observes once it has a scroll element.
   */
  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scroller,
    estimateSize,
    getItemKey,
    overscan: OVERSCAN,
    scrollMargin,
  })

  /**
   * The virtualizer's identity changes on every render, so an effect that depended on it would run
   * on every render — and `scrollToIndex` on every render fights the operator's own scrolling.
   * This effect is declared BEFORE the one that reads the ref, because effects run in order.
   */
  const virtualizerRef = useRef(virtualizer)
  useIsomorphicLayoutEffect(() => {
    virtualizerRef.current = virtualizer
  })

  /**
   * How far this list sits below the top of the scrollable content.
   *
   * No dependency array on purpose. The distance changes whenever anything ABOVE the list changes
   * height — the "operator lain sedang menerima PO ini" notice on the PO detail screen, the
   * "Lanjutkan sesi berjalan" banner on /pos — and every one of those is React state, so every one
   * of them causes a render. setState only fires on a real change, so this converges instead of
   * looping.
   *
   * getBoundingClientRect, NOT offsetTop: offsetTop is relative to the offsetParent, which is not
   * necessarily the scroller.
   */
  useIsomorphicLayoutEffect(() => {
    if (!virtualize || !container || !scroller) return
    const next =
      container.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop
    setScrollMargin((previous) => (Math.abs(previous - next) < 1 ? previous : next))
  })

  const restoredKeyRef = useRef<string | null>(null)
  useIsomorphicLayoutEffect(() => {
    if (!restoreKey || !scroller) return
    if (restoredKeyRef.current === restoreKey) return
    const saved = scrollMemory.get(restoreKey) ?? 0
    // The list may not have reached its full height yet — the virtualizer needs one measured pass.
    // Leaving the flag unset means this runs again on the next render, when it has. An offset the
    // content can no longer hold (the PO list was replaced by a smaller one) is simply never
    // applied, so it can never point past the end.
    if (saved > scroller.scrollHeight - scroller.clientHeight) return
    restoredKeyRef.current = restoreKey
    scroller.scrollTop = saved
  })

  /**
   * A LAYOUT effect, not a passive one, and that is the whole point of it being here.
   *
   * React runs every changed effect's cleanup before it runs any of the new ones, within the same
   * phase. So when the key changes — the operator switched filter — this cleanup saves the offset
   * of the OLD key while the scroller is still where they left it, and only then does the restore
   * effect above move the scroller for the new key. As a passive effect it would run after that
   * move and store a 0, throwing away the position of the filter they just left.
   */
  useIsomorphicLayoutEffect(() => {
    if (!restoreKey) return
    const element = scroller
    return () => {
      if (element) rememberOffset(restoreKey, element.scrollTop)
    }
  }, [restoreKey, scroller])

  useIsomorphicLayoutEffect(() => {
    if (activeIndex === null || activeIndex < 0) return
    if (virtualize) {
      virtualizerRef.current.scrollToIndex(activeIndex, { align: 'auto' })
      return
    }
    const child = container?.children[activeIndex]
    // jsdom does not implement scrollIntoView, and this code runs in component tests.
    if (child instanceof HTMLElement && typeof child.scrollIntoView === 'function') {
      child.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, virtualize, container])

  const rowTag: 'li' | 'div' = as === 'ul' ? 'li' : 'div'
  const total = rows.length

  /**
   * `createElement` rather than JSX because the tag is a union. The row wrapper owns the row's
   * height and `overflow: hidden` on BOTH paths: that is what turns a computed height into a
   * guarantee instead of an estimate.
   *
   * aria-setsize carries the FULL count even when ten rows are in the DOM — without it a screen
   * reader announces "1 of 10" on a list of two thousand.
   */
  const children = virtualize
    ? virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]
        if (!row) return null
        return createElement(
          rowTag,
          {
            key: String(item.key),
            className: rowClassName || undefined,
            role: rowTag === 'div' ? 'listitem' : undefined,
            'aria-setsize': total,
            'aria-posinset': item.index + 1,
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: item.size,
              overflow: 'hidden',
              transform: `translateY(${item.start - scrollMargin}px)`,
            },
          },
          renderRow(row, item.index),
        )
      })
    : rows.map((row, index) =>
        createElement(
          rowTag,
          {
            key: getKey(row),
            className: rowClassName || undefined,
            role: rowTag === 'div' ? 'listitem' : undefined,
            'aria-setsize': total,
            'aria-posinset': index + 1,
            style: { height: rowHeight(row, index), overflow: 'hidden' },
          },
          renderRow(row, index),
        ),
      )

  /**
   * `relative` positions the absolute rows; `shrink-0` matters because this container is a flex
   * child on /pos, where a definite height would otherwise be a shrink candidate.
   */
  return createElement(
    as,
    {
      ref: setContainer,
      className: `relative shrink-0 ${className}`.trim(),
      role: as === 'div' ? 'list' : undefined,
      'aria-label': label,
      style: virtualize ? { height: virtualizer.getTotalSize() } : undefined,
    },
    children,
  )
}
