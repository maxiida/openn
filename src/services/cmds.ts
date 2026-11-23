import { invoke } from '@tauri-apps/api/core'

import type { ProxyViewV1 } from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'

export async function getProfiles() {
  return invoke<IProfilesConfig>('get_profiles')
}

export async function patchProfilesConfig(profiles: IProfilesConfig) {
  return invoke<ValidationOutcome>('patch_profiles_config', { profiles })
}

export async function createProfile(
  item: Partial<IProfileItem>,
  fileData?: string | null,
) {
  return invoke<string>('create_profile', { item, fileData })
}

async function importProfile(url: string, option?: IProfileOption) {
  return invoke<void>('import_profile', {
    url,
    option,
  })
}

export type ProfileImportRoute = 'direct' | 'system' | 'clash'

export async function importProfileWithFallbacks(
  url: string,
): Promise<ProfileImportRoute> {
  let lastError: unknown

  try {
    await importProfile(url)
    return 'direct'
  } catch (error) {
    lastError = error
  }

  const systemProxy = await getSystemProxy().catch(() => null)
  if (systemProxy?.enable && systemProxy.server) {
    try {
      await importProfile(url, { with_proxy: true, self_proxy: false })
      return 'system'
    } catch (error) {
      lastError = error
    }
  }

  const [profiles, runtime] = await Promise.all([
    getProfiles(),
    getRuntimeState(),
  ])
  if (profiles.current && runtime.mode !== 'NotRunning') {
    try {
      await importProfile(url, { with_proxy: false, self_proxy: true })
      return 'clash'
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

export async function updateProfile(index: string, option?: IProfileOption) {
  return invoke<void>('update_profile', { index, option })
}

export async function deleteProfile(index: string) {
  return invoke<void>('delete_profile', { index })
}

export async function patchProfile(
  index: string,
  profile: Partial<IProfileItem>,
) {
  return invoke<void>('patch_profile', { index, profile })
}

export async function getClashInfo() {
  return invoke<IClashInfo | null>('get_clash_info')
}

// Fallback mode read independent of strict mihomo `/configs` deserialization.
export async function getClashMode() {
  return invoke<string | null>('get_clash_mode')
}

export async function getRuntimeConfig() {
  return invoke<IConfigData | null>('get_runtime_config')
}

/** Local ports, each leaving through one node, on a core separate from the running one. */
export async function startAiProbe(nodes: string[]) {
  return invoke<Record<string, number>>('start_ai_probe', { nodes })
}

export async function stopAiProbe() {
  return invoke<void>('stop_ai_probe')
}

export async function patchClashConfig(payload: Partial<IConfigData>) {
  return invoke<void>('patch_clash_config', { payload })
}

export async function patchClashMode(payload: string) {
  return invoke<void>('patch_clash_mode', { payload })
}

export async function syncTrayProxySelection() {
  return invoke<void>('sync_tray_proxy_selection')
}

/** Sends one selection pair so the backend can merge against current profile state. */
export async function recordSelectedNode(groupName: string, node: string) {
  return invoke<void>('record_selected_node', { groupName, node })
}

export async function forgetSelectedNode(groupName: string) {
  return invoke<void>('forget_selected_node', { groupName })
}

export async function getProxyView(): Promise<ProxyViewV1> {
  const view = await invoke<ProxyViewV1>('get_proxy_view')
  if (view.schemaVersion !== 1) {
    throw new Error('Unsupported proxy view schema: ' + view.schemaVersion)
  }
  return view
}

export async function getVergeConfig() {
  return invoke<IVergeConfig>('get_verge_config')
}

export async function patchVergeConfig(payload: IVergeConfig) {
  return invoke<void>('patch_verge_config', { payload })
}

export async function getSystemLanguage() {
  return invoke<string>('get_system_language')
}

export async function takeDnsOverrideNotice() {
  return invoke<boolean>('take_dns_override_notice')
}

export async function takeServiceFallbackNotice() {
  return invoke<boolean>('take_service_fallback_notice')
}

export async function getSystemProxy() {
  return invoke<{
    enable: boolean
    server: string
    bypass: string
  }>('get_sys_proxy')
}

export async function getAutotemProxy() {
  try {
    debugLog('[API] 开始调用 get_auto_proxy')
    const result = await invoke<{
      enable: boolean
      url: string
    }>('get_auto_proxy')
    debugLog('[API] get_auto_proxy 调用成功:', result)
    return result
  } catch (error) {
    console.error('[API] get_auto_proxy 调用失败:', error)
    return {
      enable: false,
      url: '',
    }
  }
}

export async function getEmbeddedServerPort() {
  return invoke<number>('get_embedded_server_port')
}

export async function restartCore() {
  return invoke<void>('restart_core')
}

export async function cmdTestDelay(url: string) {
  return invoke<number>('test_delay', { url })
}

export async function exitApp() {
  return invoke('exit_app')
}

export async function exportLogs() {
  return invoke<void>('export_logs')
}

export type RunningMode = 'Service' | 'Sidecar' | 'NotRunning'

type ServiceHealth =
  | 'unknown'
  | 'ready'
  | 'notInstalled'
  | 'versionMismatch'
  | 'unavailable'

type PendingServiceAction =
  | 'install'
  | 'uninstall'
  | 'reinstall'
  | 'forceReinstall'

/** Consistent core/service snapshot with backend-derived availability flags. */
export interface RunState {
  mode: RunningMode
  service: ServiceHealth
  serviceUnavailableReason: string | null
  pendingAction: PendingServiceAction | null
  sidecarAllowed: boolean
  isAdmin: boolean
  opInFlight: boolean
  serviceUsable: boolean
  tunCapable: boolean
  serviceNeedsAttention: boolean
}

export const getConnectionUnhealthy = async () => {
  return invoke<boolean>('get_connection_unhealthy')
}

export interface AiNodeHealth {
  state: 'off' | 'ok' | 'down' | 'missing'
  node: string | null
}

export const closeNodeConnectionsWhenIdle = async (node: string) => {
  return invoke<void>('close_node_connections_when_idle', { node })
}

export const getAiNodeHealth = async () => {
  return invoke<AiNodeHealth>('get_ai_node_health')
}

export const recheckConnectionHealth = async (knownDead: boolean) => {
  return invoke<void>('recheck_connection_health', { knownDead })
}

export const getRuntimeState = async () => {
  return invoke<RunState>('get_runtime_state')
}

interface StaleProxyEnv {
  variable: string
  value: string
}

export interface PreflightReport {
  // Interface of a tunnel holding the default route that this app did not raise.
  foreignTunnel: string | null
  // Port the active system proxy points at, when that is not our own listener.
  foreignSystemProxy: number | null
  // A login-session proxy variable aimed somewhere other than our own listener.
  staleProxyEnv: StaleProxyEnv | null
}

export const getPreflightReport = async () => {
  return invoke<PreflightReport>('get_preflight_report')
}

export type FailedOperation =
  | 'systemProxyEnable'
  | 'systemProxyDisable'
  | 'systemProxyRestore'
  | 'systemProxyGuard'

export const installService = async () => {
  return invoke<void>('install_service')
}

export const uninstallService = async () => {
  return invoke<void>('uninstall_service')
}

export const reinstallService = async () => {
  return invoke<void>('reinstall_service')
}

export const repairService = async () => {
  return invoke<void>('repair_service')
}
