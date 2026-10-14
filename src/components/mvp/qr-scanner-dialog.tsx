import { Box, Button, Dialog, Stack, Typography } from '@mui/material'
import { IconClipboard, IconPhoto } from '@tabler/icons-react'
import { readImage } from '@tauri-apps/plugin-clipboard-manager'
import i18n from 'i18next'
import jsQR from 'jsqr'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const [cameraError, setCameraError] = useState<string | null>(() =>
    cameraSupported ? null : t('mvp.qr.errors.cameraUnsupported'),
  )
  const [scanError, setScanError] = useState<string | null>(null)
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
      stopCamera()
      onDetected(payload)
    },
    [onDetected, stopCamera],
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

    if (!cameraSupported) return stopCamera

    void navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          scanFrame()
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setCameraError(getCameraErrorMessage(error))
      })

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [cameraSupported, finish, open, stopCamera])

  const onImageSelected = useCallback(
    (file: File | undefined) => {
      if (!file) return
      setScanError(null)

      const image = new Image()
      const objectUrl = URL.createObjectURL(file)
      image.onload = () => {
        const canvas = canvasRef.current
        const payload = canvas
          ? readQrCode(image, image.naturalWidth, image.naturalHeight, canvas)
          : null
        URL.revokeObjectURL(objectUrl)
        if (payload) finish(payload)
        else setScanError(t('mvp.qr.errors.notRecognized'))
      }
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        setScanError(t('mvp.qr.errors.imageUnreadable'))
      }
      image.src = objectUrl
    },
    [finish, t],
  )

  const onPasteImage = useCallback(async () => {
    setScanError(null)
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
      if (!payload) setScanError(t('mvp.qr.errors.clipboardNoQr'))
    } catch {
      setScanError(t('mvp.qr.errors.clipboardNoImage'))
    } finally {
      await clipboardImage?.close().catch(() => undefined)
      setReadingClipboard(false)
    }

    if (payload) finish(payload)
  }, [finish, t])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <Stack spacing={2.5} sx={{ p: 3 }}>
        <Box>
          <Typography sx={{ fontSize: 17, fontWeight: 650 }}>
            {t('mvp.common.scanQr')}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 13 }}>
            {t('mvp.qr.subtitle')}
          </Typography>
        </Box>

        <Box
          sx={{
            position: 'relative',
            aspectRatio: '1 / 1',
            overflow: 'hidden',
            borderRadius: '16px',
            bgcolor: 'action.hover',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {cameraError && (
            <Typography
              color="text.secondary"
              sx={{ position: 'absolute', px: 4, textAlign: 'center' }}
            >
              {cameraError}
            </Typography>
          )}
          {!cameraError && (
            <Box
              sx={{
                position: 'absolute',
                width: '68%',
                height: '68%',
                border: '2px solid',
                borderColor: 'common.white',
                borderRadius: '18px',
                boxShadow: '0 0 0 999px rgba(0, 0, 0, 0.18)',
                pointerEvents: 'none',
              }}
            />
          )}
        </Box>

        {scanError && (
          <Typography color="error" sx={{ fontSize: 13 }}>
            {scanError}
          </Typography>
        )}

        <Stack direction="row" spacing={1.25}>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<IconClipboard size={20} />}
            loading={readingClipboard}
            onClick={onPasteImage}
          >
            {t('mvp.qr.pasteImage')}
          </Button>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<IconPhoto size={20} />}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('mvp.qr.chooseImage')}
          </Button>
        </Stack>
        <Button
          color="inherit"
          size="small"
          sx={{ alignSelf: 'center' }}
          onClick={onClose}
        >
          {t('mvp.common.cancel')}
        </Button>

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
      </Stack>
    </Dialog>
  )
}
