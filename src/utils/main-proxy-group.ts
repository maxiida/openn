import i18n from 'i18next'

import {
  findCurrentGroupMember,
  type InteractableProxyMember,
  type ProxyGroupView,
  type ProxyViewV1,
} from '@/types/proxy-view'
import { classifyDelay } from '@/utils/delay'

const PRIMARY_GROUP_KEYWORDS = [
  'proxy',
  'select',
  'node',
  '节点',
  '代理',
  '手动',
  'auto',
  '自动',
]

const scoreGroup = (group: ProxyGroupView) => {
  const name = group.name.toLowerCase()
  const keywordIndex = PRIMARY_GROUP_KEYWORDS.findIndex((keyword) =>
    name.includes(keyword),
  )

  return (
    (group.type === 'Selector' ? 100 : 0) +
    (keywordIndex >= 0 ? PRIMARY_GROUP_KEYWORDS.length - keywordIndex : 0)
  )
}

/**
 * Picks the single user-facing selector shared by the MVP home and node list. The tray health
 * probe mirrors this in `ProxyViewV1::main_group`; keep the two in sync.
 */
export const getMainProxyGroup = (
  view: ProxyViewV1 | undefined,
): ProxyGroupView | null => {
  if (!view) return null

  const candidates = view.groups.filter(
    (group) =>
      !group.hidden &&
      group.members.length > 0 &&
      (group.type === 'Selector' || group.type === 'URLTest'),
  )

  return candidates.reduce<ProxyGroupView | null>((best, group) => {
    if (!best) return group
    return scoreGroup(group) > scoreGroup(best) ? group : best
  }, null)
}

export const getEffectiveCurrentMember = (
  view: ProxyViewV1,
  group: ProxyGroupView,
): InteractableProxyMember | undefined => {
  const visited = new Set<string>()
  let currentGroup: ProxyGroupView | undefined = group

  while (currentGroup && !visited.has(currentGroup.name)) {
    visited.add(currentGroup.name)
    const selected: InteractableProxyMember | undefined =
      findCurrentGroupMember(view, currentGroup)?.member
    if (!selected) return undefined
    if (selected.kind === 'node') return selected
    currentGroup = selected.group
  }

  return undefined
}

/** Covers a slow node handshake, so a working but slow node is not reported as dead. */
export const MVP_DELAY_TIMEOUT = 10000

export const formatMvpDelay = (delay: number, timeout: number) => {
  switch (classifyDelay(delay, timeout)) {
    case 'testing':
      return i18n.t(($) => $.mvp.common.testing)
    case 'measured':
      return `${delay} ms`
    case 'timeout':
      return i18n.t(($) => $.mvp.delay.timeout)
    case 'error':
      return i18n.t(($) => $.mvp.delay.error)
    case 'untested':
      return i18n.t(($) => $.mvp.delay.untested)
  }
}

/**
 * Single source for the latency colour bands shown on the home and node pages. Bands assume
 * `unified-delay` is off, so a reading includes the node handshake, as opening a page does.
 */
const MVP_DELAY_TIERS = [
  {
    max: 500,
    color: 'success.main',
    id: 'low',
  },
  {
    max: 1500,
    color: 'warning.main',
    id: 'medium',
  },
  {
    max: Number.POSITIVE_INFINITY,
    color: 'error.main',
    id: 'high',
  },
] as const

const mvpDelayTier = (delay: number) =>
  MVP_DELAY_TIERS.find((tier) => delay < tier.max) ?? MVP_DELAY_TIERS[2]

export const mvpDelayColor = (delay: number, timeout: number) => {
  switch (classifyDelay(delay, timeout)) {
    case 'testing':
    case 'untested':
      return 'text.secondary'
    case 'timeout':
    case 'error':
      return 'error.main'
    case 'measured':
      return mvpDelayTier(delay).color
  }
}

export const mvpDelayHint = (delay: number, timeout: number) => {
  switch (classifyDelay(delay, timeout)) {
    case 'testing':
      return i18n.t(($) => $.mvp.delay.testing)
    case 'untested':
      return i18n.t(($) => $.mvp.delay.untestedHint)
    case 'timeout':
      return i18n.t(($) => $.mvp.delay.timeoutHint, { seconds: timeout / 1000 })
    case 'error':
      return i18n.t(($) => $.mvp.delay.errorHint)
    case 'measured': {
      const tier = mvpDelayTier(delay)
      return i18n.t(($) => $.mvp.delay.tierHint, {
        label: i18n.t(($) => $.mvp.delay[tier.id].label),
        hint: i18n.t(($) => $.mvp.delay[tier.id].hint),
      })
    }
  }
}

const MVP_SPEED_TIERS = [
  {
    min: 50,
    id: 'blazing',
    color: 'success.main',
  },
  {
    min: 25,
    id: 'smooth',
    color: 'lime.main',
  },
  {
    min: 8,
    id: 'good',
    color: 'yellow.main',
  },
  {
    min: 3,
    id: 'fair',
    color: 'warning.main',
  },
  {
    min: 0,
    id: 'poor',
    color: 'error.main',
  },
] as const

export const mvpSpeedTier = (mbps: number) => {
  const tier =
    MVP_SPEED_TIERS.find((tier) => mbps >= tier.min) ?? MVP_SPEED_TIERS[4]
  return {
    ...tier,
    label: i18n.t(($) => $.mvp.speed[tier.id].label),
    hint: i18n.t(($) => $.mvp.speed[tier.id].hint),
  }
}

/** The pill no longer names the tier, so the hint carries the measured speed itself. */
export const mvpSpeedHint = (mbps: number) => {
  const tier = mvpSpeedTier(mbps)
  const value = mbps >= 10 ? String(Math.round(mbps)) : mbps.toFixed(1)
  return i18n.t(($) => $.mvp.speed.valueHint, { value, hint: tier.hint })
}
