<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <h3 class="title">学习设置</h3>

      <p class="summary">
        共 <b>{{ total }}</b> 个单词，预计 <b>{{ days }}</b> 天完成
        <span v-if="dateText !== '-'" class="date">（约 {{ dateText }}）</span>
      </p>

      <div class="line">
        <span>从第</span>
        <input v-model.number="startIndex" type="number" class="num-input" :min="0" :max="total" />
        <span>个开始，每日</span>
        <input v-model.number="perDay" type="number" class="num-input narrow" :min="1" :max="500" />
        <span>个新词，最多复习</span>
        <b class="review-num">{{ perDay * reviewRatio || '-' }}</b>
        <span>个</span>
      </div>

      <div class="row">
        <label class="row-label" title="每日复习量 = 每日新词量 × 这个倍数">复习比</label>
        <input v-model.number="reviewRatio" type="number" class="num-input narrow" :min="0" :max="10" />
        <span v-if="!reviewRatio" class="warn">设为 0 表示只学新词、不安排复习；学完整本后仍会按 1 倍复习</span>
      </div>

      <div class="row">
        <label class="row-label">每日学习</label>
        <input v-model.number="perDay" type="range" class="slider" min="1" max="500" step="1" />
        <span class="slider-val">{{ perDay }}</span>
      </div>

      <div class="row">
        <label class="row-label">学习进度</label>
        <input v-model.number="startIndex" type="range" class="slider" min="0" :max="total" step="1" />
        <span class="slider-val">{{ startIndex }} / {{ total }}</span>
      </div>

      <hr class="sep" />

      <div class="row switch-row">
        <label><input v-model="autoNext" type="checkbox" /> 打完自动跳下一个</label>
        <label><input v-model="inputWrongClear" type="checkbox" /> 打错时清空整个输入</label>
      </div>
      <div class="row switch-row">
        <label><input v-model="ignoreCase" type="checkbox" /> 忽略大小写</label>
        <label><input v-model="allowSpellVariant" type="checkbox" /> 英美拼法互认（colour = color）</label>
        <label><input v-model="ignoreSymbol" type="checkbox" /> 忽略标点（连字符、撇号打错不算错）</label>
        <label><input v-model="practiceSentence" type="checkbox" /> 打完单词接着跟打例句</label>
        <label><input v-model="showEtymologyAndRelWords" type="checkbox" /> 练习时显示词源和相关词</label>
        <label><input v-model="autoPlayFirstSentence" type="checkbox" /> 进入新词时自动播第一个例句</label>
        <label>
          认识/不认识怎么判定
          <select v-model="identifyMethod">
            <option value="self">自己判断</option>
            <option value="choice">四选一选择题</option>
          </select>
        </label>
        <label>
          自定义重复次数
          <input v-model.number="repeatCustomCount" type="number" min="1" max="10" />
        </label>
        <label><input v-model="autoMarkStatus" type="checkbox" /> 练完自动标注认识/模糊/不认识</label>
        <label>
          每学 <input v-model.number="scenarioEvery" type="number" min="0" max="200" class="tiny" /> 个新词插一次场景学习（0 = 不插）
        </label>
        <label v-if="autoMarkStatus">
          错 ≤ <input v-model.number="statusKnownLimit" type="number" min="0" max="9" class="tiny" /> 次算认识，
          ≤ <input v-model.number="statusFuzzyLimit" type="number" min="0" max="9" class="tiny" /> 次算模糊
        </label>
        <label>
          发音口音
          <select v-model="soundType">
            <option value="us">美音</option>
            <option value="uk">英音</option>
          </select>
        </label>
        <label>
          发音人
          <select v-model="ttsVoice">
            <option value="">跟随系统</option>
            <option v-for="v in ttsVoices" :key="v.name" :value="v.name">{{ v.name }}</option>
          </select>
        </label>
        <label>
          键盘音量 {{ keyboardSoundVolume }}
          <input v-model.number="keyboardSoundVolume" type="range" min="0" max="100" />
        </label>
        <label>
          提示音音量 {{ effectSoundVolume }}
          <input v-model.number="effectSoundVolume" type="range" min="0" max="100" />
        </label>
        <label><input v-model="showTranslate" type="checkbox" /> 显示中文释义</label>
      </div>
      <div class="row switch-row">
        <label :title="SIMPLE_WORDS.slice(0, 12).join(' / ') + ' … 共 ' + SIMPLE_WORDS.length + ' 个'">
          <input v-model="ignoreSimpleWord" type="checkbox" /> 跳过高频虚词（a / the / is / to 等 {{ SIMPLE_WORDS.length }} 个）
        </label>
      </div>
      <div class="row switch-row">
        <label><input v-model="wordSound" type="checkbox" /> 自动发音</label>
        <label><input v-model="keyboardSound" type="checkbox" /> 键盘音</label>
        <label v-if="keyboardSound" class="inline-sel">
          音色
          <select v-model="keyboardSoundFile">
            <option value="mechanical">机械（脆）</option>
            <option value="membrane">薄膜（闷）</option>
            <option value="typewriter">打字机（低）</option>
          </select>
        </label>
        <label><input v-model="effectSound" type="checkbox" /> 提示音</label>
      </div>

      <div class="row">
        <label class="row-label" title="只对 TTS 兜底发音生效；有道真人发音改速率会变调，保持原速">听写语速</label>
        <input v-model.number="soundSpeed" type="range" class="slider" min="0.5" max="1.5" step="0.05" />
        <span class="slider-val">{{ soundSpeed.toFixed(2) }}×</span>
      </div>

      <div class="row switch-row">
        <label><input v-model="allowWordTip" type="checkbox" /> 允许看提示（默写时按提示键亮出答案，算一次错）</label>
        <label><input v-model="showNearWord" type="checkbox" /> 显示上/下一个词</label>
      </div>

      <div class="row">
        <label class="row-label">单词字号</label>
        <input v-model.number="fsWordForeign" type="range" class="slider" min="24" max="80" step="2" />
        <span class="slider-val">{{ fsWordForeign }}px</span>
      </div>
      <div class="row">
        <label class="row-label">释义字号</label>
        <input v-model.number="fsWordTranslate" type="range" class="slider" min="12" max="32" step="1" />
        <span class="slider-val">{{ fsWordTranslate }}px</span>
      </div>
      <div class="row">
        <label class="row-label">文章正文</label>
        <input v-model.number="fsArticleForeign" type="range" class="slider" min="12" max="34" step="1" />
        <span class="slider-val">{{ fsArticleForeign }}px</span>
      </div>
      <div class="row">
        <label class="row-label">文章译文</label>
        <input v-model.number="fsArticleTranslate" type="range" class="slider" min="10" max="28" step="1" />
        <span class="slider-val">{{ fsArticleTranslate }}px</span>
      </div>

      <div class="row">
        <label class="row-label">例句语速</label>
        <input v-model.number="sentSpeed" type="range" class="slider" min="0.5" max="1.6" step="0.05" />
        <span class="slider-val">{{ sentSpeed.toFixed(2) }}×</span>
      </div>

      <div class="row">
        <label class="row-label">快捷键</label>
        <div class="key-row">
          <button
            v-for="k in shortcutRows"
            :key="k.field"
            class="key-btn"
            :class="{ listening: listeningFor === k.field }"
            @click="listeningFor = listeningFor === k.field ? '' : k.field"
          >{{ k.label }}：{{ listeningFor === k.field ? '按一个键…' : keyLabel(shortcuts[k.field]) }}</button>
        </div>
      </div>

      <div class="row">
        <label class="row-label">练习模式</label>
        <select v-model="practiceMode" class="mode-select">
          <option value="system">完整流程（新词跟写→听写→默写，旧词自测→听写→默写）</option>
          <option value="free">自由练习（只跟写）</option>
          <option value="identifyOnly">只自测</option>
          <option value="listenOnly">只听写</option>
          <option value="dictationOnly">只默写</option>
          <option value="review">只复习旧词</option>
        </select>
      </div>

      <div class="actions">
        <button class="ghost-btn" @click="emit('close')">取消</button>
        <button class="dark-btn" @click="save">确认</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { WordGroup } from '@/shared/types/WordItem'
