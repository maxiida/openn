import {
  Box,
  Button,
  Tooltip,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AI_PURITY_BANDS,
  aiPurityColor,
  aiVerdictColor,
  type AiCheckResult,
} from '@/services/ai-check'

// i18n codes that are not BCP 47 tags, which Intl.DisplayNames needs.
const DISPLAY_LOCALES: Record<string, string> = { zhtw: 'zh-TW', jp: 'ja' }

const regionName = (code: string, language: string) => {
  try {
    return (
      new Intl.DisplayNames([DISPLAY_LOCALES[language] ?? language, 'en'], {
        type: 'region',
      }).of(code) ?? code
    )
  } catch {
    return code
  }
}

/** Text in a status colour, readable on both themes like the pills' own text. */
const ink = (color: string) => (theme: Theme) => {
  const [tone, shade] = color.split('.')
  const palette = theme.palette[tone as 'success']
  if (!palette || shade !== 'main') return { color }
  return {
    color: theme.palette.mode === 'dark' ? palette.light : palette.dark,
  }
}

const Hint = ({
  title,
  children,
  sx,
}: {
  title: string
  children: ReactNode
  sx?: SxProps<Theme>
}) => (
  <Tooltip title={title} describeChild>
    <Box
      component="span"
      tabIndex={0}
      sx={[{ cursor: 'help' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Box>
  </Tooltip>
)

const Fact = ({
  label,
  tip,
  children,
  aside,
}: {
  label: string
  tip: string
  children: ReactNode
  aside?: ReactNode
}) => (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1.5,
      py: 1.125,
      fontSize: 14,
      '& + &': { borderTop: '0.5px solid', borderColor: 'divider' },
    }}
  >
    <Hint
      title={tip}
      sx={{ width: 56, flexShrink: 0, color: 'text.secondary', fontSize: 13 }}
    >
      {label}
    </Hint>
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
      }}
    >
      {children}
    </Box>
    {aside}
  </Box>
)

const PurityMeter = ({ score }: { score: number }) => (
  <Box
    role="img"
    aria-label={String(score)}
    sx={{ flex: 1, minWidth: 0, position: 'relative', height: 6 }}
  >
    <Box
      sx={{
        display: 'flex',
        height: '100%',
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      {AI_PURITY_BANDS.map((band, index) => {
        const width = band.max - (AI_PURITY_BANDS[index - 1]?.max ?? 0)
        return (
          <Box
            key={band.max}
            sx={{ width: `${width}%`, height: '100%', bgcolor: band.color }}
          />
        )
      })}
    </Box>
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        left: `${score}%`,
        width: 12,
        height: 12,
        borderRadius: '50%',
        bgcolor: aiPurityColor(score),
        transform: 'translate(-50%, -50%)',
        boxShadow: (theme) => `0 0 0 2.5px ${theme.palette.background.paper}`,
      }}
    />
  </Box>
)

/** What the AI pill opens: whether Claude and ChatGPT will work through this node, and why. */
export const MvpAiPanel = ({
  result,
  onChangeNode,
}: {
  result: AiCheckResult | null
  onChangeNode: () => void
}) => {
  const { t, i18n } = useTranslation()

  if (!result) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: 'text.secondary',
          fontSize: 14,
        }}
      >
        {t('mvp.home.checking')}
      </Box>
    )
  }

  const { verdict, region, city, score, residential } = result
  const color = aiVerdictColor(verdict)
  // IPPure names cities only in English, which would mix languages anywhere else.
  const place = region
    ? [regionName(region, i18n.language), i18n.language === 'en' && city]
        .filter(Boolean)
        .join(' · ')
    : null
  const supported = verdict !== 'unsupported'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box
        sx={[
          {
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            fontSize: 16,
            fontWeight: 600,
          },
          ink(color),
        ]}
      >
        <Box
          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }}
        />
        {t(`mvp.home.ai.verdict.${verdict}`)}
      </Box>
      <Typography sx={{ fontSize: 14, lineHeight: 1.6 }}>
        {verdict !== 'good' && verdict !== 'unknown' && (
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {t('mvp.home.ai.calm')}
          </Box>
        )}
        {t(`mvp.home.ai.message.${verdict}`, {
          region: region ? regionName(region, i18n.language) : '',
        })}
      </Typography>
      <Box>
        {place && (
          <Fact
            label={t('mvp.home.ai.facts.region')}
            tip={t('mvp.home.ai.tips.region')}
            aside={
              <Hint
                title={t(
                  supported
                    ? 'mvp.home.ai.tips.supported'
                    : 'mvp.home.ai.tips.unsupported',
                )}
                sx={[
                  { flexShrink: 0, fontSize: 13 },
                  ink(supported ? 'success.main' : 'error.main'),
                ]}
              >
                {t(
                  supported
                    ? 'mvp.home.ai.region.supported'
                    : 'mvp.home.ai.region.unsupported',
                )}
              </Hint>
            }
          >
            {place}
          </Fact>
        )}
        {residential !== null && (
          <Fact
            label={t('mvp.home.ai.facts.network')}
            tip={t('mvp.home.ai.tips.network')}
            aside={
              <Box
                sx={[
                  { flexShrink: 0, fontSize: 13 },
                  ink(residential ? 'success.main' : 'warning.main'),
                ]}
              >
                {t(
                  residential
                    ? 'mvp.home.ai.network.good'
                    : 'mvp.home.ai.network.fair',
                )}
              </Box>
            }
          >
            <Hint
              title={t(
                residential
                  ? 'mvp.home.ai.tips.residential'
                  : 'mvp.home.ai.tips.datacenter',
              )}
            >
              {t(
                residential
                  ? 'mvp.home.ai.network.residential'
                  : 'mvp.home.ai.network.datacenter',
              )}
            </Hint>
            {!residential && (
              <Box
                component="span"
                sx={{ color: 'text.secondary', fontSize: 12 }}
              >
                {t('mvp.home.ai.network.datacenterNote')}
              </Box>
            )}
          </Fact>
        )}
        {score !== null && (
          <Fact
            label={t('mvp.home.ai.facts.purity')}
            tip={t('mvp.home.ai.tips.purity')}
            aside={
              <Hint
                title={t('mvp.home.ai.tips.score')}
                sx={[
                  {
                    width: 26,
                    flexShrink: 0,
                    textAlign: 'right',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  },
                  ink(aiPurityColor(score)),
                ]}
              >
                {score}
              </Hint>
            }
          >
            <Hint
              title={t('mvp.home.ai.tips.score')}
              sx={{ flex: 1, minWidth: 0, display: 'flex', py: 1 }}
            >
              <PurityMeter score={score} />
            </Hint>
          </Fact>
        )}
      </Box>
      {score !== null && (
        <Typography color="textDisabled" sx={{ mt: -0.5, fontSize: 12 }}>
          {t('mvp.home.ai.source')}
        </Typography>
      )}
      {verdict !== 'good' && verdict !== 'unknown' && (
        <Button
          variant="contained"
          onClick={onChangeNode}
          sx={{
            alignSelf: 'flex-start',
            boxShadow: 'none',
            bgcolor: 'text.primary',
            color: (theme) =>
              theme.palette.getContrastText(theme.palette.text.primary),
            '&:hover': { bgcolor: 'text.secondary' },
          }}
        >
          {t('mvp.home.actions.changeNode')}
        </Button>
      )}
    </Box>
  )
}
