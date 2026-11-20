/**
 * 仿真参数集 —— 默认值全部取自 CF-Drone 固件真实常量
 *
 * 来源对照：
 *   application/control.cpp  →  角速率环/姿态环增益、限幅、D 项低通、油门映射
 *   注释「针对 118mm 轴距微型四轴整定」→ 机体物理参数按该尺寸估
 *
 * 单位一律 SI：rad、rad/s、m、kg、N、s。UI 里需要度就靠 ParamMeta.scale 换算。
 */

import { DEG } from './quat'

export interface SimParams {
  /* ---- 姿态环（外环，误差 rad → 期望角速率 rad/s）---- */
  rollP: number
  rollI: number
  rollD: number
  rollWU: number
  pitchP: number
  pitchI: number
  pitchD: number
  pitchWU: number
  yawP: number

  /* ---- 角速率环（内环，误差 rad/s → 力矩指令）---- */
  rollRateP: number
  rollRateI: number
  rollRateD: number
  rollRateWU: number
  pitchRateP: number
  pitchRateI: number
  pitchRateD: number
  pitchRateWU: number
  yawRateP: number
  yawRateI: number
  yawRateD: number
  yawRateWU: number
  /** 角速率环 D 项低通系数（固件 RATES_D_LPF_ALPHA） */
  rateDAlpha: number

  /* ---- 限幅与映射 ---- */
  maxRateRoll: number
  maxRatePitch: number
  maxRateYaw: number
  tiltMax: number
  motThrMin: number
  motThrMax: number

  /* ---- 机体物理（118mm 轴距微型四轴，估算值，可改）---- */
  /** 起飞质量 kg */
  mass: number
  /** 对角轴距 m（对角电机中心距） */
  wheelbase: number
  /** 转动惯量 kg·m² */
  ixx: number
  iyy: number
  izz: number
  /** 单电机满油门推力 N */
  thrustMax: number
  /** 电机+桨一阶时间常数 s */
  motorTau: number
  /** 反扭矩系数（反扭矩/推力，量纲 m） */
  torqueRatio: number
  /** 机体气动阻尼（1/s，简化线性阻尼） */
  aeroDamp: number

  /* ---- 传感器标定（静止数据标出来的）---- */
  /** 陀螺零偏 rad/s，三轴分别标 */
  gyroBiasX: number
  gyroBiasY: number
  gyroBiasZ: number
  /** 陀螺噪声 rad/s（1σ），三轴同值 */
  gyroNoise: number
  /** 加速度计零偏 m/s² */
  accBiasX: number
  accBiasY: number
  accBiasZ: number
  /** 加速度计比例因子（理想 1） */
  accScaleX: number
  accScaleY: number
  accScaleZ: number
  /** 加速度计噪声 m/s²（1σ） */
  accNoise: number

  /* ---- 姿态估计（estimate.cpp）---- */
  /** 落地/电机停时的 acc 修正权重 */
  estAccWeight: number
  /** 飞行中的 acc 修正权重（很小，只吃慢漂） */
  estAccWeightInFlight: number
  /** 角速率低通 α（EST_RATES_LPF_A） */
  estRatesLpfAlpha: number
  /** 水平修正权重（固件默认 0 = 关闭） */
  levelWeight: number
  /** 陀螺零偏在线学习增益（固件默认 0 = 关闭） */
  levelBiasGain: number

  /* ---- 控制循环 ---- */
  /** 控制频率 Hz（固件主循环） */
  controlHz: number
  /** 仿真物理子步倍率（每控制周期积分几次） */
  subSteps: number

  /* ---- 阶跃测试设置 ---- */
  testAxis: 'roll' | 'pitch' | 'yaw'
  testAmp: number
  testDuration: number
}

