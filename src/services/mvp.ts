import dayjs from 'dayjs'
import i18n from 'i18next'
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

/** Called with 0 finished steps up front, then after each step. */
export type MvpStepReporter = (done: number, total: number) => void

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

export const formatTrafficAmount = (bytes: number, language: string) => {
  const gb = bytes / 1024 ** 3
  if (gb < 1) {
    const mb = new Intl.NumberFormat(language, { maximumFractionDigits: 0 })
    return `${mb.format(bytes / 1024 ** 2)} MB`
  }
  const format = new Intl.NumberFormat(language, {
    maximumFractionDigits: gb < 100 ? 1 : 0,
  })
  return `${format.format(gb)} GB`
}

export const formatProfileUpdated = (updated?: number) => {
  if (!updated) return i18n.t(($) => $.mvp.subscriptions.updated.never)
  const time = dayjs.unix(updated)
  const now = dayjs()
  if (time.isSame(now, 'day')) {
    return i18n.t(($) => $.mvp.subscriptions.updated.today, {
      time: time.format('HH:mm'),
    })
  }
  if (time.isSame(now.subtract(1, 'day'), 'day')) {
    return i18n.t(($) => $.mvp.subscriptions.updated.yesterday, {
      time: time.format('HH:mm'),
    })
  }
  return i18n.t(($) => $.mvp.subscriptions.updated.date, {
    date: time.format(
      time.isSame(now, 'year')
        ? i18n.t(($) => $.mvp.subscriptions.updated.dateFormat)
        : i18n.t(($) => $.mvp.subscriptions.updated.dateFormatWithYear),
    ),
  })
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

export const importAndActivateMvpProfile = async (
  url: string,
  onStep?: MvpStepReporter,
) => {
  onStep?.(0, 2)
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
  onStep?.(1, 2)

  await activateMvpProfile(imported.uid)
  await ensureRuleMode()
  onStep?.(2, 2)
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

export const importAndActivateMvpQrPayload = async (
  payload: string,
  onStep?: MvpStepReporter,
) => {
  const value = unwrapQrPayload(payload)
  if (isValidUrl(value)) {
    return importAndActivateMvpProfile(value, onStep)
  }

  onStep?.(0, 2)
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
  onStep?.(1, 2)

  await activateMvpProfile(imported.uid)
  await ensureRuleMode()
  onStep?.(2, 2)
  return imported
}
