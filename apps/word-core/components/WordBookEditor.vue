<template>
  <div class="wbe-overlay" @click.self="$emit('close')">
    <div class="wbe-box">
      <div class="wbe-head">
        <div class="wbe-name-field">
          <label class="wbe-label">词书名称</label>
          <input
            v-model="nameDraft"
            class="wbe-name-input"
            @blur="saveName"
            @keyup.enter="saveName"
          />
        </div>
        <button class="ghost-btn small danger" @click="doDeleteBook">删除词书</button>
        <button class="ghost-btn small" @click="$emit('close')">关闭</button>
      </div>

      <div class="wbe-chapters">
        <button class="chip" :class="{ on: activeChapterId === null }" @click="activeChapterId = null">
          全部<span class="chip-count">{{ book?.wordIds.length || 0 }}</span>
        </button>
        <button
          v-for="c in chapters"
          :key="c.id"
          class="chip"
          :class="{ on: activeChapterId === c.id }"
          @click="activeChapterId = c.id"
        >
          {{ c.name }}<span class="chip-count">{{ c.wordIds.length }}</span>
          <span class="chip-del" @click.stop="doDeleteChapter(c)">×</span>
        </button>
        <button v-if="!showNewChapterInput" class="ghost-btn small" @click="showNewChapterInput = true">+ 新增章节</button>
        <template v-else>
          <input v-model="newChapterName" class="wbe-chapter-input" placeholder="章节名称" @keyup.enter="confirmAddChapter" />
          <button class="ghost-btn small" @click="confirmAddChapter">确定</button>
          <button class="ghost-btn small" @click="showNewChapterInput = false; newChapterName = ''">取消</button>
        </template>
      </div>

      <div class="wbe-toolbar">
        <button class="ghost-btn small danger" :disabled="!selectedIds.size" @click="batchRemove">
          批量移出（{{ selectedIds.size }}）
        </button>
        <span class="wbe-hint">移出只是把词从这本词书/章节里拿掉，词本身还在词库里，不会被删掉</span>
        <button class="dark-btn" @click="addNewWord">+ 新增单词</button>
      </div>

      <div class="wbe-table-wrap">
        <table class="wbe-table">
          <thead>
            <tr>
              <th class="wbe-col-check"><input type="checkbox" :checked="allSelected" @change="toggleSelectAll" /></th>
              <th>词汇</th>
              <th>单词含义</th>
              <th>音标</th>
              <th>词性</th>
              <th>常见搭配</th>
              <th>搭配含义</th>
              <th>例句</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in wordsInView" :key="w.id" :class="{ editing: editingWordId === w.id }">
              <td><input type="checkbox" :checked="selectedIds.has(w.id)" @change="toggleSelect(w.id)" /></td>
              <template v-if="editingWordId === w.id">
                <td><input v-model="editDraft.word" class="wbe-cell-input" /></td>
                <td><input v-model="editDraft.chinese" class="wbe-cell-input" /></td>
                <td><input v-model="editDraft.phonetic" class="wbe-cell-input" /></td>
                <td><input v-model="editDraft.pos" class="wbe-cell-input" /></td>
                <td><input v-model="editDraft.collocations" class="wbe-cell-input" placeholder="用、分隔多个" /></td>
                <td><input v-model="editDraft.collocationMeanings" class="wbe-cell-input" placeholder="用、分隔，跟左边一一对应" /></td>
                <td><input v-model="editDraft.example" class="wbe-cell-input" /></td>
                <td class="wbe-actions">
                  <button class="wbe-save-btn" @click="saveEditWord(w.id)">保存</button>
                  <button class="wbe-cancel-btn" @click="cancelEditWord">取消</button>
                </td>
              </template>
              <template v-else>
                <td class="wbe-word-cell">{{ w.word }}</td>
                <td>{{ w.meanings[0]?.chinese || '—' }}</td>
                <td>{{ w.phonetic || '—' }}</td>
                <td>{{ w.meanings[0]?.partOfSpeech || '—' }}</td>
                <td>{{ (w.common_phrases || []).map(p => p.phrase_en).join('、') || '—' }}</td>
                <td>{{ (w.common_phrases || []).map(p => p.phrase_zh).join('、') || '—' }}</td>
                <td class="wbe-example-cell">{{ w.meanings[0]?.examples?.[0] || w.example_sentences?.[0]?.en || '—' }}</td>
                <td class="wbe-actions">
                  <button class="wbe-edit-btn" @click="startEditWord(w)">编辑</button>
                </td>
              </template>
            </tr>
            <tr v-if="!wordsInView.length">
              <td colspan="9" class="wbe-empty">这本词书/章节里还没有单词，点右上角"+新增单词"加一个</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="wbe-footer">
        <button class="dark-btn" @click="$emit('close')">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useWordStore } from '@/shared/stores/wordStore'
