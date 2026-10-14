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
export type MvpSiteStatus = 'ok' | 'slow' | 'down'

// A handshake this slow through the proxy means pages visibly hang before they start loading.
const SLOW_SITE_MS = 1500

const probe = (url: string) => cmdTestDelay(url).catch(() => 0)

export const checkSite = async (url: string): Promise<MvpSiteStatus> => {
  let delay = await probe(url)
  // A single lost handshake is common on a healthy node; only a repeat means the site is down.
  if (classifyDelay(delay, MVP_DELAY_TIMEOUT) !== 'measured') {
    delay = await probe(url)
  }
  if (classifyDelay(delay, MVP_DELAY_TIMEOUT) !== 'measured') return 'down'
  return delay >= SLOW_SITE_MS ? 'slow' : 'ok'
}

/** Goes through the local proxy port, so each result reflects the active rules and node. */
export const checkMvpSites = async (
  onResult?: (id: MvpSiteId, status: MvpSiteStatus) => void,
) =>
  Object.fromEntries(
    await Promise.all(
      MVP_SITES.map(async (site) => {
        const status = await checkSite(site.url)
        onResult?.(site.id, status)
        return [site.id, status]
      }),
    ),
  ) as Record<MvpSiteId, MvpSiteStatus>
