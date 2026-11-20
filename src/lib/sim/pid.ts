/**
 * PID —— 1:1 移植 CF-Drone `Middlewares/pid.h`
 *
 * 关键行为（改了就对不起真机）：
 *   - 积分"本体"先按 ±windup/|i| 限幅，输出贡献再按 ±windup 限幅（双重抗饱和）；
 *   - 给 measurement 时切 D-on-measurement（只对测量值微分，setpoint 跳变不产生微分冲击）；
 *   - D 项经一阶低通（alpha=1 直通）；
 *   - dt 非法（<=0 或 >= dtMax）视为断流：清空 I/D，本帧只出 P。
 */

export interface PidGains {
  p: number
  i: number
  d: number
  /** 积分项限幅；0 = 完全关闭积分 */
  windup: number
  /** D 项低通系数，1 = 不过滤 */
  dAlpha: number
}

export class Pid {
  p: number
  i: number
  d: number
  windup: number
  dAlpha: number
  /** 单步允许的最大 dt（s），超过判定控制断流 */
  dtMax: number

  integral = 0
  derivative = 0
  /** 最近一帧三项各自的贡献，调参面板要显示 */
  termP = 0
  termI = 0
  termD = 0

  private prevError = NaN
  private prevMeasurement = NaN
  private lpfOut = 0
  private lpfInit = false
  /** 首帧标志：固件靠 prevTime=NaN 让首帧不进 I/D 分支，这里 dt 是外部喂的，得显式挡 */
  private started = false

  constructor(g: PidGains, dtMax = 0.1) {
    this.p = g.p
    this.i = g.i
    this.d = g.d
    this.windup = g.windup
    this.dAlpha = g.dAlpha
    this.dtMax = dtMax
  }

  setGains(g: PidGains) {
    this.p = g.p
    this.i = g.i
    this.d = g.d
    this.windup = g.windup
    this.dAlpha = g.dAlpha
  }

  reset() {
    this.prevError = NaN
    this.prevMeasurement = NaN
    this.integral = 0
    this.derivative = 0
    this.termP = 0
    this.termI = 0
    this.termD = 0
    this.lpfInit = false
    this.started = false
  }

  private lpf(input: number): number {
    if (this.dAlpha === 1) return input
    if (!this.lpfInit) {
      this.lpfOut = input
      this.lpfInit = true
    }
    this.lpfOut += this.dAlpha * (input - this.lpfOut)
    return this.lpfOut
  }

  /**
   * @param error       误差（单位随环节）
   * @param measurement 实测值（同单位同正方向）；省略 = D 对误差微分
   * @param dt          本步时间（s）
   */
  update(error: number, dt: number, measurement?: number): number {
    if (dt > 0 && dt < this.dtMax) {
      if (!this.started) {
        // 首帧：只出 P。否则 error - NaN 会把 D 项毒化成 NaN，再被 0 乘出来照样是 NaN
        this.integral = 0
        this.derivative = 0
      } else {
        this.integral += error * dt
        const limit = this.i !== 0 ? Math.abs(this.windup) / Math.abs(this.i) : 0
        this.integral = clampNum(this.integral, -limit, limit)

        const hasM = measurement !== undefined && Number.isFinite(measurement)
        let dInput: number
        if (hasM) {
          dInput = Number.isFinite(this.prevMeasurement) ? -(measurement! - this.prevMeasurement) : 0
        } else {
          dInput = error - this.prevError
        }
        this.derivative = this.lpf(dInput / dt)
      }
    } else {
      this.integral = 0
      this.derivative = 0
    }
    this.started = true

    this.prevError = error
    this.prevMeasurement = measurement === undefined ? NaN : measurement

    this.termP = this.p * error
    this.termI = clampNum(this.i * this.integral, -this.windup, this.windup)
    this.termD = this.d * this.derivative
    return this.termP + this.termI + this.termD
  }
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
