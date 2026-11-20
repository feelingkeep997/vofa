/**
 * 3D 姿态视图 —— Canvas 2D 手写透视投影，不引 three.js
 *
 * 为什么不用现成 3D 库：这里只画十几个多边形，引 600KB 的库来算 4 个电机位置不值当；
 * 而且 Canvas 2D 跟项目里其它画布（波形/曲线）同一条渲染路径，主题切换零成本。
 *
 * 相机：绕世界 Z 轴方位角 + 仰角，透视投影。世界系 Z 向上，机体 X 朝前。
 * 机体按真实 118mm 轴距比例画：电机臂 41.7mm、桨半径 25mm（2 寸桨）。
 */

import { useEffect, useRef } from 'react'
import type { Quat, Vec3 } from '../lib/sim/quat'
import { qConjugate, qToEuler, RAD } from '../lib/sim/quat'
import type { ThemeTokens } from '../lib/theme'

interface Props {
  attitude: Quat
  target: Quat
  /** 4 路电机指令，顺序 RL/RR/FR/FL */
  motors: readonly number[]
  thrust: number
  theme: ThemeTokens
  showTarget: boolean
  showThrust: boolean
  /** 相机方位角（deg） */
  azimuth: number
  elevation: number
}

/** 电机在机体系的坐标（下标与固件一致：0=RL 1=RR 2=FR 3=FL） */
const MOTORS = [
  { ux: -1, uy: -1, cw: -1, idx: 0 },
  { ux: -1, uy: 1, cw: 1, idx: 1 },
  { ux: 1, uy: 1, cw: -1, idx: 2 },
  { ux: 1, uy: -1, cw: 1, idx: 3 },
]

/** 机身六边形（机体系，米） */
const BODY: Array<[number, number]> = [
  [0.019, 0],
  [0.009, 0.014],
  [-0.013, 0.014],
  [-0.019, 0],
  [-0.013, -0.014],
  [0.009, -0.014],
]

const ARM = 0.0417 // 118mm 对角轴距 → 0.118/(2√2)
const ROTOR_R = 0.025 // 2 寸桨
const ROTOR_Z = 0.009 // 桨盘比电机高一点，透视下才有层次

interface Cam {
  f: number
  project: (p: Vec3) => { x: number; y: number; d: number } | null
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function unit(a: Vec3): Vec3 {
  const n = Math.hypot(a.x, a.y, a.z) || 1
  return { x: a.x / n, y: a.y / n, z: a.z / n }
}

function makeCamera(azDeg: number, elDeg: number, dist: number, w: number, h: number): Cam {
  const az = azDeg * (Math.PI / 180)
  const el = elDeg * (Math.PI / 180)
  const ca = Math.cos(az)
  const sa = Math.sin(az)
  const ce = Math.cos(el)
  const se = Math.sin(el)
  const target: Vec3 = { x: 0, y: 0, z: -0.012 }
  const dir: Vec3 = { x: ca * ce, y: sa * ce, z: se }
  const eye: Vec3 = { x: target.x + dir.x * dist, y: target.y + dir.y * dist, z: target.z + dir.z * dist }
  const fwd: Vec3 = { x: -dir.x, y: -dir.y, z: -dir.z }
  const right = unit(cross(fwd, { x: 0, y: 0, z: 1 }))
  const up = cross(right, fwd)
  const f = h / 2 / Math.tan((30 * Math.PI) / 180 / 2)
  const cx = w / 2
  const cy = h / 2

  return {
    f,
    project(p: Vec3) {
      const dx = p.x - eye.x
      const dy = p.y - eye.y
      const dz = p.z - eye.z
      const zc = dx * fwd.x + dy * fwd.y + dz * fwd.z
      if (zc <= 0.02) return null
      const s = f / zc
      return {
        x: cx + (dx * right.x + dy * right.y + dz * right.z) * s,
        y: cy - (dx * up.x + dy * up.y + dz * up.z) * s,
        d: zc,
      }
    },
  }
}

type Proj = NonNullable<ReturnType<Cam['project']>>

export default function AttitudeCanvas(props: Props) {
  const { attitude, target, motors, thrust, theme, showTarget, showThrust, azimuth, elevation } = props
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
    const accent = theme.mainColor
    const tip = theme.fontColorTips
    const gridCol = light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'
    const gridMain = light ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.16)'

    const cam = makeCamera(azimuth, elevation, 0.335, w, h)
    const toWorld = (q: Quat, p: Vec3): Vec3 => qConjugate(q, p)

