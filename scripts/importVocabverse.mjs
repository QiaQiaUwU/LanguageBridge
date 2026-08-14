/**
 * 一次性把 VocabVerse（毕设项目"英语词汇可视化学习系统"）生成的词汇解释数据
 * 合并进 LanguageBridge 词库，让这批词变成正式词条（词汇中心列表能看到、能筛选）。
 *
 * 背景：这批数据是 15000+ 个独立 JSON 文件（文件名是不可逆的哈希，看不出对应哪个
 * 单词，必须逐个打开读 word 字段），由用户手动剪切粘贴进项目里。
 *
 * 存放位置是 vendor-data/word_explanations/（项目根目录，不在 public/ 或 dist/ 下）——
 * 之前放在 public/data/word_explanations/，结果被 Vite 当成静态资源，每次
 * npm run build 都要把这 15000+ 个文件连着 dist/ 一起清空重新复制一遍，
 * Windows 下只要有一个文件被杀毒软件/云盘同步/上一个未完全退出的进程占用，
 * 删不干净就直接导致构建失败（ENOTEMPTY）。这批数据只是服务器读一次用来导入词库、
 * 以及浏览器端按需补全用（走 server.mjs 里单独的 /data/word_explanations/* 路由），
 * 完全不需要经过 Vite 处理，搬到这里就绕开了这个问题。
 *
 * 之前 shared/stores/wordStore.ts 里已经有一套 importFullLibrary()，但那是给浏览器端
 * File System Access API（用户手动点"关联文件夹"）用的，需要用户交互、且明确注释写着
 * "故意不接后端持久化"（避免几千次单条 fetch 拖垮导入速度）。这次改成服务器启动时
 * 自动跑一遍、一次性批量写入 data/words.json，不需要用户点任何按钮，也不会有
 * "几千次单条请求"的问题——因为这里是本地文件系统直接读写，不是网络请求。
 *
 * 幂等性：导入完成后在 data/ 目录下写一个标记文件 .vocabverse-imported，
 * 下次启动检测到标记就跳过，不会重复导入把词库越导越大。用户如果想强制重新导入
 * （比如释义库内容更新了），删掉这个标记文件、重启一次服务器就行。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE_LABEL = '英语词汇可视化学习系统'

/** 修正已导入用户手里，分类子分组（CET4/CET6/初中…）缺失 parentId、名称带
 *  "释义库：" 多余前缀的历史数据。幂等：已经是新结构的分组不会被重复改写，
 *  也不会新增/删除任何分组，只订正这两个字段。 */
function migrateGroupHierarchy(store) {
  const groups = store.readCollection('word_groups')
  const allGroupId = 'book-lib-all'
  let touched = false
  for (const g of groups) {
    if (!g.id || !g.id.startsWith('book-lib-cat-')) continue
    if (g.parentId !== allGroupId) { g.parentId = allGroupId; touched = true }
    /**
     * ⚠ 这里原来写的是 startsWith('释义库：')，**全角**冒号——
     * 而实际数据里是半角的，于是这条订正从来没生效过：每次启动都跑一遍，
     * 每次都什么都没改，用户手里那批「释义库: CET4」就一直挂在顶层词库那一排。
     * 改成正则，全角半角、前后有没有空格都认。
     */
    if (g.name) {
      const next = String(g.name).replace(/^\s*释义库\s*[：:]\s*/, '')
      if (next && next !== g.name) { g.name = next; touched = true }
    }
  }
  if (touched) store.writeCollection('word_groups', groups)
}

/** VocabVerse 的分类到 LanguageBridge LevelType 的映射。
 *  LevelType 只有 8 个固定值（CET4/CET6/考研/TOEFL/IELTS/GRE/SAT/高考），
 *  VocabVerse 的"初中""高中"没有对应值——这两种没有精确映射目标，交给 tags
 *  数组承载（下面会看到），level 字段只在能找到精确对应值时才填。 */
