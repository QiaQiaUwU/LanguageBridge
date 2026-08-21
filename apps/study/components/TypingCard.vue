<template>
  <div class="typing-card">
    <div class="meta-line top">
      <span v-if="word.phonetic" class="phonetic" :class="{ 'ph-hide': !revealRest }">/ {{ word.phonetic.replace(/^\/|\/$/g, '') }} /</span>
    </div>

    <p v-if="sentenceIdx >= 0" class="sentence-tip">
      跟打例句 {{ sentenceIdx + 1 }} / {{ sentences.length }}
    </p>
    <div class="word-line" :class="{ 'is-wrong': !!wrong, 'is-sentence': sentenceIdx >= 0, 'all-right': isRight }" :style="{ fontSize: (sentenceIdx >= 0 ? Math.round(settings.fontSize.wordForeign * 0.55) : settings.fontSize.wordForeign) + 'px' }">
      <template v-for="(seg, i) in letterRuns" :key="i">
        <span v-if="seg.type === 'complete'">{{ seg.val }}</span>
        <span v-else-if="seg.type === 'right'" class="input-right">{{ seg.val }}</span>
        <span v-else-if="seg.type === 'wrong'" class="input-wrong">{{ seg.val }}</span>
        <span v-else class="word-end" :class="{ hide: !revealRest }">{{ revealRest ? seg.val : '_'.repeat(seg.val.length) }}</span>
      </template>
    </div>

    <!-- 照 TypeWord.vue 单词下面那一排操作按钮：已掌握 / 笔记 / 收藏 / 跳过，
         外加原来就有的发音。上游那四个我们一个都没有，只能靠翻页面绕过去。 -->
    <div class="icon-row">
      <button class="speak-btn" :title="`播放发音（${settings.shortcutKeyMap.replaySound}）`" @click="speak">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
      </button>
      <button
        class="speak-btn"
        :class="{ on: masteredNow }"
        :title="(masteredNow ? '取消已掌握' : '标记已掌握') + `（${settings.shortcutKeyMap.toggleMastered}）`"
        @click="onToggleMastered"
      >
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9.2z"/></svg>
      </button>
      <button class="speak-btn" :class="{ on: noteEditing || !!word.userNote }" :title="`笔记（${settings.shortcutKeyMap.editNote}）`" @click="toggleNote">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm3 5v2h8V9zm0 4v2h8v-2zm0 4v2h5v-2z"/></svg>
      </button>
      <button class="speak-btn" :class="{ on: collectOpen }" :title="`收藏进词表（${settings.shortcutKeyMap.collectWord}）`" @click="collectOpen = !collectOpen">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="m12 17.3-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z"/></svg>
      </button>
      <button class="speak-btn" :title="`跳过（${settings.shortcutKeyMap.skipWord}）`" @click="emit('skip')">
        <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M6 5l8 7-8 7zm10 0h2v14h-2z"/></svg>
      </button>
    </div>

    <div v-if="collectOpen" class="collect-box">
      <p v-if="!wordStore.groups.length" class="cb-empty">还没有词表</p>
      <button
        v-for="g in wordStore.groups"
        :key="g.id"
        class="cb-item"
        :class="{ in: g.wordIds.includes(word.id) }"
        @click="collectTo(g.id)"
      >{{ g.name }}<span v-if="g.wordIds.includes(word.id)" class="cb-in">已在里面</span></button>
    </div>

    <div v-if="noteEditing" class="note-box">
      <textarea v-model="noteDraft" class="nb-input" rows="3" placeholder="给这个词记点什么"></textarea>
      <div class="nb-acts">
        <button v-if="word.userNote" class="nb-btn" @click="deleteNote">删除</button>
        <button class="nb-btn" @click="cancelNote">取消</button>
        <button class="nb-btn primary" @click="saveNote">保存</button>
      </div>
    </div>
    <p v-else-if="word.userNote" class="note-view">{{ word.userNote }}</p>

    <WordLookupPopover />

    <div class="meaning" :style="{ fontSize: settings.fontSize.wordTranslate + 'px', opacity: showMeaning ? 1 : 0 }">
      <div v-for="(g, i) in posGroups" :key="i" class="pos-row">
        <span class="pos">{{ g.pos }}</span>
        <span class="pos-text">{{ g.text }}</span>
      </div>
      <div v-if="!posGroups.length" class="pos-row"><span class="pos-text">（暂无释义）</span></div>
    </div>

    <div v-if="choiceOn" class="choice-grid">
      <button
        v-for="(c, i) in choices"
        :key="i"
        class="choice-btn"
        :class="{ picked: choicePicked === i, right: choicePicked !== null && c.right, wrong: choicePicked === i && !c.right }"
        @click="pickChoice(i)"
      ><kbd>{{ i + 1 }}</kbd> {{ c.text }}</button>
    </div>
    <div v-else-if="type === 'identify'" class="identify-row">
      <button class="idt-btn know" @click="onIdentify('know')">认识 <kbd>1</kbd></button>
      <button class="idt-btn unknown" @click="onIdentify('unknown')">不认识 <kbd>2</kbd></button>
      <button class="idt-btn mastered" @click="onIdentify('mastered')">已掌握 <kbd>3</kbd></button>
    </div>

    <div v-if="type !== 'identify' && revealRest" class="detail-block">
      <template v-if="sentencePairs.length">
        <div class="line-white"></div>
        <div v-for="(se, i) in sentencePairs" :key="i" class="sentence">
          <div class="s-en">
            <!-- 照 TypeWord.vue 的 ClickableEnglishText：例句里的词能点开查释义，
                 目标词本身高亮。整句朗读挪到右边那个小喇叭上 ——
                 原来是点句子任意位置朗读，接了查词就冲突了。 -->
            <span
              v-for="(tk, ti) in tokensOf(se.en)"
              :key="ti"
              :class="tk.isWord ? (isTargetToken(tk.text) ? 'tk hit' : 'tk') : ''"
              @click="tk.isWord && lookup(tk.text, $event)"
            >{{ tk.text }}</span>
            <button class="s-speak" title="朗读这句" @click.stop="speakSentence(i)">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
            </button>
          </div>
          <div v-if="se.zh" class="s-cn">{{ se.zh }}</div>
        </div>
      </template>

      <template v-if="phrasePairs.length">
        <div class="line-white"></div>
        <div class="blk">
          <div class="label">短语</div>
          <div class="blk-body">
            <div v-for="(p, i) in phrasePairs" :key="i" class="phrase">
              <span class="en">
                <span
                  v-for="(tk, ti) in tokensOf(p.en)"
                  :key="ti"
                  :class="tk.isWord ? (isTargetToken(tk.text) ? 'tk hit' : 'tk') : ''"
                  @click="tk.isWord && lookup(tk.text, $event)"
                >{{ tk.text }}</span>
              </span>
              <!-- 短语原来连发音都没有，上游是每条后面挂一个小喇叭 -->
              <button class="s-speak" title="朗读这个短语" @click.stop="speakPhrase(p.en)">
                <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
              </button>
              <span class="cn">{{ p.zh }}</span>
            </div>
          </div>
        </div>
      </template>

      <template v-if="synonymList.length">
        <div class="line-white"></div>
        <div class="blk">
          <div class="label">近义词</div>
          <div class="blk-body syno-body">
            <span v-for="(sy, i) in synonymList" :key="i" class="syno" :title="sy.difference || ''">{{ sy.word }}</span>
          </div>
        </div>
      </template>

      <template v-if="morphemeText">
        <div class="line-white"></div>
        <div class="blk">
          <div class="label">词根</div>
          <div class="blk-body">{{ morphemeText }}</div>
        </div>
      </template>

      <template v-if="word.etymology && settings.showEtymologyAndRelWords">
        <div class="line-white"></div>
        <div class="blk">
          <div class="label">词源</div>
          <div class="blk-body pre">{{ word.etymology }}</div>
        </div>
      </template>

      <template v-if="relWords.length && settings.showEtymologyAndRelWords">
        <div class="line-white"></div>
        <div class="blk">
          <div class="label">相关词</div>
          <div class="blk-body syno-body">
            <span v-for="(w, i) in relWords" :key="i" class="syno">{{ w }}</span>
          </div>
        </div>
      </template>
    </div>

    <div v-if="settings.showNearWord && showNear && prevWord" class="prev-corner">
      <span class="pc-label">上一个</span>
      <span class="pc-word">{{ prevWord }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { WordItem } from '@/shared/types/WordItem'
import type { PracticeType } from '@/shared/core/studySettings'
import { getStudySettings } from '@/shared/core/studySettings'
import { playWord, playSentence } from '@/shared/core/audio'
import { isSpellingCorrect } from '@/shared/core/spellJudge'
import { typeStep, clearAfterWrong } from '@/shared/core/typeStep'
import { setKeySound, playKeySound } from '@/shared/core/keySound'
import { useWordStore } from '@/shared/stores/wordStore'
import { isMastered, removeMastered } from '@/shared/core/masteredWords'
import WordLookupPopover from '@/apps/word-core/components/WordLookupPopover.vue'
import { openWordLookup, splitEnglishText } from '@/shared/core/wordLookup'

const props = defineProps<{
  prevWord?: string
  nextWord?: string
  word: WordItem
  type: PracticeType
  pool?: WordItem[]
  showTranslate?: boolean
  hideWord?: boolean
}>()

const emit = defineEmits<{
  (e: 'complete'): void
  (e: 'wrong'): void
  (e: 'know'): void
  (e: 'mastered'): void
  /** 跳过：不记错、不再安排，直接下一个（对应上游的 skip / Ignore） */
  (e: 'skip'): void
}>()

const settings = getStudySettings()
const wordStore = useWordStore()

/* ---------- 单词操作：已掌握 / 笔记 / 收藏 ---------- */

/**
 * 已掌握。对应上游的 toggleWordSimple：
 * 没标过就标上并跳到下一个（交给 StudyPage 的 onMastered 处理排除和推进），
 * 已经标了就只是取消，停在原地。
 */
const masteredTick = ref(0)
const masteredNow = computed(() => {
  void masteredTick.value
  return isMastered(props.word.word)
})
async function onToggleMastered() {
  if (masteredNow.value) {
    await removeMastered(props.word.word)
    masteredTick.value++
    return
  }
  emit('mastered')
}

const noteEditing = ref(false)
const noteDraft = ref('')
function toggleNote() {
  noteEditing.value = !noteEditing.value
  noteDraft.value = noteEditing.value ? (props.word.userNote || '') : ''
}
async function saveNote() {
  await wordStore.updateWordFields(props.word.id, { userNote: noteDraft.value.trim() || undefined })
  noteEditing.value = false
}
function cancelNote() {
  noteEditing.value = false
  noteDraft.value = ''
}
async function deleteNote() {
  await wordStore.updateWordFields(props.word.id, { userNote: undefined })
  noteEditing.value = false
  noteDraft.value = ''
}

/* ---------- 例句 / 短语里的可点词 ---------- */

/** 切成「单词 / 非单词」片段，跟阅读助手用的是同一个 splitEnglishText */
function tokensOf(text: string) {
  return splitEnglishText(text || '')
}

/** 这个词是不是正在练的目标词（含常见变形），是就高亮 */
function isTargetToken(tk: string): boolean {
  const t = tk.toLowerCase()
  const base = props.word.word.toLowerCase()
  if (t === base) return true
  // 只做最保守的几种：复数/三单、过去式、进行时。判错了顶多少高亮一个词
  if (t.length > base.length && t.startsWith(base)) {
    return ['s', 'es', 'd', 'ed', 'ing', "'s"].includes(t.slice(base.length))
  }
  return false
}

function lookup(raw: string, e: MouseEvent) {
  const el = e.target as HTMLElement
  openWordLookup(raw, el, async candidates => {
    for (const c of candidates) {
      const hit = wordStore.words.find(w => w.word.toLowerCase() === c.toLowerCase())
      if (hit) return hit
    }
    return null
  })
}

function speakPhrase(text: string) {
  playWord(text, settings.soundType || 'us', settings.wordSoundSpeed).catch(() => {})
}

const collectOpen = ref(false)
async function collectTo(groupId: string) {
  await wordStore.addWordToGroup(props.word.id, groupId)
  collectOpen.value = false
}

const input = ref('')      // 已经打对的部分
const wrong = ref('')      // 当前打错的那一个字符（500ms 后自动清）
const revealed = ref(false) // 是否已经把答案亮出来了
let inputLock = false      // 打完之后锁住，防止连击重复触发跳词
let waitClear = false      // 错字清除的等待窗口，期间忽略输入
let jumpTimer: ReturnType<typeof setTimeout> | null = null
function clearJumpTimer() {
  if (!jumpTimer) return
  clearTimeout(jumpTimer)
  jumpTimer = null
}

let clearTimer: ReturnType<typeof setTimeout> | null = null
function cancelWrongClear() {
  if (!clearTimer) return
  clearTimeout(clearTimer)
  clearTimer = null
}
let wordCompletedAt = 0    // 打完的时刻，用来做空格冷却
let repeatDone = 0         // 这个词在本次已经打对几遍（repeatCount 用）

/** 只要英文的那一份，句子跟打模式要用 */
const sentences = computed<string[]>(() =>
  (props.word.example_sentences || []).map(e => String(e.en || '').trim()).filter(Boolean)
)

/**
 * 带译文的例句。原来 sentences 只 map 了 e.en，**中文 e.zh 被直接丢掉**，
 * 所以卡片上是三条光秃秃的英文。数据一直都在，是我们没取。
 */
const sentencePairs = computed(() =>
  (props.word.example_sentences || [])
    .map(e => ({ en: String(e.en || '').trim(), zh: String(e.zh || '').trim() }))
    .filter(x => x.en)
)

/** 短语搭配，对应 TypeWords 的 phrases 区块 */
const phrasePairs = computed(() =>
  (props.word.common_phrases || [])
    .map(p => ({ en: String(p.phrase_en || '').trim(), zh: String(p.phrase_zh || '').trim() }))
    .filter(x => x.en)
)

/** 近义词，对应它的 synos 区块 */
const synonymList = computed(() =>
  (props.word.synonyms || [])
    .map(x => (typeof x === 'string' ? { word: x, difference: '' } : x))
    .filter((x: any) => x?.word)
)

const showNear = computed(() => props.type !== 'dictation' && props.type !== 'listen')

const sentenceIdx = ref(-1)
const practiceSentenceOn = computed(() =>
  settings.practiceSentence && props.type === 'followWrite' && sentences.value.length > 0
)

const target = computed(() => (
  sentenceIdx.value >= 0
    ? (sentences.value[sentenceIdx.value] || props.word.word)
    : props.word.word
))
const restText = computed(() => target.value.slice(input.value.length + wrong.value.length))

const letterRuns = computed<Array<{ type: 'complete' | 'right' | 'wrong' | 'end'; val: string }>>(() => {
  const word = target.value
  const typed = input.value + wrong.value
  const eq = (a: string, b: string) =>
    settings.ignoreCase ? a?.toLowerCase() === b?.toLowerCase() : a === b

  if (!typed.length) return [{ type: 'end', val: word }]
  if (typed.length === word.length && eq(typed, word)) return [{ type: 'complete', val: typed }]

  const out: Array<{ type: 'complete' | 'right' | 'wrong' | 'end'; val: string }> = []
  typed.split('').forEach((ch, i) => {
    const kind: 'right' | 'wrong' = eq(ch, word[i]) ? 'right' : 'wrong'
    const last = out[out.length - 1]
    if (last && last.type === kind) last.val += ch
    else out.push({ type: kind, val: ch })
  })
  if (typed.length < word.length) out.push({ type: 'end', val: word.slice(typed.length) })
  return out
})

const meaningText = computed(() => props.word.meanings?.[0]?.chinese || '')

/** 按词性分组，一行一个词性 —— 照 TranslationList.vue 的 posList 结构。
 *  我们原来把所有释义拼成一行，词性多的词（cancel 有 v./n.）挤成一坨。 */
const posGroups = computed(() => {
  const out: Array<{ pos: string; text: string }> = []
  for (const m of props.word.meanings || []) {
    if (!m.chinese) continue
    const pos = (m.partOfSpeech || '').trim()
    const hit = out.find(x => x.pos === pos)
    if (hit) hit.text += '；' + m.chinese
    else out.push({ pos, text: m.chinese })
  }
  return out
})

const morphemeText = computed(() => {
  const m = props.word.morphemes
  if (!m) return ''
  const parts: string[] = []
  const push = (label: string, x: any) => {
    if (x?.form) parts.push(`${label} ${x.form}${x.meaning ? '（' + x.meaning + '）' : ''}`)
  }
  push('前缀', m.prefix)
  push('词根', m.root)
  push('后缀', m.suffix)
  return parts.join('  ·  ')
})

const relWords = computed(() => {
  const out: string[] = []
  const seen = new Set([props.word.word.toLowerCase()])
  const push = (x: any) => {
    const v = String(x ?? '').trim()
    if (!v || seen.has(v.toLowerCase())) return
    seen.add(v.toLowerCase())
    out.push(v)
  }
  for (const f of props.word.word_family || []) push(f)
  for (const sy of props.word.synonyms || []) push(sy.word)
  for (const an of props.word.antonyms || []) push(an.word)
  return out.slice(0, 6)
})

const choiceOn = computed(() =>
  props.type === 'identify' && settings.identifyMethod === 'choice' && choices.value.length >= 2
)
const choicePicked = ref<number | null>(null)

const choices = computed<{ text: string; right: boolean }[]>(() => {
  if (props.type !== 'identify' || settings.identifyMethod !== 'choice') return []
  const right = meaningText.value
  if (!right) return []
  const pool = (props.pool || []).filter(w =>
    w.word !== props.word.word && w.meanings?.[0]?.chinese
  )
  let seed = 0
  for (let i = 0; i < props.word.word.length; i++) seed = (seed * 31 + props.word.word.charCodeAt(i)) >>> 0
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const picked: string[] = []
  const used = new Set([right])
  for (let guard = 0; guard < 60 && picked.length < 3 && pool.length; guard++) {
    const cand = pool[Math.floor(rnd() * pool.length)].meanings![0].chinese!
    if (used.has(cand)) continue
    used.add(cand)
    picked.push(cand)
  }
  const all = [{ text: right, right: true }, ...picked.map(t => ({ text: t, right: false }))]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all
})

/**
 * 选择题。照它的 select()：
 * 选完**停在原地**并把单词摊开（对错都摊），按空格/回车才进下一个。
 * 我原来是 420ms / 900ms 之后自动跳，等于不给看答案的时间。
 */
function pickChoice(i: number) {
  if (choicePicked.value !== null) return
  choicePicked.value = i
  revealed.value = true
  const ok = choices.value[i]?.right
  if (ok) {
    playCorrect()
    emit('know')
  } else {
    playError()
    emit('wrong')
    if (settings.wordSound) playWord(props.word.word, settings.soundType || 'us', settings.wordSoundSpeed)
  }
}

/** 按住提示键时的临时显示，松开就没 */
const peeking = ref(false)

/**
 * 释义显示。照 TypeWords 的 watchPracticeType 那张表：
 *   跟写 遮词否/释义是   拼写 遮词是/释义是   听写 遮词是/释义否
 *   默写 遮词是/释义是   自测 遮词否/释义否
 * 自测原来写成「释义常显 + 单词遮住」，跟上游正好相反 ——
 * 那样是看中文猜词，不是看着词自评认不认识。
 */
const showMeaning = computed(() => {
  if (props.type === 'identify') return revealed.value || peeking.value
  if (props.type === 'dictation' || props.type === 'listen') return props.type === 'dictation'
  return props.showTranslate ?? settings.showTranslate
})

const revealRest = computed(() => {
  if (peeking.value) return true
  if (props.hideWord && !revealed.value) return false
  if (props.type === 'followWrite' || props.type === 'identify') return true
  return revealed.value
})

function speakSentence(index: number) {
  const text = sentences.value[index]
  if (!text) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = settings.sentenceSoundSpeed
    u.volume = Math.max(0, Math.min(1, settings.sentenceSoundVolume / 100))
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {
  }
}

function isSubmitKey(e: KeyboardEvent): boolean {
  if (e.key === 'Enter') return true
  if (e.code !== 'Space') return false
  return input.value.length >= target.value.length || !target.value.includes(' ')
}


/**
 * 按住看答案（对应 TypeWord.vue 的 showWord / hideWord）。
 *
 * 两处照它改：
 * 1. 按住才显示、松开就藏 —— 我们原来是按一下就永久摊开
 * 2. 跟写模式（且不是默写）下看答案不记错词 —— 那个模式本来就把词摆着，
 *    再记一次错是白扣。它的判断是
 *      if (wordPracticeType !== FollowWrite || dictation) typo()
 */
function showWord() {
  if (!settings.allowWordTip) return
  const isFollowWrite = props.type === 'followWrite' && !props.hideWord
  if (!isFollowWrite && !revealed.value) emit('wrong')
  peeking.value = true
}

function hideWord() {
  peeking.value = false
}

/**
 * 默写模式下还没作答就去听发音 / 看答案，算一次错。
 * 对应它的 checkIsWrong()：不这么记的话，默写模式可以靠反复点喇叭白嫖。
 */
function checkIsWrong() {
  const isDictation = props.type === 'dictation' || props.hideWord
  if (isDictation && !revealed.value && !isRight.value) emit('wrong')
}

function speak() {
  playWord(props.word.word, settings.soundType || 'us', settings.wordSoundSpeed)
}

let audioCtx: AudioContext | null = null

function beep(freq: number, ms: number, gain = 0.06, type: OscillatorType = 'sine') {
  if (!freq || !ms) return
  try {
    audioCtx = audioCtx || new AudioContext()
    const osc = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(Math.max(0, Math.min(1, gain)), audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000)
    osc.connect(g).connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + ms / 1000)
  } catch {
  }
}
const vol = (v: number | undefined) => Math.max(0, Math.min(1, (v ?? 100) / 100))
const playKey = () => {
  if (!settings.keyboardSound) return
  setKeySound(settings.keyboardSoundFile)
  playKeySound(settings.keyboardSoundVolume)
}
const playCorrect = () => settings.effectSound && beep(880, 90, 0.06 * vol(settings.effectSoundVolume))
const playError = () => settings.effectSound && beep(220, 140, 0.08 * vol(settings.effectSoundVolume))

