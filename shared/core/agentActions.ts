/**
 * Agent 操作工具。
 *
 * 跟 agentTools 里的 lb-widget 是两回事：那个是**展示型**（在聊天里嵌一个词汇宇宙），
 * 这个是**操作型**（真的去建词表、加词、改名）。
 *
 * 协议同样走文本代码块而不是厂商的 function calling —— 换任何一个能对话的模型都能用：
 *
 *   ```lb-action
 *   {"tool":"createWordList","args":{"name":"雅思核心"}}
 *   ```
 *
 * 三条硬规矩：
 *  1. 会改数据的操作**必须先给用户确认**，模型说了不算
 *  2. 执行结果要回填给模型，让它能接着说「建好了，现在里面有 23 个词」
 *  3. 失败要如实告诉模型，不许它编造成功
 */

export interface ActionSpec {
  tool: string
  args: Record<string, any>
}

export interface ActionResult {
  ok: boolean
  /** 说给模型听的结果，会拼回对话里 */
  summary: string
}

/** 需要用户点头才执行的工具 —— 会动数据的都在这 */
const NEEDS_CONFIRM = new Set([
  'createWordList',
  'renameWordList',
  'addWordsToList',
  'setReminder',
  'cleanupArticle'
])

export function needsConfirm(tool: string): boolean {
  return NEEDS_CONFIRM.has(tool)
}

/** 给模型看的工具说明，拼进系统提示 */
export const ACTION_PROMPT = `你可以操作这个软件。需要动手时输出一个 lb-action 代码块：

\`\`\`lb-action
{"tool":"createWordList","args":{"name":"雅思核心"}}
\`\`\`

可用工具：
- createWordList  {name}                建一个新词表
- renameWordList  {from, to}            词表改名
- addWordsToList  {list, words[]}       把词加进指定词表；words 留空表示"我最近查过的词"
- queryWords      {root?, topic?, level?, limit?}  按词根/话题/掌握度查词，只读不改
- setReminder     {label, minutes}      定时提醒（复习、喝水、休息）
- openPage        {page}                跳到某个页面：universe/words/study/reading/dictation
- cleanupArticle  {title}               对某篇文章跑一次整理

规矩：
1. 代码块里必须是合法 JSON，单独成行。
2. 一条回答最多一个 lb-action。
3. 会改数据的操作会先弹确认框给用户，你不要假设已经做完了 ——
   等系统把执行结果告诉你，再接着说。
4. 用户只是问问题、不是要你动手时，不要输出 lb-action。`

/**
 * 从模型回复里抽出操作请求，返回剩下的正文。
 * 解析不了的代码块原样留着，方便看出问题在哪，而不是静默吞掉。
 */
export function extractActions(reply: string): { text: string; actions: ActionSpec[] } {
  const actions: ActionSpec[] = []
  const text = reply.replace(/```lb-action\s*([\s\S]*?)```/g, (whole, body) => {
    try {
      const spec = JSON.parse(String(body).trim())
      if (!spec || typeof spec.tool !== 'string') return whole
      if (actions.length >= 1) return ''      // 一条回答只执行一个
      actions.push({ tool: spec.tool, args: spec.args || {} })
      return ''
    } catch {
      return whole
    }
  })
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), actions }
}

/** 把操作描述成人话，用在确认框上 */
export function describeAction(a: ActionSpec): string {
  const g = a.args || {}
  switch (a.tool) {
    case 'createWordList': return `新建词表「${g.name}」`
    case 'renameWordList': return `把词表「${g.from}」改名为「${g.to}」`
    case 'addWordsToList': {
      const n = Array.isArray(g.words) ? g.words.length : 0
      return `往「${g.list}」里加 ${n ? n + ' 个词' : '最近查过的词'}`
    }
    case 'setReminder': return `每 ${g.minutes} 分钟提醒一次：${g.label}`
    case 'openPage': return `跳到「${g.page}」页面`
    case 'cleanupArticle': return `整理文章《${g.title}》`
    case 'queryWords': return '查词（只读）'
    default: return `${a.tool}（未知操作）`
  }
}

/**
 * 真正去执行。
 *
 * 依赖用参数传进来而不是直接 import store —— 这个模块要能被单测，
 * 也不该反过来依赖 UI 层。
 */
export interface ActionDeps {
  wordStore: any
  readerStore: any
  router?: any
  recentLookups: () => string[]
}