const CATEGORY_TO_LEVEL = {
  'CET4': 'CET4', 'CET-4': 'CET4',
  'CET6': 'CET6', 'CET-6': 'CET6',
  '考研': '考研',
  '托福': 'TOEFL', 'TOEFL': 'TOEFL',
  '雅思': 'IELTS', 'IELTS': 'IELTS',
  'GRE': 'GRE',
  'SAT': 'SAT',
  '高考': '高考', '高中': '高考' // "高中"词汇范围跟"高考"考纲基本重合，没有更精确的对应值时退而求其次
}

/** 从一个词汇解释 JSON 里提取全部分类标签，尽量取最完整的一份。
 *  三个字段里 categories（数组）通常最全，category（逗号分隔字符串）其次，
 *  sources 有时候会漏（见 easter.json 例子：categories 比 sources 多了"雅思"），
 *  所以按这个优先级取，不是简单取第一个存在的字段。 */
function extractCategories(exp) {
  if (Array.isArray(exp.categories) && exp.categories.length) {
    return exp.categories.map(c => String(c).trim()).filter(Boolean)
  }
  if (exp.category) {
    return String(exp.category).split(/[,，、]\s*/).map(s => s.trim()).filter(Boolean)
  }
  if (Array.isArray(exp.sources) && exp.sources.length) {
    return exp.sources.map(c => String(c).trim()).filter(Boolean)
  }
  return []
}

/** 从一个词汇解释 JSON 里映射成 LanguageBridge 的 WordItem 形状。
 *  字段名基本是直接对应的（LanguageBridge 的 WordItem 类型注释里写着这些扩展字段
 *  "来自可视化系统"，本来就是照着这批数据的结构预留的），这里的映射逻辑
 *  跟浏览器端 shared/core/enrichment.ts 的 applyExplanation() 是同一套对应关系，
 *  只是这里要独立实现一份（Node 脚本不能直接 import 带 Vue 路径别名的前端模块）。 */
/** 释义库 JSON → 应用内的 WordItem。
 *  导出出去是因为"从词库重建工作缓存"要用同一份映射——
 *  两处各写一遍的话，重建出来的词条跟导入进来的会长得不一样，
 *  而这正是"以词库为准"最不能出的错。 */