function reset() {
  clearJumpTimer()
  cancelWrongClear()
  input.value = ''
  wrong.value = ''
  revealed.value = false
  inputLock = false
  waitClear = false
  wordCompletedAt = 0
  repeatDone = 0
  sentenceIdx.value = -1
  noteEditing.value = false
  noteDraft.value = ''
  collectOpen.value = false
  masteredTick.value++
  if (settings.wordSound && props.type !== 'dictation') {
    playWord(props.word.word, settings.soundType || 'us', settings.wordSoundSpeed)
      .then(() => {
        if (!settings.autoPlayFirstSentence) return
        if (props.type === 'dictation' || props.type === 'listen') return
        const first = sentences.value[0]
        if (first) playSentence(first, settings.sentenceSoundSpeed, vol(settings.sentenceSoundVolume))
      })
      .catch(() => { /* 发音失败不影响练习 */ })
  }
}

watch(() => props.word.id, reset)
watch(() => props.type, reset)

function norm(x: string): string {
  let v = x
  if (settings.ignoreSymbol) v = v.replace(/[^\p{L}\p{N}\s]/gu, '')
  if (settings.ignoreCase) v = v.toLowerCase()
  return v
}

const isRight = computed(() => {
  if (norm(input.value) === norm(target.value)) return true
  if (input.value.length < target.value.length) return false
  return isSpellingCorrect(input.value, target.value, {
    ignoreCase: settings.ignoreCase,
    ignoreSymbol: settings.ignoreSymbol,
    allowVariant: settings.allowSpellVariant
  })
})

