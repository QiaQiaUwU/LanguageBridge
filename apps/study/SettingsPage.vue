<template>
  <div class="settings">
    <h2 class="page-title">设置</h2>

    <section class="card">
      <h3 class="card-title">外观</h3>
      <p class="card-sub">关系连线的三种颜色不跟主题变。</p>
      <div class="skin-grid">
        <button
          v-for="s in themeStore.skins"
          :key="s.id"
          class="skin"
          :class="{ on: themeStore.currentId === s.id }"
          @click="themeStore.setSkin(s.id)"
        >
          <span class="swatch" :style="{ background: s.paper, borderColor: s.border }">
            <i :style="{ background: s.accent }"></i>
          </span>
          <span class="skin-name">{{ s.name }}</span>
        </button>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">词库体检</h3>
      <p class="card-sub">
        音标、例句、词性走免费词典；话题、词根、考纲标签要过 AI。
      </p>
      <div class="health-grid">
        <div class="health-cell"><span class="hn">{{ health.total }}</span><span class="hl">词条总数</span></div>
        <div class="health-cell" :class="{ warn: health.noPhonetic }"><span class="hn">{{ health.noPhonetic }}</span><span class="hl">缺音标</span></div>
        <div class="health-cell" :class="{ warn: health.noMeaning }"><span class="hn">{{ health.noMeaning }}</span><span class="hl">缺中文释义</span></div>
        <div class="health-cell" :class="{ warn: health.noExample }"><span class="hn">{{ health.noExample }}</span><span class="hl">缺例句</span></div>
        <div class="health-cell" :class="{ warn: health.noPos }"><span class="hn">{{ health.noPos }}</span><span class="hl">缺词性</span></div>
        <div class="health-cell" :class="{ warn: health.noTags }"><span class="hn">{{ health.noTags }}</span><span class="hl">缺考纲标签</span></div>
        <div class="health-cell" :class="{ warn: health.noTopics }"><span class="hn">{{ health.noTopics }}</span><span class="hl">缺话题</span></div>
        <div class="health-cell" :class="{ warn: health.noMorphemes }"><span class="hn">{{ health.noMorphemes }}</span><span class="hl">缺词根词缀</span></div>
        <div class="health-cell" :class="{ warn: health.noFamily }"><span class="hn">{{ health.noFamily }}</span><span class="hl">缺词族</span></div>
      </div>
      <p class="card-sub small">
        免费可补：考纲标签 <b>{{ health.noTags }}</b>、词族 <b>{{ health.noFamily }}</b>、释义音标 <b>{{ health.fixableFree }}</b>。
        需要 AI：<b>{{ health.needAi }}</b>。
      </p>
    </section>

    <section class="card">
      <h3 class="card-title">词库整理</h3>

      <div class="op-row">
        <div class="op-info">
          <span class="op-name">合并重复词条</span>
          <span class="op-desc">
            重复记录合并成一条，保留信息更全的那份。
            <template v-if="dupCount > 0"><b>当前检测到 {{ dupCount }} 个词有重复记录。</b></template>
            <template v-else-if="dupChecked">当前没有重复。</template>
          </span>
        </div>
        <button class="ghost-btn" :disabled="busy" @click="doDedupe">
          {{ deduping ? '合并中…' : '开始合并' }}
        </button>
      </div>

      <div class="op-row">
        <div class="op-info">
          <span class="op-name">补全释义与音标</span>
          <span class="op-desc">
            补音标、例句、词性，不花 AI 额度。
            <template v-if="lackBasicCount > 0"><b>当前 {{ lackBasicCount }} 个词条信息不全。</b></template>
          </span>
        </div>
        <button class="ghost-btn" :disabled="busy" @click="doEnrichBasic">
          {{ enriching ? `补全中 ${enrichDone}/${enrichTotal}` : '开始补全' }}
        </button>
      </div>
      <div v-if="health.noTags > 0" class="op-row">
        <div class="op-info">
          <span class="op-name">从释义库回填考纲标签</span>
          <span class="op-desc">
            按词在哪几个子词库里判断，一两秒跑完，不花 AI 额度。
            <b>当前 {{ health.noTags }} 个词缺考纲标签。</b>
          </span>
        </div>
        <button class="ghost-btn" :disabled="busy" @click="doBackfillTags">
          {{ backfilling ? `回填中 ${backfillDone}/${backfillTotal}` : '开始回填' }}
        </button>
      </div>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">从词库重建工作缓存</span>
          <span class="op-desc">
            按 resources/word_explanations/ 重新生成 data/words.json。
            <b>内容以词库为准，学习状态保留</b>。改过词库文件时点一次。
          </span>
        </div>
        <button class="ghost-btn small" :disabled="rebuilding" @click="doRebuildCache">
          {{ rebuilding ? '重建中…' : '重建缓存' }}
        </button>
      </div>
      <p v-if="rebuildMsg" class="msg">{{ rebuildMsg }}</p>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">重建词库索引</span>
          <span class="op-desc">
            抽成 resources/word_index.json，之后筛选只读这一份。补全跑完后点一次。
          </span>
        </div>
        <button class="ghost-btn small" :disabled="reindexing" @click="doReindex">
          {{ reindexing ? '扫描中…' : '重建索引' }}
        </button>
      </div>
      <p v-if="reindexMsg" class="msg">{{ reindexMsg }}</p>

      <div class="op-row">
        <div class="op-info">
          <span class="op-name">批量改标签</span>
          <span class="op-desc">给整个词表统一加上或去掉一个标签。</span>
        </div>
        <div class="op-form">
          <select v-model="tagBookId" class="mini-select">
            <option value="">选择词表</option>
            <option v-for="g in books" :key="g.id" :value="g.id">{{ g.name }}（{{ g.wordIds.length }}）</option>
          </select>
          <input v-model="tagValue" class="mini-input" placeholder="标签名" />
          <button class="ghost-btn small" :disabled="busy || !tagBookId || !tagValue.trim()" @click="applyTag(true)">加上</button>
          <button class="ghost-btn small" :disabled="busy || !tagBookId || !tagValue.trim()" @click="applyTag(false)">去掉</button>
        </div>
      </div>

      <p v-if="tidyMsg" class="msg">{{ tidyMsg }}</p>
    </section>

    <section class="card">
      <h3 class="card-title">AI 补全（考纲标签 / 话题 / 词根词缀 / 词族）</h3>
      <p class="card-sub">
        补四类筛选数据：考纲标签、话题、词根词缀、词族。
        <b>只跑一次</b>，结果写进词条。补过的会跳过，中断了下次接着跑。
      </p>

      <div class="op-row">
        <div class="op-info">
          <span class="op-name">跑之前先看一眼要做多少事</span>
          <span class="op-desc">
            共 {{ aiPreview.total }} 个词，只跑标红那一档。
          </span>
        </div>
        <div class="op-form">
          <select v-model="aiScope" class="mini-select" :disabled="aiRunning">
            <option value="all">全部词条</option>
            <option v-for="g in books" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <button v-if="!aiRunning" class="ghost-btn small" :disabled="busy || aiProbing" @click="probeAi">
            {{ aiProbing ? '试跑中…' : '试跑一批' }}
          </button>
          <button v-if="!aiRunning" class="dark-btn small" :disabled="busy || !aiPreview.requests" @click="startAi">开始补全</button>
          <template v-else>
            <button class="ghost-btn small" @click="stopAi">停止</button>
            <button v-if="aiStuck" class="ghost-btn small" @click="startAi">长时间没动静，重开一轮</button>
          </template>
        </div>
      </div>
      <div class="precheck">
        <div class="precheck-item run">
          <b>{{ aiForce ? aiPreview.pending + aiPreview.attempted : aiPreview.pending }}</b>
          <span>这轮会跑</span>
          <em>约 {{ aiPreview.requests }} 次模型请求</em>
        </div>
        <div class="precheck-item">
          <b>{{ aiPreview.attempted }}</b>
          <span>跑过但没填上</span>
          <em>功能词、短语这类本来就拆不出词根，默认跳过</em>
        </div>
        <div class="precheck-item">
          <b>{{ aiPreview.complete }}</b>
          <span>已经齐了</span>
          <em>话题和词根都有，永远不会再跑</em>
        </div>
      </div>
      <label class="check-line">
        <input v-model="aiForce" type="checkbox" :disabled="aiRunning" />
        连"跑过但没填上"的那批也重跑一遍
      </label>

      <div v-if="aiRunning || aiDone || aiProgress.lastError" class="progress-block">
        <div class="progress-bar"><div class="progress-fill" :style="{ width: aiPercent + '%' }"></div></div>
        <p class="progress-text">
          {{ aiProgress.done }} / {{ aiProgress.total }}
          <template v-if="aiProgress.current">· 正在处理 {{ aiProgress.current }}</template>
          <template v-if="aiProgress.failed"> · {{ aiProgress.failed }} 个未成功（下次补跑会自动重试）</template>
          <template v-if="aiSaved"> · 已存 {{ aiSaved }} 个</template>
        </p>
        <p v-if="aiProgress.lastError" class="ai-err">最近一次失败：{{ aiProgress.lastError }}</p>
      </div>
      <div v-if="aiProbe" class="probe-block" :class="{ bad: !aiProbe.ok }">
        <p class="probe-head">
          试跑 {{ aiProbe.sample.join('、') }}：
          <b v-if="aiProbe.ok">正常，解析出 {{ aiProbe.parsed }} 条</b>
          <b v-else>没跑通</b>
        </p>
        <p v-if="aiProbe.error" class="probe-err">{{ aiProbe.error }}</p>
        <pre v-if="aiProbe.raw" class="probe-raw">{{ aiProbe.raw.slice(0, 600) }}</pre>
      </div>

      <p class="card-sub small">
        用 AI 面板里已配好的连接。<b>每批跑完立刻存盘</b>，中断后从断点接着走。
      </p>
    </section>

    <section class="card">
      <h3 class="card-title">词汇宇宙配色</h3>
      <p class="card-sub">
        三个上色维度各自独立：<b>按来源</b>（考纲）、<b>按话题</b>、<b>按掌握程度</b>，
        改过的存在这台机器上，出厂配色一直留着。
        随时能整个维度重置回去。
        关系连线那三个色不开放修改。
      </p>

      <div class="dim-tabs">
        <button
          v-for="d in colorDims" :key="d.id"
          class="mode-btn" :class="{ on: colorDim === d.id }"
          @click="colorDim = d.id"
        >{{ d.label }}</button>
        <span class="spacer"></span>
        <button class="ghost-btn small" :disabled="!dimHasOverrides" @click="doResetDim">
          重置这个维度
        </button>
      </div>

      <p v-if="!colorKeys.length" class="card-sub small">
        当前词库里还没有这个维度的取值，先跑一遍上面的 AI 补全。
      </p>
      <div v-else class="palette-wrap">
        <div class="palette-row">
          <span class="palette-label">色卡</span>
          <button
            v-for="c in paletteColors"
            :key="c"
            class="pal-sw"
            :class="{ on: armedColor === c }"
            :style="{ background: c }"
            :title="armedColor === c ? '已上膛，点下面的分类给它染色' : '点一下上膛'"
            @click="armedColor = armedColor === c ? '' : c"
          ></button>
          <span v-if="armedColor" class="palette-hint">已上膛，点下面任意分类给它上色</span>
        </div>

        <div class="swatch-grid">
          <div
            v-for="k in colorKeys"
            :key="k.key"
            class="swatch-card"
            :class="{ armed: !!armedColor }"
            :title="armedColor ? '点一下染成上膛的颜色' : '点左上角色卡先上膛，或点右下角小圆点自由选色'"
            @click="armedColor && onPickColor(k.key, armedColor)"
          >
            <span class="swatch-preview" :style="{ background: k.color }"></span>
            <span class="swatch-name">{{ k.label }}</span>
            <label class="swatch-free" title="自由选色" @click.stop>
              <input
                type="color"
                :value="k.color"
                @input="onPickColor(k.key, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </div>
      </div>

      <div class="op-row" style="margin-top:14px">
        <div class="op-info">
          <span class="op-name">从图片取色</span>
          <span class="op-desc">
        传一张图，按图里的主色铺到当前维度。太暗的会自动提亮。
            太暗的色会自动提亮——深空底色上太暗的节点等于看不见。
          </span>
        </div>
        <div class="op-form">
          <input ref="paletteInputEl" type="file" accept="image/*" hidden @change="onPickImage" />
          <button class="ghost-btn small" :disabled="paletteBusy" @click="paletteInputEl?.click()">
            {{ paletteBusy ? '取色中…' : '选择图片' }}
          </button>
          <button class="dark-btn small" :disabled="!palette.length || !colorKeys.length" @click="doApplyPalette">
            套到当前维度
          </button>
        </div>
      </div>

      <div v-if="palette.length" class="palette-strip">
        <span v-for="(c, i) in palette" :key="i" class="palette-chip" :style="{ background: c }" :title="c"></span>
      </div>
      <p v-if="paletteMsg" class="msg">{{ paletteMsg }}</p>
    </section>

    <section class="card">
      <h3 class="card-title">学习</h3>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">学习与打字设置</span>
          <span class="op-desc">每日新词量、复习比、打字判定等在学习设置里调。</span>
        </div>
        <button class="ghost-btn" @click="$router.push('/home')">去主页调整</button>
      </div>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">已掌握词表</span>
          <span class="op-desc">查看已经退出练习的词，可以把误标的捞回来。</span>
        </div>
        <button class="ghost-btn" @click="$router.push('/mastered')">管理</button>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">数据</h3>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">整体备份</span>
          <span class="op-desc">词条、词表、记忆卡片、错词本、已掌握、设置、配色，全部打成一个文件。</span>
        </div>
        <button class="ghost-btn" :disabled="busy" @click="doBackup">导出备份</button>
      </div>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">恢复备份</span>
          <span class="op-desc">同 id 的词条会被备份里的覆盖。恢复前建议先导一份当前的。</span>
        </div>
        <label class="ghost-btn file-btn">
          选择备份文件
          <input type="file" accept="application/json,.json" hidden @change="onPickBackup" />
        </label>
      </div>
      <p v-if="backupMsg" class="op-desc" :class="{ warn: backupWarn }">{{ backupMsg }}</p>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">只导词条</span>
          <span class="op-desc">纯词条 JSON，给别的工具用。</span>
        </div>
        <button class="ghost-btn" :disabled="busy" @click="doExport">导出 JSON</button>
      </div>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">当前规模</span>
          <span class="op-desc">
            {{ wordStore.words.length }} 个词条 · {{ books.length }} 个词表 ·
            {{ taggedCount }} 个词带标签 · {{ topicCount }} 个词带话题
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useThemeStore } from '@/shared/stores/themeStore'
import { useWordStore } from '@/shared/stores/wordStore'
import { buildBackup, restoreBackup } from '@/shared/core/backup'
import type { WordItem } from '@/shared/types/WordItem'
import { enrichWords, backfillTagsFromLibrary } from '@/shared/core/enrichment'
import { aiRunState, startAiRun, stopAiRun, aiRunStuck } from '@/shared/core/aiEnrichRunner'
import {
  countNeedAiEnrich, previewAiEnrich, checkLibraryHealth, probeAiEnrich, DEFAULT_BATCH_SIZE,
  type EnrichAiProgress, type LibraryHealth
} from '@/shared/core/aiEnrich'
import { SOURCE_ORDER } from '@/apps/word-core/components/graphColors'
import {
  sourceColor, masteryColor, topicColor, relationColor,
  setColor, applyPalette, resetDimension, hasOverrides,
  type ColorDimension
} from '@/shared/core/graphColorSettings'
import { extractPaletteFromImage, ensureVisibleOnDark } from '@/shared/core/paletteExtract'
import * as be from '@/shared/core/backendClient'
import { wordDB } from '@/shared/core/database'

