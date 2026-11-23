import getSystem from '@/utils/get-system'
const OS = getSystem()

// default theme setting
export const defaultTheme = {
  primary_color: '#141413',
  secondary_color: '#C96442',
  primary_text: '#141413',
  secondary_text: '#73726C',
  info_color: '#73726C',
  error_color: '#B83B32',
  warning_color: '#B5650D',
  success_color: '#2F7D4F',
  background_color: '#FAF9F5',
  font_family: `-apple-system, BlinkMacSystemFont,"Microsoft YaHei UI", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji"${
    OS === 'windows' ? ', twemoji mozilla' : ''
  }`,
}

// dark mode
export const defaultDarkTheme = {
  ...defaultTheme,
  primary_color: '#ECEAE4',
  secondary_color: '#D97757',
  primary_text: '#ECEAE4',
  background_color: '#1F1E1D',
  secondary_text: '#9C9A92',
  info_color: '#9C9A92',
  error_color: '#E5705F',
  warning_color: '#E0A256',
  success_color: '#6DBE8A',
}
