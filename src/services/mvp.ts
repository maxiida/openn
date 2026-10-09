import dayjs from 'dayjs'
import { dump } from 'js-yaml'

import {
  createProfile,
  getClashMode,
  getProfiles,
  importProfileWithFallbacks,
  patchClashMode,
  patchProfilesConfig,
} from '@/services/cmds'
import { isValidUrl } from '@/utils/network'
import parseUri from '@/utils/uri-parser'

const wait = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration))

export const ensureRuleMode = async () => {
  const mode = await getClashMode()
  if (mode?.toLowerCase() !== 'rule') {
    await patchClashMode('rule')
  }
}

export const isProfileUpdatedToday = (profile: IProfileItem) =>
  profile.updated !== undefined &&
  dayjs.unix(profile.updated).isSame(dayjs(), 'day')

export const formatProfileUpdated = (updated?: number) => {
  if (!updated) return '尚未更新'
  const time = dayjs.unix(updated)
  const now = dayjs()
  if (time.isSame(now, 'day')) return `今天 ${time.format('HH:mm')} 更新`
  if (time.isSame(now.subtract(1, 'day'), 'day')) {
    return `昨天 ${time.format('HH:mm')} 更新`
  }
  return `${time.format(time.isSame(now, 'year') ? 'M月D日' : 'YYYY年M月D日')} 更新`
}

export const activateMvpProfile = async (uid: string) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const outcome = await patchProfilesConfig({ current: uid })
    if (outcome.status === 'valid') return
    if (outcome.status !== 'busy') {
      throw new Error(`Profile activation rejected: ${outcome.status}`)
    }
    await wait(250)
  }

  throw new Error('Profile activation remained busy')
}

export const importAndActivateMvpProfile = async (url: string) => {
  const before = await getProfiles()
  const existingIds = new Set((before.items ?? []).map((item) => item.uid))

  await importProfileWithFallbacks(url)

  const after = await getProfiles()
  const imported =
    (after.items ?? []).find((item) => !existingIds.has(item.uid)) ??
    [...(after.items ?? [])].reverse().find((item) => item.url === url)

  if (!imported) {
    throw new Error('Imported profile was not found after import')
  }

  await activateMvpProfile(imported.uid)
  await ensureRuleMode()
  return imported
}

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  )
  return atob(padded)
}

const unwrapQrPayload = (payload: string) => {
  const trimmed = payload.trim()
  const shadowrocketPrefix = 'shadowrocket://add/'

  if (trimmed.toLowerCase().startsWith(shadowrocketPrefix)) {
    return decodeURIComponent(trimmed.slice(shadowrocketPrefix.length))
  }

  if (trimmed.toLowerCase().startsWith('sub://')) {
    return decodeBase64Url(trimmed.slice('sub://'.length))
  }

  return trimmed
}

export const importAndActivateMvpQrPayload = async (payload: string) => {
  const value = unwrapQrPayload(payload)
  if (isValidUrl(value)) {
    return importAndActivateMvpProfile(value)
  }

  const proxy = parseUri(value)
  const fileData = dump(
    {
      proxies: [proxy],
      'proxy-groups': [
        {
          name: 'PROXY',
          type: 'select',
          proxies: [proxy.name],
        },
      ],
      rules: ['MATCH,PROXY'],
    },
    { forceQuotes: true },
  )

  const importedUid = await createProfile(
    {
      type: 'local',
      name: proxy.name,
      desc: 'QR code import',
      option: { with_proxy: false, self_proxy: false },
    },
    fileData,
  )

  const after = await getProfiles()
  const imported = (after.items ?? []).find((item) => item.uid === importedUid)
  if (!imported) {
    throw new Error('Imported QR profile was not found after import')
  }

  await activateMvpProfile(imported.uid)
  await ensureRuleMode()
  return imported
}
