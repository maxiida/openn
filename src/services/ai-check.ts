import { fetch as directFetch } from '@tauri-apps/plugin-http'

import { startAiProbe, stopAiProbe } from '@/services/cmds'

// IPPure scores how much an IP looks like a proxy or abuser, 0 (ordinary user) to 100. It sends no
// CORS headers, so the request goes through the Rust client instead of the webview.
const IP_INFO_URL = 'https://my.ippure.com/v1/info'
// The location Cloudflare reports here is the one Claude's own front door sees.
const REGION_URL = 'https://claude.ai/cdn-cgi/trace'
const REQUEST_TIMEOUT_MS = 10_000
// Nodes checked at once; more mostly piles onto the slow ones.
const NODE_CONCURRENCY = 6

// Anthropic's supported countries and regions (anthropic.com/supported-countries, October 2026);
// Claude refuses everywhere else, and ChatGPT refuses the places Chinese users commonly land on.
const AI_SUPPORTED_REGIONS = new Set(
  (
    'AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA ' +
    'CF TD CL CO KM CG CD CR CI HR CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE ' +
    'DE GH GR GD GT GN GW GY HT HN HU IS IN ID IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS ' +
    'LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ NA NR NP NL NZ NI NE NG ' +
    'MK NO OM PK PW PS PA PG PY PE PH PL PT QA RO RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI ' +
    'SO SB ZA KR SS ES LK SD SR SE CH TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ ' +
    'VU VA VN ZM ZW'
  ).split(' '),
)

export type AiVerdict = 'good' | 'limited' | 'risky' | 'unsupported' | 'unknown'

export interface AiCheckResult {
  verdict: AiVerdict
  /** ISO country code of the exit, as the AI services see it. */
  region: string | null
  city: string | null
  /** IPPure's score; lower looks more like an ordinary user. */
  score: number | null
  residential: boolean | null
}

/** Score bands of the purity meter; the AI verdict changes at 35 and 70. */
export const AI_PURITY_BANDS = [
  { max: 15, color: 'success.main' },
  { max: 35, color: 'lime.main' },
  { max: 50, color: 'yellow.main' },
  { max: 70, color: 'warning.main' },
  { max: 100, color: 'error.main' },
] as const

export const aiPurityColor = (score: number) =>
  (AI_PURITY_BANDS.find((band) => score <= band.max) ?? AI_PURITY_BANDS[4])
    .color

export const aiVerdictColor = (verdict: AiVerdict) =>
  verdict === 'good'
    ? 'success.main'
    : verdict === 'limited'
      ? 'warning.main'
      : verdict === 'unknown'
        ? 'text.secondary'
        : 'error.main'

interface IpInfo {
  ip?: string
  countryCode?: string
  city?: string
  fraudScore?: number
  isResidential?: boolean
}

/** Goes through the local proxy port, so the rules and the current node decide the exit. */
const fetchViaProxy = async (url: string, mixedPort: number) => {
  const response = await directFetch(url, {
    proxy: { all: `http://127.0.0.1:${mixedPort}` },
    connectTimeout: REQUEST_TIMEOUT_MS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

const fetchTrace = async (port: number) => {
  const trace = await (await fetchViaProxy(REGION_URL, port)).text()
  return {
    ip: /^ip=(.+)$/m.exec(trace)?.[1] ?? null,
    region: /^loc=([A-Z]{2})$/m.exec(trace)?.[1] ?? null,
  }
}

const fetchIpInfo = async (port: number) =>
  (await fetchViaProxy(IP_INFO_URL, port)).json() as Promise<IpInfo>

interface Trace {
  ip: string | null
  region: string | null
}

const judge = (trace: Trace | null, info: IpInfo | null): AiCheckResult => {
  // The rules route each request on its own, so IPPure may have seen another exit, or the
  // broadband line itself; its score then says nothing about this node. One node can leave from
  // several addresses, so the same country still counts as the same exit.
  const otherExit =
    trace?.ip && trace.region && info
      ? info.ip !== trace.ip && info.countryCode !== trace.region
      : false
  const ipInfo = otherExit ? null : info
  const region = trace?.region || ipInfo?.countryCode || null
  const score =
    typeof ipInfo?.fraudScore === 'number' ? ipInfo.fraudScore : null
  const verdict: AiVerdict =
    region && !AI_SUPPORTED_REGIONS.has(region)
      ? 'unsupported'
      : score === null
        ? 'unknown'
        : score > 70
          ? 'risky'
          : score > 35
            ? 'limited'
            : 'good'
  return {
    verdict,
    region,
    // IPPure's city only describes the exit when both services agree on the country.
    city: ipInfo?.countryCode === region ? (ipInfo?.city ?? null) : null,
    score,
    residential: ipInfo?.isResidential ?? null,
  }
}

export const checkAi = async (mixedPort: number): Promise<AiCheckResult> => {
  const [trace, info] = await Promise.allSettled([
    fetchTrace(mixedPort),
    fetchIpInfo(mixedPort),
  ])
  return judge(
    trace.status === 'fulfilled' ? trace.value : null,
    info.status === 'fulfilled' ? info.value : null,
  )
}

/**
 * Checks each node through its own port on a probe core, leaving the running core untouched.
 * A node that does not answer gets no result.
 */
export const checkAiNodes = async (
  nodes: string[],
  onResult: (node: string, result: AiCheckResult | null) => void,
) => {
  const queue = Object.entries(await startAiProbe(nodes))
  // Many nodes share an exit, and IPPure only needs to see each exit once.
  const infoByIp = new Map<string, Promise<IpInfo | null>>()
  try {
    await Promise.all(
      Array.from({ length: NODE_CONCURRENCY }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const [node, port] = next
          const trace = await fetchTrace(port).catch(() => null)
          if (!trace) {
            onResult(node, null)
            continue
          }
          const key = trace.ip ?? node
          let info = infoByIp.get(key)
          if (!info) {
            info = fetchIpInfo(port).catch(() => null)
            infoByIp.set(key, info)
          }
          onResult(node, judge(trace, await info))
        }
      }),
    )
  } finally {
    await stopAiProbe()
  }
}
