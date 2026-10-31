import { useEffect, useState } from 'react'

import { getConnectionUnhealthy } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'

/** Whether the selected node stopped responding, the same verdict the tray and Dock dots show. */
export const useConnectionUnhealthy = () => {
  const [unhealthy, setUnhealthy] = useState(false)
  useEffect(
    () =>
      subscribeVergeEvents(
        { 'verge://connection-health-changed': setUnhealthy },
        () => {
          getConnectionUnhealthy()
            .then(setUnhealthy)
            .catch((error) => {
              console.warn('[Proxy MVP] Connection health unavailable:', error)
            })
        },
      ),
    [],
  )
  return unhealthy
}
