import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { requestPersistentStorage } from '@/shared/core/storagePersistence'
import 'remixicon/fonts/remixicon.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

function showFatal(kind: string, err: unknown) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : ''
  console.error(`[${kind}]`, err)
  let box = document.getElementById('lb-fatal')
  if (!box) {
    box = document.createElement('div')
    box.id = 'lb-fatal'
    box.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:99999;max-width:min(560px,86vw);' +
      'background:#fff4f0;border:1px solid #e6b8a8;border-radius:10px;padding:12px 14px;' +
      'font:12.5px/1.6 ui-monospace,Consolas,monospace;color:#8a3a22;white-space:pre-wrap;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.12);cursor:pointer'
    box.title = '点一下关闭'
    box.onclick = () => box?.remove()
    document.body.appendChild(box)
  }
  box.textContent = `【${kind}】${msg}\n${stack}\n（点一下关闭）`
}

app.config.errorHandler = (err, _instance, info) => showFatal(`渲染出错 ${info}`, err)
window.addEventListener('error', e => showFatal('脚本错误', e.error || e.message))
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
  // 浏览器本地数据库文件损坏或被外部删除。这不是代码错，重试也没用，
  // 只能提示重建；不加这条的话用户只会看到一句英文报错。
  if (/NotReadableError|Data lost due to missing file|backing store/i.test(msg)) {
    showFatal(
      '本地数据库损坏',
      new Error(
        '浏览器的本地数据库文件丢失或损坏，这一条记录已经读不出来了。\n' +
        '常见原因：应用运行时数据目录被清理、磁盘满、或异常断电。\n' +
        '可以在「设置 → 数据」里导出还能读的部分，然后清空本地数据重新导入。'
      )
    )
    return
  }
  showFatal('未捕获的 Promise', e.reason)
})
const RELOAD_KEY = 'lb-chunk-reloaded-at'
router.onError((err, to) => {
  const msg = err instanceof Error ? err.message : String(err)
  const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg)
  if (stale) {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last > 10000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      location.replace(to?.fullPath || location.pathname)
      return
    }
    showFatal('版本已更新', new Error('页面里的旧版本文件已被新构建替换。已尝试自动刷新但仍失败，请关掉窗口重新打开。'))
    return
  }
  showFatal('页面加载失败', err)
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
    })
  })
}

requestPersistentStorage()

app.mount('#app')
