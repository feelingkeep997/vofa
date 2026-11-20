/**
 * 从飞控源码里抠参数 —— 目标是「代码改了，仿真跟着变」，不用手工抄
 *
 * 能认的东西：
 *   #define PITCHRATE_P 0.06                 → 宏表
 *   #define ROLLRATE_P PITCHRATE_P            → 宏别名（递归求值）
 *   #define ROLL_I_LIM radians(5.0f)          → 支持 radians()/deg 后缀/四则运算
 *   float motThrMin = 0.10f;                  → 变量初值
 *   PID rollRatePID(A, B, C, WU, ALPHA);      → 构造参数顺序 → windup / dAlpha
 *   {"CTL_R_RATE_P", &rollRatePID.p},         → 固件参数名（CLI / MAVLink 里用的名字）
 *
 * 顺带能抓出固件里的坑：I 不为 0 却没传 windup → 积分被钳死（CF-Drone 的
 * yawRatePID 就踩过这个，注释里写着 2026-10-22 才修）。
 */

import type { SimParams } from './params'
import { DEG } from './quat'

/** 只挑 SimParams 里的数值字段 —— testAxis 那种字符串枚举不能当参数写 */
export type NumericKey = {
  [K in keyof SimParams]: SimParams[K] extends number ? K : never
}[keyof SimParams]

interface MacroDef {
  name: string
  body: string
  file: string
  line: number
}

export interface ParsedParam {
  key: NumericKey
  value: number
  /** 原始表达式，给用户核对 */
  source: string
  /** 固件里的参数名（parameters.cpp 里注册的），有就显示 */
  fwName?: string
}

export interface ParseResult {
  params: Partial<SimParams>
  items: ParsedParam[]
  warnings: string[]
  /** 解析出的宏名 → 原始表达式 */
  macros: Record<string, string>
  /** 解析失败/没找到的项 */
  missing: string[]
  /** 识别到的文件 */
  files: string[]
}

const MACRO_MAP: Record<string, NumericKey> = {
  ROLLRATE_P: 'rollRateP',
  ROLLRATE_I: 'rollRateI',
  ROLLRATE_D: 'rollRateD',
  ROLLRATE_I_LIM: 'rollRateWU',
  PITCHRATE_P: 'pitchRateP',
  PITCHRATE_I: 'pitchRateI',
  PITCHRATE_D: 'pitchRateD',
  PITCHRATE_I_LIM: 'pitchRateWU',
  YAWRATE_P: 'yawRateP',
  YAWRATE_I: 'yawRateI',
  YAWRATE_D: 'yawRateD',
  YAWRATE_I_LIM: 'yawRateWU',
  RATES_D_LPF_ALPHA: 'rateDAlpha',
  ROLL_P: 'rollP',
  ROLL_I: 'rollI',
  ROLL_D: 'rollD',
  ROLL_I_LIM: 'rollWU',
  PITCH_P: 'pitchP',
  PITCH_I: 'pitchI',
  PITCH_D: 'pitchD',
  PITCH_I_LIM: 'pitchWU',
  YAW_P: 'yawP',
  ROLLRATE_MAX: 'maxRateRoll',
  PITCHRATE_MAX: 'maxRatePitch',
  YAWRATE_MAX: 'maxRateYaw',
  TILT_MAX: 'tiltMax',
}

/** 固件参数名（parameters.cpp）→ 仿真字段，用于显示对照 */
const FW_NAME_MAP: Record<string, NumericKey> = {
  CTL_R_RATE_P: 'rollRateP',
  CTL_R_RATE_I: 'rollRateI',
  CTL_R_RATE_D: 'rollRateD',
  CTL_R_RATE_WU: 'rollRateWU',
  CTL_P_RATE_P: 'pitchRateP',
  CTL_P_RATE_I: 'pitchRateI',
  CTL_P_RATE_D: 'pitchRateD',
  CTL_P_RATE_WU: 'pitchRateWU',
  CTL_Y_RATE_P: 'yawRateP',
  CTL_Y_RATE_I: 'yawRateI',
  CTL_Y_RATE_D: 'yawRateD',
  CTL_Y_RATE_WU: 'yawRateWU',
  CTL_R_P: 'rollP',
  CTL_R_I: 'rollI',
  CTL_R_D: 'rollD',
  CTL_R_WU: 'rollWU',
  CTL_P_P: 'pitchP',
  CTL_P_I: 'pitchI',
  CTL_P_D: 'pitchD',
  CTL_P_WU: 'pitchWU',
  CTL_Y_P: 'yawP',
  CTL_P_RATE_MAX: 'maxRatePitch',
  CTL_R_RATE_MAX: 'maxRateRoll',
  CTL_Y_RATE_MAX: 'maxRateYaw',
  CTL_TILT_MAX: 'tiltMax',
  MOT_THR_MIN: 'motThrMin',
  MOT_THR_MAX: 'motThrMax',
}

