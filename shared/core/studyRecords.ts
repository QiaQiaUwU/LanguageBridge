/**
 * 学习记录里除笔记、AI 文章之外的条目：逐句听写结果、词族笔记。
 * 本地 IndexedDB 一份（离线也能看），后端 data/study_records 一份（跟着 data/ 备份）。
 */
import { wordDB } from './database'

export interface AlignOp {
  kind: 'ok' | 'typo' | 'moved' | 'miss' | 'extra'
  src?: string
  typed?: string
}

export interface DictationItem {
  sentIdx: number
  original: string
  zh?: string
  typed: string
  replays: number
  /** 这一句用了几次提示 */
  hints?: number
  /** 填空模式下挖掉的词在原句里的位置 */
  blanks?: number[]
  skipped?: boolean
  ops: AlignOp[]
  accuracy: number
}

export interface DictationRecord {
  id: string
  type: 'dictation'
  articleId: string
  articleTitle: string
  date: string
  createdAt: string
  durationSec: number
  items: DictationItem[]
  accuracy: number
  counts: { ok: number; typo: number; moved: number; miss: number; extra: number }
  mode?: 'full' | 'cloze'
}

export interface FamilyNoteRecord {
  id: string
  type: 'familyNote'
  title: string
  date: string
  createdAt: string
  layout: 'radial' | 'list'
  /** 结构化内容，改了词库可以重新渲染 */
  note: import('./wordFamily').FamilyNote
}

export type StudyRecord = DictationRecord | FamilyNoteRecord

const KEY = 'study-records'

async function localAll(): Promise<StudyRecord[]> {
  const v = await wordDB.getHandle(KEY)
  return Array.isArray(v) ? v : []
}
async function localWrite(list: StudyRecord[]) {
  await wordDB.saveHandle(KEY, JSON.parse(JSON.stringify(list)))
}

export async function listStudyRecords(): Promise<StudyRecord[]> {
  let list = await localAll()
  try {
    const res = await fetch('/api/study-records')
    if (res.ok) {
      const remote: StudyRecord[] = await res.json()
      const map = new Map(list.map(r => [r.id, r]))
      for (const r of remote) map.set(r.id, r)
      list = [...map.values()]
      await localWrite(list)
    }
  } catch { /* 后端没起来就只用本地 */ }
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getStudyRecord(id: string): Promise<StudyRecord | undefined> {
  return (await listStudyRecords()).find(r => r.id === id)
}

export async function saveStudyRecord(rec: StudyRecord): Promise<void> {
  const list = await localAll()
  const i = list.findIndex(r => r.id === rec.id)
  if (i >= 0) list[i] = rec
  else list.push(rec)
  await localWrite(list)
  try {
    await fetch(`/api/study-records/${encodeURIComponent(rec.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec)
    })
  } catch { /* 离线时只存本地 */ }
}

export async function deleteStudyRecord(id: string): Promise<void> {
  await localWrite((await localAll()).filter(r => r.id !== id))
  try { await fetch(`/api/study-records/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch { /* 同上 */ }
}

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function newRecordId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
