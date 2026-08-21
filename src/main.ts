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

/**
 * 本地数据库损坏时的自救面板。
 *
 * 只给一句"去设置里导出"是没用的：库坏到读不出来的时候，设置页本身也进不去。
 * 这里直接把两个动作放在提示上 —— 先抢救导出，再重建。重建之后可以从导出的
 * 文件或后端恢复。整页只弹一次。
 */
let dbBrokenShown = false
function showDbBroken() {
  if (dbBrokenShown) return
  dbBrokenShown = true

  const box = document.createElement('div')
  box.style.cssText =
    'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(15,17,21,.55);backdrop-filter:blur(3px)'
  box.innerHTML =
    '<div style="max-width:min(560px,88vw);background:#fff;border-radius:14px;padding:24px 26px;' +
    'font:14px/1.75 system-ui,\'PingFang SC\',sans-serif;color:#1f2328;box-shadow:0 12px 40px rgba(0,0,0,.25)">' +
    '<div style="font-size:17px;font-weight:600;margin-bottom:10px">有记录读不出来</div>' +
    '<div style="color:#5b6570">浏览器返回了 NotReadableError。<b>多数情况下你的数据还在</b> —— ' +
    '这个错常常是数据库升级中断的连带反应，而不是文件真的坏了。已经改成逐条读取，' +
    '读不出来的那几条会自动跳过，其余照常加载。</div>' +
    '<div style="color:#5b6570;margin-top:10px">先去看看词库和文章是不是都在。' +
    '如果都在，点「先不管」继续用就行。只有确实缺东西时才需要抢救导出并重建。</div>' +
    '<div id="lb-db-msg" style="margin-top:12px;color:#8a5a2a"></div>' +
    '<div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">' +
    '<button id="lb-db-close" style="border:none;background:#1f2328;color:#fff;border-radius:8px;padding:8px 14px;cursor:pointer">先不管</button>' +
    '<button id="lb-db-dump" style="border:1px solid #dfe3e8;background:#fff;border-radius:8px;padding:8px 14px;cursor:pointer">抢救导出</button>' +
    '<button id="lb-db-reset" style="border:1px solid #e0c4c0;background:#fff;color:#b5493c;border-radius:8px;padding:8px 14px;cursor:pointer">重建数据库</button>' +
    '</div></div>'
  document.body.appendChild(box)

  const msg = box.querySelector('#lb-db-msg') as HTMLElement
  box.querySelector('#lb-db-close')?.addEventListener('click', () => box.remove())

  box.querySelector('#lb-db-dump')?.addEventListener('click', async () => {
    msg.textContent = '正在逐条抢救，坏记录会跳过…'
    try {
      const { wordDB, salvageReport } = await import('@/shared/core/database')
      const dump: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        note: '本地数据库损坏时的抢救导出，可能不完整'
      }
      for (const [key, fn] of [
        ['words', () => wordDB.getAllWords()],
        ['groups', () => wordDB.getAllGroups()],
        ['articles', () => wordDB.getAllArticles()],
        ['wrongBook', () => wordDB.getAllWrongBook()]
      ] as [string, () => Promise<unknown>][]) {
        try {
          dump[key] = await fn()
        } catch {
          dump[key] = []
        }
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `LanguageBridge-抢救导出-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      msg.textContent = salvageReport.skipped
        ? `导出完成，有 ${salvageReport.skipped} 条记录读不出来已跳过。`
        : '导出完成。'
    } catch (e) {
      msg.textContent = '抢救导出失败：' + (e instanceof Error ? e.message : String(e))
    }
  })

  box.querySelector('#lb-db-reset')?.addEventListener('click', async () => {
    if (!confirm('确定要删掉本地数据库重建吗？没导出的数据会永久丢失。')) return
    msg.textContent = '正在重建…'
    try {
      const { resetLocalDatabase } = await import('@/shared/core/database')
      await resetLocalDatabase()
      msg.textContent = '重建完成，正在重新载入…'
      setTimeout(() => location.reload(), 600)
    } catch (e) {
      msg.textContent = '重建失败：' + (e instanceof Error ? e.message : String(e))
    }
  })
}

app.config.errorHandler = (err, _instance, info) => showFatal(`渲染出错 ${info}`, err)
window.addEventListener('error', e => showFatal('脚本错误', e.error || e.message))
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
  // 浏览器本地数据库文件损坏或被外部删除。这不是代码错，重试也没用，
  // 只能提示重建；不加这条的话用户只会看到一句英文报错。
  if (/NotReadableError|Data lost due to missing file|backing store/i.test(msg)) {
    showDbBroken()
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
