import { Box } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import type { ReactNode } from 'react'

import type { MvpSegment } from '@/utils/mvp-progress'

const breathe = keyframes`
  0%, 100% { opacity: 0.9; }
  50% { opacity: 0.3; }
`

export interface MvpCheckRingSegment {
  /** `active` lights the whole segment and breathes until it settles. */
  state: MvpSegment
}

interface Props {
  segments: readonly MvpCheckRingSegment[]
  /** Palette colour for finished segments, so a result can colour the whole ring. */
  doneColor?: string
  /** Centre content: the start button, a live number or the outcome. */
  children: ReactNode
  /** Small control sitting on the ring's lower-right edge. */
  corner?: ReactNode
  size?: number
  stroke?: number
}

/** A large ring that stays on screen and shows each step's own outcome, unlike MvpProgressRing. */
export const MvpCheckRing = ({
  segments,
  doneColor = 'primary.main',
  children,
  corner,
  size = 176,
  stroke = 7,
}: Props) => {
  const radius = (size - stroke) / 2
  const center = size / 2
  // Round caps reach half a stroke past each end, so the gap has to clear a full stroke.
  const gap = segments.length > 1 ? (stroke + 6) / radius : 0
  const span = (Math.PI * 2) / segments.length
  const point = (angle: number) =>
    `${center + radius * Math.sin(angle)} ${center - radius * Math.cos(angle)}`
  const arc = (from: number, to: number) =>
    `M ${point(from)} A ${radius} ${radius} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(to)}`
  const tone = (state: MvpSegment) =>
    state === 'warn'
      ? 'warning.main'
      : state === 'error'
        ? 'error.main'
        : state === 'done'
          ? doneColor
          : 'primary.main'

  return (
    <Box
      sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
    >
      <Box
        component="svg"
        aria-hidden
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        sx={{
          position: 'absolute',
          inset: 0,
          fill: 'none',
          strokeLinecap: 'round',
          '& path': { stroke: 'currentColor', strokeWidth: stroke },
        }}
      >
        {segments.map((segment, index) => {
          const from = index * span + gap / 2
          const length = span - gap
          return (
            <g key={from}>
              <Box
                component="path"
                d={arc(from, from + length)}
                sx={{ color: 'primary.main', opacity: 0.22 }}
              />
              {segment.state !== 'pending' && (
                <Box
                  component="path"
                  d={arc(from, from + length)}
                  sx={{
                    color: tone(segment.state),
                    transition: 'color 300ms',
                    animation:
                      segment.state === 'active'
                        ? `${breathe} 1.1s ease-in-out infinite`
                        : undefined,
                    '@media (prefers-reduced-motion: reduce)': {
                      animation: 'none',
                    },
                  }}
                />
              )}
            </g>
          )
        })}
      </Box>
      <Box
        sx={{
          position: 'absolute',
          inset: 14,
          borderRadius: '50%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </Box>
      {/* Far enough out that a 32px control clears the ring's stroke. */}
      {corner && (
        <Box sx={{ position: 'absolute', right: -2, bottom: -2, zIndex: 1 }}>
          {corner}
        </Box>
      )}
    </Box>
  )
}
