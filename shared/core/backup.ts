import { wordDB } from './database'
import { getStudySettings, saveStudySettings } from './studySettings'

export const BACKUP_VERSION = 1

export interface BackupData {
  version: number
  exportedAt: string
  app: 'LanguageBridge'
  parts: {
    words?: { version: number; val: unknown[] }
    groups?: { version: number; val: unknown[] }
    settings?: { version: number; val: unknown }
    fsrs?: { version: number; val: Record<string, unknown> }
    wrongBook?: { version: number; val: unknown[] }
    mastered?: { version: number; val: string[] }
    localKeys?: { version: number; val: Record<string, string> }
  }
}

const LOCAL_KEYS = [
  'lb.graphColorOverrides.v1',
  'lb_reader_skin',
  'lb-study-settings',
  'lb.scopeProgress.v1',
  'lb-dict-set',
  'lb-dict-view',
  'lb-wordcore-dimsel',
  'lb-wordcore-dim',
  'lb-study-group',
  'lb-study-tag',
  'lb-universe-node-style'
]

function readLocal(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of LOCAL_KEYS) {
    const v = localStorage.getItem(k)
    if (v !== null) out[k] = v
  }
  return out
}

export async function buildBackup(): Promise<BackupData> {
  const parts: BackupData['parts'] = {}

  try {
    parts.words = { version: 1, val: await wordDB.getAllWords() }
  } catch { /* 词条读不出来时其它块照样备份 */ }
  try {
    parts.groups = { version: 1, val: await wordDB.getAllGroups() }
  } catch { /* 同上 */ }
  try {
    parts.wrongBook = { version: 1, val: await wordDB.getAllWrongBook() }
  } catch { /* 同上 */ }
  try {
    parts.settings = { version: 1, val: getStudySettings() }
  } catch { /* 同上 */ }

  const local = readLocal()
  parts.localKeys = { version: 1, val: local }

  try {
    const raw = localStorage.getItem('lb-fsrs-data')
    if (raw) parts.fsrs = { version: 1, val: JSON.parse(raw) }
  } catch { /* 格式坏了就不带这一块 */ }
  try {
    const raw = localStorage.getItem('lb-mastered-words')
    if (raw) parts.mastered = { version: 1, val: JSON.parse(raw) }
  } catch { /* 同上 */ }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'LanguageBridge',
    parts
  }
}

export interface RestoreResult {
  words: number
  groups: number
  wrongBook: number
  settings: boolean
  localKeys: number
  warnings: string[]
}

export async function restoreBackup(data: BackupData): Promise<RestoreResult> {
  const res: RestoreResult = {
    words: 0, groups: 0, wrongBook: 0, settings: false, localKeys: 0, warnings: []
  }
  if (!data || data.app !== 'LanguageBridge' || !data.parts) {
    throw new Error('这不是 LanguageBridge 的备份文件')
  }
  if (data.version > BACKUP_VERSION) {
    res.warnings.push(`备份来自更新的版本（v${data.version}），部分内容可能读不全`)
  }

  const p = data.parts
  if (p.words?.val?.length) {
    try {
      await wordDB.saveWordsBulk(p.words.val as any)
      res.words = p.words.val.length
    } catch (e) {
      res.warnings.push('词条写回失败：' + (e as Error).message)
    }
  }
  if (p.groups?.val?.length) {
    try {
      await wordDB.saveGroupsBulk(p.groups.val as any)
      res.groups = p.groups.val.length
    } catch (e) {
      res.warnings.push('词表写回失败：' + (e as Error).message)
    }
  }
  if (p.wrongBook?.val?.length) {
    try {
      for (const w of p.wrongBook.val as any[]) {
        await wordDB.recordWrongWord({
          wordId: w.wordId, word: w.word,
          input: w.lastWrongInput || '', date: w.lastWrongDate || ''
        })
      }
      res.wrongBook = p.wrongBook.val.length
    } catch (e) {
      res.warnings.push('错词本写回失败：' + (e as Error).message)
    }
  }
  if (p.settings?.val) {
    try {
      saveStudySettings(p.settings.val as any)
      res.settings = true
    } catch (e) {
      res.warnings.push('设置写回失败：' + (e as Error).message)
    }
  }
  if (p.fsrs?.val) {
    try { localStorage.setItem('lb-fsrs-data', JSON.stringify(p.fsrs.val)) } catch { /* 配额满 */ }
  }
  if (p.mastered?.val) {
    try { localStorage.setItem('lb-mastered-words', JSON.stringify(p.mastered.val)) } catch { /* 配额满 */ }
  }
  if (p.localKeys?.val) {
    for (const [k, v] of Object.entries(p.localKeys.val)) {
      if (!LOCAL_KEYS.includes(k)) continue
      try { localStorage.setItem(k, v); res.localKeys++ } catch { /* 配额满 */ }
    }
  }
  return res
}
