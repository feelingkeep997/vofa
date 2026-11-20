/**
 * 时序曲线 —— 姿态/角速率/电机三组通道
 *
 * 跟 WaveChart 的区别：那边吃的是串口 DataStore（任意通道数），
 * 这边吃的是仿真采样（固定字段 + 目标值对照），所以单独写一个更省事。
 */

import { useEffect, useRef } from 'react'
import type { SimSample } from '../lib/sim/engine'
import type { ThemeTokens } from '../lib/theme'

export type TraceMode = 'attitude' | 'estimate' | 'rate' | 'motor'

interface Props {
  samples: SimSample[]
  mode: TraceMode
  theme: ThemeTokens
  /** 显示最近多少秒；<=0 表示全量 */
  windowSec: number
}

interface Channel {
  key: keyof SimSample
  label: string
  color: string
  dash?: boolean
  /** 虚线跟哪条实线配对，用同一颜色 */
  pairOf?: number
}

export function channelsFor(mode: TraceMode, theme: ThemeTokens): Channel[] {
  const c = theme.lColors
  if (mode === 'attitude') {
    return [
      { key: 'roll', label: 'roll', color: c[0] },
      { key: 'rollT', label: 'roll 目标', color: c[0], dash: true, pairOf: 0 },
      { key: 'pitch', label: 'pitch', color: c[1] },
      { key: 'pitchT', label: 'pitch 目标', color: c[1], dash: true, pairOf: 2 },
      { key: 'yaw', label: 'yaw', color: c[2] },
      { key: 'yawT', label: 'yaw 目标', color: c[2], dash: true, pairOf: 4 },
    ]
  }
  if (mode === 'estimate') {
    return [
      { key: 'roll', label: 'roll 真值', color: c[0] },
      { key: 'rollEst', label: 'roll 估计', color: c[0], dash: true, pairOf: 0 },
      { key: 'pitch', label: 'pitch 真值', color: c[1] },
      { key: 'pitchEst', label: 'pitch 估计', color: c[1], dash: true, pairOf: 2 },
      { key: 'yaw', label: 'yaw 真值', color: c[2] },
      { key: 'yawEst', label: 'yaw 估计', color: c[2], dash: true, pairOf: 4 },
    ]
  }
  if (mode === 'rate') {
    return [
      { key: 'rx', label: 'roll rate', color: c[0] },
      { key: 'rxT', label: 'rate 目标', color: c[0], dash: true, pairOf: 0 },
      { key: 'ry', label: 'pitch rate', color: c[1] },
      { key: 'ryT', label: '目标', color: c[1], dash: true, pairOf: 2 },
      { key: 'rz', label: 'yaw rate', color: c[2] },
      { key: 'rzT', label: '目标', color: c[2], dash: true, pairOf: 4 },
    ]
  }
  return [
    { key: 'm0', label: 'RL', color: c[0] },
    { key: 'm1', label: 'RR', color: c[1] },
    { key: 'm2', label: 'FR', color: c[2] },
    { key: 'm3', label: 'FL', color: c[3] },
  ]
}

export const UNIT_OF: Record<TraceMode, string> = {
  attitude: '°',
  estimate: '°',
  rate: '°/s',
  motor: '',
}