/** CF-Drone 出厂参数（改自 control.cpp 的真实 #define） */
export const CF_DRONE_DEFAULTS: SimParams = {
  rollP: 6,
  rollI: 0,
  rollD: 0,
  rollWU: 5 * DEG,
  pitchP: 6,
  pitchI: 0,
  pitchD: 0,
  pitchWU: 5 * DEG,
  yawP: 3,

  rollRateP: 0.06,
  rollRateI: 0.1,
  rollRateD: 0.001,
  rollRateWU: 0.3,
  pitchRateP: 0.06,
  pitchRateI: 0.1,
  pitchRateD: 0.001,
  pitchRateWU: 0.3,
  yawRateP: 0.3,
  yawRateI: 0.01,
  yawRateD: 0.01,
  yawRateWU: 0.3,
  rateDAlpha: 0.2,

  maxRateRoll: 360 * DEG,
  maxRatePitch: 360 * DEG,
  maxRateYaw: 300 * DEG,
  tiltMax: 30 * DEG,
  motThrMin: 0.1,
  motThrMax: 0.9,

  mass: 0.05,
  wheelbase: 0.118,
  ixx: 1.4e-5,
  iyy: 1.4e-5,
  izz: 2.4e-5,
  thrustMax: 0.3,
  motorTau: 0.03,
  torqueRatio: 0.012,
  aeroDamp: 0.6,

  gyroBiasX: 0,
  gyroBiasY: 0,
  gyroBiasZ: 0,
  gyroNoise: 0,
  accBiasX: 0,
  accBiasY: 0,
  accBiasZ: 0,
  accScaleX: 1,
  accScaleY: 1,
  accScaleZ: 1,
  accNoise: 0,

  estAccWeight: 0.003,
  estAccWeightInFlight: 0.0005,
  estRatesLpfAlpha: 0.2,
  levelWeight: 0,
  levelBiasGain: 0,

  controlHz: 1000,
  subSteps: 4,

  testAxis: 'roll',
  testAmp: 15 * DEG,
  testDuration: 3,
}

export type ParamGroup = 'attitude' | 'rate' | 'limit' | 'plant' | 'sensor' | 'ctrl'

export interface ParamMeta {
  key: keyof SimParams
  label: string
  unit: string
  min: number
  max: number
  step: number
  group: ParamGroup
  /** 显示值 = 内部值 × scale */
  scale?: number
  digits?: number
  hint?: string
}

const RAD_SCALE = 1 / DEG

