/**
 * 环形缓冲：每个通道一条独立的 (t, v) 时间序列。
 * 定长 Float32Array，写满后覆盖最老的点 —— 长时间跑不爆内存。
 */
export interface Series {
  t: Float32Array
  v: Float32Array
  head: number
  count: number
}

export class DataStore {
  readonly cap: number
  series: Series[] = []
  total = 0
  lastT = 0
  version = 0

  constructor(cap = 120_000) {
    this.cap = cap
  }

  private ensure(n: number) {
    while (this.series.length < n) {
      this.series.push({
        t: new Float32Array(this.cap),
        v: new Float32Array(this.cap),
        head: 0,
        count: 0,
      })
    }
  }

  push(t: number, values: number[]) {
    this.ensure(values.length)
    for (let i = 0; i < values.length; i++) {
      const s = this.series[i]
      s.t[s.head] = t
      s.v[s.head] = values[i]
      s.head = (s.head + 1) % this.cap
      if (s.count < this.cap) s.count++
    }
    this.lastT = t
    this.total++
    this.version++
  }

  clear() {
    for (const s of this.series) {
      s.head = 0
      s.count = 0
    }
    this.total = 0
    this.version++
  }

  /** 逻辑索引 k（0 = 最老）→ 物理下标 */
  phys(s: Series, k: number) {
    return (s.head - s.count + k + this.cap * 2) % this.cap
  }

  /** 首个时间 >= t0 的逻辑索引（序列按时间递增） */
  lowerBound(s: Series, t0: number) {
    let lo = 0
    let hi = s.count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (s.t[this.phys(s, mid)] < t0) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** 可见窗口内的统计值 */
  stats(s: Series, from: number, to: number) {
    let min = Infinity
    let max = -Infinity
    let sum = 0
    let n = 0
    const start = this.lowerBound(s, from)
    for (let k = start; k < s.count; k++) {
      const p = this.phys(s, k)
      const t = s.t[p]
      if (t > to) break
      const v = s.v[p]
      if (v < min) min = v
      if (v > max) max = v
      sum += v
      n++
    }
    if (!n) return null
    return { min, max, avg: sum / n, last: s.v[this.phys(s, s.count - 1)] }
  }
}
