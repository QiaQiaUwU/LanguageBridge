<template>
  <!-- 手帐式清单：标题色块、核心词高亮、↳ 派生、▸ 短语、右侧便签 -->
  <div class="sheet" :class="`k-${note.kind}`">
    <div class="sheet-title">
      <span class="st-main">{{ note.hub.label }}</span>
      <span v-if="note.hub.sub" class="st-sub">{{ note.hub.sub }}</span>
    </div>

    <div class="sheet-body">
      <div class="sheet-main">
        <section v-for="b in note.branches" :key="b.label" class="sb" :class="branchClass(b.label)">
          <div v-if="note.branches.length > 1 || note.kind === 'root'" class="sb-label">{{ b.label }}</div>
          <div
            v-for="w in visibleWords(b.words)"
            :key="w.word"
            class="nw"
            :class="{ low: w.confidence < 0.7, added: w.added }"
          >
            <div class="nw-line">
              <button class="nw-word" @click="$emit('pick', w.word)">{{ w.word }}</button>
              <span v-if="w.pos" class="nw-pos">{{ w.pos }}.</span>
              <span class="nw-zh">{{ w.zh }}</span>
              <span v-if="w.added" class="nw-tag">补</span>
              <span v-else-if="w.confidence < 0.7" class="nw-tag" :title="w.evidence.join(' / ')">?</span>
              <button v-if="editable" class="ui-icon-btn sm nw-x" data-export-hide title="移除" @click="$emit('remove', w.word)">
                <i class="ri-close-line"></i>
              </button>
            </div>
            <div v-if="w.formula" class="nw-formula">{{ w.formula }}</div>
            <div v-for="d in w.derivs" :key="d.word" class="nw-deriv">
              <span class="arrow">↳</span>
              <button class="nw-dword" @click="$emit('pick', d.word)">{{ d.word }}</button>
              <span v-if="d.pos" class="nw-pos">{{ d.pos }}.</span>
              <span class="nw-zh">{{ d.zh }}</span>
            </div>
            <div v-for="p in w.phrases" :key="p.en" class="nw-phrase">
              <span class="arrow">▸</span><span class="ph-en">{{ p.en }}</span><span class="nw-zh">{{ p.zh }}</span>
            </div>
            <div v-if="w.links.length" class="nw-links">
              <span v-for="l in w.links" :key="l.kind + l.word" class="nl" :class="l.kind" :title="LINK_NAME[l.kind]">
                {{ LINK_MARK[l.kind] }} {{ l.word }}<small v-if="l.zh"> {{ l.zh }}</small>
              </span>
            </div>
          </div>
        </section>
      </div>

      <aside v-if="note.side.length" class="sheet-side">
        <div v-for="s in note.side" :key="s.label" class="sticky">
          <div class="sticky-label">{{ s.label }}</div>
          <div v-for="i in s.items" :key="i.word" class="sticky-item">
            <button class="nw-dword" @click="$emit('pick', i.word)">{{ i.word }}</button>
            <span class="nw-zh">{{ i.zh }}</span>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FamilyNote, NoteWord, LinkKind } from '@/shared/core/wordFamily'

const props = defineProps<{ note: FamilyNote; showLow?: boolean; editable?: boolean }>()
defineEmits<{ (e: 'pick', w: string): void; (e: 'remove', w: string): void }>()

const LINK_MARK: Record<LinkKind, string> = { syn: '≈', ant: '↔', root: '∽', confuse: '≠', base: '←' }
const LINK_NAME: Record<LinkKind, string> = { syn: '同义', ant: '反义', root: '同词根', confuse: '易混', base: '基词' }

/** 关系笔记的四块，各用各的荧光色 */
function branchClass(label: string): string {
  return { 派生: 'b-deriv', 同根: 'b-root', 近义: 'b-syn', 反义: 'b-ant' }[label] || ''
}

function visibleWords(list: NoteWord[]) {
  return props.showLow ? list : list.filter(w => w.confidence >= 0.7 || w.added)
}
</script>