export function mapToWordItem(exp, now) {
  const word = String(exp.word || '').trim()
  if (!word) return null

  const meanings = Array.isArray(exp.pos_definitions) && exp.pos_definitions.length
    ? exp.pos_definitions.map(d => ({
        chinese: d.definition_zh || '',
        english: d.definition_en || '',
        partOfSpeech: d.pos || ''
      }))
    : []

  const synonyms = Array.isArray(exp.synonyms)
    ? exp.synonyms.map(s => (typeof s === 'string' ? { word: s } : { word: s.word, difference: s.difference }))
    : undefined
  const antonyms = Array.isArray(exp.antonyms)
    ? exp.antonyms.map(a => (typeof a === 'string' ? { word: a } : { word: a.word, note: a.note }))
    : undefined
  const exampleSentences = Array.isArray(exp.example_sentences)
    ? exp.example_sentences.map(e => ({ en: e.en || e.english || '', zh: e.zh || e.chinese || '' }))
    : undefined

  const categories = extractCategories(exp)
  // level 只在这批分类里能精确对应到某个 LevelType 值时才填（取第一个匹配到的），
  // 完整的多分类信息不会丢——全部塞进 tags，这才是前端"按来源筛选"该读的字段。
  // 找不到任何精确对应时，level 留一个兜底值（IELTS 是 VocabVerse 词库覆盖面
  // 最广的一档，但这只影响 level 这个单值字段，不影响 tags 里真实、完整的分类）。
  let level = 'IELTS'
  for (const cat of categories) {
    if (CATEGORY_TO_LEVEL[cat]) { level = CATEGORY_TO_LEVEL[cat]; break }
  }

  const idSafe = word.toLowerCase().replace(/[^a-z0-9]/g, '') || 'w'
  return {
    id: `lib-${idSafe}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    word,
    phonetic: exp.pronunciation || '',
    meanings,
    level,
    source: SOURCE_LABEL,
    status: 'unmarked',
    createdAt: now,
    updatedAt: now,
    // tags 承载完整的多分类信息（"高中""CET6""考研""托福""雅思"这种一个词可以
    // 同时属于好几个的情况），词汇宇宙页面"按来源筛选"面板读的就是这个字段，
    // 不是只能表达单值的 level。
    tags: categories.length ? categories : undefined,
    morphology: exp.morphology || undefined,
    etymology: exp.etymology || undefined,
    memory_tips: exp.memory_tips || undefined,
    word_family: Array.isArray(exp.word_family) ? exp.word_family : undefined,
    synonyms,
    antonyms,
    common_phrases: Array.isArray(exp.common_phrases) ? exp.common_phrases : undefined,
    example_sentences: exampleSentences,
    categoriesRaw: categories
  }
}

export function runVocabverseImportIfNeeded(rootDir, store) {
  // 资源目录：优先新名字 resources/，老装机可能还是 vendor-data/，两个都认。
  const resRoot = existsSync(join(rootDir, 'resources')) ? 'resources' : 'vendor-data'
  const explDir = join(rootDir, resRoot, 'word_explanations')
  const markerFile = join(store.DATA_DIR, '.vocabverse-imported')

  // 迁移步骤：修正已经导入过的用户手里，分类子分组缺失 parentId、命名带多余前缀
  // 的历史数据——这个函数本身是幂等的（每次跑都安全，不会重复处理），所以放在
  // "已导入过、直接跳过"这个判断之前，即使标记文件已经存在也会先跑一次修正。
  migrateGroupHierarchy(store)

  if (existsSync(markerFile)) return { skipped: true, reason: '已导入过，跳过（删除 data/.vocabverse-imported 可强制重新导入）' }
  if (!existsSync(explDir)) return { skipped: true, reason: 'word_explanations 目录不存在' }

  const files = readdirSync(explDir).filter(f => f.toLowerCase().endsWith('.json'))
  if (!files.length) return { skipped: true, reason: 'word_explanations 目录为空' }

  console.log(`检测到 ${files.length} 个词汇解释文件，开始一次性导入词库（只在首次启动时跑一次）…`)
  const now = new Date().toISOString()

  const existingWords = store.readCollection('words')
  const existingByWord = new Map(existingWords.map(w => [String(w.word || '').toLowerCase(), w]))

  const newItems = []
  let enrichedCount = 0
  let parseErrors = 0
  const categoryToWordIds = new Map() // 分类名 -> 这批新导入词条的 id 列表

  const total = files.length
  let processed = 0
  const progressStep = Math.max(500, Math.floor(total / 20)) // 大约打印20次左右，文件少时至少每500个报一次

  for (const f of files) {
    processed++
    if (processed % progressStep === 0 || processed === total) {
      const pct = Math.round((processed / total) * 100)
      console.log(`  导入进度：${processed}/${total}（${pct}%）`)
    }
    let exp
    try {
      exp = JSON.parse(readFileSync(join(explDir, f), 'utf-8'))
    } catch {
      parseErrors++
      continue
    }
    const mapped = mapToWordItem(exp, now)
    if (!mapped) continue

    const key = mapped.word.toLowerCase()
    const existing = existingByWord.get(key)
    if (existing) {
      // 已经在词库里的词：只补缺失字段，不覆盖用户已有的正确数据
      let touched = false
      if (!existing.phonetic && mapped.phonetic) { existing.phonetic = mapped.phonetic; touched = true }
      if (!existing.morphology && mapped.morphology) { existing.morphology = mapped.morphology; touched = true }
      if (!existing.etymology && mapped.etymology) { existing.etymology = mapped.etymology; touched = true }
      if (!existing.memory_tips && mapped.memory_tips) { existing.memory_tips = mapped.memory_tips; touched = true }
      if (!existing.word_family && mapped.word_family) { existing.word_family = mapped.word_family; touched = true }
      if (!existing.synonyms && mapped.synonyms) { existing.synonyms = mapped.synonyms; touched = true }
      if (!existing.antonyms && mapped.antonyms) { existing.antonyms = mapped.antonyms; touched = true }
      if (!existing.example_sentences && mapped.example_sentences) { existing.example_sentences = mapped.example_sentences; touched = true }
      // tags 是多值字段，已有词条可能已经有一部分标签（比如用户自己标过"高频"），
      // 这里做合并去重而不是简单"缺失才补"，否则同一个词从两个不同分类的 json
      // 文件（理论上不该发生，但防一手）导入时后一次会覆盖前一次的标签。
      if (mapped.tags?.length) {
        const merged = new Set([...(existing.tags || []), ...mapped.tags])
        if (merged.size !== (existing.tags?.length || 0)) {
          existing.tags = [...merged]
          touched = true
        }
      }
      if (touched) { existing.updatedAt = now; enrichedCount++ }
      for (const cat of mapped.categoriesRaw) {
        if (!categoryToWordIds.has(cat)) categoryToWordIds.set(cat, [])
        categoryToWordIds.get(cat).push(existing.id)
      }
    } else {
      const { categoriesRaw, ...item } = mapped
      newItems.push(item)
      existingByWord.set(key, item)
      for (const cat of categoriesRaw) {
        if (!categoryToWordIds.has(cat)) categoryToWordIds.set(cat, [])
        categoryToWordIds.get(cat).push(item.id)
      }
    }
  }

  // 一次性合并写入，而不是逐条 upsert——15000+ 条逐条读写磁盘文件会很慢，
  // 这里直接在内存里拼好整个新数组，写一次文件。
  const mergedWords = [...existingWords, ...newItems]
  store.writeCollection('words', mergedWords)

  // 词书分组：按 VocabVerse 的分类（初中/高中/CET-4…）建组，方便词汇中心里按来源筛选，
  // 复刻的是浏览器端 importFullLibrary() 里"一个词可以同时属于多个词书"的分组逻辑。
  const existingGroups = store.readCollection('word_groups')
  const allGroupId = 'book-lib-all'
  let allGroup = existingGroups.find(g => g.id === allGroupId)
  const allWordIds = new Set(allGroup?.wordIds || [])
  for (const item of newItems) allWordIds.add(item.id)
  if (!allGroup) {
    allGroup = {
      id: allGroupId,
      name: '完整释义库（全部）',
      description: `${SOURCE_LABEL} 全量导入`,
      wordIds: [...allWordIds],
      createdAt: now,
      updatedAt: now
    }
    existingGroups.push(allGroup)
  } else {
    allGroup.wordIds = [...allWordIds]
    allGroup.updatedAt = now
  }

  for (const [cat, wordIds] of categoryToWordIds) {
    const groupId = `book-lib-cat-${cat}`
    let g = existingGroups.find(x => x.id === groupId)
    const idSet = new Set([...(g?.wordIds || []), ...wordIds])
    if (!g) {
      g = {
        id: groupId,
        name: cat,
        description: `${SOURCE_LABEL} - ${cat}分类`,
        wordIds: [...idSet],
        // 挂在"完整释义库"这个顶层词库底下，对应"先选词库、再在词库内按分类筛选"
        // 这个两层结构——之前这里没写 parentId，导致 CET4/初中/托福 这些分类跟
        // "完整释义库"平起平坐挤在同一排，跟真实产品里"选完词库才进分类"的
        // 使用顺序对不上。
        parentId: allGroupId,
        createdAt: now,
        updatedAt: now
      }
      existingGroups.push(g)
    } else {
      g.wordIds = [...idSet]
      g.parentId = allGroupId
      g.updatedAt = now
    }
  }
  store.writeCollection('word_groups', existingGroups)

  mkdirSync(store.DATA_DIR, { recursive: true })
  writeFileSync(markerFile, JSON.stringify({
    importedAt: now,
    fileCount: files.length,
    newWords: newItems.length,
    enrichedWords: enrichedCount,
    parseErrors
  }, null, 2))

  console.log(`词库导入完成：新增 ${newItems.length} 个词，补全 ${enrichedCount} 个已有词的字段${parseErrors ? `，${parseErrors} 个文件解析失败已跳过` : ''}`)
  return { skipped: false, newWords: newItems.length, enrichedWords: enrichedCount, parseErrors }
}
