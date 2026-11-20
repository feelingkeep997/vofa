// 把 dist + electron 壳打成免安装桌面版（release/VOFA+ Web/）
import { cpSync, existsSync, mkdirSync, rmSync, renameSync, writeFileSync, copyFileSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.resolve(import.meta.dirname, '..')
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')
const OUT = path.join(ROOT, 'release', 'VOFA+ Web')
const EXE_NAME = 'VOFA+ Web.exe'

if (!existsSync(ELECTRON_DIST)) {
  console.error('找不到 node_modules/electron/dist，先 npm i -D electron')
  process.exit(1)
}
if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('找不到 dist/index.html，先 npm run build')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

// 不整体删 release（250MB，安全删除垫片会卡住），只重建应用目录
mkdirSync(OUT, { recursive: true })
const staleApp = path.join(OUT, 'resources', 'app')
if (existsSync(staleApp)) rmSync(staleApp, { recursive: true, force: true, maxRetries: 3 })

console.log('拷贝 Electron 运行时 …')
cpSync(ELECTRON_DIST, OUT, { recursive: true })

// 默认的欢迎页不需要
const defaultApp = path.join(OUT, 'resources', 'default_app.asar')
if (existsSync(defaultApp)) rmSync(defaultApp, { force: true })

console.log('放入应用代码 …')
const appDir = path.join(OUT, 'resources', 'app')
mkdirSync(appDir, { recursive: true })
cpSync(path.join(ROOT, 'dist'), path.join(appDir, 'dist'), { recursive: true })
cpSync(path.join(ROOT, 'electron'), path.join(appDir, 'electron'), { recursive: true })
// 窗口图标：main.cjs 里按 ../build/vofa.ico 找
cpSync(path.join(ROOT, 'build'), path.join(appDir, 'build'), { recursive: true })
writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify(
    { name: 'vofa-web', productName: 'VOFA+ Web', version: pkg.version, main: 'electron/main.cjs' },
    null,
    2,
  ),
)

const ico = path.join(ROOT, 'build', 'vofa.ico')
if (existsSync(ico)) copyFileSync(ico, path.join(OUT, 'vofa.ico'))

// 兼容模式：GPU 驱动闹脾气时用这个，强制软件渲染
writeFileSync(
  path.join(OUT, '启动(兼容模式).cmd'),
  [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'rem 主程序闪退/白屏时用这个：关 GPU、关 Chromium 沙箱',
    'start "" "VOFA+ Web.exe" --disable-gpu --disable-gpu-compositing --no-sandbox',
    '',
  ].join('\r\n'),
)

// electron.exe → VOFA+ Web.exe
const oldExe = path.join(OUT, 'electron.exe')
if (existsSync(oldExe)) renameSync(oldExe, path.join(OUT, EXE_NAME))

/* ---- 桌面快捷方式 ---- */
const desktop = path.join(os.homedir(), 'Desktop')
const lnk = path.join(desktop, 'VOFA+ Web.lnk')
const q = (s) => `'${s.replace(/'/g, "''")}'`
const ps = [
  '$ws = New-Object -ComObject WScript.Shell',
  `$s = $ws.CreateShortcut(${q(lnk)})`,
  `$s.TargetPath = ${q(path.join(OUT, EXE_NAME))}`,
  `$s.WorkingDirectory = ${q(OUT)}`,
  `$s.IconLocation = ${q(path.join(OUT, 'vofa.ico'))}`,
  "$s.Description = 'VOFA+ Web 串口波形调试台'",
  '$s.WindowStyle = 1',
  '$s.Save()',
].join('\n')

try {
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' })
  console.log(`桌面快捷方式 → ${lnk}`)
} catch (err) {
  console.warn('快捷方式创建失败：', err.message)
}

let bytes = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else bytes += statSync(p).size
  }
}
walk(OUT)

console.log(`\n完成：${OUT}`)
console.log(`  可执行：${EXE_NAME}`)
console.log(`  体积：${(bytes / 1024 / 1024).toFixed(1)} MB`)
