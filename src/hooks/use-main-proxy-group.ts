import { useMemo } from 'react'

import { useGroupDelays } from '@/hooks/use-group-delays'
import { useProxiesData } from '@/providers/app-data-context'
import delayManager from '@/services/delay'
import {
  type InteractableProxyMember,
  isInteractableMember,
  resolveMember,
} from '@/types/proxy-view'
import {
  getEffectiveCurrentMember,
  getMainProxyGroup,
  MVP_DELAY_TIMEOUT,
} from '@/utils/main-proxy-group'

const MVP_TEST_CONCURRENCY = 32

const HIDDEN_BUILTIN_MEMBERS = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
])

// Providers list quota and expiry as dummy nodes; picking one would route through an arbitrary server.
const PROVIDER_INFO_NODE = /^(剩余流量|距离下次重置|下次重置|套餐到期|过期时间|到期时间)/

export const useMainProxyGroup = () => {
  const { proxyView, isProxyViewPending, isProxyViewError } = useProxiesData()
  const group = useMemo(() => getMainProxyGroup(proxyView), [proxyView])
  const delays = useGroupDelays(group?.name ?? null)

  const members = useMemo(() => {
    if (!proxyView || !group) return []

    return group.members
      .map((memberRef) => resolveMember(proxyView, memberRef))
      .filter(isInteractableMember)
      .filter((member) => member.kind === 'node')
      .filter((member) => !HIDDEN_BUILTIN_MEMBERS.has(member.ref.name))
      .filter((member) => !PROVIDER_INFO_NODE.test(member.ref.name))
  }, [group, proxyView])

  const current = useMemo(() => {
    if (!proxyView || !group) return undefined
    return getEffectiveCurrentMember(proxyView, group)
  }, [group, proxyView])

  return {
    group,
    members,
    current,
    delays,
    timeout: MVP_DELAY_TIMEOUT,
    isLoading: isProxyViewPending,
    isError: isProxyViewError,
  }
}

const runningTests = new Map<string, Promise<void>>()

/** Runs outside any component so a test started on one page keeps going after navigation. */
export const testMainGroup = (
  groupName: string,
  members: InteractableProxyMember[],
  timeout: number,
) => {
  const running = runningTests.get(groupName)
  if (running) return running

  const run = delayManager
    .checkListDelay(members, groupName, timeout, MVP_TEST_CONCURRENCY, {
      minDuration: 0,
      maxConcurrency: MVP_TEST_CONCURRENCY,
    })
    .finally(() => runningTests.delete(groupName))
  runningTests.set(groupName, run)
  return run
}
