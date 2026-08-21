<template>
  <Teleport to="body">
    <Transition name="wl-fade">
      <div
        v-if="wordLookupState.visible"
        ref="popRef"
        class="word-lookup-popover"
        :style="{ left: wordLookupState.x + 'px', top: wordLookupState.y + 'px' }"
        @click.stop
      >
        <button class="wl-close" title="关闭" @click="closeWordLookup">×</button>

        <template v-if="wordLookupState.loading">
          <div class="wl-tip">查询中…</div>
        </template>

        <template v-else-if="wordLookupState.notFound">
          <div class="wl-head">
            <span class="wl-word">{{ wordLookupState.queryWord }}</span>
            <button class="wl-icon" title="发音" @click="speak(wordLookupState.queryWord)">
              <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
            </button>
          </div>
          <div class="wl-tip">词库里没有这个词</div>
        </template>

        <template v-else-if="wordLookupState.data">
          <div class="wl-head">
            <span class="wl-word">{{ wordLookupState.data.word }}</span>
            <span v-if="wordLookupState.data.phonetic" class="wl-ph">
              [{{ wordLookupState.data.phonetic.replace(/^\/|\/$/g, '') }}]
            </span>
            <button class="wl-icon" title="发音" @click="speak(wordLookupState.data.word)">
              <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
            </button>
            <button
              class="wl-icon star"
              :class="{ on: collected }"
              :title="collected ? '点一下取消' : '划线并记进右边的笔记'"
              :disabled="collecting"
              @click="collect"
            >
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path
                  :fill="collected ? 'currentColor' : 'none'"
                  stroke="currentColor"
                  stroke-width="1.6"
                  d="M12 17.3 6.2 20.6l1.5-6.6L2.6 9.5l6.7-.6L12 2.7l2.7 6.2 6.7.6-5.1 4.5 1.5 6.6z"
                />
              </svg>
            </button>
          </div>

          <div class="wl-trans">
            <div v-for="(g, i) in posGroups" :key="i" class="wl-row">
              <span class="wl-pos">{{ g.pos }}</span>
              <span class="wl-cn">{{ g.text }}</span>
            </div>
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, watch, ref } from 'vue'
import { wordLookupState, closeWordLookup, runCollectMarkHook } from '@/shared/core/wordLookup'
import { playWord } from '@/shared/core/audio'
import { useWordStore } from '@/shared/stores/wordStore'

const wordStore = useWordStore()
const popRef = ref<HTMLElement | null>(null)

const posGroups = computed(() => {
  const out: Array<{ pos: string; text: string }> = []
  for (const m of wordLookupState.data?.meanings || []) {
    if (!m.chinese) continue
    const pos = (m.partOfSpeech || '').trim()
    const hit = out.find(x => x.pos === pos)
    if (hit) hit.text += '；' + m.chinese
    else out.push({ pos, text: m.chinese })
  }
  return out
})

function speak(w: string) {
  playWord(w, 'us', 1)
}

/**
 * 这个词是不是已经记进笔记了。
 *
 * 星星做的事就是「划线 + 记进右边笔记」，是划线的快捷方式；
 * 至于词表统计，那是笔记那条链路自带的，不用这里操心。
 * 状态要看得见 —— 之前点了不亮、不提示、弹窗直接关，跟没反应一样。
 */
const collected = computed(() => {
  const w = wordLookupState.data?.word
  if (!w) return false
  const hit = wordStore.words.find(x => x.word.toLowerCase() === w.toLowerCase())
  return !!hit && hit.status === 'unknown'
})
const collecting = ref(false)

