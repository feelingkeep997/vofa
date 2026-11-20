/**
 * IMU 静止数据标定面板
 *
 * 输入：飞机放平不动时抓的一段 IMU 输出（CF-Drone `imu.cpp` 的 17 通道调试格式，
 *       或者裸六轴 CSV）。输出：陀螺零偏 / 噪声 / 加速度计状态，一键灌进仿真参数。
 *
 * 为什么要这一步：仿真默认零偏是 0，那是理想传感器；真机静止时姿态就在漂。
 * 把实采的零偏喂进去，「静止不动也会慢慢歪」这件事才会真的发生。
 */

import { useRef, useState } from 'react'
import {
  parseImuText,
  calibrate,
  calibToParams,
  type ImuCalib,
  type ImuFrame,
} from '../lib/sim/imuData'
import type { SimParams } from '../lib/sim/params'

interface Props {
  onApply: (patch: Partial<SimParams>) => void
  onNotify: (msg: string) => void
}

export default function ImuCalibPanel({ onApply, onNotify }: Props) {
  const [sampleRate, setSampleRate] = useState(50)
  const [calib, setCalib] = useState<ImuCalib | null>(null)
  const [format, setFormat] = useState('')
  const [frames, setFrames] = useState<ImuFrame[]>([])
  const [dragging, setDragging] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const run = (text: string, name: string) => {
    const parsed = parseImuText(text)
    if (!parsed.frames.length) {
      onNotify(`「${name}」里没认出 IMU 数据：需要逗号分隔的数值行`)
      return
    }
    const c = calibrate(parsed.frames, sampleRate)
    c.format = parsed.format
    setCalib(c)
    setFormat(parsed.format)
    setFrames(parsed.frames)
    onNotify(`${name}：${parsed.frames.length} 帧，零偏 ${c.gyroBiasNormDeg.toFixed(1)} °/s`)
  }

  const handleFiles = async (list: FileList | File[]) => {
    const files = Array.from(list)
    if (!files.length) return
    // 多选时拼起来一起标（同一段静止数据的多个分片）
    const texts = await Promise.all(files.map((f) => f.text()))
    run(texts.join('\n'), files.map((f) => f.name).join(' + '))
  }

  return (
    <div className="imu-calib">
      <div className="ic-head">
        <span>IMU 静止数据标定</span>
        <label className="inline">
          采样率
          <input
            type="number"
            min={1}
            max={1000}
            value={sampleRate}
            style={{ width: 52 }}
            onChange={(e) => setSampleRate(Math.max(1, Number(e.target.value) || 50))}
          />
          Hz
        </label>
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
        <strong>拖入 IMU 静止数据</strong>
        <span>支持 imu.cpp 的 17 通道格式，或裸六轴 CSV</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".csv,.txt,.log,.dat"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button className="mini ghost" onClick={() => setPasteOpen((v) => !v)}>
        {pasteOpen ? '收起粘贴框' : '或者直接粘贴几行'}
      </button>
      {pasteOpen && (
        <div className="field">
          <textarea
            rows={5}
            placeholder={'0.0573,-0.0184,9.8097,18.526,-11.906,17.453,...\n（一行一帧，逗号分隔）'}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button className="btn" onClick={() => run(pasteText, '粘贴内容')}>
            标定
          </button>
        </div>
      )}

      {calib && (
        <div className="ic-result">
          <div className="ic-row">
            <span>数据</span>
            <b>
              {calib.frames} 帧 · {(calib.duration).toFixed(1)}s
            </b>
          </div>
          <div className="ic-row">
            <span>格式</span>
            <b className="ic-fmt">{format}</b>
          </div>

          <div className="ic-sep" />

          <div className="ic-row">
            <span>陀螺零偏</span>
            <b>
              {fmt(calib.gyroBiasDeg.x)} / {fmt(calib.gyroBiasDeg.y)} / {fmt(calib.gyroBiasDeg.z)} °/s
            </b>
          </div>
          <div className={`ic-row${calib.gyroBiasNormDeg > 5.2 ? ' warn' : ''}`}>
            <span>零偏模长</span>
            <b>{calib.gyroBiasNormDeg.toFixed(2)} °/s</b>
          </div>
          <div className="ic-row">
            <span>陀螺噪声 σ</span>
            <b>
              {fmt(calib.gyroNoiseDeg.x)} / {fmt(calib.gyroNoiseDeg.y)} / {fmt(calib.gyroNoiseDeg.z)} °/s
            </b>
          </div>

          <div className="ic-sep" />

          <div className="ic-row">
            <span>加速度模长</span>
            <b className={calib.accValid ? '' : 'warn'}>
              {calib.accNormMean.toFixed(3)} m/s² ({calib.accScaleErrPct > 0 ? '+' : ''}
              {calib.accScaleErrPct.toFixed(2)}%)
            </b>
          </div>
          <div className="ic-row">
            <span>acc 反算倾角</span>
            <b>
              roll {calib.staticTiltDeg.roll.toFixed(2)}° / pitch {calib.staticTiltDeg.pitch.toFixed(2)}°
            </b>
          </div>
          {calib.driftDegPerSec && (
            <div className="ic-row">
              <span>姿态漂移</span>
              <b>
                {fmt(calib.driftDegPerSec.x)} / {fmt(calib.driftDegPerSec.y)} / {fmt(calib.driftDegPerSec.z)}{' '}
                °/s
              </b>
            </div>
          )}

          <div className={`ic-verdict${calib.gyroBiasNormDeg > 5.2 ? ' bad' : ''}`}>{calib.verdict}</div>

          {calib.warnings.length > 0 && (
            <div className="ic-warn">
              {calib.warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}

          <button
            className="btn"
            onClick={() => {
              onApply(calibToParams(calib))
              onNotify('已把标定值写进仿真参数：零偏 / 噪声 / acc 零偏')
            }}
          >
            应用到仿真参数
          </button>
          <p className="hint">
            应用后去「传感器与估计」分组里能看到具体数值，也可以手改。想看漂移就把「开始」跑起来、杆量松手放
            10 秒，切到「估计」曲线看真值和估计怎么分开。
          </p>
        </div>
      )}

      {!calib && frames.length === 0 && (
        <p className="hint">
          飞机放平、不上电转动，抓 5~10 秒数据拖进来。标出来的零偏决定仿真里姿态漂多快 ——
          这是真机和理想模型最大的差距。
        </p>
      )}
    </div>
  )
}

function fmt(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)
}
