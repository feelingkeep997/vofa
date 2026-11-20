export type ProtocolId = 'firewater' | 'justfloat' | 'rawdata'

export interface Frame {
  values: number[]
  names?: string[]
}

export type FrameHandler = (frame: Frame) => void

export interface Parser {
  feed(bytes: Uint8Array): void
  reset(): void
}

export const PROTOCOLS: { id: ProtocolId; label: string; hint: string }[] = [
  { id: 'firewater', label: 'FireWater', hint: '文本流，如 "1.2,3.4,5.6\\n" 或 "ch0:1.2,ch1:3.4\\n"' },
  { id: 'justfloat', label: 'JustFloat', hint: '小端 float32 帧，帧尾 00 00 80 7F' },
  { id: 'rawdata', label: 'RawData', hint: '原始字节，仅十六进制监视，不绘波形' },
]

/* ------------------------------------------------------------------ */
/* FireWater：文本协议                                                  */
/* ------------------------------------------------------------------ */

function parseLine(line: string, onFrame: FrameHandler) {
  const s = line.trim()
  if (!s || s.startsWith('#') || s.startsWith('//')) return

  // ch0:1.23,ch1:4.56 —— 带通道名
  if (s.includes(':')) {
    const values: number[] = []
    const names: string[] = []
    for (const part of s.split(/[,;\t ]+/)) {
      if (!part) continue
      const sep = part.indexOf(':')
      if (sep <= 0) continue
      const key = part.slice(0, sep).trim()
      const num = Number(part.slice(sep + 1))
      if (!Number.isFinite(num)) continue
      names.push(key)
      values.push(num)
    }
    if (values.length) onFrame({ values, names })
    return
  }

  const values: number[] = []
  for (const part of s.split(/[,;\t ]+/)) {
    if (!part) continue
    const num = Number(part)
    if (Number.isFinite(num)) values.push(num)
  }
  if (values.length) onFrame({ values })
}

function createFireWater(onFrame: FrameHandler): Parser {
  const decoder = new TextDecoder()
  let buf = ''

  return {
    feed(bytes) {
      buf += decoder.decode(bytes, { stream: true })

      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        parseLine(line, onFrame)
        nl = buf.indexOf('\n')
      }

      // 兜底：没有换行的垃圾数据不允许无限膨胀
      if (buf.length > 64 * 1024) {
        const cut = buf.lastIndexOf(',')
        if (cut > 0) {
          buf = buf.slice(cut + 1)
        }
        if (buf.length > 256 * 1024) buf = ''
      }
    },
    reset() {
      buf = ''
      decoder.decode(new Uint8Array(0), { stream: false })
    },
  }
}

/* ------------------------------------------------------------------ */
/* JustFloat：小端 float32 + 帧尾 00 00 80 7F                           */
/* ------------------------------------------------------------------ */

const TAIL = [0x00, 0x00, 0x80, 0x7f]

function findTail(buf: Uint8Array, from: number, to: number): number {
  for (let i = from; i + 3 < to; i++) {
    if (
      buf[i] === TAIL[0] &&
      buf[i + 1] === TAIL[1] &&
      buf[i + 2] === TAIL[2] &&
      buf[i + 3] === TAIL[3]
    ) {
      return i
    }
  }
  return -1
}

function createJustFloat(onFrame: FrameHandler): Parser {
  let buf = new Uint8Array(1 << 16)
  let len = 0

  return {
    feed(bytes) {
      if (len + bytes.length > buf.length) {
        const next = new Uint8Array(Math.max(buf.length * 2, len + bytes.length))
        next.set(buf.subarray(0, len))
        buf = next
      }
      buf.set(bytes, len)
      len += bytes.length

      let start = 0
      for (;;) {
        const tail = findTail(buf, start, len)
        if (tail < 0) break
        const payload = tail - start
        if (payload > 0 && payload % 4 === 0) {
          const view = new DataView(buf.buffer, buf.byteOffset + start, payload)
          const n = payload >> 2
          const values = new Array<number>(n)
          for (let i = 0; i < n; i++) values[i] = view.getFloat32(i * 4, true)
          onFrame({ values })
        }
        start = tail + 4
      }

      if (start > 0) {
        buf.copyWithin(0, start, len)
        len -= start
      }
      if (len > 512 * 1024) len = 0
    },
    reset() {
      len = 0
    },
  }
}

/* ------------------------------------------------------------------ */
/* RawData：不解析不产帧，只做 HEX/文本监视（PROTOCOLS 里就是这么描述的） */
/* ------------------------------------------------------------------ */

function createRawData(): Parser {
  return { feed() {}, reset() {} }
}

export function createParser(id: ProtocolId, onFrame: FrameHandler): Parser {
  if (id === 'justfloat') return createJustFloat(onFrame)
  if (id === 'rawdata') return createRawData()
  return createFireWater(onFrame)
}

export function toHex(bytes: Uint8Array, limit = 4096): string {
  const n = Math.min(bytes.length, limit)
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(bytes[i].toString(16).padStart(2, '0').toUpperCase())
  return out.join(' ')
}

/**
 * 文本模式解析转义：\\ \r \n \t \0 \xNN
 * —— 预置命令里写的是 `AT+PING\r\n`，不解析就会把字面量 8 个字符发出去，
 *    按行解析的固件永远等不到回车换行（这就是"发了没反应"的经典坑）。
 */
function unescapeText(text: string): Uint8Array {
  const out: number[] = []
  const enc = new TextEncoder()
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== '\\') {
      const cp = text.codePointAt(i) ?? 0
      const ch = String.fromCodePoint(cp)
      for (const b of enc.encode(ch)) out.push(b)
      i += ch.length - 1
      continue
    }
    const n = text[i + 1]
    if (n === undefined) {
      out.push(0x5c)
      break
    }
    if (n === 'r') {
      out.push(0x0d)
      i++
    } else if (n === 'n') {
      out.push(0x0a)
      i++
    } else if (n === 't') {
      out.push(0x09)
      i++
    } else if (n === '0') {
      out.push(0x00)
      i++
    } else if (n === '\\') {
      out.push(0x5c)
      i++
    } else if (n === 'x') {
      const h = text.slice(i + 2, i + 4)
      if (/^[0-9a-fA-F]{2}$/.test(h)) {
        out.push(parseInt(h, 16))
        i += 3
      } else {
        out.push(0x5c)
      }
    } else {
      out.push(0x5c) // 不认识的转义原样保留
    }
  }
  return new Uint8Array(out)
}

export function parseSendText(text: string, hex: boolean): Uint8Array | null {
  if (!hex) return unescapeText(text)
  const clean = text.replace(/0x/gi, ' ').replace(/[^0-9a-fA-F]/g, '')
  if (clean.length % 2 !== 0) return null
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}
