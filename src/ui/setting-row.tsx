import { ToggleSwitch } from '~/ui/toggle-switch'

export function SettingRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: React.ComponentType<{
    className?: string
    'aria-hidden'?: boolean | 'true' | 'false'
  }>
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onChange(!checked)
        }
      }}
      className="touch-target flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface/40 p-3 transition hover:border-line-hover hover:bg-surface/80"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-fg-muted">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-fg">{title}</p>
          <p className="text-xs text-fg-subtle leading-relaxed">{description}</p>
        </div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} label={title} />
    </div>
  )
}
