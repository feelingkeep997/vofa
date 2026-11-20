import { useEffect, useRef, useState } from 'react'
import { parseHexAuto, toHex } from '../lib/xcom'
import { parseSendText } from '../lib/protocol'

export interface FileProgress {
  name: string
  sent: number
  total: number
}

interface Props {
  connected: boolean
  onSendBytes: (bytes: Uint8Array, label: string) => Promise<boolean>
  onSendFile: (bytes: Uint8Array, name: string, chunk: number, delay: number) => void
  fileProgress: FileProgress | null
  onAbortFile: () => void
  notify: (m: string) => void
}

/** XCOM 的「单条发送」页：HEX / 新行 / 定时 / 发送文件 */
export default function SingleSendPanel({ connected, onSendBytes, onSendFile, fileProgress, onAbortFile, notify }: Props) {
  const [text, setText] = useState('')
  const [hex, setHex] = useState(false)
  const [newLine, setNewLine] = useState(false)
  const [timed, setTimed] = useState(false)
  const [period, setPeriod] = useState(1000)
  const [chunk, setChunk] = useState(1024)
  const [delay, setDelay] = useState(10)
  const [fileName, setFileName] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const fileBytesRef = useRef<Uint8Array | null>(null)

  // 文本模式走 parseSendText 才会解 \r \n \t \xNN 转义，TextEncoder 直发会把字面量发出去
  const bytes = hex ? parseHexAuto(text) : parseSendText(text, false)
  const payload = (() => {
    if (!bytes) return null
    if (!newLine) return bytes
    const out = new Uint8Array(bytes.length + 2)
    out.set(bytes, 0)
    out[bytes.length] = 0x0d
    out[bytes.length + 1] = 0x0a
    return out
  })()

  const doSend = () => {
    if (!payload || payload.length === 0) {
      notify(hex ? 'HEX 内容为空' : '发送内容为空')
      return
    }
    void onSendBytes(payload, hex ? toHex(payload, ' ') : text)
  }

  /* 定时发送 */
  useEffect(() => {
    if (!timed || !connected) return
    const t = window.setInterval(() => {
      if (payload && payload.length) void onSendBytes(payload, hex ? toHex(payload, ' ') : text)
    }, Math.max(10, period))
    return () => window.clearInterval(t)
    // payload 随输入变化，故意只在开关/周期变化时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, connected, period])

  const pickFile = async (f: File | null) => {
    if (!f) return
    const buf = new Uint8Array(await f.arrayBuffer())
    fileBytesRef.current = buf
    setFileName(`${f.name}（${buf.length} 字节）`)
  }

  const pct = fileProgress && fileProgress.total > 0 ? Math.round((fileProgress.sent / fileProgress.total) * 100) : 0

  return (
    <div className="xcom-page">
      <div className="toolbar">
        <button className={`mini${hex ? ' on' : ''}`} onClick={() => setHex(!hex)} title="十六进制发送，支持字节自动拆分">
          HEX 发送
        </button>
        <button className={`mini${newLine ? ' on' : ''}`} onClick={() => setNewLine(!newLine)} title="在发送内容后追加 \r\n">
          发送新行
        </button>
        <button className={`mini${timed ? ' on' : ''}`} onClick={() => setTimed(!timed)} title="按周期重复发送当前内容">
          定时发送
        </button>
        <label className="inline">
          周期
          <input
            type="number"
            min={10}
            step={10}
            value={period}
            onChange={(e) => setPeriod(Math.max(10, Number(e.target.value) || 1000))}
          />
          ms
        </label>
        <span className="tb-gap" />
        <span className="hint">
          {payload === null ? 'HEX 解析失败' : `将发送 ${payload.length} 字节`}
        </span>
        <span className="tb-gap" />
        <button className="mini" onClick={() => setText('')}>
          清除发送
        </button>
      </div>

      <textarea
        className="xcom-textarea"
        placeholder={
          hex
            ? 'HEX，空格可有可无：01 03 00 00 00 0A C5 CD 或 01030000000AC5CD'
            : '要发送的文本，支持 \\r \\n \\t \\xNN 转义（定时发送时会按周期重发）'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            doSend()
          }
        }}
      />

      <div className="field row">
        <button className="btn" onClick={doSend}>
          发送
        </button>
        <span className="hint">Ctrl+Enter 发送</span>
      </div>

      <div className="xcom-section">
        <div className="xcom-section-head">发送文件</div>
        <div className="field row">
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            选择文件
          </button>
          <span className="hint">{fileName || '未选择文件'}</span>
          <input
            ref={fileRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="field row">
          <label className="inline">
            每
            <input
              type="number"
              min={1}
              step={128}
              value={chunk}
              onChange={(e) => setChunk(Math.max(1, Number(e.target.value) || 1024))}
            />
            字节
          </label>
          <label className="inline">
            延时
            <input
              type="number"
              min={0}
              step={5}
              value={delay}
              onChange={(e) => setDelay(Math.max(0, Number(e.target.value) || 0))}
            />
            ms
          </label>
          <button
            className="btn"
            disabled={!fileBytesRef.current || !!fileProgress}
            onClick={() => {
              const b = fileBytesRef.current
              if (!b) return
              onSendFile(b, fileName, chunk, delay)
            }}
          >
            发送文件
          </button>
          <button className="btn ghost" disabled={!fileProgress} onClick={onAbortFile}>
            停止
          </button>
        </div>
        {fileProgress && (
          <div className="xcom-progress">
            <div className="xcom-progress-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <span className="hint">
              {fileProgress.name} · {fileProgress.sent} / {fileProgress.total} 字节（{pct}%）
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
