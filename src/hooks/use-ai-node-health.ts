import { useEffect, useState } from 'react'

import { type AiNodeHealth, getAiNodeHealth } from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'

/** The backend's verdict on the AI node, probed alongside the main node. */
export const useAiNodeHealth = () => {
  const [health, setHealth] = useState<AiNodeHealth>({
    state: 'off',
    node: null,
  })
  useEffect(
    () =>
      subscribeVergeEvents(
        { 'verge://ai-node-health-changed': setHealth },
        () => {
          getAiNodeHealth()
            .then(setHealth)
            .catch((error) => {
              console.warn('[Proxy MVP] AI node health unavailable:', error)
            })
        },
      ),
    [],
  )
  return health
}