/** 中文标签，给结果列表用 */
export const PARAM_CN: Partial<Record<NumericKey, string>> = {
  rollRateP: '横滚角速率 P',
  rollRateI: '横滚角速率 I',
  rollRateD: '横滚角速率 D',
  rollRateWU: '横滚角速率积分限幅',
  pitchRateP: '俯仰角速率 P',
  pitchRateI: '俯仰角速率 I',
  pitchRateD: '俯仰角速率 D',
  pitchRateWU: '俯仰角速率积分限幅',
  yawRateP: '偏航角速率 P',
  yawRateI: '偏航角速率 I',
  yawRateD: '偏航角速率 D',
  yawRateWU: '偏航角速率积分限幅',
  rateDAlpha: '角速率 D 项低通 α',
  rollP: '横滚姿态 P',
  rollI: '横滚姿态 I',
  rollD: '横滚姿态 D',
  rollWU: '横滚姿态积分限幅',
  pitchP: '俯仰姿态 P',
  pitchI: '俯仰姿态 I',
  pitchD: '俯仰姿态 D',
  pitchWU: '俯仰姿态积分限幅',
  yawP: '偏航姿态 P',
  maxRateRoll: '横滚最大角速率',
  maxRatePitch: '俯仰最大角速率',
  maxRateYaw: '偏航最大角速率',
  tiltMax: '自稳最大倾角',
  motThrMin: '怠速油门',
  motThrMax: '推力上限',
}

/* ---------------- 表达式求值（白名单，不 eval 任意代码） ---------------- */

function sanitizeNumeric(expr: string): string {
  let s = expr
  // radians(x) / RADIANS(x) / deg2rad(x)
  s = s.replace(/\bradians\s*\(([^()]*)\)/gi, `($1*${DEG})`)
  s = s.replace(/\bdeg2rad\s*\(([^()]*)\)/gi, `($1*${DEG})`)
  s = s.replace(/\brad2deg\s*\(([^()]*)\)/gi, `($1*${1 / DEG})`)
  // 浮点后缀 0.06f / 6.0F
  s = s.replace(/(\d(?:\.\d*)?(?:e[+-]?\d+)?)[fF]\b/g, '$1')
  return s.trim()
}

/** 只允许数字与四则运算，其余一律判失败 —— 不给任意代码执行的口子 */
const SAFE_EXPR = /^[0-9eE+\-*/(). ]+$/

