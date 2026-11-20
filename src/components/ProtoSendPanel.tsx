import { useEffect, useRef, useState } from 'react'
import { CHECKSUM_METHODS, parseHexAuto, toHex, type ChecksumMethod } from '../lib/xcom'
import type { ProtoEngine, ProtoEvent } from '../lib/protoLink'

interface LogItem {
  t: number
  kind: 'tx' | 'ack' | 'timeout' | 'rx' | 'sys'
  text: string
}

interface Props {
  engine: ProtoEngine
  connected: boolean
  notify: (m: string) => void
}

/** XCOM 的「协议传输」页：modbus 变种 + 四种校验 + 重发 + 文件传输 */
export default function ProtoSendPanel({ engine, connected, notify }: Props) {
  const [cfg, setCfg] = useState({ ...engine.cfg })
  const [text, setText] = useState('01 03 00 00 00 0A')
  const [logs, setLogs] = useState<LogItem[]>([])
  const [autoOn, setAutoOn] = useState(false)
  const [autoMs, setAutoMs] = useState(1000)
  const [maxLen, setMaxLen] = useState(200)
  const [busy, setBusy] = useState(false)
  const [fileInfo, setFileInfo] = useState('')
  const [filePct, setFilePct] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef(false)

  /* 配置实时同步给引擎 */
  useEffect(() => {
    engine.cfg = { ...cfg }
  }, [cfg, engine])

  const push = (kind: LogItem['kind'], text: string) =>
    setLogs((prev) => [...prev, { t: Date.now(), kind, text }].slice(-200))

  useEffect(() => {
    engine.onEvent = (e: ProtoEvent) => {
      if (e.kind === 'tx') push('tx', `→ seq=${e.seq} 第 ${e.attempt} 次 · ${toHex(e.frame, ' ')}`)
      else if (e.kind === 'ack')
        push('ack', `← ACK seq=${e.seq} 用了 ${e.attempts} 次 · 数据 ${toHex(e.frame.data, ' ')}`)
      else if (e.kind === 'timeout') push('timeout', `✗ seq=${e.seq} 重发 ${e.attempts} 次仍无应答`)
      else if (e.kind === 'rx')
        push(
          'rx',
          `← 收到 addr=${e.frame.deviceAddr} fn=${e.frame.functionType} seq=${e.frame.sequence} ` +
            `len=${e.frame.dataLength} 校验${e.frame.checksumOk ? 'OK' : '错'}`,
        )
    }
    return () => {
      engine.onEvent = () => {}
    }
  }, [engine])

  const data = parseHexAuto(text)

  const sendOnce = async () => {
    if (!connected) {
      notify('串口没连上，协议帧发不出去')
      return
    }
    if (!data || data.length === 0) {
      notify('发送数据为空')
      return
    }
    if (data.length > maxLen) {
      notify(`数据 ${data.length} 字节超过最大长度 ${maxLen}`)
      return
    }
    setBusy(true)
    try {
      const r = await engine.send(data)
      push('sys', r.ok ? `✓ seq=${r.seq} 传输成功（${r.attempts} 次）` : `✗ seq=${r.seq} 传输失败`)
    } finally {
      setBusy(false)
    }
  }

  /* 自动发送 */
  useEffect(() => {
    if (!autoOn || !connected) return
    const t = window.setInterval(() => {
      if (busy) return
      void sendOnce()
    }, Math.max(20, autoMs))
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, connected, autoMs, busy, text, cfg, maxLen])

  const sendFile = async (f: File | null) => {
    if (!f) return
    if (!connected) {
      notify('串口没连上')
      return
    }
    const bytes = new Uint8Array(await f.arrayBuffer())
    setFileInfo(`${f.name}（${bytes.length} 字节）`)
    abortRef.current = false
    setFilePct(0)
    push('sys', `开始文件传输：${f.name}，每帧 ${maxLen} 字节`)
    let okCount = 0
    let failCount = 0
    for (let off = 0; off < bytes.length; off += maxLen) {
      if (abortRef.current) {
        push('sys', '文件传输被中止')
        break
      }
      const slice = bytes.subarray(off, Math.min(off + maxLen, bytes.length))
      const r = await engine.send(slice)
      if (r.ok) okCount++
      else failCount++
      setFilePct(Math.round((Math.min(off + maxLen, bytes.length) / bytes.length) * 100))
    }
    setFilePct(null)
    push('sys', `文件传输结束：成功 ${okCount} 帧，失败 ${failCount} 帧`)
  }

  return (
    <div className="xcom-page">
      <div className="xcom-section">
        <div className="xcom-section-head">协议参数（modbus 变种 · Send-Ack 半双工）</div>
        <div className="proto-grid">
          <label className="inline">
            本机地址
            <input value="主机" readOnly style={{ width: 56 }} />
          </label>
          <label className="inline">
            从机地址
            <input
              type="number"
              min={0}
              max={255}
              value={cfg.deviceAddr}
              onChange={(e) => setCfg({ ...cfg, deviceAddr: Number(e.target.value) & 0xff })}
            />
          </label>
          <label className="inline">
            功能码
            <input
              type="number"
              min={0}
              max={255}
              value={cfg.functionType}
              onChange={(e) => setCfg({ ...cfg, functionType: Number(e.target.value) & 0xff })}
            />
          </label>
          <label className="inline">
            校验方式
            <select
              value={cfg.method}
              onChange={(e) => setCfg({ ...cfg, method: e.target.value as ChecksumMethod })}
            >
              {CHECKSUM_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            重发次数
            <input
              type="number"
              min={0}
              max={20}
              value={cfg.retry}
              onChange={(e) => setCfg({ ...cfg, retry: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="inline">
            帧周期
            <input
              type="number"
              min={10}
              step={10}
              value={cfg.periodMs}
              onChange={(e) => setCfg({ ...cfg, periodMs: Math.max(10, Number(e.target.value) || 200) })}
            />
            ms
          </label>
          <label className="inline">
            最大长度
            <input
              type="number"
              min={1}
              max={250}
              value={maxLen}
              onChange={(e) => setMaxLen(Math.min(250, Math.max(1, Number(e.target.value) || 200)))}
            />
          </label>
          <label className="inline">
            ACK 序号
            <select
              value={cfg.ackSeqMode}
              onChange={(e) => setCfg({ ...cfg, ackSeqMode: e.target.value as 'same' | 'plus1' })}
            >
              <option value="same">回显原序号</option>
              <option value="plus1">原序号 +1</option>
            </select>
          </label>
        </div>
        <div className="hint">
          {CHECKSUM_METHODS.find((m) => m.id === cfg.method)?.note} · 帧格式
          {'  '}
          <code>[从机地址][功能码][序号][长度][数据…][校验]</code>
        </div>
      </div>

      <textarea
        className="xcom-textarea"
        placeholder="要传输的数据（HEX），例如 01 03 00 00 00 0A"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="field row">
        <span className="hint">
          {data ? `数据 ${data.length} 字节 · 下一帧序号 ${engine.nextSeq}` : 'HEX 解析失败'}
        </span>
        <span className="tb-gap" />
        <button className="btn" disabled={busy} onClick={() => void sendOnce()}>
          {busy ? '传输中…' : '单次发送'}
        </button>
        <button className={`btn ghost${autoOn ? ' on' : ''}`} onClick={() => setAutoOn(!autoOn)}>
          {autoOn ? '停止自动' : '自动发送'}
        </button>
        <label className="inline">
          周期
          <input
            type="number"
            min={20}
            step={50}
            value={autoMs}
            onChange={(e) => setAutoMs(Math.max(20, Number(e.target.value) || 1000))}
          />
          ms
        </label>
      </div>

      <div className="xcom-section">
        <div className="xcom-section-head">文件传输（IAP 串口升级这类场景）</div>
        <div className="field row">
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            选择文件
          </button>
          <span className="hint">{fileInfo || '未选择文件'}</span>
          <input
            ref={fileRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => void sendFile(e.target.files?.[0] ?? null)}
          />
          <button className="btn ghost" disabled={filePct === null} onClick={() => (abortRef.current = true)}>
            中止
          </button>
        </div>
        {filePct !== null && (
          <div className="xcom-progress">
            <div className="xcom-progress-bar">
              <i style={{ width: `${filePct}%` }} />
            </div>
            <span className="hint">已传 {filePct}%</span>
          </div>
        )}
      </div>

      <div className="xcom-section grow-section">
        <div className="xcom-section-head">
          传输日志
          <button className="mini" onClick={() => setLogs([])}>
            清空
          </button>
        </div>
        <div className="proto-log">
          {logs.length === 0 && <div className="empty">还没有传输记录</div>}
          {logs.map((l, i) => (
            <div className={`proto-log-row ${l.kind}`} key={i}>
              <span className="tstamp">{new Date(l.t).toLocaleTimeString('zh-CN', { hour12: false })}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