import {
  getStudySettings, saveStudySettings, getAccomplishDays, getAccomplishDate,
  type PracticeMode
} from '@/shared/core/studySettings'
import { SIMPLE_WORDS } from '@/shared/core/masteredWords'
import { listTtsVoices } from '@/shared/core/audio'

const props = defineProps<{
  group: WordGroup | null
  total: number
  perDayStudyNumber?: number
  lastLearnIndex?: number
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', payload: { lastLearnIndex: number; perDayStudyNumber: number }): void
}>()

const s = getStudySettings()

const perDay = ref(props.group?.perDayStudyNumber ?? props.perDayStudyNumber ?? 20)
const startIndex = ref(props.group?.lastLearnIndex ?? props.lastLearnIndex ?? 0)
const reviewRatio = ref(s.wordReviewRatio)
const autoNext = ref(s.autoNextWord)
const inputWrongClear = ref(s.inputWrongClear)
const ignoreCase = ref(s.ignoreCase)
const allowSpellVariant = ref(s.allowSpellVariant ?? true)
const ignoreSymbol = ref(s.ignoreSymbol)
const practiceSentence = ref(s.practiceSentence)
const showEtymologyAndRelWords = ref(s.showEtymologyAndRelWords)
const autoPlayFirstSentence = ref(s.autoPlayFirstSentence)
const identifyMethod = ref(s.identifyMethod)
const repeatCustomCount = ref(s.repeatCustomCount)
const autoMarkStatus = ref(s.autoMarkStatus)
const scenarioEvery = ref(s.scenarioEvery ?? 30)
const statusKnownLimit = ref(s.statusKnownLimit)
const statusFuzzyLimit = ref(s.statusFuzzyLimit)
const ttsVoice = ref(s.ttsVoice)
const soundType = ref(s.soundType || 'us')
const keyboardSoundFile = ref(s.keyboardSoundFile || 'mechanical')
const keyboardSoundVolume = ref(s.keyboardSoundVolume)
const effectSoundVolume = ref(s.effectSoundVolume)
const ttsVoices = ref<SpeechSynthesisVoice[]>(listTtsVoices(v => { ttsVoices.value = v }))
const showTranslate = ref(s.showTranslate)
const wordSound = ref(s.wordSound)
const keyboardSound = ref(s.keyboardSound)
const effectSound = ref(s.effectSound)
const soundSpeed = ref(s.wordSoundSpeed)
const practiceMode = ref<PracticeMode>(s.practiceMode)
const ignoreSimpleWord = ref(s.ignoreSimpleWord)

