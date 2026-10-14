import { Box } from '@mui/material'
import type { ReactNode } from 'react'

export const MvpShortcutHint = ({
  label,
  shortcut,
}: {
  label: ReactNode
  shortcut: string
}) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <span>{label}</span>
    <Box
      component="kbd"
      sx={{
        flexShrink: 0,
        px: '6px',
        borderRadius: '6px',
        bgcolor: 'rgba(255, 255, 255, 0.24)',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      }}
    >
      {shortcut}
    </Box>
  </Box>
)
