import getSystem from '@/utils/get-system'
const OS = getSystem()

// default theme setting
export const defaultTheme = {
  primary_color: '#007AFF',
  secondary_color: '#FC9B76',
  primary_text: '#000000',
  secondary_text: '#3C3C4399',
  info_color: '#007AFF',
  error_color: '#DC2626',
  warning_color: '#D97706',
  success_color: '#16A34A',
  background_color: '#F5F5F5',
  font_family: `-apple-system, BlinkMacSystemFont,"Microsoft YaHei UI", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji"${
    OS === 'windows' ? ', twemoji mozilla' : ''
  }`,
}

// dark mode
export const defaultDarkTheme = {
  ...defaultTheme,
  primary_color: '#0A84FF',
  secondary_color: '#FF9F0A',
  primary_text: '#FFFFFF',
  background_color: '#2E303D',
  secondary_text: '#EBEBF599',
  info_color: '#0A84FF',
  error_color: '#F87171',
  warning_color: '#FBBF24',
  success_color: '#4ADE80',
}
