import { alpha, Box, Button, type SxProps, type Theme } from '@mui/material'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { MvpProgressRing } from './mvp-progress-ring'

const ICONS = {
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
}

interface Props {
  severity: keyof typeof ICONS
  children: ReactNode
  /** Right-side button; `busy` swaps its label for a spinner while it runs. */
  action?: { label: string; busy?: boolean; onClick: () => void }
  sx?: SxProps<Theme>
}

/** A state the user has to resolve, kept in the page for as long as it lasts. Always one line. */
export const MvpBanner = ({ severity, children, action, sx }: Props) => {
  const Icon = ICONS[severity]
  return (
    <Box
      role={severity === 'error' || severity === 'warning' ? 'alert' : 'status'}
      sx={[
        (theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          minHeight: 40,
          boxSizing: 'border-box',
          py: 0.5,
          pl: 1.5,
          pr: action ? 0.75 : 1.5,
          borderRadius: '8px',
          bgcolor: alpha(
            theme.palette[severity].main,
            theme.palette.mode === 'dark' ? 0.12 : 0.08,
          ),
          fontSize: 13.5,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        component={Icon}
        size={16}
        sx={{ flexShrink: 0, color: `${severity}.main` }}
      />
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {children}
      </Box>
      {action && (
        <Button
          size="small"
          variant="text"
          disabled={action.busy}
          onClick={action.onClick}
          sx={(theme) => ({
            flexShrink: 0,
            minWidth: 76,
            color: 'text.primary',
            bgcolor: alpha(
              theme.palette.text.primary,
              theme.palette.mode === 'dark' ? 0.08 : 0.06,
            ),
            '&:hover': {
              bgcolor: alpha(
                theme.palette.text.primary,
                theme.palette.mode === 'dark' ? 0.14 : 0.1,
              ),
            },
            '&.Mui-disabled': { color: 'text.primary' },
          })}
        >
          {action.busy ? (
            <MvpProgressRing size={14} busy color="inherit" />
          ) : (
            action.label
          )}
        </Button>
      )}
    </Box>
  )
}
