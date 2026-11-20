import { useEffect, useState } from 'react'
import type { ProtocolId } from '../lib/protocol'
import { PROTOCOLS } from '../lib/protocol'
import { SerialLink, serialSupported, type PortInfo, type SerialOptions } from '../lib/serial'

export interface ConnState {
  status: 'idle' | 'connected' | 'demo'
  protocol: ProtocolId
  baud: number
  port: string
  dataBits: 5 | 6 | 7 | 8
  stopBits: 1 | 1.5 | 2
  parity: 'none' | 'even' | 'odd'
  dtr: boolean
  rts: boolean
  /** 浏览器降级时的说明 */
  note: string
}

interface Props {
  state: ConnState
  onProtocol: (p: ProtocolId) => void
  onPatch: (p: Partial<ConnState>) => void
  onConnect: (o: SerialOptions, portIndex?: number) => void
  onDisconnect: () => void
  onSignals: (dtr: boolean, rts: boolean) => void
  onDemo: () => void
  onError: (msg: string) => void
}

/** XCOM 原版可选范围：1200bps - 1382400bps，且允许自定义 */
const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 1382400]

export default function ConnectPanel({ state, onProtocol, onPatch, onConnect, onDisconnect, onSignals, onDemo, onError }: Props) {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [customBaud, setCustomBaud] = useState('')
  const supported = serialSupported()

  const refresh = async () => {
    const link = new SerialLink()
    const list = await link.listPorts()
    setPorts(list)
  }

  useEffect(() => {
    if (supported) void refresh()
  }, [supported])

  const opts = (): SerialOptions => ({
    baudRate: state.baud,
    dataBits: state.dataBits,
    stopBits: state.stopBits,
    parity: state.parity,
    flowControl: 'none',
  })

  return (
    <div className="panel">
      <div className="panel-head">
        <span>协议与连接</span>
        <span className={`pill ${state.status === 'idle' ? 'off' : 'on'}`}>
          {state.status === 'idle' ? '未连接' : state.status === 'demo' ? '演示中' : '已连接'}
        </span>
      </div>

      <div className="field">
        <label>协议引擎</label>
        <div className="seg">
          {PROTOCOLS.map((p) => (
            <button
              key={p.id}
              className={state.protocol === p.id ? 'on' : ''}
              onClick={() => onProtocol(p.id)}
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="hint">{PROTOCOLS.find((p) => p.id === state.protocol)?.hint}</div>
      </div>

      <div className="field">
        <label>串口</label>
        {!supported && <div className="hint warn">当前浏览器不支持 Web Serial，请用 Chrome / Edge 打开</div>}
        <div className="port-list">
          {ports.length === 0 && <div className="hint">{supported ? '还没有已授权的串口，点「请求端口」' : '—'}</div>}
          {ports.map((p) => (
            <div className="port-row" key={p.index}>
              <span>{p.label}</span>
              <button
                className="mini"
                disabled={state.status === 'connected'}
                onClick={() => onConnect(opts(), p.index)}
              >
                连接
              </button>
            </div>
          ))}
        </div>
        <button className="btn" disabled={!supported} onClick={() => onConnect(opts())}>
          请求端口并连接
        </button>
      </div>

      <div className="field">
        <label>串口参数</label>
        <div className="xcom-serial-grid">
          <label className="inline">
            波特率
            <select value={state.baud} onChange={(e) => onPatch({ baud: Number(e.target.value) })}>
              {BAUDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              {!BAUDS.includes(state.baud) && <option value={state.baud}>{state.baud}（自定义）</option>}
            </select>
          </label>
          <label className="inline">
            数据位
            <select
              value={state.dataBits}
              onChange={(e) => onPatch({ dataBits: Number(e.target.value) as 5 | 6 | 7 | 8 })}
            >
              {[5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            停止位
            <select
              value={state.stopBits}
              onChange={(e) => onPatch({ stopBits: Number(e.target.value) as 1 | 1.5 | 2 })}
            >
              <option value={1}>1</option>
              <option value={1.5}>1.5</option>
              <option value={2}>2</option>
            </select>
          </label>
          <label className="inline">
            校验
            <select value={state.parity} onChange={(e) => onPatch({ parity: e.target.value as 'none' | 'even' | 'odd' })}>
              <option value="none">无</option>
              <option value="odd">奇</option>
              <option value="even">偶</option>
            </select>
          </label>
        </div>
        <div className="field row">
          <input
            placeholder="自定义波特率"
            value={customBaud}
            onChange={(e) => setCustomBaud(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ maxWidth: 130 }}
          />
          <button
            className="mini"
            onClick={() => {
              const n = Number(customBaud)
              if (!Number.isFinite(n) || n < 50 || n > 12000000) {
                onError('波特率要在 50 - 12000000 之间')
                return
              }
              onPatch({ baud: n })
              setCustomBaud('')
            }}
          >
            应用
          </button>
        </div>
        <div className="hint">
          串口打开后才能改 DTR / RTS。Chrome 只稳定支持 8 数据位 + 无校验，其余组合会自动降级并提示。
        </div>
        <div className="field row">
          <label className="check">
            <input
              type="checkbox"
              checked={state.dtr}
              disabled={state.status !== 'connected'}
              onChange={(e) => {
                onPatch({ dtr: e.target.checked })
                onSignals(e.target.checked, state.rts)
              }}
            />
            DTR
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={state.rts}
              disabled={state.status !== 'connected'}
              onChange={(e) => {
                onPatch({ rts: e.target.checked })
                onSignals(state.dtr, e.target.checked)
              }}
            />
            RTS
          </label>
        </div>
        {state.note && <div className="hint warn">{state.note}</div>}
      </div>

      <div className="field row">
        <button className="btn" disabled={state.status === 'connected'} onClick={() => onConnect(opts())}>
          连接
        </button>
        <button className="btn ghost" disabled={state.status !== 'connected'} onClick={onDisconnect}>
          断开
        </button>
        <button className="btn ghost" onClick={onDemo}>
          {state.status === 'demo' ? '停止演示' : '演示数据'}
        </button>
      </div>

      <div className="field">
        <label>接入小抄</label>
        <pre className="code">
{`FireWater : "ch0:1.2,ch1:3.4\\n"
            或 "1.2,3.4,5.6\\n"
JustFloat : float32 小端 ×N
            + 帧尾 00 00 80 7F
RawData   : 原始字节，只做 HEX 监视`}
        </pre>
        <button className="mini" onClick={() => void refresh()}>
          刷新端口列表
        </button>
        <button
          className="mini"
          onClick={() =>
            onError(
              '接入三步：选协议和波特率 → 点「请求端口并连接」→ 等第一帧。没波形就查下位机是否在发数据、波特率是否对得上。',
            )
          }
        >
          帮助
        </button>
      </div>
    </div>
  )
}
