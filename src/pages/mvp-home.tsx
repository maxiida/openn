import {
  Badge,
  Box,
  Button,
  Collapse,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  IconActivity,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconInfoCircle,
  IconRefresh,
  IconScan,
  IconSettings,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { BaseDialog } from '@/components/base'
import { MvpAiPanel } from '@/components/mvp/mvp-ai-panel'
import { MvpBanner } from '@/components/mvp/mvp-banner'
import { MvpPage } from '@/components/mvp/mvp-page'
import { MvpProgressRing } from '@/components/mvp/mvp-progress-ring'
import { MvpShortcutHint } from '@/components/mvp/mvp-shortcut-hint'
import { MvpStatusHint } from '@/components/mvp/mvp-status-hint'
import { MvpStatusPill } from '@/components/mvp/mvp-status-pill'
import { QrScannerDialog } from '@/components/mvp/qr-scanner-dialog'
import { useConnectionUnhealthy } from '@/hooks/use-connection-unhealthy'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { testMainGroup, useMainProxyGroup } from '@/hooks/use-main-proxy-group'
import { useMvpConnected } from '@/hooks/use-mvp-connected'
import { mvpCommandKey, useMvpShortcuts } from '@/hooks/use-mvp-shortcuts'
import { useMvpSteps } from '@/hooks/use-mvp-steps'
import { fetchProfilesIntoCache, useProfiles } from '@/hooks/use-profiles'
import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'
import { useAppRefreshers } from '@/providers/app-data-context'
import {
  aiVerdictColor,
  checkAi,
  type AiCheckResult,
} from '@/services/ai-check'
import {
  getPreflightReport,
  getRuntimeState,
  type PreflightReport,
  updateProfile,
} from '@/services/cmds'
import delayManager from '@/services/delay'
import {
  activateMvpProfile,
  ensureMvpMode,
  importAndActivateMvpProfile,
  importAndActivateMvpQrPayload,
  isProfileUpdatedToday,
} from '@/services/mvp'
import {
  connectMvpTunnel,
  disconnectMvp,
  MvpConnectionError,
} from '@/services/mvp-connection'
import { showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'
import {
  checkMvpSites,
  MVP_SITES,
  type MvpSiteId,
  type MvpSiteStatus,
} from '@/services/site-check'
import { measureDownloadMbps, measureLatencyMs } from '@/services/speed-test'
import { classifyDelay } from '@/utils/delay'
import {
  formatMvpDelay,
  mvpDelayColor,
  mvpDelayHint,
  mvpSpeedHint,
  mvpSpeedTier,
} from '@/utils/main-proxy-group'
import { fractionSegments } from '@/utils/mvp-progress'
import { isValidUrl } from '@/utils/network'

const HomeLoading = () => (
  <Box sx={{ minHeight: 420, display: 'grid', placeItems: 'center' }}>
    <MvpProgressRing size={24} />
  </Box>
)

// Kept across visits to this page: returning from the node list on another node retests its speed.
let checkedNode: string | undefined

const DELAY_REFRESH_MS = 30_000
const SITE_REFRESH_MS = 60_000
const DELAY_RETRY_MS = 3_000
// One probe swings with every network hiccup; the median of the last few is what browsing feels like.
const DELAY_SAMPLES = 3
// A single lost probe is common on a healthy node; only repeated failures mean it is unusable.
const DELAY_FAILURES_TO_REPORT = 2

type DelayReading = {
  node: string
  healthEpoch: number
  samples: number[]
  failures: number
  failedDelay: number
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

const MvpHomePage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profiles } = useProfiles()
  const { refreshAll } = useAppRefreshers()
  const {
    connected: indicator,
    tunnelEnabled,
    systemProxyEnabled,
    isRunStateLoading,
  } = useMvpConnected()
  const health = useConnectionUnhealthy()
  const unhealthy = health.unhealthy && indicator
  const healthEpoch = health.epoch
  const { verge } = useVerge()
  const needsDisconnect = systemProxyEnabled || Boolean(verge?.enable_tun_mode)
  const { group, members, current, delays, timeout } = useMainProxyGroup()
  const pageVisible = useVisibility()
  const [speedResult, setSpeedResult] = useState<{
    key: string
    mbps: number
    time: string
  } | null>(null)
  const [speedTesting, setSpeedTesting] = useState(false)
  const [speedProgress, setSpeedProgress] = useState(0)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  // Download and activate, then this page's own refresh.
  const importSteps = useMvpSteps(1)
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  // The connection's own steps, then refreshing what the page shows.
  const connectSteps = useMvpSteps(1)
  const [setupOpen, setSetupOpen] = useState(false)
  const [preflight, setPreflight] = useState<PreflightReport | null>(null)
  const activationAttemptRef = useRef<string | null>(null)
  const dailyUpdateAttemptRef = useRef<string | null>(null)
  const delayReadingRef = useRef<DelayReading | null>(null)
  const [delayReading, setDelayReading] = useState<DelayReading | null>(null)
  const [delayRound, setDelayRound] = useState(0)
  const [siteCheck, setSiteCheck] = useState<{
    key: string
    results: Record<MvpSiteId, MvpSiteStatus> | null
  } | null>(null)
  const [siteRound, setSiteRound] = useState(0)
  const [aiCheck, setAiCheck] = useState<{
    key: string
    result: AiCheckResult | null
  } | null>(null)
  const mixedPort = useDisplayedMixedPort()
  // The site list and the AI details open under the same row, so only one shows at a time.
  const [openPanel, setOpenPanel] = useState<'sites' | 'ai' | null>(null)
  const togglePanel = (panel: 'sites' | 'ai') =>
    setOpenPanel((open) => (open === panel ? null : panel))

  const refreshPreflight = useCallback(async () => {
    try {
      setPreflight(await getPreflightReport())
    } catch (error) {
      console.error('[Proxy MVP] Preflight check failed:', error)
      setPreflight(null)
    }
  }, [])

  useEffect(() => {
    void refreshPreflight()
  }, [refreshPreflight])

  // Each of these reads as "connected, but nothing works", so it has to be said out loud. Only the
  // first applies: another VPN also owns the system proxy, and one fix clears both.
  const blocker = preflight?.foreignTunnel
    ? t('mvp.home.blockers.foreignTunnel')
    : preflight?.foreignSystemProxy
      ? t('mvp.home.blockers.foreignSystemProxy')
      : preflight?.staleProxyEnv
        ? t('mvp.home.blockers.staleProxyEnv')
        : null

  const currentNode = current?.kind === 'node' ? current : undefined
  // The node object is rebuilt on every proxy refresh; only a different node restarts the schedule.
  const currentNodeRef = useRef(currentNode)
  currentNodeRef.current = currentNode
  const node = currentNode?.ref.name
  const groupName = group?.name
  useEffect(() => {
    if (!indicator || !pageVisible || !node || !groupName) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const probe = async () => {
      const member = currentNodeRef.current
      if (!member) return
      const { delay } = await delayManager.checkDelay(
        member,
        groupName,
        timeout,
        0,
      )
      if (cancelled) return
      const prev =
        delayReadingRef.current?.node === node &&
        delayReadingRef.current.healthEpoch === healthEpoch
          ? delayReadingRef.current
          : { node, healthEpoch, samples: [], failures: 0, failedDelay: -1 }
      const next =
        classifyDelay(delay, timeout) === 'measured'
          ? {
              ...prev,
              samples: [...prev.samples, delay].slice(-DELAY_SAMPLES),
              failures: 0,
            }
          : { ...prev, failures: prev.failures + 1, failedDelay: delay }
      delayReadingRef.current = next
      setDelayReading(next)
      timer = setTimeout(
        () => void probe(),
        next.failures === 1 ? DELAY_RETRY_MS : DELAY_REFRESH_MS,
      )
    }
    void probe()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    indicator,
    pageVisible,
    node,
    groupName,
    timeout,
    delayRound,
    healthEpoch,
  ])

  const availableProfiles = useMemo(
    () =>
      (profiles?.items ?? []).filter(
        (item) => item.type === 'remote' || item.type === 'local',
      ),
    [profiles?.items],
  )
  const activeProfile =
    availableProfiles.find((item) => item.uid === profiles?.current) ??
    availableProfiles[0]
  const hasProfile = availableProfiles.length > 0

  useEffect(() => {
    if (!profiles || profiles.current || !activeProfile) return
    if (activationAttemptRef.current === activeProfile.uid) return
    activationAttemptRef.current = activeProfile.uid

    void (async () => {
      try {
        await activateMvpProfile(activeProfile.uid)
        await ensureMvpMode()
        await fetchProfilesIntoCache()
        await refreshAll()
      } catch (error) {
        console.error(
          '[Proxy MVP] Failed to activate the existing profile:',
          error,
        )
        showNotice.error(t('mvp.home.notices.activateFailed'))
      }
    })()
  }, [activeProfile, profiles, refreshAll, t])

  // Refresh the active subscription once a day, only once connected so the fetch can use the
  // tunnel. One attempt per day: a failing subscription must not be retried on every render.
  const currentProfile = availableProfiles.find(
    (item) => item.uid === profiles?.current,
  )
  useEffect(() => {
    if (!indicator || connecting || currentProfile?.type !== 'remote') return
    if (isProfileUpdatedToday(currentProfile)) return
    const attemptKey = `${currentProfile.uid}:${dayjs().format('YYYY-MM-DD')}`
    if (dailyUpdateAttemptRef.current === attemptKey) return
    dailyUpdateAttemptRef.current = attemptKey

    void (async () => {
      try {
        await updateProfile(currentProfile.uid)
        await fetchProfilesIntoCache()
        await ensureMvpMode()
        await refreshAll()
      } catch (error) {
        console.error('[Proxy MVP] Daily subscription update failed:', error)
      }
    })()
  }, [connecting, currentProfile, indicator, refreshAll])

  // A result only describes the connection, node and health stretch it was measured in.
  const speedKey = `${indicator}:${currentNode?.ref.name ?? ''}:${healthEpoch}`
  const speed = speedResult?.key === speedKey ? speedResult : null
  const onSpeedTest = useLockFn(async () => {
    setSpeedTesting(true)
    setSpeedProgress(0)
    try {
      const mbps = await measureDownloadMbps(setSpeedProgress, {
        latencyMs: await measureLatencyMs(),
      })
      setSpeedProgress(1)
      setSpeedResult({
        key: speedKey,
        mbps,
        time: new Date().toLocaleTimeString(),
      })
    } catch (error) {
      console.error('[Proxy MVP] Speed test failed:', error)
      showNotice.error(t('mvp.home.notices.speedTestFailed'))
    } finally {
      setSpeedTesting(false)
    }
  })

  const onUpdateSubscription = useLockFn(async () => {
    if (currentProfile?.type !== 'remote') return
    try {
      await updateProfile(currentProfile.uid)
      await fetchProfilesIntoCache()
      await ensureMvpMode()
      await refreshAll()
      showNotice.success(t('mvp.subscriptions.notices.updated'))
    } catch (error) {
      console.error('[Proxy MVP] Subscription update failed:', error)
      showNotice.error(t('mvp.subscriptions.notices.updateFailed'))
    }
  })

  const onRefreshAll = () => {
    void onSpeedTest()
    setSiteRound((round) => round + 1)
    setDelayRound((round) => round + 1)
  }

  // A newly chosen node gets its speed measured unasked; delay and sites follow on their own.
  useEffect(() => {
    if (!indicator || connecting || !node) return
    const switched = checkedNode !== undefined && checkedNode !== node
    checkedNode = node
    if (switched) void onSpeedTest()
  }, [connecting, indicator, node, onSpeedTest])

  // Sites are rechecked in the background like the delay; the cheap handshakes make this safe to
  // do unasked. Earlier results stay on screen until the new ones land.
  useEffect(() => {
    if (!indicator || connecting || !pageVisible || !node) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      setSiteCheck((prev) =>
        prev?.key === speedKey ? prev : { key: speedKey, results: null },
      )
      const results = await checkMvpSites()
      if (cancelled) return
      setSiteCheck({ key: speedKey, results })
      timer = setTimeout(() => void check(), SITE_REFRESH_MS)
    }
    void check()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [connecting, indicator, node, pageVisible, siteRound, speedKey])

  // The exit IP rarely changes under one node, so it is checked once per node and on ⌘R, not polled.
  useEffect(() => {
    if (!indicator || connecting || unhealthy || !node) return
    let cancelled = false
    void checkAi(mixedPort).then((result) => {
      if (!cancelled) setAiCheck({ key: speedKey, result })
    })
    return () => {
      cancelled = true
    }
  }, [connecting, indicator, mixedPort, node, siteRound, speedKey, unhealthy])

  const onImport = useLockFn(async () => {
    const normalizedUrl = url.trim()
    if (!isValidUrl(normalizedUrl)) {
      showNotice.error(t('mvp.common.invalidLink'))
      return
    }

    setImporting(true)
    importSteps.reset()
    try {
      await importAndActivateMvpProfile(normalizedUrl, importSteps.report)
      await fetchProfilesIntoCache()
      await refreshAll()
      importSteps.advance()
      setUrl('')
      showNotice.success(t('mvp.home.notices.importSuccess'))
    } catch (error) {
      importSteps.fail()
      console.error('[Proxy MVP] Subscription import failed:', error)
      showNotice.error(t('mvp.home.notices.importFailed'))
    } finally {
      setImporting(false)
    }
  })

  const onQrDetected = useLockFn(async (payload: string) => {
    setQrScannerOpen(false)
    setImporting(true)
    importSteps.reset()
    try {
      await importAndActivateMvpQrPayload(payload, importSteps.report)
      await fetchProfilesIntoCache()
      await refreshAll()
      importSteps.advance()
      showNotice.success(t('mvp.home.notices.qrImportSuccess'))
    } catch (error) {
      importSteps.fail()
      console.error('[Proxy MVP] QR import failed:', error)
      showNotice.error(t('mvp.common.invalidQr'))
    } finally {
      setImporting(false)
    }
  })

  const changeConnection = useLockFn(
    async (target: 'tunnel' | 'off', setupService = false) => {
      setConnecting(true)
      connectSteps.reset()
      let succeeded = false
      try {
        if (target === 'off') {
          await disconnectMvp(connectSteps.report)
        } else {
          const state = await getRuntimeState()
          if (!state.tunCapable && !setupService) {
            setSetupOpen(true)
            return
          }
          await connectMvpTunnel(setupService, connectSteps.report)
        }
        succeeded = true
        setSetupOpen(false)
      } catch (error) {
        connectSteps.fail()
        console.error('[Proxy MVP] Connection change failed:', error)
        // The setup dialog already asks the user to act, so a second alert would only repeat it.
        if (error instanceof MvpConnectionError && error.stage === 'start') {
          setSetupOpen(true)
          return
        }
        showNotice.error(
          target === 'off'
            ? t('mvp.home.notices.disconnectFailed')
            : error instanceof MvpConnectionError
              ? error.stage === 'setup'
                ? t('mvp.home.notices.setupIncomplete')
                : t('mvp.home.notices.connectFailedVpn')
              : t('mvp.home.notices.connectFailed'),
        )
      } finally {
        await Promise.allSettled([
          refreshAll(),
          revalidateQueries([['getVergeConfig'], ['getRuntimeState']]),
          refreshPreflight(),
        ])
        if (succeeded) connectSteps.advance()
        setConnecting(false)
      }
    },
  )

  const openNodes = () => {
    if (group) void testMainGroup(group.name, members, timeout)
    navigate('/nodes')
  }

  useMvpShortcuts([
    {
      key: ' ',
      onPress: () => {
        if (hasProfile && !connecting && !isRunStateLoading && !importing) {
          void changeConnection(needsDisconnect ? 'off' : 'tunnel')
        }
      },
    },
    {
      key: 'ArrowRight',
      allowInControl: true,
      onPress: () => {
        if (hasProfile && !connecting && !importing) openNodes()
      },
    },
    {
      key: 'r',
      command: true,
      onPress: () => {
        if (indicator && current && !speedTesting) onRefreshAll()
      },
    },
    {
      key: 's',
      allowInControl: true,
      onPress: () => {
        if (indicator && current) togglePanel('sites')
      },
    },
    {
      key: 'a',
      allowInControl: true,
      onPress: () => {
        if (indicator && current) togglePanel('ai')
      },
    },
    {
      key: 'u',
      command: true,
      onPress: () => {
        if (!connecting && !importing) void onUpdateSubscription()
      },
    },
  ])

  if (!profiles) return <HomeLoading />

  const settingsButton = (
    <Tooltip
      title={
        <MvpShortcutHint
          label={t('mvp.home.actions.settings')}
          shortcut={`${mvpCommandKey},`}
        />
      }
    >
      <IconButton
        aria-label={t('mvp.home.actions.settings')}
        aria-keyshortcuts={`${mvpCommandKey === '⌘' ? 'Meta' : 'Control'}+,`}
        onClick={() => navigate('/settings')}
      >
        <IconSettings size={22} />
      </IconButton>
    </Tooltip>
  )

  const blockerBanner = blocker && (
    <MvpBanner severity="warning" sx={{ mt: 1 }}>
      {blocker}
    </MvpBanner>
  )

  if (!hasProfile) {
    return (
      <MvpPage title="Openn" trailing={settingsButton}>
        {blockerBanner}
        <Stack
          spacing={3}
          sx={{
            minHeight: 430,
            justifyContent: 'center',
            maxWidth: 460,
            mx: 'auto',
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 30, fontWeight: 650, mb: 1 }}>
              {t('mvp.home.welcome.title')}
            </Typography>
            <Typography color="text.secondary">
              {t('mvp.home.welcome.subtitle')}
            </Typography>
          </Box>
          <TextField
            fullWidth
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onImport()
            }}
            placeholder="https://example.com/subscription"
            type="url"
            slotProps={{
              htmlInput: { 'aria-label': t('mvp.home.welcome.linkLabel') },
            }}
          />
          <Button
            size="large"
            variant="contained"
            disabled={importing || !url.trim()}
            onClick={onImport}
          >
            <MvpProgressRing
              busy={importing}
              size={22}
              color="inherit"
              segments={importSteps.segments}
            >
              {t('mvp.home.welcome.import')}
            </MvpProgressRing>
          </Button>
          <Button
            size="large"
            variant="text"
            startIcon={<IconScan size={20} />}
            disabled={importing}
            onClick={() => setQrScannerOpen(true)}
            sx={{ alignSelf: 'center', color: 'text.secondary' }}
          >
            {t('mvp.common.scanQr')}
          </Button>
          {qrScannerOpen && (
            <QrScannerDialog
              open
              onClose={() => setQrScannerOpen(false)}
              onDetected={onQrDetected}
            />
          )}
        </Stack>
      </MvpPage>
    )
  }

  const reading =
    delayReading?.node === current?.ref.name &&
    delayReading?.healthEpoch === healthEpoch
      ? delayReading
      : null
  // Until this page has its own reading, show whatever the node list measured last.
  const currentDelay = !reading
    ? current
      ? delays.of(current)
      : -1
    : reading.failures >= DELAY_FAILURES_TO_REPORT
      ? reading.failedDelay
      : reading.samples.length > 0
        ? median(reading.samples)
        : -2

  const siteResults = siteCheck?.key === speedKey ? siteCheck.results : null
  const sitesDown = MVP_SITES.filter(
    (site) => siteResults?.[site.id] === 'down',
  )
  // Every foreign site down while the domestic one loads points at the node, not the network.
  const foreignSitesDown = MVP_SITES.every(
    (site) => 'domestic' in site !== (siteResults?.[site.id] === 'down'),
  )
  const siteName = (site: (typeof MVP_SITES)[number]) =>
    site.name ?? t('mvp.home.sites.baidu')
  // Red is kept for a node that reaches nothing abroad; a site or two failing is yellow.
  const siteColor = !siteResults
    ? 'text.secondary'
    : MVP_SITES.every(
          (site) => 'domestic' in site || siteResults[site.id] === 'down',
        )
      ? 'error.main'
      : MVP_SITES.some((site) => siteResults[site.id] !== 'ok')
        ? 'warning.main'
        : 'success.main'
  const siteHint = !siteResults
    ? t('mvp.home.checking')
    : siteColor === 'error.main'
      ? t('mvp.home.sites.foreignDownHint')
      : siteColor === 'warning.main'
        ? t('mvp.home.sites.partialHint', {
            list: MVP_SITES.filter((site) => siteResults[site.id] !== 'ok')
              .map(
                (site) =>
                  `${siteName(site)} ${t(`mvp.home.sites.status.${siteResults[site.id]}`)}`,
              )
              .join(t('mvp.home.sites.separator')),
          })
        : t('mvp.home.sites.allOkHint')
  const aiResult = aiCheck?.key === speedKey ? aiCheck.result : null
  const delayState = classifyDelay(currentDelay, timeout)
  const chevron = (open: boolean) => (
    <Box
      component={IconChevronDown}
      size={15}
      sx={{
        mr: -0.5,
        transition: 'transform 200ms',
        transform: open ? 'rotate(180deg)' : 'none',
      }}
    />
  )
  // Anything the home page already sees going wrong is worth a look on the check page.
  const hasIssue =
    Boolean(blocker) ||
    (indicator &&
      Boolean(current) &&
      (sitesDown.length > 0 ||
        delayState === 'timeout' ||
        delayState === 'error'))
  const checkButton = (
    <Tooltip
      title={
        <MvpShortcutHint
          label={t('mvp.check.actions.open')}
          shortcut={`${mvpCommandKey}D`}
        />
      }
    >
      <IconButton
        aria-label={t('mvp.check.actions.open')}
        aria-keyshortcuts={`${mvpCommandKey === '⌘' ? 'Meta' : 'Control'}+D`}
        onClick={() => navigate('/check')}
      >
        <Badge
          color="error"
          variant="dot"
          invisible={!hasIssue}
          overlap="circular"
        >
          <IconActivity size={22} />
        </Badge>
      </IconButton>
    </Tooltip>
  )
  return (
    <MvpPage
      title="Openn"
      trailing={
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {checkButton}
          {settingsButton}
        </Box>
      }
    >
      {blockerBanner}
      <Stack spacing={5} sx={{ pt: { xs: 5, sm: 8 } }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                bgcolor: unhealthy
                  ? 'error.main'
                  : indicator
                    ? 'success.main'
                    : 'text.disabled',
              }}
            />
            <Typography
              color={indicator ? 'text.primary' : 'text.secondary'}
              sx={{ fontSize: 20, fontWeight: 650 }}
            >
              {unhealthy
                ? t('mvp.home.status.unhealthy')
                : indicator
                  ? t('mvp.home.status.connected')
                  : needsDisconnect && !connecting
                    ? t('mvp.home.status.pending')
                    : t('mvp.home.status.disconnected')}
            </Typography>
          </Box>
          <Tooltip
            describeChild
            title={
              <MvpShortcutHint
                label={t(
                  needsDisconnect
                    ? 'mvp.home.actions.disconnect'
                    : 'mvp.home.actions.connect',
                )}
                shortcut={t('mvp.common.space')}
              />
            }
          >
            <Box component="span" sx={{ display: 'inline-flex' }}>
              <Button
                variant="contained"
                size="large"
                aria-keyshortcuts="Space"
                disabled={connecting || isRunStateLoading}
                onClick={() =>
                  changeConnection(needsDisconnect ? 'off' : 'tunnel')
                }
                sx={{
                  minWidth: 138,
                  height: 42,
                  borderRadius: 999,
                  fontSize: 15,
                  fontWeight: 600,
                  boxShadow: indicator ? 'none' : undefined,
                  bgcolor: indicator ? 'text.primary' : undefined,
                  color: indicator ? 'background.paper' : undefined,
                  '&:hover': {
                    bgcolor: indicator ? 'text.secondary' : undefined,
                  },
                }}
              >
                {needsDisconnect
                  ? t('mvp.home.actions.disconnect')
                  : t('mvp.home.actions.connect')}
              </Button>
            </Box>
          </Tooltip>
          {unhealthy && (
            <Button onClick={() => navigate('/nodes')}>
              {t('mvp.home.actions.changeNode')}
            </Button>
          )}
          {systemProxyEnabled && indicator && !tunnelEnabled && (
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              {t('mvp.home.partialProxy')}
            </Typography>
          )}
          {needsDisconnect && !tunnelEnabled && !connecting && (
            <Button
              disabled={connecting}
              onClick={() => changeConnection('tunnel')}
            >
              {systemProxyEnabled && indicator
                ? t('mvp.home.actions.routeAllApps')
                : t('mvp.home.actions.reconnect')}
            </Button>
          )}
        </Stack>

        <Box
          sx={{
            py: 3,
            borderTop: 1,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography color="text.secondary" sx={{ fontSize: 13, mb: 1 }}>
            {t('mvp.home.currentNode')}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 19, fontWeight: 600 }}>
                {current?.ref.name ?? t('mvp.home.noNode')}
              </Typography>
              {current ? (
                <Box
                  sx={{
                    mt: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                  }}
                >
                  {unhealthy && (
                    <MvpStatusPill color="text.secondary">
                      {t('mvp.home.awaitingRecovery')}
                    </MvpStatusPill>
                  )}
                  {indicator && !unhealthy && (
                    <>
                      <Tooltip
                        title={
                          <MvpStatusHint
                            title={t('mvp.home.tags.sitesIntro')}
                            shortcut="S"
                          >
                            {siteHint}
                          </MvpStatusHint>
                        }
                      >
                        <MvpStatusPill
                          aria-keyshortcuts="S"
                          color={siteColor}
                          loading={!siteResults}
                          aria-expanded={openPanel === 'sites'}
                          aria-controls="mvp-site-list"
                          onClick={() => togglePanel('sites')}
                          endIcon={chevron(openPanel === 'sites')}
                        >
                          {t('mvp.home.tags.sites')}
                        </MvpStatusPill>
                      </Tooltip>
                      <Tooltip
                        title={
                          <MvpStatusHint
                            title={t('mvp.home.tags.aiIntro')}
                            shortcut="A"
                          >
                            {aiResult
                              ? t(`mvp.home.ai.verdict.${aiResult.verdict}`)
                              : t('mvp.home.checking')}
                          </MvpStatusHint>
                        }
                      >
                        <MvpStatusPill
                          aria-keyshortcuts="A"
                          color={
                            aiResult
                              ? aiVerdictColor(aiResult.verdict)
                              : 'text.secondary'
                          }
                          loading={!aiResult}
                          aria-expanded={openPanel === 'ai'}
                          aria-controls="mvp-ai-panel"
                          onClick={() => togglePanel('ai')}
                          endIcon={chevron(openPanel === 'ai')}
                        >
                          {t('mvp.home.tags.ai')}
                        </MvpStatusPill>
                      </Tooltip>
                    </>
                  )}
                  {!unhealthy && (
                    <Tooltip
                      title={
                        <MvpStatusHint title={t('mvp.home.tags.delayIntro')}>
                          {delayState === 'testing'
                            ? t('mvp.home.checking')
                            : mvpDelayHint(currentDelay, timeout)}
                        </MvpStatusHint>
                      }
                    >
                      <MvpStatusPill
                        color={mvpDelayColor(currentDelay, timeout)}
                        loading={delayState === 'testing'}
                      >
                        {delayState === 'testing' || delayState === 'untested'
                          ? t('mvp.home.tags.delay')
                          : formatMvpDelay(currentDelay, timeout)}
                      </MvpStatusPill>
                    </Tooltip>
                  )}
                  {indicator && !unhealthy && (
                    <>
                      <Tooltip
                        title={
                          <MvpStatusHint title={t('mvp.home.tags.speedIntro')}>
                            {speedTesting
                              ? t('mvp.home.checking')
                              : speed
                                ? mvpSpeedHint(speed.mbps)
                                : t('mvp.home.speedTestPrompt')}
                          </MvpStatusHint>
                        }
                      >
                        <MvpStatusPill
                          color={
                            speed && !speedTesting
                              ? mvpSpeedTier(speed.mbps).color
                              : 'text.secondary'
                          }
                          loading={speedTesting}
                        >
                          {speed && !speedTesting
                            ? mvpSpeedTier(speed.mbps).label
                            : t('mvp.home.tags.speed')}
                        </MvpStatusPill>
                      </Tooltip>
                      <Tooltip
                        title={
                          <MvpShortcutHint
                            label={t('mvp.home.actions.retest')}
                            shortcut={`${mvpCommandKey}R`}
                          />
                        }
                      >
                        <IconButton
                          size="small"
                          aria-label={t('mvp.home.actions.retest')}
                          aria-keyshortcuts={`${mvpCommandKey === '⌘' ? 'Meta' : 'Control'}+R`}
                          onClick={() => !speedTesting && onRefreshAll()}
                          sx={{ p: 0.5, color: 'text.secondary' }}
                        >
                          <MvpProgressRing
                            busy={speedTesting}
                            size={17}
                            segments={fractionSegments(speedProgress, 3)}
                          >
                            <IconRefresh size={17} />
                          </MvpProgressRing>
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Box>
              ) : (
                <Typography
                  color="text.secondary"
                  sx={{ mt: 0.5, fontSize: 14 }}
                >
                  {t('mvp.home.nodeUnavailable')}
                </Typography>
              )}
            </Box>
            <Tooltip
              title={
                <MvpShortcutHint
                  label={t('mvp.home.actions.changeNode')}
                  shortcut="→"
                />
              }
            >
              <IconButton
                aria-label={t('mvp.home.actions.changeNode')}
                aria-keyshortcuts="ArrowRight"
                onClick={openNodes}
                sx={{ flexShrink: 0 }}
              >
                <IconArrowRight size={22} />
              </IconButton>
            </Tooltip>
          </Box>
          {indicator && current && !unhealthy && (
            <>
              <Collapse in={openPanel === 'sites'} id="mvp-site-list">
                <Box
                  sx={{
                    mt: 2,
                    px: 1.75,
                    py: 0.75,
                    borderRadius: 2.5,
                    bgcolor: 'background.paper',
                    border: 1,
                    borderColor: 'divider',
                  }}
                >
                  {MVP_SITES.map((site) => {
                    const status = siteResults?.[site.id]
                    const statusLabel = t(
                      `mvp.home.sites.status.${status ?? 'checking'}`,
                    )
                    return (
                      <Box
                        key={site.id}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.25,
                          py: 0.875,
                          fontSize: 14,
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          {site.name ?? t('mvp.home.sites.baidu')}
                        </Box>
                        <Tooltip title={statusLabel}>
                          <Box
                            component="span"
                            role="img"
                            aria-label={statusLabel}
                            sx={{
                              display: 'flex',
                              flexShrink: 0,
                              color: !status
                                ? 'text.disabled'
                                : status === 'down'
                                  ? 'error.main'
                                  : 'success.main',
                            }}
                          >
                            {!status ? (
                              <MvpProgressRing busy size={18} />
                            ) : status === 'down' ? (
                              <IconX size={18} aria-hidden />
                            ) : (
                              <IconCheck size={18} aria-hidden />
                            )}
                          </Box>
                        </Tooltip>
                      </Box>
                    )
                  })}
                  {foreignSitesDown && (
                    <Box
                      role="note"
                      sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1,
                        my: 0.75,
                        px: 1.5,
                        py: 1,
                        bgcolor: '#191C1D',
                        color: '#FAFAFA',
                        border: '1px solid #303334',
                        borderRadius: '11px',
                        fontSize: 13,
                        lineHeight: '18px',
                        boxShadow:
                          '0 8px 24px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.12) !important',
                      }}
                    >
                      <IconInfoCircle
                        size={18}
                        aria-hidden
                        style={{ flexShrink: 0 }}
                      />
                      <Box>{t('mvp.home.sites.foreignDownHint')}</Box>
                    </Box>
                  )}
                </Box>
              </Collapse>
              <Collapse in={openPanel === 'ai'} id="mvp-ai-panel">
                <Box
                  sx={{
                    mt: 2,
                    px: 1.75,
                    py: 1.5,
                    borderRadius: 2.5,
                    bgcolor: 'background.paper',
                    border: 1,
                    borderColor: 'divider',
                  }}
                >
                  <MvpAiPanel result={aiResult} onChangeNode={openNodes} />
                </Box>
              </Collapse>
            </>
          )}
        </Box>
      </Stack>
      <BaseDialog
        open={setupOpen}
        icon={<IconShieldCheck size={24} />}
        title={t('mvp.home.setup.title')}
        okBtn={t('mvp.home.setup.confirm')}
        cancelBtn={t('mvp.common.cancel')}
        loading={connecting}
        loadingIndicator={
          <MvpProgressRing
            size={18}
            color="inherit"
            segments={connectSteps.segments}
          />
        }
        onClose={() => !connecting && setSetupOpen(false)}
        onCancel={() => !connecting && setSetupOpen(false)}
        onOk={() => changeConnection('tunnel', true)}
        contentSx={{ width: { xs: 280, sm: 300 } }}
      >
        <Typography variant="body2">{t('mvp.home.setup.body')}</Typography>
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          {t('mvp.home.setup.vpnHint')}
        </Typography>
      </BaseDialog>
    </MvpPage>
  )
}

export default MvpHomePage
