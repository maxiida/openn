import {
  alpha,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Stack,
  type Theme,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconDeviceLaptop,
  IconExclamationMark,
  IconPlayerStop,
  IconRefresh,
  IconServer,
  IconTicket,
  IconWifi,
  IconWorld,
  IconX,
  type Icon,
} from '@tabler/icons-react'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import dayjs from 'dayjs'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import {
  MvpCheckRing,
  type MvpCheckRingSegment,
} from '@/components/mvp/mvp-check-ring'
import { MvpPage } from '@/components/mvp/mvp-page'
import { MvpSegmented } from '@/components/mvp/mvp-segmented'
import { MvpShortcutHint } from '@/components/mvp/mvp-shortcut-hint'
import { testMainGroup, useMainProxyGroup } from '@/hooks/use-main-proxy-group'
import { useMvpConnected } from '@/hooks/use-mvp-connected'
import { useMvpShortcuts } from '@/hooks/use-mvp-shortcuts'
import { useProfiles } from '@/hooks/use-profiles'
import delayManager from '@/services/delay'
import { formatTrafficAmount } from '@/services/mvp'
import {
  CHECK_STEPS,
  type CheckIssue,
  type CheckStepId,
  type CheckStepResult,
  runNetworkCheck,
} from '@/services/network-check'
import { showNotice } from '@/services/notice-service'
import {
  isAbortError,
  measureDownloadMbps,
  measureLatencyMs,
  NODE_TEST_MB,
  worldShareBelow,
} from '@/services/speed-test'
import { classifyDelay } from '@/utils/delay'
import { mvpSpeedTier } from '@/utils/main-proxy-group'
import type { MvpSegment } from '@/utils/mvp-progress'

// One vertical rhythm for the whole page: the gap around the ring, its text and what follows.
const GAP = 6
const SPEED_SEGMENTS = 6
// The "share of users worldwide" line only reads as encouragement above this.
const MIN_SHARE_SHOWN = 20
// Live numbers arrive per network chunk; repainting faster than this only costs frames.
const LIVE_UPDATE_MS = 80

type Tab = 'checkup' | 'speed'
type Tone = 'success' | 'warning' | 'error' | 'info'

const STEP_ICONS: Record<CheckStepId, Icon> = {
  device: IconDeviceLaptop,
  network: IconWifi,
  subscription: IconTicket,
  node: IconServer,
  sites: IconWorld,
}

const toneSx = (tone: Tone | null) => (theme: Theme) => {
  if (!tone) {
    return {
      bgcolor: theme.palette.background.default,
      color: 'text.disabled',
      boxShadow: `inset 0 0 0 0.5px ${theme.palette.divider}`,
    }
  }
  const palette = theme.palette[tone]
  const dark = theme.palette.mode === 'dark'
  return {
    bgcolor: alpha(palette.main, dark ? 0.16 : 0.1),
    color: dark ? palette.light : palette.dark,
    boxShadow: `inset 0 0 0 0.5px ${alpha(palette.main, dark ? 0.4 : 0.3)}`,
  }
}

/** Each sentence on its own line, without the closing full stop UI copy leaves out. */
const sentences = (text: string | readonly string[]) =>
  (typeof text === 'string' ? text.split(/。|\.\s+/) : text)
    .map((line) => line.trim().replace(/[。.]$/, ''))
    .filter(Boolean)

const formatMbps = (mbps: number) =>
  mbps >= 10 ? String(Math.round(mbps)) : mbps.toFixed(1)

const Description = ({
  text,
  tip,
}: {
  text: string | readonly string[]
  tip?: string
}) => {
  const lines = sentences(text).map((line) => (
    <Box component="span" key={line} sx={{ display: 'block' }}>
      {line}
    </Box>
  ))
  return (
    <Typography
      component="div"
      color="text.secondary"
      sx={{ mt: 0.75, maxWidth: 440, fontSize: 14, lineHeight: 1.55 }}
    >
      {tip ? (
        <Tooltip title={tip}>
          <Box
            component="span"
            tabIndex={0}
            sx={{
              display: 'inline-block',
              cursor: 'help',
              outline: 'none',
              '& > span': {
                textDecoration: 'underline dotted',
                textDecorationColor: (theme) => theme.palette.text.disabled,
                textUnderlineOffset: 5,
              },
            }}
          >
            {lines}
          </Box>
        </Tooltip>
      ) : (
        lines
      )}
    </Typography>
  )
}

