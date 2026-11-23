import { fetch as directFetch } from '@tauri-apps/plugin-http'

import { cmdTestDelay } from '@/services/cmds'
import { classifyDelay } from '@/utils/delay'
import { MVP_DELAY_TIMEOUT } from '@/utils/main-proxy-group'

// The domestic site proves split routing still sends Chinese traffic direct.
export const MVP_SITES = [
  { id: 'google', name: 'Google', url: 'https://www.google.com' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'github', name: 'GitHub', url: 'https://github.com' },
  { id: 'baidu', name: null, url: 'https://www.baidu.com', domestic: true },
] as const

export type MvpSiteId = (typeof MVP_SITES)[number]['id']
export type MvpSiteStatus = 'ok' | 'down' | 'blocked'

const probe = (url: string) => cmdTestDelay(url).catch(() => 0)

export const checkSite = async (url: string): Promise<MvpSiteStatus> => {
  let delay = await probe(url)
  // A single lost handshake is common on a healthy node; only a repeat means the site is down.
  if (classifyDelay(delay, MVP_DELAY_TIMEOUT) !== 'measured') {
    delay = await probe(url)
  }
  return classifyDelay(delay, MVP_DELAY_TIMEOUT) === 'measured' ? 'ok' : 'down'
}

// ChatGPT completes the handshake from regions it refuses and only turns them away inside the
// app, where this endpoint answers unsupported_country.
const CHATGPT_REGION_URL =
  'https://api.openai.com/compliance/cookie_requirements'
const REGION_TIMEOUT_MS = 10_000

const chatGptRefusesRegion = async (mixedPort: number) => {
  try {
    const response = await directFetch(CHATGPT_REGION_URL, {
      headers: { authorization: 'Bearer null' },
      proxy: { all: `http://127.0.0.1:${mixedPort}` },
      connectTimeout: REGION_TIMEOUT_MS,
      signal: AbortSignal.timeout(REGION_TIMEOUT_MS),
    })
    return (await response.text()).includes('unsupported_country')
  } catch {
    return false
  }
}

/** Goes through the local proxy port, so each result reflects the active rules and node. */
export const checkMvpSites = async (
  mixedPort: number,
  onResult?: (id: MvpSiteId, status: MvpSiteStatus) => void,
) =>
  Object.fromEntries(
    await Promise.all(
      MVP_SITES.map(async (site) => {
        let status = await checkSite(site.url)
        if (
          site.id === 'chatgpt' &&
          status !== 'down' &&
          (await chatGptRefusesRegion(mixedPort))
        ) {
          status = 'blocked'
        }
        onResult?.(site.id, status)
        return [site.id, status]
      }),
    ),
  ) as Record<MvpSiteId, MvpSiteStatus>
