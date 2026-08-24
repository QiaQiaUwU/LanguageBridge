/**
 * 建教材这件事，抽出来给主页和学习页共用。
 *
 * 之前它只长在学习页里，主页想触发就得跳过去 —— 于是有了「点生成教材却进了学习界面」
 * 这种别扭事，还得靠 query 传参数，一个参数名写错（groupId 写成 group）
 * 整个范围就从"当前词表 570 词"变成"全部词库 17366 词"，
 * 分出来 180 段。范围这种东西不该靠字符串在页面之间传。
 *
 * 现在两边都调这里，取词和存 key 只有一份代码。
 */

import type { WordItem } from '@/shared/types/WordItem'
import { startTask, updateTask, finishTask, failTask, tasks } from './taskCenter'
import {
  readSyllabus, buildSyllabus, generateAllSections, missingSectionCount,
  type Syllabus
} from './syllabus'

/** 这个范围的教材任务是不是正在跑 */
export function syllabusTaskRunning(scopeKey?: string): boolean {
  return tasks.some(t =>
    t.status === 'running' &&
    String(t.id || '').startsWith('syllabus') &&
    (!scopeKey || String(t.id).includes(scopeKey))
  )
}

/**
 * 建（或补齐）一套教材。已经在跑就不重复起。
 *
 * @param scopeKey 教材存在哪个 key 下，调用方按同一套规则算
 * @param words    这个范围里的词
 * @param label    任务卡上显示的名字
 */
export async function ensureSyllabus(
  scopeKey: string,
  words: WordItem[],
  label: string
): Promise<Syllabus | null> {
  if (!words.length) return null
  if (syllabusTaskRunning(scopeKey)) return readSyllabus(scopeKey)

  const existing = readSyllabus(scopeKey)
  const missing = missingSectionCount(existing)
  // 已经齐了就什么都不做，别白花钱
  if (existing && !missing) return existing

  let stopped = false
  const taskId = startTask({
    id: `syllabus-${scopeKey}`,
    kind: existing ? '补写教材' : '生成教材',
    subject: label || '这个词表',
    detail: existing ? `还差 ${missing} 段` : '按话题分课…',
    cancel: () => { stopped = true }
  })

  try {
    let sy = existing
    if (!sy) {
      sy = await buildSyllabus(scopeKey, words, {
        onProgress: (done, total, note) => {
          updateTask(taskId, { ratio: total ? (done / total) * 0.15 : undefined, detail: note })
        },
        shouldStop: () => stopped
      })
      updateTask(taskId, { detail: `分成 ${sy.lessons.length} 课，开始写课文…` })
    }

    const r = await generateAllSections(sy, {
      onProgress: (done, total, note) => {
        updateTask(taskId, { ratio: 0.15 + (total ? done / total : 0) * 0.85, detail: note })
      },
      shouldStop: () => stopped
    })

    if (stopped) failTask(taskId, '已停止，下次进来接着写')
    else if (r.failed && !r.written) failTask(taskId, `${r.failed} 段全失败：${r.lastError || '原因不明'}`)
    else {
      finishTask(
        taskId,
        `${sy.podcasts.length} 篇 / ${sy.lessons.length} 段，写好 ${r.written} 段` +
        (r.failed ? `，${r.failed} 段失败：${r.lastError}` : '')
      )
    }
    return readSyllabus(scopeKey)
  } catch (e) {
    failTask(taskId, e instanceof Error ? e.message : String(e))
    return readSyllabus(scopeKey)
  }
}
