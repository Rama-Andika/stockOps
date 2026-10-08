import { createContext, useContext, type ReactNode, type RefObject } from 'react'

/**
 * "Which element scrolls the content I am inside of?"
 *
 * Virtualisation needs the scrolling element, and in this app that element is not always the same
 * one: /pos, /sessions, /diagnostics and /pos/$purchaseId scroll inside the shell's <main>, while
 * the scan cockpit and the item picker own their own scroller. Every consumer asks this context
 * instead of walking the DOM for an element with `overflow`, because then a CSS change could move
 * the scroller without anybody noticing.
 *
 * The value is a REF, not an element. AppShell renders <main> in the same pass as the route inside
 * it, so a context holding the element itself would be null on exactly the first render — the
 * render on which a virtualizer is created.
 *
 * The default is a module-level { current: null }, which means "no scroller here". That is not a
 * branch nobody reaches: component tests render route components directly, without AppShell (see
 * tests/component/pos-detail-dedupe.test.tsx), and VirtualList falls back to rendering every row
 * plainly when there is no scroller. Never write to this object.
 */
export type ScrollContainerRef = RefObject<HTMLElement | null>

const NO_SCROLL_CONTAINER: ScrollContainerRef = { current: null }

const ScrollContainerContext = createContext<ScrollContainerRef>(NO_SCROLL_CONTAINER)

export function ScrollContainerProvider({
  value,
  children,
}: {
  value: ScrollContainerRef
  children: ReactNode
}) {
  return <ScrollContainerContext.Provider value={value}>{children}</ScrollContainerContext.Provider>
}

export function useScrollContainer(): ScrollContainerRef {
  return useContext(ScrollContainerContext)
}
