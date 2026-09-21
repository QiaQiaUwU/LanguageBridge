<template>
  <aside class="exam-panel" @paste="onPaste">
    <!-- 作文：题干、配图、自己写 -->
    <section v-if="exam.type === 'writing'" class="ex-group">
      <h4 class="ex-head">{{ exam.title }}</h4>
      <div v-for="(l, i) in exam.prompt || []" :key="i" class="ex-instr">
        <slot name="t" :text="l">{{ l }}</slot>
        <p v-if="zhOf(l)" class="ex-zh">{{ zhOf(l) }}</p>
      </div>
    </section>

    <div v-if="exam.images?.length || exam.type === 'writing'" class="ex-images">
      <figure v-for="(src, i) in exam.images || []" :key="i" class="ex-fig">
        <img :src="src" alt="" @click="zoom = src" />
        <CloseButton small class="ex-img-del" title="删除图片" @click="removeImage(i)" />
      </figure>
      <label class="ex-img-add" title="添加图片">
        ＋
        <input type="file" accept="image/*" multiple hidden @change="onPickImages" />
      </label>
    </div>

    <section v-for="g in exam.groups" :key="g.title" class="ex-group">
      <h4 v-if="g.section" class="ex-section">{{ g.section }}</h4>
      <h4 class="ex-head">{{ g.title }}</h4>
      <div v-for="(l, i) in g.instructions" :key="i" class="ex-instr">
        <slot name="t" :text="l">{{ l }}</slot>
        <p v-if="zhOf(l)" class="ex-zh">{{ zhOf(l) }}</p>
      </div>

      <dl v-if="g.judge?.length" class="ex-judge">
        <template v-for="j in g.judge" :key="j.key">
          <dt>{{ j.key }}</dt>
          <dd>{{ j.desc }}</dd>
        </template>
      </dl>

      <!-- 选项表：标题列表、人物列表、选词框 -->
      <ul v-if="g.choices?.length && !multiPick(g)" class="ex-choices">
        <li v-for="c in g.choices" :key="c.key">
          <b>{{ c.key }}</b>
          <span><slot name="t" :text="c.text">{{ c.text }}</slot><em v-if="zhOf(c.text)" class="ex-zh-inline">{{ zhOf(c.text) }}</em></span>
        </li>
      </ul>

      <!-- 「选两个字母」这种没有单独题号的多选 -->
      <div v-if="multiPick(g)" class="ex-item" :class="{ done: !!answers[g.from] }">
        <p class="ex-stem"><span class="ex-no">{{ g.from }}–{{ g.to }}</span></p>
        <label v-for="c in g.choices" :key="c.key" class="ex-radio block">
          <input type="checkbox" :checked="picked(g.from).includes(c.key)" @change="togglePick(g, c.key)" />
          <b>{{ c.key }}</b>
          <span><slot name="t" :text="c.text">{{ c.text }}</slot><em v-if="zhOf(c.text)" class="ex-zh-inline">{{ zhOf(c.text) }}</em></span>
        </label>
      </div>

      <!-- 填空：笔记原样排版，空位就地填 -->
      <div v-if="g.kind === 'fill' && g.notes" class="ex-notes">
        <p v-if="g.notesTitle" class="ex-notes-title">
          <slot name="t" :text="g.notesTitle">{{ g.notesTitle }}</slot>
          <span v-if="zhOf(g.notesTitle)" class="ex-zh">{{ zhOf(g.notesTitle) }}</span>
        </p>
        <div v-for="(line, li) in g.notes" :key="li" class="ex-note-line">
          <template v-for="(seg, si) in line" :key="si">
            <slot v-if="'text' in seg" name="t" :text="seg.text">{{ seg.text }}</slot>
            <label v-else class="ex-blank">
              <span class="ex-no">{{ seg.blank }}</span>
              <select v-if="g.choices?.length" :value="answers[seg.blank] || ''" @change="set(seg.blank, val($event))">
                <option value=""></option>
                <option v-for="c in g.choices" :key="c.key" :value="c.key">{{ c.key }}</option>
              </select>
              <input
                v-else
                :value="answers[seg.blank] || ''"
                :size="Math.max(8, (answers[seg.blank] || '').length + 2)"
                @input="set(seg.blank, val($event))"
              />
            </label>
          </template>
          <p v-if="zhOf(noteLineText(line))" class="ex-zh">{{ zhOf(noteLineText(line)) }}</p>
        </div>
      </div>

      <div v-for="it in g.items" :key="it.no" class="ex-item" :class="{ done: !!answers[it.no] }">
        <p class="ex-stem">
          <span class="ex-no">{{ it.no }}</span>
          <!-- 题干里有「……」「____」的就地填空 -->
          <template v-if="inlineParts(it.text).length > 1">
            <template v-for="(part, pi) in inlineParts(it.text)" :key="pi">
              <slot name="t" :text="part">{{ part }}</slot>
              <input
                v-if="pi < inlineParts(it.text).length - 1"
                class="ex-inline-input"
                :value="answers[it.no] || ''"
                @input="set(it.no, val($event))"
              />
            </template>
          </template>
          <slot v-else name="t" :text="it.text">{{ it.text }}</slot>
        </p>
        <p v-if="zhOf(it.text)" class="ex-zh">{{ zhOf(it.text) }}</p>

        <div v-if="judgeKeys(g).length" class="ex-opts">
          <label v-for="k in judgeKeys(g)" :key="k" class="ex-radio">
            <input type="radio" :name="`q${it.no}`" :checked="answers[it.no] === k" @change="set(it.no, k)" />
            {{ k }}
          </label>
        </div>
        <div v-else-if="it.options?.length" class="ex-opts col">
          <label v-for="o in it.options" :key="o.key" class="ex-radio block">
            <input type="radio" :name="`q${it.no}`" :checked="answers[it.no] === o.key" @change="set(it.no, o.key)" />
            <b>{{ o.key }}</b>
            <span><slot name="t" :text="o.text">{{ o.text }}</slot><em v-if="zhOf(o.text)" class="ex-zh-inline">{{ zhOf(o.text) }}</em></span>
          </label>
        </div>
        <select v-else-if="g.choices?.length" class="ex-select" :value="answers[it.no] || ''" @change="set(it.no, val($event))">
          <option value=""></option>
          <option v-for="c in g.choices" :key="c.key" :value="c.key">{{ c.key }}</option>
        </select>
        <input
          v-else-if="inlineParts(it.text).length <= 1"
          class="ex-input"
          :value="answers[it.no] || ''"
          @input="set(it.no, val($event))"
        />
      </div>
    </section>

    <!-- 作文：自己写，实时字数 -->
    <section v-if="exam.type === 'writing'" class="ex-group">
      <h4 class="ex-head">我的作文 <span class="ex-count">{{ essayWords }} 词</span></h4>
      <textarea class="ex-essay" :value="essay" rows="14" @input="emit('essay', val($event))"></textarea>
    </section>

    <div class="ex-foot">
      <span v-if="total">{{ answeredCount }} / {{ total }}</span>
      <span v-else></span>
      <span class="ex-foot-actions">
        <button v-if="canTranslate" class="ghost-btn small" :disabled="translating" @click="emit('translate')">
          {{ translating ? '翻译中…' : '翻译题目' }}
        </button>
        <button v-if="total" class="ghost-btn small" :disabled="!answeredCount" @click="emit('update', {})">清空</button>
      </span>
    </div>

    <div v-if="zoom" class="ex-zoom" @click="zoom = ''"><img :src="zoom" alt="" /></div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { noteLineText, examTexts, type ExamPaper, type ExamGroup } from '@/shared/core/examPaper'

