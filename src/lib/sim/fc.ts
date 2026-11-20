/**
 * 飞控控制链 —— 逐行移植 CF-Drone `application/control.cpp`
 *
 * 调用顺序与固件 control() 完全一致：
 *   interpretControls() → controlAttitude() → controlRates() → controlTorque()
 *
 * 唯一省略的是解锁手势 / 失控保护 / 定高（与姿态响应无关，留着只会干扰调参）。
 * 增益每步从参数集同步，所以拖滑块是实时生效的。
 */

import {
  type Quat,
  type Vec3,
  vec,
  qFromEuler,
  qToEuler,
  qRotateVector,
  rotationVectorBetween,
  wrapAngle,
} from './quat'
import { Pid } from './pid'
import type { SimParams } from './params'

export type FlightMode = 'STAB' | 'ACRO'

export interface Sticks {
  roll: number
  pitch: number
  yaw: number
  throttle: number
}

export const ZERO_STICKS: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 }

const mapf = (x: number, inMin: number, inMax: number, outMin: number, outMax: number): number =>
  outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin)

export class FlightController {
  mode: FlightMode = 'STAB'

  attitudeTarget: Quat = { w: 1, x: 0, y: 0, z: 0 }
  ratesTarget: Vec3 = vec()
  ratesExtra: Vec3 = vec()
  torqueTarget: Vec3 = vec()
  /** 4 路归一化推力指令，顺序 RL/RR/FR/FL */
  motors: number[] = [0, 0, 0, 0]
  thrustTarget = 0
  /** 阶跃测试用：直接指定目标欧拉角（rad），非空时覆盖杆量生成的目标 */
  targetOverride: Vec3 | null = null

  private targetYaw = 0

  readonly rollPid: Pid
  readonly pitchPid: Pid
  readonly yawPid: Pid
  readonly rollRatePid: Pid
  readonly pitchRatePid: Pid
  readonly yawRatePid: Pid

  constructor(p: SimParams) {
    this.rollPid = new Pid({ p: p.rollP, i: p.rollI, d: p.rollD, windup: p.rollWU, dAlpha: 1 })
    this.pitchPid = new Pid({ p: p.pitchP, i: p.pitchI, d: p.pitchD, windup: p.pitchWU, dAlpha: 1 })
    // 固件 yawPID(YAW_P, 0, 0)，windup 默认 0 —— 纯 P
    this.yawPid = new Pid({ p: p.yawP, i: 0, d: 0, windup: 0, dAlpha: 1 })
    this.rollRatePid = new Pid({
      p: p.rollRateP,
      i: p.rollRateI,
      d: p.rollRateD,
      windup: p.rollRateWU,
      dAlpha: p.rateDAlpha,
    })
    this.pitchRatePid = new Pid({
      p: p.pitchRateP,
      i: p.pitchRateI,
      d: p.pitchRateD,
      windup: p.pitchRateWU,
      dAlpha: p.rateDAlpha,
    })
    this.yawRatePid = new Pid({
      p: p.yawRateP,
      i: p.yawRateI,
      d: p.yawRateD,
      windup: p.yawRateWU,
      dAlpha: p.rateDAlpha,
    })
  }

  /** 每步同步增益，让滑块实时生效 */
  syncGains(p: SimParams): void {
    this.rollPid.setGains({ p: p.rollP, i: p.rollI, d: p.rollD, windup: p.rollWU, dAlpha: 1 })
    this.pitchPid.setGains({ p: p.pitchP, i: p.pitchI, d: p.pitchD, windup: p.pitchWU, dAlpha: 1 })
    this.yawPid.setGains({ p: p.yawP, i: 0, d: 0, windup: 0, dAlpha: 1 })
    this.rollRatePid.setGains({
      p: p.rollRateP,
      i: p.rollRateI,
      d: p.rollRateD,
      windup: p.rollRateWU,
      dAlpha: p.rateDAlpha,
    })
    this.pitchRatePid.setGains({
      p: p.pitchRateP,
      i: p.pitchRateI,
      d: p.pitchRateD,
      windup: p.pitchRateWU,
      dAlpha: p.rateDAlpha,
    })
    this.yawRatePid.setGains({
      p: p.yawRateP,
      i: p.yawRateI,
      d: p.yawRateD,
      windup: p.yawRateWU,
      dAlpha: p.rateDAlpha,
    })
  }

  reset(attitude: Quat): void {
    this.rollPid.reset()
    this.pitchPid.reset()
    this.yawPid.reset()
    this.rollRatePid.reset()
    this.pitchRatePid.reset()
    this.yawRatePid.reset()
    this.ratesTarget = vec()
    this.ratesExtra = vec()
    this.torqueTarget = vec()
    this.attitudeTarget = { ...attitude }
    this.targetYaw = qToEuler(attitude).z
    this.thrustTarget = 0
  }