const themeStore = useThemeStore()
const wordStore = useWordStore()

const books = computed(() => wordStore.groups.filter(g => g.id.startsWith('book-') && !g.parentId))

const deduping = ref(false)
const enriching = ref(false)
const enrichDone = ref(0)
const enrichTotal = ref(0)
const tidyMsg = ref('')
const backfilling = ref(false)
const backfillDone = ref(0)
const backfillTotal = ref(0)
const dupCount = ref(0)
const dupChecked = ref(false)
const tagBookId = ref('')
const tagValue = ref('')

const busy = computed(() => deduping.value || enriching.value || aiRunning.value || backfilling.value || aiProbing.value)

async function doBackfillTags() {
  backfilling.value = true
  tidyMsg.value = ''
  backfillDone.value = 0
  try {
    const changed = await backfillTagsFromLibrary(wordStore.words, wordStore.groups, p => {
      backfillDone.value = p.done
      backfillTotal.value = p.total
    })
    await persist(changed)
    tidyMsg.value = changed.length
      ? `回填完成：${changed.length} 个词补上了考纲标签，现在可以按考试筛选、词汇宇宙也能按来源上色了。`
      : '这些词不属于任何分类子词库（book-lib-cat-*），所以推导不出考纲标签。如果它们是你自己导入的词表，可以用下面的「批量改标签」手动打。'
  } catch (e) {
    tidyMsg.value = `回填出错：${e instanceof Error ? e.message : String(e)}`
  } finally {
    backfilling.value = false
  }
}

