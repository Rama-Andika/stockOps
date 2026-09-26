import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-cyan-500 text-slate-900 hover:bg-cyan-400 disabled:bg-cyan-900',
  secondary: 'bg-slate-700 text-slate-100 hover:bg-slate-600 disabled:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-900',
  ghost: 'bg-transparent text-slate-200 hover:bg-slate-800',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`touch-target rounded-lg px-5 py-3 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  )
}

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-slate-700 bg-slate-900/60 p-4 ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-lg font-bold text-slate-100">{title}</h2> : <span />}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger'

const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-slate-700 text-slate-100',
  info: 'bg-sky-800 text-sky-100',
  success: 'bg-emerald-800 text-emerald-100',
  warn: 'bg-amber-700 text-amber-50',
  danger: 'bg-red-800 text-red-100',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${TONE_STYLES[tone]}`}>
      {children}
    </span>
  )
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`rounded-lg px-4 py-3 text-base ${TONE_STYLES[tone]}`} role="status">
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-300">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  )
}

export const inputClass =
  'touch-target w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500'

export function Progress({ value, max }: { value: number; max: number }) {
  const safeMax = max > 0 ? max : 1
  const percent = Math.min(100, Math.round((value / safeMax) * 100))
  const over = value > max
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className={`h-full ${over ? 'bg-red-500' : 'bg-cyan-400'}`}
        style={{ width: `${over ? 100 : percent}%` }}
      />
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-slate-400">{children}</p>
}

export function Loading({ label = 'Memuat…' }: { label?: string }) {
  return <p className="py-8 text-center text-slate-300">{label}</p>
}
