import { Box, IconButton } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import React, { useCallback, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { UI_TOKENS } from '@/pages/_layout/hooks/use-custom-theme'
import {
  boundNoticeText,
  subscribeNotices,
  hideNotice,
  getSnapshotNotices,
  showNotice,
} from '@/services/notice-service'
import type { TranslationKey } from '@/types/generated/i18n-keys'

type NoticeItem = ReturnType<typeof getSnapshotNotices>[number]
type TranslationFn = ReturnType<typeof useTranslation>['t']

// Notices sit above every other layer, dialogs and window resize handles included.
const NOTICE_Z_INDEX = 2147483647

const ICONS = {
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
}

const toastIn = keyframes`
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: none; }
`

/** Resolve notice text, bounding display output but not clipboard content. */
const resolveNoticeMessage = (
  notice: NoticeItem,
  t: TranslationFn,
  options?: { bounded?: boolean },
): React.ReactNode => {
  const bound = (text: React.ReactNode): React.ReactNode =>
    options?.bounded === false || typeof text !== 'string'
      ? text
      : boundNoticeText(text)

  const i18n = notice.i18n
  if (!i18n) return bound(notice.message)

  const source = (i18n.params ?? {}) as Record<string, unknown>
  // Bound both parameters and their final interpolation.
  const params =
    options?.bounded === false
      ? source
      : Object.fromEntries(
          Object.entries(source).map(([key, value]) => [
            key,
            typeof value === 'string' ? boundNoticeText(value) : value,
          ]),
        )
  const { prefixKey, prefixParams, prefix, message, ...restParams } = params

  const prefixKeyParams =
    prefixParams && typeof prefixParams === 'object'
      ? (prefixParams as Record<string, unknown>)
      : undefined

  const resolvedPrefix =
    typeof prefixKey === 'string'
      ? t(prefixKey as TranslationKey, {
          defaultValue: prefixKey,
          ...(prefixKeyParams ?? {}),
          ...restParams,
        })
      : typeof prefix === 'string'
        ? prefix
        : undefined

  const messageStr = typeof message === 'string' ? message : undefined

  const defaultValue =
    messageStr === undefined
      ? undefined
      : resolvedPrefix
        ? `${resolvedPrefix} ${messageStr}`
        : messageStr

  return bound(
    t(i18n.key as TranslationKey, {
      defaultValue,
      ...restParams,
      ...(resolvedPrefix !== undefined ? { prefix: resolvedPrefix } : {}),
      ...(messageStr !== undefined ? { message: messageStr } : {}),
    }),
  )
}

const extractNoticeCopyText = (input: unknown): string | undefined => {
  if (input === null || input === undefined) return undefined
  if (typeof input === 'string') return input
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input)
  }
  if (input instanceof Error) {
    return input.message || input.name
  }
  if (React.isValidElement(input)) return undefined
  if (typeof input === 'object') {
    const maybeMessage = (input as { message?: unknown }).message
    if (typeof maybeMessage === 'string') return maybeMessage
  }
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

const resolveNoticeCopyText = (
  notice: NoticeItem,
  t: TranslationFn,
): string | undefined => {
  if (
    notice.i18n?.key === 'shared.feedback.notices.prefixedRaw' ||
    notice.i18n?.key === 'shared.feedback.notices.raw'
  ) {
    const rawText = extractNoticeCopyText(notice.i18n?.params?.message)
    if (rawText) return rawText
  }

  return (
    extractNoticeCopyText(
      resolveNoticeMessage(notice, t, { bounded: false }),
    ) ?? extractNoticeCopyText(notice.message)
  )
}

export const NoticeManager = () => {
  const { t } = useTranslation()
  const currentNotices = useSyncExternalStore(
    subscribeNotices,
    getSnapshotNotices,
  )

  const handleNoticeCopy = useCallback(
    async (notice: NoticeItem) => {
      const text = resolveNoticeCopyText(notice, t)
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
        showNotice.success(
          'shared.feedback.notifications.common.copySuccess',
          1000,
        )
      } catch (error) {
        console.warn('[NoticeManager] copy to clipboard failed:', error)
      }
    },
    [t],
  )

  // Portaled to <body> so no ancestor stacking context can bury it under a dialog portal.
  return createPortal(
    <Box
      sx={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: NOTICE_Z_INDEX,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        width: 'max-content',
        maxWidth: 'calc(100vw - 32px)',
        pointerEvents: 'none',
      }}
    >
      {currentNotices.map((notice) => {
        const Icon = ICONS[notice.type]
        return (
          <Box
            key={notice.id}
            role={notice.type === 'error' ? 'alert' : 'status'}
            title={resolveNoticeCopyText(notice, t)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void handleNoticeCopy(notice)
            }}
            sx={(theme) => {
              const ui = UI_TOKENS[theme.palette.mode]
              return {
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                maxWidth: '100%',
                height: 36,
                pl: 1.5,
                pr: 0.75,
                borderRadius: '10px',
                border: `0.5px solid ${ui.line}`,
                bgcolor: ui.raised,
                color: 'text.primary',
                fontSize: 13.5,
                boxShadow:
                  theme.palette.mode === 'light'
                    ? '0 6px 20px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06) !important'
                    : '0 6px 20px rgba(0, 0, 0, 0.45) !important',
                animation: `${toastIn} 160ms ease-out both`,
                '@media (prefers-reduced-motion: reduce)': {
                  animation: 'none',
                },
              }
            }}
          >
            <Box
              component={Icon}
              size={16}
              sx={{ flexShrink: 0, color: `${notice.type}.main` }}
            />
            {/* Always one line; the full text stays in the title and the right-click copy. */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {resolveNoticeMessage(notice, t)}
            </Box>
            <IconButton
              aria-label={t('shared.actions.close')}
              onClick={() => hideNotice(notice.id)}
              sx={{
                width: 20,
                height: 20,
                p: 0,
                flexShrink: 0,
                borderRadius: '5px',
              }}
            >
              <XIcon size={13} />
            </IconButton>
          </Box>
        )
      })}
    </Box>,
    document.body,
  )
}