const total = computed(() => props.total)
const days = computed(() => getAccomplishDays(Math.max(0, total.value - startIndex.value), perDay.value))
const dateText = computed(() => getAccomplishDate(Math.max(0, total.value - startIndex.value), perDay.value))

watch(perDay, v => { if (!v || v < 1) perDay.value = 1; else if (v > 500) perDay.value = 500 })
watch(startIndex, v => {
  if (v < 0 || Number.isNaN(v)) startIndex.value = 0
  else if (v > total.value) startIndex.value = total.value
})
watch(reviewRatio, v => { if (v < 0 || Number.isNaN(v)) reviewRatio.value = 0; else if (v > 10) reviewRatio.value = 10 })

const allowWordTip = ref(s.allowWordTip)
const showNearWord = ref(s.showNearWord)
const fsWordForeign = ref(s.fontSize.wordForeign)
const fsWordTranslate = ref(s.fontSize.wordTranslate)
const fsArticleForeign = ref(s.fontSize.articleForeign)
const fsArticleTranslate = ref(s.fontSize.articleTranslate)
const sentSpeed = ref(s.sentenceSoundSpeed)
const wordVol = ref(s.wordSoundVolume ?? 100)
const artSpeed = ref(s.articleSoundSpeed)
const artAutoNext = ref(s.articleAutoPlayNext)

const shortcuts = ref({ ...s.shortcutKeyMap })
const shortcutRows = [
  { field: 'showTip' as const, label: '看提示' },
  { field: 'replaySound' as const, label: '重听发音' },
  { field: 'skipWord' as const, label: '跳过' }
]
const listeningFor = ref('')

