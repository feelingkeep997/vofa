/**
 * 姿态仿真主视图
 *
 * 布局：左（3D + 摇杆）｜中（曲线 + 阶跃指标）｜右（参数面板）
 *
 * 数据流：rAF → engine.tick(dt) → forceRender → 各画布按新采样重绘。
 * 参数用 ref 同步给引擎，避免每次拖动滑块都重建对象。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import AttitudeCanvas from './AttitudeCanvas'
import TraceChart, { type TraceMode } from './TraceChart'
import SimPanel from './SimPanel'
import { SimEngine, runStepTest, type StepMetrics } from '../lib/sim/engine'
import { CF_DRONE_DEFAULTS, type SimParams, type Preset } from '../lib/sim/params'
import type { FlightMode } from '../lib/sim/fc'
import type { ThemeTokens } from '../lib/theme'
import { DEG, RAD, qFromEuler, vec } from '../lib/sim/quat'

interface Props {
  theme: ThemeTokens
  onNotify: (msg: string) => void
}

type TraceSource = 'live' | 'step'

interface Sticks4 {
  roll: number
  pitch: number
  yaw: number
  throttle: number
}

export default function SimView({ theme, onNotify }: Props) {
  const [params, setParams] = useState<SimParams>({ ...CF_DRONE_DEFAULTS })
  const [mode, setMode] = useState<FlightMode>('STAB')
  const [running, setRunning] = useState(false)
  const [sticks, setSticks] = useState<Sticks4>({ roll: 0, pitch: 0, yaw: 0, throttle: 0.4 })
  const [stepResult, setStepResult] = useState<StepMetrics | null>(null)
  const [traceSource, setTraceSource] = useState<TraceSource>('live')
  const [traceMode, setTraceMode] = useState<TraceMode>('attitude')
  const [showTarget, setShowTarget] = useState(true)
  const [showThrust, setShowThrust] = useState(true)
  const [cam, setCam] = useState({ az: -28, el: 30 })
  const [windowSec, setWindowSec] = useState(4)

  const [, bump] = useState(0)
  const forceRender = useCallback(() => bump((v) => (v + 1) & 0xffff), [])

  const engineRef = useRef<SimEngine | null>(null)
  if (!engineRef.current) engineRef.current = new SimEngine(params)
  const engine = engineRef.current

  const paramsRef = useRef(params)
  paramsRef.current = params

  // 参数 / 杆量 / 模式同步给引擎
  useEffect(() => {
    engine.params = params
  }, [engine, params])
  useEffect(() => {
    engine.setSticks(sticks)
  }, [engine, sticks])
  useEffect(() => {
    engine.mode = mode
  }, [engine, mode])

  // 首帧把油门放到悬停位置，不然一进来推力是 0
  useEffect(() => {
    setSticks((s) => ({ ...s, throttle: engine.hoverThrottle }))
  }, [engine])

  /* ---------------- rAF 主循环 ---------------- */
  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = now - last
      last = now
      engine.tick(dt)
      forceRender()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, engine, forceRender])

  /* ---------------- 操作 ---------------- */
  const start = useCallback(() => {
    engine.reset()
    // 不清 stepResult：实时跑起来也能对着上一次阶跃指标看
    setTraceSource('live')
    setSticks((s) => ({ ...s, throttle: engine.hoverThrottle }))
    setRunning(true)
  }, [engine])

  const resetSim = useCallback(() => {
    setRunning(false)
    engine.reset()
    setSticks({ roll: 0, pitch: 0, yaw: 0, throttle: engine.hoverThrottle })
    setStepResult(null)
    setTraceSource('live')
    forceRender()
    onNotify('已重置到悬停')
  }, [engine, forceRender, onNotify])

  const runTest = useCallback(() => {
    setRunning(false)
    const p = paramsRef.current
    // testAmp 内部存的是弧度，runStepTest 要度 —— 这里漏了 *RAD 就会变成 0.26° 的"假阶跃"
    const r = runStepTest(p, p.testAxis, p.testAmp * RAD, p.testDuration)
    setStepResult(r)
    setTraceSource('step')
    setTraceMode('attitude')

    // 把 3D 摆到阶跃终态，否则测完机体还水平躺着，看着像没生效
    const last = r.trace[r.trace.length - 1]
    if (last) {
      engine.plant.q = qFromEuler(last.roll * DEG, last.pitch * DEG, last.yaw * DEG)
      engine.plant.omega = vec()
      engine.fc.attitudeTarget = qFromEuler(
        p.testAxis === 'roll' ? p.testAmp : 0,
        p.testAxis === 'pitch' ? p.testAmp : 0,
        p.testAxis === 'yaw' ? p.testAmp : 0,
      )
      forceRender()
    }
    onNotify(
      r.unstable
        ? '阶跃测试发散 —— 这套参数不能飞'
        : `阶跃完成：超调 ${r.overshoot.toFixed(1)}% · 调节 ${r.settlingTime?.toFixed(2) ?? '—'} s`,
    )
  }, [engine, forceRender, onNotify])

  const patchParams = useCallback((patch: Partial<SimParams>) => {
    setParams((p) => ({ ...p, ...patch }))
  }, [])

  const applyPreset = useCallback(
    (preset: Preset) => {
      setParams((p) => ({ ...p, ...preset.patch }))
      onNotify(`已套用预设「${preset.name}」`)
    },
    [onNotify],
  )

  const setStick = (patch: Partial<Sticks4>) => setSticks((s) => ({ ...s, ...patch }))

  // 每帧取一次快照：环缓冲 toArray() 会返回新数组，React 才肯重绘
  const samples = traceSource === 'step' && stepResult ? stepResult.trace : engine.samples()

  const hover = engine.hoverThrottle
  const twr = engine.thrustToWeight

  return (
    <div className="sim-view">
      <div className="sim-toolbar">
        <div className="seg">
          {(['STAB', 'ACRO'] as FlightMode[]).map((m) => (
            <button
              key={m}
              className={mode === m ? 'on' : ''}
              onClick={() => setMode(m)}
              title={m === 'STAB' ? '自稳：杆量 → 目标倾角' : '手动：杆量 → 目标角速率'}
            >
              {m}
            </button>
          ))}
        </div>
        <button className="mini" onClick={running ? () => setRunning(false) : start}>
          {running ? '暂停' : '开始'}
        </button>
        <button className="mini" onClick={resetSim}>
          重置悬停
        </button>
        <span className="tb-sep" />
        <button className="mini" onClick={runTest}>
          阶跃测试
        </button>
        <label className="inline">
          轴
          <select
            value={params.testAxis}
            onChange={(e) => patchParams({ testAxis: e.target.value as SimParams['testAxis'] })}
          >
            <option value="roll">横滚</option>
            <option value="pitch">俯仰</option>
            <option value="yaw">偏航</option>
          </select>
        </label>
        <label className="inline">
          幅度
          <input
            type="number"
            value={Math.round(params.testAmp * RAD)}
            step={5}
            min={1}
            max={45}
            onChange={(e) => patchParams({ testAmp: Number(e.target.value) * DEG })}
          />
          °
        </label>
        <span className="tb-sep" />
        <div className="seg">
          {(['attitude', 'estimate', 'rate', 'motor'] as TraceMode[]).map((m) => (
            <button
              key={m}
              className={traceMode === m ? 'on' : ''}
              onClick={() => setTraceMode(m)}
              title={m === 'estimate' ? '真值 vs 飞控估计：两条线分开就是估计漂了' : undefined}
            >
              {m === 'attitude' ? '姿态' : m === 'estimate' ? '估计' : m === 'rate' ? '角速率' : '电机'}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={showTarget} onChange={(e) => setShowTarget(e.target.checked)} />
          目标虚影
        </label>
        <label className="check">
          <input type="checkbox" checked={showThrust} onChange={(e) => setShowThrust(e.target.checked)} />
          推力矢量
        </label>
        <span className="tb-gap" />
        <label className="inline">
          视角
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={cam.az}
            onChange={(e) => setCam((c) => ({ ...c, az: Number(e.target.value) }))}
            style={{ width: 84 }}
          />
        </label>
      </div>

      <div className="sim-body">
        {/* ---------- 左：3D + 摇杆 ---------- */}
        <div className="sim-left">
          <div className="sim-3d">
            <AttitudeCanvas
              attitude={engine.plant.q}
              target={engine.fc.attitudeTarget}
              motors={engine.fc.motors}
              thrust={engine.fc.thrustTarget}
              theme={theme}
              showTarget={showTarget}
              showThrust={showThrust}
              azimuth={cam.az}
              elevation={cam.el}
            />
            <div className="sim-3d-tag">
              {mode === 'STAB' ? '自稳模式' : '手动模式'} · {running ? '运行中' : '已暂停'}
            </div>
          </div>
          <div className="sim-sticks">
            <StickPad
              title="油门 / 偏航"
              x={sticks.yaw}
              y={sticks.throttle * 2 - 1}
              xLabel="yaw"
              yLabel="thr"
              onDrag={(x, y) => setStick({ yaw: x, throttle: Math.max(0, Math.min(1, (y + 1) / 2)) })}
              onRelease={() => setStick({ yaw: 0, throttle: hover })}
            />
            <StickPad
              title="俯仰 / 横滚"
              x={sticks.roll}
              y={sticks.pitch}
              xLabel="roll"
              yLabel="pitch"
              onDrag={(x, y) => setStick({ roll: x, pitch: y })}
              onRelease={() => setStick({ roll: 0, pitch: 0 })}
            />
            <div className="stick-readout">
              <div>
                <span>roll</span>
                <b>{(sticks.roll * params.tiltMax * RAD).toFixed(0)}°</b>
              </div>
              <div>
                <span>pitch</span>
                <b>{(sticks.pitch * params.tiltMax * RAD).toFixed(0)}°</b>
              </div>
              <div>
                <span>yaw</span>
                <b>{(sticks.yaw * 100).toFixed(0)}%</b>
              </div>
              <div>
                <span>thr</span>
                <b>{(sticks.throttle * 100).toFixed(0)}%</b>
              </div>
            </div>
          </div>
        </div>

        {/* ---------- 中：曲线 + 指标 ---------- */}
        <div className="sim-mid">
          <div className="sim-trace-head">
            <span>{traceSource === 'step' ? '阶跃响应（离线）' : '实时采样'}</span>
            {traceSource === 'step' && (
              <button className="mini ghost" onClick={() => setTraceSource('live')}>
                回到实时
              </button>
            )}
            <span className="tb-gap" />
            <label className="inline">
              窗口
              <select value={windowSec} onChange={(e) => setWindowSec(Number(e.target.value))}>
                <option value={2}>2s</option>
                <option value={4}>4s</option>
                <option value={8}>8s</option>
                <option value={0}>全部</option>
              </select>
            </label>
          </div>
          <div className="sim-trace">
            <TraceChart
              samples={samples}
              mode={traceMode}
              theme={theme}
              windowSec={traceSource === 'step' ? 0 : windowSec}
            />
          </div>

          <div className="sim-metrics">
            {stepResult ? (
              <>
                <Metric label="上升时间" value={fmt(stepResult.riseTime, 3)} unit="s" />
                <Metric
                  label="超调"
                  value={stepResult.overshoot.toFixed(1)}
                  unit="%"
                  warn={stepResult.overshoot > 25}
                />
                <Metric
                  label="调节时间"
                  value={fmt(stepResult.settlingTime, 3)}
                  unit="s"
                  warn={!!stepResult.settlingTime && stepResult.settlingTime > 1.2}
                />
                <Metric
                  label="稳态误差"
                  value={stepResult.steadyError.toFixed(2)}
                  unit="°"
                  warn={Math.abs(stepResult.steadyError) > 1}
                />
                <Metric label="峰值" value={stepResult.peak.toFixed(2)} unit="°" />
                <Metric
                  label="振荡"
                  value={String(stepResult.oscillations)}
                  unit="次"
                  warn={stepResult.oscillations >= 4}
                />
                {stepResult.unstable && <Metric label="状态" value="发散" unit="" warn />}
              </>
            ) : (
              <p className="hint">
                点「阶跃测试」跑一次离线响应，这里出上升时间 / 超调 / 调节时间 / 稳态误差。
              </p>
            )}
          </div>
          {stepResult && <Diagnosis m={stepResult} />}
        </div>

        {/* ---------- 右：参数面板 ---------- */}
        <aside className="sim-side">
          <SimPanel
            params={params}
            theme={theme}
            hover={hover}
            twr={twr}
            onChange={patchParams}
            onReset={() => {
              setParams({ ...CF_DRONE_DEFAULTS })
              onNotify('已恢复 CF-Drone 出厂参数')
            }}
            onApplyPreset={applyPreset}
            onNotify={onNotify}
          />
        </aside>
      </div>
    </div>
  )
}

/* ---------------- 小部件 ---------------- */

function Metric({
  label,
  value,
  unit,
  warn,
}: {
  label: string
  value: string
  unit: string
  warn?: boolean
}) {
  return (
    <div className={`metric${warn ? ' warn' : ''}`}>
      <span>{label}</span>
      <b>
        {value}
        <em>{unit}</em>
      </b>
    </div>
  )
}

function fmt(v: number | undefined, digits: number): string {
  return v === undefined ? '—' : v.toFixed(digits)
}

/** 把指标翻译成人话：超调大了该动哪个参数 */
function Diagnosis({ m }: { m: StepMetrics }) {
  const tips: string[] = []
  if (m.unstable) {
    tips.push('响应发散了：先把内环 P 砍一半，确认能收敛再往上加')
  } else {
    if (m.overshoot > 25)
      tips.push(`超调 ${m.overshoot.toFixed(0)}% 偏大 —— 内环 P 降一点，或加大内环 D / 把 D 低通 α 调小`)
    else if (m.overshoot < 2 && (m.riseTime ?? 0) > 0.25)
      tips.push('不冲但慢 —— 外环 P 可以再加，响应会更跟手')
    if ((m.settlingTime ?? 0) > 1.2) tips.push('拖尾长 —— 外环 P 偏小，或内环 I 太强在慢慢退饱和')
    if (Math.abs(m.steadyError) > 1)
      tips.push('有明显稳态误差 —— 外环没有 I，全靠内环积分兜底；想消掉给外环加一点 I')
    if (m.oscillations >= 4) tips.push('来回穿目标线多次 —— 内环 D 不足，或控制频率太低带来的相位滞后')
  }
  if (!tips.length) tips.push('这套参数响应挺干净：上升快、超调小、稳得住')

  return (
    <div className="sim-diagnosis">
      {tips.map((t, i) => (
        <p key={i}>· {t}</p>
      ))}
    </div>
  )
}

/** 虚拟摇杆：拖动改变归一化杆量，松手按各自规则回中 */
function StickPad(props: {
  title: string
  x: number
  y: number
  xLabel: string
  yLabel: string
  onDrag: (x: number, y: number) => void
  onRelease: () => void
}) {
  const { title, x, y, xLabel, yLabel, onDrag, onRelease } = props
  const ref = useRef<HTMLDivElement>(null)
  const active = useRef(false)

  const update = (e: ReactPointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1
    const ny = 1 - ((e.clientY - r.top) / r.height) * 2
    onDrag(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)))
  }

  const px = ((x + 1) / 2) * 100
  const py = ((1 - y) / 2) * 100

  return (
    <div className="stick-wrap">
      <div className="stick-title">{title}</div>
      <div
        ref={ref}
        className="stick-pad"
        onPointerDown={(e) => {
          active.current = true
          // 合成事件（自动化测试）没有真实 pointer，capture 会抛，别让它打断拖动
          try {
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
          update(e)
        }}
        onPointerMove={(e) => {
          if (active.current) update(e)
        }}
        onPointerUp={() => {
          active.current = false
          onRelease()
        }}
        onPointerCancel={() => {
          active.current = false
          onRelease()
        }}
      >
        <div className="stick-cross-h" />
        <div className="stick-cross-v" />
        <div className="stick-dot" style={{ left: `${px}%`, top: `${py}%` }} />
      </div>
      <div className="stick-axis">
        <span>{yLabel} ↑</span>
        <span>{xLabel} →</span>
      </div>
    </div>
  )
}
