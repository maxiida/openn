import { getBaseConfig } from 'tauri-plugin-mihomo-api'

import {
  getRuntimeConfig,
  getRuntimeState,
  getVergeConfig,
  installService,
  patchClashConfig,
  patchVergeConfig,
  reinstallService,
  repairService,
  restartCore,
} from '@/services/cmds'

import { ensureRuleMode } from './mvp'

export class MvpConnectionError extends Error {
  constructor(
    readonly stage: 'setup' | 'start' | 'network',
    cause: unknown,
  ) {
    super(`Connection ${stage} failed`, { cause })
  }
}

export const connectMvpTunnel = async (setupService = false) => {
  let state = await getRuntimeState()
  if (state.opInFlight) throw new Error('Service operation is in progress')

  if (setupService || !state.tunCapable) {
    if (!setupService) throw new Error('Service setup is required')
    try {
      if (state.service === 'notInstalled') {
        await installService()
      } else if (state.service === 'versionMismatch') {
        await reinstallService()
      } else {
        await repairService()
      }
    } catch (error) {
      throw new MvpConnectionError('setup', error)
    }
    state = await getRuntimeState()
  }

  if (
    state.mode === 'NotRunning' ||
    (state.mode !== 'Service' && !state.isAdmin)
  ) {
    try {
      await restartCore()
    } catch (error) {
      const detail =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error)
      if (detail.includes('resolve active network service')) {
        throw new MvpConnectionError('network', error)
      }
      throw new MvpConnectionError('start', error)
    }
    state = await getRuntimeState()
  }
  if (
    !state.tunCapable ||
    (state.mode !== 'Service' && !(state.mode === 'Sidecar' && state.isAdmin))
  ) {
    throw new Error('Privileged core is unavailable')
  }

  await ensureRuleMode()
  const runtime = await getRuntimeConfig()
  if (!runtime) throw new Error('Runtime configuration is unavailable')
  if (
    !runtime.tun['auto-route'] ||
    !runtime.tun['auto-detect-interface'] ||
    !runtime.tun['dns-hijack'].includes('any:53') ||
    !runtime.tun['dns-hijack'].includes('tcp://any:53')
  ) {
    await patchClashConfig({
      tun: {
        ...runtime.tun,
        'auto-route': true,
        'auto-detect-interface': true,
        'dns-hijack': ['any:53', 'tcp://any:53'],
      },
    })
  }

  const previous = await getVergeConfig()
  try {
    await patchVergeConfig({ enable_tun_mode: true })
    const live = await getBaseConfig()
    if (!live.tun.enable || !live.tun.autoRoute) {
      throw new Error('Core did not enable tunnel routing')
    }
  } catch (error) {
    try {
      await patchVergeConfig({
        enable_system_proxy: previous.enable_system_proxy ?? false,
        enable_tun_mode: previous.enable_tun_mode ?? false,
      })
    } catch (rollbackError) {
      console.error('[Proxy MVP] Connection rollback failed:', rollbackError)
    }
    throw error
  }

  // The tunnel already carries every app's traffic, so a system proxy on top adds no coverage.
  // It is also the one setting that takes the whole machine offline when it outlives its
  // listener, so clear whatever was there — but a failed clear must not tear down a tunnel that
  // is already carrying traffic.
  try {
    await patchVergeConfig({ enable_system_proxy: false })
  } catch (error) {
    console.error('[Proxy MVP] Clearing the system proxy failed:', error)
  }
}

export const disconnectMvp = async () => {
  // Each path must be released even if releasing the other one fails.
  const errors: unknown[] = []
  for (const patch of [
    { enable_system_proxy: false },
    { enable_tun_mode: false },
  ]) {
    try {
      await patchVergeConfig(patch)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Disconnect failed')
}
