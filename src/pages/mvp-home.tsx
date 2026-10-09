import {
  ArrowForwardRounded,
  QrCodeScannerRounded,
  RefreshRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { MvpPage } from '@/components/mvp/mvp-page'
import { QrScannerDialog } from '@/components/mvp/qr-scanner-dialog'
import { testMainGroup, useMainProxyGroup } from '@/hooks/use-main-proxy-group'
import { fetchProfilesIntoCache, useProfiles } from '@/hooks/use-profiles'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'
import {
  useAppRefreshers,
  useClashConfigData,
} from '@/providers/app-data-context'
import {
  getPreflightReport,
  getRuntimeState,
  type PreflightReport,
  updateProfile,
} from '@/services/cmds'
import delayManager from '@/services/delay'
import {
  activateMvpProfile,
  ensureRuleMode,
  importAndActivateMvpProfile,
  importAndActivateMvpQrPayload,
  isProfileUpdatedToday,
} from '@/services/mvp'
import {
  connectMvpTunnel,
  disconnectMvp,
  MvpConnectionError,
} from '@/services/mvp-connection'
import { hideNotice, showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'
import { measureDownloadMbps } from '@/services/speed-test'
import { classifyDelay } from '@/utils/delay'
import {
  formatMvpDelay,
  mvpDelayColor,
  mvpDelayHint,
  mvpSpeedHint,
  mvpSpeedTier,
} from '@/utils/main-proxy-group'
import { isValidUrl } from '@/utils/network'

const HomeLoading = () => (
  <Box sx={{ minHeight: 420, display: 'grid', placeItems: 'center' }}>
    <CircularProgress size={24} />
  </Box>
)

const DELAY_REFRESH_MS = 30_000
const DELAY_RETRY_MS = 3_000
// One probe swings with every network hiccup; the median of the last few is what browsing feels like.
const DELAY_SAMPLES = 3
// A single lost probe is common on a healthy node; only repeated failures mean it is unusable.
const DELAY_FAILURES_TO_REPORT = 2

type DelayReading = {
  node: string
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
  const navigate = useNavigate()
  const { profiles } = useProfiles()
  const { refreshAll } = useAppRefreshers()
  const { indicator: systemProxyEnabled } = useSystemProxyState()
  const { runState, isLoading: isRunStateLoading } = useSystemState()
  const { verge } = useVerge()
  const { clashConfig } = useClashConfigData()
  const tunnelEnabled = Boolean(
    verge?.enable_tun_mode &&
      runState.tunCapable &&
      runState.mode !== 'NotRunning' &&
      clashConfig?.tun.enable &&
      clashConfig.tun.autoRoute,
  )
  const indicator =
    tunnelEnabled || (systemProxyEnabled && runState.mode !== 'NotRunning')
  const needsDisconnect = systemProxyEnabled || Boolean(verge?.enable_tun_mode)
  const {
    group,
    members,
    current,
    delays,
    timeout,
  } = useMainProxyGroup()
  const pageVisible = useVisibility()
  const [speedResult, setSpeedResult] = useState<{
    key: string
    mbps: number
    time: string
  } | null>(null)
  const [speedTesting, setSpeedTesting] = useState(false)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [preflight, setPreflight] = useState<PreflightReport | null>(null)
  const activationAttemptRef = useRef<string | null>(null)
  const dailyUpdateAttemptRef = useRef<string | null>(null)
  const delayReadingRef = useRef<DelayReading | null>(null)
  const [delayReading, setDelayReading] = useState<DelayReading | null>(null)

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
    ? '检测到 Shadowrocket 等其他 VPN 正在运行。请先退出它，再点「连接」。'
    : preflight?.foreignSystemProxy
      ? '系统代理被其他软件占用，可能导致网页打不开。请先退出那个软件，再点「连接」。'
      : preflight?.staleProxyEnv
        ? '电脑里残留了旧的代理设置，部分应用可能连不上。重启电脑即可清除。'
        : null
  useEffect(() => {
    if (!blocker) return
    const id = showNotice.warning(blocker, 0)
    return () => hideNotice(id)
  }, [blocker])

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
        delayReadingRef.current?.node === node
          ? delayReadingRef.current
          : { node, samples: [], failures: 0, failedDelay: -1 }
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
  }, [indicator, pageVisible, node, groupName, timeout])

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
        await ensureRuleMode()
        await fetchProfilesIntoCache()
        await refreshAll()
      } catch (error) {
        console.error(
          '[Proxy MVP] Failed to activate the existing profile:',
          error,
        )
        showNotice.error('配置应用失败，请稍后重试')
      }
    })()
  }, [activeProfile, profiles, refreshAll])

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
        await ensureRuleMode()
        await refreshAll()
      } catch (error) {
        console.error('[Proxy MVP] Daily subscription update failed:', error)
      }
    })()
  }, [connecting, currentProfile, indicator, refreshAll])

  // A result only describes the connection and node it was measured on.
  const speedKey = `${indicator}:${currentNode?.ref.name ?? ''}`
  const speed = speedResult?.key === speedKey ? speedResult : null
  const onSpeedTest = useLockFn(async () => {
    setSpeedTesting(true)
    try {
      const mbps = await measureDownloadMbps()
      setSpeedResult({
        key: speedKey,
        mbps,
        time: new Date().toLocaleTimeString(),
      })
    } catch (error) {
      console.error('[Proxy MVP] Speed test failed:', error)
      showNotice.error('测速失败，请稍后重试')
    } finally {
      setSpeedTesting(false)
    }
  })

  const onImport = useLockFn(async () => {
    const normalizedUrl = url.trim()
    if (!isValidUrl(normalizedUrl)) {
      showNotice.error('配置链接无效')
      return
    }

    setImporting(true)
    try {
      await importAndActivateMvpProfile(normalizedUrl)
      await fetchProfilesIntoCache()
      await refreshAll()
      setUrl('')
      showNotice.success('订阅导入成功')
    } catch (error) {
      console.error('[Proxy MVP] Subscription import failed:', error)
      showNotice.error('订阅导入失败')
    } finally {
      setImporting(false)
    }
  })

  const onQrDetected = useLockFn(async (payload: string) => {
    setQrScannerOpen(false)
    setImporting(true)
    try {
      await importAndActivateMvpQrPayload(payload)
      await fetchProfilesIntoCache()
      await refreshAll()
      showNotice.success('二维码导入成功')
    } catch (error) {
      console.error('[Proxy MVP] QR import failed:', error)
      showNotice.error('二维码无效或暂不支持')
    } finally {
      setImporting(false)
    }
  })

  const changeConnection = useLockFn(
    async (target: 'tunnel' | 'off', setupService = false) => {
      setConnecting(true)
      try {
        if (target === 'off') {
          await disconnectMvp()
        } else {
          const state = await getRuntimeState()
          if (!state.tunCapable && !setupService) {
            setSetupOpen(true)
            return
          }
          await connectMvpTunnel(setupService)
        }
        setSetupOpen(false)
      } catch (error) {
        console.error('[Proxy MVP] Connection change failed:', error)
        // The setup dialog already asks the user to act, so a second alert would only repeat it.
        if (error instanceof MvpConnectionError && error.stage === 'start') {
          setSetupOpen(true)
          return
        }
        showNotice.error(
          target === 'off'
            ? '断开失败，请再试一次'
            : error instanceof MvpConnectionError
              ? error.stage === 'setup'
                ? '授权没有完成，请再点一次「连接」'
                : '连接失败。如果开着 Shadowrocket 等其他 VPN，请先退出它再试'
              : '连接失败，请再试一次',
        )
      } finally {
        await Promise.allSettled([
          refreshAll(),
          revalidateQueries([['getVergeConfig'], ['getRuntimeState']]),
          refreshPreflight(),
        ])
        setConnecting(false)
      }
    },
  )

  if (!profiles) return <HomeLoading />

  if (!hasProfile) {
    return (
      <MvpPage title="Openn">
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
              欢迎使用 Openn
            </Typography>
            <Typography color="text.secondary">粘贴订阅链接即可开始</Typography>
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
            slotProps={{ htmlInput: { 'aria-label': '订阅链接' } }}
          />
          <Button
            size="large"
            variant="contained"
            disabled={importing || !url.trim()}
            onClick={onImport}
            sx={{ height: 52, borderRadius: 2, fontWeight: 650 }}
          >
            {importing ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              '导入'
            )}
          </Button>
          <Button
            size="large"
            variant="text"
            startIcon={<QrCodeScannerRounded />}
            disabled={importing}
            onClick={() => setQrScannerOpen(true)}
            sx={{ alignSelf: 'center', color: 'text.secondary' }}
          >
            扫描二维码
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

  const reading = delayReading?.node === current?.ref.name ? delayReading : null
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

  return (
    <MvpPage title="Openn">
      <Stack spacing={5} sx={{ pt: { xs: 5, sm: 8 } }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                bgcolor: indicator ? 'success.main' : 'text.disabled',
              }}
            />
            <Typography
              color={indicator ? 'text.primary' : 'text.secondary'}
              sx={{ fontSize: 20, fontWeight: 650 }}
            >
              {indicator ? '已连接' : needsDisconnect ? '连接待恢复' : '未连接'}
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="large"
            disabled={connecting || isRunStateLoading}
            onClick={() => changeConnection(needsDisconnect ? 'off' : 'tunnel')}
            sx={{
              minWidth: 138,
              height: 42,
              borderRadius: 999,
              fontSize: 15,
              fontWeight: 600,
              boxShadow: indicator ? 'none' : undefined,
              bgcolor: indicator ? 'text.primary' : undefined,
              color: indicator ? 'background.paper' : undefined,
              '&:hover': { bgcolor: indicator ? 'text.secondary' : undefined },
            }}
          >
            {connecting ? (
              <CircularProgress size={22} color="inherit" />
            ) : needsDisconnect ? (
              '断开连接'
            ) : (
              '连接'
            )}
          </Button>
          {systemProxyEnabled && indicator && !tunnelEnabled && (
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              目前只有浏览器等部分应用走代理
            </Typography>
          )}
          {needsDisconnect && !tunnelEnabled && (
            <Button
              disabled={connecting}
              onClick={() => changeConnection('tunnel')}
            >
              {systemProxyEnabled && indicator
                ? '让所有应用都走代理'
                : '重新连接'}
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
            当前节点
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
                {current?.ref.name ?? '暂无可用节点'}
              </Typography>
              <Box
                sx={{
                  mt: 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <Tooltip
                  title={current ? mvpDelayHint(currentDelay, timeout) : ''}
                >
                  <Typography
                    sx={{
                      fontSize: 14,
                      fontVariantNumeric: 'tabular-nums',
                      cursor: 'help',
                      color: current
                        ? mvpDelayColor(currentDelay, timeout)
                        : 'text.secondary',
                    }}
                  >
                    {current
                      ? formatMvpDelay(currentDelay, timeout)
                      : '当前节点不可用，请更换节点'}
                  </Typography>
                </Tooltip>
                {current && indicator && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Tooltip
                      title={
                        speed ? mvpSpeedHint(speed.mbps) : '点击右侧按钮测速'
                      }
                    >
                      <Typography
                        sx={{
                          fontSize: 14,
                          cursor: 'help',
                          color: speed
                            ? mvpSpeedTier(speed.mbps).color
                            : 'text.secondary',
                        }}
                      >
                        {speed ? mvpSpeedTier(speed.mbps).label : '未测速'}
                      </Typography>
                    </Tooltip>
                    <Tooltip title={speedTesting ? '测速中…' : '重新测速'}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label="重新测速"
                          disabled={speedTesting}
                          onClick={onSpeedTest}
                          sx={{ p: 0.25 }}
                        >
                          {speedTesting ? (
                            <CircularProgress size={14} />
                          ) : (
                            <RefreshRounded sx={{ fontSize: 16 }} />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                )}
              </Box>
            </Box>
            <Tooltip title="更换节点">
              <IconButton
                aria-label="更换节点"
                onClick={() => {
                  if (group) void testMainGroup(group.name, members, timeout)
                  navigate('/nodes')
                }}
                sx={{ flexShrink: 0 }}
              >
                <ArrowForwardRounded />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Stack>
      <Dialog
        open={setupOpen}
        onClose={() => !connecting && setSetupOpen(false)}
      >
        <DialogTitle>需要授权一次</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Openn
            需要安装一个后台组件，系统会请你输入电脑密码。只需授权这一次，之后点连接即可。
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            如果开着 Shadowrocket 等其他 VPN，请先退出。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={connecting} onClick={() => setSetupOpen(false)}>
            取消
          </Button>
          <Button
            loading={connecting}
            variant="contained"
            onClick={() => changeConnection('tunnel', true)}
          >
            授权并连接
          </Button>
        </DialogActions>
      </Dialog>
    </MvpPage>
  )
}

export default MvpHomePage