function finish(delay: boolean) {
  if (practiceSentenceOn.value) {
    const next = sentenceIdx.value + 1
    if (next < sentences.value.length) {
      sentenceIdx.value = next
      input.value = ''
      wrong.value = ''
      revealed.value = false
      inputLock = false
      return
    }
    sentenceIdx.value = -1
  }
  // 照 shouldRepeat()：repeatCount == 100 是「用自定义次数」的哨兵值。
  // 我原来自己定成 0，跟它对不上。
  const wantRepeat = settings.repeatCount === 100 ? settings.repeatCustomCount : settings.repeatCount
  if (props.type === 'followWrite' && wantRepeat > repeatDone + 1) {
    clearJumpTimer()
    jumpTimer = setTimeout(() => {
      jumpTimer = null
      repeatDone++
      input.value = ''
      wrong.value = ''
      revealed.value = false
      inputLock = false
      if (settings.wordSound) playWord(props.word.word, settings.soundType || 'us', settings.wordSoundSpeed)
    }, settings.waitTimeForChangeWord)
    return
  }
  clearJumpTimer()
  if (delay) {
    jumpTimer = setTimeout(() => { jumpTimer = null; emit('complete') }, settings.waitTimeForChangeWord)
  } else {
    emit('complete')
  }
}

/** 松开提示键就把答案藏回去（它的 onKeyUp 就是无条件 hideWord） */
function onKeyup() {
  hideWord()
}

