import { fetch as directFetch } from '@tauri-apps/plugin-http'

import { cmdTestDelay } from '@/services/cmds'
import { classifyDelay } from '@/utils/delay'
import { MVP_DELAY_TIMEOUT } from '@/utils/main-proxy-group'

// Hard cap on data per test: nodes with a traffic multiplier bill it many times over.
const SPEED_TEST_BYTES = 4_000_000
const SPEED_TEST_URL = `https://speed.cloudflare.com/__down?bytes=${SPEED_TEST_BYTES}`
// An immutable package on a domestic CDN: split routing sends it direct, so it measures the
// broadband line itself. Overseas servers would mostly measure the international link instead.
const DIRECT_TEST_URL =
  'https://cdn.npmmirror.com/packages/typescript/5.4.5/typescript-5.4.5.tgz'
// Gives up on a node that takes this long to deliver anything.
const MAX_DURATION_MS = 10_000

/** Megabytes a full test through the node spends of the subscription. */
export const NODE_TEST_MB = SPEED_TEST_BYTES / 1_000_000

export const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

const abortError = () => new DOMException('Speed test stopped', 'AbortError')

const toMbps = (bytes: number, ms: number) => (bytes * 8) / (ms / 1000) / 1e6

interface MeasureOptions {
  /** Measure the broadband line from a domestic server instead of the node. */
  direct?: boolean
  signal?: AbortSignal
  /** Handshake time on the same route, from measureLatencyMs; null when it was not measured. */
  latencyMs?: number | null
  /** 0–1 through the test, and the speed measured so far. */
  onProgress?: (fraction: number, mbps: number) => void
}

/**
 * Downloads at most SPEED_TEST_BYTES, so a test spends little of a metered plan. Returns Mbps.
 * `onProgress` gets 0–1 through the download, by bytes or by the deadline, whichever is further.
 */
export const measureDownloadMbps = async (
  onProgress?: MeasureOptions['onProgress'],
  {
    direct = false,
    signal,
    latencyMs = null,
  }: Omit<MeasureOptions, 'onProgress'> = {},
): Promise<number> => {
  if (signal?.aborted) throw abortError()
  const controller = new AbortController()
  const stop = () => controller.abort()
  signal?.addEventListener('abort', stop)
  const timer = setTimeout(stop, MAX_DURATION_MS)
  const startedAt = performance.now()
  let firstByteAt = 0
  let lastByteAt = 0
  let firstChunkBytes = 0
  let total = 0
  // Through a proxy, a lost packet stalls the download for about a second and the backlog then
  // lands in one burst, so the rate is taken over the whole download. A stall can hold back even
  // the first byte, so the clock starts when the handshake should be done rather than at the first
  // byte. A reused connection skips the handshake, so the clock never starts after the first byte.
  const timed = (until: number) => {
    const from =
      latencyMs === null
        ? firstByteAt
        : Math.min(startedAt + latencyMs, firstByteAt)
    // Bytes that arrive at the moment the clock starts took no measured time.
    const bytes = from === firstByteAt ? total - firstChunkBytes : total
    return { bytes, ms: until - from }
  }

  try {
    // The webview's fetch is held to CORS, which the domestic CDN does not answer.
    const response = direct
      ? await directFetch(DIRECT_TEST_URL, {
          signal: controller.signal,
          headers: { Range: `bytes=0-${SPEED_TEST_BYTES - 1}` },
        })
      : await fetch(SPEED_TEST_URL, {
          cache: 'no-store',
          signal: controller.signal,
        })
    if (!response.ok || !response.body) throw new Error('Speed test failed')

    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const now = performance.now()
      total += value.length
      if (!firstByteAt) {
        firstByteAt = now
        firstChunkBytes = value.length
      }
      lastByteAt = now
      const { bytes, ms } = timed(now)
      onProgress?.(
        Math.min(
          Math.max(
            total / SPEED_TEST_BYTES,
            (now - startedAt) / MAX_DURATION_MS,
          ),
          1,
        ),
        toMbps(bytes, Math.max(ms, 1)),
      )
      // A server that ignores Range would otherwise send the whole file.
      if (total >= SPEED_TEST_BYTES) break
    }
  } catch (error) {
    // The deadline abort still leaves whatever was measured before it; the two fetches report an
    // abort differently, so the controller is what tells it apart from a real failure.
    if (!controller.signal.aborted) throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
    controller.abort()
  }

  if (signal?.aborted) throw abortError()
  const { bytes, ms } = timed(lastByteAt)
  if (!firstByteAt || bytes <= 0 || ms <= 0) {
    throw new Error('No data received')
  }
  return toMbps(bytes, ms)
}

// Rough stand-in for a worldwide speed distribution: log-normal around a 95 Mbps median. Replace
// with real data before quoting it as more than "about".
const WORLD_MEDIAN_MBPS = 95
const WORLD_LOG_SPREAD = 1.2

/** Share of users worldwide, in whole percent, with a slower download than `mbps`. */
export const worldShareBelow = (mbps: number) => {
  const z = (Math.log(mbps) - Math.log(WORLD_MEDIAN_MBPS)) / WORLD_LOG_SPREAD
  // Abramowitz–Stegun approximation of erf(|z| / √2).
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp((-z * z) / 2)
  return Math.min(99, Math.max(1, Math.round(50 * (1 + Math.sign(z) * erf))))
}

/** Handshake time to the test server, through the same route the test takes. */
export const measureLatencyMs = async (direct = false) => {
  const delay = await cmdTestDelay(
    direct ? DIRECT_TEST_URL : 'https://speed.cloudflare.com',
  ).catch(() => 0)
  return classifyDelay(delay, MVP_DELAY_TIMEOUT) === 'measured' ? delay : null
}
