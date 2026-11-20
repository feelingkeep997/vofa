/**
 * 姿态估计器 —— 1:1 移植 CF-Drone `application/estimate.cpp`
 *
 * 这一步是「用实采数据仿真」的关键：之前仿真是姿态真值直通，陀螺零偏和噪声
 * 根本没地方生效。接上这条链之后，飞控看到的才是「带零偏、带噪声、会漂」的估计值，
 * 跟真机一样 —— 飞控拿不到真值。
 *
 * 固件四步（顺序固定）：
 *   applyGyro()     陀螺积分：rates = LPF(gyro - levelGyroBias)，attitude 按 rates·dt 旋转
 *   applyAcc()      加速度计修正：落地大权重、飞行小权重（三重门控）
 *   applyLevel()    水平修正 + 零偏在线学习（固件默认关闭，weight=0）
 *   estimateVelZ()  垂直速度积分 + 泄漏（无气压计，仅供定高阻尼）
 */

import {
  type Quat,
  type Vec3,
  vec,
  quat,
  vAdd,
  vSub,
  vScale,
  vNorm,
  qRotate,
  qRotateVector,
  qConjugate,
  qFromRotationVector,
  rotationVectorBetween,
  clamp,
} from './quat'
import { GRAVITY } from './plant'

export interface EstParams {
  estAccWeight: number
  estAccWeightInFlight: number
  estRatesLpfAlpha: number
  levelWeight: number
  levelBiasGain: number
}

/** 三轴一阶低通（对应固件 LowPassFilter<Vector>） */
class Lpf3 {
  private out: Vec3 = vec()
  private init = false
  constructor(public alpha = 0.2) {}

  update(v: Vec3): Vec3 {
    if (this.alpha >= 1) return v
    if (!this.init) {
      this.out = { ...v }
      this.init = true
    }
    this.out = vec(
      this.out.x + this.alpha * (v.x - this.out.x),
      this.out.y + this.alpha * (v.y - this.out.y),
      this.out.z + this.alpha * (v.z - this.out.z),
    )
    return this.out
  }

  reset() {
    this.init = false
  }
}

/** 标量一阶低通 */
class Lpf1 {
  private out = 0
  private init = false
  constructor(public alpha: number) {}

  update(v: number): number {
    if (this.alpha >= 1) return v
    if (!this.init) {
      this.out = v
      this.init = true
    }
    this.out += this.alpha * (v - this.out)
    return this.out
  }

  reset() {
    this.init = false
  }
}

const LEVEL_MAX_TILT = (30 * Math.PI) / 180 // 固件 levelMaxTilt
const LEVEL_GATE = 0.2 // 固件 levelGateThreshold
const BIAS_LIMIT = (3 * Math.PI) / 180 // 零偏限幅 ±3°
const ALT_VEL_LEAK = 0.15 // 垂直速度泄漏率 1/s
const ALT_ACC_LPF_ALPHA = 0.05

export class AttitudeEstimator {
  /** 估计姿态（机体 → 世界）。控制器用的就是它，不是真值 */
  attitude: Quat = quat()
  /** 滤波后角速率（控制器内环的测量值） */
  rates: Vec3 = vec()
  /** 是否判定为落地（电机停 + |acc|≈1g） */
  landed = false
  /** 在线学习的陀螺零偏 */
  levelGyroBias: Vec3 = vec()
  /** 垂直速度估计（无气压计，仅供定高阻尼） */
  velZ = 0

  private ratesFilter = new Lpf3(0.2)
  private accZFilter = new Lpf1(ALT_ACC_LPF_ALPHA)

  reset(attitude: Quat = quat()) {
    this.attitude = { ...attitude }
    this.rates = vec()
    this.landed = false
    this.levelGyroBias = vec()
    this.velZ = 0
    this.ratesFilter.reset()
    this.accZFilter.reset()
  }

  /**
   * 一步估计。
   * @param gyro        陀螺原始读数（rad/s，已含零偏与噪声）
   * @param acc         加速度计原始读数（m/s²，机体系比力）
   * @param motorsActive 电机是否在转（landed 判据之一）
   * @param sticks      杆量（acc 修正的门控）
   */
  step(
    gyro: Vec3,
    acc: Vec3,
    motorsActive: boolean,
    sticks: { roll: number; pitch: number },
    dt: number,
    p: EstParams,
  ): void {
    this.ratesFilter.alpha = p.estRatesLpfAlpha
    this.applyGyro(gyro, dt)
    this.applyAcc(acc, motorsActive, sticks, p)
    this.applyLevel(sticks, p)
    this.estimateVelZ(acc, dt)
  }

