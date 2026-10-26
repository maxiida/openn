import {
  Box,
  Button,
  Collapse,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { keyframes } from '@mui/material/styles'
import {
  IconArrowLeft,
  IconArrowsExchange,
  IconCheck,
  IconChevronDown,
  IconGauge,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconRefresh,
  IconScan,
  IconSquare,
  IconSquareCheckFilled,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useLockFn } from 'ahooks'
import i18n from 'i18next'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router'

import { BaseDialog } from '@/components/base'
import { MvpPage } from '@/components/mvp/mvp-page'
import { MvpProgressRing } from '@/components/mvp/mvp-progress-ring'
import { MvpShortcutHint } from '@/components/mvp/mvp-shortcut-hint'
import { MvpUsageCard } from '@/components/mvp/mvp-usage-card'
import { QrScannerDialog } from '@/components/mvp/qr-scanner-dialog'
import { testMainGroup, useMainProxyGroup } from '@/hooks/use-main-proxy-group'
import { mvpCommandKey, useMvpShortcuts } from '@/hooks/use-mvp-shortcuts'
import { useMvpSteps } from '@/hooks/use-mvp-steps'
import { fetchProfilesIntoCache, useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useAppRefreshers } from '@/providers/app-data-context'
import { deleteProfile, updateProfile } from '@/services/cmds'
import {
  activateMvpProfile,
  ensureMvpMode,
  formatProfileUpdated,
  importAndActivateMvpProfile,
  importAndActivateMvpQrPayload,
} from '@/services/mvp'
import { showNotice } from '@/services/notice-service'
import type { InteractableProxyMember } from '@/types/proxy-view'
import { classifyDelay } from '@/utils/delay'
import { formatMvpDelay, mvpDelayColor } from '@/utils/main-proxy-group'
import type { MvpSegment } from '@/utils/mvp-progress'
import { isValidUrl } from '@/utils/network'

const ROW_HEIGHT = 64
const ROLL_MS = 440
const COLLAPSE_MS = 240
const rollDelay = (slot: number) => Math.min(slot, 12) * 35

const rollUp = keyframes`
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
`

const collapse = keyframes`
  to { height: 0; }
`

type NodeLayout = { visible: string[]; timedOut: string[] }

// Drawn on a pseudo-element so the rounded fill doesn't bend the row's straight divider.
const roundedHighlight = (active: boolean) => ({
  position: 'relative',
  isolation: 'isolate',
  outline: 'none',
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: '3px 0',
    zIndex: -1,
    borderRadius: 2,
    bgcolor: active ? 'action.selected' : 'transparent',
    transition: 'background-color 0.15s',
  },
  '&:hover::before, &:focus-visible::before': {
    bgcolor: active ? 'action.selected' : 'action.hover',
  },
})

