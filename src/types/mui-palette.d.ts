import '@mui/material/styles'

declare module '@mui/material/styles' {
  interface Palette {
    lime: Palette['primary']
    yellow: Palette['primary']
  }
  interface PaletteOptions {
    lime?: PaletteOptions['primary']
    yellow?: PaletteOptions['primary']
  }
}
