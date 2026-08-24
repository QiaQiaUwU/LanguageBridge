<template>
  <div class="settings">
    <h2 class="page-title">设置</h2>

    <section class="card">
      <h3 class="card-title">外观</h3>
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
            <template v-if="dupCount > 0"><b>{{ dupCount }} 个词有重复记录</b></template>
            <template v-else-if="dupChecked">没有重复</template>
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
            <template v-if="lackBasicTodo > 0"><b>{{ lackBasicTodo }} 个待补</b></template>
            <template v-if="lackBasicTried > 0">
              <template v-if="lackBasicTodo > 0"> · </template>{{ lackBasicTried }} 个查过也补不上
            </template>
            <template v-if="!lackBasicTodo && !lackBasicTried">信息都是全的</template>
          </span>
          <label v-if="lackBasicTried > 0" class="op-desc">
            <input v-model="redoTriedBasic" type="checkbox" /> 连查过补不上的也再试一遍
          </label>
        </div>
        <button class="ghost-btn" :disabled="busy || (!lackBasicTodo && !redoTriedBasic)" @click="doEnrichBasic">
          {{ enriching ? `补全中 ${enrichDone}/${enrichTotal}` : '开始补全' }}
        </button>
      </div>
      <!--
        「从释义库回填考纲标签」撤了。

        它按「这个词在哪个 book-lib-cat-* 分组里」倒推标签，但一个词往往同时属于
        好几个考纲；回填只写得进一个，写进去之后那一项就算"有值"，
        AI 补全那边的规则是「已有值绝不覆盖」，于是这个词的来源永远停在
        那个不完整的结果上，再也没机会补全。占着位置还不准，不如没有。
        考纲标签统一交给 AI 补全出，它一次能给出全部来源。
      -->
      <!-- 重建缓存/索引/数据库体检是出问题时才用的运维操作，
           平时摆在这里只会让人以为需要定期点一下。收进折叠区。 -->
      <button class="fix-toggle" @click="showFixTools = !showFixTools">
        {{ showFixTools ? '收起' : '出问题了？修复工具' }}
      </button>
      <template v-if="showFixTools">
        <div class="op-row">
          <div class="op-info"><span class="op-name">从词库重建工作缓存</span></div>
          <button class="ghost-btn small" :disabled="rebuilding" @click="doRebuildCache">
            {{ rebuilding ? '重建中…' : '重建缓存' }}
          </button>
        </div>
        <p v-if="rebuildMsg" class="msg">{{ rebuildMsg }}</p>
        <div class="op-row">
          <div class="op-info">
            <span class="op-name">检查词表引用</span>
            <span class="op-desc">{{ relinkMsg || '词表显示 0 词、点进去说没有可学的词，多半是引用断了。这里清掉失效引用，整表空掉的会点名，重新导入一次即可。' }}</span>
          </div>
          <button class="ghost-btn small" :disabled="relinking" @click="doRelinkGroups">
            {{ relinking ? '检查中…' : '检查并修复' }}
          </button>
        </div>
        <div class="op-row">
          <div class="op-info"><span class="op-name">重建词库索引</span></div>
          <button class="ghost-btn small" :disabled="reindexing" @click="doReindex">
            {{ reindexing ? '扫描中…' : '重建索引' }}
          </button>
        </div>
        <p v-if="reindexMsg" class="msg">{{ reindexMsg }}</p>
        <div class="op-row">
          <div class="op-info">
            <span class="op-name">同时跑几个对轴</span>
            <span class="op-desc">机器好可以调高；跑起来明显卡顿就调回 1</span>
          </div>
          <select v-model.number="alignConcurrency" class="tw-select" style="width: 90px">
            <option :value="1">1 个</option>
            <option :value="2">2 个</option>
            <option :value="3">3 个</option>
            <option :value="4">4 个</option>
          </select>
        </div>

        <div class="op-row">
          <div class="op-info"><span class="op-name">数据库体检</span></div>
          <button class="ghost-btn small" @click="runInspect">体检</button>
        </div>
        <div class="op-row">
          <div class="op-info"><span class="op-name">测一下 AI 改不改得动英文</span></div>
          <button class="ghost-btn small" :disabled="probing" @click="runProbe">{{ probing ? '测试中' : '测试' }}</button>
        </div>
        <p v-if="probeMsg" class="msg">{{ probeMsg }}</p>
        <pre v-if="dbInfo" class="db-info">{{ dbInfo }}</pre>
      </template>

      <div class="op-row">
        <div class="op-info">
          <span class="op-name">批量改标签</span>
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
      <h3 class="card-title">导入词表</h3>

      <div class="dict-bar">
        <select v-model="twPicked" class="tw-select" :disabled="twBusy || !twList.length">
          <option value="" disabled>{{ twList.length ? '选一本词典' : '先加载词典列表' }}</option>
          <option v-for="d in twList" :key="d.url" :value="d.url">
            {{ d.name }}（{{ d.length || '?' }} 词）
          </option>
        </select>
        <button v-if="!twList.length" class="ghost-btn" :disabled="twBusy" @click="loadTwList">
          {{ twBusy ? '加载中' : '加载词典列表' }}
        </button>
        <template v-else>
          <button class="ghost-btn" :disabled="twBusy || !twPicked" @click="runTwMerge">
            {{ twBusy && twMode === 'merge' ? twProgress || '处理中' : '用它补例句' }}
          </button>
          <button class="dark-btn" :disabled="twBusy || !twPicked" @click="runTwImport">
            {{ twBusy && twMode === 'import' ? twProgress || '处理中' : '导入' }}
          </button>
        </template>
      </div>

      <p v-if="twMsg" class="msg">{{ twMsg }}</p>
    </section>

    <section class="card">
      <h3 class="card-title">AI 补全（词条缺什么补什么）</h3>
      <p class="card-sub">
        七个字段一起看：<b>中文释义 / 音标 / 例句 / 考纲来源 / 话题 / 词根词缀 / 词族</b>。
        每个词只补它缺的那几项，已经有的一律不动。中断了下次接着跑。
      </p>

      <div class="op-row">
        <div class="op-info">
          <span class="op-name">跑之前先看一眼要做多少事</span>
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
          <span>七项里有缺的词</span>
          <em>约 {{ aiPreview.requests }} 次模型请求</em>
        </div>
        <div class="precheck-item">
          <b>{{ aiPreview.attempted }}</b>
          <span>跑过但没填上</span>
        </div>
        <div class="precheck-item">
          <b>{{ aiPreview.complete }}</b>
          <span>已经齐了</span>
          <em>七项都全了，不会再跑</em>
        </div>

      </div>
      <label class="check-line">
        <input v-model="aiForce" type="checkbox" :disabled="aiRunning" />
        连"跑过但没填上"的那批也重跑一遍
      </label>

      <!-- 重跑指定项：比"连没填上的也重跑"粒度细得多。
           选中之后只跑这几项，而且**允许覆盖已有值** —— 用户点它就是嫌现在的值不对。 -->
      <button class="redo-toggle" @click="showRedo = !showRedo">
        {{ showRedo ? '收起' : '想重跑某一项？' }}
      </button>
      <div v-if="showRedo" class="redo-box">
        <label v-for="f in ENRICH_FIELD_LABELS" :key="f.key" class="redo-item">
          <input type="checkbox" :value="f.key" v-model="redoFields" :disabled="aiRunning" />
          {{ f.label }}
        </label>
        <!-- 重跑是**另一个动作**，有自己的按钮。
             上面那个「开始补全」永远只做"缺什么补什么"，两者互不干扰。 -->
        <div class="redo-actions">
          <p class="redo-note">
            <template v-if="redoFields.length">
              范围内 <b>{{ aiTargets.length }}</b> 个词全部重跑这
              {{ redoFields.length }} 项，<b>已有的值会被换掉</b>。
              约 {{ Math.ceil(aiTargets.length / DEFAULT_BATCH_SIZE) }} 次模型请求。
            </template>
            <template v-else>勾上要重跑的项。不勾就用上面那个「开始补全」，它只补缺的。</template>
          </p>
          <button
            class="dark-btn small"
            :disabled="!redoFields.length || busy"
            @click="startRedo"
          >
            重跑选中项
          </button>
        </div>
      </div>


      <div v-if="aiRunning || aiDone || aiProgress.lastError" class="progress-block">
        <div class="progress-bar"><div class="progress-fill" :style="{ width: aiPercent + '%' }"></div></div>
        <p class="progress-text">
          {{ aiProgress.done }} / {{ aiProgress.total }}
          <template v-if="aiProgress.current">· 正在处理 {{ aiProgress.current }}</template>
          <template v-if="aiProgress.failed"> · {{ aiProgress.failed }} 个未成功（下次补跑会自动重试）</template>
          <template v-if="aiSaved"> · 已存 {{ aiSaved }} 个</template>
        </p>
        <p v-if="aiProgress.lastError" class="ai-err">最近一次失败：{{ aiProgress.lastError }}</p>
        <!-- 失败率过半基本就是模型选错了（推理模型不吐 JSON），
             与其让它一路烧完几百次请求，不如当场点破 -->
        <p v-if="allFailing" class="ai-err">
          这一轮几乎每批都失败，多半是当前模型不适合结构化输出。先用「试跑一批」验一下，
          或在 AI 面板里换一个普通对话模型（不带思考过程的）。
        </p>
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
      <h3 class="card-title">自定义配色</h3>
      <p class="card-sub">
        划线荧光笔和词汇宇宙共用一套色卡。先在色卡里备好颜色，再分给各处。
      </p>

      <!-- ① 色卡本体：编辑 / 图片取色。所有颜色都从这里出。 -->
      <div class="palette-row">
        <span class="palette-label">色卡</span>

        <template v-if="palEditing">
          <span v-for="(c, i) in paletteColors" :key="i" class="pal-edit">
            <input
              type="color"
              :value="c"
              @input="palSet(i, ($event.target as HTMLInputElement).value)"
            />
            <button class="pal-x" title="删掉这个色" @click="palDel(i)">×</button>
          </span>
          <button class="ghost-btn tiny" @click="palAdd">＋</button>
          <button class="ghost-btn tiny" @click="palReset">恢复默认</button>
        </template>

        <template v-else>
          <button
            v-for="c in paletteColors"
            :key="c"
            class="pal-sw"
            :class="{ on: armedColor === c }"
            :style="{ background: c }"
            :title="armedColor === c ? '已上膛，点下面要染色的地方' : '点一下上膛'"
            @click="armedColor = armedColor === c ? '' : c"
          ></button>
        </template>

        <button class="pal-edit-btn" @click="palEditing = !palEditing">
          {{ palEditing ? '完成' : '编辑' }}
        </button>
      </div>

      <!-- 多套色卡：调好一套不容易，换主题时不该从头再调 -->
      <div class="palette-row sets">
        <select v-model="palSetName" class="pal-select" @change="loadPalSet">
          <option value="">切换色卡…</option>
          <option v-for="ps in palSets" :key="ps.name" :value="ps.name">
            {{ ps.name }}{{ ps.builtin ? '（内置）' : '' }}
          </option>
        </select>
        <input v-model="palNewName" class="pal-name-input" placeholder="给当前这套起个名字" />
        <button class="ghost-btn tiny" :disabled="!palNewName.trim()" @click="doSavePalSet">另存</button>
        <button
          class="ghost-btn tiny"
          :disabled="!palSetName || palSets.find(p => p.name === palSetName)?.builtin"
          @click="doDelPalSet"
        >删掉这套</button>
      </div>

      <div class="op-row">
        <div class="op-info">
          <span class="op-name">从图片取色</span>
          <span class="op-desc">取到的颜色并进色卡，不会覆盖已有的</span>
        </div>
        <div class="op-form">
          <input ref="paletteInputEl" type="file" accept="image/*" hidden @change="onPickImage" />
          <button class="ghost-btn small" :disabled="paletteBusy" @click="paletteInputEl?.click()">
            {{ paletteBusy ? '取色中…' : '选择图片' }}
          </button>
        </div>
      </div>
      <p v-if="paletteMsg" class="msg">{{ paletteMsg }}</p>

      <p v-if="armedColor" class="palette-hint armed-tip">
        已上膛 <span class="armed-dot" :style="{ background: armedColor }"></span>，
        点下面任意一处就染上去
      </p>

      <!-- ② 荧光标记 -->
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">划线荧光色</span>
          <span class="op-desc">阅读时划线用的底色</span>
        </div>
        <div class="hl-picker">
          <button
            v-for="c in HL_COLORS"
            :key="c.name"
            class="hl-dot"
            :class="{ on: defaultHl === c.name }"
            :style="{ background: c.hex }"
            :title="c.label"
            @click="defaultHl = c.name"
          ></button>
          <button
            class="hl-dot custom"
            :class="{ on: defaultHl === 'custom', armed: !!armedColor }"
            :style="{ background: customHl }"
            title="色卡上膛后点这里，把颜色染过来"
            @click="armedColor ? dyeHighlight() : (defaultHl = 'custom')"
          ></button>
        </div>
      </div>

      <!-- ③ 词汇宇宙：三个维度各自一套取值 -->
      <div class="dim-head">
        <span class="op-name">词汇宇宙</span>
        <div class="dim-tabs">
          <button
            v-for="d in colorDims"
            :key="d.id"
            class="dim-tab"
            :class="{ on: colorDim === d.id }"
            @click="colorDim = d.id"
          >{{ d.label }}</button>
          <button class="ghost-btn tiny" @click="doResetDim">重置这个维度</button>
          <button
            class="ghost-btn tiny"
            :disabled="!paletteColors.length || !colorKeys.length"
            @click="doApplyPalette"
          >整组套上</button>
        </div>
      </div>

      <p v-if="!colorKeys.length" class="card-sub small">
        当前词库里还没有这个维度的取值，先跑一遍上面的 AI 补全。
      </p>
      <div v-else class="swatch-grid">
        <div
          v-for="k in colorKeys"
          :key="k.key"
          class="swatch-card"
          :class="{ armed: !!armedColor }"
          :title="armedColor ? '点一下染成上膛的颜色' : '点色卡先上膛，或点右下角小圆点自由选色'"
          @click="armedColor && onPickColor(k.key, armedColor)"
        >
          <span class="swatch-name">{{ k.label }}</span>
          <label class="swatch-free" title="自由选色" @click.stop>
            <input
              type="color"
              :value="k.color"
              @input="onPickColor(k.key, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <span class="swatch-bar" :style="{ background: k.color }"></span>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">学习</h3>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">学习与打字设置</span>
        </div>
        <button class="ghost-btn" @click="$router.push('/home')">去主页调整</button>
      </div>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">已掌握词表</span>
        </div>
        <button class="ghost-btn" @click="$router.push('/mastered')">管理</button>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">定时提醒</h3>
      <p class="op-desc">到点在悬浮球上提醒</p>
      <div v-for="r in reminders" :key="r.id" class="op-row">
        <div class="op-info">
          <span class="op-name">{{ r.label }}</span>
          <span class="op-desc">每 {{ r.minutes }} 分钟 · 下次 {{ nextAtText(r.nextAt) }}</span>
        </div>
        <button class="ghost-btn" @click="dropReminder(r.id)">删除</button>
      </div>
      <p v-if="!reminders.length" class="op-desc">还没有提醒。</p>
      <div class="op-row">
        <div class="op-info rm-new">
          <input v-model="newReminderLabel" class="rm-input" placeholder="提醒我做什么（如：起来走走）" />
          每 <input v-model.number="newReminderMinutes" type="number" min="1" max="1440" class="rm-num" /> 分钟
        </div>
        <button class="dark-btn" :disabled="!newReminderLabel.trim()" @click="addOne">添加</button>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">数据</h3>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">整体备份</span>
        </div>
        <button class="ghost-btn" :disabled="busy" @click="doBackup">导出备份</button>
      </div>
      <div class="op-row">
        <div class="op-info">
          <span class="op-name">恢复备份</span>
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
import { fetchTwDictList, fetchTwDict, buildTwPatch, twToWordItem } from '@/shared/core/typewordsDict'
import { inspectDatabase } from '@/shared/core/database'
import { buildBackup, restoreBackup } from '@/shared/core/backup'
import type { WordItem } from '@/shared/types/WordItem'
import { enrichWords } from '@/shared/core/enrichment'
import { aiRunState, startAiRun, stopAiRun, aiRunStuck } from '@/shared/core/aiEnrichRunner'
import {
  countNeedAiEnrich, previewAiEnrich, checkLibraryHealth, probeAiEnrich, DEFAULT_BATCH_SIZE,
  ENRICH_FIELD_LABELS,
  type EnrichAiProgress, type LibraryHealth, type EnrichField
} from '@/shared/core/aiEnrich'
import { SOURCE_ORDER } from '@/apps/word-core/components/graphColors'
import {
  readPalette, savePalette, resetPalette, mergeIntoPalette,
  listPaletteSets, savePaletteSet, deletePaletteSet
} from '@/shared/core/sharedPalette'
import { reminders as reminderList, addReminder, removeReminder, loadReminders } from '@/shared/core/agentActions'

