/**
 * 被控对象 —— 四旋翼刚体 + 电机一阶滞后
 *
 * 与固件的接口就是 4 路归一化推力 `motors[0..3]`（0~1），
 * 下标顺序照抄固件：0=RL、1=RR、2=FR、3=FL。
 *
 * 混控符号（固件 controlTorque 的逆运算，X 型）：
 *   FL = T - tx - ty + tz
 *   FR = T + tx - ty - tz
 *   RL = T - tx + ty - tz
 *   RR = T + tx + ty + tz
 * 反解出物理力矩：
 *   τx = a·(FR + RR - FL - RL)   → tx > 0 右侧抬起 = +roll
 *   τy = a·(RL + RR - FL - FR)   → ty > 0 机头下压 = +pitch
 *   τz = kq·(FL + RR - FR - RL)  → tz > 0 逆时针   = +yaw
 * 其中 a = 轴距/(2√2)，是电机在机体 X/Y 轴上的投影臂长。
 */

import { type Quat, type Vec3, vec, vAdd, qConjugate, qRotateVector, qFromRotationVector, qRotate, qToEuler } from './quat'

/** plant 只关心这几个字段，单独声明避免和完整参数集耦合 */
export interface PlantParams {
  mass: number
  wheelbase: number
  ixx: number
  iyy: number
  izz: number
  thrustMax: number
  motorTau: number
  torqueRatio: number
  aeroDamp: number
}

export const GRAVITY = 9.80665

export interface PlantState {
  /** 姿态：机体 → 世界 */
  q: Quat
  /** 机体系角速度 rad/s */
  omega: Vec3
  /** 4 路实际推力（归一化，已含电机滞后） */
  motors: number[]
  /** 4 路飞控指令（归一化，未滞后） */
  cmd: number[]
  /** 世界系加速度（含重力），给 3D 画加速度箭头用 */
  accWorld: Vec3
  /** 本次步进是否发生电机饱和（指令超出 [0,1] 被钳） */
  saturated: boolean
}

export function createPlant(): PlantState {
  return {
    q: { w: 1, x: 0, y: 0, z: 0 },
    omega: vec(),
    motors: [0, 0, 0, 0],
    cmd: [0, 0, 0, 0],
    accWorld: vec(0, 0, -GRAVITY),
    saturated: false,
  }
}

/** 悬停所需归一化油门（4 路相同） */
export function hoverThrottle(p: PlantParams): number {
  const weight = p.mass * GRAVITY
  return weight / (4 * Math.max(p.thrustMax, 1e-6))
}

/** 推重比 */
export function thrustToWeight(p: PlantParams): number {
  return (4 * p.thrustMax) / (p.mass * GRAVITY)
}

/**
 * 推进一步。
 * @param cmd 4 路归一化推力指令（顺序 RL/RR/FR/FL，与固件一致）
 * @param dt  步长（s），建议 <= 1ms
 */
