import { useEffect, useRef } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import type { DataStore } from '../lib/store'
import type { ThemeTokens } from '../lib/theme'

export type ChartType = 'wave' | 'bar' | 'freq' | 'histog'

export interface ChannelMeta {
  name: string
  color: string
  visible: boolean
}

export interface ChartConfig {
  type: ChartType
  lineWidth: number
  windowMs: number
  autoScroll: boolean
  yAuto: boolean
  yMin: number
  yMax: number
  fontScale: number
  simplify: boolean
  fps: number
}

interface Props {
  store: DataStore
  channels: ChannelMeta[]
  cfg: ChartConfig
  theme: ThemeTokens
  paused: boolean
}

interface Spectrum {
  color: string
  points: { x: number; y: number }[]
  xMax: number
  yMax: number
}

const PAD = { left: 64, right: 18, top: 14, bottom: 28 }
const GRID_X = 10
const GRID_Y = 6

export default function WaveChart({ store, channels, cfg, theme, paused }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef({ t0: 0, t1: 1000, auto: true })
  const cfgRef = useRef(cfg)
  const themeRef = useRef(theme)
  const chRef = useRef(channels)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ x: number; t0: number; t1: number; moved: boolean } | null>(null)
  /** DFT 太贵，300ms 才重算一次，别把帧率吃干净 */
  const freqRef = useRef<{ at: number; spectra: Spectrum[] }>({ at: 0, spectra: [] })

  cfgRef.current = cfg
  themeRef.current = theme
  chRef.current = channels

  /* ---------------- 绘制 ---------------- */
  useEffect(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let lastDraw = 0
    let w = 0
    let h = 0
    let dpr = 1

    const resize = () => {
      const rect = box.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(240, rect.width)
      h = Math.max(160, rect.height)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(box)

    const draw = () => {
      const c = cfgRef.current
      const th = themeRef.current
      const chs = chRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = th.bgColor
      ctx.fillRect(0, 0, w, h)

      const plot = {
        x: PAD.left,
        y: PAD.top,
        w: Math.max(10, w - PAD.left - PAD.right),
        h: Math.max(10, h - PAD.top - PAD.bottom),
      }

      const v = viewRef.current
      const last = store.lastT
      const timeMode = c.type === 'wave' || c.type === 'bar'
      if (v.auto && timeMode) {
        v.t1 = Math.max(last, c.windowMs)
        v.t0 = v.t1 - c.windowMs
      }
      if (v.t1 - v.t0 < 1) v.t1 = v.t0 + 1

      const seriesCount = store.series.length
      const visible: number[] = []
      for (let i = 0; i < seriesCount; i++) if (chs[i]?.visible !== false) visible.push(i)

      const fs = Math.round(11 * c.fontScale)
      ctx.font = `${fs}px "JetBrains Mono", Consolas, monospace`

      /* ---- 时域：先算 Y 范围 ---- */
      let yLo = c.yMin
      let yHi = c.yMax
      // 直方图的分箱必须落在真实数据范围上，否则全挤到两端
      if (c.type === 'histog' || (timeMode && c.yAuto)) {
        let lo = Infinity
        let hi = -Infinity
        for (const i of visible) {
          const st = store.stats(store.series[i], v.t0, v.t1)
          if (!st) continue
          if (st.min < lo) lo = st.min
          if (st.max > hi) hi = st.max
        }
        if (!Number.isFinite(lo)) {
          lo = -1
          hi = 1
        }
        const pad = (hi - lo) * 0.08 || 0.5
        yLo = lo - pad
        yHi = hi + pad
      }
      if (yHi - yLo < 1e-9) yHi = yLo + 1

      /* ---- 频谱 / 直方：先算数据，再定坐标域 ---- */
      const spectra: Spectrum[] = []
      const nowMs = performance.now()
      if (c.type === 'freq' && nowMs - freqRef.current.at < 300) {
        spectra.push(...freqRef.current.spectra)
      } else if (c.type === 'freq') {
        for (const i of visible.slice(0, 4)) {
          const s = store.series[i]
          if (!s) continue
          const from = store.lowerBound(s, v.t0)
          const raw: number[] = []
          for (let k = from; k < s.count && raw.length < 512; k++) {
            const p = store.phys(s, k)
            if (s.t[p] > v.t1) break
            raw.push(s.v[p])
          }
          if (raw.length < 16) continue
          const mean = raw.reduce((a, b) => a + b, 0) / raw.length
          const N = raw.length
          const half = Math.floor(N / 2)
          const mags = new Array<number>(half).fill(0)
          let peak = 1e-12
          let peakBin = 1
          for (let f = 0; f < half; f++) {
            let re = 0
            let im = 0
            for (let k = 0; k < N; k++) {
              const a = (-2 * Math.PI * f * k) / N
              const x = raw[k] - mean
              re += x * Math.cos(a)
              im += x * Math.sin(a)
            }
            const m = Math.hypot(re, im) / N
            mags[f] = m
            if (m > peak) {
              peak = m
              peakBin = f
            }
          }
          const firstP = store.phys(s, from)
          // 必须用第 N 个实际参与 DFT 的采样算采样率；用整条序列末点会把频率轴拉低好几倍
          const lastP = store.phys(s, from + N - 1)
          const dtMs = Math.max(0.001, (s.t[lastP] - s.t[firstP]) / Math.max(1, N - 1))
          const fsHz = 1000 / dtMs
          const peakHz = (peakBin * fsHz) / N
          spectra.push({
            color: chs[i]?.color ?? th.lColors[i % th.lColors.length],
            points: mags.map((m, f) => ({ x: (f * fsHz) / N, y: m })),
            xMax: Math.min(fsHz / 2, Math.max(8, peakHz * 2.2)),
            yMax: peak,
          })
        }
        freqRef.current = { at: nowMs, spectra }
      }

      const histos: { color: string; bins: number[] }[] = []
      let histMax = 1
      if (c.type === 'histog') {
        const bins = 64
        for (const i of visible) {
          const s = store.series[i]
          if (!s) continue
          const from = store.lowerBound(s, v.t0)
          const step = Math.max(1, Math.floor((s.count - from) / 4000))
          const counts = new Array<number>(bins).fill(0)
          for (let k = from; k < s.count; k += step) {
            const p = store.phys(s, k)
            if (s.t[p] > v.t1) break
            const norm = (s.v[p] - yLo) / (yHi - yLo)
            const bi = Math.max(0, Math.min(bins - 1, Math.floor(norm * bins)))
            counts[bi]++
            if (counts[bi] > histMax) histMax = counts[bi]
          }
          histos.push({ color: chs[i]?.color ?? th.lColors[i % th.lColors.length], bins: counts })
        }
      }

      /* ---- 坐标映射 ---- */
      const xLo = c.type === 'freq' ? 0 : c.type === 'histog' ? yLo : v.t0
      const xHi =
        c.type === 'freq' ? Math.max(1, ...spectra.map((s) => s.xMax)) : c.type === 'histog' ? yHi : v.t1
      const yTop =
        c.type === 'freq' ? Math.max(1e-9, ...spectra.map((s) => s.yMax)) * 1.08 : c.type === 'histog' ? histMax : yHi
      const yBot = c.type === 'freq' || c.type === 'histog' ? 0 : yLo

      const sx = (x: number) => plot.x + ((x - xLo) / Math.max(1e-9, xHi - xLo)) * plot.w
      const sy = (y: number) => plot.y + plot.h - ((y - yBot) / Math.max(1e-9, yTop - yBot)) * plot.h

      /* ---- 网格 ---- */
      ctx.strokeStyle = th.light ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.11)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i <= GRID_X; i++) {
        const x = Math.round(plot.x + (plot.w * i) / GRID_X) + 0.5
        ctx.moveTo(x, plot.y)
        ctx.lineTo(x, plot.y + plot.h)
      }
      for (let i = 0; i <= GRID_Y; i++) {
        const y = Math.round(plot.y + (plot.h * i) / GRID_Y) + 0.5
        ctx.moveTo(plot.x, y)
        ctx.lineTo(plot.x + plot.w, y)
      }
      ctx.stroke()
      ctx.strokeStyle = th.lineColorMain
      ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1)

      /* ---- 刻度 ---- */
      ctx.fillStyle = th.fontColorTips
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (let i = 0; i <= GRID_Y; i++) {
        const val = yTop - ((yTop - yBot) * i) / GRID_Y
        const label =
          c.type === 'histog'
            ? val.toFixed(0)
            : c.type === 'freq'
              ? Math.abs(val) >= 0.01
                ? val.toFixed(2)
                : val.toExponential(1)
              : fmt(val, yTop - yBot)
        ctx.fillText(label, plot.x - 8, plot.y + (plot.h * i) / GRID_Y)
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let i = 0; i <= GRID_X; i++) {
        const val = xLo + ((xHi - xLo) * i) / GRID_X
        const label =
          c.type === 'freq'
            ? `${val.toFixed(0)}Hz`
            : c.type === 'histog'
              ? fmt(val, xHi - xLo)
              : xHi - xLo >= 2000
                ? `${(val / 1000).toFixed(1)}s`
                : `${val.toFixed(0)}ms`
        ctx.fillText(label, plot.x + (plot.w * i) / GRID_X, plot.y + plot.h + 7)
      }

      /* ---- 曲线 ---- */
      ctx.save()
      ctx.beginPath()
      ctx.rect(plot.x, plot.y, plot.w, plot.h)
      ctx.clip()

      if (c.type === 'wave') {
        for (const i of visible) {
          const s = store.series[i]
          if (!s || s.count < 2) continue
          ctx.strokeStyle = chs[i]?.color ?? th.lColors[i % th.lColors.length]
          ctx.lineWidth = c.lineWidth
          ctx.lineJoin = 'round'
          ctx.beginPath()
          const from = store.lowerBound(s, v.t0)
          let started = false
          const dense = s.count - from > plot.w * 1.5
          if (c.simplify && dense) {
            let col = -1
            let mn = Infinity
            let mx = -Infinity
            const flush = () => {
              if (col < 0) return
              const px = plot.x + col
              if (!started) {
                ctx.moveTo(px, sy(mn))
                started = true
              }
              ctx.lineTo(px, sy(mn))
              ctx.lineTo(px, sy(mx))
              mn = Infinity
              mx = -Infinity
            }
            for (let k = from; k < s.count; k++) {
              const p = store.phys(s, k)
              const t = s.t[p]
              if (t < v.t0) continue
              if (t > v.t1) break
              const col2 = Math.round(((t - v.t0) / (v.t1 - v.t0)) * plot.w)
              if (col2 !== col) {
                flush()
                col = col2
              }
              const val = s.v[p]
              if (val < mn) mn = val
              if (val > mx) mx = val
            }
            flush()
          } else {
            for (let k = from; k < s.count; k++) {
              const p = store.phys(s, k)
              const t = s.t[p]
              if (t < v.t0) continue
              if (t > v.t1) break
              const px = sx(t)
              const py = sy(s.v[p])
              if (!started) {
                ctx.moveTo(px, py)
                started = true
              } else ctx.lineTo(px, py)
            }
          }
          ctx.stroke()
        }
      } else if (c.type === 'bar') {
        const bars = 24
        const gw = plot.w / bars
        const bw = Math.max(1, (gw * 0.7) / Math.max(1, visible.length))
        const zero = sy(Math.max(yBot, Math.min(0, yTop)))
        for (let b = 0; b < bars; b++) {
          const t0 = v.t0 + ((v.t1 - v.t0) * b) / bars
          const t1 = v.t0 + ((v.t1 - v.t0) * (b + 1)) / bars
          visible.forEach((i, vi) => {
            const st = store.stats(store.series[i], t0, t1)
            if (!st) return
            ctx.fillStyle = chs[i]?.color ?? th.lColors[i % th.lColors.length]
            const y = sy(st.avg)
            ctx.fillRect(plot.x + b * gw + gw * 0.15 + vi * bw, Math.min(y, zero), bw, Math.abs(zero - y) || 1)
          })
        }
      } else if (c.type === 'histog') {
        const gw = plot.w / 64
        histos.forEach((hs) => {
          ctx.strokeStyle = hs.color
          ctx.lineWidth = c.lineWidth
          ctx.beginPath()
          hs.bins.forEach((cnt, bi) => {
            const x = plot.x + bi * gw + gw / 2
            const y = sy(cnt)
            if (bi === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.stroke()
        })
      } else {
        for (const sp of spectra) {
          ctx.strokeStyle = sp.color
          ctx.lineWidth = c.lineWidth
          ctx.beginPath()
          sp.points.forEach((pt, k) => {
            const x = sx(pt.x)
            const y = sy(pt.y)
            if (k === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.stroke()
        }
      }
      ctx.restore()

      /* ---- 十字光标 ---- */
      const hov = hoverRef.current
      if (hov && hov.x > plot.x && hov.x < plot.x + plot.w && hov.y > plot.y && hov.y < plot.y + plot.h) {
        ctx.strokeStyle = th.mainColor
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.moveTo(hov.x + 0.5, plot.y)
        ctx.lineTo(hov.x + 0.5, plot.y + plot.h)
        ctx.stroke()
        ctx.globalAlpha = 1
        const ratio = (hov.x - plot.x) / plot.w
        const xVal = xLo + ratio * (xHi - xLo)
        const yVal = yTop - ((hov.y - plot.y) / plot.h) * (yTop - yBot)
        const txt =
          c.type === 'freq'
            ? `${xVal.toFixed(1)} Hz · ${yVal.toExponential(2)}`
            : c.type === 'histog'
              ? `${xVal.toFixed(2)} → ${yVal.toFixed(0)} 点`
              : `${xVal.toFixed(0)} ms · ${yVal.toFixed(3)}`
        ctx.font = `${fs}px "JetBrains Mono", Consolas, monospace`
        const tw = ctx.measureText(txt).width + 14
        const bx = Math.min(hov.x + 8, w - tw - 4)
        ctx.fillStyle = th.barColor
        ctx.fillRect(bx, plot.y + 4, tw, fs + 12)
        ctx.fillStyle = th.fontColorBar
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(txt, bx + 7, plot.y + 10)
      }
    }

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      if (paused) return
      const interval = 1000 / Math.max(1, cfgRef.current.fps)
      if (ts - lastDraw < interval) return
      lastDraw = ts
      draw()
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [store, paused])

  /* ---------------- 滚轮（必须非 passive，否则 preventDefault 无效） ---------------- */
  useEffect(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const c = cfgRef.current
      if (c.type === 'freq' || c.type === 'histog') return
      const rect = box.getBoundingClientRect()
      const v = viewRef.current
      const plotW = Math.max(10, rect.width - PAD.left - PAD.right)
      const px = Math.min(Math.max(e.clientX - rect.left - PAD.left, 0), plotW)
      const ratio = px / plotW
      const anchor = v.t0 + ratio * (v.t1 - v.t0)
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const span = Math.min(Math.max((v.t1 - v.t0) * k, 5), 600_000)
      v.auto = false
      v.t0 = anchor - ratio * span
      v.t1 = v.t0 + span
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  /* ---------------- 交互：照官方提示 ---------------- */
  const onPointerDown = (e: RPointerEvent) => {
    const v = viewRef.current
    dragRef.current = { x: e.clientX, t0: v.t0, t1: v.t1, moved: false }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent) => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    hoverRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 3) d.moved = true
    if (!d.moved) return
    const t = cfgRef.current.type
    if (t === 'freq' || t === 'histog') return
    const plotW = Math.max(10, rect.width - PAD.left - PAD.right)
    const span = d.t1 - d.t0
    const shift = (-dx / plotW) * span
    const v = viewRef.current
    v.auto = false
    v.t0 = d.t0 + shift
    v.t1 = d.t1 + shift
  }

  const onPointerUp = (e: RPointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.moved) return
    const t = cfgRef.current.type
    if (t === 'freq' || t === 'histog') return
    const v = viewRef.current
    if (e.button === 2) {
      // 右键单击：解除自动缩放
      v.auto = false
      return
    }
    // 左键单击：缩放至中间两格（10 格 → 2 格）
    const mid = (v.t0 + v.t1) / 2
    const next = (v.t1 - v.t0) * 0.2
    v.auto = false
    v.t0 = mid - next / 2
    v.t1 = mid + next / 2
  }

  const onDoubleClick = () => {
    const t = cfgRef.current.type
    if (t === 'freq' || t === 'histog') return
    const v = viewRef.current
    v.auto = true
    v.t1 = Math.max(store.lastT, cfgRef.current.windowMs)
    v.t0 = v.t1 - cfgRef.current.windowMs
  }

  const onLeave = () => {
    hoverRef.current = null
  }

  return (
    <div className="chart-box" ref={boxRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={onLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}

function fmt(v: number, span: number): string {
  if (!Number.isFinite(v)) return '-'
  if (Math.abs(v) < 1e-9) return '0'
  if (Math.abs(v) >= 10000) return v.toExponential(1)
  if (span < 0.01) return v.toFixed(4)
  if (span < 0.2) return v.toFixed(3)
  if (span < 20) return v.toFixed(2)
  return v.toFixed(0)
}
