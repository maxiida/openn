// Hard cap on data per test: nodes with a traffic multiplier bill it many times over.
const SPEED_TEST_BYTES = 4_000_000
const SPEED_TEST_URL = `https://speed.cloudflare.com/__down?bytes=${SPEED_TEST_BYTES}`
// Gives up on a node that takes this long to deliver anything.
const MAX_DURATION_MS = 10_000
// TCP slow start makes the first moments unrepresentative of the link.
const WARMUP_BYTES = 1_000_000
const WARMUP_MS = 1000
const MEASURE_MS = 3000

/** Downloads at most SPEED_TEST_BYTES, so a test spends little of a metered plan. Returns Mbps. */
export const measureDownloadMbps = async (): Promise<number> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MAX_DURATION_MS)
  let measuredFrom = 0
  let measuredUntil = 0
  let measuredBytes = 0

  try {
    const response = await fetch(SPEED_TEST_URL, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error('Speed test failed')

    const reader = response.body.getReader()
    // Timed from the first byte: waiting on a slow node handshake is not bandwidth.
    let firstByteAt = 0
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const now = performance.now()
      total += value.length
      firstByteAt ||= now
      if (measuredFrom) {
        measuredBytes += value.length
        measuredUntil = now
        if (now - measuredFrom >= MEASURE_MS) break
      } else if (total >= WARMUP_BYTES || now - firstByteAt >= WARMUP_MS) {
        measuredFrom = now
      }
    }
  } catch (error) {
    // The deadline abort still leaves whatever was measured before it.
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      throw error
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }

  const seconds = (measuredUntil - measuredFrom) / 1000
  if (measuredBytes <= 0 || seconds <= 0) throw new Error('No data received')
  return (measuredBytes * 8) / seconds / 1_000_000
}