export const PARAM_META: ParamMeta[] = [
  // ---- 姿态环 ----
  { key: 'rollP', label: 'ROLL P', unit: '', min: 0, max: 30, step: 0.1, group: 'attitude', digits: 2, hint: '误差(rad) → 期望角速率(rad/s)。偏小回中软、偏大振荡' },
  { key: 'rollI', label: 'ROLL I', unit: '', min: 0, max: 5, step: 0.01, group: 'attitude', digits: 3 },
  { key: 'rollD', label: 'ROLL D', unit: '', min: 0, max: 2, step: 0.01, group: 'attitude', digits: 3 },
  { key: 'rollWU', label: 'ROLL WU', unit: '°', min: 0, max: 60, step: 0.5, group: 'attitude', scale: RAD_SCALE, digits: 1, hint: '积分限幅，0 = 关闭积分' },
  { key: 'pitchP', label: 'PITCH P', unit: '', min: 0, max: 30, step: 0.1, group: 'attitude', digits: 2 },
  { key: 'pitchI', label: 'PITCH I', unit: '', min: 0, max: 5, step: 0.01, group: 'attitude', digits: 3 },
  { key: 'pitchD', label: 'PITCH D', unit: '', min: 0, max: 2, step: 0.01, group: 'attitude', digits: 3 },
  { key: 'pitchWU', label: 'PITCH WU', unit: '°', min: 0, max: 60, step: 0.5, group: 'attitude', scale: RAD_SCALE, digits: 1 },
  { key: 'yawP', label: 'YAW P', unit: '', min: 0, max: 20, step: 0.1, group: 'attitude', digits: 2 },

  // ---- 角速率环 ----
  { key: 'rollRateP', label: 'R-RATE P', unit: '', min: 0, max: 2, step: 0.005, group: 'rate', digits: 3, hint: '误差(rad/s) → 力矩指令。太小软绵绵，太大会高频抖' },
  { key: 'rollRateI', label: 'R-RATE I', unit: '', min: 0, max: 2, step: 0.005, group: 'rate', digits: 3 },
  { key: 'rollRateD', label: 'R-RATE D', unit: '', min: 0, max: 0.2, step: 0.0005, group: 'rate', digits: 4 },
  { key: 'rollRateWU', label: 'R-RATE WU', unit: '', min: 0, max: 2, step: 0.01, group: 'rate', digits: 2, hint: '内环积分限幅，设 0 会把 I 项彻底钳死' },
  { key: 'pitchRateP', label: 'P-RATE P', unit: '', min: 0, max: 2, step: 0.005, group: 'rate', digits: 3 },
  { key: 'pitchRateI', label: 'P-RATE I', unit: '', min: 0, max: 2, step: 0.005, group: 'rate', digits: 3 },
  { key: 'pitchRateD', label: 'P-RATE D', unit: '', min: 0, max: 0.2, step: 0.0005, group: 'rate', digits: 4 },
  { key: 'pitchRateWU', label: 'P-RATE WU', unit: '', min: 0, max: 2, step: 0.01, group: 'rate', digits: 2 },
  { key: 'yawRateP', label: 'Y-RATE P', unit: '', min: 0, max: 2, step: 0.005, group: 'rate', digits: 3 },
  { key: 'yawRateI', label: 'Y-RATE I', unit: '', min: 0, max: 2, step: 0.005, group: 'rate', digits: 3 },
  { key: 'yawRateD', label: 'Y-RATE D', unit: '', min: 0, max: 0.2, step: 0.0005, group: 'rate', digits: 4 },
  { key: 'yawRateWU', label: 'Y-RATE WU', unit: '', min: 0, max: 2, step: 0.01, group: 'rate', digits: 2 },
  { key: 'rateDAlpha', label: 'D 低通 α', unit: '', min: 0.02, max: 1, step: 0.01, group: 'rate', digits: 2, hint: '越小越平滑、相位滞后越大' },

  // ---- 限幅 ----
  { key: 'maxRateRoll', label: 'R 速率上限', unit: '°/s', min: 30, max: 720, step: 10, group: 'limit', scale: RAD_SCALE, digits: 0 },
  { key: 'maxRatePitch', label: 'P 速率上限', unit: '°/s', min: 30, max: 720, step: 10, group: 'limit', scale: RAD_SCALE, digits: 0 },
  { key: 'maxRateYaw', label: 'Y 速率上限', unit: '°/s', min: 30, max: 720, step: 10, group: 'limit', scale: RAD_SCALE, digits: 0 },
  { key: 'tiltMax', label: '最大倾角', unit: '°', min: 5, max: 80, step: 1, group: 'limit', scale: RAD_SCALE, digits: 0 },
  { key: 'motThrMin', label: '怠速油门', unit: '', min: 0, max: 0.5, step: 0.01, group: 'limit', digits: 2 },
  { key: 'motThrMax', label: '推力上限', unit: '', min: 0.5, max: 1, step: 0.01, group: 'limit', digits: 2 },

  // ---- 机体 ----
  { key: 'mass', label: '起飞质量', unit: 'g', min: 20, max: 300, step: 1, group: 'plant', scale: 1000, digits: 0, hint: '含电池。改它悬停油门会跟着变' },
  { key: 'wheelbase', label: '对角轴距', unit: 'mm', min: 60, max: 450, step: 1, group: 'plant', scale: 1000, digits: 0 },
  { key: 'ixx', label: 'Ixx', unit: 'e-5', min: 0.2, max: 30, step: 0.1, group: 'plant', scale: 1e5, digits: 1 },
  { key: 'iyy', label: 'Iyy', unit: 'e-5', min: 0.2, max: 30, step: 0.1, group: 'plant', scale: 1e5, digits: 1 },
  { key: 'izz', label: 'Izz', unit: 'e-5', min: 0.2, max: 40, step: 0.1, group: 'plant', scale: 1e5, digits: 1 },
  { key: 'thrustMax', label: '单电机满推力', unit: 'N', min: 0.05, max: 3, step: 0.01, group: 'plant', digits: 2, hint: '4×该值 / 重力 = 推重比' },
  { key: 'motorTau', label: '电机时间常数', unit: 'ms', min: 5, max: 120, step: 1, group: 'plant', scale: 1000, digits: 0, hint: '桨+电机一阶滞后，实机 20~40ms' },
  { key: 'torqueRatio', label: '反扭矩系数', unit: 'm', min: 0.002, max: 0.06, step: 0.001, group: 'plant', digits: 3 },
  { key: 'aeroDamp', label: '气动阻尼', unit: '1/s', min: 0, max: 5, step: 0.1, group: 'plant', digits: 1, hint: '简化线性阻尼，0 = 纯刚体' },

  // ---- 控制循环 ----
  { key: 'controlHz', label: '控制频率', unit: 'Hz', min: 100, max: 8000, step: 50, group: 'ctrl', digits: 0, hint: '固件主循环。降频能看出离散化影响' },
  { key: 'subSteps', label: '物理子步', unit: '×', min: 1, max: 8, step: 1, group: 'ctrl', digits: 0 },
  { key: 'gyroBiasX', label: '陀螺零偏 X', unit: '°/s', min: -20, max: 20, step: 0.01, group: 'sensor', scale: RAD_SCALE, digits: 2, hint: '静止时陀螺输出就是零偏，决定姿态漂多快' },
  { key: 'gyroBiasY', label: '陀螺零偏 Y', unit: '°/s', min: -20, max: 20, step: 0.01, group: 'sensor', scale: RAD_SCALE, digits: 2 },
  { key: 'gyroBiasZ', label: '陀螺零偏 Z', unit: '°/s', min: -20, max: 20, step: 0.01, group: 'sensor', scale: RAD_SCALE, digits: 2 },
  { key: 'gyroNoise', label: '陀螺噪声', unit: '°/s', min: 0, max: 10, step: 0.05, group: 'sensor', scale: RAD_SCALE, digits: 2, hint: '1σ。加噪声能看出 D 项有多怕脏' },
  { key: 'accBiasX', label: '加计零偏 X', unit: 'm/s²', min: -1, max: 1, step: 0.01, group: 'sensor', digits: 3 },
  { key: 'accBiasY', label: '加计零偏 Y', unit: 'm/s²', min: -1, max: 1, step: 0.01, group: 'sensor', digits: 3 },
  { key: 'accBiasZ', label: '加计零偏 Z', unit: 'm/s²', min: -1, max: 1, step: 0.01, group: 'sensor', digits: 3 },
  { key: 'accScaleX', label: '加计比例 X', unit: '', min: 0.9, max: 1.1, step: 0.001, group: 'sensor', digits: 3 },
  { key: 'accScaleY', label: '加计比例 Y', unit: '', min: 0.9, max: 1.1, step: 0.001, group: 'sensor', digits: 3 },
  { key: 'accScaleZ', label: '加计比例 Z', unit: '', min: 0.9, max: 1.1, step: 0.001, group: 'sensor', digits: 3 },
  { key: 'accNoise', label: '加计噪声', unit: 'm/s²', min: 0, max: 2, step: 0.01, group: 'sensor', digits: 3 },
  { key: 'estAccWeight', label: '落地 acc 权重', unit: '', min: 0, max: 0.05, step: 0.0005, group: 'sensor', digits: 4, hint: 'EST_ACC_WEIGHT，静止时拉回重力的力度' },
  { key: 'estAccWeightInFlight', label: '飞行 acc 权重', unit: '', min: 0, max: 0.005, step: 0.0001, group: 'sensor', digits: 4, hint: 'EST_ACC_WEIGHT_FLT，0 = 纯陀螺积分，漂移无界' },
  { key: 'estRatesLpfAlpha', label: '角速率低通 α', unit: '', min: 0.02, max: 1, step: 0.01, group: 'sensor', digits: 2 },
  { key: 'levelWeight', label: '水平修正权重', unit: '', min: 0, max: 0.01, step: 0.0002, group: 'sensor', digits: 4, hint: '固件默认 0（关闭），它会把姿态强行拉平，与 trim 打架' },
  { key: 'levelBiasGain', label: '零偏学习增益', unit: '', min: 0, max: 0.01, step: 0.0002, group: 'sensor', digits: 4 },
]