const props = defineProps<{
  exam: ExamPaper
  answers: Record<number, string>
  showZh: boolean
  essay?: string
  translating?: boolean
  aiReady?: boolean
}>()
const emit = defineEmits<{
  (e: 'update', v: Record<number, string>): void
  (e: 'images', v: string[]): void
  (e: 'essay', v: string): void
  (e: 'translate'): void
}>()

const zoom = ref('')
const val = (e: Event) => (e.target as HTMLInputElement).value

function zhOf(t?: string): string {
  if (!props.showZh || !t) return ''
  return props.exam.zh?.[t.trim()] || ''
}
const canTranslate = computed(() => {
  if (!props.aiReady) return false
  const texts = examTexts(props.exam)
  return texts.some(t => !props.exam.zh?.[t])
})

function judgeKeys(g: ExamGroup): string[] {
  if (g.kind === 'tfng') return ['TRUE', 'FALSE', 'NOT GIVEN']
  if (g.kind === 'ynng') return ['YES', 'NO', 'NOT GIVEN']
  return []
}

/** 没有逐题题号、只有一张选项表的多选（Choose TWO letters） */
function multiPick(g: ExamGroup): boolean {
  return !g.items.length && !!g.choices?.length && g.kind !== 'fill'
}
function picked(no: number): string[] {
  return (props.answers[no] || '').split(',').filter(Boolean)
}
function togglePick(g: ExamGroup, key: string) {
  const cur = picked(g.from)
  const limit = g.to - g.from + 1
  const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key].slice(-limit)
  set(g.from, next.sort().join(','))
}