import type { WordItem } from '@/shared/types/WordItem'

const props = defineProps<{ groupId: string }>()
const emit = defineEmits<{ close: [] }>()

const wordStore = useWordStore()

const book = computed(() => wordStore.groups.find(g => g.id === props.groupId))
const nameDraft = ref(book.value?.name || '')
watch(() => book.value?.name, n => { if (n !== undefined) nameDraft.value = n })

async function saveName() {
  if (!book.value) return
  const name = nameDraft.value.trim()
  if (!name || name === book.value.name) return
  await wordStore.updateGroup(props.groupId, { name })
}

async function doDeleteBook() {
  if (!book.value) return
  if (!confirm(`删除词书「${book.value.name}」？\n只删这本词书（和它下面的章节），里面的单词还留在词库里，不会被删掉。`)) return
  for (const c of chapters.value) await wordStore.deleteGroup(c.id)
  await wordStore.deleteGroup(props.groupId)
  emit('close')
}

const chapters = computed(() => wordStore.groups.filter(g => g.parentId === props.groupId))
const activeChapterId = ref<string | null>(null)
const showNewChapterInput = ref(false)
const newChapterName = ref('')

async function confirmAddChapter() {
  const name = newChapterName.value.trim()
  if (!name) return
  const now = new Date().toISOString()
  await wordStore.createGroup({
    id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    description: '',
    parentId: props.groupId,
    wordIds: [],
    createdAt: now,
    updatedAt: now
  })
  newChapterName.value = ''
  showNewChapterInput.value = false
}

async function doDeleteChapter(c: { id: string; name: string }) {
  if (!confirm(`删除章节「${c.name}」？\n只删这个章节分类，单词还留在这本词书的"全部"里，不会被删掉。`)) return
  if (activeChapterId.value === c.id) activeChapterId.value = null
  await wordStore.deleteGroup(c.id)
}

const wordsInView = computed<WordItem[]>(() => {
  const ids = activeChapterId.value
    ? chapters.value.find(c => c.id === activeChapterId.value)?.wordIds || []
    : book.value?.wordIds || []
  return ids.map(id => wordStore.words.find(w => w.id === id)).filter((w): w is WordItem => !!w)
})

const selectedIds = ref<Set<string>>(new Set())
const allSelected = computed(() => wordsInView.value.length > 0 && wordsInView.value.every(w => selectedIds.value.has(w.id)))

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
}
function toggleSelectAll() {
  if (allSelected.value) selectedIds.value.clear()
  else selectedIds.value = new Set(wordsInView.value.map(w => w.id))
}

async function batchRemove() {
  const targetGroupId = activeChapterId.value || props.groupId
  for (const id of selectedIds.value) {
    await wordStore.removeWordFromGroup(id, targetGroupId)
    if (!activeChapterId.value) {
      for (const c of chapters.value) await wordStore.removeWordFromGroup(id, c.id)
    }
  }
  selectedIds.value = new Set()
}

async function addNewWord() {
  const now = new Date().toISOString()
  const w: WordItem = {
    id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    word: '',
    phonetic: '',
    meanings: [{ chinese: '', partOfSpeech: '' }],
    level: 'IELTS',
    createdAt: now,
    updatedAt: now
  }
  await wordStore.addWord(w)
  const targetGroupId = activeChapterId.value || props.groupId
  await wordStore.addWordToGroup(w.id, targetGroupId)
  if (activeChapterId.value) await wordStore.addWordToGroup(w.id, props.groupId)
  startEditWord(w)
}

const editingWordId = ref<string | null>(null)
const editDraft = ref({ word: '', chinese: '', phonetic: '', pos: '', collocations: '', collocationMeanings: '', example: '' })

function startEditWord(w: WordItem) {
  editingWordId.value = w.id
  editDraft.value = {
    word: w.word,
    chinese: w.meanings[0]?.chinese || '',
    phonetic: w.phonetic || '',
    pos: w.meanings[0]?.partOfSpeech || '',
    collocations: (w.common_phrases || []).map(p => p.phrase_en).join('、'),
    collocationMeanings: (w.common_phrases || []).map(p => p.phrase_zh).join('、'),
    example: w.meanings[0]?.examples?.[0] || w.example_sentences?.[0]?.en || ''
  }
}

function cancelEditWord() {
  editingWordId.value = null
}