/* ---------- 定时提醒 ---------- */
loadReminders()
const reminders = ref([...reminderList])
const newReminderLabel = ref('')
const newReminderMinutes = ref(30)

function refreshReminders() {
  reminders.value = [...reminderList]
}
function addOne() {
  const label = newReminderLabel.value.trim()
  if (!label) return
  addReminder(label, Math.max(1, Math.min(1440, newReminderMinutes.value || 30)))
  newReminderLabel.value = ''
  refreshReminders()
}
function dropReminder(id: string) {
  removeReminder(id)
  refreshReminders()
}
function nextAtText(at: number): string {
  const left = Math.max(0, Math.round((at - Date.now()) / 60000))
  return left <= 0 ? '马上' : `${left} 分钟后`
}
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

// ===== TypeWords 词典补全 =====
const twList = ref<any[]>([])
const twPicked = ref('')
const twBusy = ref(false)
const twMsg = ref('')
const twListMsg = ref('')
const twProgress = ref('')
const twMode = ref<'merge' | 'import'>('merge')

/**
 * 划线的默认高亮色。
 *
 * 之前只能在划词菜单里右键色块设置 —— 藏得太深，没人找得到。
 * 这里跟自定义色一起放出来，两边写的是同一个 localStorage 键。
 */
const HL_COLORS = [
  { name: 'sand', hex: '#c9b287', label: '沙' },
  { name: 'sage', hex: '#9ab094', label: '青' },
  { name: 'mist', hex: '#94a8b8', label: '雾' },
  { name: 'rose', hex: '#c49e9e', label: '绯' },
  { name: 'lilac', hex: '#aaa0ba', label: '紫' },
  { name: 'clay', hex: '#c49480', label: '陶' }
]
const defaultHl = ref(localStorage.getItem('lb-default-hl') || 'sand')
watch(defaultHl, v => localStorage.setItem('lb-default-hl', v))

