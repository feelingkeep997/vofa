/**
 * 主题令牌 —— 全部取自 VOFA+ 真实 theme.json
 * 来源：%LOCALAPPDATA%\vofa+\100\themes\<主题名>\theme.json
 * 令牌名（goodColor / barColor / lineColorMain / textAnsiRx ...）与官方一致，
 * 方便以后直接读厂商主题包。
 */

export interface ThemeTokens {
  id: string
  name: string
  goodColor: string
  badColor: string
  iconColor1: string
  iconColor2: string
  iconColor3: string
  objColor: string
  mainColor: string
  barColor: string
  lightColor: string
  lineColor: string
  lineColorMain: string
  fontColor: string
  fontColorTips: string
  fontColorBar: string
  cbColor1: string
  cbColor2: string
  cbColor3: string
  cbColor4: string
  textAnsiTime: string
  textAnsiRx: string
  textAnsiTx: string
  textAnsiErr: string
  lColors: string[]
  bgColor: string
  bgOpacity: number
  bgRatio: number
  /** 亮色主题（EyeCare）需要反向的网格/填充 */
  light: boolean
}

export const THEMES: ThemeTokens[] = [
  {
    id: 'Dark',
    name: 'Dark',
    goodColor: '#23ffd3',
    badColor: '#ff0000',
    iconColor1: '#ff0000',
    iconColor2: '#1abc9c',
    iconColor3: '#00ffff',
    objColor: '#00ffff',
    mainColor: '#00ffff',
    barColor: '#3f3f41',
    lightColor: '#00b0b0',
    lineColor: '#d0d0d0',
    lineColorMain: '#303030',
    fontColor: '#ffffff',
    fontColorTips: '#767676',
    fontColorBar: '#ffffff',
    cbColor1: '#ffffff',
    cbColor2: '#ff0000',
    cbColor3: '#23ffd3',
    cbColor4: '#d400d4',
    textAnsiTime: '38;2;0;125;255',
    textAnsiRx: '38;2;85;255;90',
    textAnsiTx: '38;2;0;255;255',
    textAnsiErr: '38;2;255;255;0',
    lColors: ['#55ff7f', '#ffffff', '#00ffff', '#ff6b6b', '#ffd500'],
    bgColor: '#000000',
    bgOpacity: 0.15,
    bgRatio: 0.5,
    light: false,
  },
  {
    id: 'EyeCare',
    name: 'EyeCare 护眼',
    goodColor: '#17ab8e',
    badColor: '#ff0000',
    iconColor1: '#ff0000',
    iconColor2: '#17ab8e',
    iconColor3: '#0098d4',
    objColor: '#00bfbf',
    mainColor: '#000000',
    barColor: '#4c4c4c',
    lightColor: '#00b0b0',
    lineColor: '#969696',
    lineColorMain: '#bfb3a6',
    fontColor: '#000000',
    fontColorTips: '#767676',
    fontColorBar: '#ffffff',
    cbColor1: '#7e7e7e',
    cbColor2: '#aa0000',
    cbColor3: '#17ab8e',
    cbColor4: '#990099',
    textAnsiTime: '38;2;0;25;255',
    textAnsiRx: '38;2;0;60;120',
    textAnsiTx: '38;2;33;82;11',
    textAnsiErr: '38;2;255;5;0',
    lColors: ['#000000', '#00a2a2', '#8c7500', '#ff6b6b', '#2d8700'],
    bgColor: '#f0e7dd',
    bgOpacity: 0.1,
    bgRatio: 0.5,
    light: true,
  },
  {
    id: 'BlueIronman',
    name: 'BlueIronman',
    goodColor: '#23ffd3',
    badColor: '#ff0000',
    iconColor1: '#ff0000',
    iconColor2: '#1abc9c',
    iconColor3: '#00ffff',
    objColor: '#00ffff',
    mainColor: '#ffffff',
    barColor: '#001c56',
    lightColor: '#00b5b5',
    lineColor: '#d0d0d0',
    lineColorMain: '#001c56',
    fontColor: '#99ffff',
    fontColorTips: '#767676',
    fontColorBar: '#ffffff',
    cbColor1: '#ffffff',
    cbColor2: '#ff0000',
    cbColor3: '#23ffd3',
    cbColor4: '#d400d4',
    textAnsiTime: '38;2;255;255;125',
    textAnsiRx: '38;2;255;255;255',
    textAnsiTx: '38;2;125;255;0',
    textAnsiErr: '38;2;255;0;0',
    lColors: ['#fdff7c', '#00ffff', '#ffffff', '#55ff7f', '#ff557f'],
    bgColor: '#00003e',
    bgOpacity: 1,
    bgRatio: 0.9,
    light: false,
  },
  {
    id: 'Helmet',
    name: 'Helmet',
    goodColor: '#23ffd3',
    badColor: '#ff0000',
    iconColor1: '#ff0000',
    iconColor2: '#1abc9c',
    iconColor3: '#00ffff',
    objColor: '#00bfbf',
    mainColor: '#ffffff',
    barColor: '#3f3f41',
    lightColor: '#00b5b5',
    lineColor: '#cbcbcb',
    lineColorMain: '#303030',
    fontColor: '#ffffff',
    fontColorTips: '#767676',
    fontColorBar: '#ffffff',
    cbColor1: '#ffffff',
    cbColor2: '#ff0000',
    cbColor3: '#23ffd3',
    cbColor4: '#d400d4',
    textAnsiTime: '38;2;0;125;255',
    textAnsiRx: '38;2;85;255;255',
    textAnsiTx: '38;2;0;239;0',
    textAnsiErr: '38;2;255;85;127',
    lColors: ['#fdff7c', '#00ffff', '#ffffff', '#55ff7f', '#ff557f'],
    bgColor: '#000000',
    bgOpacity: 0.76,
    bgRatio: 0.6,
    light: false,
  },
]