async function collect() {
  const d = wordLookupState.data
  if (!d || collecting.value) return
  collecting.value = true

  // 已经收过就是取消：把标记和笔记里那条一起撤掉
  if (collected.value) {
    const hit = wordStore.words.find(x => x.word.toLowerCase() === d.word.toLowerCase())
    if (hit) await wordStore.updateWordFields(hit.id, { status: 'unmarked' } as any)
    await runCollectMarkHook(d.word, { remove: true })
    collecting.value = false
    return
  }

  /**
   * 词库里没有就先建一条。
   *
   * updateWordFields 的第一行是 `if (!word) return` —— 词库里找不到就静默返回。
   * 而这里的 d 来自**词典查询**，词库里没有这个词时 d.id 对不上任何记录，
   * 于是"收进生词本"一行数据都没写，表现就是新词补充不进去。
   */
  const existed = wordStore.words.find(w => w.word.toLowerCase() === d.word.toLowerCase())
  if (existed) {
    await wordStore.updateWordFields(existed.id, { status: 'unknown' } as any)
  } else {
    const now = new Date().toISOString()
    await wordStore.addWord({
      ...d,
      id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'unknown',
      createdAt: now,
      updatedAt: now
    } as any)
  }

  // 在阅读助手里收藏时顺带划一道线，笔记里也留一条 —— 否则收藏完页面上没有任何痕迹
  // 把你实际点的那个词形也带上：文章里写的是 arrives，词典给的是 arrive
  await runCollectMarkHook(d.word, { surface: wordLookupState.queryWord })

  // 停一下再关窗，让人看见星星亮了
  collecting.value = false
  setTimeout(closeWordLookup, 450)
}

function onDocumentClick(e: MouseEvent) {
  const pop = popRef.value
  if (pop && !pop.contains(e.target as Node)) closeWordLookup()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeWordLookup()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

/**
 * 出屏修正，逐行照它的 watch：
 * 左边超出就贴左、右边超出就贴右、下边放不下就翻到目标上方。
 */
watch(
  () => [wordLookupState.visible, wordLookupState.x, wordLookupState.y],
  () => {
    if (!wordLookupState.visible) return
    nextTick(() => {
      const el = popRef.value
      if (!el) return
      const rect = el.getBoundingClientRect()
      let left = wordLookupState.x - rect.width / 2
      let top = wordLookupState.y
      const padding = 8
      if (left < padding) left = padding
      if (left + rect.width > window.innerWidth - padding) {
        left = window.innerWidth - rect.width - padding
      }
      if (top + rect.height > window.innerHeight - padding) {
        top = wordLookupState.y - rect.height - 16
      }
      el.style.left = `${left}px`
      el.style.top = `${top}px`
    })
  }
)
</script>

<style scoped lang="scss">

/* 星星：没收藏是空心，收了是实心且高亮 —— 一眼能看出状态 */
.wl-icon.star { color: var(--r-ink2, #9aa0a6); }
.wl-icon.star:hover { color: var(--r-accent, #8a4b3a); }
.wl-icon.star.on { color: #d4a017; }
.wl-icon.star:disabled { opacity: .5; cursor: default; }


/* 尺寸照 WordLookupPopover.vue：max-width 22rem / min-width 12rem /
   padding .75rem 1rem / radius .5rem / shadow 0 8px 24px rgba(0,0,0,.12) */
.word-lookup-popover {
  position: fixed;
  z-index: 10000;
  max-width: 22rem;
  min-width: 12rem;
  transform: translateX(-50%);
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e5e7eb);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  pointer-events: auto;
}
.wl-close {
  position: absolute; top: 0.5rem; right: 0.6rem;
  border: none; background: none; cursor: pointer;
  font-size: 16px; line-height: 1; color: var(--r-ink2, #b8bec6);
  &:hover { color: var(--r-ink, #1f2328); }
}
.wl-head {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  padding-right: 1.25rem;
}
.wl-word { font-size: 1.125rem; font-weight: 500; color: var(--r-ink, #1f2328); }
.wl-ph { font-size: 0.875rem; color: var(--r-ink2, #9aa0a6); }
.wl-icon {
  border: none; background: none; cursor: pointer; padding: 2px;
  line-height: 0; color: var(--r-ink2, #b8bec6);
  &:hover { color: var(--r-accent, #5b7a99); }
}
.wl-tip { font-size: 0.875rem; color: var(--r-ink2, #9aa0a6); margin-top: 0.25rem; }
.wl-trans { margin-top: 0.5rem; font-size: 0.95rem; line-height: 1.7; }
.wl-row { display: flex; align-items: flex-start; gap: 0.5rem; }
.wl-pos { flex-shrink: 0; min-width: 2.5rem; color: var(--r-accent, #5b7a99); }
.wl-cn { flex: 1; min-width: 0; color: var(--r-ink, #1f2328); }

.wl-fade-enter-active,
.wl-fade-leave-active { transition: opacity 0.15s ease; }
.wl-fade-enter-from,
.wl-fade-leave-to { opacity: 0; }
</style>