/** 自定义色单独存，选了就盖过预设 */
const customHl = ref(localStorage.getItem('lb-custom-hl') || '#c9b287')
watch(customHl, v => {
  localStorage.setItem('lb-custom-hl', v)
  // 当场生效，不用刷新
  document.documentElement.style.setProperty('--lb-custom-hl', v)
  defaultHl.value = 'custom'
})

const showFixTools = ref(false)

/** 对轴并发数。改完下次起任务生效，不用刷新。 */
const alignConcurrency = ref(Number(localStorage.getItem('lb-align-concurrency')) || 1)
watch(alignConcurrency, v => localStorage.setItem('lb-align-concurrency', String(v)))
const probing = ref(false)
const probeMsg = ref('')

async function runProbe() {
  probing.value = true
  probeMsg.value = ''
  try {
    const { probeEnglishFixer } = await import('@/shared/core/transcriptClean')
    const r = await probeEnglishFixer()
    probeMsg.value = r.ok
      ? `正常：模型把 "webling good" 改成了 → ${r.got}`
      : `模型没改这句已知有错的样本，返回：${r.got}。说明它在敷衍，或者当前模型能力不够，换个模型试试。`
  } catch (e) {
    probeMsg.value = '测试失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    probing.value = false
  }
}
const dbInfo = ref('')
async function runInspect() {
  dbInfo.value = '检查中…'
  try {
    dbInfo.value = await inspectDatabase()
  } catch (e) {
    dbInfo.value = '体检失败：' + (e instanceof Error ? e.message : String(e))
  }
}

