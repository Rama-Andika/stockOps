import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ScrollContainerProvider } from '~/components/scroll-container'

/**
 * Fake layout for jsdom, so a test can exercise VirtualList's VIRTUAL path.
 *
 * jsdom performs no layout: every getBoundingClientRect is zeroes and every clientHeight is 0, so
 * a virtualizer sees a viewport of zero height and renders almost nothing. That is also why the
 * plain path exists and why every OTHER component test can stay exactly as it is — their fixtures
 * are far below the threshold.
 *
 * Deliberately separate from the ResizeObserver stub in tests/setup.ts: that one stops tests from
 * crashing, this one makes a test actually virtualize. Do not move them together.
 */
export const FAKE_VIEWPORT_HEIGHT = 640
export const FAKE_VIEWPORT_WIDTH = 360

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: FAKE_VIEWPORT_WIDTH,
    width: FAKE_VIEWPORT_WIDTH,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/**
 * Gives `scroller` a 360x640 viewport and `contentHeight` of scrollable content.
 *
 * Six properties, and each has a different reader — faking fewer leaves the virtualizer with a
 * zero-height viewport, which renders NO rows and reads exactly like a broken component:
 *
 * - `offsetWidth` / `offsetHeight`: what @tanstack/virtual-core measures the scroll element with.
 *   Its getRect is literally `const { offsetWidth, offsetHeight } = element`, so these two decide
 *   how big the window is. jsdom returns 0 for both.
 * - `clientHeight` / `scrollHeight`: read by VirtualList's scroll-position restore, which refuses
 *   to apply an offset the content cannot hold.
 * - `clientWidth` and the faked rect: VirtualList measures scrollMargin as the list's rect top
 *   minus the scroller's. The list element keeps jsdom's all-zero rect, which is exactly right —
 *   it puts the list at the top of the scrollable content, so scrollMargin measures 0.
 */
export function fakeScrollerLayout(scroller: HTMLElement, contentHeight: number): void {
  Object.defineProperty(scroller, 'offsetHeight', {
    configurable: true,
    value: FAKE_VIEWPORT_HEIGHT,
  })
  Object.defineProperty(scroller, 'offsetWidth', {
    configurable: true,
    value: FAKE_VIEWPORT_WIDTH,
  })
  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    value: FAKE_VIEWPORT_HEIGHT,
  })
  Object.defineProperty(scroller, 'clientWidth', {
    configurable: true,
    value: FAKE_VIEWPORT_WIDTH,
  })
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    value: contentHeight,
  })
  scroller.getBoundingClientRect = () => rect(0, FAKE_VIEWPORT_HEIGHT)
}

/**
 * A scroller with faked layout, standing in for AppShell's <main>. Reachable as
 * `screen.getByTestId('scroller')`.
 *
 * The layout is faked in a layout effect, not in the ref callback: an inline ref callback is a new
 * function on every render, so React would detach and reattach the ref each time. As the PARENT,
 * this layout effect runs after its children's layout effects but before their passive effects —
 * which is exactly when VirtualList looks the scroller up.
 */
export function ScrollHarness({
  contentHeight,
  children,
}: {
  contentHeight: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (ref.current) fakeScrollerLayout(ref.current, contentHeight)
  }, [contentHeight])
  return (
    <div ref={ref} data-testid="scroller">
      <ScrollContainerProvider value={ref}>{children}</ScrollContainerProvider>
    </div>
  )
}
