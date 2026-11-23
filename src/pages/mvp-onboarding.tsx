import {
  Box,
  Button,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { keyframes } from '@mui/material/styles'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  CornerDownLeftIcon,
  GlobeIcon,
  MoonIcon,
  ScanLineIcon,
  SunIcon,
  XIcon,
} from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

import LogoSvg from '@/assets/image/logo.svg?react'
import { MvpProgressRing } from '@/components/mvp/mvp-progress-ring'
import { QrScannerDialog } from '@/components/mvp/qr-scanner-dialog'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { testMainGroup, useMainProxyGroup } from '@/hooks/use-main-proxy-group'
import { useMvpShortcuts } from '@/hooks/use-mvp-shortcuts'
import { fetchProfilesIntoCache, useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useVerge } from '@/hooks/use-verge'
import { useAppRefreshers } from '@/providers/app-data-context'
import { checkAi } from '@/services/ai-check'
import {
  getPreflightReport,
  getRuntimeState,
  installService,
  recheckConnectionHealth,
  reinstallService,
  repairService,
} from '@/services/cmds'
import delayManager from '@/services/delay'
import { resolveLanguage } from '@/services/i18n'
import {
  formatTrafficAmount,
  importAndActivateMvpProfile,
  importAndActivateMvpQrPayload,
} from '@/services/mvp'
import { connectMvpTunnel, MvpConnectionError } from '@/services/mvp-connection'
import {
  type CheckIssue,
  type CheckStepId,
  runNetworkCheck,
} from '@/services/network-check'
import { hideNotice, showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'
import { useThemeMode } from '@/services/states'
import type { InteractableProxyMember } from '@/types/proxy-view'
import { classifyDelay } from '@/utils/delay'
import getSystem from '@/utils/get-system'
import { isValidUrl } from '@/utils/network'

const OS = getSystem()

type StepId = 'welcome' | 'subscription' | 'permission' | 'connect'
type Direction = 1 | -1

const EASE = 'cubic-bezier(.2,.8,.2,1)'
// status_icon.rs fades over 10 frames with smoothstep easing.
const ICON_FADE = '300ms cubic-bezier(.45,0,.55,1)'
const STATUS_GREEN = '#34C759'

const enter = keyframes`from { opacity: 0; transform: translateX(28px); }`
const enterBack = keyframes`from { opacity: 0; transform: translateX(-28px); }`
const logoIn = keyframes`from { opacity: 0; transform: scale(.94); filter: blur(10px); }`
const drop = keyframes`from { opacity: 0; transform: translateY(-6px); }`
const breathe = keyframes`50% { opacity: .3; }`
const ripple = keyframes`
  from { opacity: .5; transform: scale(.4); }
  to { opacity: 0; transform: scale(1.6); }
`
const draw = keyframes`to { stroke-dashoffset: 0; }`

const reducedMotion = {
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none !important',
    transition: 'none !important',
  },
}

/* Page 1 mark: the logo with the status dot the menu bar and Dock icons use. */

// The logo's opaque bounds inside logo.svg; the dot sits where status_icon.rs puts it.
const LOGO = { x: 332, y: 215, width: 590, height: 811 }
const DOT = {
  cx: LOGO.x + 0.71 * LOGO.height,
  cy: LOGO.y + 0.879 * LOGO.height,
  r: 0.1227 * LOGO.height,
  gap: 0.0704 * LOGO.height,
}

type MarkPhase = 'idle' | 'ink' | 'green'

// Only the first appearance blurs in: re-blurring the masked logo while the page slides back stutters.
const OnboardingMark = ({
  phase,
  entrance,
}: {
  phase: MarkPhase
  entrance: boolean
}) => {
  const shown = phase === 'idle' ? 0 : 1
  return (
    <Box
      component="svg"
      aria-hidden
      viewBox={`${LOGO.x} ${LOGO.y} ${LOGO.width} ${LOGO.height}`}
      sx={{
        height: 96,
        width: (96 * LOGO.width) / LOGO.height,
        overflow: 'visible',
        color: 'text.primary',
        animation: entrance ? `${logoIn} 1s ${EASE} both` : 'none',
        willChange: entrance ? 'transform, opacity, filter' : 'auto',
        '& .logo path, & .logo g': { fill: 'currentColor' },
        ...reducedMotion,
      }}
    >
      <mask
        id="onboarding-dot-cut"
        maskUnits="userSpaceOnUse"
        x={LOGO.x - LOGO.height}
        y={LOGO.y - LOGO.height}
        width={LOGO.height * 3}
        height={LOGO.height * 3}
      >
        <rect
          x={LOGO.x - LOGO.height}
          y={LOGO.y - LOGO.height}
          width={LOGO.height * 3}
          height={LOGO.height * 3}
          fill="white"
        />
        <circle
          cx={DOT.cx}
          cy={DOT.cy}
          r={DOT.r + DOT.gap}
          fill="black"
          style={{ opacity: shown, transition: `opacity ${ICON_FADE}` }}
        />
      </mask>
      <g mask="url(#onboarding-dot-cut)">
        <LogoSvg className="logo" />
      </g>
      <Box
        component="circle"
        cx={DOT.cx}
        cy={DOT.cy}
        r={DOT.r}
        sx={{
          opacity: shown,
          fill: phase === 'green' ? STATUS_GREEN : 'currentColor',
          transition: `opacity ${ICON_FADE}, fill ${ICON_FADE}`,
        }}
      />
    </Box>
  )
}

/* The skeleton every step shares, so only the content changes between steps. */