function onKeydown(e: KeyboardEvent) {
  // 正在写笔记就把键盘让给输入框，别把笔记内容打进单词里
  if (noteEditing.value) {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
  }
  if (choiceOn.value && /^[1-9]$/.test(e.key)) {
    const i = Number(e.key) - 1
    if (i < choices.value.length) { e.preventDefault(); pickChoice(i); return }
  }
  /**
   * 快捷键匹配必须带修饰键判断。
   *
   * 裸字母做快捷键会把正常输入吃掉：replaySound 曾经是 'KeyR'，于是 easter
   * 的最后一个 r 一按就走了「重播发音」分支 return 掉，永远打不进去。
   * TypeWords 的快捷键全都带 Ctrl/Alt/Shift 或者是 Escape/Tab/` 这类非字母键，
   * 就是为了避开这个。这里照它的规则：没有修饰键的纯字母一律不当快捷键。
   */
  const hitShortcut = (combo: string) => {
    if (!combo) return false
    const parts = combo.split('+')
    const key = parts.pop() as string
    const needCtrl = parts.includes('Ctrl')
    const needAlt = parts.includes('Alt')
    const needShift = parts.includes('Shift')
    if (e.code !== key) return false
    if (needCtrl !== (e.ctrlKey || e.metaKey)) return false
    if (needAlt !== e.altKey) return false
    if (needShift !== e.shiftKey) return false
    // 没有任何修饰键的字母/数字键不认作快捷键，否则会吃掉正常输入
    if (!needCtrl && !needAlt && !needShift && /^(Key[A-Z]|Digit[0-9])$/.test(key)) return false
    return true
  }

  const km = settings.shortcutKeyMap
  if (props.type !== 'identify' && hitShortcut(km.showTip)) {
    e.preventDefault()
    showWord()
    return
  }
  if (hitShortcut(km.replaySound)) { e.preventDefault(); checkIsWrong(); speak(); return }
  /**
   * 跳过。上游的 skip() 是 addExcludeWord() + next(false) ——
   * **不记错**，把这个词排除掉不再安排。我们原来写成 emit('wrong') + emit('complete')，
   * 等于「跳过就算你错一次」，跟上游正好相反。
   */
  if (hitShortcut(km.skipWord)) {
    e.preventDefault()
    emit('skip')
    return
  }
  if (hitShortcut(km.toggleMastered)) { e.preventDefault(); onToggleMastered(); return }
  if (hitShortcut(km.collectWord)) { e.preventDefault(); collectOpen.value = !collectOpen.value; return }
  if (hitShortcut(km.editNote)) { e.preventDefault(); toggleNote(); return }

  // 数字键读例句：只在目标词本身不含这个数字时才抢，否则同样会吃掉输入
  if (props.type !== 'identify' && !e.ctrlKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
    const idx = Number(e.key) - 1
    if (idx < sentences.value.length && !/\d/.test(target.value)) {
      e.preventDefault()
      speakSentence(idx)
      return
    }
  }
  if ((e.ctrlKey || e.metaKey) && ['KeyC', 'KeyA', 'KeyD', 'KeyV'].includes(e.code)) return

  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyP') {
    e.preventDefault()
    speak()
    return
  }

  if (props.type === 'identify') {
    // 选择题选完之后，空格/回车才进下一个（它是 Toast 提示「按空格继续」）
    if (choicePicked.value !== null) {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault()
        choicePicked.value = null
        emit('complete')
      }
      return
    }
    if (choiceOn.value && /^Digit[1-9]$/.test(e.code)) {
      const idx = Number(e.code.slice(5)) - 1
      if (idx < choices.value.length) {
        e.preventDefault()
        pickChoice(idx)
      }
      return
    }
    if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
      e.preventDefault()
      onIdentify(e.code === 'Digit1' ? 'know' : e.code === 'Digit2' ? 'unknown' : 'mastered')
    }
    return
  }

  if (e.key === 'Backspace') {
    e.preventDefault()
    del()
    return
  }

  if (waitClear) return


  if (e.key === 'Enter' && props.type !== 'dictation') {
    e.preventDefault()
    return
  }

  const letter = e.key
  if (letter.length !== 1) return
  e.preventDefault()

  if (props.type === 'dictation') {
    if (isSubmitKey(e)) {
      if (!input.value.length) return
      inputLock = true
      revealed.value = true
      if (isRight.value) {
        playCorrect()
        wordCompletedAt = Date.now()
        finish(settings.autoNextWord)
      } else {
        playError()
        emit('wrong')
        if (settings.wordSound) playWord(props.word.word, settings.soundType || 'us', settings.wordSoundSpeed)
      }
      return
    }
    input.value += letter
    wrong.value = ''
    playKey()
    return
  }

  const step = typeStep(
    { input: input.value, wrong: wrong.value, inputLock, waitClear },
    { key: e.key, code: e.code, shiftKey: e.shiftKey },
    target.value,
    { ignoreCase: settings.ignoreCase, inputWrongClear: settings.inputWrongClear !== false }
  )
  if (step.kind === 'ignored') return

  input.value = step.state.input
  wrong.value = step.state.wrong
  inputLock = step.state.inputLock

  if (step.kind === 'wrong') {
    playError()
    emit('wrong')
    if (settings.wordSound && props.type !== 'dictation') {
      playWord(props.word.word, settings.soundType || 'us', settings.wordSoundSpeed)
    }
    waitClear = true
    cancelWrongClear()
    clearTimer = setTimeout(() => {
      clearTimer = null
      const c = clearAfterWrong(
        { input: input.value, wrong: wrong.value, inputLock, waitClear },
        { ignoreCase: settings.ignoreCase, inputWrongClear: settings.inputWrongClear !== false }
      )
      input.value = c.input
      wrong.value = c.wrong
      inputLock = c.inputLock
      waitClear = false
    }, 500)
    return
  }

  playKey()
  if (step.kind === 'complete') {
    wordCompletedAt = Date.now()
    playCorrect()
    revealed.value = true
    finish(true)
  }

}

