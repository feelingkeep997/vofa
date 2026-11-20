// 生成应用图标 vofa.ico（多尺寸，PNG 压缩条目）
// 纯 Node 实现：自己画波形 + 手搓 PNG + ICO 封装，不引第三方库
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const OUT = process.argv[2] ?? 'build/vofa.ico'

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/* ---------------- 画图 ---------------- */
const WAVE = [
  [4, 20],
  [9, 20],
  [12, 8],
  [16, 26],
  [20, 14],
  [23, 20],
  [28, 20],
]

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function render(size) {
  const SS = 4 // 4x 超采样
  const px = Buffer.alloc(size * size * 4)
  const unit = size / 32
  const halfStroke = Math.max(0.9, 1.15 * unit)
  const radius = size * 0.22

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0
      let fgHits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS
          const fy = y + (sy + 0.5) / SS
          // 圆角矩形
          const cx = Math.max(radius, Math.min(size - radius, fx))
          const cy = Math.max(radius, Math.min(size - radius, fy))
          const inside = Math.hypot(fx - cx, fy - cy) <= radius
          if (!inside) continue
          bgHits++
          // 波形
          let d = Infinity
          for (let i = 0; i < WAVE.length - 1; i++) {
            const d2 = distToSegment(
              fx / unit,
              fy / unit,
              WAVE[i][0],
              WAVE[i][1],
              WAVE[i + 1][0],
              WAVE[i + 1][1],
            )
            if (d2 < d) d = d2
          }
          if (d * unit <= halfStroke) fgHits++
        }
      }
      const total = SS * SS
      const a = bgHits / total
      const fg = fgHits / total
      const o = (y * size + x) * 4
      // 底色 #0d1117 → 波形 #22d3ee
      const bg = [13, 17, 23]
      const line = [34, 211, 238]
      const mix = (c1, c2, t) => Math.round(c1 + (c2 - c1) * t)
      const fgRatio = a > 0 ? Math.min(1, fg / Math.max(a, 1e-6)) : 0
      px[o] = mix(bg[0], line[0], fgRatio)
      px[o + 1] = mix(bg[1], line[1], fgRatio)
      px[o + 2] = mix(bg[2], line[2], fgRatio)
      px[o + 3] = Math.round(a * 255)
    }
  }
  return px
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const px = render(size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------------- ICO 封装 ---------------- */
const sizes = [256, 128, 64, 48, 32, 16]
const images = sizes.map((s) => ({ size: s, data: png(s) }))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)

const dirSize = 16 * images.length
let offset = 6 + dirSize
const entries = []
for (const img of images) {
  const e = Buffer.alloc(16)
  e[0] = img.size >= 256 ? 0 : img.size
  e[1] = img.size >= 256 ? 0 : img.size
  e[2] = 0
  e[3] = 0
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(img.data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += img.data.length
  entries.push(e)
}

const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, ico)
console.log(`icon → ${OUT} (${(ico.length / 1024).toFixed(1)} KB, ${sizes.join('/')})`)
