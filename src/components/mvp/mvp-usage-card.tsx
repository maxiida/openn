import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { ReloadIcon } from '@radix-ui/react-icons'
import dayjs from 'dayjs'
import { CalendarIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { mvpCommandKey } from '@/hooks/use-mvp-shortcuts'
import { formatProfileUpdated, formatTrafficAmount } from '@/services/mvp'
import type { MvpSegment } from '@/utils/mvp-progress'

import { MvpProgressRing } from './mvp-progress-ring'
import { MvpShortcutHint } from './mvp-shortcut-hint'

const CELL_COUNT = 20
const LOW_RATIO = 0.1
const EXPIRY_WARN_DAYS = 3

interface Props {
  profile: IProfileItem
  updating: boolean
  progress: readonly MvpSegment[]
  disabled: boolean
  onUpdate: () => void
}

export const MvpUsageCard = ({
  profile,
  updating,
  progress,
  disabled,
  onUpdate,
}: Props) => {
  const { t, i18n } = useTranslation()
  const {
    upload = 0,
    download = 0,
    total = 0,
    expire = 0,
  } = profile.extra ?? {}
  if (total <= 0 && expire <= 0) return null

  const remaining = Math.max(0, total - upload - download)
  const low = total > 0 && remaining / total < LOW_RATIO
  const fillColor = low ? 'warning.main' : 'text.primary'

  const expireAt = dayjs.unix(expire)
  const daysLeft = Math.ceil(expireAt.diff(dayjs(), 'day', true))
  const expireDate = expireAt.format(
    expireAt.isSame(dayjs(), 'year')
      ? t('mvp.subscriptions.updated.dateFormat')
      : t('mvp.subscriptions.updated.dateFormatWithYear'),
  )
  const expireText =
    daysLeft <= 0
      ? t('mvp.usage.expired', { date: expireDate })
      : daysLeft <= EXPIRY_WARN_DAYS
        ? t('mvp.usage.expiresIn', { count: daysLeft, date: expireDate })
        : t('mvp.usage.expiresOn', { date: expireDate })
  const expireColor =
    daysLeft <= 0
      ? 'error.main'
      : daysLeft <= EXPIRY_WARN_DAYS
        ? 'warning.main'
        : 'text.secondary'

  const perCell = total / CELL_COUNT

  return (
    <Box
      sx={{
        mb: 2.5,
        pl: 2,
        pr: 1.5,
        py: 1.5,
        borderRadius: 3,
        bgcolor: 'action.hover',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mb: total > 0 ? 1.25 : 0,
        }}
      >
        {total > 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography
              sx={{
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: '-0.3px',
                fontVariantNumeric: 'tabular-nums',
                color: fillColor,
              }}
            >
              {formatTrafficAmount(remaining, i18n.language)}
            </Typography>
            <Typography color="textSecondary" sx={{ fontSize: 13 }}>
              {t('mvp.usage.total', {
                total: formatTrafficAmount(total, i18n.language),
              })}
            </Typography>
          </Box>
        ) : (
          <span />
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <Typography color="textSecondary" noWrap sx={{ fontSize: 12.5 }}>
            {formatProfileUpdated(profile.updated)}
          </Typography>
          <Tooltip
            title={
              <MvpShortcutHint
                label={t('mvp.subscriptions.update')}
                shortcut={`${mvpCommandKey}U`}
              />
            }
          >
            <span>
              <IconButton
                size="small"
                aria-label={t('mvp.subscriptions.update')}
                aria-keyshortcuts={`${mvpCommandKey === '⌘' ? 'Meta' : 'Control'}+U`}
                disabled={disabled}
                onClick={onUpdate}
              >
                <MvpProgressRing busy={updating} size={17} segments={progress}>
                  <ReloadIcon width={15} height={15} />
                </MvpProgressRing>
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {total > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${CELL_COUNT}, minmax(0, 1fr))`,
            gap: '3px',
            mr: 0.5,
          }}
        >
          {Array.from({ length: CELL_COUNT }, (_, index) => {
            const fill = Math.max(
              0,
              Math.min(1, (remaining - index * perCell) / perCell),
            )
            return (
              <Box
                key={index}
                sx={{
                  height: 14,
                  borderRadius: '2px',
                  bgcolor: 'action.selected',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {fill > 0 && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      bgcolor: fillColor,
                      opacity: fill >= 1 ? 1 : 0.2 + 0.5 * fill,
                    }}
                  />
                )}
              </Box>
            )
          })}
        </Box>
      )}

      {expire > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mt: 1.25,
            color: expireColor,
          }}
        >
          <CalendarIcon size={13} />
          <Typography sx={{ fontSize: 12.5 }}>{expireText}</Typography>
        </Box>
      )}
    </Box>
  )
}
