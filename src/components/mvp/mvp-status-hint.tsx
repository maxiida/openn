import { Box } from '@mui/material'
import type { ReactNode } from 'react'

import { MvpShortcutHint } from './mvp-shortcut-hint'

/** Tooltip for a status pill: what the pill measures, then what it found. */
export const MvpStatusHint = ({
  title,
  children,
  shortcut,
}: {
  title: ReactNode
  children: ReactNode
  shortcut?: string
}) => (
  <Box>
    <Box sx={{ fontWeight: 600 }}>{title}</Box>
    {shortcut ? (
      <MvpShortcutHint label={children} shortcut={shortcut} />
    ) : (
      children
    )}
  </Box>
)