function del() {
  inputLock = false
  playKey()
  if (revealed.value) {
    input.value = ''
    revealed.value = false
    if (props.type === 'identify') {
      emit('wrong')
      if (settings.wordSound) playWord(props.word.word, settings.soundType || 'us', settings.wordSoundSpeed)
    }
    return
  }
  if (wrong.value) wrong.value = ''
  else input.value = input.value.slice(0, -1)
}

/**
 * 自测三键。照它的 know / mastered / unknown 三个函数：
 *
 *   know    先把答案摊开让你核对自己是不是真认识，emit('know') 之后**不跳词**，
 *           再按一次才走。我原来是直接 emit('know') + emit('complete')，
 *           等于点完就过，根本没机会看自己想的对不对。
 *   unknown 摊开 + 记错 + 发音，同样停在原地。
 *   mastered 直接走。
 */
function onIdentify(kind: 'know' | 'unknown' | 'mastered') {
  if (kind === 'mastered') {
    emit('mastered')
    return
  }
  if (!revealed.value) {
    revealed.value = true
    if (kind === 'know') {
      emit('know')
    } else {
      emit('wrong')
      if (settings.wordSound) playWord(props.word.word, settings.soundType || 'us', settings.wordSoundSpeed)
    }
    return
  }
  emit('complete')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  nextTick(reset)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  clearJumpTimer()
  cancelWrongClear()
})
</script>

