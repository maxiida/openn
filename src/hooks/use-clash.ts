import { useLockFn } from 'ahooks'
import i18n from 'i18next'

import {
  getClashInfo,
  getRuntimeConfig,
  patchClashConfig,
} from '@/services/cmds'
import { revalidateQuery, useQuery } from '@/services/query-client'

const PORT_KEYS = [
  'port',
  'socks-port',
  'mixed-port',
  'redir-port',
  'tproxy-port',
] as const

type ClashInfoPatch = Partial<
  Pick<
    IConfigData,
    | 'port'
    | 'socks-port'
    | 'mixed-port'
    | 'redir-port'
    | 'tproxy-port'
    | 'external-controller'
    | 'secret'
  >
>

const hasClashInfoPayload = (patch: ClashInfoPatch) =>
  PORT_KEYS.some((key) => patch[key] != null) ||
  patch['external-controller'] != null ||
  patch.secret != null

const validatePortRange = (port: number) => {
  if (port < 1000) {
    throw new Error(
      i18n.t(($) => $.settings.modals.clashPort.messages.portTooLow),
    )
  }
  if (port > 65535) {
    throw new Error(
      i18n.t(($) => $.settings.modals.clashPort.messages.portTooHigh),
    )
  }
}

const validatePorts = (patch: ClashInfoPatch) => {
  PORT_KEYS.forEach((key) => {
    const port = patch[key]
    if (!port) return
    validatePortRange(port)
  })
}

export const useRuntimeConfig = (shouldFetch: boolean = true) => {
  return useQuery({
    queryKey: ['getRuntimeConfig'],
    queryFn: getRuntimeConfig,
    enabled: shouldFetch,
  })
}

export const useClashInfo = () => {
  const { data: clashInfo, refetch: mutateInfo } = useQuery({
    queryKey: ['getClashInfo'],
    queryFn: getClashInfo,
  })

  const patchInfo = useLockFn(async (patch: ClashInfoPatch) => {
    if (!hasClashInfoPayload(patch)) return

    validatePorts(patch)

    await patchClashConfig(patch)
    mutateInfo()
    revalidateQuery(['getClashConfig'])
  })

  const invalidateClashConfig = () => revalidateQuery(['getClashConfig'])

  return {
    clashInfo,
    mutateInfo,
    patchInfo,
    invalidateClashConfig,
  }
}
