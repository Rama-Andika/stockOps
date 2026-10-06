import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'

interface ConfirmButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> {
  label: string
  confirmLabel: string
  durationMs?: number
  onConfirm: () => void
  tone?: 'default' | 'danger'
}

/** Action is only triggered after button is held for the full confirmation duration. */
export function ConfirmButton({
  label,
  confirmLabel,
  durationMs = 1500,
  onConfirm,
  tone = 'default',
  className = '',
  ...props
}: ConfirmButtonProps) {
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [keyboardArmed, setKeyboardArmed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const keyboardArmTimerRef = useRef<number | null>(null)
  const holdingRef = useRef(false)
  const elapsedRef = useRef(0)
  const sourceRef = useRef<'pointer' | 'keyboard' | null>(null)
  const confirmedDuringHoldRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const stop = () => {
    clearTimer()
    holdingRef.current = false
    sourceRef.current = null
    elapsedRef.current = 0
    setHolding(false)
    setProgress(0)
  }

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      if (keyboardArmTimerRef.current !== null) window.clearTimeout(keyboardArmTimerRef.current)
    },
    [],
  )

  const start = (source: 'pointer' | 'keyboard') => {
    if (props.disabled || holdingRef.current) return
    holdingRef.current = true
    sourceRef.current = source
    setHolding(true)
    setProgress(0)
    elapsedRef.current = 0
    timerRef.current = window.setInterval(() => {
      elapsedRef.current += 1
      const pct = Math.min(100, ((elapsedRef.current * 30) / durationMs) * 100)
      if (pct >= 100) {
        clearTimer()
        holdingRef.current = false
        elapsedRef.current = 0
        setHolding(false)
        setProgress(0)
        if (keyboardArmTimerRef.current !== null) window.clearTimeout(keyboardArmTimerRef.current)
        keyboardArmTimerRef.current = null
        setKeyboardArmed(false)
        confirmedDuringHoldRef.current = sourceRef.current === 'keyboard'
        sourceRef.current = null
        onConfirm()
      } else {
        setProgress(pct)
      }
    }, 30)
  }

  const base =
    tone === 'danger'
      ? 'bg-danger text-white hover:bg-danger-bright'
      : 'bg-control text-fg hover:bg-control-off'

  return (
    <button
      type="button"
      {...props}
      className={`relative touch-target touch-none select-none overflow-hidden rounded-lg px-5 py-3 font-semibold transition ${base} disabled:cursor-not-allowed disabled:bg-control-off disabled:text-fg-soft ${className}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        start('pointer')
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.repeat) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          start('keyboard')
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') stop()
      }}
      onClick={(event) => {
        // Screen readers often activate buttons with a click that has no pointer event.
        // Require a second activation instead of bypassing the destructive hold guard.
        if (event.detail !== 0) return
        if (confirmedDuringHoldRef.current) {
          confirmedDuringHoldRef.current = false
          return
        }
        if (keyboardArmed) {
          if (keyboardArmTimerRef.current !== null) window.clearTimeout(keyboardArmTimerRef.current)
          keyboardArmTimerRef.current = null
          setKeyboardArmed(false)
          onConfirm()
          return
        }
        setKeyboardArmed(true)
        keyboardArmTimerRef.current = window.setTimeout(() => {
          keyboardArmTimerRef.current = null
          setKeyboardArmed(false)
        }, 5000)
      }}
      aria-label={keyboardArmed ? `Tekan lagi untuk mengonfirmasi: ${label}` : label}
      aria-pressed={keyboardArmed}
    >
      {holding ? (
        <span
          className="absolute inset-y-0 left-0 bg-white/20"
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      ) : null}
      <span className="relative">
        {holding ? confirmLabel : keyboardArmed ? 'Tekan lagi untuk mengonfirmasi' : label}
      </span>
    </button>
  )
}
