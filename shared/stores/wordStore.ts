import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { wordDB } from '@/shared/core/database'
import * as be from '@/shared/core/backendClient'
import { trackSync } from '@/shared/core/syncStatus'
import type { WordItem, WordGroup, ImportResult, WordStatus } from '@/shared/types/WordItem'
import { parseText, parseJson, toWordItem } from '@/shared/core/parser'
import { extractTextFromFile } from '@/shared/core/fileExtract'
import { enrichWords, applyExplanation, type EnrichProgress } from '@/shared/core/enrichment'
import { recordWordLearned } from '@/shared/core/activityLog'
import { statusAfterWrong, statusAfterCorrect } from '@/shared/core/spacedRepetition'
import { applyGrade, flushFsrsData, nextReviewOf, Rating } from '@/shared/core/fsrs'

export const useWordStore = defineStore('word', () => {
  const words = ref<WordItem[]>([])
  const groups = ref<WordGroup[]>([])
  const currentWord = ref<WordItem | null>(null)
  const currentIndex = ref<number>(0)
  const isLoading = ref<boolean>(false)
  const error = ref<string | null>(null)

  const enrichProgress = ref<EnrichProgress | null>(null)

  const studyList = ref<WordItem[]>([])

  const searchQuery = ref('')

  const db = wordDB

  const totalWords = computed(() => words.value.length)

  const learnedCount = computed(() =>
    words.value.filter(w => (w.learningRecord?.familiarity || 0) >= 80).length
  )

  // 到期与否统一走 nextReviewOf（FSRS 优先，老数据回退），
  // 不再各处各写一遍 learningRecord.nextReview 的比较
  const needReviewCount = computed(() => {
    const now = new Date().toISOString()
    return words.value.filter(w => {
      const due = nextReviewOf(w)
      return !due || due <= now
    }).length
  })

  const progressPercentage = computed(() => {
    if (totalWords.value === 0) return 0
    return Math.round((learnedCount.value / totalWords.value) * 100)
  })

  function getWordsByGroup(groupId: string): WordItem[] {
    const group = groups.value.find(g => g.id === groupId)
    if (!group) return words.value
    return words.value.filter(w => group.wordIds.includes(w.id))
  }

  function getReviewWords(): WordItem[] {
    const now = new Date().toISOString()
    return words.value.filter(w => {
      const due = nextReviewOf(w)
      return !due || due <= now
    })
  }

  function normalizeLibraryGroups(list: WordGroup[]): WordGroup[] {
    const ALL_ID = 'book-lib-all'
    const changed: WordGroup[] = []
    for (const g of list) {
      if (!g.id?.startsWith('book-lib-cat-')) continue
      let touched = false
      if (g.parentId !== ALL_ID) { g.parentId = ALL_ID; touched = true }
      const next = String(g.name || '').replace(/^\s*释义库\s*[：:]\s*/, '')
      if (next && next !== g.name) { g.name = next; touched = true }
      if (touched) changed.push(g)
    }
    if (changed.length) {
      void be.beBulkSaveWordGroups(changed)
      void db.saveGroupsBulk?.(JSON.parse(JSON.stringify(changed)))
    }
    return list
  }

  async function loadWords() {
    isLoading.value = true
    error.value = null
    try {
      const [beWords, beGroups] = await Promise.all([be.beListWords(), be.beListWordGroups()])

      if (beWords !== null && beGroups !== null) {
        if (beWords.length === 0) {
          const localWords = await db.getAllWords()
          const localGroups = await db.getAllGroups()
          if (localWords.length) {
            console.log(`[LanguageBridge] 服务端词库为空，把本地 ${localWords.length} 个词迁移上去…`)
            await be.beBulkSaveWords(localWords)
            await be.beBulkSaveWordGroups(localGroups)
            words.value = localWords
            groups.value = localGroups
            if (localWords.length > 0) currentWord.value = localWords[0]
            return
          }
        }
        words.value = beWords
        groups.value = normalizeLibraryGroups(beGroups)
        if (beWords.length > 0) currentWord.value = beWords[0]
        return
      }

      const loadedWords = await db.getAllWords()
      const loadedGroups = await db.getAllGroups()
      words.value = loadedWords
      groups.value = normalizeLibraryGroups(loadedGroups)
      if (loadedWords.length > 0) currentWord.value = loadedWords[0]
    } catch (e) {
      error.value = '加载数据失败'
      console.error('loadWords error:', e)
    } finally {
      isLoading.value = false
    }
  }

  async function addWord(word: WordItem) {
    try {
      await db.saveWord(word)
      words.value.push(word)

      const allGroup = groups.value.find(g => g.id === 'all')
      if (allGroup) {
        allGroup.wordIds.push(word.id)
        await db.saveGroup(allGroup)
      }

      const levelGroup = groups.value.find(g => g.id === word.level)
      if (levelGroup) {
        levelGroup.wordIds.push(word.id)
        await db.saveGroup(levelGroup)
      }

      trackSync('beSaveWord', be.beSaveWord(word))
      be.bePatchWordLibrary([{
        word: word.word,
        create: true,
        phonetic: word.phonetic,
        topics: word.topics,
        word_family: word.word_family,
        exam_tags: word.tags,
        source: word.source
      }]).catch(() => { /* 服务端没起时只影响词库同步，应用照常能用 */ })
    } catch (e) {
      error.value = '保存单词失败'
      throw e
    }
  }

  async function addWords(newWords: WordItem[]): Promise<ImportResult> {
    const result: ImportResult = {
      successCount: 0,
      failCount: 0,
      total: newWords.length,
      messages: []
    }

    for (const word of newWords) {
      try {
        const exists = words.value.some(w => w.word === word.word)
        if (exists) {
          result.messages.push(`跳过已存在的单词: ${word.word}`)
          result.failCount++
          continue
        }

        await addWord(word)
        result.successCount++
      } catch (e) {
        result.failCount++
        result.messages.push(`添加失败: ${word.word}`)
      }
    }

    return result
  }

  async function updateWordFields(wordId: string, patch: Partial<Pick<WordItem,
    'word' | 'phonetic' | 'meanings' | 'common_phrases' | 'morphology' | 'etymology' |
    'memory_tips' | 'synonyms' | 'antonyms' | 'word_family' | 'example_sentences' | 'detailed_explanation' |
    'userNote'
  >>) {
    const word = words.value.find(w => w.id === wordId)
    if (!word) return
    Object.assign(word, patch)
    word.updatedAt = new Date().toISOString()
    await db.saveWord(JSON.parse(JSON.stringify(word)))
    trackSync('beSaveWord', be.beSaveWord(word))
  }

  async function memorizeWord(wordId: string, score: number = 100) {
    const word = words.value.find(w => w.id === wordId)
    if (word) {
      const now = new Date()
      const nextReview = new Date(now)
      nextReview.setDate(nextReview.getDate() + Math.max(1, Math.round(7 * (score / 100))))

      word.learningRecord = {
        lastReview: now.toISOString(),
        nextReview: nextReview.toISOString(),
        familiarity: score,
        reviewCount: (word.learningRecord?.reviewCount || 0) + 1,
        testScore: score
      }
      word.updatedAt = now.toISOString()

      await db.saveWord(word)
      trackSync('beSaveWord', be.beSaveWord(word))
    }
  }

  async function updateLearningRecord(wordId: string, record: Partial<WordItem['learningRecord']>) {
    const word = words.value.find(w => w.id === wordId)
    if (word && word.learningRecord) {
      word.learningRecord = { ...word.learningRecord, ...record }
      word.updatedAt = new Date().toISOString()
      await db.saveWord(word)
      trackSync('beSaveWord', be.beSaveWord(word))
    }
  }

  async function createGroup(group: WordGroup) {
    try {
      await db.saveGroup(group)
      groups.value.push(group)
      trackSync('beSaveWordGroup', be.beSaveWordGroup(group))
    } catch (e) {
      error.value = '创建分组失败'
      throw e
    }
  }

  async function updateGroup(groupId: string, updates: Partial<WordGroup>) {
    const group = groups.value.find(g => g.id === groupId)
    if (group) {
      Object.assign(group, updates, { updatedAt: new Date().toISOString() })
      await db.saveGroup(group)
      trackSync('beSaveWordGroup', be.beSaveWordGroup(group))
    }
  }

  async function deleteGroup(groupId: string) {
    if (groupId === 'all') return // 不能删除默认分组

    try {
      await db.deleteGroup(groupId)
      groups.value = groups.value.filter(g => g.id !== groupId)
      trackSync('beDeleteWordGroup', be.beDeleteWordGroup(groupId))
    } catch (e) {
      error.value = '删除分组失败'
      throw e
    }
  }

  async function addWordToGroup(wordId: string, groupId: string) {
    const group = groups.value.find(g => g.id === groupId)
    if (group && !group.wordIds.includes(wordId)) {
      group.wordIds.push(wordId)
      group.updatedAt = new Date().toISOString()
      await db.saveGroup(group)
      trackSync('beSaveWordGroup', be.beSaveWordGroup(group))
    }
  }

  async function removeWordFromGroup(wordId: string, groupId: string) {
    const group = groups.value.find(g => g.id === groupId)
    if (group) {
      group.wordIds = group.wordIds.filter(id => id !== wordId)
      group.updatedAt = new Date().toISOString()
      await db.saveGroup(group)
      trackSync('beSaveWordGroup', be.beSaveWordGroup(group))
    }
  }

  async function deleteWord(wordId: string) {
    try {
      await db.deleteWord(wordId)
      words.value = words.value.filter(w => w.id !== wordId)

      for (const group of groups.value) {
        if (group.wordIds.includes(wordId)) {
          group.wordIds = group.wordIds.filter(id => id !== wordId)
          await db.saveGroup(group)
          trackSync('beSaveWordGroup', be.beSaveWordGroup(group))
        }
      }
      trackSync('beDeleteWord', be.beDeleteWord(wordId))
    } catch (e) {
      error.value = '删除单词失败'
      throw e
    }
  }

  function setCurrentIndex(index: number) {
    if (index >= 0 && index < words.value.length) {
      currentIndex.value = index
      currentWord.value = words.value[index]
    }
  }

  function nextWord(): WordItem | null {
    if (words.value.length === 0) return null
    const nextIndex = (currentIndex.value + 1) % words.value.length
    setCurrentIndex(nextIndex)
    return currentWord.value
  }

  function previousWord(): WordItem | null {
    if (words.value.length === 0) return null
    const prevIndex = (currentIndex.value - 1 + words.value.length) % words.value.length
    setCurrentIndex(prevIndex)
    return currentWord.value
  }

  async function importWords(file: File): Promise<ImportResult> {
    const text = await file.text()
    const ext = file.name.split('.').pop()?.toLowerCase()

    let newWords: WordItem[] = []

    if (ext === 'json') {
      try {
        newWords = JSON.parse(text)
      } catch {
        return { successCount: 0, failCount: 1, total: 1, messages: ['JSON格式解析失败'] }
      }
    } else if (ext === 'txt' || ext === 'csv') {
      const lines = text.split('\n').filter(l => l.trim())
      newWords = lines.map((line, idx) => {
        const parts = line.split(',').map(p => p.trim())
        return {
          id: `import-${Date.now()}-${idx}`,
          word: parts[0] || '',
          phonetic: parts[1] || '',
          meanings: [{
            chinese: parts[2] || '',
            partOfSpeech: parts[3] || 'n.'
          }],
          level: 'CET4' as const,
          source: 'import',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }).filter(w => w.word)
    }

    return addWords(newWords)
  }

  async function setWordStatus(wordId: string, status: WordStatus) {
    const word = words.value.find(w => w.id === wordId)
    if (!word) return
    const wasKnown = word.status === 'known'
    word.status = status
    word.updatedAt = new Date().toISOString()
    await db.saveWord(JSON.parse(JSON.stringify(word)))
    trackSync('beSaveWord', be.beSaveWord(word))
    if (status === 'known' && !wasKnown) {
      recordWordLearned()
    }
  }

  /**
   * 只动错词本，别的什么都不碰。
   *
   * 抽出来是因为原来只有听写那条路会写错词本 —— 打字练习（TypeWords 流程）
   * 打错的词一个都进不去。打字流程的复习排期走 FSRS，不该顺带调用
   * recordDictationResult（那个还会写 learningRecord 那套间隔），
   * 所以两边共用这一个函数，各自的排期各走各的。
   */
  async function markWrongBook(wordId: string, correct: boolean, userInput = '') {
    const word = words.value.find(w => w.id === wordId)
    if (!word) return
    try {
      if (correct) {
        await db.removeFromWrongBook(wordId)
      } else {
        await db.recordWrongWord({
          wordId,
          word: word.word,
          input: userInput,
          date: new Date().toISOString().slice(0, 10)
        })
      }
    } catch (e) {
      console.warn('错词本写入失败（不阻断练习流程）:', e)
    }
  }

  async function recordDictationResult(wordId: string, correct: boolean, userInput = '') {
    const word = words.value.find(w => w.id === wordId)
    if (!word) return
    const now = new Date().toISOString()

    await markWrongBook(wordId, correct, userInput)
    /**
     * 听写/单词测试的结果也走 FSRS。
     *
     * 之前这里用的是 spacedRepetition.ts 那张固定间隔表（1/2/4/7/15/30 天），
     * 而打字流程走 FSRS —— 同一个词被两套算法各排一次，
     * 单词详情显示的日期和今日复习实际挑词的依据对不上。
     * 现在统一由 FSRS 出排期：答对记 Good，答错记 Again。
     */
    const card = applyGrade(word.word, (correct ? Rating.Good : Rating.Again) as any)
    const fsrsDue = new Date(card.due).toISOString()
    flushFsrsData().catch(() => { /* 落盘失败不阻断练习 */ })

    const prev = word.learningRecord
    const consecutiveCorrect = correct ? (prev?.consecutiveCorrect || 0) + 1 : 0
    const consecutiveWrong = correct ? 0 : (prev?.consecutiveWrong || 0) + 1
    const totalWrongCount = (prev?.totalWrongCount || 0) + (correct ? 0 : 1)

    word.learningRecord = {
      lastReview: now,
      // 排期只由 FSRS 算（下面 applyGrade 已经更新过卡片），这里只是把它抄一份
      // 到词条上，好让不方便读 FSRS 缓存的地方（老代码、导出）也看得到同一个日期
      nextReview: fsrsDue,
      familiarity: prev?.familiarity ?? 0,
      reviewCount: (prev?.reviewCount || 0) + 1,
      testScore: correct ? 100 : 0,
      consecutiveCorrect,
      consecutiveWrong,
      totalWrongCount
    }
    word.status = correct
      ? statusAfterCorrect(consecutiveCorrect, word.status || 'unmarked')
      : statusAfterWrong(consecutiveWrong)
    word.updatedAt = now
    await db.saveWord(JSON.parse(JSON.stringify(word)))
    trackSync('beSaveWord', be.beSaveWord(word))
    if (word.status === 'known') recordWordLearned()
  }

  async function listWrongBook(): Promise<Array<{
    wordId: string; word: string; lastWrongInput: string
    wrongCount: number; firstWrongDate: string; lastWrongDate: string
  }>> {
    const list = await db.getAllWrongBook()
    return list.sort((a, b) => String(b.lastWrongDate || '').localeCompare(String(a.lastWrongDate || '')))
  }

  async function removeFromWrongBook(wordId: string) {
    await db.removeFromWrongBook(wordId)
  }

  function setStudyList(list: WordItem[]) {
    studyList.value = list
  }

  async function importWordsAsGroup(file: File, groupName?: string): Promise<ImportResult> {
    const ext = file.name.split('.').pop()?.toLowerCase()
    const name = (groupName || file.name.replace(/\.[^.]+$/, '')).trim() || '未命名词书'

    let entries
    try {
      if (ext === 'json') {
        entries = parseJson(await file.text())
      } else {
        const text = await extractTextFromFile(file)
        entries = parseText(text)
      }
    } catch (e) {
      return {
        successCount: 0,
        failCount: 0,
        total: 0,
        messages: [`文件解析失败：${e instanceof Error ? e.message : '未知错误'}`]
      }
    }
    if (!entries.length) {
      return { successCount: 0, failCount: 0, total: 0, messages: ['未解析到有效词条，请检查文件格式'] }
    }

    const now = new Date().toISOString()
    const group: WordGroup = {
      id: `book-${Date.now()}`,
      name,
      description: `导入自 ${file.name}`,
      wordIds: [],
      createdAt: now,
      updatedAt: now
    }

    const result: ImportResult = { successCount: 0, failCount: 0, total: entries.length, messages: [] }
    const added: WordItem[] = []

    for (const e of entries) {
      const exists = words.value.find(w => w.word.toLowerCase() === e.word.toLowerCase())
      if (exists) {
        if (!group.wordIds.includes(exists.id)) group.wordIds.push(exists.id)
        result.messages.push(`已存在，归入词书: ${e.word}`)
        result.successCount++
        continue
      }
      const item = toWordItem(e, name)
      item.groupId = group.id
      group.wordIds.push(item.id)
      added.push(item)
      result.successCount++
    }

    for (const w of added) {
      await db.saveWord(JSON.parse(JSON.stringify(w)))
      words.value.push(w)
    }
    await db.saveGroup(JSON.parse(JSON.stringify(group)))
    groups.value.push(group)
    await be.beBulkSaveWords(added)
    await be.beBulkSaveWordGroups([group])

    if (added.length) {
      enrichProgress.value = { done: 0, total: added.length, current: '' }
      enrichWords(added, p => { enrichProgress.value = { ...p } })
        .then(async changed => {
          for (const w of changed) {
            const reactiveWord = words.value.find(x => x.id === w.id)
            if (reactiveWord) {
              Object.assign(reactiveWord, w)
            }
            await db.saveWord(JSON.parse(JSON.stringify(w)))
          }
        })
        .finally(() => { enrichProgress.value = null })
    }

    return result
  }

  async function dedupeWords(): Promise<{ merged: number; groupsFixed: number }> {
    const byWord = new Map<string, WordItem[]>()
    for (const w of words.value) {
      const key = w.word.toLowerCase().trim()
      if (!byWord.has(key)) byWord.set(key, [])
      byWord.get(key)!.push(w)
    }

    let merged = 0
    const idRemap = new Map<string, string>() // 被合并掉的id -> 保留下来的id
    const toDelete: string[] = []
    const toSave: WordItem[] = []

    for (const [, group] of byWord) {
      if (group.length < 2) continue
      const score = (w: WordItem) => {
        let s = 0
        if (w.tags?.length) s += 40            // 回填/手动打的考纲标签
        if (w.topics?.length) s += 40          // AI 补的话题
        if (w.morphemes) s += 40               // AI 补的词根词缀
        if (w.word_family?.length) s += 20
        if (w.aiEnrichedAt) s += 15            // 跑过 AI 的痕迹，即使这次没填上也别丢
        if (w.status && w.status !== 'unmarked') s += 30 // 用户自己标注过的状态最不可替代
        if (w.meanings?.some(m => m.chinese?.trim())) s += 10
        if (w.phonetic) s += 3
        if (w.example_sentences?.length) s += 2
        return s
      }
      group.sort((a, b) => score(b) - score(a))
      const keep = group[0]
      for (let i = 1; i < group.length; i++) {
        const dup = group[i]
        idRemap.set(dup.id, keep.id)
        toDelete.push(dup.id)
        if (!keep.phonetic && dup.phonetic) keep.phonetic = dup.phonetic
        if (!keep.meanings?.some(m => m.chinese?.trim()) && dup.meanings?.some(m => m.chinese?.trim())) {
          keep.meanings = dup.meanings
        }
        if (!keep.status || keep.status === 'unmarked') keep.status = dup.status
        if (!keep.morphemes && dup.morphemes) keep.morphemes = dup.morphemes
        if (!keep.aiEnrichedAt && dup.aiEnrichedAt) keep.aiEnrichedAt = dup.aiEnrichedAt
        if (!keep.example_sentences?.length && dup.example_sentences?.length) {
          keep.example_sentences = dup.example_sentences
        }
        const union = (a?: string[], b?: string[]) =>
          (a?.length || b?.length) ? [...new Set([...(a || []), ...(b || [])])] : undefined
        keep.tags = union(keep.tags, dup.tags) ?? keep.tags
        keep.topics = union(keep.topics, dup.topics) ?? keep.topics
        keep.word_family = union(keep.word_family, dup.word_family) ?? keep.word_family
        if (!keep.synonyms?.length && dup.synonyms?.length) keep.synonyms = dup.synonyms
        if (!keep.antonyms?.length && dup.antonyms?.length) keep.antonyms = dup.antonyms
      }
      keep.updatedAt = new Date().toISOString()
      toSave.push(keep)
      merged += group.length - 1
    }

    if (!merged) return { merged: 0, groupsFixed: 0 }

    let groupsFixed = 0
    for (const g of groups.value) {
      const newIds: string[] = []
      const seen = new Set<string>()
      let changed = false
      for (const id of g.wordIds) {
        const realId = idRemap.get(id) || id
        if (realId !== id) changed = true
        if (!seen.has(realId)) {
          seen.add(realId)
          newIds.push(realId)
        } else {
          changed = true
        }
      }
      if (changed) {
        g.wordIds = newIds
        g.updatedAt = new Date().toISOString()
        await db.saveGroup(JSON.parse(JSON.stringify(g)))
        groupsFixed++
      }
    }

    await db.saveWordsBulk(JSON.parse(JSON.stringify(toSave)))
    for (const id of toDelete) await db.deleteWord(id)

    await loadWords()
    return { merged, groupsFixed }
  }

  function exportWords(): string {
    return JSON.stringify(words.value, null, 2)
  }

  return {
    words,
    groups,
    currentWord,
    currentIndex,
    isLoading,
    error,

    totalWords,
    learnedCount,
    needReviewCount,
    progressPercentage,

    loadWords,
    getWordsByGroup,
    getReviewWords,

    addWord,
    addWords,
    deleteWord,
    memorizeWord,
    updateWordFields,
    updateLearningRecord,

    createGroup,
    updateGroup,
    deleteGroup,
    addWordToGroup,
    removeWordFromGroup,

    setCurrentIndex,
    nextWord,
    previousWord,

    enrichProgress,
    studyList,
    searchQuery,
    setWordStatus,
    setStudyList,
    recordDictationResult,
    markWrongBook,
    listWrongBook,
    removeFromWrongBook,

    importWords,
    importWordsAsGroup,
    dedupeWords,
    exportWords
  }
})
