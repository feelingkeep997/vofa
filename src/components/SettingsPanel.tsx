import type { ChartConfig } from './WaveChart'
import { THEMES } from '../lib/theme'

interface Props {
  themeId: string
  onTheme: (id: string) => void
  cfg: ChartConfig
  onCfg: (patch: Partial<ChartConfig>) => void
  onClear: () => void
}

export default function SettingsPanel({ themeId, onTheme, cfg, onCfg, onClear }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>设置</span>
      </div>

      <div className="field">
        <label>主题</label>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-card${themeId === t.id ? ' on' : ''}`}
              onClick={() => onTheme(t.id)}
              title={`${t.name} · 主色 ${t.mainColor}`}
            >
              <span className="theme-swatch" style={{ background: t.bgColor }}>
                <i style={{ background: t.mainColor }} />
                <i style={{ background: t.lColors[0] }} />
                <i style={{ background: t.lColors[3] }} />
              </span>
              <span className="theme-name">{t.name}</span>
            </button>
          ))}
        </div>
        <div className="hint">主题令牌与官方 theme.json 同名：barColor / lineColorMain / lColors …</div>
      </div>

      <div className="field">
        <label>
          线宽 <b>{cfg.lineWidth}</b>
        </label>
        <input
          type="range"
          min={1}
          max={6}
          step={0.5}
          value={cfg.lineWidth}
          onChange={(e) => onCfg({ lineWidth: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <label>
          数据帧率 <b>{cfg.fps} fps</b>
        </label>
        <input type="range" min={5} max={60} step={1} value={cfg.fps} onChange={(e) => onCfg({ fps: Number(e.target.value) })} />
        <div className="hint">对应 datahub_global.fps，官方默认 30</div>
      </div>

      <div className="field">
        <label>
          时间窗 <b>{(cfg.windowMs / 1000).toFixed(1)} s</b>
        </label>
        <input
          type="range"
          min={500}
          max={30000}
          step={500}
          value={cfg.windowMs}
          onChange={(e) => onCfg({ windowMs: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <label>
          字体缩放 <b>{cfg.fontScale.toFixed(2)}</b>
        </label>
        <input
          type="range"
          min={0.8}
          max={1.6}
          step={0.05}
          value={cfg.fontScale}
          onChange={(e) => onCfg({ fontScale: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <label className="check">
          <input type="checkbox" checked={cfg.simplify} onChange={(e) => onCfg({ simplify: e.target.checked })} />
          多重采样（每像素列取 min/max，长缓冲不掉峰值）
        </label>
        <label className="check">
          <input type="checkbox" checked={cfg.autoScroll} onChange={(e) => onCfg({ autoScroll: e.target.checked })} />
          自动滚动
        </label>
        <label className="check">
          <input type="checkbox" checked={cfg.yAuto} onChange={(e) => onCfg({ yAuto: e.target.checked })} />
          Y 轴自动缩放
        </label>
      </div>

      {!cfg.yAuto && (
        <div className="field row">
          <label className="inline">
            Y 最小
            <input
              type="number"
              value={cfg.yMin}
              step={0.5}
              onChange={(e) => onCfg({ yMin: Number(e.target.value) })}
            />
          </label>
          <label className="inline">
            Y 最大
            <input
              type="number"
              value={cfg.yMax}
              step={0.5}
              onChange={(e) => onCfg({ yMax: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      <div className="field">
        <button className="btn ghost" onClick={onClear}>
          清空采样数据
        </button>
        <div className="hint">左键: 清空采样数据（不可恢复）</div>
      </div>
    </div>
  )
}