const health = computed<LibraryHealth>(() => checkLibraryHealth(wordStore.words))

const lackBasicCount = computed(
  () =>
    wordStore.words.filter(
      w => !w.phonetic || !w.example_sentences?.length || !w.meanings?.[0]?.partOfSpeech
    ).length
)

const taggedCount = computed(() => wordStore.words.filter(w => w.tags?.length).length)
const topicCount = computed(() => wordStore.words.filter(w => w.topics?.length).length)

function checkDup() {
  const seen = new Map<string, number>()
  for (const w of wordStore.words) {
    const k = w.word.toLowerCase().trim()
    seen.set(k, (seen.get(k) || 0) + 1)
  }
  dupCount.value = [...seen.values()].filter(n => n > 1).length
  dupChecked.value = true
}

async function doDedupe() {
  deduping.value = true
  tidyMsg.value = ''
  try {
    const r = await wordStore.dedupeWords()
    tidyMsg.value = `合并完成：处理了 ${r.merged} 个重复词条，修正了 ${r.groupsFixed} 处词表引用。`
    checkDup()
  } catch (e) {
    tidyMsg.value = `合并失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    deduping.value = false
  }
}

async function doEnrichBasic() {
  const targets = wordStore.words.filter(
    w => !w.phonetic || !w.example_sentences?.length || !w.meanings?.[0]?.partOfSpeech
  )
  if (!targets.length) {
    tidyMsg.value = '所有词条的基础信息都是全的，不用补。'
    return
  }
  enriching.value = true
  enrichTotal.value = targets.length
  enrichDone.value = 0
  tidyMsg.value = ''
  try {
    const changed = await enrichWords(targets, p => { enrichDone.value = p.done })
    await persist(changed)
    tidyMsg.value = `补全完成：更新了 ${changed.length} 个词条。`
  } catch (e) {
    tidyMsg.value = `补全出错：${e instanceof Error ? e.message : String(e)}`
  } finally {
    enriching.value = false
  }
}

const rebuilding = ref(false)
const rebuildMsg = ref('')
async function doRebuildCache() {
  if (!confirm('按词库里每个词自己的 JSON 重新生成工作缓存？\n学习状态和你自己加的词都会保住，但仍然建议先备份 data/ 目录。')) return
  rebuilding.value = true
  rebuildMsg.value = ''
  try {
    const r = await be.beRebuildWordCache()
    if (!r) rebuildMsg.value = '服务端没有响应（直接打开静态页时没有服务端，这一步跑不了）。'
    else if (!r.ok) rebuildMsg.value = `重建失败：${r.reason || '未知原因'}`
    else {
      rebuildMsg.value = `重建完成：共 ${r.total} 个词，其中 ${r.fromLib} 个来自词库，${r.keptLocalOnly} 个是只在本地有的（已保留）。刷新页面生效。`
      await wordStore.loadWords()
    }
  } catch (e) {
    rebuildMsg.value = `重建失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    rebuilding.value = false
  }
}

