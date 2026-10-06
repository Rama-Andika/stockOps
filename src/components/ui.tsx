import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-bright',
  secondary: 'bg-control text-fg hover:bg-control-off',
  danger: 'bg-danger text-white hover:bg-danger-bright',
  ghost: 'bg-transparent text-fg-soft hover:bg-raised',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`touch-target rounded-lg px-5 py-3 font-semibold transition ${BUTTON_STYLES[variant]} disabled:cursor-not-allowed disabled:bg-control-off disabled:text-fg-soft ${className}`}
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
    <section className={`rounded-xl border border-line bg-surface/60 p-3 ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-lg font-bold text-fg">{title}</h2> : <span />}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger'

const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-control text-fg',
  info: 'bg-info-fill text-on-info-fill',
  success: 'bg-ok-fill text-on-ok-fill',
  warn: 'bg-warn text-on-warn',
  danger: 'bg-danger-fill text-on-danger-fill',
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
      <span className="mb-1 block text-sm font-semibold text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-fg-subtle">{hint}</span> : null}
    </label>
  )
}

/**
 * Shape only — deliberately no width and no border colour. Both used to live here and both
 * collided with what callers added on top (`w-full` beat `w-16`; `border-line-strong` beat the
 * red invalid border), and Tailwind resolves such ties by stylesheet order, not by className
 * order. Every caller states its own width and border colour.
 */
export const inputClass =
  'touch-target rounded-lg border bg-field px-4 py-3 text-fg placeholder:text-fg-subtle'


export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-fg-subtle">{children}</p>
}

export function Loading({ label = 'Memuat…' }: { label?: string }) {
  return <p className="py-8 text-center text-fg-muted">{label}</p>
}
