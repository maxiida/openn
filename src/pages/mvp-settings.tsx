import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { IconArrowLeft, IconChevronRight, IconTool } from '@tabler/icons-react'
import { getVersion } from '@tauri-apps/api/app'
import { useLockFn } from 'ahooks'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { BaseConfig } from 'tauri-plugin-mihomo-api'

import { BaseDialog, Switch } from '@/components/base'
import { MvpPage } from '@/components/mvp/mvp-page'
import { MvpProgressRing } from '@/components/mvp/mvp-progress-ring'
import { MvpSegmented } from '@/components/mvp/mvp-segmented'
import { MvpShortcutHint } from '@/components/mvp/mvp-shortcut-hint'
import { useMvpShortcuts } from '@/hooks/use-mvp-shortcuts'
import { useMvpSteps } from '@/hooks/use-mvp-steps'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
} from '@/providers/app-data-context'
import { resolveLanguage } from '@/services/i18n'
import { type MvpMode, setMvpMode } from '@/services/mvp'
import { MvpConnectionError, repairMvp } from '@/services/mvp-connection'
import { showNotice } from '@/services/notice-service'
import {
  revalidateQueries,
  setCacheData,
  useQuery,
} from '@/services/query-client'

type ThemeMode = NonNullable<IVergeConfig['theme_mode']>

const Section = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <Box>
    <Typography color="text.secondary" sx={{ fontSize: 13, mb: 1 }}>
      {title}
    </Typography>
    <Box sx={{ borderTop: 1, borderColor: 'divider' }}>{children}</Box>
  </Box>
)

const rowSx = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 64,
  px: 1,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 2,
  border: 0,
  borderBottom: 1,
  borderColor: 'divider',
  bgcolor: 'transparent',
  color: 'text.primary',
  textAlign: 'left',
  font: 'inherit',
} as const

const RowLabel = ({ label, hint }: { label: string; hint?: string }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: 15.5, fontWeight: 500 }}>{label}</Typography>
    {hint && (
      <Typography color="text.secondary" sx={{ fontSize: 12.5, mt: 0.25 }}>
        {hint}
      </Typography>
    )}
  </Box>
)

const Row = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) => (
  <Box sx={rowSx}>
    <RowLabel label={label} hint={hint} />
    {children}
  </Box>
)

const MvpSettingsPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { refreshAll, refreshClashConfig } = useAppRefreshers()
  const { clashConfig } = useClashConfigData()
  const [pendingMode, setPendingMode] = useState<MvpMode | null>(null)
  const { data: version } = useQuery({
    queryKey: ['getAppVersion'],
    queryFn: getVersion,
  })
  const [repairOpen, setRepairOpen] = useState(false)
  const [repairing, setRepairing] = useState(false)
  // The repair's own steps, then refreshing what the app shows.
  const repairSteps = useMvpSteps(1)
  useMvpShortcuts([
    { key: 'Escape', allowInControl: true, onPress: () => navigate('/') },
  ])

  const proxyMode: MvpMode =
    pendingMode ??
    (clashConfig?.mode?.toLowerCase() === 'global' ? 'global' : 'rule')
  const themeMode = verge?.theme_mode ?? 'system'
  const language = verge?.language ? resolveLanguage(verge.language) : ''

  const changeVerge = async (patch: Partial<IVergeConfig>) => {
    mutateVerge((prev) => (prev ? { ...prev, ...patch } : prev), false)
    try {
      await patchVerge(patch)
    } catch (error) {
      mutateVerge()
      throw error
    }
  }

  const onAutoLaunch = useLockFn(async (enabled: boolean) => {
    try {
      await changeVerge({ enable_auto_launch: enabled })
    } catch (error) {
      console.error('[Proxy MVP] Auto-launch change failed:', error)
      showNotice.error(t('mvp.settings.autoLaunch.failed'))
    }
  })

  const onProxyMode = useLockFn(async (mode: MvpMode) => {
    setPendingMode(mode)
    try {
      await setMvpMode(mode)
      // Write through the live cache so the control does not flash the old mode during refetch.
      setCacheData<BaseConfig>(['getClashConfig'], (old) =>
        old ? { ...old, mode } : old,
      )
      await refreshClashConfig()
    } catch (error) {
      console.error('[Proxy MVP] Proxy mode change failed:', error)
      showNotice.error(t('mvp.settings.proxyMode.failed'))
    } finally {
      setPendingMode(null)
    }
  })

  const onPreference = (patch: Partial<IVergeConfig>) => {
    changeVerge(patch).catch((error) => {
      console.error('[Proxy MVP] Preference change failed:', error)
    })
  }

  const onRepair = useLockFn(async () => {
    setRepairing(true)
    repairSteps.reset()
    let succeeded = false
    try {
      const reconnected = await repairMvp(repairSteps.report)
      succeeded = true
      setRepairOpen(false)
      showNotice.success(
        t(
          reconnected
            ? 'mvp.settings.repair.reconnected'
            : 'mvp.settings.repair.done',
        ),
      )
    } catch (error) {
      repairSteps.fail()
      console.error('[Proxy MVP] Repair failed:', error)
      showNotice.error(
        t(
          error instanceof MvpConnectionError && error.stage === 'setup'
            ? 'mvp.settings.repair.setupIncomplete'
            : 'mvp.settings.repair.failed',
        ),
      )
    } finally {
      await Promise.allSettled([
        refreshAll(),
        revalidateQueries([['getVergeConfig'], ['getRuntimeState']]),
      ])
      if (succeeded) repairSteps.advance()
      setRepairing(false)
    }
  })

  return (
    <MvpPage
      title={t('mvp.settings.title')}
      leading={
        <Tooltip
          title={
            <MvpShortcutHint label={t('mvp.common.back')} shortcut="Esc" />
          }
        >
          <IconButton
            aria-label={t('mvp.common.back')}
            aria-keyshortcuts="Escape"
            onClick={() => navigate('/')}
          >
            <IconArrowLeft size={22} />
          </IconButton>
        </Tooltip>
      }
    >
      <Box sx={{ display: 'grid', gap: 5, pt: 1 }}>
        <Section title={t('mvp.settings.connection')}>
          <Row label={t('mvp.settings.proxyMode.label')}>
            <MvpSegmented<MvpMode>
              label={t('mvp.settings.proxyMode.label')}
              value={proxyMode}
              options={[
                {
                  value: 'rule',
                  label: t('mvp.settings.proxyMode.rule'),
                  tooltip: t('mvp.settings.proxyMode.ruleTooltip'),
                },
                {
                  value: 'global',
                  label: t('mvp.settings.proxyMode.global'),
                  tooltip: t('mvp.settings.proxyMode.globalTooltip'),
                },
              ]}
              onChange={onProxyMode}
            />
          </Row>
        </Section>

        <Section title={t('mvp.settings.general')}>
          <Row
            label={t('mvp.settings.autoLaunch.label')}
            hint={t('mvp.settings.autoLaunch.hint')}
          >
            <Switch
              checked={verge?.enable_auto_launch ?? false}
              disabled={!verge}
              onChange={(_, checked) => onAutoLaunch(checked)}
              slotProps={{
                input: { 'aria-label': t('mvp.settings.autoLaunch.label') },
              }}
            />
          </Row>
          <Row label={t('mvp.settings.appearance.label')}>
            <MvpSegmented<ThemeMode>
              label={t('mvp.settings.appearance.label')}
              value={themeMode}
              options={[
                { value: 'system', label: t('mvp.settings.appearance.system') },
                { value: 'light', label: t('mvp.settings.appearance.light') },
                { value: 'dark', label: t('mvp.settings.appearance.dark') },
              ]}
              onChange={(value) => onPreference({ theme_mode: value })}
            />
          </Row>
          <Row label={t('mvp.settings.language.label')}>
            <MvpSegmented
              label={t('mvp.settings.language.label')}
              value={language}
              options={[
                { value: '', label: t('mvp.settings.language.system') },
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(value) => onPreference({ language: value })}
            />
          </Row>
        </Section>

        <Section title={t('mvp.settings.about')}>
          <Row label={t('mvp.settings.version')}>
            <Typography
              color="text.secondary"
              sx={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}
            >
              {version ?? ''}
            </Typography>
          </Row>
          <Box
            component="button"
            type="button"
            disabled={repairing}
            onClick={() => setRepairOpen(true)}
            sx={{
              ...rowSx,
              cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' },
              '&:disabled': { cursor: 'default' },
            }}
          >
            <RowLabel
              label={t('mvp.settings.repair.label')}
              hint={t('mvp.settings.repair.hint')}
            />
            <MvpProgressRing
              busy={repairing}
              size={17}
              segments={repairSteps.segments}
            >
              <Box
                component={IconChevronRight}
                size={22}
                sx={{ color: 'text.secondary' }}
              />
            </MvpProgressRing>
          </Box>
        </Section>
      </Box>

      <BaseDialog
        open={repairOpen}
        icon={<IconTool size={22} />}
        title={t('mvp.settings.repair.label')}
        okBtn={t('mvp.settings.repair.confirm')}
        cancelBtn={t('mvp.common.cancel')}
        loading={repairing}
        loadingIndicator={
          <MvpProgressRing
            size={18}
            color="inherit"
            segments={repairSteps.segments}
          />
        }
        onClose={() => !repairing && setRepairOpen(false)}
        onCancel={() => !repairing && setRepairOpen(false)}
        onOk={onRepair}
        contentSx={{ width: { xs: 280, sm: 300 } }}
      >
        <Typography variant="body2">{t('mvp.settings.repair.body')}</Typography>
      </BaseDialog>
    </MvpPage>
  )
}

export default MvpSettingsPage