/** defaultAppTheme.lColors —— 官方默认通道配色 */
export const DEFAULT_CHANNEL_COLORS = [
  '#ff007f',
  '#008000',
  '#0000ff',
  '#ffa500',
  '#800080',
  '#ffc0cb',
  '#ffff00',
]

export function channelColor(theme: ThemeTokens, index: number): string {
  const palette = theme.lColors.concat(DEFAULT_CHANNEL_COLORS)
  return palette[index % palette.length]
}

function luminance(hex: string): number {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function applyThemeVars(theme: ThemeTokens): Record<string, string> {
  return {
    '--good': theme.goodColor,
    '--bad': theme.badColor,
    '--accent': theme.mainColor,
    '--on-accent': luminance(theme.mainColor) > 0.55 ? '#001014' : '#ffffff',
    '--accent-bar': theme.light ? '#ffffff' : theme.mainColor,
    '--bar': theme.barColor,
    '--obj': theme.objColor,
    '--light': theme.lightColor,
    '--line': theme.lineColor,
    '--line-main': theme.lineColorMain,
    '--fg': theme.fontColor,
    '--fg-tips': theme.fontColorTips,
    '--fg-bar': theme.fontColorBar,
    '--cb1': theme.cbColor1,
    '--cb2': theme.cbColor2,
    '--cb3': theme.cbColor3,
    '--cb4': theme.cbColor4,
    '--canvas-bg': theme.bgColor,
    '--panel-bg': theme.light ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.28)',
    '--hover-bg': theme.light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)',
    '--active-bg': theme.light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.12)',
    '--input-bg': theme.light ? '#fffdf8' : '#141414',
  }
}

/** ANSI SGR 片段（"38;2;r;g;b"）→ css color */
export function sgrToCss(sgr: string): string {
  const parts = sgr.split(';').map((n) => Number(n))
  if (parts.length >= 5 && parts[0] === 38 && parts[1] === 2) {
    return `rgb(${parts[2]},${parts[3]},${parts[4]})`
  }
  return 'inherit'
}
