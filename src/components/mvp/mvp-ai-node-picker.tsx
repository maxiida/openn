import {
  alpha,
  Box,
  Collapse,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { keyframes, type Theme } from '@mui/material/styles'
import { TimerIcon } from '@radix-ui/react-icons'
import { useLockFn } from 'ahooks'
import { BotIcon, ChevronDownIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { MvpProgressRing } from '@/components/mvp/mvp-progress-ring'
import { MvpShortcutHint } from '@/components/mvp/mvp-shortcut-hint'
import { testMainGroup, useMainProxyGroup } from '@/hooks/use-main-proxy-group'
import { mvpCommandKey } from '@/hooks/use-mvp-shortcuts'
import { useProfiles } from '@/hooks/use-profiles'
import { useVerge } from '@/hooks/use-verge'
import {
  type AiCheckResult,
  type AiVerdict,
  checkAiNodes,
} from '@/services/ai-check'
import { showNotice } from '@/services/notice-service'
import type { InteractableProxyMember } from '@/types/proxy-view'
import { classifyDelay } from '@/utils/delay'
import { formatMvpDelay, mvpDelayColor } from '@/utils/main-proxy-group'
import {
  fractionSegments,
  type MvpSegment,
  RING_SEGMENTS,
} from '@/utils/mvp-progress'

// Demo copy of the node page list (mvp-nodes.tsx): rows hold their slots during a test, then roll
// into the new ranking. AI tags share the node page's stored results.
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

const AI_CHECKS_KEY = 'mvp-ai-checks'
const AI_CHECK_FRESH_MS = 24 * 60 * 60 * 1000

type AiTag = Exclude<AiVerdict, 'unknown'> | 'available'

type AiChecks = Record<string, Record<string, { tag: AiTag; at: number }>>

const readAiChecks = (): AiChecks => {
  try {
    const data = JSON.parse(localStorage.getItem(AI_CHECKS_KEY) ?? '{}')
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

const aiTagOf = (result: AiCheckResult): AiTag | null =>
  result.verdict !== 'unknown'
    ? result.verdict
    : result.region
      ? 'available'
      : null

const AI_TAG_PALETTE = {
  good: 'success',
  limited: 'warning',
  risky: 'error',
  available: 'primary',
} as const

const aiTagSx = (tag: AiTag) => {
  const key = tag === 'unsupported' ? null : AI_TAG_PALETTE[tag]
  return key
    ? {
        color: `${key}.main`,
        bgcolor: (theme: Theme) => alpha(theme.palette[key].main, 0.14),
      }
    : { color: 'text.secondary', bgcolor: 'action.hover' }
}

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

const rowSx = (active: boolean) => ({
  width: '100%',
  minHeight: ROW_HEIGHT,
  px: 1.5,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
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
  ...roundedHighlight(active),
})

type Props = {
  open: boolean
  selected: string | null
  /** Called with the picked node, or null when the dialog closes without a pick. */
  onClose: (picked: string | null) => void
}

export const MvpAiNodePicker = ({ open, selected, onClose }: Props) => {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const aiEnabled = verge?.enable_ai_check !== false
  const { profiles } = useProfiles()
  const { group, members, delays, timeout, isLoading, isError } =
    useMainProxyGroup()
  const [running, setRunning] = useState(false)
  const testing = running || members.some((item) => delays.of(item) === -2)
  // Batch results are cached as they land but only announced at the end, so poll for progress.
  const [, refreshProgress] = useReducer((tick: number) => tick + 1, 0)
  useEffect(() => {
    if (!testing) return
    const timer = setInterval(refreshProgress, 150)
    return () => clearInterval(timer)
  }, [testing])
  const testSegments = members
    .map((item): MvpSegment => {
      const state = classifyDelay(delays.of(item), timeout)
      return state === 'measured'
        ? 'done'
        : state === 'testing' || state === 'untested'
          ? 'pending'
          : 'error'
    })
    .sort((a, b) => Number(a === 'pending') - Number(b === 'pending'))
  const [timeoutOpen, setTimeoutOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const [aiChecks, setAiChecks] = useState(readAiChecks)
  const [aiProgress, setAiProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const aiScope = profiles?.current ?? ''
  useEffect(() => {
    try {
      localStorage.setItem(AI_CHECKS_KEY, JSON.stringify(aiChecks))
    } catch {
      // Tags simply aren't kept for next time.
    }
  }, [aiChecks])

  const onTestAll = useLockFn(async () => {
    if (!group || members.length === 0) return
    setRunning(true)
    try {
      await testMainGroup(group.name, members, timeout)
    } finally {
      setRunning(false)
    }
  })

  // Each opening re-reads tags the node page may have written and starts a fresh test.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTimeoutOpen(false)
      setAiChecks(readAiChecks())
    }
  }
  // onTestAll is a new function every render; only the opening itself should start a test.
  const testAllRef = useRef(onTestAll)
  useEffect(() => {
    testAllRef.current = onTestAll
  })
  useEffect(() => {
    if (open) void testAllRef.current()
  }, [open])

  const layout = useMemo<NodeLayout>(() => {
    const ranked = members
      .map((item, index) => ({ item, index, delay: delays.of(item) }))
      .sort((a, b) => {
        const aDelay =
          a.delay > 0 && a.delay < timeout ? a.delay : Number.POSITIVE_INFINITY
        const bDelay =
          b.delay > 0 && b.delay < timeout ? b.delay : Number.POSITIVE_INFINITY
        return aDelay - bDelay || a.index - b.index
      })
      .map(({ item }) => item)
    // The chosen node stays in reach even when it stops responding.
    const isTimedOut = (item: InteractableProxyMember) => {
      if (item.ref.name === selected) return false
      const kind = classifyDelay(delays.of(item), timeout)
      return kind === 'timeout' || kind === 'error'
    }
    const names = (list: InteractableProxyMember[]) =>
      list.map((item) => item.ref.name)
    return {
      visible: names(ranked.filter((item) => !isTimedOut(item))),
      timedOut: names(ranked.filter(isTimedOut)),
    }
  }, [delays, members, selected, timeout])

  const [shownLayout, setShownLayout] = useState(layout)
  const [roll, setRoll] = useState<{ from: string[]; to: string[] } | null>(
    null,
  )
  if (!testing && shownLayout !== layout) {
    const from = shownLayout.visible
    const to = layout.visible
    setShownLayout(layout)
    if (
      open &&
      from.length > 0 &&
      (from.length !== to.length ||
        from.some((item, slot) => item !== to[slot]))
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
    () => new Map(members.map((item) => [item.ref.name, item])),
    [members],
  )
  const toMembers = (names: string[]) =>
    names.flatMap((item) => memberByName.get(item) ?? [])
  const visibleMembers = toMembers(shownLayout.visible)
  const timedOutMembers = toMembers(shownLayout.timedOut)

  const onAiCheck = useLockFn(async () => {
    // Nodes the speed test already gave up on would only hold the check up.
    const nodes = layout.visible.filter(
      (item) => memberByName.get(item)?.kind === 'node',
    )
    if (nodes.length === 0) return
    const scope = aiScope
    let done = 0
    setAiProgress({ done, total: nodes.length })
    try {
      await checkAiNodes(nodes, (node, result) => {
        setAiProgress({ done: ++done, total: nodes.length })
        const tag = result && aiTagOf(result)
        if (!tag) return
        setAiChecks((checks) => ({
          ...checks,
          [scope]: { ...checks[scope], [node]: { tag, at: Date.now() } },
        }))
      })
    } catch (error) {
      console.error('[Proxy MVP] AI check failed:', error)
      showNotice.error(t('mvp.nodes.ai.failed'))
    } finally {
      setAiProgress(null)
    }
  })

  // App shortcuts pause while a dialog is open, so the picker listens for its own keys.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const rows = Array.from(
          listRef.current?.querySelectorAll<HTMLButtonElement>(
            'button[data-mvp-node]',
          ) ?? [],
        )
        if (!rows.length) return
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const index = rows.findIndex((row) => row === document.activeElement)
        const next =
          index < 0
            ? direction > 0
              ? 0
              : rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, index + direction))
        rows[next].focus()
        return
      }
      const command = mvpCommandKey === '⌘' ? event.metaKey : event.ctrlKey
      if (command && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        if (!event.repeat && !testing) void onTestAll()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onTestAll, open, testing])

  const renderRow = (item: InteractableProxyMember) => {
    const nodeName = item.ref.name
    const active = selected === nodeName
    const delay = delays.of(item)
    const aiCheck = aiChecks[aiScope]?.[nodeName]

    return (
      <Box
        component="button"
        type="button"
        key={nodeName}
        data-mvp-node
        aria-pressed={active}
        onClick={() => onClose(nodeName)}
        sx={rowSx(active)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <Typography
            noWrap
            sx={{ fontSize: 15.5, fontWeight: active ? 600 : 450 }}
          >
            {nodeName}
          </Typography>
          {aiEnabled && aiCheck && (
            <Box
              component="span"
              sx={{
                ml: 1,
                px: 0.75,
                borderRadius: 1,
                flexShrink: 0,
                fontSize: 11.5,
                lineHeight: '20px',
                whiteSpace: 'nowrap',
                opacity: Date.now() - aiCheck.at < AI_CHECK_FRESH_MS ? 1 : 0.45,
                ...aiTagSx(aiCheck.tag),
              }}
            >
              {t(`mvp.nodes.ai.tag.${aiCheck.tag}`)}
            </Box>
          )}
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

  return (
    <BaseDialog
      open={open}
      title={
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          {t('mvp.settings.aiNode.pickerTitle')}
          <Box sx={{ display: 'flex', alignItems: 'center', mr: -1 }}>
            {aiEnabled && (
              <Tooltip
                title={
                  aiProgress
                    ? t('mvp.nodes.ai.checking')
                    : t('mvp.nodes.ai.check')
                }
              >
                <span>
                  <IconButton
                    aria-label={t('mvp.nodes.ai.check')}
                    disabled={aiProgress !== null || members.length === 0}
                    onClick={onAiCheck}
                  >
                    <MvpProgressRing
                      busy={aiProgress !== null}
                      size={18}
                      segments={
                        aiProgress
                          ? fractionSegments(
                              aiProgress.done / aiProgress.total,
                              RING_SEGMENTS,
                            )
                          : undefined
                      }
                    >
                      <BotIcon size={18} />
                    </MvpProgressRing>
                  </IconButton>
                </span>
              </Tooltip>
            )}
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
                    size={18}
                    segments={testSegments}
                  >
                    <TimerIcon width={16} height={16} />
                  </MvpProgressRing>
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={
                <MvpShortcutHint label={t('mvp.common.close')} shortcut="Esc" />
              }
            >
              <IconButton
                aria-label={t('mvp.common.close')}
                onClick={() => onClose(null)}
              >
                <XIcon size={18} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      }
      disableFooter
      onClose={() => onClose(null)}
      contentSx={{ width: { xs: 420, sm: 560 }, pb: 2 }}
    >
      <Typography
        color="textSecondary"
        sx={{ fontSize: 13, mb: 1.5, textWrap: 'pretty' }}
      >
        {t('mvp.settings.aiNode.pickerHint')}
      </Typography>
      {isLoading ? (
        <Box sx={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
          <MvpProgressRing size={24} />
        </Box>
      ) : isError || !group || members.length === 0 ? (
        <Box sx={{ py: 10, textAlign: 'center' }}>
          <Typography color="textSecondary">{t('mvp.nodes.empty')}</Typography>
        </Box>
      ) : (
        <Stack ref={listRef} sx={{ borderTop: 1, borderColor: 'divider' }}>
          {roll
            ? Array.from(
                { length: Math.max(roll.from.length, roll.to.length) },
                (_, slot) => renderSlot(roll.from[slot], roll.to[slot], slot),
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
                  onClick={() => setTimeoutOpen((value) => !value)}
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
                    component={ChevronDownIcon}
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
    </BaseDialog>
  )
}
