/**
 * 参数面板 —— PID 滑块 + 机体物理 + 源码导入
 *
 * 面板里的数值都用「显示单位」（度、毫米、e-5），内部 SI 值靠 ParamMeta.scale 换算，
 * 这样用户看到的是 15° 而不是 0.2618。
 */

import { memo, useRef, useState } from 'react'
import {
  type SimParams,
  type Preset,
  PARAM_META,
  GROUP_LABEL,
  PRESETS,
  toDisplay,
  fromDisplay,
  type ParamGroup,
} from '../lib/sim/params'
import { parseProject, PARAM_CN, type ParseResult } from '../lib/sim/parseProject'
import ImuCalibPanel from './ImuCalibPanel'
import type { ThemeTokens } from '../lib/theme'

interface Props {
  params: SimParams
  theme: ThemeTokens
  hover: number
  twr: number
  onChange: (patch: Partial<SimParams>) => void
  onReset: () => void
  onApplyPreset: (p: Preset) => void
  onNotify: (msg: string) => void
}

const GROUPS: ParamGroup[] = ['attitude', 'rate', 'limit', 'plant', 'sensor', 'ctrl']

function SimPanelInner({ params, theme, hover, twr, onChange, onReset, onApplyPreset, onNotify }: Props) {
  const [open, setOpen] = useState<Record<ParamGroup, boolean>>({
    attitude: true,
    rate: true,
    limit: false,
    plant: false,
    sensor: false,
    ctrl: false,
  })
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    const sources = await Promise.all(
      list.map(async (f) => ({ name: f.name, text: await f.text() })),
    )
    const r = parseProject(sources)
    setParseResult(r)
    if (Object.keys(r.params).length) {
      onChange(r.params)
      onNotify(`从 ${r.items.length} 项源码参数里恢复了 ${Object.keys(r.params).length} 个值`)
    } else {
      onNotify('没解析出参数，确认选的是 control.cpp / parameters.cpp 这类源码')
    }
  }

  const handlePaste = () => {
    if (!pasteText.trim()) {
      onNotify('先粘点代码进来')
      return
    }
    const r = parseProject([{ name: '粘贴内容.cpp', text: pasteText }])
    setParseResult(r)
    if (Object.keys(r.params).length) {
      onChange(r.params)
      onNotify(`解析出 ${Object.keys(r.params).length} 个参数`)
    } else {
      onNotify('这段文本里没认出参数')
    }
  }

  return (
    <div className="panel sim-panel">
      <div className="panel-head">
        <span>飞控参数</span>
        <div className="panel-head-actions">
          <button className="mini" onClick={onReset}>
            恢复出厂
          </button>
        </div>
      </div>

      {/* IMU 静止数据标定 */}
      <ImuCalibPanel onApply={onChange} onNotify={onNotify} />

      {/* 机体概况 */}
      <div className="sim-summary">
        <div>
          <span>推重比</span>
          <b className={twr < 1.2 ? 'warn' : ''}>{twr.toFixed(2)} : 1</b>
        </div>
        <div>
          <span>悬停油门</span>
          <b>{(hover * 100).toFixed(0)}%</b>
        </div>
        <div>
          <span>轴距</span>
          <b>{(params.wheelbase * 1000).toFixed(0)} mm</b>
        </div>
      </div>
      {twr < 1.2 && <p className="hint warn">推重比不足 1.2，这个配置根本飞不起来，调大单电机推力或减重。</p>}

      {/* 预设 */}
      <div className="field">
        <label>预设</label>
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button key={p.id} className="preset-btn" title={p.desc} onClick={() => onApplyPreset(p)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* 参数分组 */}
      {GROUPS.map((g) => {
        const metas = PARAM_META.filter((m) => m.group === g)
        if (!metas.length) return null
        return (
          <div className="param-group" key={g}>
            <button className="group-head" onClick={() => setOpen((o) => ({ ...o, [g]: !o[g] }))}>
              <span className={`caret${open[g] ? ' on' : ''}`}>▸</span>
              {GROUP_LABEL[g]}
              <em>{metas.length}</em>
            </button>
            {open[g] && (
              <div className="param-list">
                {metas.map((m) => {
                  const raw = params[m.key] as number
                  const disp = toDisplay(m, raw)
                  const digits = m.digits ?? 2
                  return (
                    <div className="prow" key={m.key} title={m.hint}>
                      <span className="plabel">{m.label}</span>
                      <input
                        type="range"
                        min={m.min}
                        max={m.max}
                        step={m.step}
                        value={disp}
                        onChange={(e) => onChange({ [m.key]: fromDisplay(m, Number(e.target.value)) })}
                      />
                      <input
                        className="pnum"
                        type="number"
                        min={m.min}
                        max={m.max}
                        step={m.step}
                        value={Number(disp.toFixed(digits))}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (Number.isFinite(v)) onChange({ [m.key]: fromDisplay(m, v) })
                        }}
                      />
                      <span className="punit">{m.unit}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* 源码导入 */}
      <div className="panel-head" style={{ marginTop: 6 }}>
        <span>从项目源码导入</span>
      </div>
      <div
        className={`drop-zone${dragging ? ' on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void handleFiles(e.dataTransfer.files)
        }}
        onClick={() => fileRef.current?.click()}
      >
        <strong>拖入 control.cpp / parameters.cpp</strong>
        <span>或点这里选文件（可多选）</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".c,.cpp,.cc,.h,.hpp,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button className="mini ghost" onClick={() => setPasteMode((v) => !v)}>
        {pasteMode ? '收起粘贴框' : '或者直接粘贴代码'}
      </button>
      {pasteMode && (
        <div className="field">
          <textarea
            rows={6}
            placeholder="把 control.cpp 里的 #define 段和 PID 构造那几行粘进来"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button className="btn" onClick={handlePaste}>
            解析并应用
          </button>
        </div>
      )}

      {parseResult && (
        <div className="parse-result">
          <div className="pr-head">
            <b>{parseResult.files.join(' + ')}</b>
            <span>{parseResult.items.length} 项</span>
          </div>
          <div className="pr-list">
            {parseResult.items.map((it) => (
              <div className="pr-row" key={String(it.key)}>
                <span>{PARAM_CN[it.key] ?? String(it.key)}</span>
                <b>{formatParsed(it.value)}</b>
                {it.fwName && <em>{it.fwName}</em>}
              </div>
            ))}
          </div>
          {parseResult.warnings.length > 0 && (
            <div className="pr-warn">
              {parseResult.warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="hint">
        参数默认值取自 CF-Drone 固件 control.cpp 的真实常量。机体物理（质量/惯量/推力）是按
        118mm 轴距估的，你有实测值就改掉，仿真才跟得上真机。
      </p>
      <div className="panel-foot">
        <span>主题 {theme.name}</span>
        <span>{PARAM_META.length} 项可调</span>
      </div>
    </div>
  )
}

function formatParsed(v: number): string {
  const a = Math.abs(v)
  if (a === 0) return '0'
  if (a >= 100) return v.toFixed(1)
  if (a >= 1) return v.toFixed(3).replace(/\.?0+$/, '')
  return v.toPrecision(4)
}

export default memo(SimPanelInner)
