<template>
  <div class="fnp">
    <div class="fnp-head">
      <div v-if="options.length > 1" class="seg fnp-kinds">
        <button v-for="o in options" :key="o.kind + o.label" :class="{ on: kind === o.kind }" @click="kind = o.kind">{{ o.label }}</button>
      </div>
      <span v-else class="fnp-title">{{ note?.title || title }}</span>
      <div class="fnp-tools">
        <div class="seg">
          <button :class="{ on: layout === 'list' }" title="清单" @click="layout = 'list'"><i class="ri-file-list-3-line"></i></button>
          <button :class="{ on: layout === 'radial' }" title="导图" @click="layout = 'radial'"><i class="ri-mind-map"></i></button>
        </div>
        <button class="ui-icon-btn" :class="{ on: showLow }" title="待确认" @click="showLow = !showLow"><i class="ri-question-line"></i></button>
        <button class="ui-icon-btn" title="全屏" @click="full = true"><i class="ri-fullscreen-line"></i></button>
      </div>
    </div>

    <div v-if="busy" class="fnp-busy"><span class="ui-spin"></span></div>
    <EmptyState v-else-if="!note" />
    <div v-else class="fnp-canvas" :class="{ map: layout === 'radial' }">
      <div ref="sheetEl" class="fnp-export">
        <NoteSheet
          v-if="layout === 'list'"
          :note="note"
          :show-low="showLow"
          :editable="!readonly"
          @pick="onPick"
          @remove="removeWord"
        />
        <NoteMindmap v-else :note="note" :show-low="showLow" expandable @pick="onPick" @expand="full = true" />
      </div>
    </div>

    <UiDialog :open="full && !!note" :title="note?.title" width="94vw" @close="full = false">
      <div class="fnp-full">
        <NoteMindmap v-if="note && layout === 'radial'" :note="note" :show-low="showLow" @pick="onPick" />
        <NoteSheet v-else-if="note" :note="note" :show-low="showLow" @pick="onPick" />
      </div>
    </UiDialog>

    <div v-if="note" class="fnp-foot">
      <span class="fnp-stat" :title="`候选 ${note.stats.candidates}`">{{ note.stats.kept }} 词<template v-if="note.stats.lowConfidence"> · 待确认 {{ note.stats.lowConfidence }}</template></span>
      <button v-if="!readonly" class="ghost-btn small" :disabled="reviewing" @click="review">
        <span v-if="reviewing" class="ui-spin"></span>{{ reviewing ? '' : '校对' }}
      </button>
      <button class="ghost-btn small" @click="exportMd">文本</button>
      <button class="ghost-btn small" :disabled="exporting" @click="exportPng">图片</button>
      <button v-if="!readonly" class="ghost-btn small primary" :disabled="saved" @click="save">{{ saved ? '已保存' : '保存' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WordItem } from '@/shared/types/WordItem'
import type { FamilyNote, NoteKind, LexIndex } from '@/shared/core/wordFamily'
import { getIndex, noteOptionsFor, buildNote, buildTopicNote, saveFamilyNote, aiReviewNote } from '@/shared/core/familyNoteService'
import { buildRootNote } from '@/shared/core/wordFamily'
import { exportNodeAsPng, downloadBlob } from '@/shared/core/exportImage'
import { toast } from '@/shared/core/toast'
import NoteSheet from './NoteSheet.vue'
import NoteMindmap from './NoteMindmap.vue'

/**
 * 三种入口：
 *   word    —— 单词详情里：词根 / 同义 / 拆解 / 话题 四选一
 *   members —— 话题树里某一组：话题笔记
 *   preset  —— 学习记录里打开已保存的笔记（只读）
 */
const props = defineProps<{
  words: WordItem[]
  word?: WordItem | null
  members?: string[]
  /** 星系的扩散层数：2 层时关系笔记把相关词的相关词也列出来 */
  depth?: number
  /** 以这个词根为中心生成笔记（词汇宇宙的词根维度用） */
  rootQuery?: string
  title?: string
  preset?: FamilyNote | null
  presetLayout?: 'list' | 'radial'
  groups?: { label: string; words: string[] }[]
}>()
const emit = defineEmits<{ (e: 'pick', w: string): void }>()
const full = ref(false)
function onPick(w: string) {
  full.value = false
  emit('pick', w)
}

const LAYOUT_KEY = 'lb-family-note-layout'
const layout = ref<'list' | 'radial'>(props.presetLayout || (localStorage.getItem(LAYOUT_KEY) as any) || 'list')
watch(layout, v => localStorage.setItem(LAYOUT_KEY, v))

const idx = ref<LexIndex | null>(null)
const kind = ref<NoteKind>('root')
const note = ref<FamilyNote | null>(null)
const busy = ref(false)
const showLow = ref(false)
const saved = ref(false)
const reviewing = ref(false)
const exporting = ref(false)
const sheetEl = ref<HTMLElement | null>(null)
const readonly = computed(() => !!props.preset)

const options = computed(() => (idx.value && props.word && !props.preset ? noteOptionsFor(idx.value, props.word.word) : []))

async function rebuild() {
  saved.value = false
  if (props.preset) { note.value = props.preset; return }
  busy.value = true
  try {
    idx.value = await getIndex(props.words)
    if (props.rootQuery) {
      note.value = buildRootNote(idx.value, props.rootQuery)
      if (!note.value) toast(`词库里没有跟「${props.rootQuery}」同根的词`, 'error')
    } else if (props.members?.length) {
      note.value = buildTopicNote(idx.value, props.title || '话题', props.members, props.groups ? { groups: props.groups } : {})
    } else if (props.word) {
      const opts = noteOptionsFor(idx.value, props.word.word)
      if (!opts.some(o => o.kind === kind.value)) kind.value = opts[0]?.kind || 'synonym'
      note.value = buildNote(idx.value, kind.value, props.word.word, props.depth || 1)
    } else note.value = null
  } catch (e) {
    note.value = null
    toast('生成失败：' + (e instanceof Error ? e.message : String(e)), 'error')
  } finally {
    busy.value = false
  }
}

watch(() => [props.word?.id, props.members?.join(','), props.rootQuery, props.preset], rebuild, { immediate: true })
watch([kind, () => props.depth], () => { if (props.word && idx.value) { note.value = buildNote(idx.value, kind.value, props.word.word, props.depth || 1); saved.value = false } })

function removeWord(w: string) {
  if (!note.value) return
  for (const b of note.value.branches) b.words = b.words.filter(x => x.word !== w)
  note.value.branches = note.value.branches.filter(b => b.words.length)
  saved.value = false
}

async function review() {
  if (!note.value || !idx.value) return
  reviewing.value = true
  try {
    const r = await aiReviewNote(note.value, idx.value)
    note.value = r.note
    saved.value = false
    toast(`校对完成：移除 ${r.removed.length} · 补充 ${r.added.length}`, 'ok')
  } catch (e) {
    toast('校对失败：' + (e instanceof Error ? e.message : String(e)), 'error')
  } finally {
    reviewing.value = false
  }
}

async function save() {
  if (!note.value) return
  try {
    await saveFamilyNote(note.value, layout.value)
    saved.value = true
    toast('已保存到学习记录', 'ok')
  } catch (e) {
    toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

async function exportPng() {
  if (!sheetEl.value || !note.value) return
  exporting.value = true
  try {
    // 导图导出完整画面，不受当前缩放和平移影响
    const root = (sheetEl.value.querySelector('[data-export-root]') as HTMLElement) || sheetEl.value
    await exportNodeAsPng(root, `词汇笔记-${note.value.title}`)
  } catch (e) {
    toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'error')
  } finally {
    exporting.value = false
  }
}

function exportMd() {
  const n = note.value
  if (!n) return
  const lines = [`# ${n.hub.label}${n.hub.sub ? ' ' + n.hub.sub : ''}`, '']
  for (const b of n.branches) {
    if (n.branches.length > 1) lines.push(`## ${b.label}`)
    for (const w of b.words) {
      if (!showLow.value && w.confidence < 0.7 && !w.added) continue
      lines.push(`- **${w.word}** ${w.pos ? w.pos + '. ' : ''}${w.zh || ''}${w.added ? '（补）' : ''}`)
      if (w.formula) lines.push(`  - ${w.formula}`)
      for (const d of w.derivs) lines.push(`  - ↳ ${d.word} ${d.zh || ''}`)
      for (const p of w.phrases) lines.push(`  - ${p.en} ${p.zh || ''}`)
      if (w.links.length) lines.push(`  - ${w.links.map(l => `${l.kind === 'syn' ? '≈' : l.kind === 'ant' ? '↔' : '∽'} ${l.word}`).join('，')}`)
    }
    lines.push('')
  }
  const print = (t: any, d: number) => { lines.push(`${'  '.repeat(d)}- ${t.label} ${t.zh || ''}`); t.children.forEach((c: any) => print(c, d + 1)) }
  if (n.tree) print(n.tree, 0)
  for (const s of n.side) lines.push(`> ${s.label}：${s.items.map(i => i.word).join('，')}`)
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown' }), `词汇笔记-${n.title}.md`)
}
</script>

<style scoped>
.fnp { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.fnp-head {
  display: flex; align-items: center; gap: var(--space-xs); flex-wrap: wrap;
  padding: var(--space-xs) var(--space-sm); border-bottom: 1px solid var(--c-line-soft);
}
.fnp-kinds { flex: 1; min-width: 0; overflow-x: auto; }
.fnp-kinds > button { white-space: nowrap; }
.fnp-title { flex: 1; font-weight: 600; }
.fnp-tools { display: flex; align-items: center; gap: var(--space-2xs); margin-left: auto; }
.fnp-tools .seg > button { padding: 4px 8px; }
.fnp-busy { display: flex; justify-content: center; padding: var(--space-lg); }
.fnp-canvas { flex: 1; min-height: 0; overflow: auto; }
.fnp-export { display: inline-block; min-width: 100%; background: var(--c-surface); }
.fnp-canvas.map { overflow: hidden; }
.fnp-canvas.map .fnp-export { display: block; height: 100%; }
.fnp-full { height: 78vh; overflow: auto; }
.fnp-foot {
  display: flex; align-items: center; gap: var(--space-2xs);
  padding: var(--space-xs) var(--space-sm); border-top: 1px solid var(--c-line-soft);
}
.fnp-stat { flex: 1; color: var(--c-text-3); font-size: var(--text-xs); }
</style>
