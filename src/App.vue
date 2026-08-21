<template>
  <div class="app-layout">
    <aside class="side-nav" :class="{ collapsed: navCollapsed }">
      <div class="nav-head">
        <span v-if="!navCollapsed" class="logo">LanguageBridge</span>
      </div>

      <button class="nav-fold" :title="navCollapsed ? '展开导航' : '收起导航'" @click="toggleNav">
        <i :class="navCollapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-left-s-line'"></i>
      </button>

      <nav class="nav-list">
        <router-link
          v-for="it in navItems"
          :key="it.to"
          :to="it.to"
          class="nav-item"
          active-class="active"
          :title="it.label"
        >
          <i class="nav-icon" :class="it.icon"></i>
          <span v-if="!navCollapsed">{{ it.label }}</span>
        </router-link>

        <button class="nav-item nav-qr-btn" title="手机/平板连接" @click="openQR">
          <i class="nav-icon ri-qr-code-line"></i>
          <span v-if="!navCollapsed">手机连接</span>
        </button>
      </nav>
    </aside>

    <div v-if="readingArticleTitle" class="article-topbar">
      <span class="header-article-title">{{ readingArticleTitle }}</span>
      <!-- 笔记面板在右边，入口就放右边。原来按钮在最左、面板在最右，
           点一个东西结果对面弹出来，方向对不上。 -->
      <button
        class="header-article-toggle"
        :title="readingSidePanelOpen ? '收起笔记' : '展开笔记'"
        @click="readingSidePanelOpen = !readingSidePanelOpen"
      >
        <i :class="readingSidePanelOpen ? 'ri-side-bar-fill' : 'ri-side-bar-line'"></i>
      </button>
    </div>

    <div v-if="storagePersisted === false && !storagePersistDismissed" class="storage-warning">
      <span>
        浏览器没有批准"持久化存储"，这意味着文章/单词这些数据存在浏览器本地，但理论上仍可能在磁盘空间紧张时被浏览器自动清掉，不需要你做任何操作——数据丢失极端情况下可能就是这个原因。
        建议：定期用"导出分享包"/"从后端恢复"这类功能做个备份，或者把这个页面"添加到主屏幕/安装为应用"能提高浏览器保留数据的优先级。
      </span>
      <button class="storage-warning-close" @click="storagePersistDismissed = true">×</button>
    </div>

    <div v-if="showQR" class="qr-overlay" @click.self="showQR = false">
      <div class="qr-box">
        <div class="qr-head"><span>手机/平板连接</span><button class="qr-close" @click="showQR = false">×</button></div>
        <p class="qr-hint">手机/平板连同一个 WiFi，扫码或输入地址访问，不需要联网</p>
        <div class="qr-img-wrap">
          <img v-if="qrUrl" :src="`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(qrUrl)}`" alt="二维码" />
          <span v-else class="qr-loading">获取地址中…</span>
        </div>
        <p class="qr-url">{{ qrUrl || '（获取中…）' }}</p>
        <p v-if="qrError" class="qr-error">{{ qrError }}</p>
      </div>
    </div>

    <main class="app-main">
      <router-view />
    </main>

    <div v-if="syncWarn" class="sync-warn" @click="dismissSyncWarn">{{ syncWarn }}</div>

    <!-- 浏览器版的定时提醒提示条：不用系统通知，那个弹一下就没了 -->
    <div v-if="reminderToast.length" class="remind-bar">
      <span class="rb-icon">⏰</span>
      <span class="rb-text">{{ reminderToast.map(r => r.label).join('、') }}</span>
      <button class="rb-close" @click="reminderToast = []">知道了</button>
    </div>

    <FloatingAgentButton />
    <AgentPanel />
    <TaskCenter />
  </div>
</template>

<script setup lang="ts">
import { onSyncStatus } from '@/shared/core/syncStatus'

