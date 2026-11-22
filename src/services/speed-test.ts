import { fetch as directFetch } from '@tauri-apps/plugin-http'

import { cmdTestDelay } from '@/services/cmds'
import { classifyDelay } from '@/utils/delay'
import { MVP_DELAY_TIMEOUT } from '@/utils/main-proxy-group'

// Hard cap on data per test: nodes with a traffic multiplier bill it many times over.
const SPEED_TEST_BYTES = 4_000_000
// Broadband data is not billed against the subscription, so that test can run long enough for a
// fast line to reach full speed.
const DIRECT_TEST_BYTES = 25_000_000
// A slow route stops here instead of spending its whole allowance.
const TRANSFER_MS = 3_000
const SPEED_TEST_URL = `https://speed.cloudflare.com/__down?bytes=${SPEED_TEST_BYTES}`
// An immutable package on a domestic CDN: split routing sends it direct, so it measures the
// broadband line itself. Overseas servers would mostly measure the international link instead.
const DIRECT_TEST_URL =
  'https://cdn.npmmirror.com/packages/@next/swc-darwin-arm64/14.2.3/swc-darwin-arm64-14.2.3.tgz'
// Gives up on a node that takes this long to deliver anything.
const FIRST_BYTE_TIMEOUT_MS = 10_000

/** Megabytes a test through the node spends of the subscription at most. */
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
 * Downloads for TRANSFER_MS or until the route's byte cap, whichever comes first, and returns the
 * speed with the bytes it spent. `onProgress` gets 0–1 through the test, by bytes or by time,
 * whichever is further.
 */
export const measureDownloadMbps = async (
  onProgress?: MeasureOptions['onProgress'],
  {
    direct = false,
    signal,
    latencyMs = null,
  }: Omit<MeasureOptions, 'onProgress'> = {},
): Promise<{ mbps: number; bytes: number }> => {
  if (signal?.aborted) throw abortError()
  const maxBytes = direct ? DIRECT_TEST_BYTES : SPEED_TEST_BYTES
  const controller = new AbortController()
  const stop = () => controller.abort()
  signal?.addEventListener('abort', stop)
  let timer = setTimeout(stop, FIRST_BYTE_TIMEOUT_MS)
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
          headers: { Range: `bytes=0-${maxBytes - 1}` },
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
        clearTimeout(timer)
        timer = setTimeout(stop, TRANSFER_MS)
      }
      lastByteAt = now
      const { bytes, ms } = timed(now)
      onProgress?.(
        Math.min(
          Math.max(total / maxBytes, (now - firstByteAt) / TRANSFER_MS),
          1,
        ),
        toMbps(bytes, Math.max(ms, 1)),
      )
      // A server that ignores Range would otherwise send the whole file.
      if (total >= maxBytes) break
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
  return { mbps: toMbps(bytes, ms), bytes: total }
}

/** Handshake time to the test server, through the same route the test takes. */
export const measureLatencyMs = async (direct = false) => {
  const delay = await cmdTestDelay(
    direct ? DIRECT_TEST_URL : 'https://speed.cloudflare.com',
  ).catch(() => 0)
  return classifyDelay(delay, MVP_DELAY_TIMEOUT) === 'measured' ? delay : null
}
