// 临时验证脚本：把 TS 内核打成 ESM 后直接跑
// 1) 解析 CF-Drone 真实源码，核对参数
// 2) 用默认参数跑阶跃测试，看指标是否合理
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve('.')
const out = path.join(root, '.tmp-sim')
await build({
  entryPoints: [
    path.join(root, 'src/lib/sim/parseProject.ts'),
    path.join(root, 'src/lib/sim/engine.ts'),
    path.join(root, 'src/lib/sim/params.ts'),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: out,
  outExtension: { '.js': '.mjs' },
  logLevel: 'error',
})

const imp = (f) => import(pathToFileURL(path.join(out, f)).href)
const { parseProject } = await imp('parseProject.mjs')
const { runStepTest } = await imp('engine.mjs')
const { CF_DRONE_DEFAULTS } = await imp('params.mjs')

const SRC = 'D:/esp32/esp32project/CF-Drone-main'
const control = fs.readFileSync(path.join(SRC, 'application/control.cpp'), 'utf8')
const parameters = fs.readFileSync(path.join(SRC, 'application/parameters.cpp'), 'utf8')

const r = parseProject([
  { name: 'control.cpp', text: control },
  { name: 'parameters.cpp', text: parameters },
])

console.log('=== 解析结果 ===')
for (const it of r.items) {
  console.log(
    `${String(it.key).padEnd(14)} = ${String(it.value).padEnd(14)} ${it.fwName ? `[${it.fwName}]` : ''}  ${it.source}`,
  )
}
console.log('\n=== 警告 ===')
if (r.warnings.length) r.warnings.forEach((w) => console.log('  ! ' + w))
else console.log('  (无)')
console.log('\n=== 未找到 ===')
console.log('  ' + (r.missing.join(', ') || '(无)'))

console.log('\n=== 与出厂默认值对比 ===')
for (const it of r.items) {
  const d = CF_DRONE_DEFAULTS[it.key]
  if (typeof d === 'number') {
    const same = Math.abs(d - it.value) < 1e-9
    if (!same) console.log(`  ${String(it.key).padEnd(14)} 默认 ${d}  vs  解析 ${it.value}`)
  }
}

console.log('\n=== 阶跃测试（默认参数，roll 15°）===')
const m = runStepTest(CF_DRONE_DEFAULTS, 'roll', 15, 3)
console.log(
  `  上升时间 ${m.riseTime?.toFixed(3) ?? '—'} s | 超调 ${m.overshoot.toFixed(1)}% | ` +
    `调节时间 ${m.settlingTime?.toFixed(3) ?? '—'} s | 稳态误差 ${m.steadyError.toFixed(3)}° | ` +
    `峰值 ${m.peak.toFixed(2)}° | 振荡 ${m.oscillations} 次 | ${m.unstable ? '发散!' : '稳定'}`,
)

console.log('\n=== 同样 15° 但把内环 P 砍到 1/4 ===')
const m2 = runStepTest({ ...CF_DRONE_DEFAULTS, rollRateP: 0.015 }, 'roll', 15, 3)
console.log(
  `  上升时间 ${m2.riseTime?.toFixed(3) ?? '—'} s | 超调 ${m2.overshoot.toFixed(1)}% | ` +
    `调节时间 ${m2.settlingTime?.toFixed(3) ?? '—'} s | 稳态误差 ${m2.steadyError.toFixed(3)}°`,
)

console.log('\n=== 内环 P 翻 4 倍 ===')
const m3 = runStepTest({ ...CF_DRONE_DEFAULTS, rollRateP: 0.24 }, 'roll', 15, 3)
console.log(
  `  上升时间 ${m3.riseTime?.toFixed(3) ?? '—'} s | 超调 ${m3.overshoot.toFixed(1)}% | ` +
    `调节时间 ${m3.settlingTime?.toFixed(3) ?? '—'} s | 稳态误差 ${m3.steadyError.toFixed(3)}° | ` +
    `${m3.unstable ? '发散!' : '稳定'}`,
)
