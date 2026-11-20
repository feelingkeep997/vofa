import type { ProtocolId } from './protocol'

/**
 * 内置信号发生器：没有硬件也能看波形。
 * 输出的是「真实协议字节流」，所以会完整走一遍解析链路。
 */

export interface DemoOptions {
  protocol: ProtocolId
  hz: number
  onBytes: (bytes: Uint8Array) => void
}

const TAIL = new Uint8Array([0x00, 0x00, 0x80, 0x7f])

function sample(t: number): number[] {
  const noise = () => (Math.random() - 0.5) * 0.25
  // 0.5~2Hz 慢扫频，频谱图上能看见峰在爬
  const sweepHz = 0.5 + 1.5 * ((t % 8) / 8)
  const sweep = Math.sin(2 * Math.PI * sweepHz * t) * 1.4
  return [
    Math.sin(2 * Math.PI * 1.0 * t) * 2.0 + noise(),
    Math.sign(Math.sin(2 * Math.PI * 0.4 * t)) * 1.2 + noise(),
    Math.sin(2 * Math.PI * 2.7 * t) * 0.6 + Math.sin(2 * Math.PI * 0.13 * t) * 0.9,
    sweep + noise(),
  ]
}

export function startDemo(opts: DemoOptions): () => void {
  const { protocol, hz, onBytes } = opts
  const period = 1000 / hz
  const start = performance.now()
  const names = ['sin_1Hz', 'square_0.4Hz', 'mixed', 'sweep']

  const timer = window.setInterval(() => {
    const t = (performance.now() - start) / 1000
    const values = sample(t)

    if (protocol === 'justfloat') {
      const buf = new Uint8Array(values.length * 4 + 4)
      const view = new DataView(buf.buffer)
      values.forEach((v, i) => view.setFloat32(i * 4, v, true))
      buf.set(TAIL, values.length * 4)
      onBytes(buf)
      return
    }

    if (protocol === 'rawdata') {
      const text = values.map((v) => v.toFixed(3)).join(',') + '\r\n'
      onBytes(new TextEncoder().encode(text))
      return
    }

    const line = values.map((v, i) => `${names[i]}:${v.toFixed(4)}`).join(',') + '\n'
    onBytes(new TextEncoder().encode(line))
  }, period)

  return () => window.clearInterval(timer)
}
