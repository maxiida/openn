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

/** Picks the single user-facing selector shared by the MVP home and node list. */
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
      return '测速中…'
    case 'measured':
      return `${delay} ms`
    case 'timeout':
      return '超时'
    case 'error':
      return '连接失败'
    case 'untested':
      return '未测速'
  }
}

/**
 * Single source for the latency colour bands shown on the home and node pages. Bands assume
 * `unified-delay` is off, so a reading includes the node handshake, as opening a page does.
 */
const MVP_DELAY_TIERS = [
  {
    max: 500,
    range: '< 500 ms',
    color: 'success.main',
    label: '延迟低',
    hint: '网页和视频都很顺',
  },
  {
    max: 1500,
    range: '500–1500 ms',
    color: 'warning.main',
    label: '延迟中等',
    hint: '能用，打开网页要稍等',
  },
  {
    max: Number.POSITIVE_INFINITY,
    range: '> 1500 ms',
    color: 'error.main',
    label: '延迟高',
    hint: '明显卡顿',
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
      return '正在测速'
    case 'untested':
      return '还没有测速结果'
    case 'timeout':
      return `超时：${timeout / 1000} 秒内没有响应，节点太慢或已失效`
    case 'error':
      return '连接失败：节点可能已失效'
    case 'measured': {
      const tier = mvpDelayTier(delay)
      return `${tier.label}（${tier.range}）：${tier.hint}`
    }
  }
}

export const MVP_SPEED_TIERS = [
  {
    min: 50,
    label: '极速',
    color: 'success.main',
    hint: '4K 视频流畅，大文件下载很快',
  },
  {
    min: 25,
    label: '流畅',
    color: 'success.main',
    hint: '4K 视频可以看，偶尔缓冲',
  },
  {
    min: 8,
    label: '良好',
    color: 'info.main',
    hint: '1080p 流畅，日常浏览没问题',
  },
  { min: 3, label: '一般', color: 'warning.main', hint: '720p 可看，网页略慢' },
  { min: 0, label: '较差', color: 'error.main', hint: '基本只能刷文字和聊天' },
] as const

export const mvpSpeedTier = (mbps: number) =>
  MVP_SPEED_TIERS.find((tier) => mbps >= tier.min) ?? MVP_SPEED_TIERS[4]

export const mvpSpeedHint = (mbps: number) => {
  const tier = mvpSpeedTier(mbps)
  const range = tier.min > 0 ? `≥ ${tier.min} Mbps` : '< 3 Mbps'
  return `${tier.label}（${range}）：${tier.hint}`
}
