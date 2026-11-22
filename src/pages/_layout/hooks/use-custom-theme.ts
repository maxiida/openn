import {
  alpha,
  createTheme,
  Theme as MuiTheme,
  Shadows,
  ThemeOptions,
} from '@mui/material'
import { keyframes } from '@mui/material/styles'
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from '@tauri-apps/api/webviewWindow'
import { Theme as TauriOsTheme } from '@tauri-apps/api/window'
import { useEffect, useMemo } from 'react'

import { useVerge } from '@/hooks/use-verge'
import { defaultDarkTheme, defaultTheme } from '@/pages/_theme'
import { useSetThemeMode, useThemeMode } from '@/services/states'

const CSS_INJECTION_SCOPE_ROOT = '[data-css-injection-root]'
const CSS_INJECTION_SCOPE_LIMIT =
  ':is(.monaco-editor .view-lines, .monaco-editor .view-line, .monaco-editor .margin, .monaco-editor .margin-view-overlays, .monaco-editor .view-overlays, .monaco-editor [class^="mtk"], .monaco-editor [class*=" mtk"])'
const TOP_LEVEL_AT_RULES = [
  '@charset',
  '@import',
  '@namespace',
  '@font-face',
  '@keyframes',
  '@counter-style',
  '@page',
  '@property',
  '@font-feature-values',
  '@color-profile',
]
let cssScopeSupport: boolean | null = null

// Every spinner shares the speed-test look: a divider-colored full ring under the moving arc.
// Spinners inside filled buttons inherit the label color, where a gray ring would clash.
const TONED_COLORS = ['error', 'warning', 'success', 'info'] as const

// Global CSS strips every box-shadow, so rings and elevation below need !important.
const focusRing = (color: string) =>
  `0 0 0 3.5px ${alpha(color, 0.22)} !important`

const dialogIn = keyframes`
  from { opacity: 0; transform: scale(0.94) translateY(6px); }
  to { opacity: 1; transform: none; }
`