function evalSafe(expr: string): number | null {
  const s = sanitizeNumeric(expr)
  if (!s || !SAFE_EXPR.test(s)) return null
  try {
    // eslint-disable-next-line no-new-func
    const v = new Function(`"use strict";return (${s})`)()
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function resolveMacro(name: string, macros: Map<string, MacroDef>, depth = 0): number | null {
  if (depth > 12) return null
  const def = macros.get(name)
  if (!def) return null
  let body = def.body
  // 先把 body 里引用到的其它宏替换成数值
  const ids = body.match(/[A-Za-z_]\w*/g) ?? []
  for (const id of ids) {
    if (id === 'radians' || id === 'deg2rad' || id === 'rad2deg') continue
    const sub = resolveMacro(id, macros, depth + 1)
    if (sub !== null) body = body.replace(new RegExp(`\\b${id}\\b`, 'g'), `(${sub})`)
  }
  return evalSafe(body)
}

/* ---------------- 主解析 ---------------- */

export interface SourceFile {
  name: string
  text: string
}

export function parseProject(files: SourceFile[]): ParseResult {
  const macros = new Map<string, MacroDef>()
  const params: Partial<SimParams> = {}
  const items: ParsedParam[] = []
  const warnings: string[] = []
  const missing: string[] = []
  const fwNames: Partial<Record<NumericKey, string>> = {}
  const macroText: Record<string, string> = {}

  // ---- 1. 扫宏 ----
  for (const f of files) {
    const lines = f.text.split(/\r?\n/)
    lines.forEach((raw, idx) => {
      const line = raw.replace(/\/\/.*$/, '')
      const m = line.match(/^\s*#\s*define\s+([A-Za-z_]\w*)\s+(.+?)\s*$/)
      if (!m) return
      macros.set(m[1], { name: m[1], body: m[2], file: f.name, line: idx + 1 })
      macroText[m[1]] = m[2]
    })
  }

  // ---- 2. 宏 → 参数 ----
  for (const [macroName, key] of Object.entries(MACRO_MAP)) {
    const def = macros.get(macroName)
    if (!def) {
      missing.push(macroName)
      continue
    }
    const v = resolveMacro(macroName, macros)
    if (v === null) {
      warnings.push(`${macroName} 的表达式「${def.body}」没能求值，已跳过`)
      continue
    }
    ;(params as Record<string, number>)[key] = v
    items.push({ key, value: v, source: `${macroName} = ${def.body}` })
  }

  // ---- 3. 变量初值（motThrMin / motThrMax 这类不是宏）----
  for (const f of files) {
    for (const key of ['motThrMin', 'motThrMax'] as const) {
      const re = new RegExp(`float\\s+${key}\\s*=\\s*([^;]+);`)
      const m = f.text.match(re)
      if (!m) continue
      const v = evalSafe(m[1])
      if (v === null) continue
      params[key] = v
      items.push({ key, value: v, source: `${key} = ${m[1].trim()}` })
    }
  }

  // ---- 4. PID 构造：抓 windup / dAlpha 的真实传参 ----
  for (const f of files) {
    const re = /PID\s+(\w+)\s*\(([^;]*?)\)\s*;/g
    let m: RegExpExecArray | null
    while ((m = re.exec(f.text))) {
      const inst = m[1]
      const args = m[2].split(',').map((a) => a.trim())
      if (args.length < 3) continue
      const val = (i: number): number | null => (i < args.length ? evalSafe(resolveInline(args[i], macros)) : null)

      const p = val(0)
      const i2 = val(1)
      const d = val(2)
      const wu = args.length > 3 ? val(3) : null
      const alpha = args.length > 4 ? val(4) : null

      const isRate = /Rate/i.test(inst)
      const prefix = /^roll/i.test(inst) ? 'roll' : /^pitch/i.test(inst) ? 'pitch' : /^yaw/i.test(inst) ? 'yaw' : null
      if (!prefix) continue

      const base = isRate ? `${prefix}Rate` : prefix
      const apply = (suffix: string, v: number | null) => {
        if (v === null) return
        const key = `${base}${suffix}` as NumericKey
        ;(params as Record<string, number>)[key] = v
        const exist = items.findIndex((it) => it.key === key)
        const item: ParsedParam = { key, value: v, source: `PID ${inst}(...)` }
        if (exist >= 0) items[exist] = item
        else items.push(item)
      }
      apply('P', p)
      apply('I', i2)
      apply('D', d)
      if (wu !== null) apply('WU', wu)
      if (alpha !== null && isRate) {
        params.rateDAlpha = alpha
        const exist = items.findIndex((it) => it.key === 'rateDAlpha')
        const item: ParsedParam = { key: 'rateDAlpha', value: alpha, source: `PID ${inst}(...) 第 5 参数` }
        if (exist >= 0) items[exist] = item
        else items.push(item)
      }

      // 坑检测：I 不为 0 但 windup 缺省/为 0 → 积分被钳死
      if (isRate && i2 !== null && i2 !== 0 && (wu === null || wu === 0)) {
        warnings.push(
          `${inst}：I=${i2} 但 windup ${wu === null ? '没传（默认 0）' : '= 0'} → 积分项被 clamp 到 ±0，等于 I 完全失效`,
        )
      }
      if (wu !== null && wu < 0) {
        warnings.push(`${inst}：windup 为负（${wu}），std::clamp(lo>hi) 是未定义行为`)
      }
    }
  }

  // ---- 5. parameters.cpp 的参数名对照 ----
  for (const f of files) {
    const re = /\{\s*"([A-Z0-9_]+)"\s*,\s*&(\w+)\.(\w+)\s*\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(f.text))) {
      const fwName = m[1]
      const key = FW_NAME_MAP[fwName]
      if (key) fwNames[key] = fwName
    }
  }
  for (const it of items) {
    const fw = fwNames[it.key]
    if (fw) it.fwName = fw
  }

  // ---- 6. 合理性检查 ----
  if (params.tiltMax !== undefined && params.tiltMax <= 0) warnings.push('TILT_MAX ≤ 0，自稳模式将无法倾斜')
  if (params.maxRateRoll !== undefined && params.maxRateRoll <= 0) warnings.push('ROLLRATE_MAX ≤ 0，横滚不可控')
  if (params.motThrMin !== undefined && params.motThrMax !== undefined && params.motThrMin >= params.motThrMax) {
    warnings.push(`怠速油门 ${params.motThrMin} ≥ 推力上限 ${params.motThrMax}，油门映射会反向`)
  }
  if (!items.length) warnings.push('没解析出任何参数 —— 确认选的是 control.cpp / parameters.cpp 这类源码')

  return {
    params,
    items: items.sort((a, b) => a.key.localeCompare(b.key)),
    warnings,
    macros: macroText,
    missing,
    files: files.map((f) => f.name),
  }
}

/** 单个实参求值：先试直接数字，再试宏 */
function resolveInline(arg: string, macros: Map<string, MacroDef>): string {
  const direct = evalSafe(arg)
  if (direct !== null) return String(direct)
  const v = resolveMacro(arg.trim(), macros)
  return v === null ? arg : String(v)
}
