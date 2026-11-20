// 姿态仿真页冒烟测试：进页面 → 跑阶跃 → 实时打杆
// 注意窗口必须可见或关掉后台节流，否则 rAF 被 Chromium 限到 1fps，仿真时间根本走不动
const { app, BrowserWindow, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { startStaticServer } = require('../electron/server.cjs')

app.disableHardwareAcceleration()

const outDir = path.join(__dirname, '..', '.re-work')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const ses = session.defaultSession
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial')

  const server = await startStaticServer(path.join(__dirname, '..', 'dist'))

  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    show: false,
    backgroundColor: '#0b0b0b',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  win.webContents.setBackgroundThrottling(false)

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`))

  await win.loadURL(`http://127.0.0.1:${server.port}/`)
  await sleep(1200)

  const frames = (n = 2) =>
    win.webContents.executeJavaScript(
      `new Promise(r => { let i = 0; const t = () => (++i >= ${n} ? r(1) : requestAnimationFrame(t)); requestAnimationFrame(t) })`,
    )

  const shot = async (name) => {
    await frames(3)
    const img = await win.webContents.capturePage()
    fs.mkdirSync(outDir, { recursive: true })
    const p = path.join(outDir, name)
    fs.writeFileSync(p, img.toPNG())
    console.log('shot →', name)
  }

  const clickByText = (sel, text) =>
    win.webContents.executeJavaScript(`
      (() => {
        const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
          .find(b => b.textContent && b.textContent.includes(${JSON.stringify(text)}))
        if (!el) return 'NOT_FOUND'
        el.click()
        return 'OK'
      })()
    `)

  console.log('tab:', await clickByText('.tabs button', '姿态仿真'))
  await sleep(800)
  await shot('sim-1-enter.png')

  console.log('step:', await clickByText('.sim-toolbar button', '阶跃测试'))
  await sleep(1500)
  await shot('sim-2-step.png')
  console.log(
    'metrics:',
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.sim-metrics .metric')].map(m => m.textContent.trim()).join(' | ')`,
    ),
  )

  // 实时 + 打杆：右摇杆推到右上（roll 右倾 + 机头下压）
  console.log('start:', await clickByText('.sim-toolbar button', '开始'))
  await sleep(400)
  await win.webContents.executeJavaScript(`
    (() => {
      const pads = document.querySelectorAll('.stick-pad')
      const pad = pads[1]
      const r = pad.getBoundingClientRect()
      const opt = { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: r.left + r.width * 0.82, clientY: r.top + r.height * 0.22 }
      pad.dispatchEvent(new PointerEvent('pointerdown', opt))
      pad.dispatchEvent(new PointerEvent('pointermove', opt))
      return 'dragged'
    })()
  `)
  await sleep(2000)
  await shot('sim-3-live.png')
  console.log(
    'live metrics:',
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.sim-metrics .metric')].map(m => m.textContent.trim()).join(' | ')`,
    ),
  )
  console.log(
    'trace samples:',
    await win.webContents.executeJavaScript(
      `(() => { const c = document.querySelector('.trace-canvas'); return c ? c.width + 'x' + c.height : 'none' })()`,
    ),
  )

  // ACRO 模式：杆量直接给角速率，跳过姿态环
  console.log('acro:', await clickByText('.sim-toolbar button', 'ACRO'))
  await sleep(1500)
  await shot('sim-4-acro.png')
  console.log('acro state:', await win.webContents.executeJavaScript(
    `(() => { const t = document.querySelector('.sim-3d-tag'); return t ? t.textContent : 'none' })()`))

  console.log('errors:', errors.length ? JSON.stringify(errors.slice(0, 4)) : 'none')
  server.close()
  app.quit()
})