async function runTwImport() {
  const picked = twList.value.find((d: any) => d.url === twPicked.value)
  if (!picked) return
  twBusy.value = true
  twMode.value = 'import'
  twMsg.value = ''
  twProgress.value = '下载词典…'
  try {
    const dict = await fetchTwDict(picked.language || 'en', picked.url)
    const source = `TypeWords · ${picked.name}`
    const items = dict.filter(w => w.word).map(w => twToWordItem(w, source))
    twProgress.value = `写入 ${items.length} 词…`
    const r = await wordStore.addWords(items as any)
    // createGroup 收的是整个 WordGroup 对象，不是 (name, desc)
    const now = new Date().toISOString()
    /**
     * 词表要收录这本词典的**全部**词，不只是这次新建的那些。
     *
     * 原来按 source 过滤，而库里已有的同名词 source 是别的来源，全被漏掉 ——
     * 3575 个词的雅思库导进来，词表里只剩一百多个新词。
     * 词库是总集合（同一个词只存一份），词表只是一个指向词条的清单，
     * 两个概念不能混。
     */
    const want = new Set(dict.map(w => w.word.toLowerCase()).filter(Boolean))
    const ids = wordStore.words.filter(w => want.has(w.word.toLowerCase())).map(w => w.id)
    await wordStore.createGroup({
      // 主页的「我的词表」只列 id 以 book- 开头的分组，所以前缀必须是 book-
      id: `book-tw-${Date.now().toString(36)}`,
      name: picked.name,
      description: `导入自 ${source}`,
      wordIds: ids,
      createdAt: now,
      updatedAt: now
    } as any)
    twMsg.value =
      `《${picked.name}》：词表收录 ${ids.length} 词` +
      `${r.successCount ? `，其中 ${r.successCount} 个是词库里原本没有的` : '，全部在词库里已有'}`
  } catch (e) {
    twMsg.value = `导入失败：${e instanceof Error ? e.message : '未知错误'}`
  } finally {
    twBusy.value = false
    twProgress.value = ''
  }
}