  /** 陀螺积分：姿态解算的主体，也是漂移的来源 */
  private applyGyro(gyro: Vec3, dt: number): void {
    this.rates = this.ratesFilter.update(vSub(gyro, this.levelGyroBias))
    this.attitude = qRotate(this.attitude, qFromRotationVector(vScale(this.rates, dt)))
  }

  /** 加速度计修正：用重力方向把估计姿态往回拽 */
  private applyAcc(acc: Vec3, motorsActive: boolean, sticks: { roll: number; pitch: number }, p: EstParams): void {
    const accNorm = vNorm(acc)
    this.landed = !motorsActive && Math.abs(accNorm - GRAVITY) < GRAVITY * 0.1

    let weight: number
    if (this.landed) {
      weight = p.estAccWeight
    } else {
      // 线加速度过大时 acc 不代表重力，本帧放弃
      if (Math.abs(accNorm - GRAVITY) > GRAVITY * 0.15) return
      const stick = Math.max(Math.abs(sticks.roll), Math.abs(sticks.pitch))
      const gate = clamp(1 - stick / LEVEL_GATE, 0, 1)
      if (gate <= 0) return
      weight = p.estAccWeightInFlight * gate
    }
    if (weight <= 0) return

    const up = qRotateVector(this.attitude, vec(0, 0, 1))
    const correction = vScale(rotationVectorBetween(acc, up), weight)
    this.attitude = qRotate(this.attitude, qFromRotationVector(correction))
  }

  /** 水平修正 + 陀螺零偏在线学习（固件默认两者都关） */
  private applyLevel(sticks: { roll: number; pitch: number }, p: EstParams): void {
    if (this.landed) {
      this.levelGyroBias = vec()
      return
    }
    if (p.levelWeight <= 0 && p.levelBiasGain <= 0) return

    const up = qRotateVector(this.attitude, vec(0, 0, 1))
    const tilt = Math.acos(clamp(up.z, -1, 1))
    if (tilt < (0.1 * Math.PI) / 180) return

    let dynamicWeight = p.levelWeight * clamp(1 - tilt / LEVEL_MAX_TILT, 0, 1)
    const stick = Math.max(Math.abs(sticks.roll), Math.abs(sticks.pitch))
    const stickGate = clamp(1 - stick / LEVEL_GATE, 0, 1)
    dynamicWeight *= stickGate

    const error = rotationVectorBetween(vec(0, 0, 1), up)
    if (dynamicWeight > 0) {
      this.attitude = qRotate(this.attitude, qFromRotationVector(vScale(error, dynamicWeight)))
    }
    // 零偏是「从陀螺读数里减掉」的量，所以朝 error 反方向走（Mahony 型 ḃ = -Ki·e）
    this.levelGyroBias = vSub(this.levelGyroBias, vScale(error, p.levelBiasGain * stickGate))
    const bn = vNorm(this.levelGyroBias)
    if (bn > BIAS_LIMIT) this.levelGyroBias = vScale(this.levelGyroBias, BIAS_LIMIT / bn)
  }

  /** 垂直速度：世界系 Z 加速度积分 + 泄漏（长时间必漂，只给定高阻尼用） */
  private estimateVelZ(acc: Vec3, dt: number): void {
    if (this.landed) {
      this.velZ = 0
      this.accZFilter.reset()
      return
    }
    const accWorld = qConjugate(this.attitude, acc)
    const az = this.accZFilter.update(accWorld.z - GRAVITY)
    this.velZ += az * dt
    this.velZ -= this.velZ * ALT_VEL_LEAK * dt
  }

  /** 当前估计的欧拉角（rad） */
  euler(): Vec3 {
    // 延迟导入避免循环依赖，这里直接算
    const q = this.attitude
    const sqx = q.x * q.x
    const sqy = q.y * q.y
    const sqz = q.z * q.z
    const sqw = q.w * q.w
    const sarg = (-2 * (q.x * q.z - q.w * q.y)) / (sqx + sqy + sqz + sqw)
    return vec(
      Math.atan2(2 * (q.y * q.z + q.w * q.x), sqw - sqx - sqy + sqz),
      Math.asin(clamp(sarg, -1, 1)),
      Math.atan2(2 * (q.x * q.y + q.w * q.z), sqw + sqx - sqy - sqz),
    )
  }
}

export { vAdd }