  /**
   * 一步控制。
   * @param attitude 实测姿态（仿真里直接用真值，可选加噪声）
   * @param rates    实测角速率（机体系 rad/s）
   * @returns 4 路归一化推力指令
   */
  step(p: SimParams, attitude: Quat, rates: Vec3, sticks: Sticks, dt: number): number[] {
    this.syncGains(p)
    const euler = qToEuler(attitude)

    // ---------- interpretControls ----------
    // 油门死区映射（固件：<0.05 视为收油）
    this.thrustTarget =
      sticks.throttle < 0.05 ? 0 : mapf(sticks.throttle, 0.05, 1, p.motThrMin, p.motThrMax)

    // 偏航小杆量死区，避免手抖引起缓慢偏航
    const yawStick = Math.abs(sticks.yaw) < 0.1 ? 0 : sticks.yaw

    if (this.mode === 'STAB') {
      // 有偏航杆量时目标偏航跟随当前偏航，偏航交给前馈驱动（固件同款处理）
      if (yawStick !== 0) this.targetYaw = euler.z
      if (this.targetOverride) {
        this.targetYaw = this.targetOverride.z
        this.attitudeTarget = qFromEuler(this.targetOverride.x, this.targetOverride.y, this.targetOverride.z)
      } else {
        this.attitudeTarget = qFromEuler(sticks.roll * p.tiltMax, sticks.pitch * p.tiltMax, this.targetYaw)
      }
      this.ratesExtra = vec(0, 0, -yawStick * p.maxRateYaw)
    } else {
      this.attitudeTarget = { w: NaN, x: NaN, y: NaN, z: NaN }
      this.ratesTarget = vec(
        sticks.roll * p.maxRateRoll,
        sticks.pitch * p.maxRatePitch,
        -yawStick * p.maxRateYaw,
      )
    }

    // ---------- controlAttitude ----------
    if (this.mode === 'STAB') {
      const up = vec(0, 0, 1)
      const upActual = qRotateVector(attitude, up)
      const upTarget = qRotateVector(this.attitudeTarget, up)
      const error = rotationVectorBetween(upTarget, upActual)
      this.ratesTarget = vec(
        this.rollPid.update(error.x, dt) + this.ratesExtra.x,
        this.pitchPid.update(error.y, dt) + this.ratesExtra.y,
        this.yawPid.update(wrapAngle(this.targetYaw - euler.z), dt) + this.ratesExtra.z,
      )
    }

    // ---------- controlRates ----------
    // 内环 D-on-measurement：只对实测角速率微分，目标跳变不产生微分冲击
    const err = vec(
      this.ratesTarget.x - rates.x,
      this.ratesTarget.y - rates.y,
      this.ratesTarget.z - rates.z,
    )
    this.torqueTarget = vec(
      this.rollRatePid.update(err.x, dt, rates.x),
      this.pitchRatePid.update(err.y, dt, rates.y),
      this.yawRatePid.update(err.z, dt, rates.z),
    )

    // ---------- controlTorque ----------
    const T = this.thrustTarget
    const tx = this.torqueTarget.x
    const ty = this.torqueTarget.y
    const tz = this.torqueTarget.z
    // 下标：0=RL 1=RR 2=FR 3=FL
    let rl = T - tx + ty - tz
    let rr = T + tx + ty + tz
    let fr = T + tx - ty - tz
    let fl = T - tx - ty + tz
    ;[fl, fr, rl, rr] = desaturate(fl, fr, rl, rr)
    this.motors[0] = clamp01(rl)
    this.motors[1] = clamp01(rr)
    this.motors[2] = clamp01(fr)
    this.motors[3] = clamp01(fl)
    return this.motors
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 固件 desaturate：超界时围绕均值等比压缩差分量，尽量保住总推力 */
function desaturate(fl: number, fr: number, rl: number, rr: number): [number, number, number, number] {
  const avg = (fl + fr + rl + rr) * 0.25
  const maxVal = Math.max(Math.max(fl, fr), Math.max(rl, rr))
  const minVal = Math.min(Math.min(fl, fr), Math.min(rl, rr))
  let scale = 1
  if (maxVal > 1 && maxVal > avg) scale = Math.min(scale, (1 - avg) / (maxVal - avg))
  if (minVal < 0 && avg > minVal) scale = Math.min(scale, avg / (avg - minVal))
  if (scale < 1) {
    fl = avg + (fl - avg) * scale
    fr = avg + (fr - avg) * scale
    rl = avg + (rl - avg) * scale
    rr = avg + (rr - avg) * scale
  }
  return [fl, fr, rl, rr]
}
