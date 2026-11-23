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
import getSystem from '@/utils/get-system'

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

// Glass needs macOS window vibrancy; elsewhere the window stays solid.
export const isGlassMode = (enableGlass?: boolean) =>
  enableGlass === true && getSystem() === 'macos'

// Warm neutrals modelled on Claude's desktop app. Primary actions use ink (near-black, or
// near-white in dark mode) instead of a brand colour.
export const UI_TOKENS = {
  light: {
    bg: '#FAF9F5',
    surface: '#FFFFFF',
    raised: '#FFFFFF',
    fill: 'rgba(31, 30, 29, 0.06)',
    fillHover: 'rgba(31, 30, 29, 0.1)',
    line: 'rgba(31, 30, 29, 0.12)',
    lineStrong: 'rgba(31, 30, 29, 0.22)',
    tooltip: '#141413',
    tooltipText: '#FAF9F5',
  },
  dark: {
    bg: '#1F1E1D',
    surface: '#262624',
    raised: '#30302E',
    fill: 'rgba(236, 234, 228, 0.07)',
    fillHover: 'rgba(236, 234, 228, 0.12)',
    line: 'rgba(236, 234, 228, 0.1)',
    lineStrong: 'rgba(236, 234, 228, 0.2)',
    tooltip: '#3A3A37',
    tooltipText: '#ECEAE4',
  },
} as const

const TONED_COLORS = ['error', 'warning', 'success', 'info'] as const

const dialogIn = keyframes`
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: none; }
`

