import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

/**
 * Top bar for detail screens: back button + screen title + optional trailing slot.
 * `backTo` is typed as a union of real routes so the router's typed `to` keeps working.
 */
export function AppBar({
  title,
  backTo,
  backLabel,
  actions,
}: {
  title: string
  backTo: '/pos' | '/sessions'
  backLabel: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-1 flex items-center gap-2 border-b border-slate-700 pb-1">
      <Link
        to={backTo}
        aria-label={backLabel}
        className="touch-target flex w-12 shrink-0 items-center justify-center rounded-lg text-slate-200 transition hover:bg-slate-800"
      >
        <ArrowLeft className="h-6 w-6" aria-hidden="true" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-100">{title}</h1>
      {actions}
    </header>
  )
}