import { ref, onMounted, watch, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWordStore } from '@/shared/stores/wordStore'
import { useThemeStore } from '@/shared/stores/themeStore'
import FloatingAgentButton from './components/FloatingAgentButton.vue'
import AgentPanel from './components/AgentPanel.vue'
import TaskCenter from './components/TaskCenter.vue'
import { storagePersisted, storagePersistDismissed } from '@/shared/core/storagePersistence'
import { readingSidePanelOpen, readingArticleTitle } from '@/shared/core/readingPanelState'
import { agentPanelOpen } from '@/shared/core/agentPanelState'

const route = useRoute()
const router = useRouter()
const wordStore = useWordStore()
useThemeStore()

function goWordsIfNeeded() {
  if (route.path !== '/words') router.push('/words')
}

const showQR = ref(false)

const navCollapsed = ref(localStorage.getItem('lb-nav-collapsed') === '1')
function toggleNav() {
  navCollapsed.value = !navCollapsed.value
  localStorage.setItem('lb-nav-collapsed', navCollapsed.value ? '1' : '0')
}

const navItems = [
  { to: '/home', label: '主页', icon: 'ri-home-5-line' },
  { to: '/words', label: '词汇中心', icon: 'ri-book-2-line' },
  { to: '/universe', label: '词汇宇宙', icon: 'ri-globe-line' },
  { to: '/reading', label: '阅读助手', icon: 'ri-book-open-line' },
  { to: '/study-notes', label: '学习记录', icon: 'ri-sticky-note-line' },
  { to: '/settings', label: '设置', icon: 'ri-settings-3-line' }
]
const qrUrl = ref('')
const qrError = ref('')
async function openQR() {
  showQR.value = true
  qrUrl.value = ''
  qrError.value = ''
  try {
    const res = await fetch('/__serverinfo')
    if (!res.ok) throw new Error()
    const info = await res.json()
    if (!info.lan_url || info.ip === '127.0.0.1') {
      qrError.value = '没检测到局域网网卡，可能是虚拟网络环境，或者本机没连 WiFi/网线'
      return
    }
    qrUrl.value = info.lan_url
  } catch {
    qrError.value = '获取局域网地址失败，请确认是通过 启动LanguageBridge.bat（或 npm run dev）打开的'
  }
}

const updateTitle = () => {
  const title = route.meta.title as string
  document.title = title ? `LanguageBridge - ${title}` : 'LanguageBridge'
}

/**
 * 后端备份失败提示。
 *
 * beSaveXxx 全是即发即忘、失败静默返回 null。后端没起的时候数据只落在本地
 * IndexedDB，而 IndexedDB 会坏 —— 两边都没有就是真丢了，还全程没提示。
 * 累计失败 5 次以上、且这次会话里一次都没成功过，就报出来。
 */
const syncWarn = ref('')

/**
 * 后端备份提示。
 *
 * 原来只要失败数 ≥5 就一直弹，而后端没启动时失败数只会越涨越多 ——
 * 每跑一会儿就冒出来一次，很烦。改成：
 *  - 整个会话只提醒一次
 *  - 点掉之后记进 localStorage，这台机器不再提醒（除非后端真的连上过又断了）
 *  - 后端连上过再断，才是值得重新提醒的情况
 */
const SYNC_DISMISS_KEY = 'lb-sync-warn-dismissed'
let syncWarned = false

const stopSync = onSyncStatus(s => {
  if (s.lastOkAt > 0) {
    // 连上过：清掉"不再提醒"，这样真出问题时还会提示
    localStorage.removeItem(SYNC_DISMISS_KEY)
    if (syncWarn.value) syncWarn.value = ''
    return
  }
  if (syncWarned || localStorage.getItem(SYNC_DISMISS_KEY)) return
  if (s.failed >= 5) {
    syncWarned = true
    syncWarn.value = '没有连上后端，这些改动只存在浏览器本地。想要磁盘备份的话启动 backend 目录里的服务；不需要就点掉，不再提醒。'
  }
})
function dismissSyncWarn() {
  syncWarn.value = ''
  localStorage.setItem(SYNC_DISMISS_KEY, '1')
}

