import {
  Box,
  Button,
  Dialog,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { readImage } from '@tauri-apps/plugin-clipboard-manager'
import i18n from 'i18next'
import jsQR from 'jsqr'
import {
  CameraOffIcon,
  ClipboardPasteIcon,
  ImageIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MvpProgressRing } from '@/components/mvp/mvp-progress-ring'
import { mvpCommandKey } from '@/hooks/use-mvp-shortcuts'
import { showNotice } from '@/services/notice-service'
import getSystem from '@/utils/get-system'

interface QrScannerDialogProps {
  open: boolean
  onClose: () => void
  onDetected: (payload: string) => void
}

const readQrCode = (
  source: CanvasImageSource,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context || width <= 0 || height <= 0) return null

  canvas.width = width
  canvas.height = height
  context.drawImage(source, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height)
  return jsQR(pixels.data, width, height, {
    inversionAttempts: 'attemptBoth',
  })?.data
}

const getCameraErrorMessage = (error: unknown) => {
  if (!(error instanceof DOMException)) {
    return i18n.t(($) => $.mvp.qr.errors.cameraUnavailable)
  }

  if (error.name === 'NotAllowedError') {
    return i18n.t(($) => $.mvp.qr.errors.cameraDenied)
  }
  if (error.name === 'NotFoundError') {
    return i18n.t(($) => $.mvp.qr.errors.cameraNotFound)
  }
  if (error.name === 'NotReadableError') {
    return i18n.t(($) => $.mvp.qr.errors.cameraBusy)
  }
  return i18n.t(($) => $.mvp.qr.errors.cameraUnavailable)
}

const CORNERS = [
  { top: 0, left: 0, borderWidth: '2.5px 0 0 2.5px' },
  { top: 0, right: 0, borderWidth: '2.5px 2.5px 0 0' },
  { bottom: 0, left: 0, borderWidth: '0 0 2.5px 2.5px' },
  { bottom: 0, right: 0, borderWidth: '0 2.5px 2.5px 0' },
] as const

// Lets the corners flash green before the dialog closes.
const SUCCESS_DELAY_MS = 400

