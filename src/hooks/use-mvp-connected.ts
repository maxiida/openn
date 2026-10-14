import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import { useClashConfigData } from '@/providers/app-data-context'

/** Whether traffic actually goes through Openn right now, by tunnel or system proxy. */
export const useMvpConnected = () => {
  const { indicator: systemProxyEnabled } = useSystemProxyState()
  const { runState, isLoading: isRunStateLoading } = useSystemState()
  const { verge } = useVerge()
  const { clashConfig } = useClashConfigData()
  const tunnelEnabled = Boolean(
    verge?.enable_tun_mode &&
      runState.tunCapable &&
      runState.mode !== 'NotRunning' &&
      clashConfig?.tun.enable &&
      clashConfig.tun.autoRoute,
  )
  const connected =
    tunnelEnabled || (systemProxyEnabled && runState.mode !== 'NotRunning')
  return { connected, tunnelEnabled, systemProxyEnabled, isRunStateLoading }
}
