/**
 * Web Serial 封装。仅 Chrome / Edge (及基于 Chromium 的浏览器) 支持。
 */

type SerialPortLike = {
  open: (opts: Record<string, unknown>) => Promise<void>
  close: () => Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  getInfo: () => { usbVendorId?: number; usbProductId?: number }
}

type SerialLike = {
  requestPort: (opts?: Record<string, unknown>) => Promise<SerialPortLike>
  getPorts: () => Promise<SerialPortLike[]>
}

function getSerial(): SerialLike | null {
  const nav = navigator as unknown as { serial?: SerialLike }
  return nav.serial ?? null
}

export function serialSupported(): boolean {
  return getSerial() !== null
}

export interface PortInfo {
  index: number
  label: string
  vid?: number
  pid?: number
}

/** XCOM 的串口参数面板：4 种数据位 / 3 种停止位 / 奇偶无校验 */
export interface SerialOptions {
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd'
  flowControl?: 'none' | 'hardware'
}

const STOP_MAP: Record<string, 'one' | 'one-and-a-half' | 'two'> = {
  '1': 'one',
  '1.5': 'one-and-a-half',
  '2': 'two',
}

export class SerialLink {
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private closing = false

  /** 实际生效的参数（浏览器可能降级） */
  effective: SerialOptions | null = null
  /** 参数被降级时的说明 */
  degradedNote = ''

  onData: (bytes: Uint8Array) => void = () => {}
  onClose: (reason: string) => void = () => {}
  onError: (msg: string) => void = () => {}

  get connected() {
    return this.port !== null
  }

  async listPorts(): Promise<PortInfo[]> {
    const serial = getSerial()
    if (!serial) return []
    try {
      const ports = await serial.getPorts()
      return ports.map((p, i) => {
        const info = p.getInfo()
        const vid = info.usbVendorId
        const pid = info.usbProductId
        const hex = (n?: number) => (n === undefined ? '????' : n.toString(16).toUpperCase().padStart(4, '0'))
        return {
          index: i,
          label: vid === undefined ? `串口 #${i + 1}` : `USB VID:${hex(vid)} PID:${hex(pid)}`,
          vid,
          pid,
        }
      })
    } catch {
      return []
    }
  }

  async connect(opts: number | SerialOptions, portIndex?: number): Promise<void> {
    const serial = getSerial()
    if (!serial) throw new Error('当前浏览器不支持 Web Serial，请用 Chrome / Edge 打开 localhost')

    const o: SerialOptions = typeof opts === 'number' ? { baudRate: opts } : opts

    let port: SerialPortLike
    if (portIndex !== undefined) {
      const ports = await serial.getPorts()
      if (!ports[portIndex]) throw new Error('端口已失效，请重新选择')
      port = ports[portIndex]
    } else {
      port = await serial.requestPort({})
    }

    const full = {
      baudRate: o.baudRate,
      dataBits: o.dataBits ?? 8,
      stopBits: STOP_MAP[String(o.stopBits ?? 1)],
      parity: o.parity ?? 'none',
      bufferSize: 1 << 16,
      flowControl: o.flowControl ?? 'none',
    }

    this.degradedNote = ''
    try {
      await port.open(full as Record<string, unknown>)
      this.effective = { ...o }
    } catch (err) {
      /* Chromium 只稳定支持 8N1 + 7 数据位；其余组合会抛，这里退回并如实告知 */
      this.degradedNote = `浏览器不接受 ${full.dataBits}${full.parity[0].toUpperCase()}${String(o.stopBits ?? 1)}，已退回 8N1`
      await port.open({
        baudRate: o.baudRate,
        dataBits: 8,
        stopBits: 'one',
        parity: 'none',
        bufferSize: 1 << 16,
        flowControl: 'none',
      } as Record<string, unknown>)
      this.effective = { baudRate: o.baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }
      if (!(err instanceof Error)) this.degradedNote += '（未知原因）'
    }

    this.port = port
    this.closing = false
    this.writer = port.writable?.getWriter() ?? null
    void this.readLoop(port)
  }

  /** DTR / RTS 电平控制（XCOM 的 ckbDTR / ckbRTS） */
  async setSignals(dtr: boolean, rts: boolean): Promise<void> {
    const p = this.port as unknown as {
      setSignals?: (s: { dataTerminalReady?: boolean; requestToSend?: boolean }) => Promise<void>
    } | null
    if (!p?.setSignals) throw new Error('当前浏览器不支持 DTR/RTS 控制')
    await p.setSignals({ dataTerminalReady: dtr, requestToSend: rts })
  }

  private async readLoop(port: SerialPortLike) {
    while (this.port === port && port.readable) {
      const reader = port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value && value.length) this.onData(value)
        }
      } catch (err) {
        if (!this.closing) {
          this.onError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        try {
          reader.releaseLock()
        } catch {
          /* ignore */
        }
        this.reader = null
      }
      if (this.closing) break
      // 设备掉线，稍等再试；port 已关闭时退出
      await new Promise((r) => setTimeout(r, 100))
      if (!port.readable) break
    }
    if (!this.closing) {
      this.port = null
      this.onClose('设备已断开')
    }
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('串口未打开')
    await this.writer.write(bytes)
  }

  /**
   * 分块发送（XCOM「发送文件」：每 1024 字节可设延时，随时中止）
   * @returns 实际发出的字节数
   */
  async sendChunked(
    bytes: Uint8Array,
    opts: { chunk?: number; delayMs?: number; onProgress?: (sent: number) => void; aborted?: () => boolean } = {},
  ): Promise<number> {
    const chunk = Math.max(1, opts.chunk ?? 1024)
    const delay = Math.max(0, opts.delayMs ?? 10)
    let sent = 0
    for (let off = 0; off < bytes.length; off += chunk) {
      if (opts.aborted?.()) break
      const slice = bytes.subarray(off, Math.min(off + chunk, bytes.length))
      await this.send(slice)
      sent += slice.length
      opts.onProgress?.(sent)
      if (delay > 0 && off + chunk < bytes.length) await new Promise((r) => setTimeout(r, delay))
    }
    return sent
  }

  async disconnect(): Promise<void> {
    this.closing = true
    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock()
    } catch {
      /* ignore */
    }
    this.writer = null
    try {
      await this.port?.close()
    } catch {
      /* ignore */
    }
    this.port = null
  }
}