const reindexing = ref(false)
const reindexMsg = ref('')
async function doReindex() {
  reindexing.value = true
  reindexMsg.value = ''
  try {
    const r = await be.beReindexWordLibrary()
    reindexMsg.value = r
      ? `索引重建完成：${r.count} 个词条，用时 ${r.ms} 毫秒。`
      : '服务端没有响应（直接打开静态页时没有服务端，索引这一步跑不了）。'
  } catch (e) {
    reindexMsg.value = `索引重建失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    reindexing.value = false
  }
}

async function applyTag(add: boolean) {
  const group = wordStore.groups.find(g => g.id === tagBookId.value)
  if (!group) return
  const tag = tagValue.value.trim()
  const ids = new Set(group.wordIds)
  const changed: WordItem[] = []
  for (const w of wordStore.words) {
    if (!ids.has(w.id)) continue
    const has = w.tags?.includes(tag)
    if (add && !has) {
      w.tags = [...(w.tags || []), tag]
      changed.push(w)
    } else if (!add && has) {
      w.tags = (w.tags || []).filter(t => t !== tag)
      changed.push(w)
    }
  }
  if (!changed.length) {
    tidyMsg.value = add ? '这个词表里的词都已经有这个标签了。' : '这个词表里没有词带这个标签。'
    return
  }
  for (const w of changed) w.updatedAt = new Date().toISOString()
  await persist(changed)
  tidyMsg.value = `${add ? '已加上' : '已去掉'}标签「${tag}」，影响 ${changed.length} 个词条。`
}

async function persist(changed: WordItem[]) {
  if (!changed.length) return
  await wordDB.saveWordsBulk(JSON.parse(JSON.stringify(changed)))
  await be.beBulkSaveWords(changed)
  try {
    await be.bePatchWordLibrary(changed.map(w => ({
      word: w.word,
      exam_tags: w.tags,
      topics: w.topics,
      morphemes: w.morphemes,
      word_family: w.word_family
    })))
  } catch {
  }
}

const aiScope = ref('all')
const aiRunning = aiRunState.running
const aiDone = aiRunState.finished
const aiSaved = aiRunState.saved
const aiProgress = aiRunState.progress
const aiForce = ref(false)

const aiStuck = ref(false)
let stuckTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  stuckTimer = setInterval(() => { aiStuck.value = aiRunning.value ? aiRunStuck() : false }, 20_000)
})
onUnmounted(() => { if (stuckTimer) clearInterval(stuckTimer) })

const aiProbing = ref(false)
const aiProbe = ref<{ ok: boolean; error?: string; raw: string; parsed: number; sample: string[] } | null>(null)

async function probeAi() {
  aiProbing.value = true
  aiProbe.value = null
  try {
    aiProbe.value = await probeAiEnrich(aiTargets.value, aiForce.value)
  } catch (e) {
    aiProbe.value = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      raw: '',
      parsed: 0,
      sample: []
    }
  } finally {
    aiProbing.value = false
  }
}

const aiTargets = computed<WordItem[]>(() => {
  if (aiScope.value === 'all') return wordStore.words
  const g = wordStore.groups.find(x => x.id === aiScope.value)
  if (!g) return []
  const ids = new Set(g.wordIds)
  return wordStore.words.filter(w => ids.has(w.id))
})

const backfillableIds = computed(() => {
  const s = new Set<string>()
  for (const g of wordStore.groups) {
    if (!g.id.startsWith('book-lib-cat-')) continue
    for (const id of g.wordIds) s.add(id)
  }
  return s
})
const canBackfillTags = (w: WordItem) => backfillableIds.value.has(w.id)

const aiPreviewLive = computed(() =>
  previewAiEnrich(aiTargets.value, aiForce.value, DEFAULT_BATCH_SIZE, canBackfillTags)
)
const aiPreviewFrozen = ref<ReturnType<typeof previewAiEnrich> | null>(null)
watch(aiRunning, run => { aiPreviewFrozen.value = run ? aiPreviewLive.value : null })
const aiPreview = computed(() => aiPreviewFrozen.value || aiPreviewLive.value)
const needAiCount = computed(() => countNeedAiEnrich(aiTargets.value, aiForce.value))
const aiPercent = computed(() =>
  aiProgress.value.total ? Math.round((aiProgress.value.done / aiProgress.value.total) * 100) : 0
)

async function startAi() {
  await startAiRun({
    targets: aiTargets.value,
    force: aiForce.value,
    canBackfillTags,
    onBatchDone: persist
  })
  if (aiRunState.errorMsg.value) tidyMsg.value = `AI 补全出错：${aiRunState.errorMsg.value}`
}

function stopAi() {
  stopAiRun()
}

const colorDims = [
  { id: 'source' as const, label: '按考试' },
  { id: 'topic' as const, label: '按话题' },
  { id: 'mastery' as const, label: '按掌握程度' },
  { id: 'relation' as const, label: '关系连线' }
]
const colorDim = ref<ColorDimension>('source')

const extraPalette = computed<string[]>(() => palette.value || [])
const armedColor = ref('')
const paletteColors = computed(() => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const c of [...extraPalette.value, ...colorKeys.value.map(k => k.color)]) {
    const v = String(c || '').toLowerCase()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(c)
  }
  return out.slice(0, 14)
})
watch(colorDim, () => { armedColor.value = '' })
const colorTick = ref(0)

const MASTERY_KEYS: Array<{ key: string; label: string }> = [
  { key: 'mastered', label: '已掌握' },
  { key: 'known', label: '认识' },
  { key: 'fuzzy', label: '模糊' },
  { key: 'unknown', label: '不认识' },
  { key: 'unmarked', label: '没学过' }
]

const colorKeys = computed<Array<{ key: string; label: string; color: string }>>(() => {
  void colorTick.value
  if (colorDim.value === 'relation') {
    return [
      { key: 'synonym', label: '近义词', color: relationColor('synonym') },
      { key: 'antonym', label: '反义词', color: relationColor('antonym') },
      { key: 'word_family', label: '同根词', color: relationColor('word_family') },
      { key: 'morphology', label: '词形变换', color: relationColor('morphology') }
    ]
  }
  if (colorDim.value === 'mastery') {
    return MASTERY_KEYS.map(m => ({ key: m.key, label: m.label, color: masteryColor(m.key) }))
  }
  if (colorDim.value === 'source') {
    const set = new Set<string>()
    for (const w of wordStore.words) {
      if (w.tags?.length) w.tags.forEach(t => set.add(t))
      else if (w.level) set.add(w.level)
    }
    const known = SOURCE_ORDER.filter(n => set.has(n))
    const rest = [...set].filter(n => !SOURCE_ORDER.includes(n)).sort()
    return [...known, ...rest].map(n => ({ key: n, label: n, color: sourceColor(n) }))
  }
  const topics = new Set<string>()
  for (const w of wordStore.words) {
    const t: any = (w as any).topics
    const arr = Array.isArray(t) ? t : typeof t === 'string' ? t.split(/[,，;；/]/) : []
    for (const x of arr) { const v = String(x).trim(); if (v) topics.add(v) }
  }
  const list = [...topics].sort()
  return list.map(t => ({ key: t, label: t, color: topicColor(t, list) }))
})

const dimHasOverrides = computed(() => {
  void colorTick.value
  return hasOverrides(colorDim.value)
})

function onPickColor(key: string, color: string) {
  setColor(colorDim.value, key, color)
  colorTick.value++
}
function doResetDim() {
  resetDimension(colorDim.value)
  colorTick.value++
}

const paletteInputEl = ref<HTMLInputElement | null>(null)
const palette = ref<string[]>([])
const paletteBusy = ref(false)
const paletteMsg = ref('')

async function onPickImage(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  paletteBusy.value = true
  paletteMsg.value = ''
  try {
    const cols = await extractPaletteFromImage(file)
    palette.value = ensureVisibleOnDark(cols)
    paletteMsg.value = `取到 ${palette.value.length} 个颜色，点"套到当前维度"应用。`
  } catch (err) {
    palette.value = []
    paletteMsg.value = err instanceof Error ? err.message : '取色失败'
  } finally {
    paletteBusy.value = false
  }
}

function doApplyPalette() {
  applyPalette(colorDim.value, colorKeys.value.map(k => k.key), palette.value)
  colorTick.value++
  paletteMsg.value = '已应用。不满意可以单独点某个色块微调，或者点"重置这个维度"回到出厂配色。'
}

const backupMsg = ref('')
const backupWarn = ref(false)

async function doBackup() {
  busy.value = true
  try {
    const data = await buildBackup()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `LanguageBridge备份-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    const n = data.parts.words?.val.length || 0
    backupWarn.value = false
    backupMsg.value = `已导出：${n} 个词条，含词表、记忆卡片、错词本、设置。`
  } catch (e) {
    backupWarn.value = true
    backupMsg.value = '导出失败：' + (e as Error).message
  } finally {
    busy.value = false
  }
}

