import { getBaseConfig } from 'tauri-plugin-mihomo-api'
import { beforeEach, expect, test, vi } from 'vitest'

import {
  getRuntimeConfig,
  getRuntimeState,
  getVergeConfig,
  installService,
  patchVergeConfig,
  repairService,
  restartCore,
  type RunState,
} from '@/services/cmds'

import {
  connectMvpTunnel,
  disconnectMvp,
  MvpConnectionError,
} from './mvp-connection'

vi.mock('tauri-plugin-mihomo-api', () => ({ getBaseConfig: vi.fn() }))
vi.mock('./mvp', () => ({ ensureMvpMode: vi.fn() }))
vi.mock('@/services/cmds', () => ({
  getRuntimeConfig: vi.fn(),
  getRuntimeState: vi.fn(),
  getVergeConfig: vi.fn(),
  installService: vi.fn(),
  patchClashConfig: vi.fn(),
  patchVergeConfig: vi.fn(),
  reinstallService: vi.fn(),
  repairService: vi.fn(),
  restartCore: vi.fn(),
}))

const serviceState = {
  mode: 'Service',
  service: 'ready',
  tunCapable: true,
  isAdmin: false,
  opInFlight: false,
} as RunState

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRuntimeState).mockResolvedValue(serviceState)
  vi.mocked(getRuntimeConfig).mockResolvedValue({
    tun: {
      'auto-route': true,
      'auto-detect-interface': true,
      'dns-hijack': ['any:53', 'tcp://any:53'],
    },
  } as IConfigData)
  vi.mocked(getVergeConfig).mockResolvedValue({
    enable_tun_mode: false,
    enable_system_proxy: false,
  })
  vi.mocked(getBaseConfig).mockResolvedValue({
    tun: { enable: true, autoRoute: true },
  } as Awaited<ReturnType<typeof getBaseConfig>>)
})

test('requires setup instead of silently connecting only the system proxy', async () => {
  vi.mocked(getRuntimeState).mockResolvedValue({
    ...serviceState,
    mode: 'Sidecar',
    service: 'notInstalled',
    tunCapable: false,
  })
  await expect(connectMvpTunnel()).rejects.toThrow('Service setup is required')
  expect(patchVergeConfig).not.toHaveBeenCalled()
})

test('hands the core to the service before enabling whole-device routing', async () => {
  vi.mocked(getRuntimeState)
    .mockResolvedValueOnce({
      ...serviceState,
      mode: 'Sidecar',
      service: 'notInstalled',
      tunCapable: false,
    })
    .mockResolvedValueOnce({ ...serviceState, mode: 'Sidecar' })
  await connectMvpTunnel(true)
  expect(installService).toHaveBeenCalledOnce()
  expect(restartCore).toHaveBeenCalledOnce()
  expect(restartCore).toHaveBeenCalledBefore(vi.mocked(patchVergeConfig))
  expect(patchVergeConfig).toHaveBeenNthCalledWith(1, { enable_tun_mode: true })
  // The tunnel is the only takeover path; a system proxy alongside it is what strands the
  // machine offline when its listener goes away, so connecting clears it.
  expect(patchVergeConfig).toHaveBeenNthCalledWith(2, {
    enable_system_proxy: false,
  })
  expect(patchVergeConfig).not.toHaveBeenCalledWith({
    enable_system_proxy: true,
  })
})

test('restores the previous connection when the core does not enable routing', async () => {
  vi.mocked(getBaseConfig).mockResolvedValue({
    tun: { enable: false, autoRoute: true },
  } as Awaited<ReturnType<typeof getBaseConfig>>)
  await expect(connectMvpTunnel()).rejects.toThrow('Core did not enable')
  expect(patchVergeConfig).toHaveBeenLastCalledWith({
    enable_tun_mode: false,
    enable_system_proxy: false,
  })
  expect(patchVergeConfig).not.toHaveBeenCalledWith({
    enable_system_proxy: true,
  })
})

// A clear that lost the macOS preferences lock used to roll back a tunnel that was already up.
test('keeps a working tunnel when clearing the system proxy fails', async () => {
  vi.mocked(patchVergeConfig)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('lock preferences'))
  await expect(connectMvpTunnel()).resolves.toBeUndefined()
  expect(patchVergeConfig).not.toHaveBeenCalledWith(
    expect.objectContaining({ enable_tun_mode: false }),
  )
})

test('releases the tunnel even when disabling the system proxy fails', async () => {
  vi.mocked(patchVergeConfig).mockRejectedValueOnce(
    new Error('OS write failed'),
  )
  await expect(disconnectMvp()).rejects.toThrow('Disconnect failed')
  expect(patchVergeConfig).toHaveBeenLastCalledWith({ enable_tun_mode: false })
})

test('reports a core start failure separately and repairs an installed service on request', async () => {
  vi.mocked(getRuntimeState).mockResolvedValue({
    ...serviceState,
    mode: 'NotRunning',
  })
  vi.mocked(restartCore).mockRejectedValueOnce(new Error('No approved core'))
  await expect(connectMvpTunnel()).rejects.toMatchObject({
    constructor: MvpConnectionError,
    stage: 'start',
  })
  expect(patchVergeConfig).not.toHaveBeenCalled()
  vi.mocked(getRuntimeState)
    .mockResolvedValueOnce({ ...serviceState, mode: 'NotRunning' })
    .mockResolvedValueOnce({ ...serviceState, mode: 'NotRunning' })
    .mockResolvedValue(serviceState)
  await connectMvpTunnel(true)
  expect(repairService).toHaveBeenCalledOnce()
})

test('does not report a network service conflict as missing authorization', async () => {
  vi.mocked(getRuntimeState).mockResolvedValue({
    ...serviceState,
    mode: 'NotRunning',
  })
  vi.mocked(restartCore).mockRejectedValueOnce({
    message:
      'SystemConfiguration operation failed: resolve active network service',
  })
  await expect(connectMvpTunnel()).rejects.toMatchObject({ stage: 'network' })
  expect(installService).not.toHaveBeenCalled()
  expect(repairService).not.toHaveBeenCalled()
})
