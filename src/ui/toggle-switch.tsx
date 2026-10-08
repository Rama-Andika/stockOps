export function ToggleSwitch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`touch-target relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand ${
        checked ? 'border-brand bg-brand' : 'border-line-strong bg-control'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full shadow-sm transition duration-200 ${
          checked ? 'translate-x-6 bg-on-brand' : 'translate-x-0.5 bg-fg-muted'
        }`}
      />
    </button>
  )
}