<style scoped lang="scss">
/* 照它的 .typing-word：width:100% + flex:1，撑满练习区那一栏，
   不再自己写死宽度把内容夹在中间一条里 */
.typing-card {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 0 20px;
  text-align: center;
  word-break: break-word;
}
.meaning {
  font-size: 1.2rem;
  color: var(--r-ink, #1f2328);
  margin: 0;
  max-width: 100%;
  line-height: 1.7;
  transition: opacity .2s ease;
  text-align: left;
}
.pos-row { display: flex; align-items: flex-start; }
/* 照 TranslationList.vue：词性用强调色、定宽 min-w-12（3rem），
   释义在右边成块换行，不跟着词性缩进走。 */
.pos {
  flex-shrink: 0; min-width: 2.5rem;   /* @apply min-w-10 */
  color: var(--r-accent, #5b7a99);
}
.pos-text { flex: 1; min-width: 0; }
.word-line {
  font-family: 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', system-ui, sans-serif;
  font-weight: 300;
  font-size: 64px;
  letter-spacing: 0.02em;
  line-height: 1.3;
  word-break: break-all;
  max-width: 90vw;
}
.input-right { color: rgb(22, 163, 74); }
.input-wrong { color: rgba(255, 0, 0, 0.6); }
.word-end { color: var(--r-ink2, #999); }
.word-end.hide { letter-spacing: 0.14em; opacity: 0.45; }
.word-line.is-wrong { animation: shake 0.16s ease 2; }
.word-line.is-sentence { white-space: normal; word-break: break-word; line-height: 1.6; letter-spacing: 0; }
.sentence-tip { margin: 0 0 6px; font-size: 12px; opacity: 0.65; }
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(4px); }
}
.meta-line.top {
  min-height: 22px;
  color: var(--r-ink2, #9aa0a6);
  font-size: 15px;
  letter-spacing: 0.02em;
}
.icon-row {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--r-ink2, #b6bcc3);
  min-height: 26px;
}
.speak-btn {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 3px;
  display: inline-flex;
}
.identify-row { display: flex; gap: 10px; margin-top: 6px; }
.choice-btn kbd { opacity: 0.5; margin-right: 6px; }
.choice-btn.right { border-color: #3a8a5c; background: color-mix(in srgb, #3a8a5c 14%, transparent); }
.choice-btn.wrong { border-color: #b5493c; background: color-mix(in srgb, #b5493c 14%, transparent); }
.idt-btn {
  padding: 8px 18px;
  border-radius: 18px;
  border: 1px solid var(--r-border, #ddd);
  background: var(--r-ui, #f6f6f6);
  color: var(--r-ink, #333);
  cursor: pointer;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &:hover { background: var(--r-paper, #fff); }
}
/* 「已掌握」比另外两个更肯定，给个明确的绿色，不然三个按钮长得一样分不清 */
.idt-btn.mastered {
  border-color: color-mix(in srgb, #3a8a5c 45%, transparent);
  color: #3a8a5c;
  &:hover { background: color-mix(in srgb, #3a8a5c 8%, transparent); }
}

.idt-btn kbd {
  font-size: 11px;
  opacity: 0.5;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
}
.hint { font-size: 12.5px; color: var(--r-ink2, #aaa); margin: 0; }
.sent-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 10px; }
.sent-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--r-border, #ddd); background: transparent; color: var(--r-ink2, #888);
  border-radius: 9999px; padding: 3px 10px; font-size: 12px; cursor: pointer;
}
.sent-btn:hover { color: var(--r-accent, #8a4b3a); border-color: var(--r-accent, #8a4b3a); }
/* 原来是 left: nav+56px; top: 22px —— 正好贴在退出按钮（nav+14，宽 30）右边，
   而它开头还有一个「←」，看上去就是两个返回号。改成挪到退出按钮正下方，
   箭头换成「上一个」三个字，不再和返回撞。 */
.prev-corner {
  position: fixed; left: calc(var(--lb-nav-w, 56px) + 14px); top: 52px;
  display: flex; align-items: center; gap: 6px;
  color: var(--r-ink2, #c3c8ce); font-size: 14px; pointer-events: none;
}
.pc-label { font-size: 12px; opacity: .75; }

/* 笔记/收藏展开后的两个小面板（.icon-row 上面已经有了，不再重复定义） */
.speak-btn.on { color: var(--r-accent, #8a4b3a); }
.collect-box {
  display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
  max-width: 520px;
}
.cb-item {
  border: 1px solid var(--r-line, #e5e7eb); background: transparent;
  color: var(--r-ink, #1f2328); font-family: inherit; font-size: 13px;
  padding: 5px 12px; border-radius: 999px; cursor: pointer;
}
.cb-item:hover { background: var(--r-ui, #f4f5f7); }
.cb-item.in { opacity: .55; }
.cb-in { margin-left: 6px; font-size: 11px; color: var(--r-ink2, #9aa0a6); }
.cb-empty { font-size: 13px; color: var(--r-ink2, #9aa0a6); }
.note-box { width: 100%; max-width: 520px; }
.nb-input {
  width: 100%; padding: 8px 10px; font-family: inherit; font-size: 13.5px;
  border: 1px solid var(--r-line, #e5e7eb); border-radius: 10px;
  background: transparent; color: var(--r-ink, #1f2328); resize: vertical;
}
.nb-acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
.nb-btn {
  border: none; background: var(--r-ui, #f4f5f7); color: var(--r-ink, #1f2328);
  font-family: inherit; font-size: 13px; padding: 5px 12px; border-radius: 8px; cursor: pointer;
}
.nb-btn.primary { background: var(--r-ink, #1f2328); color: #fff; }
/* 例句/短语里的可点词 */
.tk { cursor: pointer; border-radius: 3px; }
.tk:hover { background: var(--r-ui, #eef1f4); }
.tk.hit {
  color: var(--r-accent, #8a4b3a);
  font-weight: 600;
  background: rgba(138, 75, 58, .09);
}
.s-speak {
  border: none; background: transparent; cursor: pointer; padding: 0 4px;
  color: var(--r-ink2, #b6bcc3); vertical-align: middle;
}
.s-speak:hover { color: var(--r-accent, #8a4b3a); }
.note-view {
  max-width: 520px; font-size: 13px; line-height: 1.6;
  color: var(--r-ink2, #6b7280); white-space: pre-wrap;
}
/* 遮词的模式下音标也得遮：默写时露着音标等于把答案给出去了 */
.ph-hide { filter: blur(6px); user-select: none; }
.pc-word { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 释义以下各块，数值取自 TypeWord.vue：
     .label { width: 6rem; padding-top: 0.2rem; flex-shrink: 0 }
     .pos   { min-width: 2.5rem }        (@apply min-w-10)
     .en    { font-size: 1.125rem }      (@apply text-lg)
     .cn    { font-size: 1rem }          (@apply text-base)
     .sentence { 圆角 + px-3 py-2 -mx-3 }
   块与块之间是 <div class="line-white my-3"> 一条细线。 */
.detail-block { width: 100%; text-align: left; }
.line-white {
  height: 1px; background: var(--r-border, #eceff2);
  margin: 0.75rem 0;                /* my-3 */
}
.sentence {
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;          /* py-2 px-3 */
  margin: 0 -0.75rem;               /* -mx-3 */
  /* 整句不再可点了：点词是查释义，朗读挪到右边那个小喇叭。
     留着 cursor: pointer 会让人以为点哪儿都能读。 */
  transition: all .3s;
  &:hover { background: color-mix(in srgb, var(--r-accent, #5b7a99) 8%, transparent); }
}
.s-en { font-size: 1.25rem; line-height: 1.6; color: var(--r-ink, #1f2328); }
.s-cn { font-size: 1rem; line-height: 1.6; color: var(--r-ink2, #8a9099); }
.blk { display: flex; }
.label {
  width: 6rem; padding-top: 0.2rem; flex-shrink: 0;
  color: var(--r-ink2, #9aa0a6); font-size: 1rem;
}
.blk-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.blk-body.pre { white-space: pre-wrap; font-size: 1rem; color: var(--r-ink2, #8a9099); }
/* 短语行：英文 + 小喇叭 + 中文。gap 从 1rem 收到 0.6rem，
   因为中间多插了一个喇叭按钮，原来的间距会把中文推得太远 */
.phrase { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.phrase .en { font-size: 1.125rem; color: var(--r-ink, #1f2328); }
.phrase .cn { font-size: 1rem; color: var(--r-ink2, #8a9099); }
.syno-body { flex-direction: row; flex-wrap: wrap; gap: 0.25rem 1rem; }
.syno { font-size: 1.125rem; color: var(--r-accent, #5b7a99); cursor: help; }
</style>
