import { alpha, Box, ButtonBase, type Theme } from '@mui/material'
import type { ComponentProps, ReactNode } from 'react'

const TONES = ['success', 'lime', 'yellow', 'info', 'warning', 'error'] as const

/** Accepts the palette colours the delay and speed helpers return; anything else renders neutral. */
const pillColors = (color: string) => (theme: Theme) => {
  const tone = TONES.find((name) => color.startsWith(`${name}.`))
  if (!tone) {
    return { bgcolor: 'action.hover', color: 'text.secondary' }
  }
  const palette = theme.palette[tone]
  const dark = theme.palette.mode === 'dark'
  return {
    bgcolor: alpha(palette.main, dark ? 0.16 : 0.1),
    color: dark ? palette.light : palette.dark,
  }
}

type Props = Omit<ComponentProps<typeof ButtonBase>, 'color'> & {
  color: string
  loading?: boolean
  endIcon?: ReactNode
}

export const MvpStatusPill = ({
  color,
  loading = false,
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
        fontSize: 13,
        fontWeight: 500,
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
    {children}
    {endIcon}
  </Box>
)