const profileSource = (profile: IProfileItem) => {
  if (profile.type === 'local')
    return i18n.t(($) => $.mvp.subscriptions.localSource)
  if (!profile.url) return i18n.t(($) => $.mvp.subscriptions.remoteSource)

  try {
    return new URL(profile.url).host
  } catch {
    return i18n.t(($) => $.mvp.subscriptions.remoteSource)
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
  const { t } = useTranslation()
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
  const testSegments = members
    .map((member): MvpSegment => {
      const state = classifyDelay(delays.of(member), timeout)
      return state === 'measured'
        ? 'done'
        : state === 'testing' || state === 'untested'
          ? 'pending'
          : 'error'
    })
    // Finished nodes first, so the ring fills from the top without gaps.
    .sort((a, b) => Number(a === 'pending') - Number(b === 'pending'))
  const [switching, setSwitching] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  // Download and activate, then this page's own refresh.
  const importSteps = useMvpSteps(1)
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [profileAction, setProfileAction] = useState<{
    uid: string
    kind: 'activate' | 'update'
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<IProfileItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deleteSteps = useMvpSteps()
  const updateSteps = useMvpSteps()
  const [timeoutOpen, setTimeoutOpen] = useState(false)
  const nodeListRef = useRef<HTMLDivElement>(null)
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
  const currentProfile = availableProfiles.find(
    (item) => item.uid === profiles?.current,
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
      showNotice.error(t('mvp.nodes.notices.switchFailed'))
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
      showNotice.success(t('mvp.subscriptions.notices.added'))
    } catch (error) {
      importSteps.fail()
      console.error('[Proxy MVP] Subscription import failed:', error)
      showNotice.error(t('mvp.subscriptions.notices.addFailed'))
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
      showNotice.success(t('mvp.subscriptions.notices.added'))
    } catch (error) {
      importSteps.fail()
      console.error('[Proxy MVP] QR import failed:', error)
      showNotice.error(t('mvp.common.invalidQr'))
    } finally {
      setImporting(false)
    }
  })

  const onActivateProfile = useLockFn(async (profile: IProfileItem) => {
    if (profile.uid === profiles?.current) return

    setProfileAction({ uid: profile.uid, kind: 'activate' })
    try {
      await activateMvpProfile(profile.uid)
      await ensureMvpMode()
      await fetchProfilesIntoCache()
      await refreshAll()
      showNotice.success(t('mvp.subscriptions.notices.switched'))
    } catch (error) {
      console.error('[Proxy MVP] Profile activation failed:', error)
      showNotice.error(t('mvp.subscriptions.notices.switchFailed'))
    } finally {
      setProfileAction(null)
    }
  })

  const onUpdateProfile = useLockFn(async (profile: IProfileItem) => {
    if (profile.type !== 'remote') return

    setProfileAction({ uid: profile.uid, kind: 'update' })
    // Download, reload the list, and refresh the core when it runs this subscription.
    const isCurrent = profile.uid === profiles?.current
    const total = isCurrent ? 3 : 2
    updateSteps.report(0, total)
    try {
      await updateProfile(profile.uid)
      updateSteps.report(1, total)
      await fetchProfilesIntoCache()
      updateSteps.report(2, total)
      if (isCurrent) {
        await ensureMvpMode()
        await refreshAll()
        updateSteps.report(3, total)
      }
      showNotice.success(t('mvp.subscriptions.notices.updated'))
    } catch (error) {
      updateSteps.fail()
      console.error('[Proxy MVP] Subscription update failed:', error)
      showNotice.error(t('mvp.subscriptions.notices.updateFailed'))
    } finally {
      setProfileAction(null)
    }
  })

  const onDeleteProfile = useLockFn(async () => {
    if (!deleteTarget) return

    setDeleting(true)
    deleteSteps.report(0, 3)
    try {
      await deleteProfile(deleteTarget.uid)
      deleteSteps.report(1, 3)
      const remainingProfiles = await fetchProfilesIntoCache()
      deleteSteps.report(2, 3)
      if (remainingProfiles.current) {
        await ensureMvpMode()
        await refreshAll()
      }
      deleteSteps.report(3, 3)
      setDeleteTarget(null)
      showNotice.success(t('mvp.subscriptions.notices.deleted'))
    } catch (error) {
      deleteSteps.fail()
      console.error('[Proxy MVP] Subscription deletion failed:', error)
      showNotice.error(t('mvp.subscriptions.notices.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  })

  const layout = useMemo<NodeLayout>(() => {
    const isTimedOut = (member: InteractableProxyMember) => {
      if (pinned.has(member.ref.name)) return false
      const kind = classifyDelay(delays.of(member), timeout)
      return kind === 'timeout' || kind === 'error'
    }
    const names = (list: InteractableProxyMember[]) =>
      list.map((member) => member.ref.name)
    return {
      visible: names(sortedMembers.filter((member) => !isTimedOut(member))),
      timedOut: names(sortedMembers.filter(isTimedOut)),
    }
  }, [delays, pinned, sortedMembers, timeout])

  // Rows keep their slots while a test runs; changed slots roll to their new node once it settles.
  const [shownLayout, setShownLayout] = useState(layout)
  const [roll, setRoll] = useState<{ from: string[]; to: string[] } | null>(
    null,
  )
  if (!testing && shownLayout !== layout) {
    const from = shownLayout.visible
    const to = layout.visible
    setShownLayout(layout)
    if (
      from.length > 0 &&
      (from.length !== to.length ||
        from.some((name, slot) => name !== to[slot]))
    )
      setRoll({ from, to })
  }
  useEffect(() => {
    if (!roll) return
    const slots = Math.max(roll.from.length, roll.to.length)
    const timer = setTimeout(
      () => setRoll(null),
      rollDelay(slots) + ROLL_MS + COLLAPSE_MS,
    )
    return () => clearTimeout(timer)
  }, [roll])

  const memberByName = useMemo(
    () => new Map(members.map((member) => [member.ref.name, member])),
    [members],
  )
  const toMembers = (names: string[]) =>
    names.flatMap((name) => memberByName.get(name) ?? [])
  const visibleMembers = toMembers(shownLayout.visible)
  const timedOutMembers = toMembers(shownLayout.timedOut)

  const focusNode = (direction: number) => {
    const rows = Array.from(
      nodeListRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-mvp-node]:not(:disabled)',
      ) ?? [],
    )
    if (!rows.length) return
    const index = rows.findIndex((row) => row === document.activeElement)
    const next =
      index < 0
        ? direction > 0
          ? 0
          : rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, index + direction))
    rows[next].focus()
  }

  useMvpShortcuts([
    {
      key: 'ArrowLeft',
      allowInControl: true,
      onPress: () => !switching && navigate('/'),
    },
    {
      key: 'Escape',
      allowInControl: true,
      onPress: () => {
        if (pinDraft) setPinDraft(null)
        else if (!switching) navigate('/')
      },
    },
    {
      key: 'r',
      command: true,
      onPress: () => {
        if (!testing && !importing && !profileAction) void onTestAll()
      },
    },
    {
      key: 'u',
      command: true,
      onPress: () => {
        if (currentProfile && !importing && !profileAction) {
          void onUpdateProfile(currentProfile)
        }
      },
    },
    { key: 'ArrowDown', allowInControl: true, onPress: () => focusNode(1) },
    { key: 'ArrowUp', allowInControl: true, onPress: () => focusNode(-1) },
  ])

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
        data-mvp-node
        aria-pressed={pinDraft ? pinChecked : selected}
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
          px: 1.5,
          display: 'grid',
          gridTemplateColumns: pinDraft
            ? '28px minmax(0, 1fr) auto'
            : 'minmax(0, 1fr) auto',
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
          ...roundedHighlight(selected && !pinDraft),
          '&:disabled': { cursor: 'default', opacity: 0.72 },
        }}
      >
        {pinDraft && (
          <Box sx={{ display: 'grid', placeItems: 'center' }}>
            {pinChecked ? (
              <Box
                component={IconSquareCheckFilled}
                size={20}
                sx={{ color: 'primary.main' }}
              />
            ) : (
              <Box
                component={IconSquare}
                size={20}
                sx={{ color: 'text.secondary' }}
              />
            )}
          </Box>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {!pinDraft && pinned.has(name) && (
            <Box
              component={IconPinFilled}
              size={15}
              sx={{ color: 'primary.main', mr: 0.75, flexShrink: 0 }}
            />
          )}
          <Typography
            noWrap
            sx={{ fontSize: 15.5, fontWeight: selected ? 600 : 450 }}
          >
            {name}
          </Typography>
        </Box>
        {switching === name ? (
          <MvpProgressRing size={17} />
        ) : (
          <Typography
            sx={{
              fontSize: 13.5,
              color: mvpDelayColor(delay, timeout),
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatMvpDelay(delay, timeout)}
          </Typography>
        )}
      </Box>
    )
  }

  const renderSlot = (
    from: string | undefined,
    to: string | undefined,
    slot: number,
  ) => {
    const toMember = to ? memberByName.get(to) : undefined
    if (from === to) return toMember && renderRow(toMember)
    const fromMember = from ? memberByName.get(from) : undefined
    const delay = rollDelay(slot)

    return (
      <Box
        key={`roll-${slot}`}
        sx={{
          height: ROW_HEIGHT,
          overflow: 'hidden',
          pointerEvents: 'none',
          animation: toMember
            ? undefined
            : `${collapse} ${COLLAPSE_MS}ms ease ${delay + ROLL_MS}ms forwards`,
        }}
      >
        <Box
          sx={{
            animation: `${rollUp} ${ROLL_MS}ms cubic-bezier(0.3, 0.9, 0.3, 1) ${delay}ms both`,
          }}
        >
          <Box inert sx={{ height: ROW_HEIGHT }}>
            {fromMember && renderRow(fromMember)}
          </Box>
          <Box sx={{ height: ROW_HEIGHT }}>
            {toMember && renderRow(toMember)}
          </Box>
        </Box>
      </Box>
    )
  }

  if (profiles && availableProfiles.length === 0) {
    return <Navigate to="/" replace />
  }

  return (
    <MvpPage
      title={t('mvp.nodes.title')}
      leading={
        <Tooltip
          title={<MvpShortcutHint label={t('mvp.common.back')} shortcut="←" />}
        >
          <IconButton
            aria-label={t('mvp.common.back')}
            aria-keyshortcuts="ArrowLeft Escape"
            onClick={() => navigate('/')}
          >
            <IconArrowLeft size={22} />
          </IconButton>
        </Tooltip>
      }
      trailing={
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Tooltip title={pinDraft ? t('mvp.nodes.done') : t('mvp.nodes.pin')}>
            <span>
              <IconButton
                aria-label={pinDraft ? t('mvp.nodes.done') : t('mvp.nodes.pin')}
                disabled={members.length === 0}
                onClick={onPinButton}
              >
                {!pinDraft ? (
                  <IconPin size={22} />
                ) : pinDraft.length === 0 ? (
                  <IconX size={22} />
                ) : (
                  <IconCheck size={22} />
                )}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip
            title={
              <MvpShortcutHint
                label={
                  testing ? t('mvp.common.testing') : t('mvp.nodes.testAll')
                }
                shortcut={`${mvpCommandKey}R`}
              />
            }
          >
            <span>
              <IconButton
                aria-label={t('mvp.nodes.testAll')}
                aria-keyshortcuts={`${mvpCommandKey === '⌘' ? 'Meta' : 'Control'}+R`}
                disabled={testing || members.length === 0}
                onClick={onTestAll}
              >
                <MvpProgressRing
                  busy={testing}
                  size={22}
                  segments={testSegments}
                >
                  <IconGauge size={22} />
                </MvpProgressRing>
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      }
    >
      <Stack spacing={5}>
        <Box>
          {currentProfile && (
            <MvpUsageCard
              profile={currentProfile}
              updating={
                profileAction?.uid === currentProfile.uid &&
                profileAction.kind === 'update'
              }
              progress={updateSteps.segments}
              disabled={profileAction !== null || importing}
              onUpdate={() => onUpdateProfile(currentProfile)}
            />
          )}
          {isLoading ? (
            <Box sx={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
              <MvpProgressRing size={24} />
            </Box>
          ) : isError || !group || members.length === 0 ? (
            <Box sx={{ py: 10, textAlign: 'center' }}>
              <Typography color="text.secondary">
                {t('mvp.nodes.empty')}
              </Typography>
            </Box>
          ) : (
            <Stack
              ref={nodeListRef}
              sx={{ borderTop: 1, borderColor: 'divider' }}
            >
              {roll
                ? Array.from(
                    { length: Math.max(roll.from.length, roll.to.length) },
                    (_, slot) =>
                      renderSlot(roll.from[slot], roll.to[slot], slot),
                  )
                : visibleMembers.map(renderRow)}
              {timedOutMembers.length > 0 && (
                <>
                  <Tooltip
                    title={t('mvp.nodes.unavailableHint', {
                      seconds: timeout / 1000,
                    })}
                  >
                    <Box
                      component="button"
                      type="button"
                      aria-expanded={timeoutOpen}
                      onClick={() => setTimeoutOpen((open) => !open)}
                      sx={{
                        width: '100%',
                        minHeight: 48,
                        px: 1.5,
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
                        ...roundedHighlight(false),
                      }}
                    >
                      <span>
                        {t('mvp.nodes.unavailable', {
                          count: timedOutMembers.length,
                        })}
                      </span>
                      <Box
                        component={IconChevronDown}
                        size={20}
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
            {t('mvp.subscriptions.title')}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13, mb: 2 }}>
            {t('mvp.subscriptions.subtitle')}
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
              placeholder={t('mvp.subscriptions.placeholder')}
              type="url"
              slotProps={{
                htmlInput: { 'aria-label': t('mvp.subscriptions.inputLabel') },
              }}
            />
            <Button
              variant="contained"
              startIcon={
                <MvpProgressRing
                  busy={importing}
                  size={16}
                  color="inherit"
                  segments={importSteps.segments}
                >
                  <IconPlus size={22} />
                </MvpProgressRing>
              }
              disabled={importing || !url.trim()}
              onClick={onImport}
              sx={{ flexShrink: 0 }}
            >
              {t('mvp.subscriptions.add')}
            </Button>
            <Tooltip title={t('mvp.common.scanQr')}>
              <span>
                <IconButton
                  aria-label={t('mvp.common.scanQr')}
                  disabled={importing}
                  onClick={() => setQrScannerOpen(true)}
                >
                  <IconScan size={22} />
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
                          {t('mvp.subscriptions.current')}
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
                      <Tooltip title={t('mvp.subscriptions.use')}>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={t('mvp.subscriptions.useNamed', {
                              name:
                                profile.name ||
                                t('mvp.subscriptions.fallbackName'),
                            })}
                            disabled={profileAction !== null || importing}
                            onClick={() => onActivateProfile(profile)}
                          >
                            <MvpProgressRing busy={activating} size={17}>
                              <IconArrowsExchange size={20} />
                            </MvpProgressRing>
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    {profile.type === 'remote' && (
                      <Tooltip title={t('mvp.subscriptions.update')}>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={t('mvp.subscriptions.updateNamed', {
                              name:
                                profile.name ||
                                t('mvp.subscriptions.fallbackName'),
                            })}
                            disabled={profileAction !== null || importing}
                            onClick={() => onUpdateProfile(profile)}
                          >
                            <MvpProgressRing
                              busy={updating}
                              size={17}
                              segments={updateSteps.segments}
                            >
                              <IconRefresh size={20} />
                            </MvpProgressRing>
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip title={t('mvp.subscriptions.delete')}>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          aria-label={t('mvp.subscriptions.deleteNamed', {
                            name:
                              profile.name ||
                              t('mvp.subscriptions.fallbackName'),
                          })}
                          disabled={profileAction !== null || importing}
                          onClick={() => setDeleteTarget(profile)}
                        >
                          <IconTrash size={20} />
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
        icon={<IconTrash size={22} />}
        danger
        title={t('mvp.subscriptions.delete')}
        okBtn={t('mvp.subscriptions.deleteAction')}
        cancelBtn={t('mvp.common.cancel')}
        loading={deleting}
        loadingIndicator={
          <MvpProgressRing
            size={18}
            color="inherit"
            segments={deleteSteps.segments}
          />
        }
        onClose={() => !deleting && setDeleteTarget(null)}
        onCancel={() => setDeleteTarget(null)}
        onOk={onDeleteProfile}
        contentSx={{ width: { xs: 280, sm: 300 } }}
      >
        <Typography variant="body2">
          {deleteTarget
            ? t('mvp.subscriptions.deleteConfirm', {
                name: deleteTarget.name || profileSource(deleteTarget),
              })
            : ''}
        </Typography>
      </BaseDialog>
    </MvpPage>
  )
}

export default MvpNodesPage