export function stepPlant(
  s: PlantState,
  p: PlantParams,
  cmd: readonly number[],
  dt: number,
): void {
  const TAU = Math.max(p.motorTau, 1e-4)
  const k = 1 - Math.exp(-dt / TAU)

  // ---- 1. 电机一阶滞后（精确指数解，dt 变大也不会炸）----
  let saturated = false
  for (let i = 0; i < 4; i++) {
    const c = cmd[i]
    if (c < -1e-6 || c > 1 + 1e-6) saturated = true
    const target = c < 0 ? 0 : c > 1 ? 1 : c
    s.cmd[i] = c
    s.motors[i] += (target - s.motors[i]) * k
  }
  s.saturated = saturated

  // ---- 2. 合力与合力矩 ----
  const f = [
    s.motors[0] * p.thrustMax, // RL
    s.motors[1] * p.thrustMax, // RR
    s.motors[2] * p.thrustMax, // FR
    s.motors[3] * p.thrustMax, // FL
  ]
  const FL = f[3]
  const FR = f[2]
  const RL = f[0]
  const RR = f[1]
  const totalThrust = FL + FR + RL + RR

  const a = p.wheelbase / (2 * Math.SQRT2)
  const tau = {
    x: a * (FR + RR - FL - RL),
    y: a * (RL + RR - FL - FR),
    z: p.torqueRatio * (FL + RR - FR - RL),
  }

  // ---- 3. 刚体角动力学：J·ω̇ = τ - ω×(Jω) - c·J·ω ----
  const w = s.omega
  const Jw = { x: p.ixx * w.x, y: p.iyy * w.y, z: p.izz * w.z }
  const gyro = {
    x: w.y * Jw.z - w.z * Jw.y,
    y: w.z * Jw.x - w.x * Jw.z,
    z: w.x * Jw.y - w.y * Jw.x,
  }
  const alpha = {
    x: (tau.x - gyro.x) / p.ixx - p.aeroDamp * w.x,
    y: (tau.y - gyro.y) / p.iyy - p.aeroDamp * w.y,
    z: (tau.z - gyro.z) / p.izz - p.aeroDamp * w.z,
  }

  const nextOmega = vec(w.x + alpha.x * dt, w.y + alpha.y * dt, w.z + alpha.z * dt)

  // ---- 4. 姿态积分：q ← q ⊗ Δ(ω·dt)，用梯形平均角速度 ----
  const wAvg = vec(
    (w.x + nextOmega.x) * 0.5 * dt,
    (w.y + nextOmega.y) * 0.5 * dt,
    (w.z + nextOmega.z) * 0.5 * dt,
  )
  s.q = qRotate(s.q, qFromRotationVector(wAvg))
  s.omega = nextOmega

  // ---- 5. 世界系加速度（只用于显示，不积分位置）----
  const thrustWorld = qConjugate(s.q, vec(0, 0, totalThrust))
  s.accWorld = vec(thrustWorld.x / p.mass, thrustWorld.y / p.mass, thrustWorld.z / p.mass - GRAVITY)
}

/** 当前欧拉角（rad） */
export function plantEuler(s: PlantState): Vec3 {
  return qToEuler(s.q)
}

/** 当前倾角（rad，机体 Z 轴与世界 Z 轴夹角） */
export function plantTilt(s: PlantState): number {
  const up = qConjugate(s.q, vec(0, 0, 1))
  return Math.acos(Math.max(-1, Math.min(1, up.z)))
}

/** 传感器标定量（来自静止数据标定） */
export interface SensorCalib {
  gyroBias: Vec3
  gyroNoise: number
  accBias: Vec3
  accScale: Vec3
  accNoise: number
}

/**
 * 读出「IMU 会看到什么」——真值 + 零偏 + 噪声。
 *
 * 加速度计测的是**比力** f = a - g（g 指向下），机体系表示。
 * 静止悬停时 a=0 → f_world = (0,0,+g)，与固件 `accNorm ≈ ONE_G` 对得上。
 * 倾斜悬停时推力变大，|f| = g/cosθ，所以固件的 landed 判据（|acc|≈1g）
 * 在大倾角下本来就不成立 —— 这是固件的行为，不修。
 */
export function readSensors(
  s: PlantState,
  calib: SensorCalib,
  noise: () => number,
): { gyro: Vec3; acc: Vec3 } {
  // 电机不转 = 停在地上（本仿真不积分位置，默认地面支撑）。
  // 这时候支撑力抵消重力，加速度计读到的是 +1g 而不是自由落体的 0 ——
  // 少了这一条，固件的 landed 判据（|acc|≈1g）永远不成立，
  // 地面静止场景会用飞行权重去修姿态，漂得比真机还夸张。
  const onGround = !motorsActive(s)
  const fWorld = onGround ? vec(0, 0, GRAVITY) : vAdd(s.accWorld, vec(0, 0, GRAVITY))
  const fBody = qRotateVector(s.q, fWorld)
  return {
    gyro: vec(
      s.omega.x + calib.gyroBias.x + noise() * calib.gyroNoise,
      s.omega.y + calib.gyroBias.y + noise() * calib.gyroNoise,
      s.omega.z + calib.gyroBias.z + noise() * calib.gyroNoise,
    ),
    acc: vec(
      fBody.x * calib.accScale.x + calib.accBias.x + noise() * calib.accNoise,
      fBody.y * calib.accScale.y + calib.accBias.y + noise() * calib.accNoise,
      fBody.z * calib.accScale.z + calib.accBias.z + noise() * calib.accNoise,
    ),
  }
}

/** 电机是否在转（landed 判据之一，对应固件 motorsActive()） */
export function motorsActive(s: PlantState): boolean {
  return s.motors.some((m) => m > 0.01)
}
