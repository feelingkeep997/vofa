/**
 * 仿真引擎 —— 把飞控链和机体模型接成闭环，并提供两种驱动方式：
 *   1) 实时步进（rAF 调用 tick，按真实时间推进，用来手动打杆看姿态）
 *   2) 离线阶跃测试（固定步长一次跑完，算上升时间/超调/调节时间/稳态误差）
 *
 * 阶跃测试用独立实例，不动实时状态，测完可以直接看曲线对比。
 */

import { type Quat, type Vec3, vec, qToEuler, RAD, DEG } from './quat'
import { type PlantState, type PlantParams, createPlant, stepPlant, hoverThrottle, thrustToWeight, readSensors, motorsActive } from './plant'
import { AttitudeEstimator } from './estimate'
import { FlightController, type FlightMode, type Sticks } from './fc'
import type { SimParams } from './params'

export interface SimSample {
  t: number
  /** 实测姿态角（deg） */
  roll: number
  pitch: number
  yaw: number
  /** 目标姿态角（deg） */
  rollT: number
  pitchT: number
  yawT: number
  /** 实测角速率（deg/s，机体系） */
  rx: number
  ry: number
  rz: number
  /** 目标角速率（deg/s） */
  rxT: number
  ryT: number
  rzT: number
  /** 4 路电机指令（RL/RR/FR/FL） */
  m0: number
  m1: number
  m2: number
  m3: number
  /** 归一化总油门 */
  thr: number
  /** 飞控估计出来的姿态角（deg）—— 跟实测值对照就能看出估计漂了多少 */
  rollEst: number
  pitchEst: number
  yawEst: number
}

/**
 * 确定性伪随机（LCG）—— 同一组参数必须跑出同一条曲线，
 * 用 Math.random() 的话每次结果都不一样，调参就没法对比了。
 */
function makeNoise(seed = 20261023) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s / 0x7fffffff) * 2 - 1
  }
}

const EMPTY_SAMPLE: SimSample = {
  t: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  rollT: 0,
  pitchT: 0,
  yawT: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  rxT: 0,
  ryT: 0,
  rzT: 0,
  m0: 0,
  m1: 0,
  m2: 0,
  m3: 0,
  thr: 0,
  rollEst: 0,
  pitchEst: 0,
  yawEst: 0,
}

function makeSample(
  t: number,
  attitude: Quat,
  target: Quat,
  rates: Vec3,
  ratesTarget: Vec3,
  motors: readonly number[],
  thr: number,
  estEuler: Vec3,
): SimSample {
  const e = qToEuler(attitude)
  // ACRO 模式的目标姿态被 invalidate 成 NaN，这时候目标曲线直接跟实测重合
  const targetValid = Number.isFinite(target.w)
  const te = targetValid ? qToEuler(target) : e
  return {
    t,
    roll: e.x * RAD,
    pitch: e.y * RAD,
    yaw: e.z * RAD,
    rollT: te.x * RAD,
    pitchT: te.y * RAD,
    yawT: te.z * RAD,
    rx: rates.x * RAD,
    ry: rates.y * RAD,
    rz: rates.z * RAD,
    rxT: ratesTarget.x * RAD,
    ryT: ratesTarget.y * RAD,
    rzT: ratesTarget.z * RAD,
    m0: motors[0],
    m1: motors[1],
    m2: motors[2],
    m3: motors[3],
    thr,
    rollEst: estEuler.x * RAD,
    pitchEst: estEuler.y * RAD,
    yawEst: estEuler.z * RAD,
  }
}

/** 从参数集里取传感器标定量 */
function calibOf(p: SimParams) {
  return {
    gyroBias: vec(p.gyroBiasX, p.gyroBiasY, p.gyroBiasZ),
    gyroNoise: p.gyroNoise,
    accBias: vec(p.accBiasX, p.accBiasY, p.accBiasZ),
    accScale: vec(p.accScaleX, p.accScaleY, p.accScaleZ),
    accNoise: p.accNoise,
  }
}

/** 定长环形缓冲，超了覆盖最老的一条 */
class Ring {
  private buf: SimSample[] = []
  private head = 0
  private count = 0
  constructor(private cap: number) {}

