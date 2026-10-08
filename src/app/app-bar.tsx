import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

/** Shared by both back controls so the <Link> and the <button> cannot drift apart. */
const BACK_CONTROL_CLASS =
  'touch-target flex w-14 shrink-0 items-center justify-center rounded-lg text-fg-soft transition hover:bg-raised'

/**
 * Exactly one back control, enforced by the type rather than by a comment asking nicely. With
 * both props optional, a screen that forgot to pass either still compiled and shipped an arrow
 * that looks live, carries an aria-label, takes focus — and does nothing. On a PDT without a
 * hardware back key that screen is a trap.
 */
type AppBarProps = {
  title: string
  backLabel: string
  actions?: ReactNode
} & (
  | {
      /** A static destination, rendered as a router <Link>. */
      backTo: '/pos' | '/sessions' | '/settings'
      onBack?: never
    }
  | {
      /**
       * For a back target the union above cannot express — a route that needs params, or a back
       * step that has to save something first.
       */
      onBack: () => void
      backTo?: never
    }
)

export function AppBar({ title, backTo, onBack, backLabel, actions }: AppBarProps) {
  return (
    <header className="mb-1 flex items-center gap-2 border-b border-line pb-1">
      {backTo ? (
        <Link to={backTo} aria-label={backLabel} className={BACK_CONTROL_CLASS}>
          <ArrowLeft className="h-6 w-6" aria-hidden="true" />
        </Link>
      ) : (
        <button
          type="button"
          aria-label={backLabel}
          className={BACK_CONTROL_CLASS}
          onClick={onBack}
        >
          <ArrowLeft className="h-6 w-6" aria-hidden="true" />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-fg">{title}</h1>
      {actions}
    </header>
  )
}