/** 题干里的空位：连续的点、下划线、省略号 */
function inlineParts(text: string): string[] {
  return text.split(/\s*(?:[._]{3,}|…{1,}|\u2026+)\s*/)
}

function set(no: number, v: string) {
  const next = { ...props.answers }
  if (v.trim()) next[no] = v
  else delete next[no]
  emit('update', next)
}

const total = computed(() => props.exam.groups.reduce((s, g) => s + (g.to - g.from + 1), 0))
const answeredCount = computed(() =>
  Object.values(props.answers).reduce((s, v) => s + (v.includes(',') ? v.split(',').length : 1), 0)
)
const essayWords = computed(() => (props.essay || '').split(/\s+/).filter(w => /[A-Za-z]/.test(w)).length)

/* ---------- 配图：选文件或直接粘贴 ---------- */
function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(f)
  })
}
async function addImages(files: File[]) {
  const imgs = files.filter(f => f.type.startsWith('image/'))
  if (!imgs.length) return
  const urls = await Promise.all(imgs.map(readAsDataUrl))
  emit('images', [...(props.exam.images || []), ...urls])
}
function onPickImages(e: Event) {
  const input = e.target as HTMLInputElement
  addImages(Array.from(input.files || []))
  input.value = ''
}
function onPaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.files || [])
  if (files.some(f => f.type.startsWith('image/'))) {
    e.preventDefault()
    addImages(files)
  }
}
function removeImage(i: number) {
  const next = [...(props.exam.images || [])]
  next.splice(i, 1)
  emit('images', next)
}
</script>