async function loadTwList() {
  twBusy.value = true
  twMsg.value = ''
  try {
    const list = await fetchTwDictList()
    // 只要英文单词类词典
    twList.value = list.filter((d: any) => d && d.url && (d.language || 'en') === 'en')
    twPicked.value = twList.value[0]?.url || ''
    twListMsg.value = `可用词典 ${twList.value.length} 本`
  } catch (e) {
    twListMsg.value = ''
    twMsg.value = `列表加载失败：${e instanceof Error ? e.message : '未知错误'}（需要联网访问 files.typewords.cc）`
  } finally {
    twBusy.value = false
  }
}

async function runTwMerge() {
  const picked = twList.value.find((d: any) => d.url === twPicked.value)
  if (!picked) return
  twBusy.value = true
  twMode.value = 'merge'
  twMsg.value = ''
  twProgress.value = '下载词典…'
  try {
    const dict = await fetchTwDict(picked.language || 'en', picked.url)
    const byWord = new Map<string, any>()
    for (const w of dict) if (w.word) byWord.set(w.word.toLowerCase(), w)

    // 先看这本词典到底带不带例句/短语/近义词。TypeWords 的词典分两类：
    // 「新概念」「四六级」这种带完整词条数据，而「场景词汇」这种只有词+释义。
    // 不先报出来的话，用户看到「匹配 621 个补了 0 条」只会以为是坏了。
    const has = { sentences: 0, phrases: 0, synos: 0, etymology: 0 }
    for (const w of dict) {
      if (w.sentences?.length) has.sentences++
      if (w.phrases?.length) has.phrases++
      if (w.synos?.length) has.synos++
      if (w.etymology?.length) has.etymology++
    }
    if (!has.sentences && !has.phrases && !has.synos && !has.etymology) {
      twMsg.value =
        `《${picked.name}》共 ${dict.length} 词，但这本词典里**没有例句、短语、近义词**，` +
        `只有单词和释义，所以没有可补的内容。\n` +
        `带例句的通常是「新概念英语」「四六级」这类词书，场景词表一般只有词表本身。`
      return
    }

    const all = wordStore.words
    let touched = 0
    let matched = 0
    for (let i = 0; i < all.length; i++) {
      if (i % 200 === 0) {
        twProgress.value = `${i}/${all.length}`
        await new Promise(r => setTimeout(r, 0))
      }
      const tw = byWord.get(all[i].word.toLowerCase())
      if (!tw) continue
      matched++
      const patch = buildTwPatch(all[i], tw)
      if (patch) {
        await wordStore.updateWordFields(all[i].id, patch as any)
        touched++
      }
    }
    twMsg.value =
      `《${picked.name}》${dict.length} 词：匹配上 ${matched} 个，补了 ${touched} 个词条。\n` +
      `该词典带例句 ${has.sentences} 词 · 短语 ${has.phrases} · 近义词 ${has.synos} · 词源 ${has.etymology}。` +
      (matched && !touched ? '\n补 0 条说明这些词的对应字段本来就已经有内容了（只补空缺，不覆盖）。' : '')
  } catch (e) {
    twMsg.value = `补全失败：${e instanceof Error ? e.message : '未知错误'}`
  } finally {
    twBusy.value = false
    twProgress.value = ''
  }
}
const dupCount = ref(0)
const dupChecked = ref(false)
const tagBookId = ref('')
const tagValue = ref('')

const busy = computed(() => deduping.value || enriching.value || aiRunning.value || aiProbing.value)


const health = computed<LibraryHealth>(() => checkLibraryHealth(wordStore.words))

/**
 * 「信息不全」拆成两档。
 *
 * 原来只有一个数：凡是缺音标/例句/词性的都算，点了补全之后
 * 那些词典和接口都查不到的词（生僻词、词组、专有名词）依然缺，
 * 数字一点不降 —— 看着像功能没生效，实际是每次都在重查这批查不到的。
 * 现在按有没有查过分开，只有第一档值得跑。
 */