<style scoped>
.sheet {
  /**
   * 两支荧光笔：--hl 标一级词，--hl2 标它的派生与关系词。
   * 颜色由设置页写到 :root 上（--note-hl1 / --note-hl2），没设过就用这里的默认值。
   */
  --hl: var(--note-hl1, color-mix(in srgb, var(--c-accent) 22%, transparent));
  --hl2: var(--note-hl2, color-mix(in srgb, var(--c-note-green, var(--c-accent)) 26%, transparent));
  padding: var(--space-sm);
  background: var(--c-surface);
  color: var(--c-text);
  font-size: var(--text-sm);
  line-height: 1.55;
}
/* 关系笔记的四块各用一支笔；二级（派生 / 关系词）统一用 --hl2 */
.b-deriv { --hl: var(--note-hl-deriv, color-mix(in srgb, var(--c-note-purple) 26%, transparent)); }
.b-root  { --hl: var(--note-hl-root, color-mix(in srgb, var(--c-note-orange) 30%, transparent)); }
.b-syn   { --hl: var(--note-hl-syn, color-mix(in srgb, var(--c-note-green, var(--c-accent)) 26%, transparent)); }
.b-ant   { --hl: var(--note-hl-ant, color-mix(in srgb, var(--c-note-red, var(--c-warn)) 26%, transparent)); }
.k-synonym { --hl: color-mix(in srgb, var(--c-note-purple) 26%, transparent); }
.k-topic { --hl: color-mix(in srgb, var(--c-note-yellow) 34%, transparent); }
.k-root { --hl: color-mix(in srgb, var(--c-note-orange) 30%, transparent); }

.sheet-title {
  display: inline-flex; align-items: baseline; gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm); margin-bottom: var(--space-sm);
  border-radius: var(--radius-md); background: var(--hl);
}
.st-main { font-size: var(--text-lg); font-weight: 700; }
.st-sub { font-size: var(--text-base); color: var(--c-accent); font-style: italic; }

.sheet-body { display: flex; gap: var(--space-sm); align-items: flex-start; }
.sheet-main { flex: 1; min-width: 0; }
.sb + .sb { margin-top: var(--space-sm); }
.sb-label {
  display: inline-block; margin-bottom: var(--space-2xs);
  font-size: var(--text-xs); color: var(--c-accent); font-weight: 600;
  border-bottom: 1.5px solid currentColor;
}
.nw { padding: 3px 0 5px; border-bottom: 1px dashed var(--c-line-soft); }
.nw.low { opacity: .55; }
.nw-line { display: flex; align-items: baseline; gap: var(--space-xs); flex-wrap: wrap; }
.nw-word, .nw-dword {
  border: none; padding: 0 2px; cursor: pointer; font: inherit; color: var(--c-text);
  background: transparent;
}
.nw-word { font-size: var(--text-base); font-weight: 600; background: linear-gradient(transparent 55%, var(--hl) 55%); }
.nw-word:hover, .nw-dword:hover { color: var(--c-accent); }
.nw-pos { color: var(--c-text-3); font-size: var(--text-xs); font-style: italic; }
.nw-zh { color: var(--c-text-2); }
.nw-tag {
  font-size: var(--text-2xs); padding: 0 5px; border-radius: var(--radius-full);
  background: var(--c-warn-soft); color: var(--c-warn);
}
.nw-x { margin-left: auto; opacity: 0; }
.nw:hover .nw-x { opacity: 1; }
.nw-formula { margin-left: var(--space-sm); color: var(--c-accent); font-size: var(--text-xs); }
.nw-deriv, .nw-phrase { display: flex; align-items: baseline; gap: var(--space-xs); margin-left: var(--space-sm); }
.arrow { color: var(--c-text-3); }
.ph-en { font-style: italic; }
.nw-links { display: flex; flex-wrap: wrap; gap: var(--space-2xs) var(--space-xs); margin: 2px 0 0 var(--space-md); }
/* 二级：往里缩一格，用第二支荧光笔 */
.nw-deriv { margin-left: var(--space-md); }
.nw-links .nl { background: linear-gradient(transparent 60%, var(--hl2) 60%); }
.nw-deriv .nw-word,
.nw-deriv > span:first-child { background: linear-gradient(transparent 55%, var(--hl2) 55%); }
.nl { font-size: var(--text-xs); color: var(--c-text-2); }
.nl small { color: var(--c-text-3); }
.nl.syn { color: var(--c-info); }
.nl.ant { color: var(--c-danger); }
.nl.root { color: var(--c-accent); }

.sheet-side { width: 34%; min-width: 120px; display: flex; flex-direction: column; gap: var(--space-xs); }
.sticky {
  padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--c-note-sticky) 32%, var(--c-surface));
  box-shadow: var(--c-shadow-sm); transform: rotate(-.6deg);
}
.sticky-label { font-weight: 700; font-size: var(--text-xs); margin-bottom: 2px; }
.sticky-item { display: flex; gap: var(--space-xs); align-items: baseline; font-size: var(--text-xs); }

@media (max-width: 520px) {
  .sheet-body { flex-direction: column; }
  .sheet-side { width: 100%; }
}
</style>
