// 冒烟测试：起本地服务 → 加载 dist → 截图存盘（不属于发布产物）
const { app, BrowserWindow, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { startStaticServer } = require('../electron/server.cjs')

app.disableHardwareAcceleration()

const out = process.argv[2] || path.join(__dirname, '..', '.re-work', 'electron-shot.png')

app.whenReady().then(async () => {
  const ses = session.defaultSession
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial')

  const server = await startStaticServer(path.join(__dirname, '..', 'dist'))

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0b0b0b',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`))

  await win.loadURL(`http://127.0.0.1:${server.port}/`)
  await new Promise((r) => setTimeout(r, 3500))
  const img = await win.webContents.capturePage()
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, img.toPNG())

  console.log('shot →', out)
  console.log('errors:', errors.length ? JSON.stringify(errors) : 'none')
  console.log('serial api:', await win.webContents.executeJavaScript('typeof navigator.serial'))
  console.log('title:', await win.webContents.executeJavaScript('document.title'))
  server.close()
  app.quit()
})