const Hero = ({
  ring,
  title,
  description,
  tip,
  actions,
}: {
  ring: ReactNode
  title: string
  description: string | readonly string[]
  tip?: string
  actions?: ReactNode
}) => (
  <Stack sx={{ alignItems: 'center', textAlign: 'center', pt: GAP }}>
    {ring}
    <Typography
      sx={{
        mt: GAP,
        fontSize: 20,
        fontWeight: 650,
        letterSpacing: '-0.01em',
        textWrap: 'balance',
      }}
    >
      {title}
    </Typography>
    <Description text={description} tip={tip} />
    {actions && (
      <Stack sx={{ mt: GAP, alignItems: 'center', gap: 0.5 }}>{actions}</Stack>
    )}
  </Stack>
)

const RingStart = ({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) => (
  <ButtonBase
    onClick={onClick}
    sx={{
      width: '100%',
      height: '100%',
      borderRadius: '50%',
      color: 'primary.main',
      fontSize: 19,
      fontWeight: 650,
      transition: 'background-color 150ms',
      '&:hover': {
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
      },
    }}
  >
    {label}
  </ButtonBase>
)

const RingNumber = ({ value, unit }: { value: string; unit: string }) => (
  <>
    <Typography
      sx={{
        fontSize: 40,
        fontWeight: 650,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </Typography>
    <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 13 }}>
      {unit}
    </Typography>
  </>
)

const PrimaryAction = ({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) => (
  <Button
    variant="contained"
    onClick={onClick}
    sx={{
      minWidth: 138,
      height: 42,
      borderRadius: 999,
      fontSize: 15,
      fontWeight: 600,
    }}
  >
    {children}
  </Button>
)

/** Icon-only control on the ring's lower-right edge: stop while running, run again when done. */
const RingCorner = ({
  label,
  onClick,
  icon,
}: {
  label: string
  onClick: () => void
  icon: ReactNode
}) => (
  <Tooltip title={label}>
    <IconButton
      aria-label={label}
      onClick={onClick}
      sx={{ width: 32, height: 32 }}
    >
      {icon}
    </IconButton>
  </Tooltip>
)

/* ---------------------------------- Checkup ---------------------------------- */

type StepState = CheckStepResult | null | undefined

const useCheckup = () => {
  const { connected } = useMvpConnected()
  const { profiles } = useProfiles()
  const { group, current, timeout } = useMainProxyGroup()
  const node = current?.kind === 'node' ? current : undefined
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [steps, setSteps] = useState<Partial<Record<CheckStepId, StepState>>>(
    {},
  )
  const [nodeName, setNodeName] = useState<string>()
  const runRef = useRef(0)

  const run = async () => {
    const id = ++runRef.current
    setSteps({})
    setPhase('running')
    setNodeName(node?.ref.name)
    await runNetworkCheck(
      {
        connected,
        profile: profiles?.items?.find((item) => item.uid === profiles.current),
        probeNode: async () => {
          if (!node || !group) return null
          const { delay } = await delayManager.checkDelay(
            node,
            group.name,
            timeout,
            0,
          )
          return classifyDelay(delay, timeout) === 'measured' ? delay : null
        },
      },
      (step, result) => {
        if (runRef.current === id) {
          setSteps((prev) => ({ ...prev, [step]: result }))
        }
      },
    )
    if (runRef.current === id) setPhase('done')
  }

  // A check still running when the page closes must not write into the next visit.
  useEffect(() => () => void ++runRef.current, [])

  return { phase, steps, nodeName, run }
}

const CheckupTab = ({
  checkup,
  onSpeedTest,
  onChangeNode,
}: {
  checkup: ReturnType<typeof useCheckup>
  onSpeedTest: () => void
  onChangeNode: () => void
}) => {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { phase, steps, nodeName, run } = checkup
  const [copied, setCopied] = useState(false)
  const list = (sites: readonly string[] = []) =>
    new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(sites)

  const settled = CHECK_STEPS.filter((step) => steps[step]).length
  const running = CHECK_STEPS.find((step) => steps[step] === null)
  const failed =
    CHECK_STEPS.find((step) => steps[step]?.status === 'error') ??
    CHECK_STEPS.find((step) => steps[step]?.status === 'warn')
  const issue = failed ? steps[failed]?.issue : undefined
  const issueParams = {
    name: nodeName ?? '',
    sites: list(failed ? steps[failed]?.sites : []),
  }

  const detail = (step: CheckStepId) => {
    const state = steps[step]
    if (state === null) return t('mvp.check.stepStatus.running')
    if (!state) {
      return phase === 'done'
        ? t('mvp.check.stepStatus.skipped')
        : t('mvp.check.stepStatus.waiting')
    }
    if (state.issue) {
      return t(`mvp.check.details.${state.issue}`, {
        name: nodeName ?? '',
        sites: list(state.sites),
      })
    }
    switch (step) {
      case 'device':
        return t('mvp.check.details.deviceOk')
      case 'network':
        return t('mvp.check.details.networkOk')
      case 'subscription': {
        const remaining =
          state.remaining === undefined
            ? undefined
            : formatTrafficAmount(state.remaining, i18n.language)
        const date = state.expire
          ? dayjs
              .unix(state.expire)
              .format(t('mvp.subscriptions.updated.dateFormat'))
          : undefined
        if (remaining && date) {
          return t('mvp.check.details.subscriptionUsage', { remaining, date })
        }
        if (remaining) {
          return t('mvp.check.details.subscriptionRemaining', { remaining })
        }
        if (date) return t('mvp.check.details.subscriptionExpire', { date })
        return t('mvp.check.details.subscriptionNone')
      }
      case 'node':
        return t('mvp.check.details.nodeOk', {
          name: nodeName ?? '',
          delay: state.delay,
        })
      case 'sites':
        return t('mvp.check.details.sitesOk', { sites: list(state.sites) })
    }
  }

  const onRun = () => {
    setCopied(false)
    void run()
  }

  const onCopy = async () => {
    const report = [
      t('mvp.check.report.title', { time: dayjs().format('YYYY-MM-DD HH:mm') }),
      ...CHECK_STEPS.map((step) =>
        t('mvp.check.report.line', {
          step: t(`mvp.check.steps.${step}`),
          detail: detail(step),
        }),
      ),
      t('mvp.check.report.footer'),
    ].join('\n')
    try {
      await writeText(report)
      setCopied(true)
    } catch (error) {
      console.error('[Proxy MVP] Copying the check report failed:', error)
    }
  }

  const issueAction: Record<CheckIssue, [string, () => void]> = {
    foreignTunnel: [t('mvp.check.actions.recheck'), onRun],
    foreignSystemProxy: [t('mvp.check.actions.recheck'), onRun],
    staleProxyEnv: [t('mvp.check.actions.recheck'), onRun],
    offline: [t('mvp.check.actions.recheck'), onRun],
    quotaUsedUp: [
      t('mvp.check.actions.subscription'),
      () => navigate('/nodes'),
    ],
    expired: [t('mvp.check.actions.subscription'), () => navigate('/nodes')],
    disconnected: [t('mvp.check.actions.connect'), () => navigate('/')],
    nodeDown: [t('mvp.check.actions.changeNode'), onChangeNode],
    sitesDown: [t('mvp.check.actions.changeNode'), onChangeNode],
    foreignDown: [t('mvp.check.actions.changeNode'), onChangeNode],
  }

  const segments = CHECK_STEPS.map(
    (step): MvpCheckRingSegment => ({
      state:
        steps[step] === null
          ? 'active'
          : steps[step]?.status === 'error'
            ? 'error'
            : steps[step]?.status === 'warn'
              ? 'warn'
              : steps[step]
                ? 'done'
                : 'pending',
    }),
  )

  let center: ReactNode
  let title: string
  let description: string
  let tip: string | undefined
  let actions: ReactNode = null
  if (phase === 'idle') {
    center = <RingStart label={t('mvp.check.idle.start')} onClick={onRun} />
    title = t('mvp.check.idle.title')
    description = t('mvp.check.idle.desc')
    tip = t('mvp.check.idle.cost')
  } else if (phase === 'running') {
    center = (
      <Typography
        sx={{
          fontSize: 40,
          fontWeight: 650,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {settled}
        <Box component="span" sx={{ fontSize: 20, color: 'text.disabled' }}>
          {' '}
          / {CHECK_STEPS.length}
        </Box>
      </Typography>
    )
    title = t('mvp.check.running.title')
    description = t('mvp.check.running.desc', {
      step: t(`mvp.check.steps.${running ?? CHECK_STEPS[settled] ?? 'sites'}`),
    })
  } else {
    const level = !issue
      ? 'success'
      : steps[failed!]?.status === 'warn'
        ? 'warning'
        : 'error'
    const ResultIcon =
      level === 'success'
        ? IconCircleCheck
        : level === 'warning'
          ? IconAlertTriangle
          : IconAlertCircle
    center = (
      <Box sx={{ color: `${level}.main`, display: 'flex' }}>
        <ResultIcon size={52} stroke={1.5} />
      </Box>
    )
    if (issue) {
      const [label, onAction] = issueAction[issue]
      title = t(`mvp.check.verdicts.${issue}.title`, issueParams)
      description = t(`mvp.check.verdicts.${issue}.desc`, issueParams)
      actions = (
        <>
          <PrimaryAction onClick={onAction}>{label}</PrimaryAction>
          <Button
            color="inherit"
            sx={{ mt: 0.75, color: 'text.secondary' }}
            onClick={onCopy}
          >
            {copied
              ? t('mvp.check.actions.copied')
              : t('mvp.check.actions.copyReport')}
          </Button>
        </>
      )
    } else {
      title = t('mvp.check.verdicts.ok.title')
      description = t('mvp.check.verdicts.ok.desc')
      actions = (
        <PrimaryAction onClick={onSpeedTest}>
          {t('mvp.check.actions.speedTest')}
        </PrimaryAction>
      )
    }
  }

  return (
    <>
      <Hero
        ring={
          <MvpCheckRing
            segments={segments}
            // A finished check paints its passed steps green, as a speed result paints its tier.
            doneColor={phase === 'done' ? 'success.main' : undefined}
            corner={
              phase === 'done' && (
                <RingCorner
                  label={t('mvp.check.actions.recheck')}
                  onClick={onRun}
                  icon={<IconRefresh size={18} />}
                />
              )
            }
          >
            {center}
          </MvpCheckRing>
        }
        title={title}
        description={description}
        tip={tip}
        actions={actions}
      />
      <Box
        aria-label={t('mvp.check.tabs.checkup')}
        sx={{
          mt: GAP,
          px: 1.75,
          py: 0.75,
          borderRadius: 2.5,
          border: '0.5px solid',
          borderColor: 'divider',
        }}
      >
        {CHECK_STEPS.map((step, index) => {
          const state = steps[step]
          const tone: Tone | null =
            state === null
              ? 'info'
              : state?.status === 'error'
                ? 'error'
                : state?.status === 'warn'
                  ? 'warning'
                  : state
                    ? 'success'
                    : null
          const StepIcon =
            state?.status === 'error'
              ? IconX
              : state?.status === 'warn'
                ? IconExclamationMark
                : STEP_ICONS[step]
          return (
            <Box
              key={step}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                minHeight: 48,
              }}
            >
              <Box
                sx={{
                  alignSelf: 'stretch',
                  width: 30,
                  flexShrink: 0,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  // Short links between neighbouring circles, stopping just short of each one.
                  '&::before, &::after': {
                    content: '""',
                    position: 'absolute',
                    left: 14.5,
                    width: '1px',
                    height: 'calc(50% - 18px)',
                    bgcolor: 'divider',
                  },
                  '&::before': {
                    top: 0,
                    display: index === 0 ? 'none' : 'block',
                  },
                  '&::after': {
                    bottom: 0,
                    display:
                      index === CHECK_STEPS.length - 1 ? 'none' : 'block',
                  },
                }}
              >
                <Box
                  sx={[
                    {
                      position: 'relative',
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      transition: 'background-color 200ms, color 200ms',
                    },
                    toneSx(tone),
                    state === null && {
                      '& svg': {
                        animation:
                          'mvp-check-breathe 1.1s ease-in-out infinite',
                      },
                      '@keyframes mvp-check-breathe': {
                        '0%, 100%': { opacity: 0.9 },
                        '50%': { opacity: 0.3 },
                      },
                    },
                  ]}
                >
                  <StepIcon size={17} />
                </Box>
              </Box>
              <Typography
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 14,
                  color: state ? 'text.primary' : 'text.secondary',
                }}
              >
                {t(`mvp.check.steps.${step}`)}
              </Typography>
              <Typography
                noWrap
                sx={{
                  maxWidth: '62%',
                  fontSize: 14,
                  fontVariantNumeric: 'tabular-nums',
                  color:
                    state?.status === 'error'
                      ? 'error.main'
                      : state?.status === 'warn'
                        ? 'warning.main'
                        : state
                          ? 'text.secondary'
                          : 'text.disabled',
                }}
              >
                {detail(step)}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </>
  )
}

/* ---------------------------------- Speed ---------------------------------- */

type SpeedMode = 'node' | 'direct' | 'both'

interface SpeedReading {
  down: number
  latency: number | null
}

type SpeedOutcome =
  | { mode: 'node' | 'direct'; reading: SpeedReading }
  | { mode: 'both'; direct: SpeedReading; node: SpeedReading }

const SPEED_MODES: SpeedMode[] = ['node', 'direct', 'both']

const isSlow = (mbps: number) =>
  ['fair', 'poor'].includes(mvpSpeedTier(mbps).id)

const useSpeedTest = () => {
  const { t } = useTranslation()
  const [mode, setMode] = useState<SpeedMode>('node')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [progress, setProgress] = useState(0)
  const [live, setLive] = useState<{ value: number | null; unit: string }>({
    value: null,
    unit: 'Mbps',
  })
  const [stage, setStage] = useState('')
  const [outcome, setOutcome] = useState<SpeedOutcome | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const paintedAtRef = useRef(0)

  const paint = (fraction: number, value: number | null, unit: string) => {
    const now = performance.now()
    if (value !== null && now - paintedAtRef.current < LIVE_UPDATE_MS) return
    paintedAtRef.current = now
    setProgress(fraction)
    setLive({ value, unit })
  }

  // `from`–`to` is this route's share of the ring.
  const measure = async (
    direct: boolean,
    from: number,
    to: number,
    signal: AbortSignal,
    stepLabel?: string,
  ): Promise<SpeedReading> => {
    const span = to - from
    const latencyShare = span / 6
    setStage(stepLabel ?? t('mvp.speedTest.running.latency'))
    paint(from, null, 'ms')
    const latency = await measureLatencyMs(direct)
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError')

    setStage(stepLabel ?? t('mvp.speedTest.running.download'))
    paint(from + latencyShare, null, 'Mbps')
    const down = await measureDownloadMbps(
      (fraction, mbps) =>
        paint(
          from + latencyShare + fraction * (span - latencyShare),
          mbps,
          'Mbps',
        ),
      { direct, signal, latencyMs: latency },
    )
    return { down, latency }
  }

  const run = async (nodeName: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setOutcome(null)
    setProgress(0)
    setPhase('running')
    try {
      let result: SpeedOutcome
      if (mode === 'both') {
        const direct = await measure(
          true,
          0,
          0.4,
          controller.signal,
          t('mvp.speedTest.running.directStep'),
        )
        const node = await measure(
          false,
          0.4,
          1,
          controller.signal,
          t('mvp.speedTest.running.nodeStep', { name: nodeName }),
        )
        result = { mode, direct, node }
      } else {
        result = {
          mode,
          reading: await measure(mode === 'direct', 0, 1, controller.signal),
        }
      }
      if (controllerRef.current !== controller) return
      setOutcome(result)
      setProgress(1)
      setPhase('done')
    } catch (error) {
      if (controllerRef.current !== controller) return
      setPhase('idle')
      if (isAbortError(error)) return
      console.error('[Proxy MVP] Speed test failed:', error)
      showNotice.error(t('mvp.speedTest.notices.failed'))
    }
  }

  const stop = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setPhase('idle')
  }

  const changeMode = (next: SpeedMode) => {
    if (next === mode) return
    stop()
    setOutcome(null)
    setMode(next)
  }

  useEffect(() => () => controllerRef.current?.abort(), [])

  return { mode, phase, progress, live, stage, outcome, run, stop, changeMode }
}

const ResultCell = ({
  label,
  value,
  unit,
  color,
  tip,
}: {
  label: string
  value: string
  unit?: string
  color?: string
  tip?: string
}) => (
  <Tooltip title={tip ?? ''}>
    <Box sx={{ py: 1.75, px: 0.75, textAlign: 'center', minWidth: 0 }}>
      <Typography color="text.secondary" sx={{ fontSize: 12, mb: 0.625 }}>
        {label}
      </Typography>
      <Typography
        component="div"
        sx={{
          fontSize: 19,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color,
        }}
      >
        {value}
        {unit && (
          <Box
            component="span"
            sx={{
              ml: 0.375,
              fontSize: 12,
              fontWeight: 400,
              color: 'text.secondary',
            }}
          >
            {unit}
          </Box>
        )}
      </Typography>
    </Box>
  </Tooltip>
)

const CompareBar = ({
  label,
  value,
  max,
  color,
}: {
  label: string
  value: number | null
  max: number
  color: string
}) => (
  <Box sx={{ mb: 1.25 }}>
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 1,
        mb: 0.625,
        fontSize: 13,
        color: 'text.secondary',
      }}
    >
      <Box
        component="span"
        sx={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Box>
      <Box
        component="b"
        sx={{
          color: 'text.primary',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {value === null ? '—' : `${formatMbps(value)} Mbps`}
      </Box>
    </Box>
    <Box sx={{ height: 8, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Box
        sx={{
          height: 8,
          borderRadius: 1,
          bgcolor: color,
          width: `${value === null || max <= 0 ? 0 : Math.max(2, (value / max) * 100)}%`,
          transition: 'width 400ms ease-out',
        }}
      />
    </Box>
  </Box>
)

const resultPanelSx = {
  mt: 2,
  borderRadius: 2.5,
  border: '0.5px solid',
  borderColor: 'divider',
  '@keyframes mvp-check-rise': {
    from: { opacity: 0, transform: 'translateY(6px)' },
    to: { opacity: 1, transform: 'none' },
  },
  animation: 'mvp-check-rise 220ms ease-out',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
}

const SpeedTab = ({
  speed,
  nodeName,
  onChangeNode,
}: {
  speed: ReturnType<typeof useSpeedTest>
  nodeName: string
  onChangeNode: () => void
}) => {
  const { t } = useTranslation()
  const { mode, phase, progress, live, stage, outcome } = speed
  const headline =
    outcome?.mode === 'both' ? outcome.node.down : outcome?.reading.down
  const slow = headline !== undefined && mode !== 'direct' && isSlow(headline)

  const filled = progress * SPEED_SEGMENTS
  const segments = Array.from(
    { length: SPEED_SEGMENTS },
    (_, index): MvpCheckRingSegment => {
      if (phase === 'done') return { state: 'done' }
      if (phase === 'idle') return { state: 'pending' }
      const state: MvpSegment =
        index < Math.floor(filled)
          ? 'done'
          : index === Math.floor(filled)
            ? 'active'
            : 'pending'
      return { state }
    },
  )

  const onStart = () => void speed.run(nodeName)
  let center: ReactNode
  let corner: ReactNode = null
  let title: string
  let description: string | string[]
  let tip: string | undefined
  if (phase === 'idle') {
    center = (
      <RingStart label={t('mvp.speedTest.idle.start')} onClick={onStart} />
    )
    title = t('mvp.speedTest.idle.title')
    description = t(`mvp.speedTest.what.${mode}`, { name: nodeName })
    tip = t(`mvp.speedTest.cost.${mode}`, { mb: NODE_TEST_MB })
  } else if (phase === 'running') {
    center = (
      <RingNumber
        value={
          live.value === null
            ? '··'
            : live.unit === 'ms'
              ? String(live.value)
              : formatMbps(live.value)
        }
        unit={live.unit}
      />
    )
    corner = (
      <RingCorner
        label={t('mvp.speedTest.actions.stop')}
        onClick={speed.stop}
        icon={<IconPlayerStop size={18} />}
      />
    )
    title = t('mvp.speedTest.running.title')
    description = stage
  } else if (outcome?.mode === 'both') {
    center = (
      <RingNumber
        value={formatMbps(outcome.node.down)}
        unit={`Mbps · ${t('mvp.speedTest.compare.ringLabel')}`}
      />
    )
    corner = (
      <RingCorner
        label={t('mvp.speedTest.actions.retry')}
        onClick={onStart}
        icon={<IconRefresh size={18} />}
      />
    )
    const params = {
      direct: formatMbps(outcome.direct.down),
      node: formatMbps(outcome.node.down),
      name: nodeName,
    }
    title = slow
      ? t('mvp.speedTest.compare.slowTitle')
      : t('mvp.speedTest.compare.okTitle')
    description = slow
      ? t('mvp.speedTest.compare.slowDesc', params)
      : t('mvp.speedTest.compare.okDesc', params)
  } else {
    const down = outcome?.reading.down ?? 0
    const tier = mvpSpeedTier(down)
    const share = worldShareBelow(down)
    center = <RingNumber value={formatMbps(down)} unit="Mbps" />
    corner = (
      <RingCorner
        label={t('mvp.speedTest.actions.retry')}
        onClick={onStart}
        icon={<IconRefresh size={18} />}
      />
    )
    title = t(`mvp.speedTest.result.${mode === 'direct' ? 'direct' : 'node'}`, {
      tier: tier.label,
    })
    description = [
      tier.hint,
      ...(share >= MIN_SHARE_SHOWN
        ? [t('mvp.speedTest.result.beats', { percent: share })]
        : []),
      ...(slow ? [t('mvp.speedTest.result.slow')] : []),
    ]
  }

  let panel: ReactNode = null
  if (phase === 'done' && outcome?.mode === 'both') {
    const { direct, node } = outcome
    const nodeColor = slow ? 'error.main' : 'primary.main'
    const max = Math.max(direct.down, node.down)
    panel = (
      <Box sx={[resultPanelSx, { px: 2, pt: 2, pb: 1 }]}>
        <Typography sx={{ mb: 1.25, fontSize: 13, fontWeight: 600 }}>
          {t('mvp.speedTest.metrics.download')}
        </Typography>
        <CompareBar
          label={t('mvp.speedTest.compare.broadband')}
          value={direct.down}
          max={max}
          color="text.disabled"
        />
        <CompareBar
          label={t('mvp.speedTest.compare.viaNode', { name: nodeName })}
          value={node.down}
          max={max}
          color={nodeColor}
        />
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            mt: 2,
            pt: 1.5,
            pb: 0.75,
            borderTop: '0.5px solid',
            borderColor: 'divider',
            fontSize: 13,
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span>{t('mvp.speedTest.metrics.latency')}</span>
          <span>
            {t('mvp.speedTest.compare.latencyValue', {
              direct: direct.latency ?? '—',
              node: node.latency ?? '—',
            })}
          </span>
        </Box>
      </Box>
    )
  } else if (phase === 'done' && outcome && outcome.mode !== 'both') {
    const { reading } = outcome
    const numberColor = slow ? 'error.main' : undefined
    // Broadband spends no subscription data, so it has no usage cell.
    const cells = [
      <ResultCell
        key="download"
        label={t('mvp.speedTest.metrics.download')}
        value={formatMbps(reading.down)}
        unit="Mbps"
        color={numberColor}
      />,
      <ResultCell
        key="latency"
        label={t('mvp.speedTest.metrics.latency')}
        value={reading.latency === null ? '—' : String(reading.latency)}
        unit={reading.latency === null ? undefined : 'ms'}
      />,
      outcome.mode === 'node' && (
        <ResultCell
          key="used"
          label={t('mvp.speedTest.metrics.used')}
          value={String(NODE_TEST_MB)}
          unit="MB"
        />
      ),
    ].filter(Boolean)
    panel = (
      <Box
        sx={[
          resultPanelSx,
          {
            display: 'grid',
            gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
            '& > * + *': {
              borderLeft: '0.5px solid',
              borderColor: 'divider',
            },
          },
        ]}
      >
        {cells}
      </Box>
    )
  }

  return (
    <>
      <Hero
        ring={
          <MvpCheckRing
            segments={segments}
            doneColor={
              headline === undefined ? undefined : mvpSpeedTier(headline).color
            }
            corner={corner}
          >
            {center}
          </MvpCheckRing>
        }
        title={title}
        description={description}
        tip={tip}
        actions={
          phase === 'done' && slow ? (
            <PrimaryAction onClick={onChangeNode}>
              {t('mvp.check.actions.changeNode')}
            </PrimaryAction>
          ) : undefined
        }
      />
      <MvpSegmented<SpeedMode>
        label={t('mvp.check.tabs.speed')}
        value={mode}
        options={SPEED_MODES.map((option) => ({
          value: option,
          label: t(`mvp.speedTest.modes.${option}`),
        }))}
        onChange={speed.changeMode}
        sx={{ width: 'fit-content', mx: 'auto', mt: GAP }}
      />
      {panel}
    </>
  )
}

/* ---------------------------------- Page ---------------------------------- */

const MvpCheckPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('checkup')
  const checkup = useCheckup()
  const speed = useSpeedTest()
  const { group, members, current, timeout } = useMainProxyGroup()

  const onChangeNode = () => {
    if (group) void testMainGroup(group.name, members, timeout)
    navigate('/nodes')
  }

  useMvpShortcuts([
    { key: 'Escape', allowInControl: true, onPress: () => navigate('/') },
  ])

  const tabs: Tab[] = ['checkup', 'speed']

  return (
    <MvpPage
      title={t('mvp.check.title')}
      leading={
        <Tooltip
          title={
            <MvpShortcutHint label={t('mvp.common.back')} shortcut="Esc" />
          }
        >
          <IconButton
            aria-label={t('mvp.common.back')}
            aria-keyshortcuts="Escape"
            onClick={() => navigate('/')}
          >
            <IconArrowLeft size={22} />
          </IconButton>
        </Tooltip>
      }
    >
      <MvpSegmented<Tab>
        label={t('mvp.check.title')}
        value={tab}
        options={tabs.map((option) => ({
          value: option,
          label: t(`mvp.check.tabs.${option}`),
        }))}
        onChange={setTab}
        equalWidth
        sx={{ width: 240, mx: 'auto', mt: 0.5 }}
      />
      {tab === 'checkup' ? (
        <CheckupTab
          checkup={checkup}
          onSpeedTest={() => setTab('speed')}
          onChangeNode={onChangeNode}
        />
      ) : (
        <SpeedTab
          speed={speed}
          nodeName={current?.ref.name ?? ''}
          onChangeNode={onChangeNode}
        />
      )}
    </MvpPage>
  )
}

export default MvpCheckPage
