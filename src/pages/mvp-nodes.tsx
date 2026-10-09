import {
  AddRounded,
  ArrowBackRounded,
  CheckBoxOutlineBlankRounded,
  CheckBoxRounded,
  CheckRounded,
  CloseRounded,
  DeleteOutlineRounded,
  ExpandMoreRounded,
  PushPinOutlined,
  PushPinRounded,
  QrCodeScannerRounded,
  RefreshRounded,
  SpeedRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { keyframes } from '@mui/material/styles'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'

import { BaseDialog } from '@/components/base'
import { MvpPage } from '@/components/mvp/mvp-page'
import { QrScannerDialog } from '@/components/mvp/qr-scanner-dialog'
import { testMainGroup, useMainProxyGroup } from '@/hooks/use-main-proxy-group'
import { fetchProfilesIntoCache, useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useAppRefreshers } from '@/providers/app-data-context'
import { deleteProfile, updateProfile } from '@/services/cmds'
import {
  activateMvpProfile,
  ensureRuleMode,
  formatProfileUpdated,
  importAndActivateMvpProfile,
  importAndActivateMvpQrPayload,
} from '@/services/mvp'
import { showNotice } from '@/services/notice-service'
import type { InteractableProxyMember } from '@/types/proxy-view'
import { classifyDelay } from '@/utils/delay'
import { formatMvpDelay, mvpDelayColor } from '@/utils/main-proxy-group'
import { isValidUrl } from '@/utils/network'

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

const profileSource = (profile: IProfileItem) => {
  if (profile.type === 'local') return '本地配置'
  if (!profile.url) return '远程订阅'

  try {
    return new URL(profile.url).host
  } catch {
    return '远程订阅'
  }
}

const PINNED_NODES_KEY = 'mvp-pinned-nodes'

type PinnedNodes = Record<string, string[]>

const readPinnedNodes = (): PinnedNodes => {
  try {
    const data = JSON.parse(localStorage.getItem(PINNED_NODES_KEY) ?? '{}')
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

const MvpNodesPage = () => {
  const navigate = useNavigate()
  const { profiles } = useProfiles()
  const { refreshAll, refreshProxy } = useAppRefreshers()
  const { group, members, delays, timeout, isLoading, isError } =
    useMainProxyGroup()
  const [running, setRunning] = useState(false)
  // A test started from the home page is already in flight when this page mounts.
  const testing = running || members.some((member) => delays.of(member) === -2)
  // Batch results are cached as they land but only announced at the end, so poll for progress.
  const [, refreshProgress] = useReducer((tick: number) => tick + 1, 0)
  useEffect(() => {
    if (!testing) return
    const timer = setInterval(refreshProgress, 150)
    return () => clearInterval(timer)
  }, [testing])
  const testedCount = members.filter(
    (member) => delays.of(member) !== -2,
  ).length
  const [prevTesting, setPrevTesting] = useState(testing)
  const [settleCount, setSettleCount] = useState(0)
  if (prevTesting !== testing) {
    setPrevTesting(testing)
    if (prevTesting) setSettleCount((count) => count + 1)
  }
  const [switching, setSwitching] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [profileAction, setProfileAction] = useState<{
    uid: string
    kind: 'activate' | 'update'
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<IProfileItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [timeoutOpen, setTimeoutOpen] = useState(false)
  const [pinnedNodes, setPinnedNodes] = useState(readPinnedNodes)
  // Non-null while choosing pins; applied to the list only on confirm.
  const [pinDraft, setPinDraft] = useState<string[] | null>(null)
  const pinScope = `${profiles?.current ?? ''}::${group?.name ?? ''}`
  const pinned = useMemo(
    () => new Set(pinnedNodes[pinScope] ?? []),
    [pinnedNodes, pinScope],
  )

  const onPinButton = () => {
    if (!pinDraft) {
      setPinDraft(
        members
          .map((member) => member.ref.name)
          .filter((name) => pinned.has(name)),
      )
      return
    }
    const next = { ...pinnedNodes, [pinScope]: pinDraft }
    setPinnedNodes(next)
    setPinDraft(null)
    try {
      localStorage.setItem(PINNED_NODES_KEY, JSON.stringify(next))
    } catch {}
  }

  const togglePinDraft = (name: string) =>
    setPinDraft((draft) =>
      draft?.includes(name)
        ? draft.filter((item) => item !== name)
        : [...(draft ?? []), name],
    )

  const availableProfiles = useMemo(
    () =>
      (profiles?.items ?? []).filter(
        (item) => item.type === 'remote' || item.type === 'local',
      ),
    [profiles?.items],
  )

  const sortedMembers = useMemo(
    () =>
      members
        .map((member, index) => ({
          member,
          index,
          delay: delays.of(member),
          pinned: pinned.has(member.ref.name),
        }))
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          const aDelay =
            a.delay > 0 && a.delay < timeout
              ? a.delay
              : Number.POSITIVE_INFINITY
          const bDelay =
            b.delay > 0 && b.delay < timeout
              ? b.delay
              : Number.POSITIVE_INFINITY

          return aDelay - bDelay || a.index - b.index
        })
        .map(({ member }) => member),
    [delays, members, pinned, timeout],
  )

  const { changeProxy } = useProxySelection({
    onSuccess: () => {
      setSwitching(null)
      void refreshProxy()
      navigate('/')
    },
    onError: (error) => {
      console.error('[Proxy MVP] Node switch failed:', error)
      setSwitching(null)
      showNotice.error('节点切换失败')
      void refreshProxy()
    },
  })

  const onTestAll = useLockFn(async () => {
    if (!group || members.length === 0) return
    setRunning(true)
    try {
      await testMainGroup(group.name, members, timeout)
    } finally {
      setRunning(false)
    }
  })

  // Test once per node list on arrival, but only when some node has no result yet.
  const autoTestedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (isLoading || !group || members.length === 0 || testing) return
    const key = `${group.name}::${members.map((member) => member.ref.name).join('\n')}`
    if (autoTestedKeyRef.current === key) return
    autoTestedKeyRef.current = key
    const hasUntested = members.some(
      (member) => classifyDelay(delays.of(member), timeout) === 'untested',
    )
    if (hasUntested) void onTestAll()
  }, [delays, group, isLoading, members, onTestAll, testing, timeout])

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
      showNotice.success('订阅已添加并启用')
    } catch (error) {
      console.error('[Proxy MVP] Subscription import failed:', error)
      showNotice.error('订阅添加失败')
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
      showNotice.success('订阅已添加并启用')
    } catch (error) {
      console.error('[Proxy MVP] QR import failed:', error)
      showNotice.error('二维码无效或暂不支持')
    } finally {
      setImporting(false)
    }
  })

  const onActivateProfile = useLockFn(async (profile: IProfileItem) => {
    if (profile.uid === profiles?.current) return

    setProfileAction({ uid: profile.uid, kind: 'activate' })
    try {
      await activateMvpProfile(profile.uid)
      await ensureRuleMode()
      await fetchProfilesIntoCache()
      await refreshAll()
      showNotice.success('订阅已切换')
    } catch (error) {
      console.error('[Proxy MVP] Profile activation failed:', error)
      showNotice.error('订阅切换失败')
    } finally {
      setProfileAction(null)
    }
  })

  const onUpdateProfile = useLockFn(async (profile: IProfileItem) => {
    if (profile.type !== 'remote') return

    setProfileAction({ uid: profile.uid, kind: 'update' })
    try {
      await updateProfile(profile.uid)
      await fetchProfilesIntoCache()
      if (profile.uid === profiles?.current) {
        await ensureRuleMode()
        await refreshAll()
      }
      showNotice.success('订阅已更新')
    } catch (error) {
      console.error('[Proxy MVP] Subscription update failed:', error)
      showNotice.error('订阅更新失败')
    } finally {
      setProfileAction(null)
    }
  })

  const onDeleteProfile = useLockFn(async () => {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      await deleteProfile(deleteTarget.uid)
      const remainingProfiles = await fetchProfilesIntoCache()
      if (remainingProfiles.current) {
        await ensureRuleMode()
        await refreshAll()
      }
      setDeleteTarget(null)
      showNotice.success('订阅已删除')
    } catch (error) {
      console.error('[Proxy MVP] Subscription deletion failed:', error)
      showNotice.error('订阅删除失败')
    } finally {
      setDeleting(false)
    }
  })

  const isTimedOut = (member: InteractableProxyMember) => {
    if (pinned.has(member.ref.name)) return false
    const kind = classifyDelay(delays.of(member), timeout)
    return kind === 'timeout' || kind === 'error'
  }
  const timedOutMembers = testing ? [] : sortedMembers.filter(isTimedOut)
  const visibleMembers = testing
    ? sortedMembers
    : sortedMembers.filter((member) => !isTimedOut(member))

  const renderRow = (member: InteractableProxyMember) => {
    const name = member.ref.name
    const selected = group?.now === name
    const pinChecked = pinDraft?.includes(name)
    const delay = delays.of(member)
    const memberKey =
      member.kind === 'node'
        ? `node-${member.node.recordId}`
        : `group-${member.group.name}`

    return (
      <Box
        component="button"
        type="button"
        key={memberKey}
        disabled={switching !== null}
        onClick={() => {
          if (pinDraft) {
            togglePinDraft(name)
            return
          }
          setSwitching(name)
          if (group) changeProxy(group.name, name, group.now, group.fixed)
        }}
        sx={{
          width: '100%',
          minHeight: 64,
          px: 1,
          display: 'grid',
          gridTemplateColumns: pinDraft
            ? '28px 28px minmax(0, 1fr) auto'
            : '28px minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: 1.5,
          border: 0,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'transparent',
          color: 'text.primary',
          textAlign: 'left',
          cursor: 'pointer',
          font: 'inherit',
          '&:hover': { bgcolor: 'action.hover' },
          '&:disabled': { cursor: 'default', opacity: 0.72 },
        }}
      >
        {pinDraft && (
          <Box sx={{ display: 'grid', placeItems: 'center' }}>
            {pinChecked ? (
              <CheckBoxRounded color="primary" fontSize="small" />
            ) : (
              <CheckBoxOutlineBlankRounded
                fontSize="small"
                sx={{ color: 'text.secondary' }}
              />
            )}
          </Box>
        )}
        <Box sx={{ display: 'grid', placeItems: 'center' }}>
          {switching === name ? (
            <CircularProgress size={17} />
          ) : selected ? (
            <CheckRounded color="primary" fontSize="small" />
          ) : null}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {!pinDraft && pinned.has(name) && (
            <PushPinRounded
              color="primary"
              sx={{ fontSize: 15, mr: 0.75, flexShrink: 0 }}
            />
          )}
          <Typography
            noWrap
            sx={{ fontSize: 15.5, fontWeight: selected ? 600 : 450 }}
          >
            {name}
          </Typography>
        </Box>
        <Typography
          sx={{
            fontSize: 13.5,
            color: mvpDelayColor(delay, timeout),
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatMvpDelay(delay, timeout)}
        </Typography>
      </Box>
    )
  }

  if (profiles && availableProfiles.length === 0) {
    return <Navigate to="/" replace />
  }

  return (
    <MvpPage
      title="节点"
      leading={
        <IconButton aria-label="返回" onClick={() => navigate('/')}>
          <ArrowBackRounded />
        </IconButton>
      }
      trailing={
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Tooltip title={pinDraft ? '完成' : '置顶节点'}>
            <span>
              <IconButton
                aria-label={pinDraft ? '完成' : '置顶节点'}
                disabled={members.length === 0}
                onClick={onPinButton}
              >
                {!pinDraft ? (
                  <PushPinOutlined />
                ) : pinDraft.length === 0 ? (
                  <CloseRounded />
                ) : (
                  <CheckRounded />
                )}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={testing ? '测速中…' : '全部测速'}>
            <span>
              <IconButton
                aria-label="全部测速"
                disabled={testing || members.length === 0}
                onClick={onTestAll}
              >
                {testing ? (
                  <CircularProgress
                    size={22}
                    variant="determinate"
                    value={(testedCount / Math.max(members.length, 1)) * 100}
                  />
                ) : (
                  <SpeedRounded />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      }
    >
      <Stack spacing={5}>
        <Box>
          {isLoading ? (
            <Box sx={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : isError || !group || members.length === 0 ? (
            <Box sx={{ py: 10, textAlign: 'center' }}>
              <Typography color="text.secondary">
                当前节点不可用，请先检查订阅
              </Typography>
            </Box>
          ) : (
            <Stack
              key={settleCount}
              sx={{
                borderTop: 1,
                borderColor: 'divider',
                animation: settleCount ? `${fadeIn} 500ms ease` : undefined,
              }}
            >
              {visibleMembers.map(renderRow)}
              {timedOutMembers.length > 0 && (
                <>
                  <Tooltip
                    title={`${timeout / 1000} 秒内没有响应或连接失败的节点`}
                  >
                    <Box
                      component="button"
                      type="button"
                      aria-expanded={timeoutOpen}
                      onClick={() => setTimeoutOpen((open) => !open)}
                      sx={{
                        width: '100%',
                        minHeight: 48,
                        px: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        border: 0,
                        borderBottom: 1,
                        borderColor: 'divider',
                        bgcolor: 'transparent',
                        color: 'text.secondary',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 13.5,
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <span>不可用 · {timedOutMembers.length}</span>
                      <ExpandMoreRounded
                        fontSize="small"
                        sx={{
                          transition: 'transform 0.2s',
                          transform: timeoutOpen ? 'rotate(180deg)' : 'none',
                        }}
                      />
                    </Box>
                  </Tooltip>
                  <Collapse in={timeoutOpen} unmountOnExit>
                    {timedOutMembers.map(renderRow)}
                  </Collapse>
                </>
              )}
            </Stack>
          )}
        </Box>

        <Box>
          <Divider sx={{ mb: 3 }} />
          <Typography sx={{ fontSize: 18, fontWeight: 650, mb: 0.5 }}>
            订阅管理
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13, mb: 2 }}>
            添加、切换或删除订阅链接
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mb: 2.5 }}>
            <TextField
              fullWidth
              size="small"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && url.trim()) void onImport()
              }}
              placeholder="粘贴新的订阅链接"
              type="url"
              slotProps={{ htmlInput: { 'aria-label': '新的订阅链接' } }}
            />
            <Button
              variant="contained"
              startIcon={
                importing ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <AddRounded />
                )
              }
              disabled={importing || !url.trim()}
              onClick={onImport}
              sx={{ flexShrink: 0 }}
            >
              添加
            </Button>
            <Tooltip title="扫描二维码">
              <span>
                <IconButton
                  aria-label="扫描二维码"
                  disabled={importing}
                  onClick={() => setQrScannerOpen(true)}
                >
                  <QrCodeScannerRounded />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Stack sx={{ borderTop: 1, borderColor: 'divider' }}>
            {availableProfiles.map((profile) => {
              const active = profile.uid === profiles?.current
              const busy = profileAction?.uid === profile.uid
              const activating = busy && profileAction.kind === 'activate'
              const updating = busy && profileAction.kind === 'update'

              return (
                <Box
                  key={profile.uid}
                  sx={{
                    minHeight: 68,
                    px: 1,
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    alignItems: 'center',
                    gap: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography
                        noWrap
                        sx={{ fontSize: 15, fontWeight: active ? 650 : 500 }}
                      >
                        {profile.name || profileSource(profile)}
                      </Typography>
                      {active && (
                        <Typography color="primary" sx={{ fontSize: 12 }}>
                          当前
                        </Typography>
                      )}
                    </Box>
                    <Typography
                      noWrap
                      color="text.secondary"
                      sx={{ fontSize: 12.5, mt: 0.25 }}
                    >
                      {profileSource(profile)}
                      {profile.type === 'remote' &&
                        ` · ${formatProfileUpdated(profile.updated)}`}
                    </Typography>
                  </Box>

                  <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}
                  >
                    {!active && (
                      <Button
                        size="small"
                        disabled={profileAction !== null || importing}
                        onClick={() => onActivateProfile(profile)}
                      >
                        {activating ? '切换中…' : '使用'}
                      </Button>
                    )}
                    {profile.type === 'remote' && (
                      <Tooltip title="更新订阅">
                        <span>
                          <IconButton
                            size="small"
                            aria-label={`更新 ${profile.name || '订阅'}`}
                            disabled={profileAction !== null || importing}
                            onClick={() => onUpdateProfile(profile)}
                          >
                            {updating ? (
                              <CircularProgress size={17} />
                            ) : (
                              <RefreshRounded fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip title="删除订阅">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          aria-label={`删除 ${profile.name || '订阅'}`}
                          disabled={profileAction !== null || importing}
                          onClick={() => setDeleteTarget(profile)}
                        >
                          <DeleteOutlineRounded fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
              )
            })}
          </Stack>
        </Box>
      </Stack>

      {qrScannerOpen && (
        <QrScannerDialog
          open
          onClose={() => setQrScannerOpen(false)}
          onDetected={onQrDetected}
        />
      )}

      <BaseDialog
        open={deleteTarget !== null}
        title="删除订阅"
        okBtn="删除"
        cancelBtn="取消"
        loading={deleting}
        onClose={() => !deleting && setDeleteTarget(null)}
        onCancel={() => setDeleteTarget(null)}
        onOk={onDeleteProfile}
        contentSx={{ width: { xs: 280, sm: 380 } }}
      >
        <Typography variant="body2">
          {deleteTarget
            ? `确定删除“${deleteTarget.name || profileSource(deleteTarget)}”吗？`
            : ''}
        </Typography>
      </BaseDialog>
    </MvpPage>
  )
}

export default MvpNodesPage
