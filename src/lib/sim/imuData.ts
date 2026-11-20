/**
 * IMU 静止数据解析 + 标定
 *
 * 认两种格式：
 *   1) CF-Drone `Drivers/imu.cpp` 的 17 通道调试输出（默认）
 *      acc xyz(m/s²) | gyro xyz(°/s) | roll pitch yaw(rad) | velZ | thrust | hoverEst | armed | motor×4
 *   2) 裸六轴（6 列），顺序自动判断（看哪三个数的模长接近 9.8）
 *
 * 标定出来的东西：
 *   - 陀螺零偏（三轴均值）→ 决定静止时姿态漂多快
 *   - 陀螺噪声（三轴 1σ）→ 决定 D 项有多怕脏
 *   - 加速度计均值/噪声/模长 → 比例因子与静态倾角
 *   - 姿态漂移率（数据里带 euler 时，线性拟合）
 *
 * 这些值直接喂给 `SimParams`，仿真才跟真机对得上。
 */

import { type Vec3, vec, RAD, DEG, vNorm } from './quat'
import { GRAVITY } from './plant'
import type { SimParams } from './params'

export interface ImuFrame {
  /** 采样序号（原始数据没有绝对时间，按采样率反推） */
  index: number
  /** 加速度 m/s²（机体系） */
  acc: Vec3
  /** 角速度 rad/s（机体系，已从 °/s 转过来） */
  gyro: Vec3
  /** 飞控算出来的欧拉角 rad（只有 17 通道格式有） */
  euler?: Vec3
  armed?: boolean
}

export interface ImuCalib {
  frames: number
  /** 采样率 Hz（用户给的，用于把漂移率换算成 °/s） */
  sampleRate: number
  /** 数据时长 s */
  duration: number
  format: string

  /** 陀螺零偏（rad/s）与其 °/s 表示 */
  gyroBias: Vec3
  gyroBiasDeg: Vec3
  gyroBiasNormDeg: number
  /** 陀螺噪声 1σ（rad/s 与 °/s） */
  gyroNoise: Vec3
  gyroNoiseDeg: Vec3

  /** 加速度计均值与噪声 */
  accMean: Vec3
  accNoise: Vec3
  /** 均值模长（静止时应 ≈ 9.8） */
  accNormMean: number
  /** 加速度数据是否可信（模长偏离 1g 太多 = 缺列/单位错/被截断） */
  accValid: boolean
  /** (|acc|/g - 1) × 100%，正 = 读数偏大 */
  accScaleErrPct: number
  /** 由 acc 反算的静态倾角（°）—— 飞机真放平的话这就是真实姿态 */
  staticTiltDeg: { roll: number; pitch: number }

  /** 姿态漂移率（°/s，只有带 euler 的数据才有） */
  driftDegPerSec: Vec3 | null
  /** 姿态波动范围（°，max-min） */
  eulerRangeDeg: Vec3 | null

  warnings: string[]
  /** 一句话结论 */
  verdict: string
}

export interface ParseOutcome {
  frames: ImuFrame[]
  format: string
  /** 解析时跳过的行数 */
  skipped: number
}

/* ---------------- 解析 ---------------- */

const NUM = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/

function splitLine(line: string): number[] | null {
  const parts = line.split(/[,;\t ]+/).filter((s) => s.length)
  if (parts.length < 6) return null
  const out: number[] = []
  for (const p of parts) {
    if (!NUM.test(p)) return null
    out.push(Number(p))
  }
  return out
}

/** 判断哪三个数是加速度：模长最接近 9.8 的那个三元组 */
function pickAccTriple(v: number[]): number {
  let best = 0
  let bestErr = Infinity
  for (let i = 0; i + 2 < v.length; i++) {
    const m = Math.hypot(v[i], v[i + 1], v[i + 2])
    const err = Math.abs(m - GRAVITY)
    if (err < bestErr) {
      bestErr = err
      best = i
    }
  }
  return best
}

/**
 * 解析文本。自动认 17 通道 / 裸六轴两种格式。
 * 单位处理：17 通道的 gyro 是 °/s，内部统一转 rad/s。
 */