function lacksBasic(w: WordItem): boolean {
  return !w.phonetic || !w.example_sentences?.length || !w.meanings?.[0]?.partOfSpeech
}
const lackBasicTodo = computed(
  () => wordStore.words.filter(w => lacksBasic(w) && !w.basicEnrichedAt).length
)
const lackBasicTried = computed(
  () => wordStore.words.filter(w => lacksBasic(w) && !!w.basicEnrichedAt).length
)
const redoTriedBasic = ref(false)

/** 跑了一批以上、而且几乎全挂 —— 这种情况继续跑下去只是烧额度 */
const allFailing = computed(() => {
  const p = aiProgress.value
  return p.done >= 24 && p.failed >= p.done * 0.8
})

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
    w => lacksBasic(w) && (redoTriedBasic.value || !w.basicEnrichedAt)
  )
  if (!targets.length) {
    tidyMsg.value = lackBasicTried.value
      ? '剩下的都查过了，词典和接口补不出来。勾上重试才会再跑一遍。'
      : '所有词条的基础信息都是全的，不用补。'
    return
  }
  enriching.value = true
  enrichTotal.value = targets.length
  enrichDone.value = 0
  tidyMsg.value = ''
  try {
    const changed = await enrichWords(targets, p => { enrichDone.value = p.done })
    await persist(changed)
    const still = targets.filter(lacksBasic).length
    tidyMsg.value = still
      ? `补全完成：更新了 ${changed.length} 个词条，其中 ${still} 个查不到，已标记为查过。`
      : `补全完成：更新了 ${changed.length} 个词条。`
  } catch (e) {
    tidyMsg.value = `补全出错：${e instanceof Error ? e.message : String(e)}`
  } finally {
    enriching.value = false
  }
}

/* ---------- 词表引用修复 ---------- */

const relinking = ref(false)
const relinkMsg = ref('')

/**
 * 把每个词表的 wordIds 重新指向现存的词条。
 *
 * 词表存的是 id，而「合并重复词条」「重建缓存」这些操作会让一部分 id 消失。
 * 引用一断，词表在主页显示 0 词、点进去学习是「没有可学的词」、
 * 配套教材也因为拿不到词而不会生成 —— 但词其实都还在库里，只是对不上号了。
 *
 * **能做的和不能做的**：词表只存 id，不存单词本身，所以 id 一旦失效，
 * 已经无从知道它原来指的是哪个词 —— 这一步只能把死引用清掉，让词表数字变准，
 * 不能凭空恢复。整表清空的会点名，那种只能重新导入一次（词都还在库里，
 * 重新导入不会产生重复词条，只是重新建一份清单）。
 *
 * 真正的解法在源头：合并重复词条时同步改所有词表的引用。
 * 那一步现在只修了一部分（合并提示里的"修正了 N 处词表引用"），
 * 是下一轮该补的地方。
 */