export const QrScannerDialog = ({
  open,
  onClose,
  onDetected,
}: QrScannerDialogProps) => {
  const { t } = useTranslation()
  const cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const detectedRef = useRef(false)
  // Callers pass a fresh callback every render; reading it through a ref keeps the camera running.
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected
  const [cameraFailed, setCameraFailed] = useState(!cameraSupported)
  const [cameraReady, setCameraReady] = useState(false)
  const [detected, setDetected] = useState(false)
  const [readingClipboard, setReadingClipboard] = useState(false)

  const stopCamera = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const finish = useCallback(
    (payload: string) => {
      if (detectedRef.current) return
      detectedRef.current = true
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      setDetected(true)
      window.setTimeout(() => {
        stopCamera()
        onDetectedRef.current(payload)
      }, SUCCESS_DELAY_MS)
    },
    [stopCamera],
  )

  useEffect(() => {
    if (!open) {
      stopCamera()
      return
    }

    detectedRef.current = false
    let cancelled = false
    const scanFrame = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!cancelled && video && canvas && video.readyState >= 2) {
        const payload = readQrCode(
          video,
          video.videoWidth,
          video.videoHeight,
          canvas,
        )
        if (payload) {
          finish(payload)
          return
        }
      }
      if (!cancelled) {
        animationFrameRef.current = requestAnimationFrame(scanFrame)
      }
    }

    if (!cameraSupported) {
      // Deferred so StrictMode's throwaway mount doesn't show it twice.
      queueMicrotask(() => {
        if (!cancelled) showNotice.error(t('mvp.qr.errors.cameraUnsupported'))
      })
      return () => {
        cancelled = true
      }
    }

    void navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setCameraReady(true)
          scanFrame()
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setCameraFailed(true)
        showNotice.error(getCameraErrorMessage(error))
      })

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [cameraSupported, finish, open, stopCamera, t])

  const onImageSelected = useCallback(
    (file: File | undefined) => {
      if (!file) return

      const image = new Image()
      const objectUrl = URL.createObjectURL(file)
      image.onload = () => {
        const canvas = canvasRef.current
        const payload = canvas
          ? readQrCode(image, image.naturalWidth, image.naturalHeight, canvas)
          : null
        URL.revokeObjectURL(objectUrl)
        if (payload) finish(payload)
        else showNotice.error(t('mvp.qr.errors.notRecognized'))
      }
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        showNotice.error(t('mvp.qr.errors.imageUnreadable'))
      }
      image.src = objectUrl
    },
    [finish, t],
  )

  const onPasteImage = useCallback(async () => {
    setReadingClipboard(true)
    let clipboardImage: Awaited<ReturnType<typeof readImage>> | undefined
    let payload: string | undefined

    try {
      clipboardImage = await readImage()
      const [{ width, height }, rgba] = await Promise.all([
        clipboardImage.size(),
        clipboardImage.rgba(),
      ])
      payload = jsQR(new Uint8ClampedArray(rgba), width, height, {
        inversionAttempts: 'attemptBoth',
      })?.data
      if (!payload) showNotice.error(t('mvp.qr.errors.clipboardNoQr'))
    } catch {
      showNotice.error(t('mvp.qr.errors.clipboardNoImage'))
    } finally {
      await clipboardImage?.close().catch(() => undefined)
      setReadingClipboard(false)
    }

    if (payload) finish(payload)
  }, [finish, t])

  useEffect(() => {
    if (!open) return
    const isMac = getSystem() === 'macos'
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'v' ||
        event.metaKey !== isMac ||
        event.ctrlKey === isMac ||
        event.altKey ||
        event.shiftKey ||
        event.repeat
      ) {
        return
      }
      event.preventDefault()
      void onPasteImage()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onPasteImage, open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: 360, maxWidth: 'calc(100% - 32px)' } },
      }}
    >
      <Box sx={{ p: '16px 20px 20px' }}>
        <Box
          sx={{
            mb: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography sx={{ fontSize: 16, fontWeight: 600 }}>
            {t('mvp.qr.title')}
          </Typography>
          <IconButton
            aria-label={t('shared.actions.close')}
            onClick={onClose}
            sx={{ mr: -1 }}
          >
            <XIcon size={18} />
          </IconButton>
        </Box>

        <Box
          sx={{
            position: 'relative',
            aspectRatio: '4 / 3',
            overflow: 'hidden',
            borderRadius: '12px',
            bgcolor: '#141413',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
            }}
          />
          {cameraFailed ? (
            <CameraOffIcon size={24} color="rgba(236, 234, 228, 0.45)" />
          ) : !cameraReady ? (
            <Box sx={{ display: 'flex', color: 'rgba(236, 234, 228, 0.6)' }}>
              <MvpProgressRing size={18} color="inherit" />
            </Box>
          ) : (
            <>
              <Box
                sx={{
                  position: 'absolute',
                  top: '46%',
                  left: '50%',
                  width: detected ? '50%' : '56%',
                  aspectRatio: '1 / 1',
                  maxHeight: detected ? '66%' : '74%',
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '14px',
                  boxShadow: '0 0 0 999px rgba(0, 0, 0, 0.35)',
                  transition: 'width 0.25s, max-height 0.25s',
                  pointerEvents: 'none',
                }}
              >
                {CORNERS.map((corner) => (
                  <Box
                    key={corner.borderWidth}
                    sx={{
                      position: 'absolute',
                      width: 24,
                      height: 24,
                      borderStyle: 'solid',
                      borderColor: detected ? 'success.main' : 'common.white',
                      borderRadius: '14px',
                      transition: 'border-color 0.2s',
                      ...corner,
                    }}
                  />
                ))}
              </Box>
              <Typography
                sx={{
                  position: 'absolute',
                  bottom: 12,
                  fontSize: 12,
                  color: 'rgba(255, 255, 255, 0.75)',
                }}
              >
                {t('mvp.qr.hint')}
              </Typography>
            </>
          )}
        </Box>

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<ClipboardPasteIcon size={16} />}
            loading={readingClipboard}
            disabled={detected}
            onClick={onPasteImage}
          >
            {t('mvp.qr.pasteImage')}
            <Box
              component="kbd"
              sx={{
                ml: 0.75,
                px: '5px',
                borderRadius: '4px',
                bgcolor: 'action.hover',
                color: 'text.secondary',
                fontFamily: 'inherit',
                fontSize: 11.5,
                lineHeight: '17px',
              }}
            >
              {mvpCommandKey}V
            </Box>
          </Button>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<ImageIcon size={16} />}
            disabled={detected}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('mvp.qr.chooseImage')}
          </Button>
        </Stack>

        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept="image/*"
          onChange={(event) => {
            onImageSelected(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <canvas ref={canvasRef} hidden />
      </Box>
    </Dialog>
  )
}