export default function TraceChart({ samples, mode, theme, windowSec }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = cv.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr
      cv.height = h * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const light = theme.light
    const padL = 46
    const padR = 10
    const padT = 14
    const padB = 20
    const iw = w - padL - padR
    const ih = h - padT - padB

    if (samples.length < 2) {
      ctx.fillStyle = theme.fontColorTips
      ctx.font = '12px "Inter", system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('没有采样，点「开始」或跑一次阶跃测试', w / 2, h / 2)
      return
    }

    const tEnd = samples[samples.length - 1].t
    const tStart = windowSec > 0 ? Math.max(samples[0].t, tEnd - windowSec) : samples[0].t
    const span = Math.max(1e-6, tEnd - tStart)

    // 可见区间
    let lo = 0
    let hi = samples.length - 1
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].t >= tStart) {
        lo = Math.max(0, i - 1)
        break
      }
    }

    const chans = channelsFor(mode, theme)

    // ---- Y 范围 ----
    let yMin = Infinity
    let yMax = -Infinity
    for (let i = lo; i <= hi; i++) {
      const s = samples[i]
      for (const ch of chans) {
        const v = s[ch.key] as number
        if (!Number.isFinite(v)) continue
        if (v < yMin) yMin = v
        if (v > yMax) yMax = v
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = -1
      yMax = 1
    }
    if (yMax - yMin < 1e-6) {
      yMin -= 1
      yMax += 1
    }
    const pad = (yMax - yMin) * 0.12
    yMin -= pad
    yMax += pad

    const xOf = (t: number) => padL + ((t - tStart) / span) * iw
    const yOf = (v: number) => padT + ih - ((v - yMin) / (yMax - yMin)) * ih

    // ---- 网格 ----
    const gridCol = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
    const axisCol = light ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)'
    ctx.strokeStyle = gridCol
    ctx.lineWidth = 1
    ctx.font = '10px "JetBrains Mono", Consolas, monospace'
    ctx.fillStyle = theme.fontColorTips
    ctx.textAlign = 'right'

    const yTicks = 5
    for (let i = 0; i <= yTicks; i++) {
      const v = yMin + ((yMax - yMin) * i) / yTicks
      const y = yOf(v)
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(w - padR, y)
      ctx.stroke()
      ctx.fillText(formatNum(v), padL - 6, y + 3.5)
    }

    ctx.textAlign = 'center'
    const xTicks = Math.max(2, Math.min(8, Math.floor(iw / 90)))
    for (let i = 0; i <= xTicks; i++) {
      const t = tStart + (span * i) / xTicks
      const x = xOf(t)
      ctx.strokeStyle = gridCol
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, padT + ih)
      ctx.stroke()
      ctx.fillStyle = theme.fontColorTips
      ctx.fillText(`${t.toFixed(t - tStart < 10 ? 1 : 0)}s`, x, h - 6)
    }

    // 边框
    ctx.strokeStyle = axisCol
    ctx.beginPath()
    ctx.moveTo(padL, padT)
    ctx.lineTo(padL, padT + ih)
    ctx.lineTo(w - padR, padT + ih)
    ctx.stroke()

    // ---- 曲线 ----
    // 点数太多时按像素列抽稀，避免一帧画上万次
    const step = Math.max(1, Math.floor((hi - lo) / Math.max(1, iw * 2)))
    for (const ch of chans) {
      ctx.beginPath()
      ctx.strokeStyle = ch.color
      ctx.lineWidth = ch.dash ? 1 : 1.8
      ctx.setLineDash(ch.dash ? [4, 3] : [])
      ctx.globalAlpha = ch.dash ? 0.75 : 1
      let started = false
      for (let i = lo; i <= hi; i += step) {
        const s = samples[i]
        const v = s[ch.key] as number
        if (!Number.isFinite(v)) continue
        const x = xOf(s.t)
        const y = yOf(v)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1

    // ---- 图例 + 当前值 ----
    const last = samples[samples.length - 1]
    ctx.font = '10px "JetBrains Mono", Consolas, monospace'
    ctx.textAlign = 'left'
    let lx = padL + 4
    const ly = padT + 10
    for (const ch of chans) {
      if (ch.dash) continue
      const v = last[ch.key] as number
      const txt = `${ch.label} ${Number.isFinite(v) ? v.toFixed(1) : '—'}`
      ctx.fillStyle = ch.color
      ctx.fillRect(lx, ly - 6, 7, 2.5)
      ctx.fillStyle = theme.fontColorTips
      ctx.fillText(txt, lx + 11, ly - 1)
      lx += ctx.measureText(txt).width + 26
    }

    // 单位
    ctx.textAlign = 'right'
    ctx.fillStyle = theme.fontColorTips
    ctx.fillText(UNIT_OF[mode], w - padR - 2, padT + 2)
  }, [samples, mode, theme, windowSec])

  return <canvas ref={ref} className="trace-canvas" />
}

function formatNum(v: number): string {
  const a = Math.abs(v)
  if (a >= 1000) return v.toFixed(0)
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  if (a >= 1) return v.toFixed(2)
  return v.toFixed(3)
}
