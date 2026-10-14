import { Box } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import { type ReactNode, useEffect, useState } from 'react'

import {
  isSettledSegment,
  type MvpOutcome,
  type MvpSegment,
  outcomeOf,
  RING_SEGMENTS,
  toRingSegments,
} from '@/utils/mvp-progress'

const TRACK_OPACITY = 0.22
const HOP_MS = 140
const LAG_MS = 70
// The outcome stays up long enough to read, then the ring shrinks away over EXIT_MS.
const HOLD_MS = 1100
const EXIT_MS = 180
// Below this a mark drawn inside the ring is too small to read, so it covers the ring instead.
const INNER_MARK_MIN_SIZE = 16

const enter = keyframes`
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: none; }
`
const exit = keyframes`
  to { opacity: 0; transform: scale(0.6); }
`
const lightUp = keyframes`
  from { stroke-width: var(--mvp-ring-pop); opacity: 0; }
  to { stroke-width: var(--mvp-ring-stroke); opacity: 1; }
`
const breathe = keyframes`
  0%, 100% { opacity: 0.9; }
  50% { opacity: 0.25; }
`
const hop = keyframes`
  0%, 16.6% { opacity: 1; }
  16.7%, 100% { opacity: 0; }
`
const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`
const dim = keyframes`
  to { opacity: 0.3; }
`
const vanish = keyframes`
  to { opacity: 0; }
`
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
`
const draw = keyframes`
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
`

const CHECK = [
  [0.27, 0.53],
  [0.43, 0.68],
  [0.74, 0.36],
]
const CROSS = [
  [
    [0.34, 0.34],
    [0.66, 0.66],
  ],
  [
    [0.66, 0.34],
    [0.34, 0.66],
  ],
]

interface Props {
  size: number
  /**
   * The units of work, in the order they finish. Omitted for work with nothing to count: a single
   * lit segment then circles the ring.
   */
  segments?: readonly MvpSegment[]
  /** With `children`, the ring only replaces them while busy. */
  busy?: boolean
  children?: ReactNode
  /** `inherit` draws in the surrounding text colour, for filled buttons and pills. */
  color?: 'primary' | 'inherit'
}

