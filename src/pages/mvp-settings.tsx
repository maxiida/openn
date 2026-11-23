import {
  alpha,
  Box,
  Button,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import { getVersion } from '@tauri-apps/api/app'
import { useLockFn } from 'ahooks'
import { ChevronLeftIcon, CircleHelpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

import { BaseDialog, Switch } from '@/components/base'
import { MvpPage } from '@/components/mvp/mvp-page'
import { MvpProgressRing } from '@/components/mvp/mvp-progress-ring'
import { MvpSegmented } from '@/components/mvp/mvp-segmented'
import { MvpShortcutHint } from '@/components/mvp/mvp-shortcut-hint'
import { useMvpShortcuts } from '@/hooks/use-mvp-shortcuts'
import { useMvpSteps } from '@/hooks/use-mvp-steps'
import { useVerge } from '@/hooks/use-verge'
import { useAppRefreshers } from '@/providers/app-data-context'
import { exitApp, exportLogs, uninstallService } from '@/services/cmds'
import { resolveLanguage } from '@/services/i18n'
import { MvpConnectionError, repairMvp } from '@/services/mvp-connection'
import { showNotice } from '@/services/notice-service'
import { revalidateQueries, useQuery } from '@/services/query-client'
import getSystem from '@/utils/get-system'

type ThemeMode = NonNullable<IVergeConfig['theme_mode']>

const SUPPORTS_GLASS = getSystem() === 'macos'

const Section = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <Box>
    <Typography color="textSecondary" sx={{ fontSize: 13, mb: 1 }}>
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
      <Typography color="textSecondary" sx={{ fontSize: 12.5, mt: 0.25 }}>
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
  const { refreshAll } = useAppRefreshers()
  const { data: version } = useQuery({
    queryKey: ['getAppVersion'],
    queryFn: getVersion,
  })
  const [repairOpen, setRepairOpen] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [helpAnchor, setHelpAnchor] = useState<HTMLElement | null>(null)
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const menuAction = searchParams.get('help')
  // The location key tells a repeated menu click apart from a re-render of the same visit.
  const menuActionKey = menuAction ? `${location.key}:${menuAction}` : null
  const [handledMenuActionKey, setHandledMenuActionKey] = useState<
    string | null
  >(null)
  // The repair's own steps, then refreshing what the app shows.
  const repairSteps = useMvpSteps(1)
  useMvpShortcuts([
    { key: 'Escape', allowInControl: true, onPress: () => navigate('/') },
  ])

  // The app menu's Help items land here as ?help=repair or ?help=uninstall.
  if (menuActionKey !== handledMenuActionKey) {
    setHandledMenuActionKey(menuActionKey)
    if (menuAction === 'repair') setRepairOpen(true)
    if (menuAction === 'uninstall') setUninstallOpen(true)
  }

  const themeMode: ThemeMode =
    verge?.theme_mode === 'light' || verge?.theme_mode === 'dark'
      ? verge.theme_mode
      : 'system'
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

  const onExportLogs = useLockFn(async () => {
    setExporting(true)
    try {
      await exportLogs()
      showNotice.success(t('mvp.settings.exportLogs.done'))
    } catch (error) {
      console.error('[Proxy MVP] Log export failed:', error)
      showNotice.error(t('mvp.settings.exportLogs.failed'))
    } finally {
      setExporting(false)
    }
  })

  const onUninstall = useLockFn(async () => {
    setUninstalling(true)
    try {
      await uninstallService()
      // Quitting also restores the system proxy and DNS settings.
      await exitApp()
    } catch (error) {
      console.error('[Proxy MVP] Service uninstall failed:', error)
      showNotice.error(t('mvp.settings.uninstall.failed'))
      setUninstalling(false)
    }
  })

  return (
    <MvpPage
      title={t('mvp.settings.title')}
      footer={
        <Box sx={{ display: 'grid', justifyItems: 'center', gap: 0.5 }}>
          <Button
            size="small"
            color="inherit"
            startIcon={<CircleHelpIcon size={15} />}
            aria-haspopup="menu"
            aria-expanded={Boolean(helpAnchor)}
            onClick={(event) => setHelpAnchor(event.currentTarget)}
            sx={{
              color: 'text.secondary',
              fontSize: 13,
              '&:hover': { color: 'text.primary' },
            }}
          >
            {t('mvp.settings.help')}
          </Button>
          <Typography
            color="textDisabled"
            sx={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
          >
            {version ? `Openn ${version}` : ''}
          </Typography>
          <Menu
            anchorEl={helpAnchor}
            open={Boolean(helpAnchor)}
            onClose={() => setHelpAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            slotProps={{ paper: { sx: { mt: -1 } } }}
          >
            <MenuItem
              onClick={() => {
                setHelpAnchor(null)
                navigate('/welcome')
              }}
            >
              {t('mvp.settings.onboarding')}
            </MenuItem>
            <MenuItem
              disabled={repairing}
              onClick={() => {
                setHelpAnchor(null)
                setRepairOpen(true)
              }}
            >
              {t('mvp.settings.repair.label')}
            </MenuItem>
            <MenuItem
              disabled={exporting}
              onClick={() => {
                setHelpAnchor(null)
                onExportLogs()
              }}
            >
              {t('mvp.settings.exportLogs.label')}
            </MenuItem>
            <Divider />
            <MenuItem
              disabled={uninstalling}
              onClick={() => {
                setHelpAnchor(null)
                setUninstallOpen(true)
              }}
              sx={{
                color: 'error.main',
                '&:hover, &.Mui-focusVisible': {
                  bgcolor: (theme) => alpha(theme.palette.error.main, 0.1),
                },
              }}
            >
              {t('mvp.settings.uninstall.label')}
            </MenuItem>
          </Menu>
        </Box>
      }
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
            <ChevronLeftIcon size={18} />
          </IconButton>
        </Tooltip>
      }
    >
      <Box sx={{ display: 'grid', gap: 5, pt: 1 }}>
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
          <Row
            label={t('mvp.settings.aiCheck.label')}
            hint={t('mvp.settings.aiCheck.hint')}
          >
            <Switch
              checked={verge?.enable_ai_check !== false}
              disabled={!verge}
              onChange={(_, checked) =>
                onPreference({ enable_ai_check: checked })
              }
              slotProps={{
                input: { 'aria-label': t('mvp.settings.aiCheck.label') },
              }}
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

        <Section title={t('mvp.settings.appearance.label')}>
          <Row label={t('mvp.settings.appearance.theme')}>
            <MvpSegmented<ThemeMode>
              label={t('mvp.settings.appearance.theme')}
              value={themeMode}
              options={[
                { value: 'system', label: t('mvp.settings.appearance.system') },
                { value: 'light', label: t('mvp.settings.appearance.light') },
                { value: 'dark', label: t('mvp.settings.appearance.dark') },
              ]}
              onChange={(value) => onPreference({ theme_mode: value })}
            />
          </Row>
          {SUPPORTS_GLASS && (
            <Row
              label={t('mvp.settings.glass.label')}
              hint={t('mvp.settings.glass.hint')}
            >
              <Switch
                checked={verge?.enable_glass === true}
                disabled={!verge}
                onChange={(_, checked) =>
                  onPreference({ enable_glass: checked })
                }
                slotProps={{
                  input: { 'aria-label': t('mvp.settings.glass.label') },
                }}
              />
            </Row>
          )}
        </Section>
      </Box>

      <BaseDialog
        open={uninstallOpen}
        title={t('mvp.settings.uninstall.label')}
        okBtn={t('mvp.settings.uninstall.confirm')}
        cancelBtn={t('mvp.common.cancel')}
        loading={uninstalling}
        onClose={() => !uninstalling && setUninstallOpen(false)}
        onCancel={() => !uninstalling && setUninstallOpen(false)}
        onOk={onUninstall}
        contentSx={{ width: { xs: 280, sm: 300 } }}
      >
        <Typography variant="body2">
          {t('mvp.settings.uninstall.body')}
        </Typography>
      </BaseDialog>

      <BaseDialog
        open={repairOpen}
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
