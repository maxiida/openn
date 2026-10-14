import { Box, type SxProps, type Theme } from '@mui/material'
import { useLayoutEffect, useRef } from 'react'

interface Props<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** Give every option the same width, for a control that spans a fixed width. */
  equalWidth?: boolean
  sx?: SxProps<Theme>
}

/** A pill-shaped choice whose highlight slides to the selected option. */
export const MvpSegmented = <T extends string>({
  label,
  value,
  options,
  onChange,
  equalWidth = false,
  sx,
}: Props<T>) => {
  const optionsRef = useRef(new Map<T, HTMLButtonElement>())
  const containerRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)

  // Callers pass a fresh options array each render; only the labels decide the layout.
  const layoutKey = options.map((option) => option.label).join('\n')
  useLayoutEffect(() => {
    const thumb = thumbRef.current
    // Written straight to the element: the position is pure layout and needs no re-render.
    const measure = () => {
      const option = optionsRef.current.get(value)
      if (!thumb || !option) return
      thumb.style.left = `${option.offsetLeft}px`
      thumb.style.width = `${option.offsetWidth}px`
      thumb.style.opacity = '1'
    }
    measure()
    // The first placement must not slide in from the left edge.
    const frame = requestAnimationFrame(() => {
      if (thumb) thumb.dataset.ready = 'true'
    })
    // Labels change width with the language and once fonts finish loading.
    const observer = new ResizeObserver(measure)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [value, layoutKey])

  return (
    <Box
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      sx={[
        {
          position: 'relative',
          display: 'flex',
          p: '2px',
          borderRadius: 999,
          bgcolor: 'action.hover',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        ref={thumbRef}
        aria-hidden
        sx={{
          position: 'absolute',
          top: 2,
          bottom: 2,
          opacity: 0,
          borderRadius: 999,
          bgcolor: 'background.paper',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
          '&[data-ready="true"]': {
            transition:
              'left 260ms cubic-bezier(0.3, 0.7, 0.4, 1), width 260ms cubic-bezier(0.3, 0.7, 0.4, 1)',
          },
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none !important',
          },
        }}
      />
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Box
            key={option.value}
            ref={(node: HTMLButtonElement | null) => {
              if (node) optionsRef.current.set(option.value, node)
              else optionsRef.current.delete(option.value)
            }}
            component="button"
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => !selected && onChange(option.value)}
            sx={{
              position: 'relative',
              flex: equalWidth ? 1 : 'none',
              height: 28,
              px: 1.5,
              border: 0,
              borderRadius: 999,
              font: 'inherit',
              fontSize: 13,
              fontWeight: selected ? 600 : 450,
              whiteSpace: 'nowrap',
              cursor: selected ? 'default' : 'pointer',
              color: selected ? 'text.primary' : 'text.secondary',
              bgcolor: 'transparent',
              transition: 'color 0.2s',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {option.label}
          </Box>
        )
      })}
    </Box>
  )
}