const Frame = ({
  centered = false,
  direction,
  hero,
  title,
  subtitle,
  children,
}: {
  centered?: boolean
  direction: Direction
  hero: ReactNode
  title: ReactNode
  subtitle: ReactNode
  children?: ReactNode
}) => (
  <Box
    sx={{
      position: 'absolute',
      inset: centered ? '0 0 40px' : '72px 0 96px',
      px: 3,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: centered ? 'center' : 'flex-start',
      overflowY: 'auto',
      '& > *': {
        animation: `${direction === 1 ? enter : enterBack} .52s ${EASE} both`,
      },
      '& > :nth-of-type(2)': { animationDelay: '.05s' },
      '& > :nth-of-type(3)': { animationDelay: '.1s' },
      '& > :nth-of-type(4)': { animationDelay: '.15s' },
      ...reducedMotion,
    }}
  >
    <Box
      sx={{
        mt: centered ? 0 : 'clamp(8px, 7vh, 64px)',
        minHeight: centered ? 0 : 96,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {hero}
    </Box>
    <Typography
      component="h1"
      sx={{
        mt: 3.5,
        fontSize: 28,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        lineHeight: 1.25,
        textAlign: 'center',
        textWrap: 'balance',
      }}
    >
      {title}
    </Typography>
    <Typography
      color="textSecondary"
      sx={{
        mt: 1.25,
        maxWidth: 400,
        minHeight: 24,
        fontSize: 15,
        lineHeight: 1.6,
        textAlign: 'center',
        textWrap: 'pretty',
      }}
    >
      {subtitle}
    </Typography>
    {children && (
      <Box
        sx={{
          mt: 4,
          width: 440,
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {children}
      </Box>
    )}
  </Box>
)

const strokeIcon = {
  width: 64,
  height: 64,
  viewBox: '0 0 64 64',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.25,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const SPRING = 'cubic-bezier(.34,1.56,.64,1)'

/** Two links that snap together once a subscription is in. */
const LinkHero = ({ linked }: { linked: boolean }) => (
  <Box
    component="svg"
    aria-hidden
    {...strokeIcon}
    sx={{
      '& path': { transition: `transform .45s ${SPRING}, opacity .3s` },
      '& .a': { transform: linked ? 'none' : 'translate(4px,-4px)' },
      '& .b': { transform: linked ? 'none' : 'translate(-4px,4px)' },
      '& .mid': {
        opacity: linked ? 1 : 0,
        transform: linked ? 'none' : 'scale(.6)',
        transformOrigin: '32px 32px',
      },
      ...reducedMotion,
    }}
  >
    <path className="a" d="M29 21l4.5-4.5a9 9 0 0 1 12.7 12.7L41.7 33.7" />
    <path className="b" d="M35 43l-4.5 4.5a9 9 0 0 1-12.7-12.7l4.5-4.5" />
    <path className="mid" d="M26.5 37.5l11-11" />
  </Box>
)

/** A lock whose shackle lifts and whose keyhole turns into a tick once permission is given. */
const LockHero = ({ open }: { open: boolean }) => (
  <Box
    component="svg"
    aria-hidden
    {...strokeIcon}
    sx={{
      '& .shackle': {
        transition: `transform .5s ${SPRING}`,
        transform: open ? 'translateY(-6px)' : 'none',
      },
      '& .hole': { transition: 'opacity .2s', opacity: open ? 0 : 1 },
      '& .body': {
        transition: 'stroke .3s',
        stroke: (theme) => (open ? theme.palette.success.main : undefined),
      },
      '& .tick': {
        stroke: (theme) => theme.palette.success.main,
        strokeDasharray: 24,
        strokeDashoffset: 24,
        animation: open ? `${draw} .4s .15s ${EASE} forwards` : 'none',
      },
      ...reducedMotion,
    }}
  >
    <path className="shackle" d="M22 28v-6a10 10 0 0 1 20 0v6" />
    <rect className="body" x="15" y="28" width="34" height="24" rx="6" />
    <path className="hole" d="M32 37v6" />
    <path className="tick" d="M25.5 40l4.5 4.5 8.5-8.5" />
  </Box>
)

const Pill = ({
  tone,
  pulse = false,
  children,
  title,
}: {
  tone: 'neutral' | 'success' | 'warning'
  pulse?: boolean
  children: ReactNode
  title?: string
}) => (
  <Box
    component="span"
    title={title}
    sx={(theme) => ({
      height: 28,
      px: 1.5,
      borderRadius: 999,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 1,
      fontSize: 13,
      fontWeight: 500,
      whiteSpace: 'nowrap',
      cursor: title ? 'help' : 'default',
      animation: `${drop} .4s ${EASE} both`,
      transition: 'background-color .3s, color .3s',
      ...(tone === 'neutral'
        ? { bgcolor: 'action.hover', color: 'text.secondary' }
        : {
            bgcolor: `color-mix(in srgb, ${theme.palette[tone].main} ${
              theme.palette.mode === 'dark' ? 16 : 10
            }%, transparent)`,
            color: `${tone}.main`,
          }),
      '& .dot': {
        width: 7,
        height: 7,
        borderRadius: '50%',
        bgcolor: 'currentColor',
        animation: pulse ? `${breathe} 1.1s ease-in-out infinite` : 'none',
      },
      ...reducedMotion,
    })}
  >
    <span className="dot" />
    {children}
  </Box>
)

/* Step 2: subscription */

const SubscriptionCard = ({
  profile,
  nodeCount,
  fresh,
}: {
  profile: IProfileItem
  nodeCount: number
  /** Just imported; a card the user comes back to slides in with the page instead. */
  fresh: boolean
}) => {
  const { t, i18n } = useTranslation()
  const {
    upload = 0,
    download = 0,
    total = 0,
    expire = 0,
  } = profile.extra ?? {}
  const remaining =
    total > 0
      ? formatTrafficAmount(
          Math.max(0, total - upload - download),
          i18n.language,
        )
      : undefined
  const date = expire
    ? dayjs.unix(expire).format(t('mvp.subscriptions.updated.dateFormat'))
    : undefined
  const usage =
    remaining && date
      ? t('mvp.check.details.subscriptionUsage', { remaining, date })
      : remaining
        ? t('mvp.check.details.subscriptionRemaining', { remaining })
        : date
          ? t('mvp.check.details.subscriptionExpire', { date })
          : null
  const details = [
    usage,
    nodeCount > 0
      ? t('mvp.onboarding.subscription.nodes', { count: nodeCount })
      : null,
  ].filter(Boolean)

  return (
    <Box
      sx={{
        width: '100%',
        minHeight: 72,
        px: 2.5,
        py: 1.5,
        borderRadius: '14px',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        animation: fresh ? `${drop} .45s ${EASE} both` : 'none',
        ...reducedMotion,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontSize: 15, fontWeight: 600 }}>
          {profile.name || t('mvp.subscriptions.fallbackName')}
        </Typography>
        {details.length > 0 && (
          <Typography
            noWrap
            color="textSecondary"
            sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
          >
            {details.join(' · ')}
          </Typography>
        )}
      </Box>
      <Box sx={{ color: 'success.main', display: 'flex' }}>
        <CheckIcon size={20} strokeWidth={2} />
      </Box>
    </Box>
  )
}

const ClipboardNotice = ({
  label,
  action,
  onUse,
}: {
  label: string
  action: string
  onUse: () => void
}) => (
  <Box
    component="span"
    sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
  >
    {label}
    <Button
      size="small"
      variant="contained"
      onClick={onUse}
      sx={{ height: 24, minWidth: 0, px: 1.25, fontSize: 12.5 }}
    >
      {action}
    </Button>
  </Box>
)

const SubscriptionStep = ({
  direction,
  profile,
  nodeCount,
  onImported,
}: {
  direction: Direction
  profile?: IProfileItem
  nodeCount: number
  onImported: () => Promise<void>
}) => {
  const { t } = useTranslation()
  const [replacing, setReplacing] = useState(false)
  const [imported, setImported] = useState(false)
  const [url, setUrl] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [importing, setImporting] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const clipboardNoticeRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editing = !profile || replacing
  const typing = url.trim().length > 0

  const dismissClipboard = useCallback(() => {
    if (clipboardNoticeRef.current === null) return
    hideNotice(clipboardNoticeRef.current)
    clipboardNoticeRef.current = null
  }, [])

  const runImport = useLockFn(
    async (work: () => Promise<unknown>, fromQr = false) => {
      dismissClipboard()
      setImporting(true)
      try {
        await work()
        await onImported()
        setImported(true)
        setReplacing(false)
        setUrl('')
        showNotice.success(
          t(
            fromQr
              ? 'mvp.home.notices.qrImportSuccess'
              : 'mvp.home.notices.importSuccess',
          ),
        )
      } catch (error) {
        console.error('[Proxy MVP] Onboarding import failed:', error)
        showNotice.error(
          t(fromQr ? 'mvp.common.invalidQr' : 'mvp.home.notices.importFailed'),
        )
      } finally {
        setImporting(false)
      }
    },
  )

  const submit = (value: string) => {
    const link = value.trim()
    if (!link) return
    if (!isValidUrl(link)) {
      setInvalid(true)
      showNotice.error(t('mvp.onboarding.subscription.invalid'))
      return
    }
    void runImport(() => importAndActivateMvpProfile(link))
  }

  const offerClipboard = useEffectEvent((text: string) => {
    if (!isValidUrl(text) || text === profile?.url) return
    if (inputRef.current?.value) return
    clipboardNoticeRef.current = showNotice.info(
      <ClipboardNotice
        label={t('mvp.onboarding.subscription.clipboard')}
        action={t('mvp.onboarding.subscription.useClipboard')}
        onUse={() => {
          dismissClipboard()
          setUrl(text)
          submit(text)
        }}
      />,
      0,
    )
  })

  // A link already on the clipboard is offered once each time the input appears.
  useEffect(() => {
    if (!editing) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const text = (await readText().catch(() => '')).trim()
      if (!cancelled) offerClipboard(text)
    }, 700)
    return () => {
      cancelled = true
      clearTimeout(timer)
      dismissClipboard()
    }
  }, [dismissClipboard, editing])

  return (
    <Frame
      direction={direction}
      hero={<LinkHero linked={!editing} />}
      title={t('mvp.onboarding.subscription.title')}
      subtitle={t('mvp.onboarding.subscription.subtitle')}
    >
      {editing ? (
        <TextField
          fullWidth
          autoFocus
          inputRef={inputRef}
          value={url}
          error={invalid}
          disabled={importing}
          placeholder="https://example.com/subscription"
          type="url"
          onChange={(event) => {
            setUrl(event.target.value)
            setInvalid(false)
            if (event.target.value) dismissClipboard()
          }}
          onPaste={(event) => {
            // A paste is a whole link, so it imports at once; typed text waits for Enter.
            const pasted = event.clipboardData.getData('text')
            if (pasted && !url) {
              event.preventDefault()
              setUrl(pasted.trim())
              submit(pasted)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.stopPropagation()
              submit(url)
            }
          }}
          slotProps={{
            htmlInput: {
              'aria-label': t('mvp.onboarding.subscription.label'),
            },
            input: {
              endAdornment: (
                <Tooltip
                  title={
                    importing
                      ? ''
                      : typing
                        ? t('mvp.onboarding.subscription.import')
                        : t('mvp.common.scanQr')
                  }
                >
                  <span>
                    <IconButton
                      size="small"
                      disabled={importing}
                      aria-label={
                        typing
                          ? t('mvp.onboarding.subscription.import')
                          : t('mvp.common.scanQr')
                      }
                      onClick={() => (typing ? submit(url) : setQrOpen(true))}
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '6px',
                        display: 'grid',
                        color: typing ? 'text.primary' : 'text.secondary',
                        '& > *': {
                          gridArea: '1 / 1',
                          transition: `opacity .18s, transform .25s ${EASE}`,
                        },
                        ...reducedMotion,
                      }}
                    >
                      {importing ? (
                        <MvpProgressRing size={14} />
                      ) : (
                        <>
                          <ScanLineIcon
                            size={17}
                            style={{
                              opacity: typing ? 0 : 1,
                              transform: typing ? 'scale(.6)' : 'none',
                            }}
                          />
                          <CornerDownLeftIcon
                            size={17}
                            style={{
                              opacity: typing ? 1 : 0,
                              transform: typing
                                ? 'none'
                                : 'scale(.6) translateX(4px)',
                            }}
                          />
                        </>
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              ),
            },
          }}
        />
      ) : (
        profile && (
          <>
            <SubscriptionCard
              profile={profile}
              nodeCount={nodeCount}
              fresh={imported}
            />
            <Button
              size="small"
              color="inherit"
              onClick={() => setReplacing(true)}
              sx={{ mt: 1.5, color: 'text.secondary' }}
            >
              {t('mvp.onboarding.subscription.change')}
            </Button>
          </>
        )
      )}
      {qrOpen && (
        <QrScannerDialog
          open
          onClose={() => setQrOpen(false)}
          onDetected={(payload) => {
            setQrOpen(false)
            void runImport(() => importAndActivateMvpQrPayload(payload), true)
          }}
        />
      )}
    </Frame>
  )
}

/* Step 3: permission */

type Preflight = 'checking' | 'clear' | 'blocked'

const PermissionStep = ({
  direction,
  granted,
  preflight,
  blocker,
  onRecheck,
}: {
  direction: Direction
  granted: boolean
  preflight: Preflight
  blocker: string | null
  onRecheck: () => void
}) => {
  const { t } = useTranslation()
  return (
    <Frame
      direction={direction}
      hero={<LockHero open={granted} />}
      title={t('mvp.onboarding.permission.title')}
      subtitle={
        <>
          {t('mvp.onboarding.permission.body')}
          <br />
          {t('mvp.onboarding.permission.password')}
        </>
      }
    >
      {preflight === 'checking' ? (
        <Pill tone="neutral" pulse>
          {t('mvp.onboarding.permission.checking')}
        </Pill>
      ) : preflight === 'blocked' ? (
        <Pill tone="warning">
          {blocker}
          <Button
            size="small"
            color="inherit"
            onClick={onRecheck}
            sx={{ height: 22, minWidth: 0, px: 1, mr: -1, fontSize: 12.5 }}
          >
            {t('mvp.home.blockers.recheck')}
          </Button>
        </Pill>
      ) : (
        <Pill tone="success">{t('mvp.onboarding.permission.clear')}</Pill>
      )}
    </Frame>
  )
}

/* Step 4: connect */

const CHAIN = ['device', 'network', 'node', 'sites'] as const
type ChainStep = (typeof CHAIN)[number]
type ChainState = 'pending' | 'active' | 'done' | 'error'

// The subscription check is folded into the node segment: both mean the node cannot carry traffic.
const chainStepOf = (step: CheckStepId): ChainStep =>
  step === 'subscription' ? 'node' : step

const NODE_ISSUES = new Set<CheckIssue>([
  'nodeDown',
  'sitesDown',
  'foreignDown',
])

const Chain = ({
  states,
  nodeLabel,
}: {
  states: Record<ChainStep, ChainState>
  nodeLabel?: string
}) => {
  const { t } = useTranslation()
  const lastDone = CHAIN.reduce(
    (last, step, index) => (states[step] === 'done' ? index : last),
    -1,
  )
  const failed = CHAIN.findIndex((step) => states[step] === 'error')
  const xs = [12, 150.7, 289.3, 428]
  const span = 416
  const litTo = failed > 0 ? failed - 1 : lastDone
  return (
    <Box sx={{ width: 440, maxWidth: '100%' }}>
      <Box
        component="svg"
        aria-hidden
        viewBox="0 0 440 24"
        preserveAspectRatio="none"
        sx={(theme) => ({
          display: 'block',
          width: '100%',
          height: 24,
          overflow: 'visible',
          '& line': { strokeWidth: 2 },
          '& .track': { stroke: theme.palette.divider },
          '& .lit': {
            stroke: theme.palette.success.main,
            transition: 'stroke-dashoffset .5s linear',
          },
          '& .bad': {
            stroke: theme.palette.error.main,
            transition: 'stroke-dashoffset .5s linear',
          },
          '& circle': {
            fill: theme.palette.background.default,
            stroke: theme.palette.divider,
            strokeWidth: 2,
            transition: 'fill .25s, stroke .25s',
          },
          '& circle.active': {
            stroke: theme.palette.text.secondary,
            animation: `${breathe} 1.1s ease-in-out infinite`,
          },
          '& circle.done': {
            fill: theme.palette.success.main,
            stroke: theme.palette.success.main,
          },
          '& circle.error': {
            fill: theme.palette.error.main,
            stroke: theme.palette.error.main,
          },
          ...reducedMotion,
        })}
      >
        <line className="track" x1={12} y1={12} x2={428} y2={12} />
        <line
          className="lit"
          x1={12}
          y1={12}
          x2={428}
          y2={12}
          strokeDasharray={span}
          strokeDashoffset={litTo > 0 ? span - (xs[litTo] - 12) : span}
        />
        {failed > 0 && (
          <line
            className="bad"
            x1={xs[failed - 1]}
            y1={12}
            x2={xs[failed]}
            y2={12}
            strokeDasharray={xs[failed] - xs[failed - 1]}
            strokeDashoffset={0}
          />
        )}
        {CHAIN.map((step, index) => (
          <circle
            key={step}
            className={states[step]}
            cx={xs[index]}
            cy={12}
            r={6}
          />
        ))}
      </Box>
      <Box
        sx={{
          mt: 1.25,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 13,
          '& span': {
            width: 96,
            textAlign: 'center',
            color: 'text.secondary',
            transition: 'color .25s',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
          '& span:first-of-type': { ml: '-36px' },
          '& span:last-of-type': { mr: '-36px' },
          '& span.on': { color: 'text.primary' },
        }}
      >
        {CHAIN.map((step) => (
          <Box
            component="span"
            key={step === 'node' ? `${step}:${nodeLabel ?? ''}` : step}
            className={states[step] === 'pending' ? '' : 'on'}
            title={step === 'node' ? nodeLabel : undefined}
            sx={
              step === 'node' && nodeLabel
                ? { animation: `${drop} .26s ease-out both` }
                : undefined
            }
          >
            {step === 'node' && nodeLabel
              ? nodeLabel
              : t(`mvp.check.steps.${step}`)}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

const HeroDot = ({ state }: { state: 'pending' | 'done' | 'error' }) => (
  <Box
    sx={(theme) => ({
      width: 18,
      height: 18,
      borderRadius: '50%',
      position: 'relative',
      transition: 'background-color .4s',
      bgcolor:
        state === 'done'
          ? 'success.main'
          : state === 'error'
            ? 'error.main'
            : 'divider',
      '&::after': {
        content: '""',
        position: 'absolute',
        inset: -14,
        borderRadius: '50%',
        border: `1.5px solid ${theme.palette.success.main}`,
        opacity: 0,
        animation: state === 'done' ? `${ripple} 1.2s ${EASE} 1` : 'none',
      },
      ...reducedMotion,
    })}
  />
)

const MenuBarHint = () => {
  const { t } = useTranslation()
  return (
    <Box
      sx={{
        mt: 2.75,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1.5,
        fontSize: 13,
        color: 'text.secondary',
        animation: `${drop} .45s .25s ${EASE} both`,
        ...reducedMotion,
      }}
    >
      <Box
        sx={{
          height: 22,
          px: 1,
          borderRadius: '5px',
          bgcolor: 'action.hover',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.875,
          '& .bar': {
            width: 22,
            height: 3,
            borderRadius: 2,
            bgcolor: 'divider',
          },
        }}
      >
        <span className="bar" />
        <Box
          sx={{
            width: 13,
            height: 13,
            position: 'relative',
            color: 'text.primary',
          }}
        >
          <Box
            component="svg"
            aria-hidden
            viewBox={`${LOGO.x} ${LOGO.y} ${LOGO.width} ${LOGO.height}`}
            sx={{
              height: 13,
              display: 'block',
              '& path, & g': { fill: 'currentColor' },
            }}
          >
            <LogoSvg />
          </Box>
          <Box
            sx={(theme) => ({
              position: 'absolute',
              right: -3,
              bottom: -2,
              width: 5,
              height: 5,
              borderRadius: '50%',
              bgcolor: STATUS_GREEN,
              boxShadow: `0 0 0 1.5px ${theme.palette.background.default}`,
            })}
          />
        </Box>
        <span className="bar" />
      </Box>
      {t(
        OS === 'macos'
          ? 'mvp.onboarding.connect.menuBar'
          : 'mvp.onboarding.connect.tray',
      )}
    </Box>
  )
}

/* The page */

const MvpOnboardingPage = () => {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { verge, patchVerge, mutateVerge } = useVerge()
  const mode = useThemeMode()
  const { profiles } = useProfiles()
  const { refreshAll } = useAppRefreshers()
  const { group, members, current, timeout } = useMainProxyGroup()
  const mixedPort = useDisplayedMixedPort()
  const aiEnabled = verge?.enable_ai_check !== false

  const availableProfiles = useMemo(
    () =>
      (profiles?.items ?? []).filter(
        (item) => item.type === 'remote' || item.type === 'local',
      ),
    [profiles?.items],
  )
  const profile =
    availableProfiles.find((item) => item.uid === profiles?.current) ??
    availableProfiles[0]
  // Reopened from Help, the user can leave at any time. The profile list may still be loading on
  // the first render, so the route says where the guide was opened from.
  const location = useLocation()
  const returning =
    (location.state as { fromHelp?: boolean } | null)?.fromHelp === true

  const [needsPermission, setNeedsPermission] = useState(true)
  useEffect(() => {
    getRuntimeState()
      .then((state) => setNeedsPermission(!state.tunCapable))
      .catch((error) => {
        console.error('[Proxy MVP] Runtime state check failed:', error)
      })
  }, [])
  const steps: StepId[] = needsPermission
    ? ['welcome', 'subscription', 'permission', 'connect']
    : ['welcome', 'subscription', 'connect']

  const [step, setStep] = useState<StepId>('welcome')
  const [direction, setDirection] = useState<Direction>(1)
  const [leaving, setLeaving] = useState(false)
  const runRef = useRef(0)
  const resetConnectRef = useRef<() => void>(() => {})
  const go = useCallback((to: StepId, dir: Direction = 1) => {
    const run = ++runRef.current
    setDirection(dir)
    setLeaving(true)
    setTimeout(() => {
      if (runRef.current !== run) return
      if (to === 'connect') resetConnectRef.current()
      setStep(to)
      setLeaving(false)
    }, 200)
  }, [])
  const index = steps.indexOf(step)
  const nextStep = steps[index + 1]
  const prevStep = steps[index - 1]

  /* Background node test: started as soon as there is a subscription, so its result is usually in
     by the time the user reaches the last step. */
  const testRef = useRef<{ group: string; run: Promise<void> } | null>(null)
  const membersRef = useRef(members)
  membersRef.current = members
  const groupRef = useRef(group)
  groupRef.current = group
  const currentRef = useRef(current)
  currentRef.current = current
  const startTest = useCallback(() => {
    const target = groupRef.current
    const list = membersRef.current
    if (!target || list.length === 0) return null
    testRef.current = {
      group: target.name,
      run: testMainGroup(target.name, list, timeout).catch((error) => {
        console.warn('[Proxy MVP] Background node test failed:', error)
      }),
    }
    return testRef.current.run
  }, [timeout])
  useEffect(() => {
    if (step === 'welcome' || !profile || !group || members.length === 0) return
    if (testRef.current?.group === group.name) return
    startTest()
  }, [group, members.length, profile, startTest, step])

  const onImported = useCallback(async () => {
    testRef.current = null
    await fetchProfilesIntoCache()
    await refreshAll()
  }, [refreshAll])

  /* Step 1 */
  const [markPhase, setMarkPhase] = useState<MarkPhase>('idle')
  const begin = async () => {
    // Back on this step the dot is already green, so there is nothing left to play.
    if (markPhase === 'green') return go('subscription')
    const run = runRef.current
    setMarkPhase('ink')
    await new Promise((resolve) => setTimeout(resolve, 350))
    if (runRef.current !== run) return
    setMarkPhase('green')
    await new Promise((resolve) => setTimeout(resolve, 650))
    if (runRef.current === run) go('subscription')
  }

  /* Step 3 */
  const [preflight, setPreflight] = useState<Preflight>('checking')
  const [blocker, setBlocker] = useState<string | null>(null)
  const [granting, setGranting] = useState(false)
  const [granted, setGranted] = useState(false)
  const checkPreflight = useCallback(async () => {
    setPreflight('checking')
    const [report] = await Promise.all([
      getPreflightReport().catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 600)),
    ])
    // Only another VPN or proxy stops the connection; stale variables just need a restart later.
    const message = report?.foreignTunnel
      ? t('mvp.home.blockers.foreignTunnel')
      : report?.foreignSystemProxy
        ? t('mvp.home.blockers.foreignSystemProxy')
        : null
    setBlocker(message)
    setPreflight(message ? 'blocked' : 'clear')
  }, [t])
  useEffect(() => {
    if (step === 'permission' && !granted) void checkPreflight()
  }, [checkPreflight, granted, step])

  const grant = useLockFn(async () => {
    setGranting(true)
    try {
      const state = await getRuntimeState()
      if (state.service === 'notInstalled') await installService()
      else if (state.service === 'versionMismatch') await reinstallService()
      else await repairService()
      await revalidateQueries([['getRuntimeState']])
      setGranted(true)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      go('connect')
    } catch (error) {
      console.error('[Proxy MVP] Onboarding service setup failed:', error)
      showNotice.error(t('mvp.onboarding.permission.incomplete'))
    } finally {
      setGranting(false)
    }
  })

  /* Step 4 */
  const [chain, setChain] = useState<Record<ChainStep, ChainState>>({
    device: 'active',
    network: 'pending',
    node: 'pending',
    sites: 'pending',
  })
  const [outcome, setOutcome] = useState<
    | { kind: 'running' }
    | { kind: 'ok'; node: string; delay?: number }
    | { kind: 'failed'; issue?: CheckIssue; node?: string; sites?: string[] }
  >({ kind: 'running' })
  const [aiGood, setAiGood] = useState(false)
  const resetConnect = () => {
    setOutcome({ kind: 'running' })
    setAiGood(false)
    setChain({
      device: 'active',
      network: 'pending',
      node: 'pending',
      sites: 'pending',
    })
  }
  resetConnectRef.current = resetConnect
  const triedRef = useRef(new Set<string>())
  const pendingSelectRef = useRef<{
    resolve: () => void
    reject: (error: unknown) => void
  } | null>(null)
  const { changeProxy } = useProxySelection({
    onSuccess: () => pendingSelectRef.current?.resolve(),
    onError: (error) => pendingSelectRef.current?.reject(error),
  })
  const selectNode = (name: string) =>
    new Promise<void>((resolve, reject) => {
      const target = groupRef.current
      if (!target) return resolve()
      pendingSelectRef.current = { resolve, reject }
      changeProxy(target.name, name, target.now, target.fixed)
    })

  const rankNodes = () => {
    const target = groupRef.current
    if (!target) return []
    return membersRef.current
      .map((member) => ({
        member,
        delay: delayManager.getDelayFix(member, target.name),
      }))
      .filter(({ delay }) => classifyDelay(delay, timeout) === 'measured')
      .sort((a, b) => a.delay - b.delay)
  }

  const connectRunRef = useRef(0)
  const runConnect = async (avoidCurrent = false) => {
    const run = ++connectRunRef.current
    const live = () => connectRunRef.current === run

    try {
      const state = await getRuntimeState()
      if (!state.tunCapable) {
        setNeedsPermission(true)
        go('permission', -1)
        return
      }
      await connectMvpTunnel(false)
      await Promise.allSettled([
        refreshAll(),
        revalidateQueries([['getVergeConfig'], ['getRuntimeState']]),
      ])
    } catch (error) {
      console.error('[Proxy MVP] Onboarding connect failed:', error)
      if (!live()) return
      setChain((prev) => ({ ...prev, device: 'error' }))
      setOutcome({ kind: 'failed' })
      showNotice.error(
        error instanceof MvpConnectionError
          ? t('mvp.home.notices.connectFailedVpn')
          : t('mvp.home.notices.connectFailed'),
      )
      return
    }
    if (!live()) return

    // The fastest node from the background test; a test run before the tunnel came up may have
    // measured nothing, so it runs again over the live connection.
    await testRef.current?.run
    let ranked = rankNodes()
    if (ranked.length === 0) {
      await startTest()
      ranked = rankNodes()
    }
    if (!live()) return
    if (avoidCurrent && currentRef.current) {
      triedRef.current.add(currentRef.current.ref.name)
    }
    const best = ranked.find(
      ({ member }) => !triedRef.current.has(member.ref.name),
    )
    let chosen: InteractableProxyMember | undefined =
      currentRef.current?.kind === 'node' ? currentRef.current : undefined
    if (best && best.member.ref.name !== chosen?.ref.name) {
      try {
        await selectNode(best.member.ref.name)
        chosen = best.member
        recheckConnectionHealth(false).catch((error) => {
          console.warn('[Proxy MVP] Health recheck failed:', error)
        })
      } catch (error) {
        console.error('[Proxy MVP] Onboarding node switch failed:', error)
      }
    }
    if (!live()) return
    const nodeName = chosen?.ref.name
    if (nodeName) triedRef.current.add(nodeName)

    let nodeDelay: number | undefined
    const results = await runNetworkCheck(
      {
        connected: true,
        profile,
        probeNode: async () => {
          const target = groupRef.current
          if (!chosen || !target) return null
          const { delay } = await delayManager.checkDelay(
            chosen,
            target.name,
            timeout,
            0,
          )
          if (classifyDelay(delay, timeout) !== 'measured') return null
          nodeDelay = delay
          return delay
        },
      },
      (checkStep, result) => {
        if (!live()) return
        const segment = chainStepOf(checkStep)
        setChain((prev) => {
          const next = { ...prev }
          if (result === null) {
            if (next[segment] === 'pending') next[segment] = 'active'
            return next
          }
          if (result.status === 'error') next[segment] = 'error'
          else if (checkStep !== 'subscription') next[segment] = 'done'
          return next
        })
      },
    )
    if (!live()) return

    const failedStep = Object.entries(results).find(
      ([, result]) => result?.status === 'error',
    )
    if (failedStep) {
      const result = failedStep[1]!
      setOutcome({
        kind: 'failed',
        issue: result.issue,
        node: nodeName,
        sites: result.sites,
      })
      return
    }
    setOutcome({ kind: 'ok', node: nodeName ?? '', delay: nodeDelay })
    if (aiEnabled && mixedPort) {
      checkAi(mixedPort)
        .then((result) => {
          if (live()) setAiGood(result.verdict === 'good')
        })
        .catch(() => {})
    }
  }
  const retryConnect = (avoidCurrent = false) => {
    resetConnect()
    void runConnect(avoidCurrent)
  }
  // The proxy data lives in refs, so a refresh of it does not restart a run already under way.
  const startConnect = useEffectEvent(() => void runConnect())
  useEffect(() => {
    if (step !== 'connect') return
    startConnect()
    const runs = connectRunRef
    return () => void ++runs.current
  }, [step])

  const finish = () => navigate('/', { replace: true })

  /* Language and appearance, reachable on every step */
  const language = resolveLanguage(verge?.language || i18n.language)
  const changeVerge = (patch: Partial<IVergeConfig>) => {
    mutateVerge((prev) => (prev ? { ...prev, ...patch } : prev), false)
    patchVerge(patch).catch((error) => {
      console.error('[Proxy MVP] Preference change failed:', error)
      mutateVerge()
    })
  }

  const primaryRef = useRef<(() => void) | null>(null)
  useMvpShortcuts([
    { key: 'Enter', onPress: () => primaryRef.current?.() },
    {
      key: 'Escape',
      allowInControl: true,
      onPress: () => {
        if (returning) finish()
      },
    },
  ])

  /* Footer */
  let primary: {
    label: string
    arrow?: boolean
    disabled?: boolean
    busy?: boolean
    onClick: () => void
  }
  let secondary: ReactNode = null
  if (step === 'welcome') {
    primary = {
      label: t('mvp.onboarding.welcome.start'),
      arrow: true,
      disabled: markPhase === 'ink',
      onClick: () => void begin(),
    }
  } else if (step === 'subscription') {
    primary = {
      label: t('mvp.onboarding.next'),
      arrow: true,
      disabled: !profile,
      onClick: () => nextStep && go(nextStep),
    }
  } else if (step === 'permission') {
    primary = granted
      ? {
          label: t('mvp.onboarding.permission.granted'),
          disabled: true,
          onClick: () => {},
        }
      : {
          label: granting
            ? t('mvp.onboarding.permission.waiting')
            : t('mvp.onboarding.permission.grant'),
          busy: granting,
          disabled: granting || preflight !== 'clear',
          onClick: () => void grant(),
        }
  } else if (outcome.kind === 'ok') {
    primary = {
      label: t('mvp.onboarding.connect.finish'),
      arrow: true,
      onClick: finish,
    }
  } else if (outcome.kind === 'failed') {
    const nodeIssue = outcome.issue && NODE_ISSUES.has(outcome.issue)
    primary = nodeIssue
      ? {
          label: t('mvp.check.actions.changeNode'),
          onClick: () => {
            if (
              rankNodes().some(
                ({ member }) => !triedRef.current.has(member.ref.name),
              )
            ) {
              retryConnect(true)
            } else {
              navigate('/nodes', { replace: true })
            }
          },
        }
      : {
          label: t('mvp.check.actions.recheck'),
          onClick: () => retryConnect(),
        }
    secondary = (
      <Button color="inherit" onClick={finish} sx={{ color: 'text.secondary' }}>
        {t('mvp.onboarding.connect.later')}
      </Button>
    )
  } else {
    primary = {
      label: t('mvp.onboarding.connect.finish'),
      arrow: true,
      disabled: true,
      onClick: () => {},
    }
  }

  primaryRef.current = primary.disabled ? null : primary.onClick

  const issueParams = {
    name: outcome.kind === 'failed' ? (outcome.node ?? '') : '',
    sites:
      outcome.kind === 'failed'
        ? new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
            outcome.sites ?? [],
          )
        : '',
  }
  const connectTitle =
    outcome.kind === 'ok'
      ? t('mvp.onboarding.connect.done')
      : outcome.kind === 'failed'
        ? outcome.issue
          ? t(`mvp.check.verdicts.${outcome.issue}.title`, issueParams)
          : t('mvp.home.notices.connectFailed')
        : t('mvp.onboarding.connect.title')
  const connectSubtitle =
    outcome.kind === 'ok'
      ? t('mvp.onboarding.connect.doneSubtitle')
      : outcome.kind === 'failed'
        ? outcome.issue
          ? t(`mvp.check.verdicts.${outcome.issue}.desc`, issueParams)
          : ''
        : t('mvp.onboarding.connect.subtitle')

  let content: ReactNode
  if (step === 'welcome') {
    content = (
      <Frame
        centered
        direction={direction}
        hero={
          <OnboardingMark phase={markPhase} entrance={markPhase === 'idle'} />
        }
        title={t('mvp.onboarding.welcome.title')}
        subtitle={t('mvp.onboarding.welcome.subtitle')}
      />
    )
  } else if (step === 'subscription') {
    content = (
      <SubscriptionStep
        direction={direction}
        profile={profile}
        nodeCount={members.length}
        onImported={onImported}
      />
    )
  } else if (step === 'permission') {
    content = (
      <PermissionStep
        direction={direction}
        granted={granted}
        preflight={preflight}
        blocker={blocker}
        onRecheck={() => void checkPreflight()}
      />
    )
  } else {
    content = (
      <Frame
        direction={direction}
        hero={
          <HeroDot
            state={
              outcome.kind === 'ok'
                ? 'done'
                : outcome.kind === 'failed'
                  ? 'error'
                  : 'pending'
            }
          />
        }
        title={connectTitle}
        subtitle={connectSubtitle}
      >
        <Chain
          states={chain}
          nodeLabel={
            chain.node === 'done' && outcome.kind === 'ok'
              ? outcome.node
              : undefined
          }
        />
        {outcome.kind === 'ok' && (
          <>
            <Box sx={{ mt: 3.25, display: 'flex', gap: 1, minHeight: 28 }}>
              {outcome.delay !== undefined && (
                <Pill tone="neutral">
                  {t('mvp.onboarding.connect.latency', {
                    delay: outcome.delay,
                  })}
                </Pill>
              )}
              {aiGood && (
                <Pill tone="success" title={t('mvp.home.ai.message.good')}>
                  {t('mvp.nodes.ai.tag.good')}
                </Pill>
              )}
            </Box>
            <MenuBarHint />
          </>
        )}
      </Frame>
    )
  }

  const nextLanguage = language === 'zh' ? 'en' : 'zh'

  return (
    <Box
      sx={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <Box
        data-tauri-drag-region="true"
        sx={{ position: 'absolute', inset: '0 0 auto', height: 56, zIndex: 1 }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 28,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 0.75,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        {steps.map((id, position) => (
          <Box
            key={id}
            sx={{
              width: 28,
              height: 3,
              borderRadius: 2,
              bgcolor: 'divider',
              overflow: 'hidden',
              '&::after': {
                content: '""',
                display: 'block',
                height: '100%',
                width: position <= index ? '100%' : 0,
                bgcolor: 'text.primary',
                borderRadius: 2,
                transition: `width .5s ${EASE}`,
              },
            }}
          />
        ))}
      </Box>
      <Box
        sx={{
          position: 'absolute',
          top: 12,
          right: 16,
          display: 'flex',
          gap: 0.25,
          zIndex: 2,
        }}
      >
        <Button
          color="inherit"
          startIcon={<GlobeIcon size={15} />}
          onClick={() => changeVerge({ language: nextLanguage })}
          sx={{
            height: 32,
            px: 1.25,
            fontSize: 13,
            color: 'text.secondary',
            '& .MuiButton-startIcon': { mr: 0.75 },
            '&:hover': { color: 'text.primary' },
          }}
        >
          {nextLanguage === 'zh' ? '中文' : 'English'}
        </Button>
        <Tooltip
          title={t(
            mode === 'dark'
              ? 'mvp.onboarding.theme.light'
              : 'mvp.onboarding.theme.dark',
          )}
        >
          <IconButton
            aria-label={t(
              mode === 'dark'
                ? 'mvp.onboarding.theme.light'
                : 'mvp.onboarding.theme.dark',
            )}
            onClick={() =>
              changeVerge({ theme_mode: mode === 'dark' ? 'light' : 'dark' })
            }
            sx={{
              display: 'grid',
              '& > svg': {
                gridArea: '1 / 1',
                transition: `opacity .3s, transform .45s ${EASE}`,
              },
              ...reducedMotion,
            }}
          >
            <SunIcon
              size={17}
              style={{
                opacity: mode === 'dark' ? 0 : 1,
                transform:
                  mode === 'dark' ? 'rotate(-90deg) scale(.5)' : 'none',
              }}
            />
            <MoonIcon
              size={16}
              style={{
                opacity: mode === 'dark' ? 1 : 0,
                transform: mode === 'dark' ? 'none' : 'rotate(90deg) scale(.5)',
              }}
            />
          </IconButton>
        </Tooltip>
        {returning && (
          <Tooltip title={t('mvp.onboarding.close')}>
            <IconButton aria-label={t('mvp.onboarding.close')} onClick={finish}>
              <XIcon size={16} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box
        key={step}
        sx={{
          position: 'absolute',
          inset: 0,
          transition: 'opacity .2s, transform .2s',
          opacity: leaving ? 0 : 1,
          transform: leaving ? `translateX(${-20 * direction}px)` : 'none',
        }}
      >
        {content}
      </Box>

      <Box
        sx={{
          position: 'absolute',
          left: 40,
          right: 40,
          bottom: 32,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 2,
        }}
      >
        <Box>
          {secondary ??
            (prevStep && step !== 'connect' && !granting && !granted ? (
              <Tooltip title={t('mvp.common.back')}>
                <IconButton
                  aria-label={t('mvp.common.back')}
                  onClick={() => go(prevStep, -1)}
                  sx={{ width: 36, height: 36, color: 'text.secondary' }}
                >
                  <ChevronLeftIcon size={18} />
                </IconButton>
              </Tooltip>
            ) : null)}
        </Box>
        <Button
          size="large"
          variant="contained"
          disabled={primary.disabled}
          onClick={primary.onClick}
          sx={{
            minWidth: 112,
            gap: 1,
            '& .arrow': { transition: `transform .2s ${EASE}` },
            '&:hover .arrow': { transform: 'translateX(3px)' },
            '&:active': { transform: 'scale(.97)' },
          }}
        >
          {primary.busy && <MvpProgressRing size={16} color="inherit" />}
          {primary.label}
          {primary.arrow && <ArrowRightIcon className="arrow" size={16} />}
        </Button>
      </Box>
    </Box>
  )
}

export default MvpOnboardingPage
