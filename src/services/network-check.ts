import dayjs from 'dayjs'

import { getPreflightReport } from '@/services/cmds'
import { checkSite, MVP_SITES } from '@/services/site-check'

/** The path traffic takes, in order: a broken step explains everything after it. */
export const CHECK_STEPS = [
  'device',
  'network',
  'subscription',
  'node',
  'sites',
] as const

export type CheckStepId = (typeof CHECK_STEPS)[number]

export type CheckIssue =
  | 'foreignTunnel'
  | 'foreignSystemProxy'
  | 'staleProxyEnv'
  | 'offline'
  | 'quotaUsedUp'
  | 'expired'
  | 'disconnected'
  | 'nodeDown'
  | 'sitesDown'
  | 'foreignDown'

export interface CheckStepResult {
  /** `warn` leaves the rest of the path usable, so checking carries on past it. */
  status: 'ok' | 'warn' | 'error'
  issue?: CheckIssue
  /** Bytes left on the plan, when the subscription reports a total. */
  remaining?: number
  /** Unix seconds, when the subscription reports an expiry. */
  expire?: number
  delay?: number
  /** Sites the step is about: the ones that failed, or all of them when none did. */
  sites?: string[]
}

interface CheckContext {
  connected: boolean
  profile?: IProfileItem
  /** Resolves to a measured delay in ms, or null when the node did not answer. */
  probeNode: () => Promise<number | null>
}

type MvpSite = (typeof MVP_SITES)[number]
type ForeignSite = Exclude<MvpSite, { domestic: true }>

const DOMESTIC_SITE = MVP_SITES.find((site) => 'domestic' in site)!
const FOREIGN_SITES = MVP_SITES.filter(
  (site): site is ForeignSite => !('domestic' in site),
)

const checkDevice = async (): Promise<CheckStepResult> => {
  const report = await getPreflightReport().catch(() => null)
  if (report?.foreignTunnel) return { status: 'error', issue: 'foreignTunnel' }
  if (report?.foreignSystemProxy) {
    return { status: 'error', issue: 'foreignSystemProxy' }
  }
  // Only some apps read the stale variables, so the rest of the path still works.
  if (report?.staleProxyEnv) return { status: 'warn', issue: 'staleProxyEnv' }
  return { status: 'ok' }
}

const checkNetwork = async (): Promise<CheckStepResult> =>
  // Split routing sends the domestic site direct, so it answers whether or not the node works.
  (await checkSite(DOMESTIC_SITE.url)) === 'down'
    ? { status: 'error', issue: 'offline' }
    : { status: 'ok' }

const checkSubscription = (profile?: IProfileItem): CheckStepResult => {
  const {
    upload = 0,
    download = 0,
    total = 0,
    expire = 0,
  } = profile?.extra ?? {}
  const remaining =
    total > 0 ? Math.max(0, total - upload - download) : undefined
  if (remaining === 0) return { status: 'error', issue: 'quotaUsedUp' }
  if (expire > 0 && dayjs.unix(expire).isBefore(dayjs())) {
    return { status: 'error', issue: 'expired' }
  }
  return { status: 'ok', remaining, expire: expire || undefined }
}

const checkNode = async ({
  connected,
  probeNode,
}: CheckContext): Promise<CheckStepResult> => {
  if (!connected) return { status: 'error', issue: 'disconnected' }
  const delay = await probeNode()
  return delay === null
    ? { status: 'error', issue: 'nodeDown' }
    : { status: 'ok', delay }
}

const checkSites = async (): Promise<CheckStepResult> => {
  const statuses = await Promise.all(
    FOREIGN_SITES.map((site) => checkSite(site.url)),
  )
  const down = FOREIGN_SITES.filter((_, index) => statuses[index] === 'down')
  if (down.length === FOREIGN_SITES.length) {
    return { status: 'error', issue: 'foreignDown' }
  }
  if (down.length) {
    return {
      status: 'warn',
      issue: 'sitesDown',
      sites: down.map((site) => site.name),
    }
  }
  return { status: 'ok', sites: FOREIGN_SITES.map((site) => site.name) }
}

/**
 * Walks CHECK_STEPS in order and stops at the first broken one. `onStep` hears each step start
 * (`null`) and finish.
 */
export const runNetworkCheck = async (
  context: CheckContext,
  onStep: (step: CheckStepId, result: CheckStepResult | null) => void,
) => {
  const runners: Record<CheckStepId, () => Promise<CheckStepResult>> = {
    device: checkDevice,
    network: checkNetwork,
    subscription: async () => checkSubscription(context.profile),
    node: () => checkNode(context),
    sites: checkSites,
  }
  const results: Partial<Record<CheckStepId, CheckStepResult>> = {}
  for (const step of CHECK_STEPS) {
    onStep(step, null)
    const result = await runners[step]()
    results[step] = result
    onStep(step, result)
    if (result.status === 'error') break
  }
  return results
}