export function parseImuText(text: string): ParseOutcome {
  const lines = text.split(/\r?\n/)
  const frames: ImuFrame[] = []
  let skipped = 0
  let format = 'unknown'
  let accOffset = 1

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const v = splitLine(line)
    if (!v) {
      skipped++
      continue
    }

    if (v.length >= 17) {
      format = 'CF-Drone 17 通道（imu.cpp 调试输出）'
      // ch0-2 acc，ch3-5 gyro(°/s)，ch6-8 euler(rad)
      frames.push({
        index: frames.length,
        acc: vec(v[0], v[1], v[2]),
        gyro: vec(v[3] * DEG, v[4] * DEG, v[5] * DEG),
        euler: vec(v[6], v[7], v[8]),
        armed: v[12] > 0.5,
      })
      continue
    }

    if (v.length === 6) {
      if (format === 'unknown') {
        accOffset = pickAccTriple(v) === 0 ? 0 : 3
        format =
          accOffset === 0
            ? '裸六轴（acc 在前，gyro 单位按量级判断）'
            : '裸六轴（gyro 在前，gyro 单位按量级判断）'
      }
      const a = accOffset === 0 ? vec(v[0], v[1], v[2]) : vec(v[3], v[4], v[5])
      const g = accOffset === 0 ? vec(v[3], v[4], v[5]) : vec(v[0], v[1], v[2])
      // 静止时 rad/s 应该 < 0.2；超过 0.5 基本就是 °/s
      const gMax = Math.max(Math.abs(g.x), Math.abs(g.y), Math.abs(g.z))
      const gyro = gMax > 0.5 ? vec(g.x * DEG, g.y * DEG, g.z * DEG) : g
      frames.push({ index: frames.length, acc: a, gyro })
      continue
    }

    skipped++
  }

  if (format === 'unknown' && frames.length) format = '未知列数（按 17 通道前 9 列读）'
  return { frames, format, skipped }
}

/* ---------------- 标定 ---------------- */

function mean(xs: number[]): number {
  let s = 0
  for (const x of xs) s += x
  return xs.length ? s / xs.length : 0
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return Math.sqrt(s / (xs.length - 1))
}

/** 最小二乘斜率（x 为序号） */
function slope(ys: number[]): number {
  const n = ys.length
  if (n < 2) return 0
  const xm = (n - 1) / 2
  const ym = mean(ys)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (ys[i] - ym)
    den += (i - xm) * (i - xm)
  }
  return den > 0 ? num / den : 0
}

