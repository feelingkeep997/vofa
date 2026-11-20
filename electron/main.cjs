// VOFA+ Web 桌面外壳
// 干三件事：起本地静态服务 → 开窗口 → 放行 Web Serial
const { app, BrowserWindow, Menu, session, shell, dialog } = require('electron')
const path = require('node:path')
const { startStaticServer } = require('./server.cjs')

// 默认走硬件加速；显卡驱动抽风时用「启动(兼容模式).cmd」（设 VOFA_SOFTWARE=1）强制软件渲染
if (process.env.VOFA_SOFTWARE === '1') app.disableHardwareAcceleration()

const isDev = !app.isPackaged && process.env.VOFA_DEV === '1'
const DIST = path.join(__dirname, '..', 'dist')

/** @type {{ port: number, close: () => void } | null} */
let server = null

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0b0b0b',
    title: 'VOFA+ Web · 串口波形调试台',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'vofa.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // 外链丢给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 白屏/加载失败时给个人话，而不是让人对着黑窗口发呆
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    dialog.showErrorBox('页面加载失败', `${code} ${desc}\n${url}\n\n可设环境变量 VOFA_DEVTOOLS=1 再启动查看控制台。`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    dialog.showErrorBox('渲染进程退出', JSON.stringify(details))
  })

  const url = isDev ? 'http://127.0.0.1:5180/' : `http://127.0.0.1:${server.port}/`
  await win.loadURL(url)
  if (process.env.VOFA_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  // ---- Web Serial 放行 ----
  const ses = session.defaultSession
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial')
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial')
  ses.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault()
    // 只有弹窗里选过的端口才会进来；没得选就给第一个，界面上还能再换
    const chosen = portList[0]
    callback(chosen ? chosen.portId : '')
  })

  if (!isDev) {
    const fixedPort = Number(process.env.VOFA_PORT) || 0
    server = await startStaticServer(DIST, fixedPort)
    console.log(`[vofa] serving ${DIST} on http://127.0.0.1:${server.port}/`)
  }

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (server) server.close()
  if (process.platform !== 'darwin') app.quit()
})
