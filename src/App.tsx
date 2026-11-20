import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Rail, { type RailId } from './components/Rail'
import WaveChart, { type ChannelMeta, type ChartConfig, type ChartType } from './components/WaveChart'
import ChannelPanel from './components/ChannelPanel'
import ConnectPanel, { type ConnState } from './components/ConnectPanel'
import SettingsPanel from './components/SettingsPanel'
import TextPanel, { type TextItem } from './components/TextPanel'
import XcomPanel from './components/XcomPanel'
import { defaultPages, type MultiPage } from './components/MultiSendPanel'
import type { FileProgress } from './components/SingleSendPanel'
import SimView from './components/SimView'
import { DataStore } from './lib/store'
import { createParser, parseSendText, toHex, type Frame, type Parser, type ProtocolId } from './lib/protocol'
import { SerialLink, type SerialOptions } from './lib/serial'
import { ProtoEngine } from './lib/protoLink'
import { decodeBytes, type EncodingId } from './lib/xcom'
import { startDemo } from './lib/demo'
import { THEMES, applyThemeVars, channelColor } from './lib/theme'

type View = 'wave' | 'text' | 'send' | 'sim'

const VIEW_LABELS: Record<View, string> = {
  wave: '波形图',
  text: '文本区',
  send: '发送台',
  sim: '姿态仿真',
}

const MAX_TEXT = 2000

