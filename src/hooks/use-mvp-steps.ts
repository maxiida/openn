import { useState } from 'react'

import { stepSegments } from '@/utils/mvp-progress'

/**
 * Steps for one operation: `report` takes a service's own step count, and `extra` more steps the
 * caller finishes afterwards with `advance`. Call `reset` before starting and `fail` when the
 * running step fails.
 */
export const useMvpSteps = (extra = 0) => {
  const [steps, setSteps] = useState({ done: 0, total: 1, failed: false })
  return {
    segments: stepSegments(steps.done, steps.total, steps.failed),
    reset: () => setSteps({ done: 0, total: 1, failed: false }),
    report: (done: number, total: number) =>
      setSteps({ done, total: total + extra, failed: false }),
    advance: () =>
      setSteps((current) => ({
        ...current,
        done: Math.min(current.done + 1, current.total),
      })),
    fail: () => setSteps((current) => ({ ...current, failed: true })),
  }
}
