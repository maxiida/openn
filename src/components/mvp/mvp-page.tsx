import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

import getSystem from '@/utils/get-system'

const OS = getSystem()

interface MvpPageProps {
  title: string
  leading?: ReactNode
  trailing?: ReactNode
  children: ReactNode
}

export const MvpPage = ({
  title,
  leading,
  trailing,
  children,
}: MvpPageProps) => (
  <Box
    sx={{
      height: '100%',
      overflow: 'auto',
      bgcolor: 'background.default',
    }}
  >
    <Box
      component="header"
      data-tauri-drag-region="true"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        bgcolor: 'background.default',
        minHeight: OS === 'macos' ? 88 : 64,
        pt: OS === 'macos' ? 3 : 0,
        px: { xs: 3, sm: 5 },
        display: 'grid',
        gridTemplateColumns: 'minmax(40px, 1fr) auto minmax(40px, 1fr)',
        alignItems: 'center',
      }}
    >
      <Box sx={{ justifySelf: 'start' }}>{leading}</Box>
      <Typography
        data-tauri-drag-region="true"
        sx={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.02em' }}
      >
        {title}
      </Typography>
      <Box sx={{ justifySelf: 'end' }}>{trailing}</Box>
    </Box>

    <Box sx={{ width: '100%', maxWidth: 620, mx: 'auto', px: 3, pb: 6 }}>
      {children}
    </Box>
  </Box>
)