  push(s: SimSample) {
    if (this.count < this.cap) {
      this.buf.push(s)
      this.count++
    } else {
      this.buf[this.head] = s
      this.head = (this.head + 1) % this.cap
    }
  }

  clear() {
    this.buf = []
    this.head = 0
    this.count = 0
  }

  toArray(): SimSample[] {
    if (this.count < this.cap) return this.buf.slice()
    return this.buf.slice(this.head).concat(this.buf.slice(0, this.head))
  }

  get size() {
    return this.count
  }
}

export class SimEngine {
  params: SimParams
  plant: PlantState = createPlant()
  /** 飞控内部的姿态估计 —— 控制器只用它，不用真值 */
  estimator = new AttitudeEstimator()
  fc: FlightController
  mode: FlightMode = 'STAB'
  sticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 }

  /** 仿真时间（s） */
  time = 0
  /** 记录频率相对控制频率的抽点倍数 */
  sampleDiv = 5

  private ring = new Ring(4000)
  private stepAcc = 0
  private sampleAcc = 0
  private running = false
  private noise = makeNoise()

  constructor(params: SimParams) {
    this.params = params
    this.fc = new FlightController(params)
    this.reset()
  }

  /** 重置到悬停：姿态水平、电机转速到悬停值、PID 状态清空 */
  reset() {
    const hover = hoverThrottle(this.plantParams())
    this.plant = createPlant()
    this.plant.motors = [hover, hover, hover, hover]
    this.plant.cmd = [hover, hover, hover, hover]
    this.estimator.reset(this.plant.q)
    this.fc.reset(this.plant.q)
    this.fc.thrustTarget = hover
    this.time = 0
    this.ring.clear()
    this.stepAcc = 0
    this.sampleAcc = 0
  }

  plantParams(): PlantParams {
    const p = this.params
    return {
      mass: p.mass,
      wheelbase: p.wheelbase,
      ixx: p.ixx,
      iyy: p.iyy,
      izz: p.izz,
      thrustMax: p.thrustMax,
      motorTau: p.motorTau,
      torqueRatio: p.torqueRatio,
      aeroDamp: p.aeroDamp,
    }
  }

  get hoverThrottle(): number {
    return hoverThrottle(this.plantParams())
  }

  get thrustToWeight(): number {
    return thrustToWeight(this.plantParams())
  }

  /** 当前采样序列（时间正序） */
  samples(): SimSample[] {
    return this.ring.toArray()
  }

  clearTrace() {
    this.ring.clear()
  }

  /** 手动推进一步（dt 秒），供离线调用 */
  stepOnce(dt: number): void {
    const p = this.params
    const sub = Math.max(1, Math.round(p.subSteps))
    const subDt = dt / sub
    this.fc.mode = this.mode
    // 1) 传感器：真值 + 零偏 + 噪声
    const sensor = readSensors(this.plant, calibOf(p), this.noise)
    // 2) 姿态估计：飞控只信这个，漂了就是漂了
    this.estimator.step(sensor.gyro, sensor.acc, motorsActive(this.plant), this.sticks, dt, p)
    // 3) 控制器拿估计值算（跟真机一样，飞控拿不到真值）
    const cmd = this.fc.step(p, this.estimator.attitude, this.estimator.rates, this.sticks, dt)
    for (let i = 0; i < sub; i++) stepPlant(this.plant, this.plantParams(), cmd, subDt)
    this.time += dt
  }

  /**
   * 实时推进：喂进真实经过的毫秒数，内部按固定控制周期切分。
   * @param elapsedMs 距离上次调用经过的真实时间（ms）
   */
  tick(elapsedMs: number): void {
    const p = this.params
    const ctrlDt = 1 / Math.max(50, p.controlHz)
    // 卡顿时最多补 60ms，避免一次跑几千步把页面卡死
    this.stepAcc += Math.min(elapsedMs / 1000, 0.06)
    let guard = 0
    while (this.stepAcc >= ctrlDt && guard < 4000) {
      this.stepOnce(ctrlDt)
      this.stepAcc -= ctrlDt
      this.sampleAcc++
      if (this.sampleAcc >= Math.max(1, Math.round(this.sampleDiv))) {
        this.sampleAcc = 0
        this.record()
      }
      guard++
    }
    if (guard >= 4000) this.stepAcc = 0
  }

  private record() {
    this.ring.push(
      makeSample(
        this.time,
        this.plant.q,
        this.fc.attitudeTarget,
        this.plant.omega,
        this.fc.ratesTarget,
        this.fc.motors,
        this.fc.thrustTarget,
        this.estimator.euler(),
      ),
    )
  }

  /** 手动打杆时调用，把杆量写进控制器 */
  setSticks(s: Partial<Sticks>) {
    this.sticks = { ...this.sticks, ...s }
  }

  /** 是否在跑 */
  get isRunning() {
    return this.running
  }
  setRunning(v: boolean) {
    this.running = v
  }
}

