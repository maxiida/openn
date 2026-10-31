import { useEffect, useState } from 'react'

import { getConnectionUnhealthy } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'

/**
 * Whether the selected node stopped responding, the same verdict the tray and Dock dots show.
 * `epoch` counts the changes, so results can be tied to the stretch they were measured in.
 */
export const useConnectionUnhealthy = () => {
  const [health, setHealth] = useState({ unhealthy: false, epoch: 0 })
  useEffect(() => {
    const apply = (unhealthy: boolean) =>
      setHealth((prev) =>
        prev.unhealthy === unhealthy
          ? prev
          : { unhealthy, epoch: prev.epoch + 1 },
      )
    return subscribeVergeEvents(
      { 'verge://connection-health-changed': apply },
      () => {
        getConnectionUnhealthy()
          .then(apply)
          .catch((error) => {
            console.warn('[Proxy MVP] Connection health unavailable:', error)
          })
      },
    )
  }, [])
  return health
}