const components: ThemeOptions['components'] = {
  MuiButton: {
    defaultProps: { disableElevation: true, disableRipple: true },
    styleOverrides: {
      root: ({ theme }) => ({
        textTransform: 'none',
        height: 36,
        padding: '0 16px',
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        transition: theme.transitions.create(
          ['background-color', 'color', 'transform'],
          { duration: 150 },
        ),
        '&:active:not(.Mui-disabled)': { transform: 'scale(0.97)' },
        '&.Mui-focusVisible': {
          boxShadow: focusRing(theme.palette.primary.main),
        },
      }),
      sizeLarge: { height: 44, padding: '0 22px', fontSize: 15 },
      sizeSmall: { height: 28, padding: '0 12px', fontSize: 13 },
      contained: ({ ownerState, theme }) => {
        if (ownerState.color === 'inherit') return {}
        const palette = theme.palette[ownerState.color ?? 'primary']
        // Busy buttons stay disabled while a progress ring runs inside, so the label must stay legible.
        return {
          '&.Mui-disabled': {
            backgroundColor: alpha(palette.main, 0.45),
            color: alpha(palette.contrastText, 0.9),
          },
        }
      },
      // Outlined is the secondary action: a soft fill instead of a border.
      outlined: ({ ownerState, theme }) => {
        const tone = TONED_COLORS.find((name) => name === ownerState.color)
        const fill = tone
          ? alpha(theme.palette[tone].main, 0.1)
          : theme.palette.action.hover
        const hover = tone
          ? alpha(theme.palette[tone].main, 0.18)
          : theme.palette.action.selected
        return {
          border: 0,
          backgroundColor: fill,
          color: tone ? theme.palette[tone].main : theme.palette.text.primary,
          '&:hover': { border: 0, backgroundColor: hover },
          '&.Mui-disabled': { border: 0, backgroundColor: fill },
        }
      },
      text: ({ theme }) => ({
        '&:hover': { backgroundColor: theme.palette.action.hover },
      }),
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: ({ ownerState, theme }) => {
        const { primary, error } = theme.palette
        return {
          fontSize: 14,
          borderRadius: ownerState.multiline ? 14 : 999,
          backgroundColor: theme.palette.action.hover,
          transition: theme.transitions.create(
            ['background-color', 'box-shadow'],
            { duration: 150 },
          ),
          '& .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: 'transparent',
            transition: theme.transitions.create('border-color', {
              duration: 150,
            }),
          },
          '&:hover': { backgroundColor: theme.palette.action.selected },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'transparent',
          },
          '&.Mui-focused': {
            backgroundColor:
              theme.palette.mode === 'light' ? '#FFFFFF' : 'transparent',
            boxShadow: focusRing(primary.main),
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: primary.main,
          },
          '&.Mui-error': { boxShadow: focusRing(error.main) },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': {
            borderColor: error.main,
          },
          '&.Mui-disabled': {
            opacity: 0.5,
            backgroundColor: theme.palette.action.hover,
          },
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': {
            borderColor: 'transparent',
          },
        }
      },
      input: ({ ownerState }) => {
        if (ownerState.multiline) return {}
        const inset = ownerState.size === 'small' ? 14 : 16
        return {
          boxSizing: 'border-box',
          height: ownerState.size === 'small' ? 36 : 44,
          paddingTop: 0,
          paddingBottom: 0,
          paddingLeft: ownerState.startAdornment ? 0 : inset,
          paddingRight: ownerState.endAdornment ? 0 : inset,
        }
      },
      adornedStart: { paddingLeft: 16 },
      adornedEnd: { paddingRight: 6 },
      multiline: { padding: '12px 16px' },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: ({ theme }) => ({
        margin: 16,
        borderRadius: 22,
        backgroundImage: 'none',
        backgroundColor: theme.palette.mode === 'light' ? '#FFFFFF' : '#393B4A',
        boxShadow:
          theme.palette.mode === 'light'
            ? '0 24px 64px rgba(0, 0, 0, 0.18), 0 4px 14px rgba(0, 0, 0, 0.08) !important'
            : '0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 0.5px rgba(255, 255, 255, 0.1) !important',
        animation: `${dialogIn} 340ms cubic-bezier(0.34, 1.36, 0.64, 1)`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }),
      backdrop: ({ theme }) => ({
        backgroundColor:
          theme.palette.mode === 'light'
            ? 'rgba(0, 0, 0, 0.26)'
            : 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(6px)',
      }),
    },
  },
  MuiDialogTitle: {
    styleOverrides: {
      root: {
        padding: '24px 24px 6px',
        fontSize: 17,
        fontWeight: 650,
        lineHeight: 1.4,
        letterSpacing: '-0.01em',
      },
    },
  },
  MuiDialogContent: { styleOverrides: { root: { padding: '0 24px' } } },
  MuiDialogContentText: { styleOverrides: { root: { fontSize: 14 } } },
  MuiDialogActions: {
    styleOverrides: {
      root: {
        padding: '22px 20px 20px',
        gap: 8,
        '& > :not(style) ~ :not(style)': { marginLeft: 0 },
        '& > .MuiButton-root': { flex: 1, height: 40 },
      },
    },
  },
  MuiIconButton: {
    defaultProps: { disableRipple: true },
    styleOverrides: {
      root: ({ theme }) => ({
        color: theme.palette.mode === 'light' ? '#8E8E93' : '#A1A1A6',
        backgroundColor: 'transparent',
        borderRadius: 999,
        transition: theme.transitions.create(['color', 'background-color'], {
          duration: 150,
        }),
        '&:hover, &.Mui-focusVisible': {
          color: theme.palette.mode === 'light' ? '#191C1D' : '#F5F5F5',
          backgroundColor: alpha(
            theme.palette.mode === 'light' ? '#000000' : '#FFFFFF',
            0.05,
          ),
        },
        '&.Mui-disabled': {
          color: theme.palette.action.disabled,
          backgroundColor: 'transparent',
        },
      }),
    },
  },
  MuiTooltip: {
    defaultProps: {
      arrow: false,
      enterDelay: 500,
      enterNextDelay: 100,
      slotProps: { transition: { timeout: 150 } },
    },
    styleOverrides: {
      tooltip: {
        backgroundColor: '#191C1D',
        color: '#FAFAFA',
        border: '1px solid #303334',
        borderRadius: 11,
        padding: '5px 12px',
        fontSize: 13,
        fontWeight: 400,
        lineHeight: '18px',
        maxWidth: 320,
        // Keeps a lone character from ending up on its own line.
        textWrap: 'balance',
        // Global CSS suppresses shadows, but tooltips need elevation.
        boxShadow:
          '0 8px 24px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.12) !important',
      },
      arrow: { display: 'none' },
      tooltipPlacementTop: { margin: '8px 0 !important' },
      tooltipPlacementBottom: { margin: '8px 0 !important' },
      tooltipPlacementLeft: { margin: '0 8px !important' },
      tooltipPlacementRight: { margin: '0 8px !important' },
    },
  },
  MuiCircularProgress: {
    defaultProps: { enableTrackSlot: true, thickness: 4 },
    styleOverrides: {
      track: ({ ownerState, theme }) =>
        ownerState.color === 'inherit'
          ? {}
          : { stroke: theme.palette.divider, opacity: 1 },
    },
  },
}

