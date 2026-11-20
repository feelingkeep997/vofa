/**
 * 协议传输引擎（XCOM「协议传输」的 Send-Ack 半双工模型）
 *
 * 逆向依据：
 *   ManageTransportProtocol 暴露 SendSequence / RecieveSequence / RetryCount /
 *   IsCompleteRetry / IsAbortSend / SendTaskResult / CurrentSendTaskType；
 *   内置说明原文「半双工传输的 Send-Ack 模式…可配置重发次数、重发间隔（即帧周期）」
 *
 * 行为：发一帧 → 等回包（序号匹配即 ACK）→ 超时则按帧周期重发，最多 retry 次。
 */
import { buildFrame, checksumWidth, parseFrame, type ChecksumMethod, type ParsedFrame } from './xcom'

export interface ProtoConfig {
  deviceAddr: number
  functionType: number
  method: ChecksumMethod
  /** 额外重发次数（0 = 不重发） */
  retry: number
  /** 帧周期 / 单次等待超时，ms */
  periodMs: number
  /** ACK 帧的序号是原序号还是原序号+1 */
  ackSeqMode: 'same' | 'plus1'
}

export type ProtoEvent =
  | { kind: 'tx'; seq: number; attempt: number; frame: Uint8Array }
  | { kind: 'ack'; seq: number; attempts: number; frame: ParsedFrame }
  | { kind: 'timeout'; seq: number; attempts: number }
  | { kind: 'rx'; frame: ParsedFrame }

export interface SendResult {
  ok: boolean
  seq: number
  attempts: number
}

export class ProtoEngine {
  cfg: ProtoConfig = {
    deviceAddr: 0x01,
    functionType: 0x03,
    method: 'crc16',
    retry: 3,
    periodMs: 200,
    ackSeqMode: 'same',
  }

  onEvent: (e: ProtoEvent) => void = () => {}
  write: (b: Uint8Array) => Promise<void> = async () => {}

  private seq = 0
  private buf = new Uint8Array(0)
  private pending: { seq: number; resolve: (f: ParsedFrame) => void } | null = null

  get nextSeq() {
    return this.seq
  }

  reset() {
    this.seq = 0
    this.buf = new Uint8Array(0)
    this.pending = null
  }

  /** 发一帧并等 ACK；返回是否成功与重发次数 */
  async send(data: Uint8Array): Promise<SendResult> {
    const seq = this.seq
    this.seq = (this.seq + 1) & 0xff
    const frame = buildFrame({
      deviceAddr: this.cfg.deviceAddr,
      functionType: this.cfg.functionType,
      sequence: seq,
      data,
      method: this.cfg.method,
    })

    let attempts = 0
    for (let i = 0; i <= Math.max(0, this.cfg.retry); i++) {
      attempts++
      await this.write(frame)
      this.onEvent({ kind: 'tx', seq, attempt: attempts, frame })
      const ack = await this.waitAck(seq)
      if (ack) {
        this.onEvent({ kind: 'ack', seq, attempts, frame: ack })
        return { ok: true, seq, attempts }
      }
    }
    this.onEvent({ kind: 'timeout', seq, attempts })
    return { ok: false, seq, attempts }
  }

  private waitAck(seq: number): Promise<ParsedFrame | null> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending = null
        resolve(null)
      }, Math.max(10, this.cfg.periodMs))
      this.pending = {
        seq,
        resolve: (f) => {
          window.clearTimeout(timer)
          this.pending = null
          resolve(f)
        },
      }
    })
  }

  /** 把串口收到的原始字节喂进来，按帧长切分 */
  feed(bytes: Uint8Array) {
    const merged = new Uint8Array(this.buf.length + bytes.length)
    merged.set(this.buf, 0)
    merged.set(bytes, this.buf.length)
    this.buf = merged

    const w = checksumWidth(this.cfg.method)
    for (;;) {
      if (this.buf.length < 4 + w) break
      const dataLen = this.buf[3]
      /* 长度字段不可信时丢一个字节重同步，避免卡死 */
      if (dataLen > 250) {
        this.buf = this.buf.subarray(1)
        continue
      }
      const total = 4 + dataLen + w
      if (this.buf.length < total) break
      const frameBytes = this.buf.slice(0, total)
      this.buf = this.buf.subarray(total)
      const parsed = parseFrame(frameBytes, this.cfg.method)
      if (!parsed) continue
      this.onEvent({ kind: 'rx', frame: parsed })
      const want = this.cfg.ackSeqMode === 'plus1' ? (this.pending ? (this.pending.seq + 1) & 0xff : -1) : this.pending?.seq
      // 校验错的帧不能当 ACK，否则串口误码会被记成"传输成功"
      if (this.pending && parsed.checksumOk && parsed.sequence === want) this.pending.resolve(parsed)
    }
    if (this.buf.length > 4096) this.buf = new Uint8Array(0)
  }
}