export default function App() {
  const [themeId, setThemeId] = useState('Dark')
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]

  const [view, setView] = useState<View>('wave')
  const [side, setSide] = useState<RailId | 'channel' | null>('channel')
  const [channels, setChannels] = useState<ChannelMeta[]>([])
  const [values, setValues] = useState<number[]>([])
  const [paused, setPaused] = useState(false)
  const [texts, setTexts] = useState<TextItem[]>([])
  const [showRx, setShowRx] = useState(true)
  const [showTx, setShowTx] = useState(true)
  const [hexView, setHexView] = useState(false)
  const [textShowTime, setTextShowTime] = useState(true)
  const [textCompare, setTextCompare] = useState(false)
  const [textEncoding, setTextEncoding] = useState<EncodingId>('utf-8')
  const [textLimit, setTextLimit] = useState(200 * 1024)
  const [buffered, setBuffered] = useState(0)
  const [multiPages, setMultiPages] = useState<MultiPage[]>(() => defaultPages())
  const [multiHex, setMultiHex] = useState(false)
  const [multiNewLine, setMultiNewLine] = useState(true)
  const [fileProgress, setFileProgress] = useState<FileProgress | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [stats, setStats] = useState({ rx: 0, tx: 0, frames: 0, fps: 0, points: 0 })

  const [conn, setConn] = useState<ConnState>({
    status: 'idle',
    protocol: 'firewater',
    baud: 115200,
    port: '-',
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    dtr: false,
    rts: false,
    note: '',
  })

  const [cfg, setCfg] = useState<ChartConfig>({
    type: 'wave',
    lineWidth: 1.5,
    windowMs: 5000,
    autoScroll: true,
    yAuto: true,
    yMin: -1,
    yMax: 1,
    fontScale: 1,
    simplify: true,
    fps: 30,
  })

  const store = useMemo(() => new DataStore(120_000), [])
  const parserRef = useRef<Parser | null>(null)
  const linkRef = useRef<SerialLink | null>(null)
  const demoStopRef = useRef<(() => void) | null>(null)
  const t0Ref = useRef(performance.now())
  const framesRef = useRef(0)
  const rxRef = useRef(0)
  const txRef = useRef(0)
  const namesRef = useRef<string[]>([])
  const latestRef = useRef<number[]>([])
  const connRef = useRef(conn)
  connRef.current = conn

  /* XCOM 移植：协议传输引擎 + 接收区编码/分帧状态 */
  const protoEngine = useMemo(() => new ProtoEngine(), [])
  const encRef = useRef<EncodingId>(textEncoding)
  encRef.current = textEncoding
  const hexViewRef = useRef(hexView)
  hexViewRef.current = hexView
  const compareRef = useRef(textCompare)
  compareRef.current = textCompare
  const rxLineBufRef = useRef<Uint8Array>(new Uint8Array(0))
  const hexChunkRef = useRef<Uint8Array>(new Uint8Array(0))
  const hexTimerRef = useRef<number | null>(null)
  const abortFileRef = useRef(false)
  const textLimitRef = useRef(textLimit)
  textLimitRef.current = textLimit
  const bufferedRef = useRef(0)
  const textsRef = useRef<TextItem[]>([])
  textsRef.current = texts

  const notify = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  /* ---------------- 数据入口 ---------------- */
  const onFrame = useCallback(
    (f: Frame) => {
      const t = performance.now() - t0Ref.current
      store.push(t, f.values)
      latestRef.current = f.values
      if (f.names) {
        f.names.forEach((n, i) => {
          if (n) namesRef.current[i] = n
        })
      }
      framesRef.current++
    },
    [store],
  )

  /* 追加接收条目，同时按缓冲上限淘汰最老的数据（XCOM 的 200K~5M 缓存设置） */
  const appendTexts = useCallback((add: TextItem[]) => {
    setTexts((prev) => {
      const next = prev.concat(add)
      if (next.length > MAX_TEXT) next.splice(0, next.length - MAX_TEXT)
      let total = 0
      for (const it of next) total += it.bytes?.length ?? it.text.length
      while (total > textLimitRef.current && next.length > 1) {
        const first = next.shift()
        if (!first) break
        total -= first.bytes?.length ?? first.text.length
      }
      bufferedRef.current = total
      return next
    })
  }, [])

  const tapText = useCallback(
    (bytes: Uint8Array) => {
      if (connRef.current.protocol === 'justfloat') return

      /* HEX / 对比模式不分行：按 30ms 合块，免得每个串口 chunk 都占一行 */
      if (hexViewRef.current || compareRef.current) {
        const merged = new Uint8Array(hexChunkRef.current.length + bytes.length)
        merged.set(hexChunkRef.current, 0)
        merged.set(bytes, hexChunkRef.current.length)
        hexChunkRef.current = merged
        if (hexTimerRef.current === null) {
          hexTimerRef.current = window.setTimeout(() => {
            hexTimerRef.current = null
            const chunk = hexChunkRef.current
            hexChunkRef.current = new Uint8Array(0)
            if (!chunk.length) return
            appendTexts([{ dir: 'rx', text: decodeBytes(chunk, encRef.current), t: Date.now(), bytes: chunk }])
          }, 30)
        }
        return
      }

      /* 文本模式：以 \n 断帧，XCOM 的时间戳同样是换行回车断帧 */
      const merged = new Uint8Array(rxLineBufRef.current.length + bytes.length)
      merged.set(rxLineBufRef.current, 0)
      merged.set(bytes, rxLineBufRef.current.length)
      let start = 0
      const out: TextItem[] = []
      for (let i = 0; i < merged.length; i++) {
        if (merged[i] !== 0x0a) continue
        let end = i
        if (end > start && merged[end - 1] === 0x0d) end--
        const line = merged.slice(start, end)
        start = i + 1
        if (!line.length) continue
        out.push({ dir: 'rx', text: decodeBytes(line, encRef.current), t: Date.now(), bytes: line })
      }
      rxLineBufRef.current = merged.slice(start)
      if (rxLineBufRef.current.length > 64 * 1024) rxLineBufRef.current = new Uint8Array(0)
      if (out.length) appendTexts(out)
    },
    [appendTexts],
  )

  const onBytes = useCallback(
    (bytes: Uint8Array) => {
      rxRef.current += bytes.length
      parserRef.current?.feed(bytes)
      protoEngine.feed(bytes)
      tapText(bytes)
    },
    [tapText, protoEngine],
  )

  /* ---------------- 解析器生命周期 ---------------- */
  const resetPipeline = useCallback(
    (protocol: ProtocolId) => {
      store.clear()
      namesRef.current = []
      latestRef.current = []
      framesRef.current = 0
      setChannels([])
      setValues([])
      parserRef.current = createParser(protocol, onFrame)
      rxLineBufRef.current = new Uint8Array(0)
      hexChunkRef.current = new Uint8Array(0)
      protoEngine.reset()
    },
    [store, onFrame, protoEngine],
  )

  /* ---------------- 演示数据 ---------------- */
  const stopDemo = useCallback(() => {
    demoStopRef.current?.()
    demoStopRef.current = null
  }, [])

  const runDemo = useCallback(() => {
    stopDemo()
    if (connRef.current.status === 'demo') {
      setConn((c) => ({ ...c, status: 'idle' }))
      return
    }
    resetPipeline(connRef.current.protocol)
    t0Ref.current = performance.now()
    demoStopRef.current = startDemo({ protocol: connRef.current.protocol, hz: 100, onBytes })
    setConn((c) => ({ ...c, status: 'demo' }))
    setPaused(false)
  }, [onBytes, resetPipeline, stopDemo])

  /* 启动只建解析器，不跑任何假数据——要演示得自己点 */
  useEffect(() => {
    parserRef.current = createParser(connRef.current.protocol, onFrame)
    return () => {
      demoStopRef.current?.()
      demoStopRef.current = null
    }
  }, [onFrame])

  /* ---------------- 状态刷新 ---------------- */
  useEffect(() => {
    let lastFrames = 0
    let lastTs = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const dt = (now - lastTs) / 1000
      lastTs = now
      const df = framesRef.current - lastFrames
      lastFrames = framesRef.current

      setStats({
        rx: rxRef.current,
        tx: txRef.current,
        frames: framesRef.current,
        fps: dt > 0 ? Math.round(df / dt) : 0,
        points: store.total,
      })

      setValues(latestRef.current.slice())

      const n = store.series.length
      setChannels((prev) => {
        if (prev.length === n) return prev
        const next = prev.slice(0, n)
        for (let i = prev.length; i < n; i++) {
          next.push({ name: namesRef.current[i] ?? `ch${i}`, color: channelColor(theme, i), visible: true })
        }
        return next
      })
    }, 250)
    return () => window.clearInterval(timer)
  }, [store, theme])

  /* 接收缓冲字节数：低频同步，避免每来一包就触发重渲染 */
  useEffect(() => {
    const t = window.setInterval(() => setBuffered(bufferedRef.current), 500)
    return () => window.clearInterval(t)
  }, [])

  /* ---------------- 串口 ---------------- */
  const connectSerial = useCallback(
    async (o: SerialOptions, portIndex?: number) => {
      stopDemo()
      const link = linkRef.current ?? new SerialLink()
      linkRef.current = link
      link.onData = onBytes
      link.onError = (m) => notify(`串口错误：${m}`)
      link.onClose = () => setConn((c) => ({ ...c, status: 'idle' }))
      try {
        resetPipeline(connRef.current.protocol)
        t0Ref.current = performance.now()
        await link.connect(o, portIndex)
        protoEngine.write = (b) => link.send(b)
        setConn((c) => ({
          ...c,
          status: 'connected',
          baud: o.baudRate,
          dataBits: (link.effective?.dataBits ?? 8) as 5 | 6 | 7 | 8,
          stopBits: (link.effective?.stopBits ?? 1) as 1 | 1.5 | 2,
          parity: link.effective?.parity ?? 'none',
          note: link.degradedNote,
        }))
        notify(link.degradedNote ? `已连接 @ ${o.baudRate}（${link.degradedNote}）` : `已连接 @ ${o.baudRate}`)
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err))
        setConn((c) => ({ ...c, status: 'idle' }))
      }
    },
    [notify, onBytes, resetPipeline, stopDemo, protoEngine],
  )

  const disconnect = useCallback(async () => {
    await linkRef.current?.disconnect()
    setConn((c) => ({ ...c, status: 'idle' }))
    notify('已断开')
  }, [notify])

  /* 底层发送：所有面板都走这里，保证 TX 计数与日志一致 */
  const sendBytes = useCallback(
    async (bytes: Uint8Array, label: string, quiet = false): Promise<boolean> => {
      if (!linkRef.current?.connected) {
        appendTexts([{ dir: 'sys', text: `未发送（串口未连接）：${label}`, t: Date.now() }])
        if (!quiet) notify('串口未连接，命令没有发出去')
        return false
      }
      txRef.current += bytes.length
      appendTexts([{ dir: 'tx', text: label, t: Date.now(), bytes: bytes.slice() }])
      try {
        await linkRef.current.send(bytes)
        if (!quiet) notify(`已发送 ${bytes.length} 字节`)
        const rxBefore = rxRef.current
        window.setTimeout(() => {
          if (quiet) return
          if (linkRef.current?.connected && rxRef.current === rxBefore) {
            notify(`已发出 ${bytes.length} 字节，但设备没有任何回包（RX 0）`)
          }
        }, 1500)
        return true
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [appendTexts, notify],
  )

  const send = useCallback(
    async (data: string, hex: boolean) => {
      const bytes = parseSendText(data, hex)
      if (!bytes) {
        notify('HEX 格式不对：需要偶数个十六进制字符')
        return
      }
      if (bytes.length === 0) {
        notify('内容为空，没有发出任何字节')
        return
      }
      await sendBytes(bytes, hex ? toHex(bytes) : data)
    },
    [notify, sendBytes],
  )

  /* 发送文件（XCOM：每 1024 字节可设延时，可随时中止） */
  const sendFile = useCallback(
    (bytes: Uint8Array, name: string, chunk: number, delay: number) => {
      const link = linkRef.current
      if (!link?.connected) {
        notify('串口未连接，文件发不出去')
        return
      }
      abortFileRef.current = false
      setFileProgress({ name, sent: 0, total: bytes.length })
      txRef.current += bytes.length
      void link
        .sendChunked(bytes, {
          chunk,
          delayMs: delay,
          onProgress: (sent) => setFileProgress((p) => (p ? { ...p, sent } : p)),
          aborted: () => abortFileRef.current,
        })
        .then((sent) => {
          setFileProgress(null)
          notify(`文件发送结束：${sent} / ${bytes.length} 字节`)
        })
        .catch((err) => {
          setFileProgress(null)
          notify(err instanceof Error ? err.message : String(err))
        })
    },
    [notify],
  )

  const onSignals = useCallback(
    (dtr: boolean, rts: boolean) => {
      void linkRef.current?.setSignals(dtr, rts).catch((e) => notify(`DTR/RTS 设置失败：${e}`))
    },
    [notify],
  )

  /* 保存接收区（XCOM：可保存为任意格式，默认 txt） */
  const saveReceived = useCallback(() => {
    const items = textsRef.current.filter((it) => it.dir === 'rx')
    if (items.length === 0) {
      notify('接收区没有数据可保存')
      return
    }
    const chunks: BlobPart[] = items.map((it) => {
      if (hexViewRef.current || compareRef.current) {
        return (it.bytes ? toHex(it.bytes) : it.text) + '\r\n'
      }
      return it.text + '\r\n'
    })
    const blob = new Blob(chunks, { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `接收数据_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
    notify(`已保存 ${items.length} 行`)
  }, [notify])

  /* ---------------- 交互 ---------------- */
  const pickRail = (id: RailId) => {
    if (id === 'wave' || id === 'text' || id === 'sim' || id === 'send') {
      setView(id)
      setSide(id === 'wave' ? 'channel' : null)
      return
    }
    setSide((prev) => (prev === id ? null : id))
  }

  const patchCfg = (p: Partial<ChartConfig>) => setCfg((c) => ({ ...c, ...p }))

  const cycleColor = (i: number) => {
    setChannels((prev) => {
      const next = [...prev]
      const cur = next[i]
      if (!cur) return prev
      const palette = theme.lColors
      const idx = palette.indexOf(cur.color)
      next[i] = { ...cur, color: palette[(idx + 1) % palette.length] }
      return next
    })
  }

  const vars = applyThemeVars(theme)
  const chartTypeLabel: Record<ChartType, string> = {
    wave: '波形',
    bar: '柱状',
    freq: '频谱',
    histog: '直方',
  }

  return (
    <div className={`app${theme.light ? ' light' : ''}`} style={vars as CSSProperties}>
      <Rail active={view} side={side} onPick={pickRail} />

      <main className="main">
        <header className="topbar">
          <div className="brand">
            <strong>WaveDeck</strong>
            <span className="brand-sub">Web · 串口波形调试台</span>
          </div>
          <div className="tabs">
            {(['wave', 'text', 'send', 'sim'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => pickRail(v as RailId)}>
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <div className="top-right">
            <span className={`pill ${conn.status === 'idle' ? 'off' : 'on'}`}>
              {conn.status === 'idle' ? '未连接' : conn.status === 'demo' ? '演示中' : '已连接'}
            </span>
            <button className="mini" onClick={() => setPaused((p) => !p)}>
              {paused ? '继续' : '暂停'}
            </button>
            <button
              className="mini"
              onClick={() => {
                store.clear()
                framesRef.current = 0
                latestRef.current = []
                notify('采样数据已清空')
              }}
            >
              清空
            </button>
          </div>
        </header>

        <div className="workspace">
          <section className="main-area">
            {view === 'wave' && (
              <div className="chart-wrap">
                <div className="chart-toolbar">
                  <div className="seg">
                    {(['wave', 'bar', 'freq', 'histog'] as ChartType[]).map((t) => (
                      <button key={t} className={cfg.type === t ? 'on' : ''} onClick={() => patchCfg({ type: t })}>
                        {chartTypeLabel[t]}
                      </button>
                    ))}
                  </div>
                  <label className="inline">
                    线宽
                    <input
                      type="range"
                      min={1}
                      max={6}
                      step={0.5}
                      value={cfg.lineWidth}
                      onChange={(e) => patchCfg({ lineWidth: Number(e.target.value) })}
                    />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={cfg.simplify} onChange={(e) => patchCfg({ simplify: e.target.checked })} />
                    多重采样
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={cfg.yAuto} onChange={(e) => patchCfg({ yAuto: e.target.checked })} />
                    自动 Y
                  </label>
                  <span className="tb-gap" />
                  <span className="hint">
                    可视采样点: {Math.min(stats.points, 100000).toLocaleString()} / 缓冲 {stats.points.toLocaleString()}
                  </span>
                  <span className="hint tip">
                    左键单击:缩放至中间两格 · 拖动:平移 · 滚轮:缩放 · 右键单击:解除自动缩放 · 双击:自动缩放
                  </span>
                </div>
                <div className="chart-stage">
                <WaveChart store={store} channels={channels} cfg={cfg} theme={theme} paused={paused} />
                {stats.points === 0 && (
                  <div className="chart-empty">
                    <strong>还没有数据</strong>
                    <p>
                      {conn.status === 'connected'
                        ? '串口已连上，正在等第一帧。检查下位机是否在发数据、波特率是否对得上。'
                        : '接开发板：左边「协议」里选协议和波特率，点「请求端口并连接」（需 Chrome / Edge）。'}
                    </p>
                    <p className="dim">
                      没硬件也能玩：演示数据看波形/柱状/频谱/直方四种图，或直接进姿态仿真改 PID 看飞机怎么晃。
                    </p>
                    <div className="chart-empty-actions">
                      <button className="btn" onClick={() => setSide('connect')}>
                        去连接
                      </button>
                      <button className="btn ghost" onClick={runDemo}>
                        先看演示数据
                      </button>
                      <button className="btn ghost" onClick={() => pickRail('sim')}>
                        调姿态仿真
                      </button>
                    </div>
                  </div>
                )}
                </div>
              </div>
            )}

            {view === 'text' && (
              <TextPanel
                items={texts}
                theme={theme}
                showRx={showRx}
                showTx={showTx}
                hex={hexView}
                showTime={textShowTime}
                compare={textCompare}
                encoding={textEncoding}
                limit={textLimit}
                buffered={buffered}
                onShowRx={setShowRx}
                onShowTx={setShowTx}
                onHex={setHexView}
                onShowTime={setTextShowTime}
                onCompare={setTextCompare}
                onEncoding={setTextEncoding}
                onLimit={setTextLimit}
                onClear={() => {
                  setTexts([])
                  bufferedRef.current = 0
                  setBuffered(0)
                }}
                onSave={saveReceived}
                onSend={(t) => void send(t, false)}
              />
            )}

            {view === 'send' && (
              <XcomPanel
                connected={conn.status === 'connected'}
                notify={notify}
                sendBytes={sendBytes}
                sendFile={sendFile}
                fileProgress={fileProgress}
                abortFile={() => {
                  abortFileRef.current = true
                }}
                pages={multiPages}
                setPages={setMultiPages}
                hex={multiHex}
                setHex={setMultiHex}
                newLine={multiNewLine}
                setNewLine={setMultiNewLine}
                engine={protoEngine}
              />
            )}

            {view === 'sim' && <SimView theme={theme} onNotify={notify} />}
          </section>

          <aside className={`side${side ? '' : ' hidden'}`}>
            {side === 'connect' && (
              <ConnectPanel
                state={conn}
                onProtocol={(p) => {
                  setConn((c) => ({ ...c, protocol: p }))
                  resetPipeline(p)
                  if (conn.status === 'demo') {
                    stopDemo()
                    t0Ref.current = performance.now()
                    demoStopRef.current = startDemo({ protocol: p, hz: 100, onBytes })
                  }
                }}
                onPatch={(p) => setConn((c) => ({ ...c, ...p }))}
                onConnect={(o, portIndex) => void connectSerial(o, portIndex)}
                onDisconnect={() => void disconnect()}
                onSignals={onSignals}
                onDemo={runDemo}
                onError={notify}
              />
            )}
            {side === 'settings' && (
              <SettingsPanel
                themeId={themeId}
                onTheme={(id) => {
                  const next = THEMES.find((x) => x.id === id)
                  if (next) {
                    setChannels((prev) =>
                      prev.map((ch) => {
                        const idx = theme.lColors.indexOf(ch.color)
                        return idx >= 0 ? { ...ch, color: next.lColors[idx % next.lColors.length] } : ch
                      }),
                    )
                  }
                  setThemeId(id)
                }}
                cfg={cfg}
                onCfg={patchCfg}
                onClear={() => {
                  store.clear()
                  framesRef.current = 0
                  latestRef.current = []
                }}
              />
            )}
            {(side === 'channel' || side === 'wave') && (
              <ChannelPanel
                channels={channels}
                values={values}
                theme={theme}
                onToggle={(i) =>
                  setChannels((prev) => prev.map((c, k) => (k === i ? { ...c, visible: !c.visible } : c)))
                }
                onAll={(visible) => setChannels((prev) => prev.map((c) => ({ ...c, visible })))}
                onRename={(i, name) => setChannels((prev) => prev.map((c, k) => (k === i ? { ...c, name } : c)))}
                onColor={cycleColor}
              />
            )}
          </aside>
        </div>

        <footer className="statusbar">
          <span className={`dot ${conn.status === 'idle' ? 'off' : 'on'}`} />
          <span>{conn.status === 'idle' ? '未连接' : conn.status === 'demo' ? '演示中' : `已连接 · ${conn.baud}`}</span>
          <span className="sep" />
          <span>协议 {conn.protocol === 'firewater' ? 'FireWater' : conn.protocol === 'justfloat' ? 'JustFloat' : 'RawData'}</span>
          <span className="sep" />
          <span>
            RX <b>{formatBytes(stats.rx)}</b> · TX <b>{formatBytes(stats.tx)}</b>
          </span>
          <span className="sep" />
          <span>
            帧 <b>{stats.frames.toLocaleString()}</b> · {stats.fps} fps
          </span>
          <span className="grow" />
          <span>主题 {theme.name}</span>
          <span className="sep" />
          <span>通道 {channels.length}</span>
        </footer>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
