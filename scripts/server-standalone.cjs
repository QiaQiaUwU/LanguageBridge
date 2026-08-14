#!/usr/bin/env node
/**
 * LanguageBridge 独立版服务器（打包成 .exe 用）——CommonJS 版本
 *
 * 跟 scripts/server-standalone.mjs 功能完全一样，这里用 CommonJS（require/module.exports）
 * 重写一遍，专门给 pkg 打包用：pkg 对 CommonJS 的字节码编译支持比 ESM（import/export）成熟很多，
 * 用 .mjs 打包时 pkg 的字节码编译会报 "Babel parse has failed: import.meta may appear only with..."
 * 这类警告，虽然大概率会退化成把源码原样塞进去、不影响运行，但没法在这台机器上跑 Windows 可执行文件
 * 验证到底行不行，与其赌它能不能跑，不如换 pkg 最擅长的写法，把不确定性降到最低。
 *
 * 跟 scripts/server.mjs（bat 启动用，会自动 npm install/build）的区别一样：
 * 这个文件不碰 npm/vite，只服务打包时已经构建好、跟着 exe 一起打包进去的 dist/ 目录。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const os = require('os')

const DIST = path.join(__dirname, 'dist')
const DEFAULT_PORT = 58712

/**
 * 数据目录 = exe 自己所在的那个文件夹。
 *
 * 不放进 exe 内部：pkg 打进去的东西是**只读快照**，而这个应用要往
 * resources/word_explanations/ 里写（AI 补全、收生词、改标签全都要写）。
 * 放外面还有个好处是词库看得见、能直接拿文件管理器翻、能整个拷走备份，
 * 这跟"词库是原本"那条一直没变。
 */
const APP_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..')
const RESOURCES_DIR = path.join(APP_DIR, 'resources')
const DATA_DIR = path.join(APP_DIR, 'data')

let dataApi = null
let dataStore = null
try {
  const { createDataStore } = require('./dataStore.cjs')
  const api = require('./dataApi.cjs')
  if (!fs.existsSync(RESOURCES_DIR)) fs.mkdirSync(RESOURCES_DIR, { recursive: true })
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  dataStore = createDataStore(APP_DIR, RESOURCES_DIR)
  dataApi = api.handleDataApi
  // exe 版本的音轨也存在 exe 旁边的 data/media/
  if (typeof api.setMediaRoot === 'function') api.setMediaRoot(APP_DIR)
} catch (e) {
  // 没有这两个模块时退化成纯静态服务（跟以前一样），但要说清楚，
  // 不能让用户对着一个查不到词的界面猜是哪里坏了
  console.warn('数据接口未装载，词库相关功能不可用：' + (e && e.message))
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
}

function readConfiguredPort() {
  const argPort = process.argv.find(a => a.indexOf('--port=') === 0)
  if (argPort) {
    const n = parseInt(argPort.split('=')[1], 10)
    if (n > 0) return n
  }
  try {
    const portFile = path.join(path.dirname(process.execPath), 'port.txt')
    if (fs.existsSync(portFile)) {
      const n = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10)
      if (n > 0) return n
    }
  } catch (e) {
    /* 忽略，用默认端口 */
  }
  return DEFAULT_PORT
}

function tryPort(port) {
  return new Promise(resolve => {
    const srv = http.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '0.0.0.0')
  })
}
async function findFreePort(start) {
  let port = start
  for (let i = 0; i < 50; i++) {
    if (await tryPort(port)) return port
    port++
  }
  throw new Error('未找到空闲端口')
}

function openBrowser(url) {
  const platform = process.platform
  if (platform === 'win32') {
    exec('rundll32 url.dll,FileProtocolHandler ' + url, err => {
      if (err) exec('start "" "' + url + '"')
    })
    return
  }
  const cmd = platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"'
  exec(cmd)
}

function getLocalIP() {
  const nets = os.networkInterfaces()
  const candidates = []
  Object.keys(nets).forEach(name => {
    if (/^(vEthernet|VMware|VirtualBox|Loopback|docker|veth)/i.test(name)) return
    ;(nets[name] || []).forEach(net => {
      if (net.family === 'IPv4' && !net.internal) candidates.push(net.address)
    })
  })
  candidates.sort((a, b) => {
    function score(ip) {
      if (ip.indexOf('192.168.') === 0) return 0
      if (ip.indexOf('10.') === 0) return 1
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2
      return 3
    }
    return score(a) - score(b)
  })
  return candidates[0] || '127.0.0.1'
}

function handleAiProxy(req, res) {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body)
      const url = parsed.url
      const method = parsed.method
      const headers = parsed.headers
      const payload = parsed.payload
      if (!url || typeof url !== 'string') throw new Error('缺少目标地址')
      const reqMethod = method === 'GET' ? 'GET' : 'POST'
      const upstream = await fetch(url, {
        method: reqMethod,
        headers: headers || {},
        body: reqMethod === 'GET' ? undefined : JSON.stringify(payload)
      })
      const text = await upstream.text()
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8'
      })
      res.end(text)
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ __proxyError: e instanceof Error ? e.message : String(e) }))
    }
  })
}

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error('找不到 dist 目录，这个 .exe 可能打包不完整（缺了前端构建产物）')
    console.error('按任意键退出…')
    process.stdin.once('data', () => process.exit(1))
    return
  }

  const preferred = readConfiguredPort()
  const port = await findFreePort(preferred)
  if (port !== preferred) console.log('端口 ' + preferred + ' 被占用，改用 ' + port)

  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0])

      if (req.method === 'POST' && urlPath === '/__ai_proxy') {
        handleAiProxy(req, res)
        return
      }
      // 词库 / 学习数据接口。跟 npm start 那条路走的是同一份实现。
      if (dataApi && urlPath.indexOf('/api/') === 0) {
        const handled = await dataApi(req, res, dataStore, urlPath)
        if (handled) return
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'not found' }))
        return
      }
      if (req.method === 'GET' && urlPath === '/__serverinfo') {
        const ip = getLocalIP()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ lan_url: 'http://' + ip + ':' + port + '/', ip: ip, port: port }))
        return
      }

      let filePath = path.join(DIST, urlPath)
      const exists = fs.existsSync(filePath)
      const st = exists ? fs.statSync(filePath) : null
      const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath)

      if (st && !st.isDirectory()) {
        // 文件真实存在
      } else if (!hasExt) {
        filePath = path.join(DIST, 'index.html') // 页面路由回退
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }

      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(data)
    } catch (e) {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  server.listen(port, '0.0.0.0', () => {
    const url = 'http://127.0.0.1:' + port
    const lanIp = getLocalIP()
    console.log('========================================')
    console.log('LanguageBridge 已启动：' + url)
    if (lanIp !== '127.0.0.1') console.log('同一 WiFi 下的手机/平板可以访问：http://' + lanIp + ':' + port + '/')
    console.log('如果没有自动弹出浏览器，请手动复制上面这个网址打开')
    console.log('词库目录：' + RESOURCES_DIR)
    console.log('关闭这个窗口即可停止服务')
    console.log('========================================')
    openBrowser(url)
  })

  process.on('SIGINT', () => {
    console.log('\n正在停止服务...')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000)
  })
}

main().catch(function (e) {
  console.error(e)
  process.exit(1)
})
