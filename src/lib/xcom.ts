/**
 * XCOM V2.8 协议能力移植（逆向取证见 XCOM-NOTES.md）
 *
 * 依据：MySSCOM.CheckTransportProtocol 暴露的方法名
 *   xorChecksum / sumChecksum / crc8Checksum / crc16Checksum / calculateChecksum
 * 与 MySSCOM.TransportProtocol 的字段
 *   DeviceAddr / FunctionType / Sequence / DataLength / SbData / Checksum / ChecksumMethod
 * 以及内置说明原文：
 *   「此协议是从 modbus(rtu) 演变而来…支持校验和、异或、CRC8、CRC16 校验，
 *     CRC8 和 CRC16 均为查表的方式」
 *
 * 注意：方法体被 .NET Reactor NecroBit 抽空，多项式取的是业界标准值，
 *      不是从二进制里抠出来的。若对端是自家固件，请以固件为准核对。
 */

export type ChecksumMethod = 'sum' | 'xor' | 'crc8' | 'crc16'

export const CHECKSUM_METHODS: { id: ChecksumMethod; label: string; bytes: number; note: string }[] = [
  { id: 'sum', label: '校验和', bytes: 1, note: '逐字节累加取低 8 位' },
  { id: 'xor', label: '异或', bytes: 1, note: '逐字节异或' },
  { id: 'crc8', label: 'CRC8', bytes: 1, note: '查表，poly 0x07 / init 0x00' },
  { id: 'crc16', label: 'CRC16', bytes: 2, note: '查表，poly 0xA001 / init 0xFFFF，低字节在前' },
]

/* ------------------------------------------------------------------ */
/* 查表                                                               */
/* ------------------------------------------------------------------ */

function buildCrc8Table(poly: number): Uint8Array {
  const t = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 0x80 ? ((c << 1) ^ poly) & 0xff : (c << 1) & 0xff
    t[i] = c
  }
  return t
}

function buildCrc16Table(poly: number): Uint16Array {
  const t = new Uint16Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ poly : c >>> 1
    t[i] = c & 0xffff
  }
  return t
}

const CRC8_TABLE = buildCrc8Table(0x07)
const CRC16_TABLE = buildCrc16Table(0xa001)

/* ------------------------------------------------------------------ */
/* 四种校验                                                           */
/* ------------------------------------------------------------------ */

export function checksum(bytes: Uint8Array, method: ChecksumMethod): Uint8Array {
  switch (method) {
    case 'sum': {
      let s = 0
      for (const b of bytes) s = (s + b) & 0xff
      return new Uint8Array([s])
    }
    case 'xor': {
      let x = 0
      for (const b of bytes) x ^= b
      return new Uint8Array([x])
    }
    case 'crc8': {
      let crc = 0x00
      for (const b of bytes) crc = CRC8_TABLE[(crc ^ b) & 0xff]
      return new Uint8Array([crc])
    }
    case 'crc16': {
      let crc = 0xffff
      for (const b of bytes) crc = (crc >>> 8) ^ CRC16_TABLE[(crc ^ b) & 0xff]
      // modbus 惯例：低字节在前
      return new Uint8Array([crc & 0xff, (crc >>> 8) & 0xff])
    }
  }
}

export function checksumWidth(method: ChecksumMethod): number {
  return method === 'crc16' ? 2 : 1
}

/* ------------------------------------------------------------------ */
/* 帧结构                                                             */
/* ------------------------------------------------------------------ */

export interface FrameOpts {
  deviceAddr: number
  functionType: number
  sequence: number
  data: Uint8Array
  method: ChecksumMethod
}

/** [地址][功能码][序号][长度][数据…][校验] */
export function buildFrame(o: FrameOpts): Uint8Array {
  const head = new Uint8Array([o.deviceAddr & 0xff, o.functionType & 0xff, o.sequence & 0xff, o.data.length & 0xff])
  const body = new Uint8Array(head.length + o.data.length)
  body.set(head, 0)
  body.set(o.data, head.length)
  const cs = checksum(body, o.method)
  const out = new Uint8Array(body.length + cs.length)
  out.set(body, 0)
  out.set(cs, body.length)
  return out
}

export interface ParsedFrame {
  deviceAddr: number
  functionType: number
  sequence: number
  dataLength: number
  data: Uint8Array
  checksum: Uint8Array
  checksumOk: boolean
  raw: Uint8Array
}

