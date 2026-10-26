import { Paper, ThemeProvider } from '@mui/material'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router'

import { BaseErrorBoundary } from '@/components/base'
import { NoticeManager } from '@/components/layout/notice-manager'
import {
  WindowControls,
  WindowResizeHandles,
} from '@/components/layout/window-controller'
import { useI18n } from '@/hooks/use-i18n'
import { useMvpShortcuts } from '@/hooks/use-mvp-shortcuts'
import { useProfiles } from '@/hooks/use-profiles'
import { useVerge } from '@/hooks/use-verge'
import { useWindowDecorations } from '@/hooks/use-window'
import {
  useAppRefreshers,
  useClashConfigData,
} from '@/providers/app-data-context'
import { subscribeVergeEvents } from '@/services/events'
import { resolveLanguage } from '@/services/i18n'
import { ensureMvpMode } from '@/services/mvp'
import { useThemeMode } from '@/services/states'
import getSystem from '@/utils/get-system'

import {
  useCustomTheme,
  useLayoutEvents,
  useLoadingOverlay,
} from './_layout/hooks'

import 'dayjs/locale/ru'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)

const OS = getSystem()

const Layout = () => {
  const mode = useThemeMode()
  const { theme } = useCustomTheme()
  const { verge } = useVerge()
  const { profiles } = useProfiles()
  const { clashConfig } = useClashConfigData()
  const { refreshClashConfig } = useAppRefreshers()
  const { language } = verge ?? {}
  const currentProfileId = profiles?.current
  const { switchLanguage } = useI18n()
  const themeReady = useMemo(() => Boolean(theme), [theme])
  const windowControlsRef = useRef<any>(null)
  const { decorated } = useWindowDecorations()

  const customTitlebar = useMemo(
    () =>
      decorated === false ? (
        <div className="the_titlebar">
          <div
            className="the_titlebar-drag-region"
            data-tauri-drag-region="true"
          />
          <WindowControls ref={windowControlsRef} />
        </div>
      ) : null,
    [decorated],
  )

  useLoadingOverlay(themeReady)

  const handleNotice = useCallback((payload: [string, string]) => {
    const [status, msg] = payload
    if (status.includes('error') || status.includes('failed')) {
      console.error(`[Proxy MVP] Background operation failed: ${status}`, msg)
    }
  }, [])

  useLayoutEvents(handleNotice)

  const navigate = useNavigate()
  useMvpShortcuts([
    { key: ',', command: true, onPress: () => navigate('/settings') },
    { key: 'd', command: true, onPress: () => navigate('/check') },
  ])
  useEffect(
    () =>
      subscribeVergeEvents({ 'verge://navigate': (path) => navigate(path) }),
    [navigate],
  )

  useEffect(() => {
    if (!currentProfileId) return
    if (clashConfig?.mode?.toLowerCase() === 'rule') return

    void ensureMvpMode()
      .then(() => refreshClashConfig())
      .catch((error) => {
        console.error('[Proxy MVP] Failed to enforce the proxy mode:', error)
      })
  }, [clashConfig?.mode, currentProfileId, refreshClashConfig])

  useEffect(() => {
    if (language === undefined) return
    const resolved = resolveLanguage(language)
    dayjs.locale(resolved === 'zh' ? 'zh-cn' : resolved)
    switchLanguage(resolved)
  }, [language, switchLanguage])

  if (!themeReady) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: mode === 'light' ? '#fff' : '#181a1b',
          transition: 'background 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: mode === 'light' ? '#333' : '#fff',
        }}
      ></div>
    )
  }

  return (
    <ThemeProvider theme={theme}>
      {/* 左侧底部窗口控制按钮 */}
      <NoticeManager />
      <div
        style={{
          animation: 'fadeIn 0.5s',
          WebkitAnimation: 'fadeIn 0.5s',
        }}
      />
      <style>
        {`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}
      </style>
      <Paper
        square
        elevation={0}
        className={`${OS} layout`}
        style={{
          borderTopLeftRadius: '0px',
          borderTopRightRadius: '0px',
        }}
        onContextMenu={(e) => {
          if (
            OS === 'windows' &&
            !['input', 'textarea'].includes(
              e.currentTarget.tagName.toLowerCase(),
            ) &&
            !e.currentTarget.isContentEditable
          ) {
            e.preventDefault()
          }
        }}
        sx={[
          ({ palette }) => ({ bgcolor: palette.background.paper }),
          OS === 'linux'
            ? {
                borderRadius: '8px',
                width: '100vw',
                height: '100vh',
              }
            : {},
        ]}
      >
        {decorated === false && <WindowResizeHandles />}

        {/* Custom titlebar - rendered only when decorated is false, memoized for performance */}
        {customTitlebar}

        <div className="layout-content">
          <div className="layout-content__right">
            <div className="the-bar"></div>
            <div className="the-content">
              <BaseErrorBoundary>
                <Outlet />
              </BaseErrorBoundary>
            </div>
          </div>
        </div>
      </Paper>
    </ThemeProvider>
  )
}

export default Layout