async function doRelinkGroups() {
  relinking.value = true
  relinkMsg.value = ''
  try {
    const byId = new Map(wordStore.words.map(w => [w.id, w]))
    const byWord = new Map<string, string>()
    for (const w of wordStore.words) {
      const k = w.word.toLowerCase()
      if (!byWord.has(k)) byWord.set(k, w.id)
    }

    let fixedGroups = 0
    let relinked = 0
    let dropped = 0

    const broken: string[] = []
    for (const g of wordStore.groups) {
      const alive = g.wordIds.filter(id => byId.has(id))
      if (alive.length === g.wordIds.length) continue
      dropped += g.wordIds.length - alive.length
      fixedGroups++
      if (alive.length === 0) broken.push(g.name)
      await wordStore.updateGroup(g.id, { wordIds: alive })
    }
    void byWord   // 暂时用不到，见下面说明

    relinkMsg.value = fixedGroups
      ? `清掉 ${dropped} 个失效引用，涉及 ${fixedGroups} 个词表。` +
        (broken.length ? `其中「${broken.slice(0, 3).join('、')}」已经一个词都不剩，需要重新导入。` : '')
      : '所有词表的引用都是好的，不用修。'
  } catch (e) {
    relinkMsg.value = '检查出错：' + (e instanceof Error ? e.message : String(e))
  } finally {
    relinking.value = false
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
    /**
     * 回写释义库时要带上全部七项。
     *
     * 之前只回写了考纲/话题/词根/词族四项 —— 释义、音标、例句只进了
     * data/words.json 这个缓存。而 resources/word_explanations/ 才是准，
     * 下次重扫或重建缓存就把缓存里那份盖回去了，
     * 表现出来就是「跑完一千七百多，刷新一下数字一点没变」，白跑。
     *
     * meanings 要转成释义库的 pos_definitions 结构（pos / definition_zh /
     * definition_en），字段名对不上就等于没写。
     */
    await be.bePatchWordLibrary(changed.map(w => ({
      word: w.word,
      exam_tags: w.tags,
      topics: w.topics,
      morphemes: w.morphemes,
      word_family: w.word_family,
      phonetic: w.phonetic,
      pos_definitions: (w.meanings || []).map(m => ({
        pos: m.partOfSpeech || '',
        definition_zh: m.chinese || '',
        definition_en: (m as any).english || ''
      })),
      example_sentences: w.example_sentences || []
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
const showRedo = ref(false)
const redoFields = ref<EnrichField[]>([])

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

/**
 * 这里原来有 canBackfillTags：判断一个词能不能靠分组关系推出考纲标签，
 * 能推的就不送给 AI（省一次请求）。
 * 回填功能撤掉之后这个"能推"不再成立 —— 分组推出来的标签本身就不全，
 * 让它挡住 AI 补全等于让这些词的来源永远残缺。现在一律交给 AI。
 */

const aiPreviewLive = computed(() =>
  previewAiEnrich(aiTargets.value, aiForce.value, DEFAULT_BATCH_SIZE)
)
const aiPreviewFrozen = ref<ReturnType<typeof previewAiEnrich> | null>(null)
watch(aiRunning, run => { aiPreviewFrozen.value = run ? aiPreviewLive.value : null })
const aiPreview = computed(() => aiPreviewFrozen.value || aiPreviewLive.value)
const needAiCount = computed(() => countNeedAiEnrich(aiTargets.value, aiForce.value))
const aiPercent = computed(() =>
  aiProgress.value.total ? Math.round((aiProgress.value.done / aiProgress.value.total) * 100) : 0
)

/** 补缺：范围内缺字段的词，只补缺的那几项。跟重跑互不影响 */
async function startAi() {
  await startAiRun({
    targets: aiTargets.value,
    force: aiForce.value,
    onBatchDone: persist
  })
  if (aiRunState.errorMsg.value) tidyMsg.value = `AI 补全出错：${aiRunState.errorMsg.value}`
}

/**
 * 重跑：范围内**所有**词的指定几项，覆盖已有值。
 *
 * 单独一个动作、单独一个按钮 —— 它跟「开始补全」的取词范围和写入规则都不一样，
 * 共用一个按钮的话，勾没勾复选框会让同一个按钮做两件事，很容易误操作。
 */
async function startRedo() {
  const fields = [...redoFields.value]
  if (!fields.length) return
  const names = ENRICH_FIELD_LABELS.filter(f => fields.includes(f.key)).map(f => f.label).join('、')
  if (!confirm(`把范围内 ${aiTargets.value.length} 个词的「${names}」全部重跑一遍？\n现有的值会被新结果覆盖。`)) return
  await startAiRun({
    targets: aiTargets.value,
    redo: fields,
    onBatchDone: persist
  })
  if (aiRunState.errorMsg.value) tidyMsg.value = `重跑出错：${aiRunState.errorMsg.value}`
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

const armedColor = ref('')

/**
 * 色卡本体。持久化，划线和词汇宇宙共用同一组。
 *
 * 之前这里是个 computed：把"本次取色的结果"和"当前维度已用的颜色"拼起来，
 * 刷新就没、也改不了。现在是实打实的一组色，存 localStorage，
 * 可以逐个改、逐个删、也能从图片补进来。
 */
const paletteColors = ref<string[]>(readPalette())
const palEditing = ref(false)

function palSet(i: number, hex: string) {
  const next = [...paletteColors.value]
  next[i] = hex
  paletteColors.value = next
  savePalette(next)
}
function palDel(i: number) {
  const next = paletteColors.value.filter((_, k) => k !== i)
  paletteColors.value = next
  savePalette(next)
}
/** 把上膛的颜色染到划线自定义色上，并切过去用它 */
function dyeHighlight() {
  if (!armedColor.value) return
  customHl.value = armedColor.value
  defaultHl.value = 'custom'
  armedColor.value = ''
}

function palAdd() {
  const next = [...paletteColors.value, '#8fb0c9']
  paletteColors.value = next
  savePalette(next)
}
const palSets = ref(listPaletteSets())
const palSetName = ref('')
const palNewName = ref('')

function loadPalSet() {
  const hit = palSets.value.find(p => p.name === palSetName.value)
  if (!hit) return
  paletteColors.value = [...hit.colors]
  savePalette(hit.colors)
}
function doSavePalSet() {
  const name = palNewName.value.trim()
  if (!name) return
  savePaletteSet(name, paletteColors.value)
  palSets.value = listPaletteSets()
  palSetName.value = name
  palNewName.value = ''
}
function doDelPalSet() {
  if (!palSetName.value) return
  deletePaletteSet(palSetName.value)
  palSets.value = listPaletteSets()
  palSetName.value = ''
}

function palReset() {
  resetPalette()
  paletteColors.value = readPalette()
}
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
    const cols = ensureVisibleOnDark(await extractPaletteFromImage(file))
    // 并进色卡而不是替换：换一张图取色时，上一张里挑中的色不该凭空消失
    paletteColors.value = mergeIntoPalette(cols)
    paletteMsg.value = `取到 ${cols.length} 个颜色，已并进色卡。点色块上膛，再点要染色的地方。`
  } catch (err) {
    paletteMsg.value = err instanceof Error ? err.message : '取色失败'
  } finally {
    paletteBusy.value = false
  }
}


function doApplyPalette() {
  applyPalette(colorDim.value, colorKeys.value.map(k => k.key), paletteColors.value)
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
.fix-toggle {
  border: none; background: none; cursor: pointer;
  color: var(--r-ink2, #9aa0a6); font-size: 13px; padding: 6px 0;
  &:hover { color: var(--r-ink, #1f2328); }
}
.db-info {
  margin: 10px 0 0; padding: 10px 12px; border-radius: 8px;
  background: var(--r-ui, #f4f5f7); color: var(--r-ink2, #5b6570);
  font: 12.5px/1.7 ui-monospace, Consolas, monospace; white-space: pre-wrap;
}
.dict-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dict-bar .tw-select { flex: 1; min-width: 220px; }
.tw-select { width: 100%; max-width: 420px; padding: 7px 10px; border: 1px solid var(--r-border, #e5e7eb); border-radius: 8px; background: var(--r-paper, #fff); color: var(--r-ink, #1f2328); }
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
.hl-picker { display: flex; gap: 7px; }
.hl-dot {
  width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
  border: 1px solid rgba(0, 0, 0, .12);
}
.hl-dot.on { box-shadow: 0 0 0 2px var(--r-paper, #fff), 0 0 0 3.5px var(--r-accent, #8a4b3a); }
.hl-input { width: 46px; height: 28px; border: 1px solid var(--r-border, #e5e7eb); border-radius: 6px; cursor: pointer; }

.rm-new { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rm-input {
  flex: 1; min-width: 180px; padding: 6px 10px; font-family: inherit; font-size: 13px;
  border: 1px solid var(--r-line, #e5e7eb); border-radius: 8px; background: transparent;
  color: var(--r-ink, #1f2328);
}
.rm-num {
  width: 64px; padding: 6px 8px; font-family: inherit; font-size: 13px;
  border: 1px solid var(--r-line, #e5e7eb); border-radius: 8px; background: transparent;
  color: var(--r-ink, #1f2328);
}
.redo-toggle {
  border: none; background: none; padding: 0; margin-top: 8px;
  cursor: pointer; font-family: inherit; font-size: 12.5px;
  color: var(--r-accent, #8a4b3a);
  &:hover { text-decoration: underline; }
}
.redo-box {
  margin-top: 8px; padding: 10px 12px;
  border: 1px solid var(--r-border, #e6e6e6); border-radius: 10px;
  display: flex; flex-wrap: wrap; gap: 10px 16px;
}
.redo-item { display: flex; align-items: center; gap: 5px; font-size: 13px; }
.redo-note {
  flex-basis: 100%; margin: 2px 0 0;
  font-size: 12px; line-height: 1.6; color: var(--r-ink2, #9aa0a6);
}
.redo-actions {
  flex-basis: 100%; display: flex; align-items: center; gap: 12px;
  margin-top: 4px;
}
.redo-actions .redo-note { flex: 1; margin: 0; }
.pal-edit {
  position: relative; display: inline-flex;
  input[type="color"] {
    width: 26px; height: 26px; padding: 0; border: none;
    border-radius: 7px; cursor: pointer; background: none;
  }
}
.pal-x {
  position: absolute; right: -4px; top: -5px;
  width: 14px; height: 14px; line-height: 12px; text-align: center;
  border: none; border-radius: 50%; cursor: pointer;
  background: var(--r-ink2, #9aa0a6); color: #fff; font-size: 11px; padding: 0;
}
.pal-edit-btn {
  margin-left: auto; border: none; background: none; cursor: pointer;
  font-family: inherit; font-size: 12px; color: var(--r-accent, #8a4b3a);
  &:hover { text-decoration: underline; }
}
.hl-dot.custom { outline: 1.5px dashed var(--r-border, #d5d5d5); outline-offset: 2px; }
.hl-dot.custom.armed { outline-color: var(--r-accent, #8a4b3a); }
.ghost-btn.tiny { padding: 3px 9px; font-size: 12px; border-radius: 7px; }
.dim-head {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 18px; padding-top: 14px;
  border-top: 1px solid var(--r-border, #eee);
}
.dim-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.dim-tab {
  border: 1px solid var(--r-border, #e0e0e0); background: transparent;
  border-radius: 8px; padding: 4px 11px; cursor: pointer;
  font-family: inherit; font-size: 12.5px; color: var(--r-ink2, #777);
  &.on {
    background: var(--r-accent, #8a4b3a); border-color: var(--r-accent, #8a4b3a); color: #fff;
  }
}
.armed-tip { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; }
.armed-dot {
  display: inline-block; width: 13px; height: 13px; border-radius: 4px;
  vertical-align: middle;
}
.palette-row.sets { margin-top: 8px; gap: 8px; }
.pal-select, .pal-name-input {
  border: 1px solid var(--r-border, #e0e0e0); border-radius: 8px;
  padding: 4px 8px; font-family: inherit; font-size: 12.5px;
  background: transparent; color: var(--r-ink, #1f2328);
}
.pal-name-input { width: 150px; }
.link-btn {
  border: none; background: none; padding: 0; cursor: pointer;
  font-family: inherit; font-size: inherit; color: var(--r-accent, #8a4b3a);
  &:hover { text-decoration: underline; }
}
.dirty-box {
  margin-top: 10px; padding: 10px 12px;
  border: 1px solid var(--r-border, #eee); border-radius: 10px;
}
.dirty-note { margin: 0 0 8px; font-size: 12px; line-height: 1.6; color: var(--r-ink2, #888); }
.dirty-list { display: flex; flex-wrap: wrap; gap: 6px; }
.dirty-chip {
  padding: 2px 8px; border-radius: 6px; font-size: 12px;
  background: var(--r-ui, #f4f5f7); color: var(--r-ink2, #777);
}
.dirty-acts { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.dirty-warn { font-size: 12px; color: var(--r-ink2, #9aa0a6); }
</style>