export function parseFrame(bytes: Uint8Array, method: ChecksumMethod): ParsedFrame | null {
  const w = checksumWidth(method)
  if (bytes.length < 4 + w) return null
  const dataLength = bytes[3]
  if (bytes.length < 4 + dataLength + w) return null
  const body = bytes.subarray(0, 4 + dataLength)
  const got = bytes.subarray(4 + dataLength, 4 + dataLength + w)
  const want = checksum(body, method)
  let ok = got.length === want.length
  if (ok) for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) ok = false
  return {
    deviceAddr: bytes[0],
    functionType: bytes[1],
    sequence: bytes[2],
    dataLength,
    data: bytes.slice(4, 4 + dataLength),
    checksum: got.slice(),
    checksumOk: ok,
    raw: bytes.slice(),
  }
}

/* ------------------------------------------------------------------ */
/* HEX 解析：XCOM 的「字节自动拆分」                                    */
/* ------------------------------------------------------------------ */

/**
 * 原文：「加强了16进制发送的功能，自动拆分您发送的字节，不必每隔一个字节就输入空格」
 *      「修复16进制下发送框输入数据长度为奇数，切换普通字符串出错，改为倒数第二位补零」
 *
 * 所以：允许 "01030000000AC5CD" / "01 03 00 00 00 0A C5 CD" / "0x01,0x03" 混写；
 * 奇数个 hex 字符时在**倒数第二位**补 0（即 "ABC" → "A0BC"，不是 "ABC0"）。
 */
export function parseHexAuto(text: string): Uint8Array | null {
  const clean = text.replace(/0x/gi, ' ').replace(/[^0-9a-fA-F]/g, '')
  if (clean.length === 0) return new Uint8Array(0)
  let s = clean
  if (s.length % 2 !== 0) {
    // 倒数第二位补 0
    s = s.slice(0, s.length - 1) + '0' + s.slice(s.length - 1)
  }
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toHex(bytes: Uint8Array, sep = ' '): string {
  const out: string[] = []
  for (const b of bytes) out.push(b.toString(16).padStart(2, '0').toUpperCase())
  return out.join(sep)
}

/* ------------------------------------------------------------------ */
/* 编码                                                               */
/* ------------------------------------------------------------------ */

export const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'gbk', label: 'GBK/GB2312' },
  { id: 'gb18030', label: 'GB18030' },
  { id: 'utf-16le', label: 'UTF-16LE' },
  { id: 'utf-16be', label: 'UTF-16BE' },
  { id: 'ascii', label: 'ASCII' },
] as const

export type EncodingId = (typeof ENCODINGS)[number]['id']

export function decodeBytes(bytes: Uint8Array, enc: EncodingId): string {
  try {
    return new TextDecoder(enc, { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

export function encodeText(text: string, enc: EncodingId): Uint8Array {
  if (enc === 'utf-8' || enc === 'ascii') return new TextEncoder().encode(text)
  // 浏览器没有通用 encoder，GBK/UTF-16 用手工路径
  if (enc === 'utf-16le') {
    const out = new Uint8Array(text.length * 2)
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      out[i * 2] = c & 0xff
      out[i * 2 + 1] = (c >>> 8) & 0xff
    }
    return out
  }
  if (enc === 'utf-16be') {
    const out = new Uint8Array(text.length * 2)
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      out[i * 2] = (c >>> 8) & 0xff
      out[i * 2 + 1] = c & 0xff
    }
    return out
  }
  // GBK 无法在浏览器内编码，退回 UTF-8 并标记
  return new TextEncoder().encode(text)
}

/** GBK 系列浏览器不能 encode，单独标出来，UI 要提示 */
export function canEncode(enc: EncodingId): boolean {
  return enc !== 'gbk' && enc !== 'gb18030'
}

/* ------------------------------------------------------------------ */
/* 接收区按行断帧（XCOM：以 \r\n 断帧加时间戳）                         */
/* ------------------------------------------------------------------ */

export interface LineSplitter {
  feed(bytes: Uint8Array): string[]
  reset(): void
}

export function createLineSplitter(): LineSplitter {
  let buf = ''
  return {
    feed(bytes) {
      buf += new TextDecoder('utf-8', { fatal: false }).decode(bytes, { stream: true })
      const out: string[] = []
      let i = buf.indexOf('\n')
      while (i >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        out.push(line)
        i = buf.indexOf('\n')
      }
      if (buf.length > 64 * 1024) buf = ''
      return out
    },
    reset() {
      buf = ''
    },
  }
}

/* ------------------------------------------------------------------ */
/* 缓冲区上限（XCOM：200K / 500K / 1M / 2M / 3M / 5M）                  */
/* ------------------------------------------------------------------ */

export const BUFFER_LIMITS = [200 * 1024, 500 * 1024, 1024 * 1024, 2 * 1024 * 1024, 3 * 1024 * 1024, 5 * 1024 * 1024]

export function formatLimit(n: number): string {
  return n >= 1024 * 1024 ? `${n / 1024 / 1024}M` : `${n / 1024}K`
}
