<template>
  <div class="modal-overlay" :class="{ inline }" @click.self="!inline && emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <div class="word-info">
          <h2>{{ word.word }}</h2>
          <span class="phonetic">{{ word.phonetic || '' }}</span>
          <span v-if="word.level" class="level-badge">{{ word.level }}</span>
          <span v-if="word.source && word.source !== '英语词汇可视化学习系统'" class="source-badge">{{ word.source }}</span>
        </div>
        <div class="header-actions">
          <button class="edit-toggle-btn" @click="editing ? cancelEdit() : startEdit()">{{ editing ? '取消' : '编辑' }}</button>
          <button class="close-btn" @click="emit('close')">×</button>
        </div>
      </div>

      <div class="tab-nav">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab-btn', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="modal-body" :key="activeTab">
        <div v-if="activeTab === 'basic'" class="tab-content">
          <div v-if="editing" class="detail-block edit-block">
            <h4 class="block-title">编辑</h4>
            <label class="edit-label">音标</label>
            <input v-model="editDraft.phonetic" class="edit-input" placeholder="/例如 ɪɡˈzæmpl/" />
            <label class="edit-label">词性及释义</label>
            <div class="edit-meaning-row" v-for="(m, i) in editDraft.meanings" :key="i">
              <input v-model="m.partOfSpeech" class="edit-input pos-input" placeholder="词性，如 n." />
              <input v-model="m.chinese" class="edit-input" placeholder="中文释义" />
              <button class="edit-del-row" @click="editDraft.meanings.splice(i, 1)">×</button>
            </div>
            <button class="ghost-btn small" @click="editDraft.meanings.push({ chinese: '', partOfSpeech: '' })">+ 加一条释义</button>
            <div class="edit-actions">
              <button class="dark-btn" @click="saveEdit">保存</button>
            </div>
          </div>

          <div v-if="!editing && word.phonetic" class="detail-block">
            <h4 class="block-title">发音</h4>
            <div class="pronunciation-row">
              <span class="pronunciation-text">{{ word.phonetic }}</span>
              <button
                :class="['speak-btn', { speaking: isSpeaking }]"
                @click="playAudio"
                title="播放发音"
              >
                {{ isSpeaking ? '||' : '>>' }}
              </button>
            </div>
          </div>

          <div v-if="!editing && word.meanings?.length" class="detail-block">
            <h4 class="block-title">词性及释义</h4>
            <div class="definitions-list">
              <div v-for="(meaning, idx) in word.meanings" :key="idx" class="definition-item">
                <span class="pos-tag">{{ meaning.partOfSpeech }}</span>
                <div class="definition-content">
                  <p class="definition-zh">{{ meaning.chinese }}</p>
                  <p v-if="meaning.english" class="definition-en">{{ meaning.english }}</p>
                </div>
              </div>
            </div>
          </div>

          <div v-if="hasMorphology" class="detail-block">
            <h4 class="block-title">形态变化</h4>
            <div class="morphology-grid">
              <div v-if="word.morphology?.plural" class="morph-item">
                <span class="morph-label">复数</span>
                <span class="morph-value">{{ word.morphology.plural }}</span>
              </div>
              <div v-if="word.morphology?.past_tense" class="morph-item">
                <span class="morph-label">过去式</span>
                <span class="morph-value">{{ word.morphology.past_tense }}</span>
              </div>
              <div v-if="word.morphology?.past_participle" class="morph-item">
                <span class="morph-label">过去分词</span>
                <span class="morph-value">{{ word.morphology.past_participle }}</span>
              </div>
              <div v-if="word.morphology?.present_participle" class="morph-item">
                <span class="morph-label">现在分词</span>
                <span class="morph-value">{{ word.morphology.present_participle }}</span>
              </div>
              <div v-if="word.morphology?.third_person" class="morph-item">
                <span class="morph-label">第三人称单数</span>
                <span class="morph-value">{{ word.morphology.third_person }}</span>
              </div>
              <div v-if="word.morphology?.comparative" class="morph-item">
                <span class="morph-label">比较级</span>
                <span class="morph-value">{{ word.morphology.comparative }}</span>
              </div>
              <div v-if="word.morphology?.superlative" class="morph-item">
                <span class="morph-label">最高级</span>
                <span class="morph-value">{{ word.morphology.superlative }}</span>
              </div>
            </div>
          </div>

          <div v-if="hasMorphemes" class="detail-block">
            <h4 class="block-title">词根词缀</h4>
            <div class="morpheme-row">
              <template v-for="(part, key) in morphemeParts" :key="key">
                <span v-if="part" class="morpheme-part" :class="key">
                  <span class="mp-form">{{ part.form }}</span>
                  <span v-if="part.meaning" class="mp-meaning">{{ part.meaning }}</span>
                  <span class="mp-kind">{{ key === 'prefix' ? '前缀' : key === 'root' ? '词根' : '后缀' }}</span>
                </span>
              </template>
            </div>
          </div>

          <div v-if="word.etymology" class="detail-block">
            <h4 class="block-title">词源学</h4>
            <p class="block-text">{{ word.etymology }}</p>
          </div>

          <div v-if="word.memory_tips" class="detail-block highlight">
            <h4 class="block-title">记忆方法</h4>
            <p class="block-text">{{ word.memory_tips }}</p>
          </div>
        </div>

        <div v-if="activeTab === 'usage'" class="tab-content">
          <div v-if="word.detailed_explanation" class="detail-block">
            <h4 class="block-title">详细解释</h4>
            <p class="block-text">{{ word.detailed_explanation }}</p>
          </div>

          <div v-if="word.common_phrases?.length" class="detail-block">
            <h4 class="block-title">常用短语</h4>
            <div class="phrases-list">
              <div v-for="(phrase, idx) in word.common_phrases" :key="idx" class="phrase-item">
                <div class="phrase-main">
                  <span class="phrase-en">{{ phrase.phrase_en }}</span>
                  <button class="speak-btn-sm" @click="speakText(phrase.phrase_en)">&gt;&gt;</button>
                </div>
                <span class="phrase-zh">{{ phrase.phrase_zh }}</span>
                <div v-if="phrase.example_en" class="phrase-example">
                  <p class="example-en">{{ phrase.example_en }}</p>
                  <p v-if="phrase.example_zh" class="example-zh">{{ phrase.example_zh }}</p>
                </div>
              </div>
            </div>
          </div>

          <div v-if="hasExamples" class="detail-block">
            <h4 class="block-title">例句</h4>
            <div class="examples-list">
              <template v-for="(meaning, mIdx) in word.meanings" :key="'m'+mIdx">
                <div v-for="(ex, idx) in (meaning.examples || [])" :key="'e'+idx" class="example-item">
                  <span class="example-num">{{ mIdx * 10 + idx + 1 }}</span>
                  <div class="example-content">
                    <p class="example-en">
                      {{ ex }}
                      <button class="speak-btn-sm" @click="speakText(ex)">&gt;&gt;</button>
                    </p>
                  </div>
                </div>
              </template>
              <div v-for="(sent, idx) in (word.example_sentences || [])" :key="'s'+idx" class="example-item">
                <span class="example-num">{{ idx + 1 }}</span>
                <div class="example-content">
                  <p class="example-en">
                    {{ sent.en }}
                    <button class="speak-btn-sm" @click="speakText(sent.en)">&gt;&gt;</button>
                  </p>
                  <p class="example-zh">{{ sent.zh }}</p>
                  <p v-if="sent.note" class="example-note">{{ sent.note }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'relations'" class="tab-content">
          <div v-if="word.word_family?.length" class="detail-block">
            <h4 class="block-title">同根词</h4>
            <div class="related-words">
              <span
                v-for="(w, idx) in word.word_family"
                :key="idx"
                class="related-word family"
              >
                <span @click="searchWord(w)">{{ w }}</span>
                <button class="mini-speak" @click.stop="speakText(w)" title="发音">
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
                </button>
              </span>
            </div>
          </div>

          <div v-if="hasSynonyms" class="detail-block">
            <h4 class="block-title">近义词</h4>
            <div class="synonyms-list">
              <div v-for="(syn, idx) in allSynonyms" :key="idx" class="synonym-item">
                <div class="synonym-header">
                  <span class="synonym-word" @click="searchWord(syn.word || syn)">{{ typeof syn === 'string' ? syn : syn.word }}</span>
                  <button class="speak-btn-sm" @click="speakText(typeof syn === 'string' ? syn : syn.word)" title="发音">
                    <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
                  </button>
                </div>
                <p v-if="typeof syn !== 'string' && syn.difference" class="synonym-difference">
                  <span class="diff-label">区别：</span>
                  {{ syn.difference }}
                </p>
              </div>
            </div>
          </div>

          <div v-if="word.antonyms?.length" class="detail-block">
            <h4 class="block-title">反义词</h4>
            <div class="related-words">
              <span
                v-for="(ant, idx) in word.antonyms"
                :key="idx"
                class="related-word antonym"
              >
                <span @click="searchWord(ant.word)">{{ ant.word }}</span>
                <button class="mini-speak" @click.stop="speakText(ant.word)" title="发音">
                  <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
                </button>
                <span v-if="ant.note" class="word-note">({{ ant.note }})</span>
              </span>
            </div>
          </div>

          <div v-if="word.meanings?.some(m => m.synonyms?.length)" class="detail-block">
            <h4 class="block-title">释义中的近义词</h4>
            <div class="related-words">
              <template v-for="(meaning, idx) in word.meanings" :key="idx">
                <span v-for="syn in meaning.synonyms" :key="syn" class="related-word synonym">
                  <span @click="searchWord(syn)">{{ syn }}</span>
                  <button class="mini-speak" @click.stop="speakText(syn)" title="发音">
                    <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
                  </button>
                </span>
              </template>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'learning'" class="tab-content">
          <div class="learning-stats">
            <div class="stat-card">
              <span class="stat-label">熟悉度</span>
              <div class="stat-bar">
                <div class="stat-fill" :style="{ width: word.learningRecord?.familiarity + '%' }"></div>
              </div>
              <span class="stat-value">{{ word.learningRecord?.familiarity || 0 }}%</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">复习次数</span>
              <span class="stat-value large">{{ word.learningRecord?.reviewCount || 0 }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">上次复习</span>
              <span class="stat-value">{{ formatDate(word.learningRecord?.lastReview) }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">下次复习</span>
              <span class="stat-value">{{ formatDate(nextReviewDate) }}</span>
            </div>
          </div>

          <div v-if="word.tags?.length" class="detail-block">
            <h4 class="block-title">标签</h4>
            <div class="tag-list">
              <span v-for="tag in word.tags" :key="tag" class="tag-chip">{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn secondary" @click="emit('close')">关闭</button>
        <button v-if="familySize > 1" class="btn secondary" @click="emit('filter-family', props.word.word)">
          筛出词族（{{ familySize }}）
        </button>
        <button class="btn" @click="playAudio">
          {{ isSpeaking ? '停止' : '发音' }}
        </button>
        <button class="btn primary" @click="markAsMemorized">
          {{ isMemorized ? '已掌握' : '标记为已掌握' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { WordItem } from '@/shared/types/WordItem'
import { playWord, playSentence, stopAll } from '@/shared/core/audio'
import { useWordStore } from '@/shared/stores/wordStore'
import { nextReviewOf } from '@/shared/core/fsrs'

const wordStore = useWordStore()

const props = defineProps<{
  word: WordItem
  inline?: boolean
}>()

const emit = defineEmits<{
  close: []
  memorize: [id: string]
  search: [word: string]
  'filter-family': [word: string]
}>()

const tabs = [
  { id: 'basic', label: '基础信息' },
  { id: 'usage', label: '用法示例' },
  { id: 'relations', label: '词汇关系' },
  { id: 'learning', label: '学习记录' },
]
const activeTab = ref('basic')

const editing = ref(false)
const editDraft = ref<{ phonetic: string; meanings: { chinese: string; partOfSpeech: string; english?: string }[] }>({
  phonetic: '',
  meanings: []
})
function startEdit() {
  editDraft.value = {
    phonetic: props.word.phonetic || '',
    meanings: (props.word.meanings?.length ? props.word.meanings : [{ chinese: '', partOfSpeech: '' }]).map(m => ({ ...m }))
  }
  editing.value = true
}
function cancelEdit() {
  editing.value = false
}
async function saveEdit() {
  const meanings = editDraft.value.meanings.filter(m => m.chinese.trim() || m.partOfSpeech.trim())
  await wordStore.updateWordFields(props.word.id, {
    phonetic: editDraft.value.phonetic.trim(),
    meanings: meanings.length ? meanings : [{ chinese: '', partOfSpeech: '' }]
  })
  editing.value = false
}

const isSpeaking = ref(false)
/**
 * 下次复习：读 FSRS 的卡片，没有卡片才回退到词条上那份。
 * 之前直接读 word.learningRecord.nextReview，那是听写那套固定间隔表写的，
 * 跟今日复习实际挑词用的 FSRS 排期不是一回事。
 */
const nextReviewDate = computed(() => nextReviewOf(props.word))

const isMemorized = computed(() => (props.word.learningRecord?.familiarity || 0) >= 80)

const hasMorphology = computed(() => {
  const m = props.word.morphology
  return m && Object.values(m).some(v => v)
})

const hasExamples = computed(() => {
  return (
    props.word.meanings?.some(m => m.examples?.length) ||
    (props.word.example_sentences?.length ?? 0) > 0
  )
})

const allSynonyms = computed(() => {
  const syns: any[] = []
  if (props.word.synonyms) {
    syns.push(...props.word.synonyms)
  }
  props.word.meanings?.forEach(m => {
    if (m.synonyms) {
      syns.push(...m.synonyms)
    }
  })
  return syns
})

const hasSynonyms = computed(() => allSynonyms.value.length > 0)

function playAudio() {
  if (isSpeaking.value) {
    stopAudio()
    return
  }
  isSpeaking.value = true
  playWord(props.word.word).finally(() => { isSpeaking.value = false })
}

function speakText(text: string) {
  if (/^[a-zA-Z'-]+$/.test(text.trim())) {
    playWord(text.trim())
  } else {
    playSentence(text)
  }
}

function stopAudio() {
  stopAll()
  isSpeaking.value = false
}

function markAsMemorized() {
  emit('memorize', props.word.id)
}

const morphemeParts = computed(() => ({
  prefix: props.word.morphemes?.prefix,
  root: props.word.morphemes?.root,
  suffix: props.word.morphemes?.suffix
}))
const hasMorphemes = computed(() =>
  !!(morphemeParts.value.prefix || morphemeParts.value.root || morphemeParts.value.suffix)
)

const familySize = computed(() => {
  const set = new Set<string>([props.word.word.toLowerCase()])
  for (const w of props.word.word_family || []) set.add(String(w).toLowerCase())
  for (const w of props.word.synonyms || []) set.add(String(w.word || w).toLowerCase())
  for (const w of props.word.antonyms || []) set.add(String(w.word).toLowerCase())
  return set.size
})

function searchWord(word: string) {
  emit('search', word)
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '暂无'
  const date = new Date(dateStr)
  return isNaN(date.getTime()) ? dateStr : date.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  max-width: 640px;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-overlay.inline {
  position: static;
  background-color: transparent;
  padding: 0;
  display: block;
  height: 100%;
  z-index: auto;
}
.modal-overlay.inline .modal-content {
  background-color: var(--r-paper, #fff);
  max-width: none;
  max-height: none;
  height: 100%;
  border-radius: 0;
  box-shadow: none;
}
.modal-overlay.inline .modal-body { min-height: 0; }

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 20px 24px;
  border-bottom: 1px solid #eee;
}

.word-info {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}

.word-info h2 {
  font-size: 26px;
  font-weight: 700;
  color: #1a1a1a;
  margin: 0;
}

.phonetic {
  color: #888;
  font-size: 14px;
}

.level-badge {
  background-color: #fff3e0;
  color: #e65100;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.source-badge {
  background-color: #e3f2fd;
  color: #1565c0;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.header-actions { display: flex; align-items: center; gap: 4px; }
.edit-toggle-btn {
  background: none; border: 1px solid var(--r-border, #ddd); color: #555; cursor: pointer; padding: 5px 12px; border-radius: 6px; font-size: 12.5px;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
}
.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: #999;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.edit-block { background: #fafafa; border-radius: 10px; padding: 14px 16px; }
.edit-label { display: block; font-size: 12px; color: #666; margin: 10px 0 5px; &:first-of-type { margin-top: 0; } }
.edit-input {
  width: 100%; border: 1px solid var(--r-border, #ddd); border-radius: 7px; padding: 8px 10px; font-size: 13.5px; outline: none; margin-bottom: 6px;
  &:focus { border-color: #999; }
}
.edit-meaning-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.edit-meaning-row .edit-input { margin-bottom: 0; }
.pos-input { max-width: 80px; flex-shrink: 0; }
.edit-del-row { border: none; background: none; color: #ccc; cursor: pointer; font-size: 16px; flex-shrink: 0; &:hover { color: #b05a4a; } }
.edit-actions { margin-top: 14px; display: flex; justify-content: flex-end; }
.ghost-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  color: var(--r-ink, #3a3128); cursor: pointer; padding: 6px 12px; border-radius: 7px; font-size: 12.5px;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
  &.small { padding: 5px 10px; font-size: 12px; }
}
.dark-btn {
  box-shadow: 0 1px 2px color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease; border: none; background: var(--r-accent, #8a4b3a); color: #fff; cursor: pointer; padding: 8px 20px; border-radius: 7px; font-size: 13px; &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); } }

.close-btn:hover {
  color: #333;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff));
}

.tab-nav {
  display: flex;
  gap: 4px;
  padding: 0 24px;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff));
  border-bottom: 1px solid #eee;
}

.tab-btn {
  padding: 10px 16px;
  border: none;
  background: none;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: #333;
}

.tab-btn.active {
  color: #3a86ff;
  border-bottom-color: #3a86ff;
  font-weight: 500;
}

.modal-body {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-block {
  background: #fafafa;
  border-radius: 8px;
  padding: 16px;
}

.detail-block.highlight {
  background: #fff8e1;
  border-left: 3px solid #ffc107;
}

.block-title {
  font-size: 13px;
  font-weight: 600;
  color: #666;
  margin: 0 0 12px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.pronunciation-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pronunciation-text {
  font-size: 16px;
  color: #333;
  font-style: italic;
}

.speak-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--r-border, #ddd);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  cursor: pointer;
  font-size: 12px;
  color: #333;
  transition: all 0.2s;
}

.speak-btn:hover {
  background: #f0f0f0;
}

.speak-btn.speaking {
  background: #3a86ff;
  color: white;
  border-color: #3a86ff;
}

.speak-btn-sm {
  padding: 3px 6px;
  border: 1px solid var(--r-border, #ddd);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: #666;
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.speak-btn-sm:hover {
  background: #f0f0f0;
}

.definitions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.definition-item {
  display: flex;
  gap: 12px;
}

.pos-tag {
  flex-shrink: 0;
  background: #e3f2fd;
  color: #1565c0;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.definition-content {
  flex: 1;
}

.definition-zh {
  font-size: 15px;
  color: #333;
  margin: 0 0 4px 0;
  line-height: 1.5;
}

.definition-en {
  font-size: 13px;
  color: #666;
  font-style: italic;
  margin: 0;
}

.morphology-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.morph-item {
  background: white;
  padding: 10px 12px;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.morph-label {
  font-size: 11px;
  color: #888;
}

.morph-value {
  font-size: 14px;
  color: #333;
  font-weight: 500;
}

.block-text {
  font-size: 14px;
  color: #444;
  line-height: 1.6;
  margin: 0;
}

.phrases-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.phrase-item {
  padding-bottom: 12px;
  border-bottom: 1px dashed #eee;
}

.phrase-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.phrase-main {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.phrase-en {
  font-size: 15px;
  color: #333;
  font-weight: 500;
}

.phrase-zh {
  font-size: 13px;
  color: #666;
  margin-left: 4px;
}

.phrase-example {
  margin-top: 8px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 6px;
  font-size: 13px;
}

.example-en {
  color: #333;
}

.example-zh {
  color: #666;
  margin-top: 4px;
}

.examples-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.example-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: white;
  border-radius: 8px;
}

.example-num {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  background: #3a86ff;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.example-content {
  flex: 1;
}

.example-en {
  font-size: 14px;
  color: #333;
  line-height: 1.5;
  margin: 0;
}

.example-zh {
  font-size: 13px;
  color: #666;
  margin: 4px 0 0 0;
}

.example-note {
  font-size: 12px;
  color: #888;
  margin: 4px 0 0 0;
  font-style: italic;
}

.related-words {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.related-word {
  padding: 6px 10px 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.mini-speak {
  border: none;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 50%;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: inherit;
  flex-shrink: 0;
  padding: 0;
}
.mini-speak:hover {
  background: rgba(0, 0, 0, 0.18);
}

.related-word.family {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #a5d6a7;
}

.related-word.family:hover {
  background: #c8e6c9;
}

.related-word.synonym {
  background: #e3f2fd;
  color: #1565c0;
  border: 1px solid #90caf9;
}

.related-word.synonym:hover {
  background: #bbdefb;
}

.related-word.antonym {
  background: #fce4ec;
  color: #c62828;
  border: 1px solid #f48fb1;
}

.related-word.antonym:hover {
  background: #f8bbd0;
}

.word-note {
  font-size: 11px;
  opacity: 0.8;
  margin-left: 4px;
}

.synonyms-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.synonym-item {
  padding: 10px 14px;
  background: white;
  border-radius: 8px;
}

.synonym-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.synonym-word {
  font-size: 15px;
  color: #1565c0;
  font-weight: 500;
  cursor: pointer;
}

.synonym-word:hover {
  text-decoration: underline;
}

.synonym-difference {
  margin: 6px 0 0 0;
  font-size: 13px;
  color: #666;
}

.diff-label {
  color: #888;
}

.learning-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  background: #fafafa;
  padding: 14px;
  border-radius: 8px;
  text-align: center;
}

.stat-label {
  font-size: 12px;
  color: #888;
  display: block;
  margin-bottom: 6px;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.stat-value.large {
  font-size: 24px;
}

.stat-bar {
  height: 6px;
  background: #e0e0e0;
  border-radius: 3px;
  margin-bottom: 6px;
  overflow: hidden;
}

.stat-fill {
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #8bc34a);
  border-radius: 3px;
  transition: width 0.3s;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-chip {
  padding: 4px 12px;
  background: #f0f0f0;
  border-radius: 12px;
  font-size: 12px;
  color: #666;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid #eee;
  background-color: #fafafa;
}

.btn {
  padding: 8px 16px;
  border: 1px solid var(--r-border, #ddd);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:hover {
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff));
}

.btn.primary {
  background-color: #3a86ff;
  color: white;
  border-color: #3a86ff;
}

.btn.primary:hover {
  background-color: #2a6fd6;
}

.btn.secondary {
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff));
  color: #666;
}

@media (max-width: 480px) {
  .modal-content {
    margin: 0;
    max-height: 100vh;
    border-radius: 0;
  }

  .tab-nav {
    overflow-x: auto;
    padding: 0 16px;
  }

  .tab-btn {
    padding: 10px 12px;
    font-size: 12px;
    white-space: nowrap;
  }

  .learning-stats {
    grid-template-columns: 1fr;
  }
}

.morpheme-row { display: flex; gap: 10px; flex-wrap: wrap; }
.morpheme-part {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 9px;
  background: var(--r-ui, #f4f4f4);
  min-width: 76px;
}
.mp-form { font-size: 15px; font-weight: 600; font-family: ui-monospace, Menlo, Consolas, monospace; }
.mp-meaning { font-size: 12.5px; color: var(--r-ink2, #777); }
.mp-kind { font-size: 11px; color: var(--r-ink2, #aaa); }
.morpheme-part.root .mp-form { color: var(--r-accent, #8a4b3a); }
</style>
