import { useMainProxyGroup } from '@/hooks/use-main-proxy-group'
import { useVerge } from '@/hooks/use-verge'

/** `member` is undefined when no node is chosen or it is gone from the subscription. */
export const useAiNode = () => {
  const { members } = useMainProxyGroup()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const enabled = verge?.enable_ai_node === true
  const name = verge?.ai_node || null
  const member = name
    ? members.find((item) => item.ref.name === name)
    : undefined

  const save = (patch: Partial<IVergeConfig>) => {
    mutateVerge((prev) => (prev ? { ...prev, ...patch } : prev), false)
    patchVerge(patch).catch((error) => {
      console.error('[Proxy MVP] AI node change failed:', error)
      mutateVerge()
    })
  }

  return {
    enabled,
    name,
    member,
    setEnabled: (next: boolean) => save({ enable_ai_node: next }),
    choose: (node: string) => save({ enable_ai_node: true, ai_node: node }),
  }
}