const canUseCssScope = () => {
  if (cssScopeSupport !== null) {
    return cssScopeSupport
  }
  try {
    const testStyle = document.createElement('style')
    testStyle.textContent = '@scope (:root) { }'
    document.head.appendChild(testStyle)
    cssScopeSupport = !!testStyle.sheet?.cssRules?.length
    document.head.removeChild(testStyle)
  } catch {
    cssScopeSupport = false
  }
  return cssScopeSupport
}

const wrapCssInjectionWithScope = (css?: string) => {
  if (!css?.trim()) {
    return ''
  }
  const lowerCss = css.toLowerCase()
  const hasTopLevelOnlyRule = TOP_LEVEL_AT_RULES.some((rule) =>
    lowerCss.includes(rule),
  )
  if (hasTopLevelOnlyRule) {
    return null
  }
  const scopeRoot = CSS_INJECTION_SCOPE_ROOT
  const scopeLimit = CSS_INJECTION_SCOPE_LIMIT
  const scopedBlock = `@scope (${scopeRoot}) to (${scopeLimit}) {
${css}
}`
  return scopedBlock
}

/**
 * custom theme
 */
// The speed and purity scales step from green to red through these two. MUI derives light and
// dark shades only for its own palette keys, and the pills colour their text with those shades.
const SCALE_COLORS = {
  light: {
    lime: { main: '#65A30D', light: '#A3E635', dark: '#4D7C0F' },
    yellow: { main: '#CA8A04', light: '#FACC15', dark: '#A16207' },
  },
  dark: {
    lime: { main: '#A3E635', light: '#BEF264', dark: '#65A30D' },
    yellow: { main: '#FACC15', light: '#FDE047', dark: '#CA8A04' },
  },
}

