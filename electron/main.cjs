/**
 * Electron 主进程。
 *
 * 扩展名必须是 .cjs：package.json 里写了 "type": "module"，
 * 叫 main.js 的话 Node 会按 ESM 解析，require 一上来就报
 * "require is not defined in ES module scope"。
 *
 * 做两件事：
 *  1. 起一个正常的应用窗口，装的还是原来那个网页（前端代码一行没改）
 *  2. 再起一个无边框、置顶、透明的小窗口当桌面悬浮球 —— 这是浏览器做不到的部分
 *
 * 服务端仍然是 scripts/server.mjs 那一套，这里只负责把它拉起来并读 port.txt。
 * 所以「浏览器里跑」和「装成桌面应用」共用同一套后端和数据，不会分叉。
 */
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
/** 每天几点之后提醒复习 */
const REMIND_HOUR = 9
const PORT_FILE = join(ROOT, 'port.txt')

let mainWin = null
let ballWin = null
let serverProc = null

/** 等 server.mjs 把端口写出来 */
function waitForPort(timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (existsSync(PORT_FILE)) {
        const n = parseInt(readFileSync(PORT_FILE, 'utf-8').trim(), 10)
        if (n > 0) return resolve(n)
      }
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('服务没能在 60 秒内起来，看看命令行窗口里的报错'))
      }
      setTimeout(tick, 300)
    }
    tick()
  })
}

function startServer() {
  // 用 Electron 自带的 Node 跑 server.mjs，用户机器上不用另外装 Node
  serverProc = spawn(process.execPath, [join(ROOT, 'scripts', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LB_NO_OPEN_BROWSER: '1' },
    stdio: 'inherit'
  })
  serverProc.on('exit', code => {
    if (code && code !== 0) console.error('服务退出，退出码', code)
  })
}

function createMain(port) {
  mainWin = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'LanguageBridge',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true }
  })
  mainWin.loadURL(`http://127.0.0.1:${port}/`)
  mainWin.on('closed', () => { mainWin = null; syncBall() })

  /**
   * 悬浮球只在主窗口不可见时出现。
   * 窗口开着的时候界面里已经有 FloatingAgentButton 了，再浮一个在桌面上就是重复。
   */
  mainWin.on('minimize', syncBall)
  mainWin.on('restore', syncBall)
  mainWin.on('show', syncBall)
  mainWin.on('hide', syncBall)
  mainWin.on('focus', syncBall)
  mainWin.on('blur', syncBall)

  // 外部链接走系统浏览器，不要在应用里打开
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

/**
 * 桌面悬浮球。
 *
 * frame:false + transparent + alwaysOnTop 是浮在桌面上的三件套；
 * setIgnoreMouseEvents(true, { forward: true }) 让球以外的透明区域点击穿透，
 * 否则这个窗口会挡住底下的东西。球本身要能点，所以渲染进程在鼠标移到球上时
 * 通过 IPC 把穿透临时关掉。
 */
/** 主窗口看不见时才显示球 */
function syncBall() {
  if (!ballWin) return
  const hidden = !mainWin || mainWin.isDestroyed() || mainWin.isMinimized() || !mainWin.isVisible()
  if (hidden) ballWin.showInactive()
  else ballWin.hide()
}