/**
 * 给 Electron 桌面悬浮球用的两个入口。
 *
 * 主进程通过 executeJavaScript 调这两个函数：窗口收起时球上的播放键、
 * 长按开对话，都要落到页面里真正的逻辑上。挂在 window 上是最简单可靠的桥。
 */
;(window as any).__lbOpenAgent = () => {
  agentPanelOpen.value = true
}
/**
 * 桌面悬浮球问「今天要复习几个词」。
 * 直接用 FSRS 已有的 countDue，不另算一套。
 */
;(window as any).__lbDueCount = async () => {
  try {
    const { countDue } = await import('@/shared/core/fsrs')
    return countDue()
  } catch {
    return 0
  }
}
/**
 * 自定义定时提醒。
 *
 * 提醒本身（addReminder / dueReminders）早就写好了，Agent 也能设，
 * 但**没有任何地方去查有没有到点** —— 说了"已设置"然后永远不响。
 * 这里补上两条路：
 *   桌面版：壳每分钟来问一次，到点的推给悬浮球（角标 + 抖一下）
 *   浏览器版：页面内自己轮询，弹一条提示条（系统通知容易被忽略）
 */
;(window as any).__lbDueReminders = async () => {
  try {
    const { dueReminders } = await import('@/shared/core/agentActions')
    return dueReminders().map(r => ({ id: r.id, label: r.label, minutes: r.minutes }))
  } catch {
    return []
  }
}

const reminderToast = ref<{ id: string; label: string }[]>([])
let reminderTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  const { loadReminders, dueReminders } = await import('@/shared/core/agentActions')
  loadReminders()
  // 桌面版由壳来轮询（那边球上有角标，比页面提示条显眼）；浏览器版自己来
  if ((window as any).lbBall) return
  reminderTimer = setInterval(() => {
    const due = dueReminders()
    if (due.length) reminderToast.value = due.map(r => ({ id: r.id, label: r.label }))
  }, 30_000)
})
onUnmounted(() => {
  if (reminderTimer) clearInterval(reminderTimer)
})

/**
 * 有没有音频正在播。桌面悬浮球用它决定要不要给出操作台 ——
 * 没有音频在跑的时候长按只会得到一个空面板，不如直接不给。
 */
/**
 * 给桌面悬浮球的"现在在放什么"。
 * 球上的控制台要显示文章名和当前这句，得从页面里取。
 */
/**
 * 自定义高亮色写到根元素上，划线的 .hl-custom 靠它取色。
 * 放在 App 里是因为标记可能出现在任何页面。
 */
function applyCustomHl() {
  const c = localStorage.getItem('lb-custom-hl')
  if (c) document.documentElement.style.setProperty('--lb-custom-hl', c)
}
applyCustomHl()
window.addEventListener('storage', applyCustomHl)

;(window as any).__lbNowPlaying = () => {
  const g = window as any
  return {
    playing: (Array.from(document.querySelectorAll('audio')) as HTMLAudioElement[])
      .some(el => !el.paused && !el.ended && el.currentTime > 0),
    title: g.__lbNowTitle || '',
    line: g.__lbNowLine || '',
    next: g.__lbNextLine || ''
  }
}
;(window as any).__lbAudioPlaying = () => {
  const els = Array.from(document.querySelectorAll('audio')) as HTMLAudioElement[]
  return els.some(el => !el.paused && !el.ended && el.currentTime > 0)
}
;(window as any).__lbMedia = (action: { type: string; value?: number }) => {
  // 具体的播放控制由阅读助手实现并注册，这里只做转发
  const h = (window as any).__lbMediaHandler
  if (typeof h === 'function') h(action)
}

onUnmounted(() => stopSync())

onMounted(updateTitle)
watch(() => route.path, updateTitle)

