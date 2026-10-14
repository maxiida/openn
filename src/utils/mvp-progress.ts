/** One unit of work: finished (and how it went), running, or waiting. */
export type MvpSegment = 'pending' | 'active' | 'done' | 'warn' | 'error'

export type MvpOutcome = 'success' | 'partial' | 'failure'

/** Every ring has this many segments, however many units of work it counts. */
export const RING_SEGMENTS = 6

export const isSettledSegment = (segment: MvpSegment) =>
  segment === 'done' || segment === 'warn' || segment === 'error'

/** Whole segments only: a share of a segment is not shown until the segment is complete. */
export const fractionSegments = (value: number, count: number) => {
  const filled = Math.floor(Math.min(Math.max(value, 0), 1) * count)
  return Array.from(
    { length: count },
    (_, index): MvpSegment => (index < filled ? 'done' : 'pending'),
  )
}

/** `done` finished steps, then the one running now, or the one that failed. */
export const stepSegments = (done: number, total: number, failed = false) =>
  Array.from(
    { length: total },
    (_, index): MvpSegment =>
      index < done
        ? 'done'
        : index === done
          ? failed
            ? 'error'
            : 'active'
          : 'pending',
  )

/**
 * Folds any number of units into the ring's fixed segments. A segment lights only once all of
 * its units finished; `lag` orders segments that light together because they share one unit.
 */
export const toRingSegments = (units: readonly MvpSegment[]) =>
  Array.from({ length: RING_SEGMENTS }, (_, index) => {
    const from = Math.floor((index * units.length) / RING_SEGMENTS)
    const to = Math.max(
      from + 1,
      Math.floor(((index + 1) * units.length) / RING_SEGMENTS),
    )
    const covered = units.slice(from, to)
    const state: MvpSegment = covered.every(isSettledSegment)
      ? covered.includes('error')
        ? 'error'
        : covered.includes('warn')
          ? 'warn'
          : 'done'
      : covered.includes('active')
        ? 'active'
        : 'pending'
    const lag =
      index - Math.ceil((from * RING_SEGMENTS) / Math.max(units.length, 1))
    return { position: index, state, lag: Math.max(lag, 0) }
  })

/**
 * How finished work went: a failure is every unit failing or a failed unit cutting the rest short;
 * work that stopped without a failed unit has no outcome to show.
 */
export const outcomeOf = (
  units: readonly MvpSegment[] | undefined,
): MvpOutcome | null => {
  if (!units?.length) return null
  if (units.every((unit) => unit === 'done')) return 'success'
  const settled = units.every(isSettledSegment)
  if (
    units.includes('error') &&
    (!settled || units.every((u) => u === 'error'))
  )
    return 'failure'
  return settled ? 'partial' : null
}