export async function runAction(a: ActionSpec, deps: ActionDeps): Promise<ActionResult> {
  const g = a.args || {}
  const { wordStore, readerStore } = deps

  try {
    switch (a.tool) {
      case 'createWordList': {
        const name = String(g.name || '').trim()
        if (!name) return { ok: false, summary: '没给词表名字，没有建' }
        if (wordStore.groups.some((x: any) => x.name === name)) {
          return { ok: false, summary: `已经有一个叫「${name}」的词表了，没有重复建` }
        }
        const now = new Date().toISOString()
        await wordStore.createGroup({
          id: 'g-' + Date.now().toString(36),
          name,
          description: '',
          wordIds: [],
          createdAt: now,
          updatedAt: now
        })
        return { ok: true, summary: `已建好词表「${name}」，现在是空的` }
      }

      case 'renameWordList': {
        const from = String(g.from || '').trim()
        const to = String(g.to || '').trim()
        const grp = wordStore.groups.find((x: any) => x.name === from)
        if (!grp) return { ok: false, summary: `没找到叫「${from}」的词表` }
        if (!to) return { ok: false, summary: '没给新名字' }
        await wordStore.updateGroup(grp.id, { name: to })
        return { ok: true, summary: `词表「${from}」已改名为「${to}」` }
      }

      case 'addWordsToList': {
        const listName = String(g.list || '').trim()
        const grp = wordStore.groups.find((x: any) => x.name === listName)
        if (!grp) return { ok: false, summary: `没找到叫「${listName}」的词表，要先建一个` }

        // words 留空 = 用最近查过的词
        const raw: string[] = Array.isArray(g.words) && g.words.length
          ? g.words.map((w: any) => String(w))
          : deps.recentLookups()
        if (!raw.length) return { ok: false, summary: '没有可加的词（最近也没查过词）' }

        const byWord = new Map<string, any>(
          wordStore.words.map((w: any) => [w.word.toLowerCase(), w])
        )
        const ids: string[] = []
        const missing: string[] = []
        for (const w of raw) {
          const hit = byWord.get(w.trim().toLowerCase())
          if (hit) ids.push(hit.id)
          else missing.push(w)
        }
        if (!ids.length) {
          return { ok: false, summary: `这些词在词库里都没有：${missing.slice(0, 8).join(', ')}` }
        }
        const merged = Array.from(new Set([...(grp.wordIds || []), ...ids]))
        const added = merged.length - (grp.wordIds || []).length
        await wordStore.updateGroup(grp.id, { wordIds: merged })
        return {
          ok: true,
          summary: `往「${listName}」加了 ${added} 个词，现在一共 ${merged.length} 个` +
            (missing.length ? `。词库里没有的：${missing.slice(0, 5).join(', ')}` : '')
        }
      }

      case 'queryWords': {
        const root = String(g.root || '').toLowerCase()
        const topic = String(g.topic || '')
        const limit = Math.min(Number(g.limit) || 20, 50)
        const hit = wordStore.words.filter((w: any) => {
          if (root) {
            const m = w.morphemes
            const inRoot = m && [m.prefix, m.root, m.suffix]
              .some((p: any) => p?.form && String(p.form).toLowerCase().includes(root))
            if (!inRoot && !w.word.toLowerCase().includes(root)) return false
          }
          if (topic && !(w.topics || []).some((t: any) => String(t).includes(topic))) return false
          return true
        })
        const names = hit.slice(0, limit).map((w: any) => w.word)
        return {
          ok: true,
          summary: hit.length
            ? `找到 ${hit.length} 个：${names.join(', ')}${hit.length > names.length ? ' …' : ''}`
            : '一个都没找到'
        }
      }

      case 'setReminder': {
        const label = String(g.label || '该休息了').trim()
        const minutes = Math.max(1, Math.min(Number(g.minutes) || 30, 24 * 60))
        addReminder(label, minutes)
        return { ok: true, summary: `好，每 ${minutes} 分钟提醒一次「${label}」` }
      }

      case 'openPage': {
        const map: Record<string, string> = {
          universe: '/universe', words: '/words', study: '/study',
          reading: '/reading', dictation: '/dictation'
        }
        const path = map[String(g.page || '')]
        if (!path) return { ok: false, summary: `不认识「${g.page}」这个页面` }
        deps.router?.push(path)
        return { ok: true, summary: `已经跳到「${g.page}」了` }
      }

      case 'cleanupArticle': {
        const title = String(g.title || '').trim()
        const art = readerStore.articles.find((x: any) => x.title.includes(title))
        if (!art) return { ok: false, summary: `没找到标题包含「${title}」的文章` }
        return {
          ok: true,
          summary: `找到《${art.title}》了。整理要在阅读助手里点「重新整理」，` +
            `我这边不能替你跑（那是个长任务，要能看到进度和随时停）`
        }
      }

      default:
        return { ok: false, summary: `不认识这个操作：${a.tool}` }
    }
  } catch (e) {
    return { ok: false, summary: '执行出错：' + (e instanceof Error ? e.message : String(e)) }
  }
}

/* ---------- 定时提醒 ---------- */

export interface Reminder {
  id: string
  label: string
  minutes: number
  nextAt: number
}

export const reminders: Reminder[] = []

export function addReminder(label: string, minutes: number) {
  reminders.push({
    id: 'r-' + Date.now().toString(36),
    label,
    minutes,
    nextAt: Date.now() + minutes * 60_000
  })
  save()
}

export function removeReminder(id: string) {
  const i = reminders.findIndex(r => r.id === id)
  if (i >= 0) reminders.splice(i, 1)
  save()
}

/** 到点了的提醒，取出来同时把下一次时间往后推 */
export function dueReminders(now = Date.now()): Reminder[] {
  const out = reminders.filter(r => r.nextAt <= now)
  for (const r of out) r.nextAt = now + r.minutes * 60_000
  if (out.length) save()
  return out
}

function save() {
  try {
    localStorage.setItem('lb-reminders', JSON.stringify(reminders))
  } catch { /* 存不了就只在本次会话有效 */ }
}

export function loadReminders() {
  try {
    const raw = JSON.parse(localStorage.getItem('lb-reminders') || '[]')
    if (Array.isArray(raw)) {
      reminders.length = 0
      for (const r of raw) if (r?.label && r?.minutes) reminders.push(r)
    }
  } catch { /* 坏数据就当没有 */ }
}
