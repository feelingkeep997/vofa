import { useState } from 'react'
import SingleSendPanel, { type FileProgress } from './SingleSendPanel'
import MultiSendPanel, { type MultiPage } from './MultiSendPanel'
import ProtoSendPanel from './ProtoSendPanel'
import type { ProtoEngine } from '../lib/protoLink'

export interface XcomPanelProps {
  connected: boolean
  notify: (m: string) => void
  sendBytes: (bytes: Uint8Array, label: string) => Promise<boolean>
  sendFile: (bytes: Uint8Array, name: string, chunk: number, delay: number) => void
  fileProgress: FileProgress | null
  abortFile: () => void
  pages: MultiPage[]
  setPages: (p: MultiPage[]) => void
  hex: boolean
  setHex: (v: boolean) => void
  newLine: boolean
  setNewLine: (v: boolean) => void
  engine: ProtoEngine
}

type Tab = 'single' | 'multi' | 'proto'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'single', label: '单条发送', hint: 'HEX / 新行 / 定时 / 发送文件' },
  { id: 'multi', label: '多条发送', hint: '分页 · 勾选循环 · 数字键盘 · CSV' },
  { id: 'proto', label: '协议传输', hint: 'modbus 变种 · 4 种校验 · 重发' },
]

/** XCOM 三条发送通道的统一入口 */
export default function XcomPanel(p: XcomPanelProps) {
  const [tab, setTab] = useState<Tab>('single')

  return (
    <div className="xcom-panel">
      <div className="xcom-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
        <span className="tb-gap" />
        <span className="hint">{TABS.find((t) => t.id === tab)?.hint}</span>
        <span className="tb-gap" />
        <span className={`pill ${p.connected ? 'on' : 'off'}`}>{p.connected ? '串口已连' : '未连接'}</span>
      </div>

      {tab === 'single' && (
        <SingleSendPanel
          connected={p.connected}
          onSendBytes={p.sendBytes}
          onSendFile={p.sendFile}
          fileProgress={p.fileProgress}
          onAbortFile={p.abortFile}
          notify={p.notify}
        />
      )}
      {tab === 'multi' && (
        <MultiSendPanel
          pages={p.pages}
          onChange={p.setPages}
          hex={p.hex}
          newLine={p.newLine}
          onHex={p.setHex}
          onNewLine={p.setNewLine}
          connected={p.connected}
          onSendBytes={p.sendBytes}
          notify={p.notify}
        />
      )}
      {tab === 'proto' && <ProtoSendPanel engine={p.engine} connected={p.connected} notify={p.notify} />}
    </div>
  )
}
