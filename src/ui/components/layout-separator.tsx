import { useRef, type CSSProperties } from 'react'

interface LayoutSeparatorProps {
  label: string
  orientation: 'vertical' | 'horizontal'
  value: number
  minimum: number
  maximum: number
  ready: boolean
  style?: CSSProperties
  getExtent: () => number
  direction?: number
  onChange: (value: number) => void
  onCommit: () => void
}

export function LayoutSeparator({ label, orientation, value, minimum, maximum, ready, style, getExtent, direction = 1, onChange, onCommit }: LayoutSeparatorProps) {
  const drag = useRef<{ position: number; value: number; extent: number } | null>(null)
  const vertical = orientation === 'vertical'
  function change(next: number) { onChange(Math.max(minimum, Math.min(maximum, next))) }
  return <div
    role="separator" aria-label={label} aria-orientation={orientation}
    aria-valuemin={minimum * 100} aria-valuemax={maximum * 100} aria-valuenow={value * 100}
    aria-disabled={!ready} tabIndex={ready ? 0 : -1}
    style={{ background: 'var(--color-border)', cursor: vertical ? 'col-resize' : 'row-resize', touchAction: 'none', ...style }}
    onPointerDown={(event) => {
      if (!ready || event.button !== 0) return
      event.preventDefault()
      const extent = getExtent()
      if (extent <= 0) return
      drag.current = { position: vertical ? event.clientX : event.clientY, value, extent }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (!drag.current) return
      const position = vertical ? event.clientX : event.clientY
      change(drag.current.value + direction * (position - drag.current.position) / drag.current.extent)
    }}
    onPointerUp={() => { if (drag.current) { drag.current = null; onCommit() } }}
    onPointerCancel={() => { if (drag.current) { drag.current = null; onCommit() } }}
    onKeyDown={(event) => {
      if (!ready) return
      const decrease = vertical ? 'ArrowLeft' : 'ArrowUp'
      const increase = vertical ? 'ArrowRight' : 'ArrowDown'
      if (event.key !== decrease && event.key !== increase) return
      event.preventDefault()
      event.stopPropagation()
      change(value + direction * (event.key === increase ? 0.01 : -0.01))
      onCommit()
    }}
  />
}