// Global CSS strips every box-shadow, so focus rings and elevation below need !important.
const createComponents = (
  mode: 'light' | 'dark',
): ThemeOptions['components'] => {
  const ui = UI_TOKENS[mode]
  const light = mode === 'light'
  return {
    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: true },
      styleOverrides: {
        root: ({ theme }) => ({
          textTransform: 'none',
          height: 36,
          padding: '0 16px',
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          transition: theme.transitions.create(['background-color', 'color'], {
            duration: 120,
          }),
          '&.Mui-focusVisible': {
            boxShadow: `0 0 0 2px ${ui.bg}, 0 0 0 3.5px ${alpha(theme.palette.text.primary, 0.5)} !important`,
          },
        }),
        sizeLarge: { height: 44, padding: '0 22px', fontSize: 15 },
        sizeSmall: { height: 28, padding: '0 12px', fontSize: 13 },
        contained: ({ ownerState, theme }) => {
          if (ownerState.color === 'inherit') return {}
          const palette = theme.palette[ownerState.color ?? 'primary']
          return {
            '&:hover': { backgroundColor: alpha(palette.main, 0.86) },
            // Busy buttons stay disabled while a progress ring runs inside, so the label must stay legible.
            '&.Mui-disabled': {
              backgroundColor: alpha(palette.main, 0.45),
              color: alpha(palette.contrastText, 0.9),
            },
          }
        },
        // Outlined is the secondary action: a flat neutral fill instead of a border.
        outlined: ({ ownerState, theme }) => {
          const tone = TONED_COLORS.find((name) => name === ownerState.color)
          const color = tone ? theme.palette[tone].main : undefined
          return {
            border: 0,
            backgroundColor: color ? alpha(color, 0.1) : ui.fill,
            color: color ?? theme.palette.text.primary,
            '&:hover': {
              border: 0,
              backgroundColor: color ? alpha(color, 0.16) : ui.fillHover,
            },
            '&.Mui-disabled': { border: 0, opacity: 0.45 },
          }
        },
        text: { '&:hover': { backgroundColor: ui.fill } },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontSize: 14,
          borderRadius: 8,
          backgroundColor: ui.fill,
          transition: theme.transitions.create('background-color', {
            duration: 120,
          }),
          '& .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: 'transparent',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'transparent',
          },
          '&.Mui-focused': { backgroundColor: 'transparent' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: ui.lineStrong,
          },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': {
            borderColor: alpha(theme.palette.error.main, 0.6),
          },
          '&.Mui-disabled': { opacity: 0.5 },
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': {
            borderColor: 'transparent',
          },
        }),
        input: ({ ownerState }) => {
          if (ownerState.multiline) return {}
          return {
            boxSizing: 'border-box',
            height: ownerState.size === 'small' ? 32 : 36,
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: ownerState.startAdornment ? 0 : 12,
            paddingRight: ownerState.endAdornment ? 0 : 12,
          }
        },
        adornedStart: { paddingLeft: 12 },
        adornedEnd: { paddingRight: 6 },
        multiline: { padding: '10px 12px' },
      },
    },
    MuiMenu: {
      styleOverrides: {
        // Sized to the 32px button and 14px text scale, like a native macOS menu.
        paper: {
          marginTop: 4,
          minWidth: 180,
          borderRadius: 12,
          backgroundImage: 'none',
          backgroundColor: ui.raised,
          // Global CSS forces every Paper to the window border color.
          '&.MuiMenu-paper': {
            border: '0.5px solid',
            borderColor: `${ui.line} !important`,
          },
          '[data-glass] &': {
            backgroundColor: light
              ? 'rgba(255, 255, 255, 0.82)'
              : 'rgba(48, 48, 46, 0.82)',
            backdropFilter: 'blur(40px) saturate(180%)',
          },
          boxShadow: light
            ? '0 8px 24px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06) !important'
            : '0 8px 24px rgba(0, 0, 0, 0.5) !important',
        },
        list: {
          padding: 5,
          // Inset to line up with the item labels.
          '& .MuiDivider-root': { margin: '5px 10px', borderColor: ui.line },
        },
      },
    },
    MuiMenuItem: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        // MUI resets minHeight to auto from the sm breakpoint up, so padding sets the 32px row.
        root: {
          minHeight: 0,
          padding: '5px 10px',
          borderRadius: 6,
          fontSize: 14,
          lineHeight: '22px',
          '&:hover, &.Mui-focusVisible': { backgroundColor: ui.fill },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          margin: 16,
          borderRadius: 12,
          backgroundImage: 'none',
          backgroundColor: ui.raised,
          // Global CSS forces every Paper to the window border color.
          '&.MuiDialog-paper': {
            border: '0.5px solid',
            borderColor: `${ui.line} !important`,
          },
          '[data-glass] &': {
            backgroundColor: light
              ? 'rgba(255, 255, 255, 0.82)'
              : 'rgba(48, 48, 46, 0.82)',
            backdropFilter: 'blur(40px) saturate(180%)',
          },
          boxShadow: light
            ? '0 8px 28px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06) !important'
            : '0 8px 28px rgba(0, 0, 0, 0.5) !important',
          animation: `${dialogIn} 150ms ease-out`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        },
        backdrop: {
          backgroundColor: light ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.5)',
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          padding: '20px 20px 8px',
          fontSize: 16,
          fontWeight: 500,
          lineHeight: 1.4,
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: '0 20px',
          fontSize: 14,
          lineHeight: 1.55,
          color: alpha(theme.palette.text.primary, 0.85),
        }),
      },
    },
    MuiDialogContentText: { styleOverrides: { root: { fontSize: 14 } } },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: '20px 16px 16px',
          gap: 8,
          '& > :not(style) ~ :not(style)': { marginLeft: 0 },
        },
      },
    },
    MuiIconButton: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        sizeMedium: { padding: 7 },
        root: ({ theme }) => ({
          color: theme.palette.text.secondary,
          backgroundColor: 'transparent',
          borderRadius: 8,
          transition: theme.transitions.create(['color', 'background-color'], {
            duration: 120,
          }),
          '&:hover, &.Mui-focusVisible': {
            color: theme.palette.text.primary,
            backgroundColor: ui.fill,
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
        slotProps: { transition: { timeout: 120 } },
      },
      styleOverrides: {
        tooltip: {
          backgroundColor: ui.tooltip,
          color: ui.tooltipText,
          borderRadius: 12,
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 400,
          lineHeight: '18px',
          maxWidth: 320,
          // Keeps a lone character from ending up on its own line.
          textWrap: 'balance',
          // Global CSS suppresses shadows, but tooltips need elevation.
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15) !important',
        },
        arrow: { display: 'none' },
        tooltipPlacementTop: { margin: '6px 0 !important' },
        tooltipPlacementBottom: { margin: '6px 0 !important' },
        tooltipPlacementLeft: { margin: '0 6px !important' },
        tooltipPlacementRight: { margin: '0 6px !important' },
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
    lime: { main: '#5E8A1F', light: '#7FA83A', dark: '#4A6E18' },
    yellow: { main: '#A87A0A', light: '#C9971F', dark: '#86610A' },
  },
  dark: {
    lime: { main: '#A6C45C', light: '#BCD37C', dark: '#86A23F' },
    yellow: { main: '#D8B449', light: '#E3C66E', dark: '#B8962F' },
  },
}