export const useCustomTheme = () => {
  const appWindow: WebviewWindow = useMemo(() => getCurrentWebviewWindow(), [])
  const { verge } = useVerge()
  const { theme_mode, theme_setting } = verge ?? {}
  const mode = useThemeMode()
  const setMode = useSetThemeMode()
  const userBackgroundImage = theme_setting?.background_image || ''
  const hasUserBackground = !!userBackgroundImage

  useEffect(() => {
    if (theme_mode === 'light' || theme_mode === 'dark') {
      setMode(theme_mode)
    }
  }, [theme_mode, setMode])

  useEffect(() => {
    if (theme_mode !== 'system') {
      return
    }

    let isMounted = true

    const timerId = setTimeout(() => {
      if (!isMounted) return
      appWindow
        .theme()
        .then((systemTheme) => {
          if (isMounted && systemTheme) {
            setMode(systemTheme)
          }
        })
        .catch((err) => {
          console.error('Failed to get initial system theme:', err)
        })
    }, 0)

    const unlistenPromise = appWindow.onThemeChanged(({ payload }) => {
      if (isMounted) {
        setMode(payload)
      }
    })

    return () => {
      isMounted = false
      clearTimeout(timerId)
      unlistenPromise
        .then((unlistenFn) => {
          if (typeof unlistenFn === 'function') {
            unlistenFn()
          }
        })
        .catch((err) => {
          console.error('Failed to unlisten from theme changes:', err)
        })
    }
  }, [theme_mode, appWindow, setMode])

  useEffect(() => {
    if (theme_mode === undefined) {
      return
    }

    if (theme_mode === 'system') {
      appWindow.setTheme(null).catch((err) => {
        console.error(
          'Failed to set window theme to follow system (setTheme(null)):',
          err,
        )
      })
    } else if (mode) {
      appWindow.setTheme(mode as TauriOsTheme).catch((err) => {
        console.error(`Failed to set window theme to ${mode}:`, err)
      })
    }
  }, [mode, appWindow, theme_mode])

  const theme = useMemo(() => {
    const setting = theme_setting || {}
    const dt = mode === 'light' ? defaultTheme : defaultDarkTheme
    let muiTheme: MuiTheme

    try {
      muiTheme = createTheme({
        breakpoints: {
          values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
        },
        palette: {
          mode,
          primary: { main: setting.primary_color || dt.primary_color },
          secondary: { main: setting.secondary_color || dt.secondary_color },
          info: { main: setting.info_color || dt.info_color },
          error: { main: setting.error_color || dt.error_color },
          warning: { main: setting.warning_color || dt.warning_color },
          success: { main: setting.success_color || dt.success_color },
          ...SCALE_COLORS[mode],
          text: {
            primary: setting.primary_text || dt.primary_text,
            secondary: setting.secondary_text || dt.secondary_text,
          },
          background: {
            paper: dt.background_color,
            default: dt.background_color,
          },
        },
        shadows: Array(25).fill('none') as Shadows,
        components,
        typography: {
          fontFamily: setting.font_family
            ? `${setting.font_family}, ${dt.font_family}`
            : dt.font_family,
        },
      })
    } catch (e) {
      console.error('Error creating MUI theme, falling back to defaults:', e)
      muiTheme = createTheme({
        breakpoints: {
          values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
        },
        palette: {
          mode,
          primary: { main: dt.primary_color },
          secondary: { main: dt.secondary_color },
          info: { main: dt.info_color },
          error: { main: dt.error_color },
          warning: { main: dt.warning_color },
          success: { main: dt.success_color },
          ...SCALE_COLORS[mode],
          text: { primary: dt.primary_text, secondary: dt.secondary_text },
          background: {
            paper: dt.background_color,
            default: dt.background_color,
          },
        },
        components,
        typography: { fontFamily: dt.font_family },
      })
    }

    const rootEle = document.documentElement
    if (rootEle) {
      const backgroundColor = mode === 'light' ? '#ECECEC' : dt.background_color
      const selectColor = mode === 'light' ? '#f5f5f5' : '#3E3E3E'
      const scrollColor = mode === 'light' ? '#90939980' : '#555555'
      const dividerColor =
        mode === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)'
      rootEle.style.setProperty('--divider-color', dividerColor)
      rootEle.style.setProperty('--background-color', backgroundColor)
      rootEle.style.setProperty('--selection-color', selectColor)
      rootEle.style.setProperty('--scroller-color', scrollColor)
      rootEle.style.setProperty('--primary-main', muiTheme.palette.primary.main)
      rootEle.style.setProperty(
        '--background-color-alpha',
        alpha(muiTheme.palette.primary.main, 0.1),
      )
      rootEle.style.setProperty(
        '--window-border-color',
        mode === 'light' ? '#cccccc' : '#1E1E1E',
      )
      rootEle.style.setProperty(
        '--scrollbar-bg',
        mode === 'light' ? '#f1f1f1' : '#2E303D',
      )
      rootEle.style.setProperty(
        '--scrollbar-thumb',
        mode === 'light' ? '#c1c1c1' : '#555555',
      )
      rootEle.style.setProperty(
        '--user-background-image',
        hasUserBackground ? `url('${userBackgroundImage}')` : 'none',
      )
      rootEle.style.setProperty(
        '--background-blend-mode',
        setting.background_blend_mode || 'normal',
      )
      rootEle.style.setProperty(
        '--background-opacity',
        setting.background_opacity !== undefined
          ? String(setting.background_opacity)
          : '1',
      )
      rootEle.setAttribute('data-css-injection-root', 'true')
    }

    let styleElement = document.querySelector('style#verge-theme')
    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = 'verge-theme'
      document.head.appendChild(styleElement!)
    }

    if (styleElement) {
      let scopedCss: string | null = null
      if (canUseCssScope() && setting.css_injection) {
        scopedCss = wrapCssInjectionWithScope(setting.css_injection)
      }
      const effectiveInjectedCss = scopedCss ?? setting.css_injection ?? ''
      const globalStyles = `
        /* 修复滚动条样式 */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
          background-color: var(--scrollbar-bg);
        }
        ::-webkit-scrollbar-thumb {
          background-color: var(--scrollbar-thumb);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background-color: ${mode === 'light' ? '#a1a1a1' : '#666666'};
        }

        /* 背景图处理 */
        body {
          font-family: ${dt.font_family};
          background-color: var(--background-color);
          ${
            hasUserBackground
              ? `
            background-image: var(--user-background-image);
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-blend-mode: var(--background-blend-mode);
            opacity: var(--background-opacity);
          `
              : ''
          }
        }

        /* 修复可能的白色边框 */
        .MuiPaper-root {
          border-color: var(--window-border-color) !important;
        }

        /* 移除可能的白色点或线条 */
        * {
          outline: none !important;
          box-shadow: none !important;
        }
      `

      styleElement.innerHTML = effectiveInjectedCss + globalStyles
    }

    return muiTheme
  }, [mode, theme_setting, userBackgroundImage, hasUserBackground])

  useEffect(() => {
    const id = setTimeout(() => {
      const dom = document.querySelector('#Gradient2')
      if (dom) {
        dom.innerHTML = `
        <stop offset="0%" stop-color="${theme.palette.primary.main}" />
        <stop offset="80%" stop-color="${theme.palette.primary.dark}" />
        <stop offset="100%" stop-color="${theme.palette.primary.dark}" />
        `
      }
    }, 0)
    return () => clearTimeout(id)
  }, [theme.palette.primary.main, theme.palette.primary.dark])

  return { theme }
}
