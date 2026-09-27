const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const

function keyClass(wide: boolean): string {
  return `touch-target select-none rounded-lg border border-slate-600 bg-slate-800 text-xl font-bold text-slate-100 transition active:bg-slate-600 ${
    wide ? 'col-span-3' : ''
  }`
}

/** Keypad numerik on-screen untuk input qty satuan PO. */
export function NumericPad({
  value,
  onChange,
  showIncrement = true,
}: {
  value: string
  onChange: (next: string) => void
  showIncrement?: boolean
}) {
  const press = (key: string) => {
    if (key === '⌫') {
      onChange(value.slice(0, -1))
      return
    }
    if (key === '.' && value.includes('.')) return
    onChange(value + key)
  }

  const increment = () => {
    const current = Number(value)
    const base = Number.isFinite(current) ? current : 0
    onChange(String(base + 1))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={key === '⌫' ? 'Hapus digit terakhir' : key}
            className={keyClass(false)}
            onClick={() => press(key)}
          >
            {key}
          </button>
        ))}
      </div>
      {showIncrement ? (
        <button type="button" className={keyClass(true)} onClick={increment}>
          +1 (satuan PO)
        </button>
      ) : null}
    </div>
  )
}
