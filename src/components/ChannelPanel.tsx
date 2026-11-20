import type { ChannelMeta } from './WaveChart'
import type { ThemeTokens } from '../lib/theme'

interface Props {
  channels: ChannelMeta[]
  values: number[]
  theme: ThemeTokens
  onToggle: (i: number) => void
  onAll: (visible: boolean) => void
  onRename: (i: number, name: string) => void
  onColor: (i: number) => void
}

export default function ChannelPanel({ channels, values, theme, onToggle, onAll, onRename, onColor }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>通道</span>
        <div className="panel-head-actions">
          <button className="mini" title="点击可使所有通道在波形图中可见" onClick={() => onAll(true)}>
            全显
          </button>
          <button className="mini" title="点击可使所有通道在波形图中不可见" onClick={() => onAll(false)}>
            全隐
          </button>
        </div>
      </div>
      <div className="ch-list">
        {channels.length === 0 && <div className="empty">等待数据帧…</div>}
        {channels.map((ch, i) => (
          <div className={`ch-row${ch.visible ? '' : ' off'}`} key={i}>
            <button
              className="eye"
              title={ch.visible ? '使此通道在波形图中不可见' : '使此通道在波形图中可见'}
              onClick={() => onToggle(i)}
            >
              {ch.visible ? (
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 4l16 16M2 12s3.6-6.5 10-6.5c1.7 0 3.2.5 4.5 1.2M22 12s-3.6 6.5-10 6.5c-1.4 0-2.6-.3-3.7-.8" />
                </svg>
              )}
            </button>
            <button
              className="swatch"
              style={{ background: ch.color }}
              title="点击此处可修改通道名称 / 颜色"
              onClick={() => onColor(i)}
            />
            <input
              className="ch-name"
              value={ch.name}
              title="点击此处可修改通道名称"
              onChange={(e) => onRename(i, e.target.value)}
            />
            <span className="ch-val" style={{ color: ch.visible ? ch.color : theme.fontColorTips }}>
              {values[i] === undefined ? '-' : formatVal(values[i])}
            </span>
          </div>
        ))}
      </div>
      <div className="panel-foot">
        <span>共 {channels.length} 通道</span>
        <span>{channels.filter((c) => c.visible).length} 可见</span>
      </div>
    </div>
  )
}

function formatVal(v: number): string {
  if (!Number.isFinite(v)) return '-'
  if (Math.abs(v) >= 100000) return v.toExponential(2)
  if (Math.abs(v) >= 100) return v.toFixed(1)
  return v.toFixed(3)
}