export const GROUP_LABEL: Record<ParamGroup, string> = {
  attitude: '姿态环（外环）',
  rate: '角速率环（内环）',
  limit: '限幅与映射',
  plant: '机体物理',
  sensor: '传感器与估计',
  ctrl: '控制循环',
}

export function toDisplay(meta: ParamMeta, v: number): number {
  return v * (meta.scale ?? 1)
}

export function fromDisplay(meta: ParamMeta, v: number): number {
  return v / (meta.scale ?? 1)
}

/** 预设：方便快速对比"软/硬"两头的差别 */
export interface Preset {
  id: string
  name: string
  desc: string
  patch: Partial<SimParams>
}

export const PRESETS: Preset[] = [
  {
    id: 'cf',
    name: 'CF-Drone 出厂',
    desc: '固件 control.cpp 里的真实值，118mm 轴距整定结果',
    patch: { ...CF_DRONE_DEFAULTS },
  },
  {
    id: 'soft',
    name: '偏软（抗过冲）',
    desc: '姿态 P 降到 4、内环 P 减半，响应慢但不会冲过头',
    patch: { rollP: 4, pitchP: 4, rollRateP: 0.03, pitchRateP: 0.03, rollRateD: 0.002, pitchRateD: 0.002 },
  },
  {
    id: 'aggressive',
    name: '激进（快响应）',
    desc: '姿态 P 提到 10、内环 P 翻倍，跟手但容易振荡',
    patch: { rollP: 10, pitchP: 10, rollRateP: 0.12, pitchRateP: 0.12, rollRateD: 0.004, pitchRateD: 0.004 },
  },
  {
    id: 'heavy',
    name: '5 寸大机',
    desc: '换机体：700g / 250mm 轴距，看同一套 PID 换机器会怎样',
    patch: { mass: 0.7, wheelbase: 0.25, ixx: 0.0035, iyy: 0.0035, izz: 0.0065, thrustMax: 4.5, motorTau: 0.04 },
  },
]