export const useCustomTheme = () => {
  const appWindow: WebviewWindow = useMemo(() => getCurrentWebviewWindow(), [])
  const { verge } = useVerge()
  const { theme_mode, theme_setting, enable_glass } = verge ?? {}
  const mode = useThemeMode()
  const setMode = useSetThemeMode()
  const glass = isGlassMode(enable_glass)
  const followsSystem = theme_mode === 'system'
  const userBackgroundImage = theme_setting?.background_image || ''
  const hasUserBackground = !!userBackgroundImage

  useEffect(() => {
    if (theme_mode === 'light' || theme_mode === 'dark') {
      setMode(theme_mode)
    }
  }, [theme_mode, setMode])

  useEffect(() => {
    if (!followsSystem) {
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
  }, [followsSystem, appWindow, setMode])

  useEffect(() => {
    if (theme_mode === undefined) {
      return
    }

    if (followsSystem) {
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
  }, [mode, appWindow, theme_mode, followsSystem])

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
          background: glass
            ? {
                paper:
                  mode === 'light'
                    ? 'rgba(255, 255, 255, 0.5)'
                    : 'rgba(255, 255, 255, 0.06)',
                default: 'transparent',
              }
            : {
                paper: UI_TOKENS[mode].surface,
                default: dt.background_color,
              },
          divider: UI_TOKENS[mode].line,
          action: {
            hover: UI_TOKENS[mode].fill,
            selected: UI_TOKENS[mode].fillHover,
          },
        },
        shadows: Array(25).fill('none') as Shadows,
        components: createComponents(mode),
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
          background: glass
            ? {
                paper:
                  mode === 'light'
                    ? 'rgba(255, 255, 255, 0.5)'
                    : 'rgba(255, 255, 255, 0.06)',
                default: 'transparent',
              }
            : {
                paper: UI_TOKENS[mode].surface,
                default: dt.background_color,
              },
          divider: UI_TOKENS[mode].line,
          action: {
            hover: UI_TOKENS[mode].fill,
            selected: UI_TOKENS[mode].fillHover,
          },
        },
        components: createComponents(mode),
        typography: { fontFamily: dt.font_family },
      })
    }

    const rootEle = document.documentElement
    if (rootEle) {
      const backgroundColor = glass ? 'transparent' : dt.background_color
      const selectColor = mode === 'light' ? '#f5f5f5' : '#3E3E3E'
      const scrollColor = mode === 'light' ? '#90939980' : '#555555'
      const dividerColor = UI_TOKENS[mode].line
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
        glass ? 'transparent' : dt.background_color,
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
      rootEle.toggleAttribute('data-glass', glass)
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
  }, [mode, glass, theme_setting, userBackgroundImage, hasUserBackground])

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