/**
 * 这里原来有个全局计时器：只要窗口可见，每分钟就 recordActiveMinute() 一次。
 * 那等于「打开软件 = 在学习」，翻设置、发呆都算进学习时长，
 * 而且在背单词页时 StudyPage 自己也在记，同一分钟记两遍。
 * 现在改由各练习页自己起 studyClock（见 shared/core/studyClock.ts）。
 */

onMounted(() => {
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--r-paper, #e8f4f8);
  color: var(--r-ink, #1a1a1a);
  min-height: 100vh;
  transition: background 0.2s, color 0.2s;
}

.sync-warn {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 300; max-width: min(560px, 86vw);
  padding: 9px 14px; border-radius: 9px;
  background: #4a3520; color: #ffe9c9; font-size: 13px; line-height: 1.6;
  box-shadow: 0 6px 20px rgba(0,0,0,.18); cursor: pointer;
}
.app-layout {
  --lb-nav-w: 178px;
  min-height: 100vh;
  display: flex;
  flex-direction: row;
}

.side-nav {
  position: relative;
  width: 178px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 10px;
  background: var(--r-ui, #fff);
  border-right: 1px solid var(--r-border, #e6e6e6);
  z-index: 100;
  transition: width 0.18s ease;
}
.side-nav.collapsed { width: 56px; padding: 14px 8px; }
.app-layout:has(.side-nav.collapsed) { --lb-nav-w: 56px; }
.side-nav.collapsed .nav-item { justify-content: center; padding: 9px 0; }

.nav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 10px;
  min-height: 28px;
}
.nav-fold {
  position: absolute;
  right: -11px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 44px;
  border: 1px solid var(--r-border, #e2e2e2);
  border-radius: 0 8px 8px 0;
  background: var(--r-ui, #fff);
  color: var(--r-ink2, #999);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 101;
  font-size: 15px;
  line-height: 1;
  &:hover { color: var(--r-ink, #333); }
}
.nav-list { display: flex; flex-direction: column; gap: 3px; }

/* left 用变量，不写死 178px —— 侧栏收起后是 56px，写死就整条错位 */
.article-topbar {
  position: fixed;
  top: 0;
  left: var(--lb-nav-w, 178px);
  right: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 18px;
  background: var(--r-ui, #fff);
  border-bottom: 1px solid var(--r-border, #e6e6e6);
  z-index: 80;
}
.side-nav.collapsed ~ .article-topbar { left: 56px; }

@media (max-width: 820px) {
  .app-layout { --lb-nav-w: 56px; }
  .side-nav { width: 56px; padding: 14px 8px; }
  .side-nav .nav-item span, .side-nav .logo, .side-nav .nav-search { display: none; }
  .side-nav .nav-item { justify-content: center; padding: 9px 0; }
  .article-topbar { left: 56px; }
}

.storage-warning {
  background: #fdf0ec;
  border-bottom: 1px solid #f0d0c5;
  color: #93472e;
  font-size: 13px;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  line-height: 1.6;
}
.storage-warning-close {
  border: none;
  background: none;
  color: #93472e;
  cursor: pointer;
  font-size: 16px;
  flex-shrink: 0;
  opacity: 0.6;
  &:hover { opacity: 1; }
}

.logo {
  font-size: 20px;
  font-weight: 700;
  color: var(--r-accent, #3a86ff);
  flex-shrink: 0;
}

.header-article-bar {
  display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
}
.header-article-toggle {
  border: none; background: none; cursor: pointer; color: var(--r-ink2, #666); display: flex; align-items: center; padding: 4px; border-radius: 6px; flex-shrink: 0; font-size: 18px; line-height: 1;
  &:hover { color: var(--r-ink, #1a1a1a); background: color-mix(in srgb, var(--r-accent, #3a86ff) 8%, transparent); }
}
.header-article-title {
  font-size: 14px; font-weight: 600; color: var(--r-ink, #1a1a1a);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.nav-search {
  border: 1px solid var(--r-border, #ddd);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  width: 100%;
  outline: none;
  margin-bottom: 8px;
  background: transparent;
  color: var(--r-ink, #1a1a1a);
  &:focus { border-color: var(--r-accent, #3a86ff); }
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  font-size: 13.5px;
  white-space: nowrap;
  border-radius: 8px;
  text-decoration: none;
  color: var(--r-ink2, #666);
  font-size: 14px;
  transition: all 0.2s;
}

.nav-item:hover {
  background: color-mix(in srgb, var(--r-accent, #3a86ff) 12%, transparent);
  color: var(--r-accent, #3a86ff);
}

.nav-item.active {
  background: var(--r-accent, #3a86ff);
  color: white;
}

.nav-icon {
  flex-shrink: 0;
  font-size: 17px;
  line-height: 1;
  width: 17px;
  text-align: center;
}
.nav-qr-btn, .nav-theme-btn {
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
}

.qr-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.qr-box {
  background: #fff;
  border-radius: 14px;
  padding: 22px 26px;
  width: min(300px, 100%);
  text-align: center;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
.qr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 6px;
}
.qr-close { border: none; background: none; font-size: 20px; cursor: pointer; color: #999; line-height: 1; }
.qr-close:hover { color: #333; }
.qr-hint { font-size: 12px; color: #999; margin-bottom: 16px; line-height: 1.6; }
.qr-img-wrap {
  width: 200px;
  height: 200px;
  margin: 0 auto 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
  border-radius: 8px;
  img { width: 100%; height: 100%; }
}
.qr-loading { font-size: 12.5px; color: #999; }
.qr-url { font-size: 12.5px; color: #555; word-break: break-all; }
.qr-error { font-size: 12.5px; color: #b05a4a; margin-top: 8px; }

.app-main {
  flex: 1;
  min-width: 0;
  min-height: 100vh;
  --lb-main-pad: 24px;
  padding: var(--lb-main-pad);
  position: relative;
}

@media (max-width: 768px) {
  .header-content {
    flex-direction: column;
    height: auto;
    padding: 12px;
    gap: 12px;
  }

  .main-nav {
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }

  .header-article-bar { width: 100%; }

  .nav-search {
    width: 100%;
    margin-right: 0;
    order: -1;
    &:focus { width: 100%; }
  }

  .nav-item span {
    display: none;
  }

  .nav-item {
    padding: 10px;
  }

  .app-main {
    --lb-main-pad: 12px;
  }

  .qr-box { padding: 18px 16px; }
  .qr-img-wrap { width: 160px; height: 160px; }
}

@media (max-width: 420px) {
  .logo { font-size: 17px; }
}

.ghost-btn {
  border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  color: var(--r-ink, #3a3128);
  border-radius: 9px;
  padding: 7px 14px;
  font-size: 13.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.ghost-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff));
  border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent);
}
.ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost-btn.small { padding: 5px 11px; font-size: 12.5px; }
.ghost-btn.tiny { padding: 3px 9px; font-size: 12px; }
.ghost-btn.on {
  background: var(--r-accent, #8a4b3a);
  border-color: transparent;
  color: #fff;
}

.dark-btn {
  border: none;
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  border-radius: 9px;
  padding: 9px 18px;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
  transition: background-color .15s ease, box-shadow .15s ease;
}
.dark-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 84%, #000); }
.dark-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
.dark-btn.small { padding: 6px 13px; font-size: 13px; }

/* 定时提醒提示条（浏览器版）。桌面版走悬浮球角标，不显示这条 */
.remind-bar {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-radius: 999px;
  background: #2b2f36; color: #fff; font-size: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  z-index: 900;
}
.rb-icon { flex-shrink: 0; }
.rb-text { line-height: 1.5; }
.rb-close {
  border: none; background: rgba(255, 255, 255, .18); color: #fff;
  padding: 4px 10px; border-radius: 999px; cursor: pointer; font-size: 13px;
  font-family: inherit;
}
.rb-close:hover { background: rgba(255, 255, 255, .3); }
</style>
