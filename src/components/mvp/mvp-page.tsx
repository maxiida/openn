import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

import { useVerge } from '@/hooks/use-verge'
import { isGlassMode } from '@/pages/_layout/hooks/use-custom-theme'
import getSystem from '@/utils/get-system'

const OS = getSystem()

interface MvpPageProps {
  title: string
  leading?: ReactNode
  trailing?: ReactNode
  /** Pinned to the bottom of the window when the content is shorter than it. */
  footer?: ReactNode
  children: ReactNode
}

// Glass keeps the header out of the scroll area: a blurred sticky header would stack a second
// frosted layer over the window vibrancy and show a seam.

export const MvpPage = ({
  title,
  leading,
  trailing,
  footer,
  children,
}: MvpPageProps) => {
  const { verge } = useVerge()
  const glass = isGlassMode(verge?.enable_glass)
  const body = (
    <Box
      sx={{
        width: '100%',
        maxWidth: 620,
        mx: 'auto',
        px: 3,
        pb: footer ? 3 : 6,
        ...(footer && {
          flex: '1 0 auto',
          display: 'flex',
          flexDirection: 'column',
        }),
      }}
    >
      {footer ? <Box>{children}</Box> : children}
      {footer && <Box sx={{ mt: 'auto', pt: 5 }}>{footer}</Box>}
    </Box>
  )

  return (
    <Box
      sx={{
        height: '100%',
        overflow: glass ? 'hidden' : 'auto',
        display: glass || footer ? 'flex' : undefined,
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <Box
        component="header"
        data-tauri-drag-region="true"
        sx={{
          position: glass ? 'relative' : 'sticky',
          top: 0,
          zIndex: 10,
          flexShrink: 0,
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
          sx={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}
        >
          {title}
        </Typography>
        <Box sx={{ justifySelf: 'end' }}>{trailing}</Box>
      </Box>

      {glass ? (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: footer ? 'flex' : undefined,
            flexDirection: 'column',
          }}
        >
          {body}
        </Box>
      ) : (
        body
      )}
    </Box>
  )
}