export const MvpProgressRing = ({
  size,
  segments,
  busy = true,
  children,
  color = 'primary',
}: Props) => {
  const key = segments?.join() ?? ''
  const [last, setLast] = useState({ key, segments })
  const [wasBusy, setWasBusy] = useState(busy)
  // Idle content animates back in only after a run, not when the page first renders.
  const [ran, setRan] = useState(busy)
  const [held, setHeld] = useState<{
    units: readonly MvpSegment[]
    outcome: MvpOutcome
  } | null>(null)
  if (busy && last.key !== key) setLast({ key, segments })
  if (busy !== wasBusy) {
    setWasBusy(busy)
    setRan(true)
    // Prefer what was on screen while busy; the final result may instead land in the same render
    // that ends the work.
    const units = busy
      ? undefined
      : [last.segments, segments].find((candidate) => outcomeOf(candidate))
    const outcome = outcomeOf(units)
    setHeld(units && outcome ? { units, outcome } : null)
  }
  useEffect(() => {
    if (!held) return
    const timer = setTimeout(() => setHeld(null), HOLD_MS)
    return () => clearTimeout(timer)
  }, [held])

  if (!busy && !held) {
    if (!children || !ran) return children ?? null
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          animation: `${enter} 220ms ease-out`,
        }}
      >
        {children}
      </Box>
    )
  }

  const units = held?.units ?? segments
  const outcome = held?.outcome
  const stroke = Math.max(1.5, size * 0.1)
  const radius = (size - stroke) / 2
  const center = size / 2
  const gap = Math.max(1, size * 0.08) / radius
  const span = (Math.PI * 2) / RING_SEGMENTS
  const point = (angle: number) =>
    `${center + radius * Math.sin(angle)} ${center - radius * Math.cos(angle)}`
  const arc = (index: number) => {
    const from = index * span + gap / 2
    return `M ${point(from)} A ${radius} ${radius} 0 0 1 ${point(from + span - gap)}`
  }
  // `sx` resolves palette keys for `color` but not `stroke`, so everything strokes currentColor.
  const inherit = color === 'inherit'
  const lit = inherit ? undefined : 'primary.main'
  const tone = (segment: MvpSegment) =>
    segment === 'warn'
      ? 'warning.main'
      : segment === 'error'
        ? 'error.main'
        : lit
  const inner = size >= INNER_MARK_MIN_SIZE
  const markScale = inner ? 0.62 : 1
  const markPath = (points: number[][]) =>
    points
      .map(
        ([x, y], index) =>
          `${index ? 'L' : 'M'} ${center + (x * size - center) * markScale} ${center + (y * size - center) * markScale}`,
      )
      .join(' ')
  const mark = (d: string, tint: string | undefined, delay: number) => (
    <Box
      key={d}
      component="path"
      d={d}
      pathLength={1}
      sx={{
        color: tint,
        stroke: 'currentColor',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        strokeDasharray: 1,
        strokeDashoffset: 1,
        animation: `${draw} 260ms ${delay}ms ease-out forwards`,
      }}
    />
  )

  return (
    <Box
      component="svg"
      role="progressbar"
      aria-valuemin={units ? 0 : undefined}
      aria-valuemax={units ? units.length : undefined}
      aria-valuenow={units ? units.filter(isSettledSegment).length : undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      sx={{
        display: 'block',
        flexShrink: 0,
        fill: 'none',
        '--mvp-ring-stroke': `${stroke}px`,
        '--mvp-ring-pop': `${stroke * 1.8}px`,
        '& path, & circle': { strokeWidth: 'var(--mvp-ring-stroke)' },
        animation: held
          ? `${exit} ${EXIT_MS}ms ${HOLD_MS - EXIT_MS}ms ease-in forwards`
          : `${enter} 200ms ease-out`,
      }}
    >
      <Box
        component="g"
        sx={{
          animation:
            outcome === 'success' || outcome === 'failure'
              ? `${inner ? dim : vanish} 200ms ${outcome === 'success' ? 200 : 100}ms ease-out forwards`
              : undefined,
        }}
      >
        {(units ? toRingSegments(units) : []).map(
          ({ position, state, lag }) => {
            const track = (
              <Box
                key={`track-${position}`}
                component="path"
                d={arc(position)}
                sx={{ stroke: 'currentColor', opacity: TRACK_OPACITY }}
              />
            )
            if (state === 'pending') return track
            return [
              track,
              <Box
                // Remounting on a new state replays the light-up.
                key={`${position}-${state}`}
                component="path"
                d={arc(position)}
                sx={{
                  color: tone(state),
                  stroke: 'currentColor',
                  animation:
                    state === 'active'
                      ? `${breathe} 1s ease-in-out infinite`
                      : outcome === 'partial' && state !== 'done'
                        ? `${pulse} 360ms ease-in-out 2`
                        : `${lightUp} 260ms ${lag * LAG_MS}ms ease-out both`,
                }}
              />,
            ]
          },
        )}
        {!units &&
          Array.from({ length: RING_SEGMENTS }, (_, index) => [
            <Box
              key={`track-${index}`}
              component="path"
              d={arc(index)}
              sx={{ stroke: 'currentColor', opacity: TRACK_OPACITY }}
            />,
            <Box
              key={`hop-${index}`}
              component="path"
              d={arc(index)}
              sx={{
                color: lit,
                stroke: 'currentColor',
                opacity: 0,
                animation: `${hop} ${RING_SEGMENTS * HOP_MS}ms linear infinite`,
                animationDelay: `${index * HOP_MS}ms`,
              }}
            />,
          ])}
        {outcome === 'success' && (
          // The gaps close into one ring before the check draws.
          <Box
            component="circle"
            cx={center}
            cy={center}
            r={radius}
            sx={{
              color: inherit ? undefined : 'success.main',
              stroke: 'currentColor',
              animation: `${fadeIn} 180ms ease-out both`,
            }}
          />
        )}
      </Box>
      {outcome === 'success' &&
        mark(markPath(CHECK), inherit ? undefined : 'success.main', 200)}
      {outcome === 'failure' &&
        CROSS.map((line, index) =>
          mark(
            markPath(line),
            inherit ? undefined : 'error.main',
            100 + index * 140,
          ),
        )}
    </Box>
  )
}