<style scoped>
.exam-panel {
  font-size: var(--text-base);
  line-height: 1.7;
  color: var(--c-text);
}
.ex-group { margin-bottom: var(--space-xl); }
.ex-section { font-size: var(--text-lg); margin: 0 0 var(--space-xs); color: var(--c-accent); }
.ex-head { font-size: var(--text-lg); margin: 0 0 var(--space-sm); display: flex; align-items: baseline; gap: var(--space-sm); }
.ex-count { font-size: var(--text-sm); font-weight: 400; color: var(--c-text-2); }
.ex-instr { margin: 0 0 var(--space-xs); }
.ex-zh { margin: 2px 0 0; color: var(--c-text-2); font-size: var(--text-sm); line-height: 1.6; }
.ex-zh-inline { display: block; font-style: normal; color: var(--c-text-2); font-size: var(--text-sm); }
.ex-judge {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2xs) var(--space-lg);
  margin: var(--space-sm) 0 var(--space-md);
}
.ex-judge dt { font-weight: 700; }
.ex-judge dd { margin: 0; }
.ex-choices { list-style: none; padding: 0; margin: var(--space-sm) 0; }
.ex-choices li { display: flex; gap: var(--space-sm); margin-bottom: var(--space-2xs); }
.ex-choices b { flex: none; min-width: 2em; }
.ex-item {
  margin: var(--space-sm) 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: var(--c-surface-2);
}
.ex-stem { margin: 0 0 var(--space-xs); }
.ex-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6em;
  height: 1.6em;
  margin-right: var(--space-xs);
  padding: 0 var(--space-2xs);
  border-radius: var(--radius-sm);
  background: var(--c-text);
  color: var(--c-surface);
  font-size: var(--text-sm);
  font-weight: 700;
}
.ex-item.done .ex-no { background: var(--c-accent); color: var(--c-text-on-accent); }
.ex-opts { display: flex; flex-wrap: wrap; gap: var(--space-xs) var(--space-lg); margin-top: var(--space-xs); }
.ex-opts.col { flex-direction: column; }
.ex-radio { display: inline-flex; align-items: flex-start; gap: var(--space-xs); cursor: pointer; }
.ex-radio.block { display: flex; }
.ex-radio input { margin-top: 0.45em; }
.ex-radio b { flex: none; }
.ex-input, .ex-blank input, .ex-inline-input {
  border: none;
  border-bottom: 1px solid var(--c-line);
  background: transparent;
  color: var(--c-text);
  font: inherit;
  padding: 0 var(--space-2xs);
}
.ex-input { width: 100%; }
.ex-inline-input { width: 9em; margin: 0 var(--space-2xs); }
.ex-input:focus, .ex-blank input:focus, .ex-inline-input:focus { outline: none; border-bottom-color: var(--c-accent); }
.ex-select, .ex-blank select {
  font: inherit;
  padding: 1px var(--space-xs);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  color: var(--c-text);
}
.ex-notes { padding: var(--space-md); border: 1px solid var(--c-line-soft); border-radius: var(--radius-md); }
.ex-notes-title { font-weight: 700; text-align: center; margin: 0 0 var(--space-sm); }
.ex-notes-title .ex-zh { display: block; font-weight: 400; }
.ex-note-line { margin: 0 0 var(--space-sm); padding-left: 1em; text-indent: -1em; }
.ex-note-line::before { content: '· '; }
.ex-note-line .ex-zh { text-indent: 0; }
.ex-blank { display: inline-flex; align-items: center; margin: 0 var(--space-2xs); text-indent: 0; }
.ex-images { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin: 0 0 var(--space-lg); }
.ex-fig { position: relative; margin: 0; max-width: 100%; }
.ex-fig img { display: block; max-width: 100%; max-height: 360px; border-radius: var(--radius-md); border: 1px solid var(--c-line-soft); cursor: zoom-in; }
.ex-img-del {
  position: absolute; top: 4px; right: 4px;
  background: var(--c-surface);
  opacity: 0; transition: opacity var(--dur-fast);
}
.ex-fig:hover .ex-img-del { opacity: 1; }
.ex-img-add {
  display: inline-flex; align-items: center; justify-content: center;
  width: 64px; height: 64px;
  border: 1px dashed var(--c-line); border-radius: var(--radius-md);
  color: var(--c-text-2); cursor: pointer;
}
.ex-essay {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  line-height: 1.8;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-md);
  background: var(--c-surface);
  color: var(--c-text);
  resize: vertical;
}
.ex-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--c-text-2);
  font-size: var(--text-sm);
}
.ex-foot-actions { display: inline-flex; gap: var(--space-xs); }
.ex-zoom {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: var(--c-mask); cursor: zoom-out;
}
.ex-zoom img { max-width: 92vw; max-height: 92vh; border-radius: var(--radius-md); }
</style>
