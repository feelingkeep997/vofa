// IMU 标定流程冒烟：进姿态页 → 粘贴数据 → 标定 → 应用 → 跑 10 秒看估计漂移
const { app, BrowserWindow, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { startStaticServer } = require('../electron/server.cjs')

app.disableHardwareAcceleration()
const outDir = path.join(__dirname, '..', '.re-work')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DATA = [
  '0.0573,-0.0184,9.8097,18.526,-11.906,17.453,0.0986,-0.0833,-0.8258,0.0000,0.0000,-1.0000,0.0,0.0000,0.0000,0.0000,0.0000',
  '0.0611,-0.0155,9.8102,18.401,-11.822,17.509,0.0989,-0.0831,-0.8256,0.0000,0.0000,-1.0000,0.0,0.0000,0.0000,0.0000,0.0000',
  '0.0549,-0.0201,9.8088,18.612,-11.977,17.398,0.0992,-0.0836,-0.8261,0.0000,0.0000,-1.0000,0.0,0.0000,0.0000,0.0000,0.0000',
].join('\n')

app.whenReady().then(async () => {
  const ses = session.defaultSession
  ses.setPermissionCheckHandler((_wc, p) => p === 'serial')
  const server = await startStaticServer(path.join(__dirname, '..', 'dist'))

  const win = new BrowserWindow({
    width: 1500, height: 940, show: false, backgroundColor: '#0b0b0b',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  win.webContents.setBackgroundThrottling(false)

  const errors = []
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg) })

  await win.loadURL(`http://127.0.0.1:${server.port}/`)
  await sleep(1200)

  const frames = (n = 3) => win.webContents.executeJavaScript(
    `new Promise(r => { let i = 0; const t = () => (++i >= ${n} ? r(1) : requestAnimationFrame(t)); requestAnimationFrame(t) })`)
  const shot = async (name) => {
    await frames(3)
    const img = await win.webContents.capturePage()
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, name), img.toPNG())
    console.log('shot →', name)
  }
  const click = (sel, text) => win.webContents.executeJavaScript(`
    (() => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent && b.textContent.includes(${JSON.stringify(text)}))
      if (!el) return 'NOT_FOUND'; el.click(); return 'OK'
    })()`)

  console.log('tab:', await click('.tabs button', '姿态仿真'))
  await sleep(800)

  console.log('paste-open:', await click('.imu-calib button', '粘贴'))
  await sleep(300)

  await win.webContents.executeJavaScript(`
    (() => {
      const ta = document.querySelector('.imu-calib textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(DATA)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 'typed'
    })()`)
  await sleep(200)
  console.log('calib:', await click('.imu-calib .btn', '标定'))
  await sleep(700)

  // 滚到标定结果
  await win.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('.ic-result'); if (el) el.scrollIntoView({ block: 'center' }); return !!el })()`)
  await sleep(300)
  await shot('imu-1-calib.png')

  console.log('result:', await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.ic-row')].map(r => r.textContent.trim()).join(' | ')`))
  console.log('verdict:', await win.webContents.executeJavaScript(
    `(() => { const e = document.querySelector('.ic-verdict'); return e ? e.textContent.trim() : 'none' })()`))

  console.log('apply:', await click('.ic-result .btn', '应用到仿真'))
  await sleep(400)

  // 回顶部，跑起来
  await win.webContents.executeJavaScript(`document.querySelector('.sim-side').scrollTop = 0`)
  console.log('start:', await click('.sim-toolbar button', '开始'))
  await sleep(4000)
  console.log('est mode:', await click('.sim-toolbar button', '估计'))
  await sleep(1500)
  await shot('imu-2-drift.png')

  console.log('errors:', errors.length ? JSON.stringify(errors.slice(0, 3)).slice(0, 200) : 'none')
  server.close()
  app.quit()
})