/* ==================== 阶跃测试 ==================== */

export interface StepMetrics {
  axis: 'roll' | 'pitch' | 'yaw'
  amp: number
  /** 上升时间 10%→90%（s），没到 90% 则为 undefined */
  riseTime?: number
  /** 超调百分比（0 = 无超调） */
  overshoot: number
  /** 调节时间（进 ±2% 带且不再出，s）；一直没进带则为 undefined */
  settlingTime?: number
  /** 稳态误差（deg，带符号） */
  steadyError: number
  /** 峰值（deg） */
  peak: number
  /** 穿越目标线次数（振荡程度） */
  oscillations: number
  /** 是否发散/异常 */
  unstable: boolean
  /** 全过程轨迹（1kHz 采样） */
  trace: SimSample[]
  /** 测试时长 */
  duration: number
}

/**
 * 跑一次阶跃响应。全程离线，毫秒级出结果。
 * @param params 参数集（会按当前值拷贝，不修改入参）
 * @param axis   施加阶跃的轴
 * @param ampDeg 阶跃幅度（度，可负）
 * @param duration 记录时长（s）
 * @param preRoll  阶跃前预稳时间（s）
 */
export function runStepTest(
  params: SimParams,
  axis: 'roll' | 'pitch' | 'yaw',
  ampDeg: number,
  duration = 3,
  preRoll = 0.6,
): StepMetrics {
  const p = { ...params }
  const plant = createPlant()
  const fc = new FlightController(p)
  const est = new AttitudeEstimator()
  est.reset(plant.q)
  fc.mode = 'STAB'

  const pp = plantParamsOf(p)
  const hover = hoverThrottle(pp)
  plant.motors = [hover, hover, hover, hover]
  plant.cmd = [hover, hover, hover, hover]
  fc.reset(plant.q)
  fc.thrustTarget = hover

  const ctrlDt = 1 / Math.max(50, p.controlHz)
  const sub = Math.max(1, Math.round(p.subSteps))
  const subDt = ctrlDt / sub
  const sticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: (hover - p.motThrMin) / (p.motThrMax - p.motThrMin) * 0.95 + 0.05 }
  sticks.throttle = Math.max(0.06, Math.min(1, sticks.throttle))

  const ampRad = ampDeg * DEG
  const target: Vec3 = vec(
    axis === 'roll' ? ampRad : 0,
    axis === 'pitch' ? ampRad : 0,
    axis === 'yaw' ? ampRad : 0,
  )

  const trace: SimSample[] = []
  let t = 0
  let unstable = false
  const noise = makeNoise()
  const calib = calibOf(p)

  // ---- 预稳：先让控制器把姿态压在水平 ----
  fc.targetOverride = vec()
  const preSteps = Math.round(preRoll / ctrlDt)
  for (let i = 0; i < preSteps; i++) {
    const sensor = readSensors(plant, calib, noise)
    est.step(sensor.gyro, sensor.acc, motorsActive(plant), sticks, ctrlDt, p)
    const cmd = fc.step(p, est.attitude, est.rates, sticks, ctrlDt)
    for (let k = 0; k < sub; k++) stepPlant(plant, pp, cmd, subDt)
    t += ctrlDt
  }

  // ---- 施加阶跃 ----
  fc.targetOverride = target
  const totalSteps = Math.round(duration / ctrlDt)
  for (let i = 0; i < totalSteps; i++) {
    const sensor = readSensors(plant, calib, noise)
    est.step(sensor.gyro, sensor.acc, motorsActive(plant), sticks, ctrlDt, p)
    const cmd = fc.step(p, est.attitude, est.rates, sticks, ctrlDt)
    for (let k = 0; k < sub; k++) stepPlant(plant, pp, cmd, subDt)
    t += ctrlDt
    trace.push(
      makeSample(t, plant.q, fc.attitudeTarget, plant.omega, fc.ratesTarget, fc.motors, fc.thrustTarget, est.euler()),
    )
    const e = qToEuler(plant.q)
    const v = axis === 'roll' ? e.x : axis === 'pitch' ? e.y : e.z
    if (!Number.isFinite(v) || Math.abs(v) > Math.abs(ampRad) * 6 + 1) {
      unstable = true
      break
    }
  }

  return analyze(trace, axis, ampDeg, duration, unstable)
}