function createBall(port) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  ballWin = new BrowserWindow({
    width: 220,
    height: 220,
    x: width - 260,
    y: height - 260,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, 'preload.cjs')
    }
  })
  ballWin.setAlwaysOnTop(true, 'floating')
  ballWin.hide()   // 一开始主窗口是开着的，球不该出现
  ballWin.loadFile(join(__dirname, 'ball.html'))
  // 默认穿透，鼠标压到球上时渲染进程会喊停
  ballWin.setIgnoreMouseEvents(true, { forward: true })
  ballWin.on('closed', () => { ballWin = null })

  ipcMain.on('ball:mouse', (_e, overBall) => {
    if (!ballWin) return
    ballWin.setIgnoreMouseEvents(!overBall, { forward: true })
  })

  /** 长按球 → 打开对话窗口（主窗口并跳到助手） */
  ipcMain.on('ball:open-chat', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.show()
      mainWin.focus()
      mainWin.webContents.executeJavaScript('window.__lbOpenAgent && window.__lbOpenAgent()').catch(() => {})
    } else {
      createMain(port)
      mainWin.webContents.once('did-finish-load', () => {
        mainWin.webContents.executeJavaScript('window.__lbOpenAgent && window.__lbOpenAgent()').catch(() => {})
      })
    }
  })

  /** 球上的播放控制转发给主窗口里的页面 */
  ipcMain.on('ball:media', (_e, action) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents
        .executeJavaScript(`window.__lbMedia && window.__lbMedia(${JSON.stringify(action)})`)
        .catch(() => {})
    }
  })

  /**
   * 每天提醒一次。
   *
   * 不用系统通知，就在球上点一个数字角标 —— 通知弹一下就没了，
   * 角标一直在那儿，反而更管用。每天只在第一次到点时弹一次面板，
   * 之后只留角标。
   */
  let lastRemindDay = ''

  async function pollDue() {
    if (!mainWin || mainWin.isDestroyed()) return
    try {
      const n = await mainWin.webContents.executeJavaScript(
        'window.__lbDueCount ? window.__lbDueCount() : 0'
      )
      if (!ballWin || ballWin.isDestroyed()) return
      ballWin.webContents.send('ball:due', n)

      const today = new Date().toISOString().slice(0, 10)
      const hour = new Date().getHours()
      // 每天固定时间之后提醒一次，太早不打扰
      if (n > 0 && hour >= REMIND_HOUR && lastRemindDay !== today) {
        lastRemindDay = today
        ballWin.showInactive()
        ballWin.webContents.send('ball:remind', n)
      }
    } catch {
      /* 页面还没加载好，下一轮再问 */
    }
  }

  setInterval(pollDue, 5 * 60 * 1000)
  setTimeout(pollDue, 8000)

  /**
   * 自定义定时提醒（"每 30 分钟提醒我喝水"这类）。
   *
   * 跟上面那个每日复习提醒分开：那个一天一次、按到期词数；
   * 这个是用户自己设的间隔，到点就推。页面侧 dueReminders() 取出的同时
   * 会把下一次时间往后推，所以这里不需要自己记状态。
   */
  async function pollReminders() {
    if (!mainWin || mainWin.isDestroyed()) return
    try {
      const list = await mainWin.webContents.executeJavaScript(
        'window.__lbDueReminders ? window.__lbDueReminders() : []'
      )
      if (!Array.isArray(list) || !list.length) return
      if (!ballWin || ballWin.isDestroyed()) return
      ballWin.showInactive()
      ballWin.webContents.send('ball:reminders', list)
    } catch {
      /* 页面还没就绪，下一轮再问 */
    }
  }
  setInterval(pollReminders, 60 * 1000)

  /**
   * 有没有音频在播 —— 决定长按能不能调出操作台。
   * 播客在后台放着的时候才需要那个面板，闲着的时候给个空面板没意义。
   */
  async function pollAudio() {
    if (!mainWin || mainWin.isDestroyed() || !ballWin || ballWin.isDestroyed()) return
    try {
      const info = await mainWin.webContents.executeJavaScript(
        'window.__lbNowPlaying ? window.__lbNowPlaying() : { playing: false }'
      )
      ballWin.webContents.send('ball:audio', info)
    } catch {
      /* 页面还没就绪，下一轮再问 */
    }
  }
  setInterval(pollAudio, 2000)

  ipcMain.on('ball:open-app', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.show()
      mainWin.focus()
    } else {
      createMain(port)
    }
  })

  ipcMain.on('ball:resize', (_e, w, h) => {
    if (ballWin) ballWin.setSize(Math.round(w), Math.round(h))
  })
}

app.whenReady().then(async () => {
  startServer()
  try {
    const port = await waitForPort()
    createMain(port)
    createBall(port)
    syncBall()
  } catch (e) {
    const { dialog } = require('electron')
    dialog.showErrorBox('启动失败', e.message)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // 悬浮球关掉主窗口后还留着，所以这里不自动退出（macOS 习惯也是如此）
  if (process.platform !== 'darwin' && !ballWin) app.quit()
})

app.on('before-quit', () => {
  if (serverProc && !serverProc.killed) serverProc.kill()
})