async function onPickBackup(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  busy.value = true
  try {
    const data = JSON.parse(await f.text())
    const r = await restoreBackup(data)
    await wordStore.loadWords()
    backupWarn.value = r.warnings.length > 0
    backupMsg.value =
      `已恢复：${r.words} 个词条 · ${r.groups} 个词表 · ${r.wrongBook} 条错词` +
      (r.settings ? ' · 设置' : '') +
      (r.warnings.length ? '｜' + r.warnings.join('；') : '')
  } catch (err) {
    backupWarn.value = true
    backupMsg.value = '恢复失败：' + (err as Error).message
  } finally {
    busy.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

function doExport() {
  const blob = new Blob([JSON.stringify(wordStore.words, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `LanguageBridge-words-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  await wordStore.loadWords()
  checkDup()
})
</script>

<style scoped lang="scss">
.settings { max-width: 860px; margin: 0 auto; padding: 18px 20px 70px; }
.page-title { font-size: 20px; margin: 0 0 18px; }
.card {
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 16px;
  background: var(--r-paper, #fff);
}
.card-title { font-size: 15.5px; margin: 0 0 6px; }
.card-sub {
  font-size: 12.5px;
  color: var(--r-ink2, #888);
  line-height: 1.7;
  margin: 0 0 14px;
  &.small { margin: 12px 0 0; }
}

.skin-grid { display: flex; gap: 10px; flex-wrap: wrap; }
.skin {
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 10px;
  padding: 8px 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  &.on { border-color: var(--r-accent, #8a4b3a); box-shadow: 0 0 0 1px var(--r-accent, #8a4b3a) inset; }
}
.swatch {
  width: 26px; height: 20px; border-radius: 5px;
  border: 1px solid; display: inline-flex; align-items: center; justify-content: center;
  i { width: 9px; height: 9px; border-radius: 50%; display: block; }
}
.skin-name { white-space: nowrap; }

.op-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--r-border, #f0f0f0);
  flex-wrap: wrap;
  &:first-of-type { border-top: none; }
}
.op-info { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 3px; }
.op-name { font-size: 14px; font-weight: 500; }
.op-desc { font-size: 12.5px; color: var(--r-ink2, #888); line-height: 1.6; }
.op-form { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }
.mini-select, .mini-input {
  padding: 5px 9px;
  border: 1px solid var(--r-border, #ddd);
  border-radius: 7px;
  background: var(--r-ui, #fafafa);
  color: inherit;
  font-size: 13px;
}
.mini-input { width: 120px; }
.msg {
  font-size: 12.5px;
  color: var(--r-accent, #8a4b3a);
  margin: 12px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--r-ui, #f6f6f6);
}
.health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
.health-cell {
  border-radius: 9px; background: var(--r-ui, #f6f6f6);
  padding: 11px 8px; text-align: center;
  display: flex; flex-direction: column; gap: 3px;
}
.health-cell .hn { font-size: 19px; font-weight: 600; }
.health-cell .hl { font-size: 11.5px; color: var(--r-ink2, #999); }
.health-cell.warn .hn { color: #d9822b; }

.dim-tabs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.dim-tabs .spacer { flex: 1; }
.mode-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  padding: 5px 11px; border-radius: 8px; font-size: 12.5px; cursor: pointer;
  border: 1px solid var(--r-border, #ddd); background: transparent; color: inherit;
  &.on { background: var(--r-accent, #8a4b3a); color: var(--r-paper, #fff); border-color: transparent; }
}
.swatch-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.swatch {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 10px 5px 6px; border-radius: 9px;
  border: 1px solid var(--r-border, #e4e4e4); background: var(--r-ui, #fafafa);
  cursor: pointer;
  input[type="color"] {
    width: 26px; height: 26px; padding: 0; border: none; border-radius: 6px;
    background: none; cursor: pointer;
  }
}
.swatch-name { font-size: 12.5px; }
.palette-strip { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 10px; }
.palette-chip { width: 30px; height: 22px; border-radius: 5px; border: 1px solid rgba(0,0,0,0.12); }
.precheck { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.precheck-item {
  flex: 1 1 150px;
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--r-border, #e4e4e4);
  border-radius: 10px;
  background: var(--r-ui, #fafafa);
  b { font-size: 22px; font-weight: 600; line-height: 1.15; }
  span { font-size: 12.5px; color: var(--r-ink2, #888); }
  em { font-size: 11.5px; font-style: normal; color: var(--r-ink2, #aaa); line-height: 1.5; }
  &.run { border-color: var(--r-accent, #8a4b3a); b { color: var(--r-accent, #8a4b3a); } }
}
.check-line {
  display: flex; align-items: flex-start; gap: 7px;
  margin-top: 10px; font-size: 12.5px; line-height: 1.6;
  color: var(--r-ink2, #888); cursor: pointer;
  input { margin-top: 3px; flex-shrink: 0; }
}
.progress-block { margin-top: 12px; }
.progress-bar { height: 6px; border-radius: 3px; background: var(--r-border, #eee); overflow: hidden; }
.progress-fill { height: 100%; background: #72c240; transition: width 0.3s ease; }
.progress-text { font-size: 12.5px; color: var(--r-ink2, #888); margin: 6px 0 0; }

.ai-err { font-size: 12.5px; color: #c0492b; margin: 6px 0 0; line-height: 1.6; word-break: break-all; }
.probe-block {
  margin-top: 12px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--r-border, #e4e4e4); background: var(--r-ui, #fafafa);
}
.probe-block.bad { border-color: #e0b4aa; }
.probe-head { font-size: 12.5px; margin: 0; color: var(--r-ink2, #777); }
.probe-head b { color: var(--r-ink, #333); }
.probe-block.bad .probe-head b { color: #c0492b; }
.probe-err { font-size: 12.5px; color: #c0492b; margin: 6px 0 0; line-height: 1.6; word-break: break-all; }
.probe-raw {
  margin: 8px 0 0; padding: 8px; max-height: 220px; overflow: auto;
  font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-all;
  background: var(--r-paper, #fff); border: 1px solid var(--r-border, #eee); border-radius: 8px;
  color: var(--r-ink2, #666);
}
.palette-wrap { display: flex; flex-direction: column; gap: 14px; }
.palette-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.palette-label { font-size: 12px; color: var(--r-ink2, #999); margin-right: 4px; }
.pal-sw {
  width: 26px; height: 26px; border-radius: 7px; cursor: pointer;
  border: 2px solid transparent; box-shadow: 0 0 0 1px var(--r-border, #ddd) inset;
}
.pal-sw.on { border-color: var(--r-ink, #222); transform: translateY(-2px); }
.palette-hint { font-size: 12px; color: var(--r-accent, #8a4b3a); margin-left: 6px; }
.swatch-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px;
}
.swatch-card {
  position: relative;
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: 10px;
  border: 1px solid var(--r-border, #e4e4e4); background: var(--r-paper, #fff);
}
.swatch-card.armed { cursor: pointer; }
.swatch-card.armed:hover { border-color: var(--r-accent, #8a4b3a); background: var(--r-ui, #faf7f5); }
.swatch-preview {
  width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12) inset;
}
.swatch-name { font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.swatch-free { position: absolute; right: 6px; bottom: 6px; width: 14px; height: 14px; cursor: pointer; }
.swatch-free input {
  width: 14px; height: 14px; padding: 0; border: none; background: none;
  border-radius: 50%; cursor: pointer; opacity: 0.45;
}
.swatch-free input:hover { opacity: 1; }
.file-btn { cursor: pointer; display: inline-flex; align-items: center; }
.op-desc.warn { color: #b5493c; }
</style>