    /* ---------- 地面网格 ---------- */
    const GZ = -0.11
    const half = 0.2
    const n = 8
    ctx.lineWidth = 1
    for (let i = 0; i <= n; i++) {
      const t = -half + (2 * half * i) / n
      ctx.strokeStyle = i === n / 2 ? gridMain : gridCol
      const a1 = cam.project({ x: t, y: -half, z: GZ })
      const a2 = cam.project({ x: t, y: half, z: GZ })
      if (a1 && a2) {
        ctx.beginPath()
        ctx.moveTo(a1.x, a1.y)
        ctx.lineTo(a2.x, a2.y)
        ctx.stroke()
      }
      const b1 = cam.project({ x: -half, y: t, z: GZ })
      const b2 = cam.project({ x: half, y: t, z: GZ })
      if (b1 && b2) {
        ctx.beginPath()
        ctx.moveTo(b1.x, b1.y)
        ctx.lineTo(b2.x, b2.y)
        ctx.stroke()
      }
    }

    // 正下方投影点 + 垂线：倾斜一眼就看出来
    const foot = cam.project({ x: 0, y: 0, z: GZ })
    const origin = cam.project({ x: 0, y: 0, z: 0 })
    if (foot && origin) {
      ctx.strokeStyle = light ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(origin.x, origin.y)
      ctx.lineTo(foot.x, foot.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'
      ctx.beginPath()
      ctx.arc(foot.x, foot.y, 4, 0, Math.PI * 2)
      ctx.stroke()
    }

    /* ---------- 目标姿态虚影 ---------- */
    if (showTarget && Number.isFinite(target.w)) {
      drawGhost(ctx, cam, target, tip)
    }

    /* ---------- 机臂 ---------- */
    const arms = MOTORS.map((m) => ({
      m,
      proj: cam.project(toWorld(attitude, { x: m.ux * ARM, y: m.uy * ARM, z: 0 })),
    })).filter((it): it is { m: (typeof MOTORS)[number]; proj: Proj } => it.proj !== null)

    const center = cam.project({ x: 0, y: 0, z: 0 })
    if (center) {
      ctx.strokeStyle = accent
      ctx.lineCap = 'round'
      ctx.globalAlpha = 0.25
      ctx.lineWidth = 6
      for (const it of arms) {
        ctx.beginPath()
        ctx.moveTo(center.x, center.y)
        ctx.lineTo(it.proj.x, it.proj.y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.lineWidth = 2.4
      for (const it of arms) {
        ctx.beginPath()
        ctx.moveTo(center.x, center.y)
        ctx.lineTo(it.proj.x, it.proj.y)
        ctx.stroke()
      }
    }

    /* ---------- 机身 ---------- */
    if (center) {
      const pts = BODY.map(([bx, by]) => cam.project(toWorld(attitude, { x: bx, y: by, z: 0 })))
      if (pts.every((p) => p !== null)) {
        const poly = pts as Proj[]
        ctx.beginPath()
        poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.closePath()
        ctx.fillStyle = light ? 'rgba(255,255,255,0.9)' : 'rgba(8,10,12,0.78)'
        ctx.fill()
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.6
        ctx.stroke()

        // 机头方向小三角
        const nose = cam.project(toWorld(attitude, { x: 0.0175, y: 0, z: 0.001 }))
        const nl = cam.project(toWorld(attitude, { x: 0.008, y: 0.004, z: 0.001 }))
        const nr = cam.project(toWorld(attitude, { x: 0.008, y: -0.004, z: 0.001 }))
        if (nose && nl && nr) {
          ctx.beginPath()
          ctx.moveTo(nose.x, nose.y)
          ctx.lineTo(nl.x, nl.y)
          ctx.lineTo(nr.x, nr.y)
          ctx.closePath()
          ctx.fillStyle = theme.fontColor
          ctx.fill()
        }
      }
    }

    /* ---------- 电机 + 桨盘（远的先画） ---------- */
    const rotors = MOTORS.map((m) => ({
      m,
      hub: cam.project(toWorld(attitude, { x: m.ux * ARM, y: m.uy * ARM, z: 0 })),
      disc: cam.project(toWorld(attitude, { x: m.ux * ARM, y: m.uy * ARM, z: ROTOR_Z })),
    }))
      .filter((it): it is { m: (typeof MOTORS)[number]; hub: Proj; disc: Proj } => it.hub !== null && it.disc !== null)
      .sort((a, b) => b.disc.d - a.disc.d)

    for (const it of rotors) {
      const val = Math.max(0, Math.min(1, motors[it.m.idx] ?? 0))
      const rp = (ROTOR_R * cam.f) / it.disc.d
      const hot = val > 0.75

      // 桨盘：极淡填充 + 细环，模拟高速旋转
      ctx.beginPath()
      ctx.arc(it.disc.x, it.disc.y, rp, 0, Math.PI * 2)
      ctx.fillStyle = hot
        ? `rgba(255,80,80,${0.03 + val * 0.04})`
        : light
          ? `rgba(0,0,0,${0.012 + val * 0.025})`
          : `rgba(255,255,255,${0.012 + val * 0.03})`
      ctx.fill()
      ctx.strokeStyle = hot ? theme.badColor : accent
      ctx.globalAlpha = 0.16 + val * 0.28
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalAlpha = 1

      // 桨叶残影：两道弧
      ctx.strokeStyle = hot ? theme.badColor : accent
      ctx.globalAlpha = 0.10 + val * 0.22
      ctx.lineWidth = 1.4
      for (const off of [0, Math.PI / 2]) {
        ctx.beginPath()
        ctx.arc(it.disc.x, it.disc.y, rp * 0.82, off + 0.2, off + 1.5)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // 电机本体
      const hr = Math.max(2.5, rp * 0.2)
      ctx.beginPath()
      ctx.arc(it.hub.x, it.hub.y, hr, 0, Math.PI * 2)
      ctx.fillStyle = hot ? theme.badColor : accent
      ctx.globalAlpha = 0.55 + val * 0.45
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    /* ---------- 推力矢量 ---------- */
    if (showThrust && center) {
      const avg = motors.reduce((a, b) => a + b, 0) / 4
      const len = 0.035 + avg * 0.075
      const p2 = cam.project(toWorld(attitude, { x: 0, y: 0, z: len }))
      if (p2) {
        ctx.strokeStyle = theme.cbColor3
        ctx.lineWidth = 2.5
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.moveTo(center.x, center.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
        const ang = Math.atan2(p2.y - center.y, p2.x - center.x)
        ctx.beginPath()
        ctx.moveTo(p2.x, p2.y)
        ctx.lineTo(p2.x - 9 * Math.cos(ang - 0.42), p2.y - 9 * Math.sin(ang - 0.42))
        ctx.lineTo(p2.x - 9 * Math.cos(ang + 0.42), p2.y - 9 * Math.sin(ang + 0.42))
        ctx.closePath()
        ctx.fillStyle = theme.cbColor3
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    /* ---------- 读数 ---------- */
    const e = qToEuler(attitude)
    const tilt = Math.acos(Math.max(-1, Math.min(1, qConjugate(attitude, { x: 0, y: 0, z: 1 }).z))) * RAD
    ctx.font = '11px "JetBrains Mono", Consolas, monospace'
    ctx.fillStyle = tip
    ctx.textAlign = 'left'
    const lines = [
      `roll  ${(e.x * RAD).toFixed(1).padStart(6)}°`,
      `pitch ${(e.y * RAD).toFixed(1).padStart(6)}°`,
      `yaw   ${(e.z * RAD).toFixed(1).padStart(6)}°`,
      `tilt  ${tilt.toFixed(1).padStart(6)}°`,
    ]
    lines.forEach((s, i) => ctx.fillText(s, 10, 18 + i * 15))

    // 右侧推力条
    const barW = 5
    const barH = Math.max(40, h - 44)
    const bx = w - 15
    const by = 20
    ctx.fillStyle = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
    ctx.fillRect(bx, by, barW, barH)
    const frac = Math.max(0, Math.min(1, thrust))
    ctx.fillStyle = accent
    ctx.fillRect(bx, by + barH * (1 - frac), barW, barH * frac)
    ctx.font = '10px "JetBrains Mono", Consolas, monospace'
    ctx.textAlign = 'right'
    ctx.fillStyle = tip
    ctx.fillText(`${(frac * 100).toFixed(0)}%`, bx - 3, by + barH + 12)
  }, [attitude, target, motors, thrust, theme, showTarget, showThrust, azimuth, elevation])

  return <canvas ref={ref} className="att-canvas" />
}

/* ---------------- 目标姿态线框 ---------------- */

function drawGhost(ctx: CanvasRenderingContext2D, cam: Cam, q: Quat, color: string) {
  const toWorld = (p: Vec3) => qConjugate(q, p)
  const center = cam.project({ x: 0, y: 0, z: 0 })
  if (!center) return
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  ctx.strokeStyle = color

  for (const m of MOTORS) {
    const p = cam.project(toWorld({ x: m.ux * ARM, y: m.uy * ARM, z: ROTOR_Z }))
    if (!p) continue
    ctx.beginPath()
    ctx.moveTo(center.x, center.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(3, (ROTOR_R * cam.f) / p.d), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}