function keyLabel(code: string): string {
  if (!code) return '未设置'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

function onCaptureKey(e: KeyboardEvent) {
  if (!listeningFor.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.code === 'Enter' || e.code === 'Space') { listeningFor.value = ''; return }
  ;(shortcuts.value as any)[listeningFor.value] = e.code
  listeningFor.value = ''
}
onMounted(() => window.addEventListener('keydown', onCaptureKey, true))
onUnmounted(() => window.removeEventListener('keydown', onCaptureKey, true))

function save() {
  saveStudySettings({
    wordReviewRatio: reviewRatio.value,
    autoNextWord: autoNext.value,
    inputWrongClear: inputWrongClear.value,
    ignoreCase: ignoreCase.value,
    allowSpellVariant: allowSpellVariant.value,
    ignoreSymbol: ignoreSymbol.value,
    practiceSentence: practiceSentence.value,
    showEtymologyAndRelWords: showEtymologyAndRelWords.value,
    autoPlayFirstSentence: autoPlayFirstSentence.value,
    identifyMethod: identifyMethod.value,
    repeatCustomCount: repeatCustomCount.value,
    autoMarkStatus: autoMarkStatus.value,
    scenarioEvery: scenarioEvery.value,
    statusKnownLimit: statusKnownLimit.value,
    statusFuzzyLimit: statusFuzzyLimit.value,
    ttsVoice: ttsVoice.value,
    soundType: soundType.value,
    keyboardSoundFile: keyboardSoundFile.value,
    keyboardSoundVolume: keyboardSoundVolume.value,
    effectSoundVolume: effectSoundVolume.value,
    showTranslate: showTranslate.value,
    wordSound: wordSound.value,
    keyboardSound: keyboardSound.value,
    effectSound: effectSound.value,
    wordSoundSpeed: soundSpeed.value,
    ignoreSimpleWord: ignoreSimpleWord.value,
    practiceMode: practiceMode.value,
    allowWordTip: allowWordTip.value,
    showNearWord: showNearWord.value,
    sentenceSoundSpeed: sentSpeed.value,
    wordSoundVolume: wordVol.value,
    articleSoundSpeed: artSpeed.value,
    articleAutoPlayNext: artAutoNext.value,
    fontSize: {
      wordForeign: fsWordForeign.value,
      wordTranslate: fsWordTranslate.value,
      articleForeign: fsArticleForeign.value,
      articleTranslate: fsArticleTranslate.value
    },
    shortcutKeyMap: { ...shortcuts.value }
  })
  emit('save', { lastLearnIndex: startIndex.value, perDayStudyNumber: perDay.value })
}
</script>

<style scoped lang="scss">
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 20px;
}
.dialog {
  background: var(--r-paper, #fff);
  color: var(--r-ink, #1c1c1c);
  border-radius: 14px;
  padding: 22px 26px 18px;
  width: min(600px, 100%);
  max-height: 88vh;
  overflow: auto;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
}
.title { margin: 0 0 16px; font-size: 17px; }
.summary { text-align: center; font-size: 14.5px; margin: 0 0 16px; }
.summary b { font-size: 19px; color: var(--r-accent, #8a4b3a); margin: 0 4px; }
.summary .date { color: var(--r-ink2, #999); font-size: 13px; }
.line {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 14px;
  margin-bottom: 18px;
}
.num-input {
  width: 74px;
  padding: 5px 8px;
  border: 1px solid var(--r-border, #ddd);
  border-radius: 7px;
  background: var(--r-ui, #fafafa);
  color: inherit;
  text-align: center;
  font-size: 15px;
  &.narrow { width: 58px; }
}
.review-num { color: var(--r-accent, #8a4b3a); font-size: 17px; }
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 13.5px;
  flex-wrap: wrap;
}
.row-label { width: 68px; flex-shrink: 0; color: var(--r-ink2, #666); }
.slider { flex: 1; min-width: 140px; }
.slider-val { min-width: 76px; text-align: right; color: var(--r-ink2, #888); }
.warn { font-size: 12px; color: #d9822b; }
.switch-row { gap: 18px; label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; } }
.mode-select {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--r-border, #ddd);
  border-radius: 7px;
  background: var(--r-ui, #fafafa);
  color: inherit;
  font-size: 13px;
}
.sep { border: none; border-top: 1px solid var(--r-border, #eee); margin: 16px 0; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.key-row { display: flex; flex-wrap: wrap; gap: 6px; }
.key-btn {
  border: 1px solid var(--r-border, #ddd); background: transparent; color: inherit;
  border-radius: 8px; padding: 4px 10px; font-size: 12.5px; cursor: pointer;
}
.key-btn.listening { border-color: var(--r-accent, #8a4b3a); color: var(--r-accent, #8a4b3a); }
.tiny { width: 46px; }
</style>
