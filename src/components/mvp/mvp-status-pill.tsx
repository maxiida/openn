import { alpha, Box, ButtonBase, type Theme } from '@mui/material'
import type { ComponentProps, ReactNode } from 'react'

import type { MvpSegment } from '@/utils/mvp-progress'

import { MvpProgressRing } from './mvp-progress-ring'

const TONES = ['success', 'lime', 'yellow', 'info', 'warning', 'error'] as const

/** Accepts the palette colours the delay and speed helpers return; anything else renders neutral. */
const pillColors = (color: string) => (theme: Theme) => {
  const tone = TONES.find((name) => color.startsWith(`${name}.`))
  if (!tone) {
    return {
      bgcolor: 'action.hover',
      color: 'text.secondary',
      borderColor: 'divider',
    }
  }
  const palette = theme.palette[tone]
  const dark = theme.palette.mode === 'dark'
  return {
    bgcolor: alpha(palette.main, dark ? 0.16 : 0.1),
    color: dark ? palette.light : palette.dark,
    borderColor: alpha(palette.main, dark ? 0.4 : 0.3),
  }
}

type Props = Omit<ComponentProps<typeof ButtonBase>, 'color'> & {
  color: string
  loading?: boolean
  /** What the loading ring counts; without it the ring only shows that work is running. */
  progress?: readonly MvpSegment[]
  endIcon?: ReactNode
}

export const MvpStatusPill = ({
  color,
  loading = false,
  progress,
  endIcon,
  children,
  onClick,
  sx,
  ...props
}: Props) => (
  <Box
    component={onClick ? ButtonBase : 'span'}
    onClick={onClick}
    {...props}
    sx={[
      {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.625,
        height: 26,
        px: 1.375,
        borderRadius: 999,
        border: '0.5px solid',
        fontSize: 13,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        cursor: onClick ? 'pointer' : 'help',
        transition: 'background-color 150ms, color 150ms',
      },
      pillColors(loading ? 'text.secondary' : color),
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}
  >
    <MvpProgressRing
      busy={loading}
      size={11}
      color="inherit"
      segments={progress}
    />
    {children}
    {endIcon}
  </Box>
)
