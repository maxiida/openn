import { alpha, Box, type SxProps, type Theme } from '@mui/material'
import {
  IconAlertCircleFilled,
  IconAlertTriangleFilled,
  IconCircleCheckFilled,
  IconInfoCircleFilled,
} from '@tabler/icons-react'
import type { ReactNode } from 'react'

const ICONS = {
  success: IconCircleCheckFilled,
  info: IconInfoCircleFilled,
  warning: IconAlertTriangleFilled,
  error: IconAlertCircleFilled,
}

interface Props {
  severity: keyof typeof ICONS
  children: ReactNode
  sx?: SxProps<Theme>
}

/** A state the user has to resolve, kept in the page for as long as it lasts. */
export const MvpBanner = ({ severity, children, sx }: Props) => {
  const Icon = ICONS[severity]
  return (
    <Box
      role={severity === 'error' || severity === 'warning' ? 'alert' : 'status'}
      sx={[
        (theme) => {
          const tone = theme.palette[severity].main
          const dark = theme.palette.mode === 'dark'
          return {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.25,
            px: 1.75,
            py: 1.5,
            borderRadius: '14px',
            border: '0.5px solid',
            borderColor: alpha(tone, dark ? 0.3 : 0.28),
            bgcolor: alpha(tone, dark ? 0.12 : 0.09),
            fontSize: 13.5,
            lineHeight: 1.45,
          }
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        component={Icon}
        size={18}
        sx={{ flexShrink: 0, mt: '1px', color: `${severity}.main` }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  )
}
