import {
  alpha,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  type SxProps,
  type Theme,
} from '@mui/material'
import { ReactNode } from 'react'

interface Props {
  title: ReactNode
  open: boolean
  /** Centers the dialog under this icon, for confirmations rather than forms. */
  icon?: ReactNode
  /** Paints the icon and the confirm button red, for actions that cannot be undone. */
  danger?: boolean
  okBtn?: ReactNode
  cancelBtn?: ReactNode
  disableEnforceFocus?: boolean
  disableOk?: boolean
  disableCancel?: boolean
  disableFooter?: boolean
  contentSx?: SxProps<Theme>
  children?: ReactNode
  loading?: boolean
  loadingIndicator?: ReactNode
  onOk?: () => void
  onCancel?: () => void
  onClose?: () => void
}

export interface DialogRef {
  open: () => void
  close: () => void
}

export const BaseDialog: React.FC<Props> = ({
  open,
  title,
  icon,
  danger,
  children,
  okBtn,
  cancelBtn,
  disableEnforceFocus,
  contentSx,
  disableCancel,
  disableOk,
  disableFooter,
  loading,
  loadingIndicator,
  onOk,
  onCancel,
  onClose,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      disableEnforceFocus={disableEnforceFocus}
    >
      <DialogTitle sx={icon ? { textAlign: 'center' } : undefined}>
        {icon && (
          <Box
            sx={(theme) => {
              const tone = theme.palette[danger ? 'error' : 'primary'].main
              return {
                width: 48,
                height: 48,
                mx: 'auto',
                mb: 1.75,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                color: tone,
                bgcolor: alpha(tone, 0.1),
              }
            }}
          >
            {icon}
          </Box>
        )}
        {title}
      </DialogTitle>

      <DialogContent
        sx={[
          icon ? { textAlign: 'center', color: 'text.secondary' } : {},
          ...(Array.isArray(contentSx) ? contentSx : [contentSx]),
        ]}
      >
        {children}
      </DialogContent>

      {!disableFooter && (
        <DialogActions>
          {!disableCancel && (
            <Button variant="outlined" disabled={loading} onClick={onCancel}>
              {cancelBtn}
            </Button>
          )}
          {!disableOk && (
            <Button
              loading={loading}
              loadingIndicator={loadingIndicator}
              variant="contained"
              color={danger ? 'error' : 'primary'}
              onClick={onOk}
            >
              {okBtn}
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  )
}