async function saveEditWord(wordId: string) {
  const d = editDraft.value
  const phrasesEn = d.collocations.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
  const phrasesZh = d.collocationMeanings.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
  const common_phrases = phrasesEn.map((en, i) => ({ phrase_en: en, phrase_zh: phrasesZh[i] || '' }))
  const existing = wordStore.words.find(w => w.id === wordId)
  await wordStore.updateWordFields(wordId, {
    word: d.word.trim(),
    phonetic: d.phonetic.trim(),
    meanings: [{
      chinese: d.chinese.trim(),
      partOfSpeech: d.pos.trim(),
      examples: d.example.trim() ? [d.example.trim()] : (existing?.meanings[0]?.examples || [])
    }],
    common_phrases
  })
  editingWordId.value = null
}
</script>

<style scoped lang="scss">
.wbe-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 400;
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.wbe-box {
  background: #fff; border-radius: 14px; width: min(1100px, 96vw); max-height: 90vh;
  display: flex; flex-direction: column; box-shadow: 0 12px 48px rgba(0, 0, 0, 0.3); overflow: hidden;
}
.wbe-head { display: flex; align-items: flex-end; gap: 12px; padding: 20px 22px 14px; border-bottom: 1px solid #eee; flex-wrap: wrap; }
.wbe-name-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
.wbe-label { font-size: 12px; color: #888; }
.wbe-name-input {
  border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 8px 12px; font-size: 15px; font-weight: 600; outline: none;
  &:focus { border-color: #999; }
}
.wbe-chapters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 14px 22px; border-bottom: 1px solid #f0f0f0; }
.wbe-chapter-input { border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 6px 10px; font-size: 13px; outline: none; width: 140px; }
.chip {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: 1px solid #e4e4e4; background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-radius: 20px; padding: 6px 14px; font-size: 13px; color: #555; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  &.on { background: var(--r-accent, #8a4b3a); color: #fff; border-color: transparent; }
}
.chip-count { font-size: 11px; opacity: 0.6; }
.chip-del { margin-left: 2px; opacity: 0.5; &:hover { opacity: 1; } }
.wbe-toolbar { display: flex; align-items: center; gap: 12px; padding: 12px 22px; flex-wrap: wrap; }
.wbe-hint { font-size: 12px; color: #999; flex: 1; min-width: 160px; }
.wbe-table-wrap { flex: 1; overflow: auto; padding: 0 22px; }
.wbe-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.wbe-table th {
  text-align: left; padding: 10px 8px; color: #888; font-weight: 500; font-size: 12.5px;
  border-bottom: 1px solid #eee; position: sticky; top: 0; background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
}
.wbe-table td { padding: 10px 8px; border-bottom: 1px dashed #f2f2f2; vertical-align: top; color: #333; }
.wbe-col-check { width: 32px; }
.wbe-word-cell { font-weight: 600; color: #1a1a1a; }
.wbe-example-cell { max-width: 260px; }
.wbe-cell-input {
  width: 100%; border: 1px solid var(--r-border, #ddd); border-radius: 6px; padding: 5px 8px; font-size: 12.5px; outline: none; box-sizing: border-box;
  &:focus { border-color: #999; }
}
.wbe-actions { display: flex; gap: 6px; white-space: nowrap; }
.wbe-edit-btn, .wbe-save-btn, .wbe-cancel-btn {
  border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer;
}
.wbe-edit-btn { background: var(--r-accent, #8a4b3a); color: #fff; &:hover { background: #333; } }
.wbe-save-btn { background: #4a7d3a; color: #fff; &:hover { background: #3d6830; } }
.wbe-cancel-btn { background: #f0f0f0; color: #555; &:hover { background: #e4e4e4; } }
.wbe-empty { text-align: center; color: #999; padding: 30px 0; }
tr.editing { background: #fafaf5; }
.wbe-footer { display: flex; justify-content: flex-end; padding: 14px 22px; border-top: 1px solid #eee; }

.ghost-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent);
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  color: var(--r-ink, #3a3128); cursor: pointer; padding: 6px 12px; border-radius: 7px; font-size: 12.5px;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
  &.small { padding: 5px 10px; font-size: 12px; }
  &.danger { color: #b05a4a; border-color: #ecd4cf; &:hover { background: #f9ece9; } }
  &:disabled { opacity: 0.4; cursor: not-allowed; &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); } }
}
.dark-btn {
  box-shadow: 0 1px 2px color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease; border: none; background: var(--r-accent, #8a4b3a); color: #fff; cursor: pointer; padding: 8px 20px; border-radius: 7px; font-size: 13px; &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); } }
</style>
