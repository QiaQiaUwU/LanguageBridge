/**
 * 学习计时。
 *
 * 原来是 App.vue 里一个全局 setInterval：只要窗口可见，每分钟就记一分钟学习时长。
 * 结果是开着窗口发呆、看文章列表、翻设置，全都算成"学习"；
 * 而在背单词页面时 StudyPage 自己也在记，同一分钟被记两次。
 *
 * 现在改成：**只有真正在练的页面**才起这个计时器 ——
 * 打字流程、听写、单词测试、卡片消消乐。进页面 start，离开 stop。
 *
 * 两条自动暂停的规则跟 StudyPage 原来的一致：
 *   1. 窗口切到后台（visibilitychange）就停，切回来继续
 *   2. 超过 IDLE_LIMIT 没有任何按键/点击，视为人走开了，停
 */

import { recordActiveMinute } from './activityLog'

const IDLE_LIMIT = 3 * 60 * 1000
const TICK = 1000

let timer: ReturnType<typeof setInterval> | null = null
let accrued = 0        // 累计到的毫秒，满一分钟就记一次并清掉那一分钟
let lastActivity = 0
let bound = false

function onActivity() {
  lastActivity = Date.now()
}

function tick() {
  if (document.visibilityState !== 'visible') return
  if (Date.now() - lastActivity > IDLE_LIMIT) return
  accrued += TICK
  while (accrued >= 60_000) {
    accrued -= 60_000
    recordActiveMinute()
  }
}

/** 进入练习页时调用。重复调用只会有一个计时器。 */
export function startStudyClock() {
  if (timer) return
  lastActivity = Date.now()
  accrued = 0
  timer = setInterval(tick, TICK)
  if (!bound) {
    window.addEventListener('keydown', onActivity)
    window.addEventListener('pointerdown', onActivity)
    bound = true
  }
}

/** 离开练习页时调用。不足一分钟的零头直接丢掉，不四舍五入。 */
export function stopStudyClock() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  accrued = 0
  if (bound) {
    window.removeEventListener('keydown', onActivity)
    window.removeEventListener('pointerdown', onActivity)
    bound = false
  }
}