function plantParamsOf(p: SimParams): PlantParams {
  return {
    mass: p.mass,
    wheelbase: p.wheelbase,
    ixx: p.ixx,
    iyy: p.iyy,
    izz: p.izz,
    thrustMax: p.thrustMax,
    motorTau: p.motorTau,
    torqueRatio: p.torqueRatio,
    aeroDamp: p.aeroDamp,
  }
}

function analyze(
  trace: SimSample[],
  axis: 'roll' | 'pitch' | 'yaw',
  ampDeg: number,
  duration: number,
  unstable: boolean,
): StepMetrics {
  const pick = (s: SimSample) => (axis === 'roll' ? s.roll : axis === 'pitch' ? s.pitch : s.yaw)
  const ts = trace.map((s) => s.t)
  const ys = trace.map(pick)

  if (!ys.length || Math.abs(ampDeg) < 1e-6) {
    return {
      axis,
      amp: ampDeg,
      overshoot: 0,
      steadyError: 0,
      peak: 0,
      oscillations: 0,
      unstable: true,
      trace,
      duration,
    }
  }

  const sign = Math.sign(ampDeg) || 1
  const mag = Math.abs(ampDeg)
  // 归一化响应：1 = 精确到位
  const norm = ys.map((y) => (y * sign) / mag)

  let t10 = NaN
  let t90 = NaN
  for (let i = 0; i < norm.length; i++) {
    if (Number.isNaN(t10) && norm[i] >= 0.1) t10 = ts[i]
    if (Number.isNaN(t90) && norm[i] >= 0.9) {
      t90 = ts[i]
      break
    }
  }

  let peakNorm = -Infinity
  for (const v of norm) if (v > peakNorm) peakNorm = v
  const peak = peakNorm * mag * sign
  const overshoot = Math.max(0, (peakNorm - 1) * 100)

  const tailStart = Math.max(0, Math.floor(norm.length * 0.92))
  let sum = 0
  for (let i = tailStart; i < norm.length; i++) sum += norm[i]
  const steadyNorm = sum / Math.max(1, norm.length - tailStart)
  const steadyError = (steadyNorm - 1) * mag * sign

  let lastOut = -1
  for (let i = 0; i < norm.length; i++) {
    if (Math.abs(norm[i] - 1) > 0.02) lastOut = i
  }
  const settlingTime = lastOut >= 0 && lastOut < norm.length - 1 ? ts[lastOut] : undefined

  let oscillations = 0
  for (let i = 1; i < norm.length; i++) {
    if ((norm[i - 1] - 1) * (norm[i] - 1) < 0) oscillations++
  }

  return {
    axis,
    amp: ampDeg,
    riseTime: Number.isNaN(t10) || Number.isNaN(t90) ? undefined : t90 - t10,
    overshoot,
    settlingTime,
    steadyError,
    peak,
    oscillations,
    unstable,
    trace,
    duration,
  }
}

/** 空采样，给初始状态用 */
export function emptySample(): SimSample {
  return { ...EMPTY_SAMPLE }
}