export function calibrate(frames: ImuFrame[], sampleRate = 50): ImuCalib {
  const warnings: string[] = []
  const n = frames.length
  const dt = 1 / Math.max(1, sampleRate)

  const gx = frames.map((f) => f.gyro.x)
  const gy = frames.map((f) => f.gyro.y)
  const gz = frames.map((f) => f.gyro.z)
  const ax = frames.map((f) => f.acc.x)
  const ay = frames.map((f) => f.acc.y)
  const az = frames.map((f) => f.acc.z)

  const gyroBias = vec(mean(gx), mean(gy), mean(gz))
  const gyroNoise = vec(std(gx), std(gy), std(gz))
  const accMean = vec(mean(ax), mean(ay), mean(az))
  const accNoise = vec(std(ax), std(ay), std(az))
  const accNormMean = vNorm(accMean)
  const scaleErr = (accNormMean / GRAVITY - 1) * 100
  // 模长偏离 1g 超过 30% 基本不是标定问题，是数据本身坏了（缺列、单位错、小数点被吃）
  const accValid = Math.abs(scaleErr) < 30

  // 由加速度计反算静态倾角（飞机真放平的话这就是真实姿态）
  const staticRoll = Math.atan2(-accMean.y, Math.hypot(accMean.x, accMean.z)) * RAD
  const staticPitch = Math.atan2(accMean.x, Math.hypot(accMean.y, accMean.z)) * RAD

  // 姿态漂移：只有带 euler 的数据才能算
  let driftDegPerSec: Vec3 | null = null
  let eulerRangeDeg: Vec3 | null = null
  const withEuler = frames.filter((f) => f.euler)
  if (withEuler.length > 10) {
    const r = withEuler.map((f) => f.euler!.x * RAD)
    const p = withEuler.map((f) => f.euler!.y * RAD)
    const y = withEuler.map((f) => f.euler!.z * RAD)
    // 斜率（°/样本）× 采样率 = °/s
    driftDegPerSec = vec(slope(r) * sampleRate, slope(p) * sampleRate, slope(y) * sampleRate)
    eulerRangeDeg = vec(
      Math.max(...r) - Math.min(...r),
      Math.max(...p) - Math.min(...p),
      Math.max(...y) - Math.min(...y),
    )
  }

  const biasNormDeg = vNorm(gyroBias) * RAD
  const duration = n * dt

  /* ---- 诊断（阈值来自固件 imu.cpp 的真实常量）---- */
  const TRIM_RATE_TH = 5.2 // GYRO_TRIM_RATE_TH = 0.09 rad/s
  const TRIM_LIMIT = 4.6 // GYRO_TRIM_LIMIT = 0.08 rad/s

  if (biasNormDeg > TRIM_RATE_TH) {
    warnings.push(
      `陀螺零偏模长 ${biasNormDeg.toFixed(1)} °/s > GYRO_TRIM_RATE_TH(${TRIM_RATE_TH} °/s)：` +
        `gyroBiasTrim 的静止门控永远不满足，在线微调一次都不会启动 —— 零偏只能靠上电标定`,
    )
  }
  if (biasNormDeg > TRIM_LIMIT) {
    warnings.push(
      `零偏模长超过 GYRO_TRIM_LIMIT(${TRIM_LIMIT} °/s) 硬限幅：就算门控放行，trim 也补不回来`,
    )
  }
  if (!accValid) {
    warnings.push(
      `加速度模长 ${accNormMean.toFixed(2)} m/s² 偏离 1g 达 ${scaleErr.toFixed(0)}% —— 这不是标定能解释的，` +
        `多半是数据缺列/单位错/小数点被吃掉了。acc 零偏已跳过，只标了陀螺`,
    )
  } else if (Math.abs(scaleErr) > 5) {
    warnings.push(`加速度模长 ${accNormMean.toFixed(2)} m/s² 偏离 1g 达 ${scaleErr.toFixed(1)}%，比例因子需要标定`)
  }
  if (driftDegPerSec) {
    const d = Math.max(Math.abs(driftDegPerSec.x), Math.abs(driftDegPerSec.y))
    if (d > 1) {
      warnings.push(`静止时姿态以 ${d.toFixed(1)} °/s 持续漂移，这就是零偏的直接后果`)
    }
  }
  if (n < 100) {
    warnings.push(`只有 ${n} 帧，标定结果统计意义不足；建议至少采 5 秒（50Hz 下 250 帧）`)
  }

  let verdict: string
  if (biasNormDeg > TRIM_RATE_TH) {
    verdict = `零偏 ${biasNormDeg.toFixed(1)} °/s 严重超限，静止时姿态必然漂，起飞后会朝固定方向侧漂`
  } else if (biasNormDeg > 1.5) {
    verdict = `零偏 ${biasNormDeg.toFixed(1)} °/s 偏大，靠上电标定能压住，但余量不多`
  } else if (biasNormDeg > 0.3) {
    verdict = `零偏 ${biasNormDeg.toFixed(1)} °/s，属正常范围`
  } else {
    verdict = `零偏 ${biasNormDeg.toFixed(2)} °/s，传感器很干净`
  }

  return {
    frames: n,
    sampleRate,
    duration,
    format: '',
    gyroBias,
    gyroBiasDeg: vec(gyroBias.x * RAD, gyroBias.y * RAD, gyroBias.z * RAD),
    gyroBiasNormDeg: biasNormDeg,
    gyroNoise,
    gyroNoiseDeg: vec(gyroNoise.x * RAD, gyroNoise.y * RAD, gyroNoise.z * RAD),
    accMean,
    accNoise,
    accNormMean,
    accValid,
    accScaleErrPct: scaleErr,
    staticTiltDeg: { roll: staticRoll, pitch: staticPitch },
    driftDegPerSec,
    eulerRangeDeg,
    warnings,
    verdict,
  }
}

/** 把标定结果映射成仿真参数 */
export function calibToParams(c: ImuCalib): Partial<SimParams> {
  // 噪声取三轴最大值，保守一点（D 项最怕的是最脏那个轴）
  const noise = Math.max(c.gyroNoise.x, c.gyroNoise.y, c.gyroNoise.z)
  const accNoise = Math.max(c.accNoise.x, c.accNoise.y, c.accNoise.z)
  return {
    gyroBiasX: c.gyroBias.x,
    gyroBiasY: c.gyroBias.y,
    gyroBiasZ: c.gyroBias.z,
    gyroNoise: noise,
    // 加速度计零偏：只有数据可信时才写（假设飞机确实放平，均值减理想重力）
    accBiasX: c.accValid ? c.accMean.x : 0,
    accBiasY: c.accValid ? c.accMean.y : 0,
    accBiasZ: c.accValid ? c.accMean.z - GRAVITY : 0,
    accScaleX: 1,
    accScaleY: 1,
    accScaleZ: 1,
    accNoise: c.accValid ? accNoise : 0,
  }
}
