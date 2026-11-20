import { useEffect, useRef } from 'react'
import type { ThemeTokens } from '../lib/theme'
import { sgrToCss } from '../lib/theme'
import { BUFFER_LIMITS, ENCODINGS, canEncode, decodeBytes, formatLimit, toHex, type EncodingId } from '../lib/xcom'

export type TextDir = 'rx' | 'tx' | 'sys'

export interface TextItem {
  dir: TextDir
  text: string
  t: number
  bytes?: Uint8Array
}

interface Props {
  items: TextItem[]
  theme: ThemeTokens
  showRx: boolean
  showTx: boolean
  hex: boolean
  showTime: boolean
  compare: boolean
  encoding: EncodingId
  limit: number
  buffered: number
  onShowRx: (v: boolean) => void
  onShowTx: (v: boolean) => void
  onHex: (v: boolean) => void
  onShowTime: (v: boolean) => void
  onCompare: (v: boolean) => void
  onEncoding: (e: EncodingId) => void
  onLimit: (n: number) => void
  onClear: () => void
  onSave: () => void
  onSend: (text: string) => void
}

export default function TextPanel({
  items,
  theme,
  showRx,
  showTx,
  hex,
  showTime,
  compare,
  encoding,
  limit,
  buffered,
  onShowRx,
  onShowTx,
  onHex,
  onShowTime,
  onCompare,
  onEncoding,
  onLimit,
  onClear,
  onSave,
  onSend,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const stickRef = useRef(true)

  useEffect(() => {
    const el = bodyRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  const visible = items.filter((it) => (it.dir === 'rx' ? showRx : it.dir === 'tx' ? showTx : true))

  return (
    <div className="text-panel">
      <div className="toolbar">
        <button className={`mini${showRx ? ' on' : ''}`} onClick={() => onShowRx(!showRx)}>
          RX
        </button>
        <button className={`mini${showTx ? ' on' : ''}`} onClick={() => onShowTx(!showTx)}>
          TX
        </button>
        <button className={`mini${hex ? ' on' : ''}`} onClick={() => onHex(!hex)} title="十六进制显示">
          HEX
        </button>
        <button className={`mini${compare ? ' on' : ''}`} onClick={() => onCompare(!compare)} title="ASCII 与 HEX 并排对比">
          对比
        </button>
        <button className={`mini${showTime ? ' on' : ''}`} onClick={() => onShowTime(!showTime)} title="以换行回车断帧，每行加时间戳">
          时间戳
        </button>
        <span className="tb-gap" />
        <label className="inline">
          编码
          <select value={encoding} onChange={(e) => onEncoding(e.target.value as EncodingId)}>
            {ENCODINGS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          缓冲
          <select value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
            {BUFFER_LIMITS.map((n) => (
              <option key={n} value={n}>
                {formatLimit(n)}
              </option>
            ))}
          </select>
        </label>
        <span className="tb-gap" />
        <span className="hint" title="当前缓冲字节数 / 上限，超出上限丢弃最老的数据">
          {buffered.toLocaleString()} / {formatLimit(limit)}
        </span>
        <span className="tb-gap" />
        <button className="mini" onClick={onSave} title="把接收区内容保存成文件（按当前编码）">
          保存
        </button>
        <button className="mini" onClick={onClear}>
          清空
        </button>
      </div>

      <div
        className="text-body"
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {visible.length === 0 && <div className="empty">暂无数据。连上串口或点「演示数据」。</div>}
        {visible.map((it, i) => (
          <div className={`text-line ${it.dir}`} key={i}>
            {showTime && (
              <span className="tstamp">
                {new Date(it.t).toLocaleTimeString('zh-CN', { hour12: false })}.
                {String(it.t % 1000).padStart(3, '0')}
              </span>
            )}
            <span className={`dir ${it.dir}`}>{it.dir === 'rx' ? 'RX' : it.dir === 'tx' ? 'TX' : '··'}</span>
            {hex ? (
              <span className="tval mono">{it.bytes ? toHex(it.bytes) : toHex(new TextEncoder().encode(it.text))}</span>
            ) : compare ? (
              <span className="tval compare">
                <span className="cmp-hex">
                  {it.bytes ? toHex(it.bytes) : toHex(new TextEncoder().encode(it.text))}
                </span>
                <span className="cmp-asc">{it.bytes ? printable(it.bytes) : it.text}</span>
              </span>
            ) : (
              <span className="tval">{renderAnsi(it.text, theme)}</span>
            )}
          </div>
        ))}
      </div>

      <div className="text-input">
        <input
          ref={inputRef}
          placeholder="输入要发送的内容，回车发送"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = e.currentTarget.value
              if (!v) return
              onSend(v)
              e.currentTarget.value = ''
            }
          }}
        />
        <button
          className="btn"
          onClick={() => {
            const v = inputRef.current?.value
            if (!v) return
            onSend(v)
            if (inputRef.current) inputRef.current.value = ''
          }}
        >
          发送
        </button>
      </div>
      {!canEncode(encoding) && (
        <div className="hint warn pad">浏览器只能解码 {encoding.toUpperCase()}，不能编码回该编码；发送仍按 UTF-8 处理。</div>
      )}
    </div>
  )
}

/** 可打印字符原样，控制字符用点 */
function printable(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'
  return s
}

export function decodeItem(bytes: Uint8Array, encoding: EncodingId): string {
  return decodeBytes(bytes, encoding)
}

/** 极简 ANSI SGR 渲染：\x1b[38;2;r;g;bm 之类的真彩转 span */
function renderAnsi(text: string, theme: ThemeTokens) {
  const parts = text.split(/\x1b\[([0-9;]*)m/)
  const nodes: JSX.Element[] = []
  let color = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) nodes.push(<span key={i} style={color ? { color } : undefined}>{parts[i]}</span>)
    } else {
      const sgr = parts[i]
      if (sgr === '0' || sgr === '') color = ''
      else if (sgr === '31') color = '#ff5555'
      else if (sgr === '32') color = '#55ff55'
      else if (sgr === '33') color = '#ffd500'
      else if (sgr === '34') color = '#5599ff'
      else color = sgrToCss(sgr)
    }
  }
  if (nodes.length === 0) return <span style={{ color: theme.fontColor }}>{text}</span>
  return <>{nodes}</>
}
