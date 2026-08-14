<template>
  <div class="reading">
    <div class="reader-wrap">

    <div v-if="article" class="article-view">
      <button class="back-to-list" @click="readerStore.selectArticle(null)">← 返回文章列表</button>

      <div v-if="article.chapters?.length" class="chapter-toc" :class="{ folded: tocFolded }">
        <button class="toc-fold" @click="tocFolded = !tocFolded">
          {{ tocFolded ? `目录 ${article.chapters.length}` : '收起 ›' }}
        </button>
        <div v-if="!tocFolded" class="toc-scroll">
          <button
            v-for="ch in article.chapters"
            :key="ch.sentenceIndex"
            class="toc-row"
            :class="{ on: activeChapter === ch.sentenceIndex }"
            :title="ch.title"
            @click="jumpToChapter(ch.sentenceIndex)"
          >{{ ch.title }}</button>
        </div>
      </div>

      <div class="title-row">
        <input
          v-if="editingTitle"
          v-model="titleDraft"
          class="title-edit-input"
          @blur="saveTitle"
          @keyup.enter="saveTitle"
        />
        <h2 v-else class="article-title" @click="startEditTitle">{{ article.title }}</h2>
        <button v-if="!editingTitle" class="title-edit-btn" title="重命名" @click="startEditTitle">
          <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button class="title-bookmark-btn" :class="{ on: article.bookmarked }" title="标为正在看/要看" @click="toggleBookmark(article)">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z"/></svg>
        </button>
        <button class="title-completed-btn" :class="{ on: article.completed }" title="标为已学完" @click="toggleCompleted(article)">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
        </button>
      </div>
      <p class="meta">共 {{ article.sentences.length }} 句 · {{ englishWordCount }} 词</p>

      <div class="toolbar">
        <div class="seg">
          <button v-for="l in layouts" :key="l.value" class="seg-btn" :class="{ on: layout === l.value }" @click="layout = l.value">{{ l.label }}</button>
        </div>
        <button class="ghost-btn" @click="showChinese = !showChinese">{{ showChinese ? '隐藏中文' : '显示中文' }}</button>
        <button class="ghost-btn" :class="{ on: viewSubMode === 'recite' }" title="隐藏英文，看中文/笔记尝试用英语复述" @click="toggleReciteMode">复述练习（隐藏英文）</button>
        <button class="ghost-btn" :class="{ on: viewSubMode === 'shadow' }" :title="speechSupported ? '' : '需要 Chrome/Edge 浏览器'" @click="viewSubMode = viewSubMode === 'shadow' ? 'read' : 'shadow'">跟读模式</button>
      </div>

      <div v-if="article.needsCleanup" class="cleanup-banner">
        <span>检测到这篇内容可能是中英文混杂的口播转录稿（如"沉浸式背单词"类材料），语法和断句可能比较混乱，可以去右下角悬浮面板"文章操作"里点"AI整理成清晰文章"。</span>
      </div>

      <audio
        v-show="viewSubMode === 'audioAlign' && audioObjectUrl"
        ref="audioEl"
        :src="audioObjectUrl"
        controls
        class="align-audio-player"
      ></audio>

      <div v-if="viewSubMode === 'recite'" class="recite-panel">
        <p class="recite-hint">
          一句一句来：看中文（和笔记）用英语把这句复述出来，可以打字也可以点这句后面的录音钮说出来。
          全篇写完再点"AI打分"，AI 是拿整篇一起看的（复述本来就该看整体连不连贯）。
        </p>

        <div class="recite-list">
          <div class="recite-item" v-for="(s, i) in article.sentences" :key="i">
            <div class="recite-idx">{{ i + 1 }}</div>
            <div class="recite-body">
              <p class="recite-item-cn" v-if="showChinese">{{ s.zh || '（暂无译文）' }}</p>
              <p class="recite-item-en" v-if="showOriginal">{{ s.en }}</p>
              <div class="recite-item-input">
                <textarea
                  v-model="reciteDrafts[i]"
                  class="recite-input"
                  rows="2"
                  :placeholder="`用英语说出第 ${i + 1} 句…`"
                  @blur="saveReciteDrafts"
                ></textarea>
                <button
                  v-if="speechSupported"
                  class="ghost-btn small"
                  :class="{ on: reciteRecordingIdx === i }"
                  :title="reciteRecordingIdx === i ? '停止录音' : '录这一句'"
                  @click="toggleReciteRecording(i)"
                >{{ reciteRecordingIdx === i ? '停止' : '录音' }}</button>
              </div>
            </div>
          </div>
        </div>

        <div class="recite-actions">
          <button class="ghost-btn" @click="showOriginal = !showOriginal">{{ showOriginal ? '隐藏原文对照' : '对照原文' }}</button>
          <span class="recite-progress">已写 {{ reciteFilledCount }} / {{ article.sentences.length }} 句</span>
          <button class="dark-btn" :disabled="reciteScoring || !aiReady || !reciteJoined.trim()" :title="aiReady ? '' : '请先点右下角悬浮按钮配置 API Key'" @click="scoreRecite">
            {{ reciteScoring ? 'AI打分中…' : 'AI打分' }}
          </button>
        </div>

        <div v-if="legacyReciteDraft" class="recite-legacy">
          <h4>改版前你写的整篇旧稿（只读保留）</h4>
          <pre>{{ legacyReciteDraft }}</pre>
        </div>

        <div v-if="reciteFeedback" class="recite-feedback">
          <h4>AI 反馈</h4>
          <pre>{{ reciteFeedback }}</pre>
        </div>
      </div>

      <div v-else-if="viewSubMode === 'shadow'" class="shadow-panel">
        <p v-if="!speechSupported" class="hint">当前浏览器不支持语音识别（需要 Chrome / Edge），仍可播放原音跟读，只是没有自动打分。</p>
        <p v-if="alignedCount > 0" class="hint">已对轴 {{ alignedCount }}/{{ article.sentences.length }} 句，这些句子播放的是关联的真实音频，其余句子还是 TTS 合成音</p>

        <div v-if="alignedCount > 0" class="shadow-bar">
          <button class="dark-btn small" @click="toggleContinuous">
            {{ continuousOn ? '暂停连读' : '连续播放' }}
          </button>
          <label class="sb-item">
            速度
            <select v-model.number="shadowRate" class="sb-sel">
              <option :value="0.6">0.6x</option>
              <option :value="0.75">0.75x</option>
              <option :value="1">1.0x</option>
              <option :value="1.25">1.25x</option>
            </select>
          </label>
          <label class="sb-item">
            <input v-model="shadowLoopOne" type="checkbox" /> 单句循环
          </label>
          <label class="sb-item">
            句间停顿
            <select v-model.number="shadowGap" class="sb-sel">
              <option :value="0">无</option>
              <option :value="1">1 秒</option>
              <option :value="2">2 秒</option>
              <option :value="-1">跟句子等长（留出跟读时间）</option>
            </select>
          </label>
        </div>

        <div
          class="shadow-item"
          v-for="(s, i) in article.sentences"
          :key="i"
          :class="{ playing: playingIdx === i }"
          :ref="el => setShadowRowRef(el, i)"
        >
          <div class="shadow-en">
            <span>{{ s.en }}</span>
            <span v-if="s.audioStart != null" class="shadow-real-audio-tag">原声</span>
            <button class="icon-btn" @click="playSentenceSmart(i)">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
            </button>
          </div>
          <div class="shadow-controls">
            <button
              v-if="speechSupported"
              class="ghost-btn small"
              :class="{ on: shadowRecordingIdx === i }"
              @click="toggleShadowRecording(i, s.en)"
            >{{ shadowRecordingIdx === i ? '停止' : '开始跟读' }}</button>
            <span v-if="shadowResults[i]" class="shadow-score" :class="scoreClass(shadowResults[i].score)">{{ shadowResults[i].score }} 分</span>
            <span v-if="shadowResults[i]" class="shadow-heard">你说的：{{ shadowResults[i].text || '（未识别到内容）' }}</span>
          </div>
        </div>
      </div>

      <div v-else-if="viewSubMode === 'audioAlign'" class="align-panel">
        <p class="hint">
          自动把音频切成一句一句需要跑语音识别模型（WhisperX 那类），纯网页做不到；这里是手动对轴——
          放音频，听到一句话开始的地方就点它前面的"标记开始"，做完整篇之后跟读模式就能放真人原声了，不用 TTS 合成音。
        </p>
        <div class="align-audio-row" v-if="!article.audioFileName">
          <button class="dark-btn" :disabled="alignLoading" @click="doPickAudio">{{ alignLoading ? '选择中…' : '选择音频文件' }}</button>
          <label class="ghost-btn" :class="{ disabled: videoBusy }">
            {{ videoBusy ? videoProgress : '拖入 / 选择视频' }}
            <input type="file" accept="video/*" hidden :disabled="videoBusy" @change="onPickVideo" />
          </label>
          <span class="hint">音频 mp3/m4a/wav；视频会在本机抽出音轨，原视频不保存</span>
        </div>
        <div class="align-audio-row" v-else>
          <span class="lib-status">已关联「{{ article.audioFileName }}」</span>
          <button class="ghost-btn small" @click="doPickAudio">换一个</button>
          <button class="ghost-btn small" @click="doClearAudio">取消关联</button>
        </div>
        <p v-if="alignMessage" class="err-text">{{ alignMessage }}</p>

        <div class="align-audio-row">
          <label class="ghost-btn">
            导入字幕自动对轴
            <input type="file" accept=".srt,.vtt,.txt" hidden @change="onPickSubtitle" />
          </label>
          <span class="hint">.srt / .vtt。视频自带字幕的话这一步最准，几秒钟搞定整篇</span>
        </div>
        <div class="align-audio-row" v-if="article.audioUrl">
          <button class="ghost-btn" :disabled="asrBusy" @click="doTranscribe">
            {{ asrBusy ? '转写中…（几分钟）' : '没有字幕？自动转写' }}
          </button>
          <span class="hint">在本机跑语音识别，音频不出这台电脑；一小时音频约十几分钟</span>
        </div>
        <p v-if="subMessage" class="lib-status">{{ subMessage }}</p>

        <div v-if="audioObjectUrl" class="align-list">
          <p class="hint">已对轴 {{ alignedCount }}/{{ article.sentences.length }} 句</p>
          <div class="align-item" v-for="(s, i) in article.sentences" :key="i" :class="{ current: alignCursor === i, done: s.audioStart != null }">
            <span class="align-idx">{{ i + 1 }}</span>
            <span class="align-text">{{ s.en }}</span>
            <span v-if="s.audioStart != null" class="align-time" @click="jumpAudioTo(s.audioStart)">{{ s.audioStart.toFixed(1) }}s</span>
            <button class="ghost-btn small" @click="markSentenceStart(i)">标记开始</button>
          </div>
          <button class="ghost-btn small" @click="markLastSentenceEnd">最后一句到此结束（标到音频末尾）</button>
        </div>
      </div>

      <div v-else class="content" :class="`layout-${layout}`" @mouseup="onTextSelected">
        <template v-if="layout === 'sentence'">
          <div class="sentence-row" :id="`sent-${i}`" v-for="(s, i) in article.sentences" :key="i">
            <div v-if="showEnglish" class="en"><ClickableSentence :text="s.en" :sent-idx="i" :marks="marksForSentence(i)" @token-click="onTokenClick" /></div>
            <p v-if="showChinese" class="zh zh-clickable" @click="onZhSentenceClick(i, $event)"><ZhMarked :text="s.zh || '（暂无译文）'" :marks="zhMarksForSentence(i)" /></p>
          </div>
        </template>
        <template v-else-if="layout === 'split'">
          <div class="split-row" v-for="(s, i) in article.sentences" :key="i">
            <div v-if="showEnglish" class="en"><ClickableSentence :text="s.en" :sent-idx="i" :marks="marksForSentence(i)" @token-click="onTokenClick" /></div>
            <p v-else class="en-placeholder"></p>
            <p v-if="showChinese" class="zh zh-clickable" @click="onZhSentenceClick(i, $event)"><ZhMarked :text="s.zh || '（暂无译文）'" :marks="zhMarksForSentence(i)" /></p>
            <p v-else class="zh-placeholder"></p>
          </div>
        </template>
        <template v-else>
          <div v-if="showEnglish" class="block en">
            <ClickableSentence
              v-for="(s, i) in article.sentences"
              :key="i"
              :text="s.en + ' '"
              :sent-idx="i"
              :marks="marksForSentence(i)"
              @token-click="onTokenClick"
              tag="span"
            />
          </div>
          <div v-if="showChinese" class="block zh">
            <span v-for="(s, i) in article.sentences" :key="'bz' + i" class="zh-clickable" @click="onZhSentenceClick(i, $event)"><ZhMarked :text="s.zh" :marks="zhMarksForSentence(i)" /></span>
          </div>
        </template>
      </div>

      <div v-if="markMenu" class="mark-menu" :style="{ left: markMenu.x + 'px', top: markMenu.y + 'px' }">
        <div class="mm-row">
          <span
            v-for="c in HL_COLORS"
            :key="c.name"
            class="color-dot"
            :style="{ background: c.hex }"
            @click="confirmMark(c.name)"
          ></span>
          <button @click="copySelection">复制</button>
          <button @click="analyzeSentenceGrammar" :disabled="!aiReady" :title="aiReady ? '' : '请先在设置里配置 API Key'">语法分析</button>
        </div>
      </div>

      <div v-if="editMarkMenu" class="mark-menu" :style="{ left: editMarkMenu.x + 'px', top: editMarkMenu.y + 'px' }">
        <div class="mm-row">
          <span
            v-for="c in HL_COLORS"
            :key="c.name"
            class="color-dot"
            :style="{ background: c.hex }"
            @click="setMarkColor(editMarkMenu.markId, c.name); editMarkMenu = null"
          ></span>
          <button class="mm-danger" @click="deleteMark(editMarkMenu.markId)">删除</button>
        </div>
      </div>
      <div v-if="markMenu || editMarkMenu" class="menu-mask" @click="closeFloatingMenus"></div>

      <div v-if="sectionSplitPrompt" class="save-vocab-overlay" @click.self="sectionSplitPrompt = null">
        <div class="save-vocab-box section-split-box">
          <p class="svb-word">"{{ sectionSplitPrompt.file.name }}" 里识别到 {{ sectionSplitPrompt.sections.length }} 个章节</p>
          <p class="s-label">拆开导入会存成 {{ sectionSplitPrompt.sections.length }} 篇文章，自动归到一个新分组；整篇导入还是跟以前一样存成一篇。识别不一定100%准，存完可以在文章列表里删掉/合并多余的。</p>
          <div class="section-chip-list">
            <span v-for="s in sectionSplitPrompt.sections" :key="s.title" class="section-chip">{{ s.title }}</span>
          </div>
          <div class="svb-actions">
            <button class="ghost-btn" @click="confirmWholeImport">整篇导入</button>
            <button class="dark-btn" @click="confirmSplitImport">拆成 {{ sectionSplitPrompt.sections.length }} 篇导入</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="article && sidePanelOpen" class="side-panel">
      <div class="side-panel-body" :style="sidePanelWidth ? { width: sidePanelWidth + 'px', maxWidth: 'none' } : {}">
        <div class="side-resizer" title="拖动调整宽度" @mousedown="onSideResizeDown"></div>
        <div class="side-resize-handle" title="拖动调整宽度" @mousedown="onSideResizeDown"></div>
        <div class="side-body-scroll">
          <section class="notes-box">
            <div v-if="chapterCount > 1" class="notes-pager">
              <button class="np-btn" :disabled="chapterPage <= 0" @click="gotoNotePage(chapterPage - 1)">‹</button>
              <select v-model.number="chapterPage" class="np-sel">
                <option v-for="(ch, i) in article.chapters" :key="i" :value="i">
                  第 {{ i + 1 }}/{{ chapterCount }} 页 · {{ ch.title }}
                </option>
              </select>
              <button class="np-btn" :disabled="chapterPage >= chapterCount - 1" @click="gotoNotePage(chapterPage + 1)">›</button>
            </div>
            <div
              ref="notesEditorEl"
              class="notes-area"
              contenteditable="true"
              data-placeholder="可手动记录笔记，点上面「AI生成」，或在正文里划线——划到的内容会自动整理到这里，点里面的词能跳回原文位置"
              @input="onNotesInput"
              @blur="saveNotes"
              @click="onNotesAreaClick"
            ></div>

            <div class="vocab-target-row">
              <button class="vocab-target-toggle" @click="showVocabTargetPicker = !showVocabTargetPicker">
                生词收进：<strong>{{ effectiveVocabBookName }}</strong>{{ article.vocabBookId ? '（手动指定）' : '（跟文件夹同名，自动）' }} · 改
              </button>
            </div>
            <div v-if="showVocabTargetPicker" class="vocab-target-picker">
              <select
                class="s-select"
                :value="article.vocabBookId || '__auto__'"
                @change="onVocabTargetSelect(($event.target as HTMLSelectElement).value)"
              >
                <option value="__auto__">自动（跟文件夹同名）</option>
                <option v-for="g in topLevelVocabBooks" :key="g.id" :value="g.id">{{ g.name }}</option>
                <option value="__new__">新建词书…</option>
              </select>
              <template v-if="vocabTargetNewName !== null">
                <input v-model="vocabTargetNewName" class="s-input" placeholder="新词书名称" @keyup.enter="confirmVocabTargetNew" />
                <button class="ghost-btn small" @click="confirmVocabTargetNew">确定</button>
              </template>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div v-if="batchMessage" class="lb-toast" @click="batchMessage = ''">{{ batchMessage }}</div>

    <aside v-if="!article" class="article-list-view">
      <div class="list-toolbar">
        <input v-model="articleSearch" class="list-search" placeholder="搜索标题或正文…" />
        <select v-model="groupFilter" class="list-select">
          <option value="all">全部分组（{{ readerStore.articles.length }}）</option>
          <option value="none">未分组（{{ ungroupedCount }}）</option>
          <option v-for="g in readerStore.groups" :key="g.id" :value="g.id">{{ g.name }}（{{ groupCount(g.id) }}）</option>
        </select>
        <button class="ghost-btn" @click="showNewGroupInput = !showNewGroupInput">新建分组</button>
        <button class="ghost-btn" v-if="!selectMode" @click="selectMode = true">选择模式</button>
        <button class="ghost-btn" :disabled="restoringFromBackend" :title="restoreMessage" @click="doRestoreFromBackend">
          {{ restoringFromBackend ? '恢复中…' : '从后端恢复' }}
        </button>
        <button class="dark-btn" @click="showImportPanel = !showImportPanel">{{ showImportPanel ? '收起导入' : '+ 新建/导入文章' }}</button>
      </div>
      <p v-if="restoreMessage" class="restore-message">{{ restoreMessage }}</p>
      <div v-if="showNewGroupInput" class="new-group-row">
        <input v-model="newGroupName" placeholder="分组名称，比如「小红书沉浸式背单词」" @keyup.enter="doCreateGroup" />
        <button class="ghost-btn small" @click="doCreateGroup">创建</button>
      </div>

      <div v-if="showImportPanel" class="import-panel">
        <textarea
          v-model="pasteText"
          class="paste-area"
          placeholder="粘贴文章内容（纯英文，或按行/按段落交替的中英对照文本）"
        ></textarea>
        <div class="import-row">
          <input v-model="pasteTitle" class="title-input" placeholder="文章标题（可选）" />
          <select v-model="pasteGroupId" class="list-select">
            <option value="">不分组</option>
            <option v-for="g in readerStore.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
        <div class="import-row">
          <label class="file-btn">
            {{ importingFile ? '正在解析文件…' : '选择文件（可多选批量导入）' }}
            <input type="file" multiple :accept="SUPPORTED_ARTICLE_EXTS" hidden :disabled="importingFile" @change="onFilePick" />
          </label>
          <span class="hint">支持 TXT / MD / HTML / DOCX / PDF（分栏排版的PDF提取顺序可能错乱），批量导入会归到上面选的分组</span>
        </div>
        <div class="import-row">
          <input v-model="urlInput" class="url-input" placeholder="或输入网址抓取正文…" @keyup.enter="fetchUrl" />
          <button class="dark-btn" :disabled="fetchingUrl" @click="fetchUrl">{{ fetchingUrl ? '抓取中…' : '抓取网页' }}</button>
        </div>
        <p v-if="urlError" class="err-text">{{ urlError }}</p>
        <button class="start-btn" :disabled="!pasteText.trim()" @click="createFromPaste">导入并开始学习</button>
      </div>

      <div v-if="selectedIds.size" class="batch-bar">
        <span>已选 {{ selectedIds.size }} 篇</span>
        <select v-model="batchMoveTarget" class="list-select">
          <option value="">移动到…</option>
          <option value="none">未分组</option>
          <option v-for="g in readerStore.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <button class="ghost-btn small" :disabled="!batchMoveTarget" @click="doBatchMove">移动</button>
        <button class="ghost-btn small" :disabled="batchCleaning" @click="doBatchCleanup(allSelectedTidied)">
          {{ batchCleaning ? `批量整理中 ${batchCleanProgress}…` : batchCleanLabel }}
        </button>
        <button v-if="batchCleaning" class="ghost-btn small" title="卡住了点这里" @click="unstickBatch">解除卡住</button>
        <button class="ghost-btn small danger" @click="doBatchDelete">删除选中</button>
        <button class="ghost-btn small" @click="selectedIds.clear()">取消选择</button>
      </div>

      <div v-if="selectMode" class="select-mode-bar">
        <span>选择模式</span>
        <button class="ghost-btn small" @click="selectAll">全选（当前列表 {{ filteredArticles.length }} 篇）</button>
        <button class="ghost-btn small" @click="exitSelectMode">完成（退出选择模式）</button>
      </div>
      <div class="article-list" :class="{ selecting: selectMode }">
        <div
          class="article-row"
          v-for="a in filteredArticles"
          :key="a.id"
          :class="{ sel: selectedIds.has(a.id), completed: a.completed, cleaning: cleaningOneId === a.id }"
          :style="cleaningOneId === a.id ? { '--clean-pct': cleanPct } : undefined"
          @pointerdown="onRowPointerDown(a.id, $event)"
        >
          <div class="a-lead">
            <input
              v-if="selectMode"
              type="checkbox"
              :checked="selectedIds.has(a.id)"
              @click.stop="onRowClick(a.id, $event)"
            />
            <span v-else class="a-lead-ph"></span>
            <button class="a-bookmark" :class="{ on: a.bookmarked }" title="标为正在看/要看（会置顶）" @click.stop="toggleBookmark(a)">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z"/></svg>
            </button>
            <button class="a-completed" :class="{ on: a.completed }" title="标为已学完" @click.stop="toggleCompleted(a)">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
            </button>
          </div>
          <template v-if="editingListTitleId === a.id">
            <input
              v-model="editingListTitleDraft"
              class="a-title-edit"
              autofocus
              @click.stop
              @pointerdown.stop
              @blur="saveListTitle(a)"
              @keyup.enter="saveListTitle(a)"
              @keyup.esc="cancelListTitleEdit"
            />
            <button class="a-rename-confirm" @click.stop="saveListTitle(a)">✓</button>
            <button class="a-rename-cancel" @click.stop="cancelListTitleEdit">✕</button>
          </template>
          <span
            v-else
            class="a-title"
            @click="selectMode ? onRowClick(a.id, $event) : openArticle(a.id)"
          >{{ a.title }}</span>
          <button v-if="editingListTitleId !== a.id" class="a-rename" title="重命名" @click.stop="startListTitleEdit(a)">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <div class="a-tail">
            <span class="a-flag" :class="{ ghost: !a.needsCleanup }">{{ a.needsCleanup ? '待整理' : '' }}</span>
            <span class="a-meta">{{ a.sentences.length }} 句</span>
            <button class="a-export" title="导出这一篇" @click.stop="exportOne(a)">导出</button>
            <button
              class="a-cleanup"
              :disabled="!!cleaningOneId"
              :title="a.needsCleanup ? 'AI 整理这一篇' : '重新整理这一篇'"
              @click.stop="cleanupOne(a)"
            >{{ a.needsCleanup ? '整理' : '重新整理' }}</button>
            <button class="a-del" @click.stop="removeArticle(a.id)">删除</button>
          </div>
        </div>
        <p v-if="!filteredArticles.length" class="empty-hint">
          {{ readerStore.articles.length ? '这个分组/搜索下没有文章' : '还没有文章，点上面"新建/导入文章"开始' }}
        </p>
      </div>
    </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, defineComponent, h, watch, nextTick } from 'vue'
import { useReaderStore } from './stores/readerStore'
import { useWordStore } from '@/shared/stores/wordStore'
import { playWord, playSentence } from '@/shared/core/audio'
import { detectBilingual, toEnglishOnlySentences, splitEnglishSentences, isNumberedHeading, isChineseOnly, toChineseOnlySentences, isStructuralLine } from '@/shared/core/textSplit'
import { askAi, AiError } from '@/shared/core/aiClient'
import { isAiConfigured } from '@/shared/core/aiSettings'
import { extractTextFromFile, extractDocxSections, stripHtml, SUPPORTED_ARTICLE_EXTS } from '@/shared/core/fileExtract'
import { stripTranscriptNoise, aiReorganizeTranscript, aiTranslateLines, aiTranslateToEnglish, aiOutlineChapters } from '@/shared/core/transcriptClean'
import { createRecognizer, speechRecognitionSupported } from '@/shared/core/speechRecognition'
import { similarityScore } from '@/shared/core/textSimilarity'
import type { Article, ArticleMark, ArticleChapter, ArticleSentence } from '@/shared/types/Article'
import type { WordItem } from '@/shared/types/WordItem'
import { setAgentSelectionContext, setArticleQuickActions, clearArticleQuickActions, setLastQuickActionResult, type ArticleQuickAction } from '@/shared/core/agentPanelState'
import { readingSidePanelOpen as sidePanelOpen, readingArticleTitle } from '@/shared/core/readingPanelState'
import * as be from '@/shared/core/backendClient'
import { pickArticleAudio, getArticleAudioFile, clearArticleAudio, audioPickerSupported } from '@/shared/core/audioAlign'
import { parseSubtitles, alignCuesToSentences } from '@/shared/core/subtitles'

function splitIntoWordTokens(segment: string, onWordClick: (text: string, event: MouseEvent) => void) {
  const tokens = segment.split(/(\s+|[.,!?;:"'()])/g).filter(t => t !== '')
  return tokens.map(t => {
    if (!/^[A-Za-z']+$/.test(t)) return t
    return h('span', { class: 'word-token', onClick: (e: MouseEvent) => onWordClick(t, e) }, t)
  })
}

function sliceOverlappingMarks(
  text: string,
  marksIn: { start: number; end: number; id: string; color: string }[]
): { start: number; end: number; mark: { start: number; end: number; id: string; color: string } | null }[] {
  const marks = marksIn.filter(m => m.end > m.start)
  if (!marks.length) return [{ start: 0, end: text.length, mark: null }]
  const points = new Set<number>([0, text.length])
  for (const m of marks) {
    points.add(Math.max(0, m.start))
    points.add(Math.min(text.length, m.end))
  }
  const sorted = [...points].sort((a, b) => a - b)
  const segments: { start: number; end: number; mark: typeof marks[0] | null }[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]
    const e = sorted[i + 1]
    if (e <= s) continue
    const covering = marks.filter(m => m.start <= s && m.end >= e)
    covering.sort((a, b) => (a.end - a.start) - (b.end - b.start))
    segments.push({ start: s, end: e, mark: covering[0] || null })
  }
  return segments
}

const ClickableSentence = defineComponent({
  props: {
    text: { type: String, required: true },
    tag: { type: String, default: 'p' },
    sentIdx: { type: Number, default: -1 },
    marks: { type: Array as () => { start: number; end: number; id: string; color: string }[], default: () => [] }
  },
  emits: ['token-click'],
  setup(props, { emit }) {
    return () => {
      const text = props.text
      const attrs = { 'data-sent-idx': props.sentIdx >= 0 ? props.sentIdx : undefined }
      try {
        const onWordClick = (t: string, event: MouseEvent) => emit('token-click', { text: t, isWord: true, markId: undefined, event })
        const children: any[] = []
        for (const seg of sliceOverlappingMarks(text, props.marks)) {
          const segText = text.slice(seg.start, seg.end)
          if (!seg.mark) {
            children.push(...splitIntoWordTokens(segText, onWordClick))
            continue
          }
          const m = seg.mark
          children.push(
            h(
              'span',
              { class: `reading-mark hl-${m.color}`, onClick: (e: MouseEvent) => emit('token-click', { text: segText, isWord: false, markId: m.id, event: e }) },
              segText
            )
          )
        }
        return h(props.tag, attrs, children)
      } catch (err) {
        console.error('ClickableSentence 渲染失败，退化成纯文本', err)
        return h(props.tag, attrs, text)
      }
    }
  }
})

const ZhMarked = defineComponent({
  props: {
    text: { type: String, required: true },
    marks: { type: Array as () => { id: string; color: string; zhText?: string }[], default: () => [] }
  },
  setup(props) {
    return () => {
      const precise = props.marks.filter(m => m.zhText && props.text.includes(m.zhText!))
      if (!precise.length) {
        return props.marks.length ? h('span', { class: `zh-marked hl-${props.marks[0].color}` }, props.text) : props.text
      }
      const found = precise
        .map(m => ({ idx: props.text.indexOf(m.zhText!), len: m.zhText!.length, color: m.color }))
        .filter(x => x.idx >= 0)
        .sort((a, b) => a.idx - b.idx)
      const segs: any[] = []
      let pos = 0
      for (const f of found) {
        if (f.idx < pos) continue // 跟前一段重叠就跳过，避免交叉高亮
        if (f.idx > pos) segs.push(props.text.slice(pos, f.idx))
        segs.push(h('span', { class: `reading-mark hl-${f.color}` }, props.text.slice(f.idx, f.idx + f.len)))
        pos = f.idx + f.len
      }
      if (pos < props.text.length) segs.push(props.text.slice(pos))
      return segs
    }
  }
})

const readerStore = useReaderStore()
const wordStore = useWordStore()

const aiReady = computed(() => isAiConfigured())

const SIDE_WIDTH_KEY = 'lb_side_panel_width'
const sidePanelWidth = ref<number | null>(null)
{
  const saved = Number(localStorage.getItem(SIDE_WIDTH_KEY))
  if (saved > 0) sidePanelWidth.value = saved
}
function onSideResizeDown(e: MouseEvent) {
  e.preventDefault()
  const startX = e.clientX
  const panelEl = (e.target as HTMLElement).closest('.side-panel-body') as HTMLElement | null
  const startWidth = sidePanelWidth.value ?? panelEl?.offsetWidth ?? 300
  const onMove = (ev: MouseEvent) => {
    sidePanelWidth.value = Math.min(860, Math.max(240, startWidth - (ev.clientX - startX)))
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    if (sidePanelWidth.value) localStorage.setItem(SIDE_WIDTH_KEY, String(sidePanelWidth.value))
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

const pasteText = ref('')
const pasteTitle = ref('')
const urlInput = ref('')
const urlError = ref('')
const fetchingUrl = ref(false)
const importingFile = ref(false)
const batchMessage = ref('')

function splitToSentences(raw: string, titleForCleanup: string): { sentences: ArticleSentence[]; looksLikeRawTranscript: boolean } {
  // 纯中文稿：没有英文可配对，按中文句号断句，英文一栏留空等翻译。
  // 不这么判的话会掉进英文分句器，整篇被当成一两个超长句。
  if (isChineseOnly(raw)) {
    return { sentences: toChineseOnlySentences(raw), looksLikeRawTranscript: true }
  }

  const direct = detectBilingual(raw)
  if (direct && direct.filter(x => x.zh).length * 2 >= direct.length) {
    return { sentences: direct, looksLikeRawTranscript: false }
  }

  const { text: cleaned, looksLikeRawTranscript } = stripTranscriptNoise(raw, titleForCleanup)
  const bilingual = detectBilingual(cleaned)
  const sentences = bilingual || toEnglishOnlySentences(cleaned)
  const parsedClean = !!bilingual && sentences.filter(x => x.zh).length * 2 >= sentences.length
  return { sentences, looksLikeRawTranscript: looksLikeRawTranscript && !parsedClean }
}

function splitMarkdownSections(text: string): { title: string; text: string }[] | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const heads: { level: number; idx: number; title: string }[] = []
  lines.forEach((l, i) => {
    const m = /^(#{1,4})\s+(.+?)\s*$/.exec(l)
    if (m) heads.push({ level: m[1].length, idx: i, title: m[2].trim() })
  })
  if (heads.length < 3) return splitNumberedSections(lines)
  const byLevel = new Map<number, number>()
  for (const h of heads) byLevel.set(h.level, (byLevel.get(h.level) || 0) + 1)
  let level = 2, best = 0
  for (const [lv, n] of byLevel) if (n > best) { best = n; level = lv }
  const marks = heads.filter(h => h.level === level)
  if (marks.length < 3) return null

  const out: { title: string; text: string }[] = []
  marks.forEach((h, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].idx : lines.length
    const body = lines.slice(h.idx + 1, end).join('\n').trim()
    if (!body) return
    if (isTocTitle(h.title)) return
    out.push({ title: h.title, text: stripLeadingToc(body, marks.map(x => x.title)) })
  })
  return out.length >= 3 ? out : null
}

/**
 * 没有 # 标题时的兜底：按「编号 + 英文题目」切章。
 * Word/PDF 导出的资料书常常整篇都是 Normal 样式，一个标题层级都没有，
 * 但正文里的 `1. Some people believe that…` 就是天然的章节分界。
 */
function splitNumberedSections(lines: string[]): { title: string; text: string }[] | null {
  const marks: number[] = []
  lines.forEach((l, i) => { if (isNumberedHeading(l)) marks.push(i) })
  if (marks.length < 3) return null
  const out: { title: string; text: string }[] = []
  marks.forEach((idx, i) => {
    const end = i + 1 < marks.length ? marks[i + 1] : lines.length
    const body = lines.slice(idx + 1, end).join('\n').trim()
    if (!body) return
    out.push({ title: lines[idx].trim().replace(/\s+/g, ' ').slice(0, 80), text: body })
  })
  return out.length >= 3 ? out : null
}

function isTocTitle(t: string): boolean {
  return /^\s*(目录|目\s*录|contents?|table of contents|索引|章节列表)\s*$/i.test(t)
}

function stripLeadingToc(body: string, allTitles: string[]): string {
  const norm = (t: string) => t.replace(/[\s\u3000·，,.。:：/、\-—]+/g, '').toLowerCase()
  const titleSet = new Set(allTitles.map(norm).filter(Boolean))
  const lines = body.split('\n')
  let i = 0
  let hits = 0
  while (i < lines.length) {
    const raw = lines[i].trim()
    if (!raw) { i++; continue }
    const key = norm(raw.replace(/^[-*+>\d.、]+\s*/, '').replace(/\\$/, ''))
    if (!key) { i++; continue }
    const isEntry = titleSet.has(key) || [...titleSet].some(t => t && (key.includes(t) || t.includes(key)) && Math.abs(t.length - key.length) < 6)
    if (isEntry || isTocTitle(raw)) { hits++; i++; continue }
    break
  }
  return hits >= 3 ? lines.slice(i).join('\n').trim() : body
}

function buildArticle(title: string, raw: string, source: string, sourceUrl?: string, groupId?: string): Article {
  const finalTitle = title || '未命名文章'
  const secs = splitMarkdownSections(raw)
  const sentences: ArticleSentence[] = []
  const chapters: ArticleChapter[] = []
  let needsCleanup = false

  if (secs && secs.length >= 2) {
    for (const sec of secs) {
      chapters.push({ title: sec.title, sentenceIndex: sentences.length })
      const r = splitToSentences(sec.text, sec.title)
      sentences.push(...r.sentences)
      if (r.looksLikeRawTranscript) needsCleanup = true
    }
  } else {
    const r = splitToSentences(raw, finalTitle)
    sentences.push(...r.sentences)
    needsCleanup = r.looksLikeRawTranscript
  }

  const now = new Date().toISOString()
  return {
    id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: finalTitle,
    rawEnglish: raw,
    sentences,
    source,
    sourceUrl,
    notes: '',
    reciteDraft: '',
    needsCleanup,
    groupId: groupId || undefined,
    marks: [],
    chapters: chapters.length > 1 ? chapters : undefined,
    createdAt: now,
    updatedAt: now
  }
}

async function createFromPaste() {
  if (!pasteText.value.trim()) return
  const a = buildArticle(pasteTitle.value, pasteText.value, 'paste', undefined, pasteGroupId.value)
  await readerStore.saveArticle(a)
  pasteText.value = ''
  pasteTitle.value = ''
  showImportPanel.value = false
}

const sectionSplitPrompt = ref<{ file: File; sections: { title: string; text: string }[] } | null>(null)

async function onFilePick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length) return
  const one = files.length === 1 ? files[0] : null
  if (one && /\.(md|markdown|txt)$/i.test(one.name)) {
    importingFile.value = true
    try {
      const text = await one.text()
      const secs = splitMarkdownSections(text)
      if (secs && secs.length >= 3) {
        sectionSplitPrompt.value = { file: one, sections: secs }
        importingFile.value = false
        input.value = ''
        return
      }
    } catch {
    }
    importingFile.value = false
  }

  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.docx')) {
    importingFile.value = true
    try {
      const sections = await extractDocxSections(files[0])
      if (sections) {
        sectionSplitPrompt.value = { file: files[0], sections }
        importingFile.value = false
        input.value = ''
        return
      }
    } catch {
    }
    importingFile.value = false
  }
  await importFiles(files)
  input.value = ''
}

async function importFiles(files: File[]) {
  importingFile.value = true
  urlError.value = ''
  batchMessage.value = ''
  let ok = 0
  const failMsgs: string[] = []
  try {
    for (const file of files) {
      try {
        const text = await extractTextFromFile(file)
        const a = buildArticle(file.name.replace(/\.[^.]+$/, ''), text, 'file', undefined, pasteGroupId.value)
        await readerStore.saveArticle(a)
        ok++
      } catch (err) {
        failMsgs.push(`${file.name}：${err instanceof Error ? err.message : '解析失败'}`)
      }
    }
    if (files.length > 1) {
      batchMessage.value = `批量导入完成：成功 ${ok} 篇${failMsgs.length ? `，失败 ${failMsgs.length} 篇（${failMsgs.join('；')}）` : ''}`
    } else if (failMsgs.length) {
      urlError.value = failMsgs[0]
    }
  } finally {
    importingFile.value = false
  }
}

async function confirmWholeImport() {
  if (!sectionSplitPrompt.value) return
  const { file, sections } = sectionSplitPrompt.value
  sectionSplitPrompt.value = null
  importingFile.value = true
  urlError.value = ''
  try {
    const baseTitle = file.name.replace(/\.[^.]+$/, '')
    const chapters: ArticleChapter[] = []
    const sentences: ArticleSentence[] = []
    let anyNeedsCleanup = false
    for (const s of sections) {
      chapters.push({ title: s.title, sentenceIndex: sentences.length })
      const { sentences: secSentences, looksLikeRawTranscript } = splitToSentences(s.text, s.title)
      sentences.push(...secSentences)
      if (looksLikeRawTranscript) anyNeedsCleanup = true
    }
    const now = new Date().toISOString()
    const a: Article = {
      id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: baseTitle,
      rawEnglish: sections.map(x => `## ${x.title}\n\n${x.text}`).join('\n\n'),
      sentences,
      source: 'file',
      notes: '',
      reciteDraft: '',
      needsCleanup: anyNeedsCleanup,
      groupId: pasteGroupId.value || undefined,
      marks: [],
      chapters,
      createdAt: now,
      updatedAt: now
    }
    await readerStore.saveArticle(a)
  } catch (err) {
    urlError.value = err instanceof Error ? err.message : '整篇导入失败'
  } finally {
    importingFile.value = false
  }
}

async function confirmSplitImport() {
  if (!sectionSplitPrompt.value) return
  const { file, sections } = sectionSplitPrompt.value
  sectionSplitPrompt.value = null
  importingFile.value = true
  batchMessage.value = ''
  try {
    const baseTitle = file.name.replace(/\.[^.]+$/, '')
    const group = await readerStore.createGroup(baseTitle)
    let ok = 0
    const failMsgs: string[] = []
    for (const s of sections) {
      try {
        const a = buildArticle(s.title, s.text, 'file', undefined, group.id)
        await readerStore.saveArticle(a)
        ok++
      } catch (err) {
        failMsgs.push(`${s.title}：${err instanceof Error ? err.message : '解析失败'}`)
      }
    }
    batchMessage.value = `按章节拆分完成：共 ${sections.length} 个章节，成功导入 ${ok} 篇，已归到新分组「${baseTitle}」${failMsgs.length ? `，失败 ${failMsgs.length} 篇（${failMsgs.join('；')}）` : ''}`
  } finally {
    importingFile.value = false
  }
}

async function fetchUrl() {
  if (!urlInput.value.trim()) return
  let parsedUrl: URL
  try {
    parsedUrl = new URL(urlInput.value)
  } catch {
    urlError.value = '请输入有效网址'
    return
  }
  fetchingUrl.value = true
  urlError.value = ''
  try {
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(urlInput.value)}`
    const res = await fetch(proxy)
    if (!res.ok) throw new Error('抓取失败')
    const html = await res.text()
    const text = stripHtml(html)
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const a = buildArticle(titleMatch?.[1]?.trim() || parsedUrl.hostname, text, 'url', urlInput.value, pasteGroupId.value)
    await readerStore.saveArticle(a)
    urlInput.value = ''
  } catch {
    const jsRenderedDocHosts = ['docs.qq.com', 'shimo.im', 'feishu.cn', 'larksuite.com', 'notion.so', 'docs.google.com', 'yuque.com']
    if (jsRenderedDocHosts.some(h => parsedUrl.hostname.endsWith(h))) {
      urlError.value = '这类在线文档（腾讯文档/石墨/飞书/Notion/语雀等）内容要登录后由网页自己的脚本加载出来，这个工具只能抓静态网页原始内容，抓不到——只能手动复制文章内容用"粘贴导入"'
    } else {
      urlError.value = '抓取失败，该网站可能限制访问，可改用复制粘贴或文件导入'
    }
  } finally {
    fetchingUrl.value = false
  }
}

function openArticle(id: string) {
  readerStore.selectArticle(id)
  nextTick(() => {
    const el = document.querySelector('.reader-split > .article-view')
    if (el) el.scrollTop = 0
  })
}
async function removeArticle(id: string) {
  await readerStore.deleteArticle(id)
}

const articleSearch = ref('')
const groupFilter = ref('all')
const showNewGroupInput = ref(false)
const newGroupName = ref('')
const showImportPanel = ref(false)
const pasteGroupId = ref('')
const selectedIds = ref<Set<string>>(new Set())
const lastPickedId = ref('')
let dragSelecting = false
let dragAnchorIdx = -1

function onRowClick(id: string, e: MouseEvent) {
  const list = filteredArticles.value
  if (e.shiftKey && lastPickedId.value) {
    const a = list.findIndex(x => x.id === lastPickedId.value)
    const b = list.findIndex(x => x.id === id)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      for (let i = lo; i <= hi; i++) selectedIds.value.add(list[i].id)
      return
    }
  }
  toggleSelect(id)
  lastPickedId.value = id
}

const listCollapsed = ref(localStorage.getItem('lb-reader-list-collapsed') === '1')
const tocFolded = ref(localStorage.getItem('lb-reader-toc-folded') === '1')
watch(tocFolded, v => localStorage.setItem('lb-reader-toc-folded', v ? '1' : '0'))
const activeChapter = ref<number | null>(null)
watch(listCollapsed, v => localStorage.setItem('lb-reader-list-collapsed', v ? '1' : '0'))

const selectMode = ref(false)
let pressTimer: ReturnType<typeof setTimeout> | null = null

function rowIndexAt(x: number, y: number): number {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const row = el?.closest('.article-row') as HTMLElement | null
  if (!row || !row.parentElement) return -1
  return Array.prototype.indexOf.call(row.parentElement.children, row)
}

function beginDrag(id: string) {
  dragSelecting = true
  dragAnchorIdx = filteredArticles.value.findIndex(a => a.id === id)
  lastPickedId.value = id
  selectedIds.value.add(id)
}

function onRowPointerDown(id: string, e: PointerEvent) {
  if ((e.target as HTMLElement).closest('input,button,select,textarea')) return

  if (selectMode.value) {
    e.preventDefault()
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) selectedIds.value = new Set()
    beginDrag(id)
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
    }
    return
  }

  pressTimer = setTimeout(() => {
    selectMode.value = true
    beginDrag(id)
  }, 400)
}

function onRowPointerMove(e: PointerEvent) {
  if (!dragSelecting || dragAnchorIdx < 0) return
  const idx = rowIndexAt(e.clientX, e.clientY)
  if (idx < 0) return
  const list = filteredArticles.value
  const [lo, hi] = dragAnchorIdx < idx ? [dragAnchorIdx, idx] : [idx, dragAnchorIdx]
  const next = new Set<string>()
  for (let i = lo; i <= hi && i < list.length; i++) next.add(list[i].id)
  selectedIds.value = next
}

function onRowPointerUp() {
  dragSelecting = false
  dragAnchorIdx = -1
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

onMounted(() => {
  window.addEventListener('pointerup', onRowPointerUp)
  window.addEventListener('pointermove', onRowPointerMove)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', onRowPointerUp)
  window.removeEventListener('pointermove', onRowPointerMove)
})

function exitSelectMode() {
  selectMode.value = false
  selectedIds.value = new Set()
}
function selectAll() {
  selectedIds.value = new Set(filteredArticles.value.map(a => a.id))
}

const editingListTitleId = ref<string | null>(null)
const editingListTitleDraft = ref('')
function startListTitleEdit(a: Article) {
  editingListTitleId.value = a.id
  editingListTitleDraft.value = a.title
}
async function saveListTitle(a: Article) {
  const t = editingListTitleDraft.value.trim()
  editingListTitleId.value = null
  if (t && t !== a.title) {
    await readerStore.saveArticle({ ...a, title: t })
  }
}
function cancelListTitleEdit() {
  editingListTitleId.value = null
}
const batchMoveTarget = ref('')
const batchCleaning = ref(false)
const batchCleanProgress = ref('')

const filteredArticles = computed(() => {
  let list = readerStore.articles
  if (groupFilter.value === 'none') list = list.filter(a => !a.groupId)
  else if (groupFilter.value !== 'all') list = list.filter(a => a.groupId === groupFilter.value)
  const q = articleSearch.value.trim().toLowerCase()
  if (q) {
    list = list.filter(a => {
      if (a.title.toLowerCase().includes(q)) return true
      return a.sentences.some(x =>
        (x.en && x.en.toLowerCase().includes(q)) || (x.zh && x.zh.includes(q))
      )
    })
  }
  return [...list].sort((a, b) => Number(!!b.bookmarked) - Number(!!a.bookmarked))
})
async function toggleBookmark(a: Article) {
  await readerStore.saveArticle({ ...a, bookmarked: !a.bookmarked })
}
async function toggleCompleted(a: Article) {
  await readerStore.saveArticle({ ...a, completed: !a.completed })
}
const ungroupedCount = computed(() => readerStore.articles.filter(a => !a.groupId).length)
function groupCount(id: string) {
  return readerStore.articles.filter(a => a.groupId === id).length
}

async function doCreateGroup() {
  if (!newGroupName.value.trim()) return
  const g = await readerStore.createGroup(newGroupName.value)
  pasteGroupId.value = g.id
  newGroupName.value = ''
  showNewGroupInput.value = false
}

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
  selectedIds.value = new Set(selectedIds.value)
}

async function doBatchMove() {
  if (!batchMoveTarget.value) return
  const target = batchMoveTarget.value === 'none' ? undefined : batchMoveTarget.value
  await readerStore.moveArticlesToGroup([...selectedIds.value], target)
  selectedIds.value = new Set()
  batchMoveTarget.value = ''
}

async function doBatchDelete() {
  await readerStore.deleteArticles([...selectedIds.value])
  selectedIds.value = new Set()
}

function exportOne(a: any) {
  const doc = {
    kind: 'languagebridge-article',
    version: 1,
    exportedAt: new Date().toISOString(),
    title: a.title,
    sentences: a.sentences,
    chapters: a.chapters || [],
    notes: a.notes,
    chapterNotes: a.chapterNotes || [],
    marks: a.marks || [],
    source: a.source
  }
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${String(a.title || 'article').replace(/[\\/:*?"<>|]/g, '_')}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

const restoringFromBackend = ref(false)
const restoreMessage = ref('')

async function doRestoreFromBackend() {
  restoringFromBackend.value = true
  restoreMessage.value = ''
  try {
    const r = await readerStore.restoreFromBackend()
    if (!r.backendReachable) {
      restoreMessage.value = '连不上本地服务。用启动脚本把服务跑起来再试。'
    } else if (!r.articlesRestored && !r.groupsRestored) {
      restoreMessage.value = '后端没有比本地更多的文章，无需恢复。'
    } else {
      restoreMessage.value = `已恢复 ${r.articlesRestored} 篇文章、${r.groupsRestored} 个分组。`
    }
  } catch (e) {
    restoreMessage.value = '恢复失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    restoringFromBackend.value = false
  }
}

const allSelectedTidied = computed(() => {
  const sel = readerStore.articles.filter(a => selectedIds.value.has(a.id))
  return sel.length > 0 && sel.every(a => !a.needsCleanup)
})
const batchCleanLabel = computed(() => (allSelectedTidied.value ? '重新整理' : '批量AI整理'))

const cleaningOneId = ref('')
const cleanupProgress = ref('')
const cleanPct = computed(() => {
  const m = /^(\d+)\/(\d+)$/.exec(cleanupProgress.value)
  if (!m) return '8%'
  return `${Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 100)}%`
})
async function cleanupOne(a: Article) {
  if (cleaningOneId.value) return
  cleaningOneId.value = a.id
  cleanupProgress.value = ''
  try {
    const raw = a.rawEnglish || a.sentences.map(x => x.en).join(' ')

    // 纯中文稿：整理 = 把英文补出来（跟补译方向相反）
    const zhOnly = a.sentences.length > 0 && a.sentences.every(x => !x.en.trim()) && a.sentences.some(x => x.zh.trim())
    if (zhOnly) {
      const sentences = a.sentences.map(x => ({ ...x }))
      const gaps: number[] = []
      // 章节号这类结构行不送翻译：把「Part 3」翻成「第三部分」没有意义，
      // 章节名已经存在 chapters 里了。原样落到另一栏即可。
      sentences.forEach((x, i) => {
        if (x.en.trim() || !x.zh.trim()) return
        if (isStructuralLine(x.zh)) { x.en = x.zh; return }
        gaps.push(i)
      })
      const BATCH = 20
      let fixed = 0
      let failedBatches = 0
      for (let k = 0; k < gaps.length; k += BATCH) {
        const slice = gaps.slice(k, k + BATCH)
        cleanupProgress.value = `${Math.min(k + BATCH, gaps.length)}/${gaps.length}`
        try {
          const en = await aiTranslateToEnglish(slice.map(i => sentences[i].zh))
          slice.forEach((i, j) => { if (en[j]) { sentences[i].en = en[j]; fixed++ } })
          failedBatches = 0
        } catch (err) {
          failedBatches++
          if (failedBatches >= 3) {
            batchMessage.value =
              `《${a.title}》翻译中断：连续 3 批失败。\n${err instanceof Error ? err.message : '未知错误'}\n` +
              `已译出 ${fixed} 句，进度已保存，可以再点一次接着译。`
            break
          }
        }
        if (fixed && fixed % 200 === 0) await readerStore.saveArticle({ ...a, sentences })
      }
      await readerStore.saveArticle({
        ...a,
        sentences,
        needsCleanup: sentences.some(x => !x.en.trim() && x.zh.trim())
      })
      if (!batchMessage.value) {
        batchMessage.value = `《${a.title}》这是纯中文稿，已译出英文 ${fixed}/${gaps.length} 句`
      }
      return
    }

    const lostChinese = !a.rawEnglish || !/[\u4e00-\u9fff]/.test(a.rawEnglish)
    if (lostChinese) {
      const sentences = a.sentences.map(x => ({ ...x }))
      const gaps: number[] = []
      sentences.forEach((x, i) => {
        if (x.zh || !x.en.trim()) return
        if (isStructuralLine(x.en)) { x.zh = x.en; return }
        gaps.push(i)
      })
      if (!gaps.length) {
        batchMessage.value = `《${a.title}》已经每句都有译文，不需要整理`
        return
      }
      const BATCH = 20
      let fixed = 0
      let failedBatches = 0
      for (let k = 0; k < gaps.length; k += BATCH) {
        const slice = gaps.slice(k, k + BATCH)
        cleanupProgress.value = `${Math.min(k + BATCH, gaps.length)}/${gaps.length}`
        try {
          const zh = await aiTranslateLines(slice.map(i => sentences[i].en))
          slice.forEach((i, j) => { if (zh[j]) { sentences[i].zh = zh[j]; fixed++ } })
          failedBatches = 0
        } catch (err) {
          failedBatches++
          if (failedBatches >= 3) {
            batchMessage.value =
              `《${a.title}》补译中断：连续 3 批请求失败。\n` +
              `${err instanceof Error ? err.message : '未知错误'}\n` +
              `已补上 ${fixed} 句，进度已保存，可以再点一次接着补。`
            break
          }
        }
        if (fixed && fixed % 200 === 0) {
          await readerStore.saveArticle({ ...a, sentences })
        }
      }
      await readerStore.saveArticle({
        ...a,
        sentences,
        needsCleanup: sentences.some(x => !x.zh && x.en.trim())
      })
      if (!batchMessage.value) {
        batchMessage.value = `《${a.title}》补译完成：${gaps.length} 句缺译文，补上 ${fixed} 句`
      }
      return
    }

    let restructured = buildArticle(a.title, raw, a.source)

    /**
     * 本地规则分不出章的话，让 AI 只判断"哪几行是章节标题"，
     * 拿回行号后仍然由本地代码切分、断句、配对 —— AI 不碰正文。
     */
    if (!restructured.chapters || restructured.chapters.length < 2) {
      cleanupProgress.value = '识别章节'
      try {
        const lines = raw.replace(/\r\n/g, '\n').split('\n')
        const outline = await aiOutlineChapters(lines)
        if (outline.length >= 2) {
          const withMarks = lines.map((l, i) =>
            outline.some(o => o.startLine === i) ? `## ${l.replace(/^#+\s*/, '')}` : l
          ).join('\n')
          const withChapters = buildArticle(a.title, withMarks, a.source)
          if ((withChapters.chapters?.length || 0) >= 2) restructured = withChapters
        }
      } catch (err) {
        console.warn('[整理] 章节识别失败，按无章节处理', err)
      }
      cleanupProgress.value = ''
    }
    const zhRate = restructured.sentences.filter(x => x.zh).length / Math.max(1, restructured.sentences.length)
    if (zhRate >= 0.5 || (restructured.chapters?.length || 0) > 1) {
      const sentences = [...restructured.sentences]
      const gaps: number[] = []
      sentences.forEach((x, i) => {
        if (x.zh || !x.en.trim()) return
        if (isStructuralLine(x.en)) { x.zh = x.en; return }
        gaps.push(i)
      })

      let fixed = 0
      if (gaps.length && gaps.length <= 400) {
        const BATCH = 20
        for (let k = 0; k < gaps.length; k += BATCH) {
          const slice = gaps.slice(k, k + BATCH)
          cleanupProgress.value = `${Math.min(k + BATCH, gaps.length)}/${gaps.length}`
          try {
            const zh = await aiTranslateLines(slice.map(i => sentences[i].en))
            slice.forEach((i, j) => { if (zh[j]) { sentences[i].zh = zh[j]; fixed++ } })
          } catch {
            break
          }
        }
      }

      await readerStore.saveArticle({
        ...a,
        sentences,
        chapters: restructured.chapters,
        marks: (a.marks || []).map(m => ({ ...m, sentIdx: -1, localStart: undefined, localEnd: undefined })),
        needsCleanup: false
      })
      batchMessage.value =
        `《${a.title}》整理完成：${sentences.length} 句` +
        `${restructured.chapters?.length ? ` · ${restructured.chapters.length} 章` : ''}` +
        `${gaps.length ? `，其中 ${gaps.length} 句缺译文，补上 ${fixed} 句` : '，结构完整，未调用 AI'}`
      return
    }

    const sentences = await aiReorganizeTranscript(raw, (done, total) => {
      cleanupProgress.value = total > 1 ? `${done}/${total}` : ''
    })
    const remarks = (a.marks || []).map(m => ({ ...m, sentIdx: -1, localStart: undefined, localEnd: undefined }))
    await readerStore.saveArticle({ ...a, sentences, marks: remarks, needsCleanup: false })
    batchMessage.value = `《${a.title}》整理完成，共 ${sentences.length} 句`
  } catch (e) {
    batchMessage.value = `《${a.title}》整理失败：${e instanceof Error ? e.message : '未知错误'}`
  } finally {
    cleaningOneId.value = ''
    cleanupProgress.value = ''
  }
}

async function doBatchCleanup(force = false) {
  try {
    await runBatchCleanup(force)
  } finally {
    batchCleaning.value = false
    cleaningOneId.value = ''
    cleanupProgress.value = ''
  }
}

async function runBatchCleanup(force = false) {
  const selected = readerStore.articles.filter(a => selectedIds.value.has(a.id))
  const needsAny = force
    ? selected
    : selected.filter(a => a.needsCleanup || a.sentences.some(s => !s.zh))
  if (!needsAny.length) {
    batchCleanProgress.value = ''
    batchMessage.value = `选中的 ${selected.length} 篇文章都已经整理+翻译完了，没有需要处理的`
    return
  }
  batchCleaning.value = true
  let done = 0
  let cleanedCount = 0
  let translatedCount = 0
  for (const a0 of needsAny) {
    batchCleanProgress.value = `${++done}/${needsAny.length}`
    cleaningOneId.value = a0.id
    cleanupProgress.value = ''
    try {
      let a = a0
      if (force || a.needsCleanup) {
        const raw = a.rawEnglish || a.sentences.map(x => x.en).join(' ')
        const sentences = await aiReorganizeTranscript(raw, (d, t) => {
          cleanupProgress.value = `${d}/${t}`
          batchCleanProgress.value = t > 1 ? `${done}/${needsAny.length}（本篇 ${d}/${t}）` : `${done}/${needsAny.length}`
        })
        const remarks = (a.marks || []).map(m => ({ ...m, sentIdx: -1, localStart: undefined, localEnd: undefined }))
        a = { ...a, sentences, marks: remarks, needsCleanup: false }
        await readerStore.saveArticle(a)
        cleanedCount++
      }
      const missing = a.sentences.map((s, i) => (!s.zh ? i : -1)).filter(i => i >= 0)
      if (missing.length) {
        const BATCH = 15
        for (let i = 0; i < missing.length; i += BATCH) {
          const idxBatch = missing.slice(i, i + BATCH)
          cleanupProgress.value = `${Math.min(i + BATCH, missing.length)}/${missing.length}`
          const enBatch = idxBatch.map(idx => a.sentences[idx].en)
          const prompt =
            '请把下面编号的英文句子逐句翻译为简洁自然的中文，严格按照"编号: 译文"的格式逐行输出，不要添加其他内容：\n' +
            enBatch.map((s, k) => `${k + 1}. ${s}`).join('\n')
          const result = await askAi(prompt)
          const lines = result.split('\n').filter(l => l.trim())
          for (const line of lines) {
            const m = line.match(/^(\d+)[.:、]\s*(.+)$/)
            if (m) {
              const k = parseInt(m[1], 10) - 1
              if (idxBatch[k] !== undefined) a.sentences[idxBatch[k]].zh = m[2].trim()
            }
          }
          await readerStore.saveArticle({ ...a })
        }
        translatedCount++
      }
    } catch {
    }
  }
  batchCleaning.value = false
  batchMessage.value = `批量处理完成：整理了 ${cleanedCount} 篇、翻译了 ${translatedCount} 篇（选中 ${selected.length} 篇，其中 ${selected.length - needsAny.length} 篇本来就是完整的）`
  selectedIds.value = new Set()
}

function unstickBatch() {
  batchCleaning.value = false
  batchMessage.value = '已解除卡住状态，可以重新开始整理。'
}

const article = computed(() => readerStore.current)
const englishWordCount = computed(
  () => article.value?.sentences.reduce((n, s) => n + s.en.split(/\s+/).filter(Boolean).length, 0) || 0
)
const needsTranslation = computed(() => article.value?.sentences.some(s => !s.zh) ?? false)

type Layout = 'bilingual' | 'split' | 'sentence'
const layout = ref<Layout>((localStorage.getItem('lb-reader-layout') as Layout) || 'sentence')
watch(layout, v => localStorage.setItem('lb-reader-layout', v))
const layouts: { label: string; value: Layout }[] = [
  { label: '双语对照', value: 'bilingual' },
  { label: '左右分栏', value: 'split' },
  { label: '单句对照', value: 'sentence' }
]
const showEnglish = ref(true)
const showChinese = ref(true)

const viewSubMode = ref<'read' | 'recite' | 'shadow' | 'audioAlign'>('read')
const speechSupported = speechRecognitionSupported

function toggleReciteMode() {
  if (viewSubMode.value === 'recite') {
    viewSubMode.value = 'read'
    showEnglish.value = true
  } else {
    viewSubMode.value = 'recite'
    showEnglish.value = false
  }
}

const audioEl = ref<HTMLAudioElement | null>(null)
const audioObjectUrl = ref('')
const alignCursor = ref(0) // 正在对哪一句的轴
const alignLoading = ref(false)
const alignMessage = ref('')

const continuousOn = ref(false)
const playingIdx = ref(-1)
const shadowRate = ref(1)
const shadowLoopOne = ref(false)
const shadowGap = ref(0)
let contTimer: ReturnType<typeof setTimeout> | null = null
const shadowRows = new Map<number, HTMLElement>()
function setShadowRowRef(el: any, i: number) {
  if (el) shadowRows.set(i, el as HTMLElement)
  else shadowRows.delete(i)
}

function stopContinuous() {
  continuousOn.value = false
  playingIdx.value = -1
  if (contTimer) { clearTimeout(contTimer); contTimer = null }
  if (audioEl.value) audioEl.value.pause()
}

function toggleContinuous() {
  if (continuousOn.value) { stopContinuous(); return }
  continuousOn.value = true
  const from = playingIdx.value >= 0 ? playingIdx.value : 0
  playFrom(from)
}

function playFrom(i: number) {
  const arts = article.value?.sentences || []
  let idx = i
  while (idx < arts.length && arts[idx].audioStart == null) idx++
  if (idx >= arts.length || !audioEl.value) { stopContinuous(); return }

  const s = arts[idx]
  playingIdx.value = idx
  scrollShadowIntoView(idx)

  const el = audioEl.value
  el.playbackRate = shadowRate.value
  el.currentTime = s.audioStart as number
  el.play().catch(() => stopContinuous())

  const dur = ((s.audioEnd ?? s.audioStart ?? 0) - (s.audioStart ?? 0)) / shadowRate.value
  if (contTimer) clearTimeout(contTimer)
  contTimer = setTimeout(() => {
    el.pause()
    if (!continuousOn.value) return
    const gapMs = (shadowGap.value === -1 ? dur : shadowGap.value) * 1000
    contTimer = setTimeout(() => {
      if (!continuousOn.value) return
      playFrom(shadowLoopOne.value ? idx : idx + 1)
    }, gapMs)
  }, Math.max(200, dur * 1000))
}

function scrollShadowIntoView(i: number) {
  const el = shadowRows.get(i)
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

watch(viewSubMode, m => { if (m !== 'shadow') stopContinuous() })
onBeforeUnmount(stopContinuous)

async function loadArticleAudio() {
  if (!article.value) return
  alignMessage.value = ''
  if (article.value.audioUrl) {
    if (audioObjectUrl.value.startsWith('blob:')) URL.revokeObjectURL(audioObjectUrl.value)
    audioObjectUrl.value = article.value.audioUrl
    return
  }
  const file = await getArticleAudioFile(article.value.id)
  if (audioObjectUrl.value.startsWith('blob:')) URL.revokeObjectURL(audioObjectUrl.value)
  audioObjectUrl.value = file ? URL.createObjectURL(file) : ''
}

const videoBusy = ref(false)
const videoProgress = ref('')
const subMessage = ref('')

async function onPickVideo(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f || !article.value) return

  videoBusy.value = true
  videoProgress.value = '检查 ffmpeg…'
  alignMessage.value = ''
  try {
    const chk = await fetch('/api/media/ffmpeg-check').then(r => r.json()).catch(() => null)
    if (!chk?.ok) {
      alignMessage.value = '本机没装 ffmpeg（或本地服务没起）。装好 ffmpeg 并加进 PATH，重启启动脚本再试。'
      return
    }
    videoProgress.value = `上传抽取中（${Math.round(f.size / 1048576)}MB）…`
    const r = await fetch('/api/media/extract', { method: 'POST', body: f })
    const j = await r.json()
    if (!j.ok) throw new Error(j.error || '抽取失败')

    const name = f.name.replace(/\.[^.]+$/, '') + '.mp3'
    await readerStore.saveArticle({ ...article.value, audioFileName: name, audioUrl: j.url })
    await loadArticleAudio()
    alignCursor.value = 0
    subMessage.value = `已抽出音轨（${Math.round(j.size / 1048576 * 10) / 10}MB），原视频没有保存。下一步导入字幕就能自动对轴。`
  } catch (err) {
    alignMessage.value = '抽取失败：' + (err instanceof Error ? err.message : String(err))
  } finally {
    videoBusy.value = false
    videoProgress.value = ''
  }
}

async function onPickSubtitle(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f || !article.value) return
  subMessage.value = ''
  try {
    const cues = parseSubtitles(await f.text())
    if (!cues.length) { subMessage.value = '没解析出字幕条目，确认是 .srt / .vtt 格式'; return }
    const timings = alignCuesToSentences(article.value.sentences, cues)
    const hit = timings.filter(Boolean).length
    if (!hit) { subMessage.value = `解析到 ${cues.length} 条字幕，但跟这篇的句子对不上，确认字幕和文章是同一篇`; return }
    const sentences = article.value.sentences.map((sent, i) => {
      const t = timings[i]
      return t ? { ...sent, audioStart: t.start, audioEnd: t.end } : sent
    })
    await readerStore.saveArticle({ ...article.value, sentences })
    subMessage.value = `已对轴 ${hit} / ${sentences.length} 句${hit < sentences.length ? '，剩下的可以手动补' : ''}`
  } catch (err) {
    subMessage.value = '读取失败：' + (err instanceof Error ? err.message : String(err))
  }
}

const asrBusy = ref(false)

async function doTranscribe() {
  if (!article.value?.audioUrl) return
  asrBusy.value = true
  subMessage.value = ''
  try {
    const file = article.value.audioUrl.split('/').pop() || ''
    const r = await fetch(`/api/media/transcribe?file=${encodeURIComponent(file)}`, { method: 'POST' })
    const j = await r.json()
    if (!j.ok) throw new Error(j.error || '转写失败')

    const cues = parseSubtitles(j.srt)
    const timings = alignCuesToSentences(article.value.sentences, cues)
    const hit = timings.filter(Boolean).length
    const sentences = article.value.sentences.map((sent, i) => {
      const t = timings[i]
      return t ? { ...sent, audioStart: t.start, audioEnd: t.end } : sent
    })
    await readerStore.saveArticle({ ...article.value, sentences })
    subMessage.value = hit
      ? `转写完成，对上 ${hit} / ${sentences.length} 句`
      : `转写出 ${cues.length} 条，但跟这篇的句子对不上——识别文本和文章可能不是同一篇`
  } catch (err) {
    subMessage.value = '转写失败：' + (err instanceof Error ? err.message : String(err))
  } finally {
    asrBusy.value = false
  }
}

async function doPickAudio() {
  if (!article.value) return
  if (!audioPickerSupported()) {
    alignMessage.value = '当前浏览器不支持选文件关联（需要 Chrome / Edge），试试换个浏览器'
    return
  }
  alignLoading.value = true
  try {
    const r = await pickArticleAudio(article.value.id)
    if (r) {
      await readerStore.saveArticle({ ...article.value, audioFileName: r.name })
      await loadArticleAudio()
      alignCursor.value = 0
    }
  } catch (e) {
    if (e instanceof Error && e.name !== 'AbortError') alignMessage.value = `关联失败：${e.message}`
  } finally {
    alignLoading.value = false
  }
}

async function doClearAudio() {
  if (!article.value) return
  await clearArticleAudio(article.value.id)
  await readerStore.saveArticle({ ...article.value, audioFileName: undefined, audioUrl: undefined, sentences: article.value.sentences.map(s => ({ ...s, audioStart: undefined, audioEnd: undefined })) })
  if (audioObjectUrl.value) URL.revokeObjectURL(audioObjectUrl.value)
  audioObjectUrl.value = ''
}

async function markSentenceStart(i: number) {
  if (!article.value || !audioEl.value) return
  const t = audioEl.value.currentTime
  const sentences = article.value.sentences.map((s, idx) => {
    if (idx === i) return { ...s, audioStart: t }
    if (idx === i - 1) return { ...s, audioEnd: t }
    return s
  })
  await readerStore.saveArticle({ ...article.value, sentences })
  alignCursor.value = Math.min(i + 1, article.value.sentences.length - 1)
}

async function markLastSentenceEnd() {
  if (!article.value || !audioEl.value) return
  const lastIdx = article.value.sentences.length - 1
  const sentences = article.value.sentences.map((s, idx) => (idx === lastIdx ? { ...s, audioEnd: audioEl.value!.duration } : s))
  await readerStore.saveArticle({ ...article.value, sentences })
}

function jumpAudioTo(t: number | undefined) {
  if (audioEl.value && t != null) {
    audioEl.value.currentTime = t
    audioEl.value.play()
  }
}

const alignedCount = computed(() => article.value?.sentences.filter(s => s.audioStart != null).length || 0)

let shadowStopTimer: ReturnType<typeof setTimeout> | null = null
function playSentenceSmart(i: number) {
  const s = article.value?.sentences[i]
  if (s?.audioStart != null && s.audioEnd != null && audioEl.value) {
    if (shadowStopTimer) clearTimeout(shadowStopTimer)
    audioEl.value.currentTime = s.audioStart
    audioEl.value.play()
    const dur = Math.max(0, (s.audioEnd - s.audioStart) * 1000)
    shadowStopTimer = setTimeout(() => audioEl.value?.pause(), dur)
  } else {
    playSentence(s?.en || '')
  }
}

watch(() => article.value?.id, () => {
  alignCursor.value = 0
  loadArticleAudio()
}, { immediate: true })

const reciteDrafts = ref<string[]>([])
const legacyReciteDraft = ref('')
const showOriginal = ref(false)

function syncReciteDrafts(a: Article | null) {
  const n = a?.sentences.length || 0
  const saved = a?.reciteDrafts || []
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(saved[i] || '')
  reciteDrafts.value = out
  legacyReciteDraft.value = (a?.reciteDraft || '').trim()
}

function saveReciteDrafts() {
  if (!article.value) return
  readerStore.saveArticle({ ...article.value, reciteDrafts: [...reciteDrafts.value] })
}

const reciteFilledCount = computed(() => reciteDrafts.value.filter(t => t.trim()).length)
const reciteJoined = computed(() => reciteDrafts.value.map(t => t.trim()).filter(Boolean).join(' '))

const reciteRecordingIdx = ref<number | null>(null)
let reciteRecognizer: ReturnType<typeof createRecognizer> = null
let reciteBaseText = ''
function toggleReciteRecording(idx: number) {
  if (reciteRecordingIdx.value === idx) {
    reciteRecognizer?.stop()
    return
  }
  reciteRecognizer?.stop()
  reciteBaseText = reciteDrafts.value[idx] ? reciteDrafts.value[idx].trim() + ' ' : ''
  reciteRecognizer = createRecognizer(
    (text, isFinal) => {
      reciteDrafts.value[idx] = reciteBaseText + text
      if (isFinal) reciteBaseText = reciteDrafts.value[idx].trim() + ' '
    },
    () => {
      reciteRecordingIdx.value = null
      saveReciteDrafts()
    }
  )
  if (!reciteRecognizer) return
  reciteRecordingIdx.value = idx
  reciteRecognizer.start()
}

const reciteScoring = ref(false)
const reciteFeedback = ref('')
async function scoreRecite() {
  if (!article.value || !reciteJoined.value.trim() || !aiReady.value) return
  reciteScoring.value = true
  reciteFeedback.value = ''
  try {
    const original = article.value.sentences.map(s => s.en).join(' ')
    const result = await askAi(
      `下面是一篇英语文章的原文，以及学习者尝试用英语复述的内容。请你对照原文，从"内容完整度"（复述覆盖了多少原文信息点）、"语法正确性"、"表达是否地道"三个维度给出简短反馈，最后给一个 0-100 的综合分。用中文点评，不要用表情符号，分点列出，最后单独一行写"总分：xx"。\n\n原文：\n${original.slice(0, 4000)}\n\n学习者的复述：\n${reciteJoined.value.slice(0, 2000)}`
    )
    reciteFeedback.value = result
  } catch (e) {
    reciteFeedback.value = e instanceof AiError ? e.message : 'AI 打分失败，请稍后重试'
  } finally {
    reciteScoring.value = false
  }
}

const shadowRecordingIdx = ref<number | null>(null)
const shadowResults = ref<Record<number, { text: string; score: number }>>({})
let shadowRecognizer: ReturnType<typeof createRecognizer> = null

function toggleShadowRecording(idx: number, original: string) {
  if (shadowRecordingIdx.value === idx) {
    shadowRecognizer?.stop()
    return
  }
  shadowRecognizer?.stop()
  let lastText = ''
  shadowRecognizer = createRecognizer(
    (text) => { lastText = text },
    () => {
      shadowRecordingIdx.value = null
      if (lastText) {
        shadowResults.value = {
          ...shadowResults.value,
          [idx]: { text: lastText, score: similarityScore(original, lastText) }
        }
      }
    }
  )
  if (!shadowRecognizer) return
  shadowRecordingIdx.value = idx
  shadowRecognizer.start()
}

function scoreClass(score: number): string {
  if (score >= 80) return 'good'
  if (score >= 50) return 'mid'
  return 'low'
}

const editingTitle = ref(false)
const titleDraft = ref('')
function startEditTitle() {
  if (!article.value) return
  titleDraft.value = article.value.title
  editingTitle.value = true
}
async function saveTitle() {
  if (!article.value) return
  editingTitle.value = false
  const t = titleDraft.value.trim()
  if (t && t !== article.value.title) {
    await readerStore.saveArticle({ ...article.value, title: t })
  }
}

const cleaning = ref(false)
async function cleanupTranscript() {
  if (!article.value || !aiReady.value) return
  cleaning.value = true
  try {
    const sentences = await aiReorganizeTranscript(article.value.rawEnglish)
    const remarks = (article.value.marks || []).map(m => ({ ...m, sentIdx: -1, localStart: undefined, localEnd: undefined }))
    await readerStore.saveArticle({ ...article.value, sentences, marks: remarks, needsCleanup: false })
    nextTick(migrateMarksToSentenceAnchor)
  } catch (e) {
    urlError.value = e instanceof AiError ? e.message : 'AI 整理失败，请稍后重试'
  } finally {
    cleaning.value = false
  }
}

const notesDraft = ref('')

const bookArticles = computed(() => {
  const gid = article.value?.groupId
  if (!gid) return []
  const list = readerStore.articlesOfGroup(gid)
  return list.length > 1 ? list : []
})
const isBookMode = computed(() => bookArticles.value.length > 1)
const bookPage = computed(() => bookArticles.value.findIndex(a => a.id === article.value?.id))

const chapterCount = computed(() =>
  isBookMode.value ? bookArticles.value.length : (article.value?.chapters?.length || 1)
)
const chapterPage = ref(0)
watch(bookPage, i => { if (isBookMode.value && i >= 0) chapterPage.value = i }, { immediate: true })

function readNotePage(i: number): string {
  const a = article.value
  if (!a) return ''
  if (isBookMode.value) return readerStore.getBookNote(a.groupId!, i)
  if (chapterCount.value <= 1) return a.notes || ''
  return a.chapterNotes?.[i] ?? (i === 0 ? a.notes || '' : '')
}

function stashNotePage() {
  const a = article.value
  if (!a) return
  if (isBookMode.value) {
    readerStore.saveBookNote(a.groupId!, chapterPage.value, notesDraft.value)
    return
  }
  if (chapterCount.value <= 1) return
  const arr = [...(a.chapterNotes || [])]
  while (arr.length < chapterCount.value) arr.push('')
  arr[chapterPage.value] = notesDraft.value
  a.chapterNotes = arr
}

function gotoNotePage(i: number) {
  if (i < 0 || i >= chapterCount.value) return
  stashNotePage()
  chapterPage.value = i
  notesDraft.value = readNotePage(i)
  if (notesEditorEl.value) notesEditorEl.value.innerHTML = notesDraft.value
  if (isBookMode.value) {
    const target = bookArticles.value[i]
    if (target && target.id !== article.value?.id) readerStore.selectArticle(target.id)
    return
  }
  const ch = article.value?.chapters?.[i]
  if (ch) jumpToChapter(ch.sentenceIndex)
}

const generatingNotes = ref(false)
const notesEditorEl = ref<HTMLElement | null>(null)
function syncNotesEditorFromDraft() {
  nextTick(() => {
    if (notesEditorEl.value && notesEditorEl.value.innerHTML !== notesDraft.value) {
      notesEditorEl.value.innerHTML = notesDraft.value
    }
  })
}
function onNotesInput(e: Event) {
  notesDraft.value = (e.target as HTMLElement).innerHTML
}
function onNotesAreaClick(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('.note-mark-link') as HTMLElement | null
  if (link) {
    e.preventDefault()
    const idx = parseInt(link.dataset.sentIdx || '-1', 10)
    if (idx >= 0) onStudyJump(idx)
    return
  }
  const expandBtn = (e.target as HTMLElement).closest('.note-expand-btn') as HTMLElement | null
  if (expandBtn) {
    e.preventDefault()
    toggleWordDetail(expandBtn)
  }
}
function saveNotes() {
  if (!article.value) return
  stashNotePage()
  readerStore.saveArticle({
    ...article.value,
    notes: chapterCount.value > 1 ? article.value.notes : notesDraft.value,
    chapterNotes: chapterCount.value > 1 ? article.value.chapterNotes : undefined
  })
}

function onStudyJump(sentenceIndex: number) {
  viewSubMode.value = 'read'
  layout.value = 'sentence'
  nextTick(() => {
    const el = document.getElementById(`sent-${sentenceIndex}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('jump-flash')
      setTimeout(() => el.classList.remove('jump-flash'), 1600)
    }
  })
}

async function generateRichWordEntriesBatch(words: string[]): Promise<Record<string, Partial<WordItem>>> {
  if (!words.length || !aiReady.value) return {}
  try {
    const prompt = `请为下面这些英语单词/短语分别生成结构化学习词条。只输出 JSON 本身（一个对象，key 是单词/短语原文，value 是词条），不要 markdown 代码块标记、不要任何别的文字。每个词条格式：
{"phonetic":"音标(不带斜杠)","meanings":[{"chinese":"中文释义","partOfSpeech":"词性缩写如n./v./adj."}],"etymology":"词源学解释，没有就空字符串","memory_tips":"记忆技巧，没有就空字符串","common_phrases":[{"phrase_en":"...","phrase_zh":"..."}],"synonyms":[{"word":"...","difference":"..."}],"antonyms":[{"word":"..."}],"example_sentences":[{"en":"...","zh":"..."}],"detailed_explanation":"更详细的用法讲解，2-3句话"}
数组类字段每项给1-3个，没有把握的内容对应字段给空数组，不要编造。需要生成词条的单词/短语列表（用｜分隔）：${words.join('｜')}`
    const raw = await askAi(prompt)
    const cleaned = raw.trim().replace(/^```(?:json)?\s*|```\s*$/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {} // AI 没配置好/这次没返回合法 JSON——调用方会把这些词都当"没生成成功"处理，不报错打断
  }
}

function markOrderKey(m: ArticleMark): number {
  if (m.sentIdx != null && m.sentIdx >= 0) {
    return (sentenceOffsets.value[m.sentIdx] ?? 0) + (m.localStart ?? 0)
  }
  return m.start
}

function sentenceTextAtOffset(globalStart: number): string {
  const offsets = sentenceOffsets.value
  const sentences = article.value?.sentences || []
  const idx = sentences.findIndex((s, i) => {
    const bStart = offsets[i] ?? 0
    return globalStart >= bStart && globalStart < bStart + s.en.length + 1
  })
  return idx >= 0 ? sentences[idx].en : ''
}

const VOCAB_SECTION_RE = /<div id="note-vocab-section">([\s\S]*?)<\/div>/
const VOCAB_ENTRY_RE = /<p>[\s\S]*?<\/p>(?:<div class="note-word-detail"[^>]*>[\s\S]*?<\/div>)?/g

function getVocabEntries(html: string): { sentIdx: number; entryHtml: string }[] {
  const m = html.match(VOCAB_SECTION_RE)
  if (!m) return []
  const entries: { sentIdx: number; entryHtml: string }[] = []
  let em: RegExpExecArray | null
  VOCAB_ENTRY_RE.lastIndex = 0
  while ((em = VOCAB_ENTRY_RE.exec(m[1]))) {
    const block = em[0]
    const sm = block.match(/data-sent-idx="(-?\d+)"/)
    entries.push({ sentIdx: sm ? parseInt(sm[1], 10) : -1, entryHtml: block })
  }
  return entries
}

function setVocabEntries(html: string, entries: { sentIdx: number; entryHtml: string }[]): string {
  const section = `<div id="note-vocab-section">${entries.map(e => e.entryHtml).join('')}</div>`
  if (VOCAB_SECTION_RE.test(html)) return html.replace(VOCAB_SECTION_RE, section)
  const header = entries.length ? '<p><strong>划线词汇</strong></p>' : ''
  return header + section + html
}

function insertVocabEntry(html: string, entryHtml: string, sentIdx: number): string {
  const entries = getVocabEntries(html)
  let insertAt = entries.length
  for (let i = 0; i < entries.length; i++) {
    if (sentIdx >= 0 && entries[i].sentIdx >= 0 && entries[i].sentIdx > sentIdx) { insertAt = i; break }
  }
  entries.splice(insertAt, 0, { sentIdx, entryHtml })
  return setVocabEntries(html, entries)
}

async function generateNotes() {
  if (!article.value) return
  const marks = (article.value.marks || [])
    .filter(m => m.text && isVocabbable(m.text))
    .slice()
    .sort((a, b) => markOrderKey(a) - markOrderKey(b))
  if (!marks.length) {
    notesDraft.value = notesDraft.value + '<p>这篇文章目前还没有划线标记的单词，先去正文里划几个再点这个按钮</p>'
    syncNotesEditorFromDraft()
    saveNotes()
    return
  }
  generatingNotes.value = true
  try {
    const resolved: { mark: ArticleMark; entry: WordItem | null; genTarget: string }[] = []
    const needGenerate = new Set<string>()
    for (const m of marks) {
      const text = m.text.trim()
      const candidates = lookupCandidates(text)
      let entry: WordItem | null = null
      for (const cand of candidates) {
        entry = wordStore.words.find(w => w.word.toLowerCase() === cand.toLowerCase()) || null
        if (entry) break
      }
      const genTarget = candidates.length > 1 ? candidates[1] : text
      if (!entry?.detailed_explanation && aiReady.value) needGenerate.add(genTarget)
      resolved.push({ mark: m, entry, genTarget })
    }
    if (needGenerate.size) {
      const batch = await generateRichWordEntriesBatch([...needGenerate])
      for (const item of resolved) {
        const rich = batch[item.genTarget]
        if (!rich) continue
        if (item.entry) {
          await wordStore.updateWordFields(item.entry.id, rich)
          item.entry = wordStore.words.find(w => w.id === item.entry!.id) || item.entry
        } else {
          const now = new Date().toISOString()
          const created: WordItem = {
            id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            word: item.genTarget,
            phonetic: rich.phonetic || '',
            meanings: rich.meanings?.length ? rich.meanings : [{ chinese: '', partOfSpeech: '' }],
            level: 'IELTS',
            source: `阅读：${article.value.title}`,
            status: 'unmarked',
            createdAt: now,
            updatedAt: now,
            ...rich
          }
          await wordStore.addWord(created)
          item.entry = created
        }
      }
    }
    const entries = resolved.map(({ mark, entry }) => {
      const displayText = entry?.word || mark.text
      const linkedWord = `<a href="#" class="note-mark-link" data-sent-idx="${mark.sentIdx ?? -1}">${escapeHtml(displayText)}</a>`
      const expandBtn = ` <button class="note-expand-btn" data-word="${escapeHtml(displayText)}">详情 ▸</button>`
      const shortDef = entry?.meanings?.find(m => m.chinese)?.chinese || ''
      const entryHtml = `<p>• ${linkedWord}${shortDef ? '：' + escapeHtml(shortDef) : ''}${expandBtn}</p>`
      return { sentIdx: mark.sentIdx ?? -1, entryHtml }
    })
    notesDraft.value = setVocabEntries(notesDraft.value, entries)
    syncNotesEditorFromDraft()
    stashNotePage()
    await readerStore.saveArticle({
      ...article.value,
      notes: chapterCount.value > 1 ? article.value.notes : notesDraft.value,
      chapterNotes: chapterCount.value > 1 ? article.value.chapterNotes : undefined
    })
  } catch (e) {
    notesDraft.value = notesDraft.value + `<p>${escapeHtml(e instanceof AiError ? e.message : 'AI生成失败，请稍后重试')}</p>`
    syncNotesEditorFromDraft()
  } finally {
    generatingNotes.value = false
  }
}

const translating = ref(false)
const translateProgress = ref({ done: 0, total: 0 })
async function translateAll() {
  if (!article.value || !aiReady.value) return
  const a = article.value
  const missing = a.sentences.map((s, i) => (!s.zh ? i : -1)).filter(i => i >= 0)
  if (!missing.length) return
  translating.value = true
  translateProgress.value = { done: 0, total: missing.length }
  const BATCH = 15
  try {
    for (let i = 0; i < missing.length; i += BATCH) {
      const idxBatch = missing.slice(i, i + BATCH)
      const enBatch = idxBatch.map(idx => a.sentences[idx].en)
      const prompt =
        '请把下面编号的英文句子逐句翻译为简洁自然的中文，严格按照"编号: 译文"的格式逐行输出，不要添加其他内容：\n' +
        enBatch.map((s, k) => `${k + 1}. ${s}`).join('\n')
      const result = await askAi(prompt)
      const lines = result.split('\n').filter(l => l.trim())
      for (const line of lines) {
        const m = line.match(/^(\d+)[.:、]\s*(.+)$/)
        if (m) {
          const k = parseInt(m[1], 10) - 1
          if (idxBatch[k] !== undefined) a.sentences[idxBatch[k]].zh = m[2].trim()
        }
      }
      translateProgress.value.done = Math.min(missing.length, i + BATCH)
      await readerStore.saveArticle({ ...a })
    }
  } catch (e) {
    urlError.value = e instanceof AiError ? e.message : '翻译失败'
  } finally {
    translating.value = false
  }
}

const effectiveVocabBookName = computed(() => {
  if (!article.value) return ''
  if (article.value.vocabBookId) {
    const manual = wordStore.groups.find(g => g.id === article.value!.vocabBookId)
    if (manual) return manual.name
  }
  const artGroup = article.value.groupId ? readerStore.groups.find(g => g.id === article.value!.groupId) : null
  return artGroup ? artGroup.name : '未分组生词'
})

const topLevelVocabBooks = computed(() => wordStore.groups.filter(g => g.id.startsWith('book-') && !g.parentId))

async function ensureArticleGroup(): Promise<string | null> {
  if (!article.value) return null

  let rootId: string
  if (article.value.vocabBookId && wordStore.groups.find(g => g.id === article.value!.vocabBookId)) {
    rootId = article.value.vocabBookId
  } else {
    const artGroup = article.value.groupId ? readerStore.groups.find(g => g.id === article.value!.groupId) : null
    rootId = artGroup ? `book-notes-for-artgroup-${artGroup.id}` : 'book-notes-ungrouped'
    const rootName = artGroup ? artGroup.name : '未分组生词'
    if (!wordStore.groups.find(g => g.id === rootId)) {
      const now = new Date().toISOString()
      await wordStore.createGroup({
        id: rootId,
        name: rootName,
        description: artGroup ? `来自文章文件夹「${artGroup.name}」的划线生词` : '没有归到具体文件夹的文章生词',
        wordIds: [],
        createdAt: now,
        updatedAt: now
      })
    } else {
      const g = wordStore.groups.find(g => g.id === rootId)!
      if (artGroup && g.name !== artGroup.name) await wordStore.updateGroup(rootId, { name: artGroup.name })
    }
  }

  const gid = `book-reading-${article.value.id}`
  if (!wordStore.groups.find(g => g.id === gid)) {
    const now = new Date().toISOString()
    await wordStore.createGroup({
      id: gid,
      name: article.value.title,
      description: `来自文章《${article.value.title}》的标注生词`,
      parentId: rootId,
      wordIds: [],
      createdAt: now,
      updatedAt: now
    })
  } else {
    const g = wordStore.groups.find(g => g.id === gid)!
    if (g.parentId !== rootId) await wordStore.updateGroup(gid, { parentId: rootId })
    if (g.name !== article.value.title) await wordStore.updateGroup(gid, { name: article.value.title })
  }
  return gid
}

async function setVocabBookOverride(bookId: string | null) {
  if (!article.value) return
  await readerStore.saveArticle({ ...article.value, vocabBookId: bookId || undefined })
}

async function createVocabBookAndUse(name: string) {
  const trimmed = name.trim()
  if (!trimmed || !article.value) return
  const now = new Date().toISOString()
  const id = `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await wordStore.createGroup({ id, name: trimmed, description: '', wordIds: [], createdAt: now, updatedAt: now })
  await setVocabBookOverride(id)
}

const showVocabTargetPicker = ref(false)
const vocabTargetNewName = ref<string | null>(null)

async function onVocabTargetSelect(value: string) {
  if (value === '__new__') {
    vocabTargetNewName.value = ''
    return
  }
  vocabTargetNewName.value = null
  await setVocabBookOverride(value === '__auto__' ? null : value)
  showVocabTargetPicker.value = false
}

async function confirmVocabTargetNew() {
  if (vocabTargetNewName.value == null) return
  await createVocabBookAndUse(vocabTargetNewName.value)
  vocabTargetNewName.value = null
  showVocabTargetPicker.value = false
}

async function autoCollectMarkAsVocab(text: string) {
  if (!article.value) return
  const trimmed = text.trim()
  if (!trimmed) return
  const isWholeSentence = article.value.sentences.some(s => s.en.trim() === trimmed)
  if (isWholeSentence) return
  if (trimmed.split(/\s+/).filter(Boolean).length > 8) return

  const candidates = lookupCandidates(trimmed)
  let existing: WordItem | undefined
  let matchedForm = trimmed
  for (const cand of candidates) {
    existing = wordStore.words.find(x => x.word.toLowerCase() === cand.toLowerCase())
    if (existing) { matchedForm = cand; break }
  }
  if (!existing) {
    const meaning = /^[a-zA-Z' -]+$/.test(trimmed) ? await quickLookupMeaning(trimmed) : null
    if (meaning) matchedForm = meaning.matchedForm
    const now = new Date().toISOString()
    existing = {
      id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      word: matchedForm,
      phonetic: meaning?.phonetic || '',
      meanings: [{ chinese: meaning?.chinese || '', partOfSpeech: meaning?.pos || '' }],
      level: 'IELTS',
      source: `阅读：${article.value.title}`,
      status: 'unmarked',
      createdAt: now,
      updatedAt: now
    }
    await wordStore.addWord(existing)
  }
  const gid = await ensureArticleGroup()
  if (gid) {
    await wordStore.addWordToGroup(existing.id, gid)
    const chapterGroup = wordStore.groups.find(g => g.id === gid)
    if (chapterGroup?.parentId) await wordStore.addWordToGroup(existing.id, chapterGroup.parentId)
  }
}

async function generateRichWordEntry(word: string, context?: string): Promise<Partial<WordItem> | null> {
  if (!aiReady.value) return null
  try {
    const contextLine = context ? `\n这个词/短语是从这句话里划出来的："${context}"——meanings 数组第一项请给这句话里实际使用的那个义项，不要给这个词最常见但这句话里用不上的义项；其它义项可以照常补充在后面。` : ''
    const prompt = `请为英语单词"${word}"生成结构化学习词条，只输出 JSON 本身，不要 markdown 代码块标记、不要任何别的文字。格式：
{"phonetic":"音标(不带斜杠)","meanings":[{"chinese":"中文释义","partOfSpeech":"词性缩写如n./v./adj."}],"etymology":"词源学解释，没有就空字符串","memory_tips":"记忆技巧，没有就空字符串","common_phrases":[{"phrase_en":"常用短语英文","phrase_zh":"中文翻译"}],"synonyms":[{"word":"近义词","difference":"与原词的区别"}],"antonyms":[{"word":"反义词"}],"example_sentences":[{"en":"例句英文","zh":"例句中文"}],"detailed_explanation":"更详细的用法讲解，2-3句话"}
数组类字段（meanings/common_phrases/synonyms/antonyms/example_sentences）每项给1-3个，没有把握的内容对应字段给空数组，不要编造。${contextLine}`
    const raw = await askAi(prompt)
    const cleaned = raw.trim().replace(/^```(?:json)?\s*|```\s*$/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null // AI 没配置好，或者这次返回的不是合法 JSON——让调用方退回到已有的简单释义，不报错打断交互
  }
}

async function isDictionaryRecognized(word: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`)
    return res.ok
  } catch {
    return false
  }
}

async function getOrGenerateRichWordEntry(word: string, context?: string): Promise<WordItem | null> {
  const trimmed = word.trim()
  const candidates = lookupCandidates(trimmed)
  let existing: WordItem | undefined
  for (const cand of candidates) {
    existing = wordStore.words.find(w => w.word.toLowerCase() === cand.toLowerCase())
    if (existing) break
  }
  if (existing?.detailed_explanation) return existing
  let genTarget = trimmed
  if (candidates.length > 1) {
    genTarget = (await isDictionaryRecognized(candidates[0])) ? candidates[0] : candidates[1]
  }
  const rich = await generateRichWordEntry(genTarget, context)
  if (!rich) return existing || null
  if (existing) {
    await wordStore.updateWordFields(existing.id, rich)
    return wordStore.words.find(w => w.id === existing!.id) || existing
  }
  const now = new Date().toISOString()
  const created: WordItem = {
    id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    word: genTarget,
    phonetic: rich.phonetic || '',
    meanings: rich.meanings?.length ? rich.meanings : [{ chinese: '', partOfSpeech: '' }],
    level: 'IELTS',
    source: article.value ? `阅读：${article.value.title}` : undefined,
    status: 'unmarked',
    createdAt: now,
    updatedAt: now,
    ...rich
  }
  await wordStore.addWord(created)
  return created
}

function renderWordDetailHtml(w: WordItem, skipMeanings = false): string {
  const parts: string[] = []
  if (w.phonetic) parts.push(`<p>音标：${escapeHtml(w.phonetic)}</p>`)
  if (!skipMeanings) {
    for (const m of w.meanings || []) {
      if (m.chinese) parts.push(`<p>${m.partOfSpeech ? escapeHtml(m.partOfSpeech) + ' ' : ''}${escapeHtml(m.chinese)}</p>`)
    }
  }
  if (w.etymology) parts.push(`<p>词源：${escapeHtml(w.etymology)}</p>`)
  if (w.memory_tips) parts.push(`<p>记忆技巧：${escapeHtml(w.memory_tips)}</p>`)
  for (const p of w.common_phrases || []) {
    if (p.phrase_en) parts.push(`<p>短语：${escapeHtml(p.phrase_en)}${p.phrase_zh ? ' — ' + escapeHtml(p.phrase_zh) : ''}</p>`)
  }
  for (const s of w.synonyms || []) {
    if (s.word) parts.push(`<p>近义词：${escapeHtml(s.word)}${s.difference ? '（' + escapeHtml(s.difference) + '）' : ''}</p>`)
  }
  for (const a of w.antonyms || []) {
    if (a.word) parts.push(`<p>反义词：${escapeHtml(a.word)}</p>`)
  }
  for (const ex of w.example_sentences || []) {
    if (ex.en) parts.push(`<p>例句：${escapeHtml(ex.en)}${ex.zh ? ' / ' + escapeHtml(ex.zh) : ''}</p>`)
  }
  if (w.detailed_explanation) parts.push(`<p>${escapeHtml(w.detailed_explanation)}</p>`)
  return parts.join('') || '<p>没查到更多信息</p>'
}

async function toggleWordDetail(btn: HTMLElement) {
  const word = btn.dataset.word || ''
  if (!word) return
  const line = btn.closest('p')
  const existingDetail = line?.nextElementSibling
  if (existingDetail?.classList.contains('note-word-detail')) {
    const collapsed = existingDetail.classList.toggle('collapsed')
    btn.textContent = collapsed ? '详情 ▸' : '详情 ▾'
    return
  }
  const originalText = btn.textContent
  btn.textContent = '查询中…'
  btn.setAttribute('disabled', 'true')
  const linkEl = line?.querySelector('.note-mark-link') as HTMLElement | null
  const sentIdx = linkEl ? parseInt(linkEl.dataset.sentIdx || '-1', 10) : -1
  const context = sentIdx >= 0 ? article.value?.sentences[sentIdx]?.en || '' : ''
  const hasCompactDef = (line?.textContent || '').includes('：')
  const entry = await getOrGenerateRichWordEntry(word, context)
  btn.removeAttribute('disabled')
  if (!entry) {
    btn.textContent = originalText
    return
  }
  btn.textContent = '详情 ▾'
  const detailEl = document.createElement('div')
  detailEl.className = 'note-word-detail'
  detailEl.innerHTML = renderWordDetailHtml(entry, hasCompactDef)
  line?.insertAdjacentElement('afterend', detailEl)
  if (notesEditorEl.value) notesDraft.value = notesEditorEl.value.innerHTML
  saveNotes()
}

const IRREGULAR_FORMS: Record<string, string> = {
  went: 'go', gone: 'go', goes: 'go',
  was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be',
  had: 'have', has: 'have',
  did: 'do', does: 'do', done: 'do',
  made: 'make', said: 'say', says: 'say',
  saw: 'see', seen: 'see',
  came: 'come',
  took: 'take', taken: 'take',
  got: 'get', gotten: 'get',
  knew: 'know', known: 'know',
  thought: 'think',
  gave: 'give', given: 'give',
  found: 'find',
  told: 'tell',
  became: 'become',
  left: 'leave',
  felt: 'feel',
  brought: 'bring',
  began: 'begin', begun: 'begin',
  kept: 'keep',
  held: 'hold',
  wrote: 'write', written: 'write',
  stood: 'stand',
  heard: 'hear',
  let: 'let',
  meant: 'mean',
  set: 'set',
  met: 'meet',
  ran: 'run',
  paid: 'pay',
  sat: 'sit',
  spoke: 'speak', spoken: 'speak',
  lay: 'lie', lain: 'lie',
  led: 'lead',
  read: 'read',
  grew: 'grow', grown: 'grow',
  lost: 'lose',
  fell: 'fall', fallen: 'fall',
  sent: 'send',
  built: 'build',
  understood: 'understand',
  drew: 'draw', drawn: 'draw',
  broke: 'break', broken: 'break',
  spent: 'spend',
  cut: 'cut',
  rose: 'rise', risen: 'rise',
  drove: 'drive', driven: 'drive',
  bought: 'buy',
  wore: 'wear', worn: 'wear',
  chose: 'choose', chosen: 'choose',
  caught: 'catch',
  taught: 'teach',
  flew: 'fly', flown: 'fly',
  threw: 'throw', thrown: 'throw',
  shot: 'shoot',
  hung: 'hang',
  slept: 'sleep',
  ate: 'eat', eaten: 'eat',
  hid: 'hide', hidden: 'hide',
  shook: 'shake', shaken: 'shake',
  forgot: 'forget', forgotten: 'forget',
  swam: 'swim', swum: 'swim',
  sang: 'sing', sung: 'sing',
  rang: 'ring', rung: 'ring',
  drank: 'drink', drunk: 'drink',
  sank: 'sink', sunk: 'sink',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  mice: 'mouse', geese: 'goose', people: 'person',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad', further: 'far', farther: 'far',
  more: 'many', less: 'little'
}

function guessBaseForms(word: string): string[] {
  const w = word.toLowerCase()
  const c = new Set<string>()
  if (IRREGULAR_FORMS[w]) c.add(IRREGULAR_FORMS[w])
  if (/ies$/.test(w) && w.length > 4) c.add(w.slice(0, -3) + 'y') // cities -> city
  if (/[sxz]es$|[cs]hes$/.test(w)) c.add(w.slice(0, -2)) // watches -> watch
  if (/s$/.test(w) && !/ss$/.test(w) && w.length > 3) c.add(w.slice(0, -1)) // cats -> cat
  if (/ied$/.test(w) && w.length > 4) c.add(w.slice(0, -3) + 'y') // studied -> study
  if (/([^aeiou])\1ed$/.test(w)) c.add(w.slice(0, -3)) // stopped -> stop（双写辅音）
  if (/ed$/.test(w) && w.length > 3) { c.add(w.slice(0, -2)); c.add(w.slice(0, -1)) } // played->play, liked->like
  if (/([^aeiou])\1ing$/.test(w)) c.add(w.slice(0, -4)) // running -> run（双写辅音）
  if (/ing$/.test(w) && w.length > 5) { c.add(w.slice(0, -3)); c.add(w.slice(0, -3) + 'e') } // reading->read, making->make
  if (/ier$/.test(w) && w.length > 4) c.add(w.slice(0, -3) + 'y') // happier -> happy
  if (/iest$/.test(w) && w.length > 5) c.add(w.slice(0, -4) + 'y') // happiest -> happy
  if (/([^aeiou])\1er$/.test(w)) c.add(w.slice(0, -3)) // bigger -> big（双写辅音）
  if (/([^aeiou])\1est$/.test(w)) c.add(w.slice(0, -4)) // biggest -> big（双写辅音）
  if (/er$/.test(w) && w.length > 3) c.add(w.slice(0, -2)) // smaller -> small
  if (/est$/.test(w) && w.length > 4) c.add(w.slice(0, -3)) // smallest -> small
  c.delete(w)
  return [...c]
}

function lookupCandidates(text: string): string[] {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/).filter(Boolean)
  const candidates = [trimmed]
  if (words.length <= 1) {
    candidates.push(...guessBaseForms(trimmed))
  } else {
    for (const base of guessBaseForms(words[0])) {
      candidates.push([base, ...words.slice(1)].join(' '))
    }
  }
  return candidates
}

function isVocabbable(text: string): boolean {
  return /^[A-Za-z']+(\s[A-Za-z']+){0,3}$/.test(text.trim())
}

async function quickLookupMeaningExact(word: string, context?: string): Promise<{ chinese: string; pos: string; phonetic: string; dictionaryRecognized: boolean } | null> {
  const local = wordStore.words.find(w => w.word.toLowerCase() === word.toLowerCase())
  const localChinese = local?.meanings?.find(m => m.chinese?.trim())
  if (localChinese) {
    return { chinese: localChinese.chinese, pos: localChinese.partOfSpeech || '', phonetic: local?.phonetic || '', dictionaryRecognized: true }
  }
  let phonetic = ''
  let pos = ''
  let dictionaryRecognized = false
  let englishDef = ''
  if (!phonetic && !pos) {
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`)
      if (res.ok) {
        dictionaryRecognized = true
        const data = await res.json()
        const entry = Array.isArray(data) ? data[0] : null
        const m0 = entry?.meanings?.[0]
        if (entry) phonetic = entry.phonetic || (entry.phonetics || []).map((p: any) => p.text).find((t: string) => t) || ''
        if (m0) {
          const posAbbr = ({ noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', preposition: 'prep.', conjunction: 'conj.', pronoun: 'pron.', interjection: 'int.' } as Record<string, string>)[m0.partOfSpeech]
          pos = posAbbr || m0.partOfSpeech || ''
          englishDef = m0.definitions?.[0]?.definition || ''
        }
      }
    } catch {
    }
  }
  if (aiReady.value) {
    try {
      const prompt = context
        ? `这句话里出现了"${word}"："${context}"。只回答"${word}"在这句话里最贴切的中文释义，不超过6个字，不要解释、不要标点、不要引号。`
        : englishDef
          ? `"${word}" 的英文释义是"${englishDef}"。只回答这个词最常用的中文释义，不超过6个字，不要解释、不要标点、不要引号。`
          : `只回答英语单词"${word}"最常用的中文释义，不超过6个字，不要解释、不要标点、不要引号。`
      const zh = (await askAi(prompt)).trim().replace(/^["'“”]|["'“”]$/g, '')
      if (zh && zh.length <= 20) return { chinese: zh, pos, phonetic, dictionaryRecognized }
    } catch {
    }
  }
  return phonetic || pos ? { chinese: '', pos, phonetic, dictionaryRecognized } : null
}

async function quickLookupMeaning(word: string, context?: string): Promise<{ chinese: string; pos: string; phonetic: string; matchedForm: string } | null> {
  const candidates = lookupCandidates(word)
  const results: ({ chinese: string; pos: string; phonetic: string; dictionaryRecognized: boolean } | null)[] = []
  for (const cand of candidates) {
    results.push(await quickLookupMeaningExact(cand, context))
  }
  for (let i = 0; i < candidates.length; i++) {
    if (results[i]?.dictionaryRecognized && results[i]?.chinese) return { ...results[i]!, matchedForm: candidates[i] }
  }
  const fallbackOrder = candidates.length > 1 ? [1, 0] : [0]
  for (const i of fallbackOrder) {
    if (results[i]?.chinese) return { ...results[i]!, matchedForm: candidates[i] }
  }
  return null
}

const sentenceOffsets = computed(() => {
  const offsets: number[] = []
  let pos = 0
  for (const s of article.value?.sentences || []) {
    offsets.push(pos)
    pos += s.en.length + 1
  }
  return offsets
})

function offsetWithinEl(container: HTMLElement, node: Node, nodeOffset: number): number {
  try {
    const r = document.createRange()
    r.selectNodeContents(container)
    r.setEnd(node, nodeOffset)
    return r.toString().length
  } catch {
    return 0
  }
}

function globalOffsetOf(node: Node, nodeOffset: number): number | null {
  const el = (node.nodeType !== 1 ? node.parentElement : (node as HTMLElement)) || null
  const sentEl = el?.closest('[data-sent-idx]') as HTMLElement | null
  if (!sentEl) return null
  const sentIdx = parseInt(sentEl.dataset.sentIdx || '-1', 10)
  if (sentIdx < 0 || sentenceOffsets.value[sentIdx] === undefined) return null
  const within = offsetWithinEl(sentEl, node, nodeOffset)
  return sentenceOffsets.value[sentIdx] + within
}

function marksForSentence(i: number): { start: number; end: number; id: string; color: string }[] {
  if (!article.value?.marks?.length) return []
  const bStart = sentenceOffsets.value[i] ?? 0
  const text = article.value.sentences[i]?.en || ''
  const bEnd = bStart + text.length
  const out: { start: number; end: number; id: string; color: string }[] = []
  for (const m of article.value.marks) {
    if (m.sentIdx != null && m.sentIdx >= 0) {
      if (m.sentIdx !== i) continue
      let s = Math.max(0, m.localStart ?? 0)
      let e = Math.min(text.length, m.localEnd ?? 0)
      if (m.text && text.slice(s, e) !== m.text) {
        const foundIdx = text.indexOf(m.text)
        if (foundIdx >= 0) {
          s = foundIdx
          e = foundIdx + m.text.length
        }
      }
      if (e > s) out.push({ start: s, end: e, id: m.id, color: m.color || 'sand' })
      continue
    }
    const s = Math.max(m.start, bStart)
    const e = Math.min(m.end, bEnd)
    if (e > s) out.push({ start: s - bStart, end: e - bStart, id: m.id, color: m.color || 'sand' })
  }
  return out
}
function hasMark(i: number): string | null {
  const bStart = sentenceOffsets.value[i] ?? 0
  const bEnd = bStart + (article.value?.sentences[i]?.en.length || 0)
  const m = article.value?.marks?.find(m => m.start < bEnd && m.end > bStart)
  return m?.color || null
}

function zhMarksForSentence(i: number): { id: string; color: string; zhText?: string }[] {
  const bStart = sentenceOffsets.value[i] ?? 0
  const bEnd = bStart + (article.value?.sentences[i]?.en.length || 0)
  return (article.value?.marks || [])
    .filter(m => (m.sentIdx != null && m.sentIdx >= 0)
      ? m.sentIdx === i
      : (m.start < bEnd && m.end > bStart))
    .map(m => ({ id: m.id, color: m.color, zhText: m.zhText }))
}

function migrateMarksToSentenceAnchor() {
  const art = article.value
  if (!art?.marks?.length || !art.sentences?.length) return
  const offsets = sentenceOffsets.value
  let changed = false
  const migrated = art.marks.map(m => {
    if (m.sentIdx != null && m.sentIdx >= 0) return m // 已经是新格式
    let hitIdx = art.sentences.findIndex((s, i) => {
      const bStart = offsets[i] ?? 0
      return m.start >= bStart && m.start < bStart + s.en.length
    })
    let localStart: number, localEnd: number
    if (hitIdx >= 0) {
      const bStart = offsets[hitIdx] ?? 0
      localStart = Math.max(0, m.start - bStart)
      localEnd = Math.min(art.sentences[hitIdx].en.length, m.end - bStart)
    } else {
      const needle = (m.text || '').trim()
      if (!needle) return m
      hitIdx = art.sentences.findIndex(s => s.en.includes(needle))
      if (hitIdx < 0) return m // 实在找不到（比如整句被 AI 改写过）就先留着，不乱猜
      localStart = art.sentences[hitIdx].en.indexOf(needle)
      localEnd = localStart + needle.length
    }
    changed = true
    return { ...m, sentIdx: hitIdx, localStart, localEnd }
  })
  if (changed) {
    readerStore.saveArticle({ ...art, marks: migrated })
  }
}
watch(() => article.value?.id, () => { nextTick(migrateMarksToSentenceAnchor) }, { immediate: true })

const HL_COLORS = [
  { name: 'sand', hex: '#c9b287' },
  { name: 'sage', hex: '#9ab094' },
  { name: 'mist', hex: '#94a8b8' },
  { name: 'rose', hex: '#c49e9e' },
  { name: 'lilac', hex: '#aaa0ba' },
  { name: 'clay', hex: '#c49480' }
]

interface PendingSel { text: string; start: number; end: number; isSingleWord: boolean }
const markMenu = ref<{ x: number; y: number } | null>(null)
const editMarkMenu = ref<{ x: number; y: number; markId: string } | null>(null)
const pendingSelIsWord = ref(false)
const pendingSelDef = ref('')
const pendingSelBaseForm = ref('')
let pendingSelZhText: string | null = null // 从中文那侧点句子标记时，直接就知道对应的中文是什么，不用等AI猜
const pendingSel = ref<PendingSel | null>(null)

function placeMarkMenu(centerX: number, top: number, bottom: number): { x: number; y: number } {
  const MENU_H = 140
  const MARGIN = 10
  const x = Math.min(Math.max(8, centerX - 100), window.innerWidth - 220)
  if (top - MENU_H - MARGIN >= 0) return { x, y: top - MENU_H - MARGIN }
  if (bottom + MENU_H + MARGIN <= window.innerHeight) return { x, y: bottom + MARGIN }
  return { x, y: Math.max(8, Math.min(top - 90, window.innerHeight - MENU_H - 8)) }
}

function showMenuForSelection() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() || ''
  if (!sel || !text || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  let startG = globalOffsetOf(range.startContainer, range.startOffset)
  let endG = globalOffsetOf(range.endContainer, range.endOffset)
  if (startG == null || endG == null) {
    const fullText = article.value?.sentences.map(s => s.en).join(' ') || ''
    const idx = fullText.indexOf(text)
    if (idx < 0) return
    startG = idx
    endG = idx + text.length
  }
  const start = Math.min(startG!, endG!)
  const end = Math.max(startG!, endG!)
  if (end <= start) return
  editMarkMenu.value = null
  pendingSel.value = { text, start, end, isSingleWord: /^[A-Za-z']+$/.test(text) }
  pendingSelIsWord.value = pendingSel.value.isSingleWord
  pendingSelDef.value = ''
  pendingSelBaseForm.value = ''
  pendingSelZhText = null
  setAgentSelectionContext(text)
  const rect = range.getBoundingClientRect()
  markMenu.value = placeMarkMenu(rect.left + rect.width / 2, rect.top, rect.bottom)
  if (pendingSel.value.isSingleWord) {
    const wordAtLookup = text
    const context = sentenceTextAtOffset(start)
    quickLookupMeaning(wordAtLookup, context).then(meaning => {
      if (pendingSel.value?.text === wordAtLookup && meaning?.chinese) {
        pendingSelDef.value = meaning.chinese
        if (meaning.matchedForm.toLowerCase() !== wordAtLookup.toLowerCase()) pendingSelBaseForm.value = meaning.matchedForm
      }
    })
  }
}

function onTextSelected() {
  if (editMarkMenu.value) return // 刚点开编辑已有标记的菜单，不要被这次 mouseup 顶掉
  const sel = window.getSelection()
  if (!sel || !sel.toString().trim()) {
    if (markMenu.value) closeFloatingMenus()
    return
  }
  showMenuForSelection()
}

function onTokenClick(payload: { text: string; isWord: boolean; markId?: string; event: MouseEvent }) {
  const { markId, event } = payload
  if (markId) {
    markMenu.value = null
    pendingSel.value = null
    pendingSelIsWord.value = false
    pendingSelDef.value = ''
    pendingSelZhText = null
    editMarkMenu.value = { x: Math.min(event.clientX, window.innerWidth - 190), y: event.clientY + 14, markId }
    const hitMarkText = article.value?.marks?.find(m => m.id === markId)?.text
    setAgentSelectionContext(hitMarkText || payload.text)
    return
  }
  const el = event.target as HTMLElement
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  nextTick(showMenuForSelection)
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

function ensureNotesHtml(raw: string): string {
  if (!raw) return ''
  if (raw.includes('<')) return raw
  return `<p>${escapeHtml(raw).replace(/\n/g, '<br>')}</p>`
}

async function confirmMark(color: string, skipNotesLine = false) {
  if (!pendingSel.value || !article.value) return
  const { text, start, end } = pendingSel.value
  const knownZhText = pendingSelZhText
  const wasWord = pendingSelIsWord.value
  const wordDef = pendingSelDef.value
  const baseForm = pendingSelBaseForm.value
  markMenu.value = null
  pendingSel.value = null
  pendingSelIsWord.value = false
  pendingSelDef.value = ''
  pendingSelBaseForm.value = ''
  pendingSelZhText = null
  window.getSelection()?.removeAllRanges()

  const existed = (article.value.marks || []).find(m => m.start === start && m.end === end)
  const markId = existed?.id || `mk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const offsets = sentenceOffsets.value
  const anchorIdx = (article.value.sentences || []).findIndex((s, i) => {
    const bStart = offsets[i] ?? 0
    return start >= bStart && start < bStart + s.en.length + 1
  })
  const anchorBStart = anchorIdx >= 0 ? (offsets[anchorIdx] ?? 0) : 0
  let localStart = anchorIdx >= 0 ? Math.max(0, start - anchorBStart) : 0
  let localEnd = anchorIdx >= 0
    ? Math.min(article.value.sentences[anchorIdx].en.length, end - anchorBStart)
    : 0
  if (anchorIdx >= 0) {
    const sentText = article.value.sentences[anchorIdx].en
    if (sentText.slice(localStart, localEnd) !== text) {
      const foundIdx = sentText.indexOf(text)
      if (foundIdx >= 0) {
        localStart = foundIdx
        localEnd = foundIdx + text.length
      }
    }
  }
  const marks = existed
    ? (article.value.marks || []).map(m => (m.id === existed.id ? { ...m, color } : m))
    : [
        ...(article.value.marks || []),
        { id: markId, text, start, end, sentIdx: anchorIdx, localStart, localEnd, color, note: '', zhText: knownZhText || undefined, createdAt: new Date().toISOString() }
      ]
  await readerStore.saveArticle({ ...article.value, marks })

  if (!existed && !skipNotesLine) {
    const displayText = baseForm || text
    const linkedWord = `<a href="#" class="note-mark-link" data-sent-idx="${anchorIdx}">${escapeHtml(displayText)}</a>`
    const vocabbable = isVocabbable(text)
    const expandBtn = vocabbable ? ` <button class="note-expand-btn" data-word="${escapeHtml(displayText)}">详情 ▸</button>` : ''
    const line = wasWord && wordDef ? `<p>• ${linkedWord}：${escapeHtml(wordDef)}${expandBtn}</p>` : `<p>• ${linkedWord}${expandBtn}</p>`
    notesDraft.value = insertVocabEntry(notesDraft.value, line, anchorIdx)
    syncNotesEditorFromDraft()
    saveNotes()
  }

  if (!existed && !knownZhText) findZhCounterpart(markId, text, start)
  if (!existed) autoCollectMarkAsVocab(text)
}

function onZhSentenceClick(i: number, event: MouseEvent) {
  if (!article.value) return
  const sentence = article.value.sentences[i]
  const bStart = sentenceOffsets.value[i] ?? 0
  const bEnd = bStart + sentence.en.length
  editMarkMenu.value = null
  pendingSel.value = { text: sentence.en, start: bStart, end: bEnd, isSingleWord: false }
  pendingSelIsWord.value = false
  pendingSelDef.value = ''
  pendingSelZhText = sentence.zh || null
  setAgentSelectionContext(sentence.zh ? `${sentence.en}\n${sentence.zh}` : sentence.en)
  markMenu.value = placeMarkMenu(event.clientX, event.clientY - 4, event.clientY + 4)
}

async function findZhCounterpart(markId: string, enText: string, globalStart: number) {
  if (!aiReady.value || !article.value) return
  const offs = sentenceOffsets.value
  let sentIdx = 0
  for (let i = 0; i < offs.length; i++) {
    if (offs[i] <= globalStart) sentIdx = i
    else break
  }
  const sentence = article.value.sentences[sentIdx]
  if (!sentence?.zh) return
  try {
    const result = await askAi(
      `英文原句："${sentence.en}"\n对应中文译文："${sentence.zh}"\n英文原句里被标记的这一小段是："${enText}"\n请只回复中文译文里跟这一小段英文对应的那个具体片段（必须是中文译文里逐字存在的一段连续文字，不要加引号、不要解释、不要标点符号前后缀，找不到精确对应就回复"无"）。`
    )
    const zhSnippet = result.trim().replace(/^["「『]|["」』]$/g, '')
    if (zhSnippet && zhSnippet !== '无' && sentence.zh.includes(zhSnippet) && zhSnippet.length < sentence.zh.length) {
      const article2 = readerStore.current
      if (!article2) return
      const marks2 = (article2.marks || []).map(m => (m.id === markId ? { ...m, zhText: zhSnippet } : m))
      await readerStore.saveArticle({ ...article2, marks: marks2 })
    }
  } catch {
  }
}

function copySelection() {
  if (pendingSel.value) navigator.clipboard?.writeText(pendingSel.value.text).catch(() => {})
  markMenu.value = null
  pendingSel.value = null
  pendingSelIsWord.value = false
  pendingSelDef.value = ''
  pendingSelZhText = null
}

async function analyzeSentenceGrammar() {
  if (!pendingSel.value || !article.value || !aiReady.value) return
  const text = pendingSel.value.text
  await confirmMark('mist', true)
  const justCreated = (article.value.marks || []).slice().reverse().find(m => m.text === text)
  const sentIdx = justCreated?.sentIdx ?? -1
  const shownText = text.length > 40 ? text.slice(0, 40) + '…' : text
  const linkedText = `<a href="#" class="note-mark-link" data-sent-idx="${sentIdx}">${escapeHtml(shownText)}</a>`
  const loadingLine = `<p>• 语法分析：${linkedText}（分析中…）</p>`
  notesDraft.value = notesDraft.value + loadingLine
  syncNotesEditorFromDraft()
  saveNotes()
  try {
    const result = await askAi(`请对下面这句英语的语法结构做简明讲解（句子成分、从句类型、特殊语法点等），用中文说明，2-4句话，不要客套话：\n\n${text}`)
    const doneLine = `<p>• 语法分析：${linkedText}</p><div class="note-word-detail">${escapeHtml(result).replace(/\n/g, '<br>')}</div>`
    notesDraft.value = notesDraft.value.includes(loadingLine) ? notesDraft.value.replace(loadingLine, doneLine) : notesDraft.value + doneLine
  } catch (e) {
    const failLine = `<p>• 语法分析：${linkedText}（${escapeHtml(e instanceof AiError ? e.message : '分析失败，请稍后重试')}）</p>`
    notesDraft.value = notesDraft.value.includes(loadingLine) ? notesDraft.value.replace(loadingLine, failLine) : notesDraft.value + failLine
  }
  syncNotesEditorFromDraft()
  saveNotes()
}

async function deleteMark(id: string) {
  if (!article.value) return
  const marks = (article.value.marks || []).filter(m => m.id !== id)
  await readerStore.saveArticle({ ...article.value, marks })
  editMarkMenu.value = null
}

async function setMarkColor(id: string, color: string) {
  if (!article.value) return
  const marks = (article.value.marks || []).map(m => (m.id === id ? { ...m, color } : m))
  await readerStore.saveArticle({ ...article.value, marks })
}

function jumpToChapter(sentenceIndex: number) {
  activeChapter.value = sentenceIndex
  const idx = article.value?.chapters?.findIndex(c => c.sentenceIndex === sentenceIndex) ?? -1
  if (idx >= 0 && idx !== chapterPage.value) {
    stashNotePage()
    chapterPage.value = idx
    notesDraft.value = readNotePage(idx)
    if (notesEditorEl.value) notesEditorEl.value.innerHTML = notesDraft.value
  }
  onStudyJump(sentenceIndex)
}

function closeFloatingMenus() {
  markMenu.value = null
  editMarkMenu.value = null
  pendingSel.value = null
  pendingSelIsWord.value = false
  pendingSelDef.value = ''
  pendingSelZhText = null
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeFloatingMenus()
}

onMounted(async () => {
  await wordStore.loadWords()
  await readerStore.loadArticles()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  reciteRecognizer?.stop()
  shadowRecognizer?.stop()
  clearArticleQuickActions()
  readingArticleTitle.value = null
  sidePanelOpen.value = false
})

const mfaAligning = ref(false)

async function runMfaAutoAlign() {
  if (!article.value) return
  mfaAligning.value = true
  try {
    let file = await getArticleAudioFile(article.value.id)
    if (!file) {
      const picked = await pickArticleAudio(article.value.id)
      if (!picked) { mfaAligning.value = false; return }
      file = await getArticleAudioFile(article.value.id)
    }
    if (!file) throw new Error('没能读取到本地关联的音频文件')
    const uploaded = await be.beUploadAudio(article.value.id, file)
    if (!uploaded) throw new Error('上传音频到后端失败——确认后端启动了（backend/README.md 有步骤），且装好了 MFA/ffmpeg')
    const result = await be.beAlignAudio(article.value.id)
    if (!result) throw new Error('对齐没有返回结果')
    await readerStore.saveArticle({ ...article.value, sentences: result.sentences, audioFileName: uploaded.audioFileName })
    const hasNote = result.sentences.some((s: any) => s._alignNote)
    setLastQuickActionResult(
      !hasNote,
      hasNote ? '对齐完成，但有几句词对不上，检查一下音频和文本是否完全一致（详情在后端返回里）' : '对齐完成，跟读模式现在能放真人原声了'
    )
  } catch (e) {
    setLastQuickActionResult(false, e instanceof Error ? e.message : 'MFA自动对齐失败')
  } finally {
    mfaAligning.value = false
  }
}

const articleQuickActionsComputed = computed<ArticleQuickAction[]>(() => {
  if (!article.value) return []
  const actions: ArticleQuickAction[] = []
  actions.push({
    key: 'notes',
    label: generatingNotes.value ? 'AI生成笔记中…' : 'AI生成学习笔记',
    disabled: generatingNotes.value || !aiReady.value,
    title: aiReady.value ? '' : '请先在设置里配置 API Key',
    run: generateNotes
  })
  if (needsTranslation.value) {
    actions.push({
      key: 'translate',
      label: translating.value ? `AI翻译中 ${translateProgress.value.done}/${translateProgress.value.total}` : 'AI 翻译全文',
      disabled: translating.value || !aiReady.value,
      title: aiReady.value ? '' : '请先在设置里配置 API Key',
      run: translateAll
    })
  }
  if (article.value.needsCleanup) {
    actions.push({
      key: 'cleanup',
      label: cleaning.value ? 'AI整理中…' : 'AI整理成清晰文章',
      disabled: cleaning.value || !aiReady.value,
      title: aiReady.value ? '' : '请先在设置里配置 API Key',
      run: cleanupTranscript
    })
  }
  actions.push({
    key: 'audio-align-manual',
    label: viewSubMode.value === 'audioAlign' ? '关闭音频对轴工具' : '打开音频对轴工具（手动标时间点）',
    run: () => { viewSubMode.value = viewSubMode.value === 'audioAlign' ? 'read' : 'audioAlign' }
  })
  if (readerStore.backendReachable) {
    actions.push({
      key: 'audio-align-mfa',
      label: mfaAligning.value ? 'MFA自动对齐中…（可能要等一会）' : '用MFA自动对齐音频（后端）',
      disabled: mfaAligning.value,
      title: '需要后端装好 MFA/ffmpeg，见 backend/README.md',
      run: runMfaAutoAlign
    })
  }
  return actions
})

watch(articleQuickActionsComputed, actions => setArticleQuickActions(actions), { immediate: true })

watch(article, a => {
  chapterPage.value = 0
  notesDraft.value = ensureNotesHtml(
    (a?.chapters?.length || 0) > 1 ? (a?.chapterNotes?.[0] ?? a?.notes ?? '') : (a?.notes || '')
  )
  syncNotesEditorFromDraft()
  readingArticleTitle.value = a?.title || null
  syncReciteDrafts(a || null)
  reciteRecordingIdx.value = null
  showOriginal.value = false
  viewSubMode.value = 'read'
  editingTitle.value = false
  shadowResults.value = {}
  shadowRecordingIdx.value = null
  reciteFeedback.value = ''
}, { immediate: true })

watch(() => article.value?.sentences.length, () => {
  if (viewSubMode.value === 'recite' || reciteDrafts.value.length) syncReciteDrafts(article.value || null)
})

watch(sidePanelOpen, open => { if (open) syncNotesEditorFromDraft() })
</script>

<style lang="scss" scoped>
.reading {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 24px 60px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.article-list-view, .article-view {
  flex: 1;
  min-width: 0;
}

.article-view {
  background: var(--r-paper, transparent);
  border-radius: 14px;
  padding: 20px 24px 30px;
  transition: background 0.2s;
}

.article-list-view { }
.list-toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
.restore-message { font-size: 12.5px; color: #666; margin: -4px 0 12px; }
.list-search {
  border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 9px 14px; font-size: 14px; outline: none; width: 220px;
  &:focus { border-color: #999; }
}
.list-select {
  border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 9px 12px; font-size: 13.5px; outline: none; background: #fff;
  &:focus { border-color: #999; }
}
.new-group-row { display: flex; gap: 8px; margin-bottom: 14px; }
.new-group-row input {
  border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 8px 12px; font-size: 13.5px; outline: none; width: 260px;
  &:focus { border-color: #999; }
}

.batch-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: #fafafa; border: 1px solid #eee; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; font-size: 13.5px; color: #555;
}
.ghost-btn.danger { color: #b05a4a; border-color: #ecd4cf; &:hover { background: #f9ece9; } }

.article-list { border: 1px solid #eee; border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
.article-row {
  display: flex; align-items: center; gap: 10px; padding: 11px 16px;
  border-bottom: 1px solid var(--r-border, #eee);
  &:last-child { border-bottom: none; }
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, transparent); }
  &.sel { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 11%, transparent); }
}
.back-to-list {
  border: none; background: none; cursor: pointer; padding: 4px 0;
  font-size: 13px; color: var(--r-ink2, #888);
  transition: color .15s ease;
  &:hover { color: var(--r-accent, #8a4b3a); }
}
.a-lead {
  display: grid; grid-template-columns: 18px 20px 20px;
  align-items: center; gap: 8px; flex-shrink: 0;
}
.a-lead-ph { display: block; width: 18px; }
.a-tail {
  display: grid; grid-template-columns: 52px 56px 44px 62px 44px;
  align-items: center; gap: 8px; flex-shrink: 0;
}
.a-tail > * { justify-self: center; text-align: center; }
.article-list.selecting .article-row { user-select: none; }
.a-tail .a-meta { text-align: right; }
.a-flag.ghost { visibility: hidden; }
.a-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; color: var(--r-ink, #1a1a1a); font-size: 14.5px; &:hover { color: #555; text-decoration: underline; } }
.a-title-edit {
  flex: 1; border: 1px solid #999; border-radius: 6px; padding: 4px 8px; font-size: 14.5px; outline: none;
}
.a-rename { border: none; background: none; color: #bbb; cursor: pointer; line-height: 0; padding: 2px; &:hover { color: #555; } }
.a-bookmark { border: none; background: none; color: #ddd; cursor: pointer; line-height: 0; padding: 2px; flex-shrink: 0; &:hover { color: #c9a35a; } &.on { color: #d9a441; } }
.a-completed { border: none; background: none; color: #ddd; cursor: pointer; line-height: 0; padding: 2px; flex-shrink: 0; &:hover { color: #6a9c5a; } &.on { color: #5a9d4a; } }
.article-row.cleaning::after {
  content: '';
  position: absolute; left: 0; bottom: 0; height: 2px;
  width: var(--clean-pct, 30%);
  background: var(--r-accent, #e8622a);
  transition: width .3s ease;
}
.article-row.cleaning { position: relative; }
.article-row.completed { background: #f4faf1; &:hover { background: #eef7e9; } }
.a-rename-confirm, .a-rename-cancel {
  border: none; background: none; cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 4px;
}
.a-rename-confirm { color: #4a7d3a; &:hover { background: #eef4e8; } }
.a-rename-cancel { color: #b05a4a; &:hover { background: #f9ece9; } }
.select-mode-bar {
  display: flex; align-items: center; gap: 12px; background: #fdf6e8; border: 1px solid #f0e2bd; color: #8a6d2f;
  border-radius: 8px; padding: 8px 14px; margin-bottom: 10px; font-size: 13px;
}
.a-flag { font-size: 11px; color: #8a6d2f; background: #fdf6e8; border: 1px solid #f0e2bd; border-radius: 8px; padding: 2px 8px; }
.a-meta { color: #999; font-size: 12.5px; flex-shrink: 0; }
.a-del { border: none; background: none; color: #ccc; cursor: pointer; font-size: 13px; &:hover { color: #b05a4a; } }

.import-panel {
  border: 1px solid #eee; border-radius: 12px; padding: 18px 20px; margin-bottom: 18px;
  h1 { font-size: 24px; color: #1a1a1a; }
  .sub { color: #888; margin: 6px 0 20px; font-size: 14px; }
}
.paste-area {
  width: 100%;
  min-height: 160px;
  border: 1px solid var(--r-border, #ddd);
  border-radius: 10px;
  padding: 14px;
  font-size: 14px;
  resize: vertical;
  outline: none;
  margin-bottom: 10px;
  &:focus { border-color: #999; }
}
.title-input, .url-input {
  border: 1px solid var(--r-border, #ddd);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
  outline: none;
  &:focus { border-color: #999; }
}
.title-input { width: 100%; margin-bottom: 14px; }
.import-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.url-input { flex: 1; }
.file-btn {
  border: 1px solid var(--r-border, #ddd);
  border-radius: 8px;
  padding: 9px 16px;
  font-size: 14px;
  cursor: pointer;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
}
.hint { color: #999; font-size: 12.5px; }
.batch-msg { color: #4a7d3a; font-size: 13px; margin-bottom: 10px; }
.err-text { color: #b05a4a; font-size: 13px; margin-bottom: 8px; }
.start-btn {
  border: none;
  background: var(--r-accent, #8a4b3a);
  color: #fff;
  border-radius: 10px;
  padding: 11px 26px;
  font-size: 15px;
  cursor: pointer;
  margin-top: 6px;
  &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.seg { display: inline-flex; background: var(--r-ui, #f2f2f2); border-radius: 10px; padding: 4px; }
.seg-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: none; background: none; padding: 7px 14px; border-radius: 8px; font-size: 13.5px; cursor: pointer; color: #444;
  &.on { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); box-shadow: 0 1px 4px rgba(0,0,0,0.1); font-weight: 600; }
}
.ghost-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent); background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); border-radius: 8px; padding: 7px 14px; font-size: 13.5px; cursor: pointer; color: #444;
  &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
  &.on { background: var(--r-accent, #8a4b3a); color: #fff; border-color: transparent; }
}
.file-import-btn { display: inline-flex; align-items: center; }
.dark-btn {
  box-shadow: 0 1px 2px color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
  border: none; background: var(--r-accent, #8a4b3a); color: #fff; border-radius: 8px; padding: 8px 16px; font-size: 13.5px; cursor: pointer;
  &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.title-row { display: flex; align-items: center; gap: 8px; }
.title-edit-btn { border: none; background: none; cursor: pointer; color: #999; line-height: 0; &:hover { color: #333; } }
.title-bookmark-btn { border: none; background: none; cursor: pointer; color: #ddd; line-height: 0; &:hover { color: #c9a35a; } &.on { color: #d9a441; } }
.title-completed-btn { border: none; background: none; cursor: pointer; color: #ddd; line-height: 0; &:hover { color: #6a9c5a; } &.on { color: #5a9d4a; } }
.title-edit-input {
  font-size: 21px; font-weight: 700; color: #1a1a1a; border: none; border-bottom: 2px solid var(--r-accent, #8a4b3a); outline: none; padding: 0 2px; flex: 1; max-width: 480px;
}
.article-title { cursor: text; &:hover { color: #555; } }

.cleanup-banner {
  background: #fdf6e8;
  border: 1px solid #f0e2bd;
  color: #8a6d2f;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  margin: 6px 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  span { flex: 1; }
}

.article-title { font-size: 21px; color: var(--r-ink, #1a1a1a); margin-bottom: 2px; }
.meta { color: var(--r-ink2, #999); font-size: 13px; margin-bottom: 18px; }

.content.layout-split { display: flex; flex-direction: column; gap: 0; }
.split-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  padding: 10px 0;
  border-bottom: 1px dashed #f2f2f2;
  align-items: start;
  &:last-child { border-bottom: none; }
}
.content .en { font-size: 15.5px; color: var(--r-ink, #1a1a1a); line-height: 1.8; }
.content .zh { font-size: 14.5px; color: var(--r-ink2, #666); line-height: 1.9; }
.en-placeholder, .zh-placeholder { margin: 0; }
.content.layout-bilingual .block.en { margin-bottom: 18px; }
.sentence-row { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px dashed var(--r-border, #f0f0f0); }
.sentence-row .en { margin-bottom: 4px; }
.sentence-row.jump-flash { animation: jumpFlash 1.6s ease; }
@keyframes jumpFlash {
  0% { background: #fdf0d5; }
  100% { background: transparent; }
}

.recite-panel { padding: 6px 0; }
.recite-hint { color: #888; font-size: 13.5px; margin-bottom: 12px; }
.recite-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.recite-item {
  display: flex; gap: 10px;
  padding: 10px 12px;
  border: 1px solid #eee; border-radius: 10px; background: #fff;
}
.recite-idx {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
  background: var(--r-ui, #f2f2f2); color: #999;
  font-size: 11.5px; line-height: 22px; text-align: center;
}
.recite-body { flex: 1; min-width: 0; }
.recite-item-cn { color: #555; font-size: 14.5px; line-height: 1.75; margin-bottom: 6px; }
.recite-item-en { color: #1a1a1a; font-size: 14px; line-height: 1.7; margin-bottom: 6px; background: #fafafa; border-radius: 6px; padding: 6px 9px; }
.recite-item-input { display: flex; gap: 8px; align-items: flex-start; }
.recite-input {
  flex: 1; min-width: 0;
  min-height: 52px; border: 1px solid var(--r-border, #ddd); border-radius: 8px;
  padding: 9px 11px; font-size: 14px; line-height: 1.6;
  resize: vertical; outline: none;
  &:focus { border-color: #999; }
}
.recite-progress { color: #999; font-size: 13px; align-self: center; margin-right: auto; }
.recite-legacy {
  margin-top: 16px; background: #fdfaf3; border: 1px dashed #e3d8c0; border-radius: 10px; padding: 12px 14px;
  h4 { font-size: 13px; color: #8a7a55; margin-bottom: 6px; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 13.5px; color: #6b6255; line-height: 1.7; }
}
.recite-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; align-items: center; }
.recite-feedback {
  margin-top: 16px;
  background: #fafafa;
  border-radius: 10px;
  padding: 14px 16px;
  h4 { font-size: 14px; color: #1a1a1a; margin-bottom: 8px; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 13.5px; color: #333; line-height: 1.7; }
}

.shadow-panel { padding-top: 4px; }
.shadow-real-audio-tag {
  font-size: 10.5px; color: #4a7d3a; background: #eef4e8; border-radius: 6px; padding: 1px 6px; margin-left: 8px;
}

.align-panel { padding-top: 4px; }
.align-audio-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
.align-audio-player { width: 100%; margin: 12px 0; }
.align-list { margin-top: 16px; }
.align-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed #f0f0f0;
  &.current { background: #fafaf5; }
  &.done .align-idx { background: #e8f2e2; color: #4a7d3a; }
}
.align-idx {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background: #f0f0f0; color: #888;
  display: flex; align-items: center; justify-content: center; font-size: 11px;
}
.align-text { flex: 1; font-size: 13.5px; color: #333; }
.align-time { font-size: 11.5px; color: #8a6d2f; cursor: pointer; &:hover { text-decoration: underline; } }
.shadow-item {
  padding: 14px 0;
  border-bottom: 1px dashed #f0f0f0;
  &:last-child { border-bottom: none; }
}
.shadow-en {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15.5px;
  color: #1a1a1a;
  margin-bottom: 8px;
  .icon-btn { border: none; background: none; cursor: pointer; color: #555; line-height: 0; &:hover { color: #000; } }
}
.shadow-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13.5px; }
.ghost-btn.small { padding: 5px 12px; font-size: 12.5px; }
.shadow-score {
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 10px;
  &.good { background: #eef4e8; color: #4a7d3a; }
  &.mid { background: #fdf6e8; color: #8a6d2f; }
  &.low { background: #f9ece9; color: #b05a4a; }
}
.shadow-heard { color: #777; }

.mark-menu {
  position: fixed;
  z-index: 300;
  background: var(--r-accent, #8a4b3a);
  border-radius: 10px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  .mm-row { display: flex; align-items: center; gap: 6px; }
  .color-dot {
    width: 20px; height: 20px; border-radius: 50%; cursor: pointer; display: inline-block; flex-shrink: 0;
    border: 2px solid rgba(255, 255, 255, 0.15);
    &:hover { transform: scale(1.15); border-color: #fff; }
    transition: transform 0.1s;
  }
  button {
    border: none; background: none; color: #fff; font-size: 12.5px; padding: 6px 12px; border-radius: 5px; cursor: pointer; white-space: nowrap;
    &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.15); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
  .mm-danger { color: #e0a396; &:hover { background: rgba(224, 100, 80, 0.2); } }
}
.zh-clickable { cursor: pointer; &:hover { background: rgba(0,0,0,0.02); border-radius: 4px; } }
.menu-mask { position: fixed; inset: 0; z-index: 299; }

.side-panel { display: contents; }
.side-resizer {
  position: absolute; left: -3px; top: 0; bottom: 0; width: 7px;
  cursor: col-resize; z-index: 2;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent); }
}
.side-panel-body {
  position: fixed;
  right: 0;
  top: 44px;
  bottom: 0;
  width: clamp(300px, 26vw, 460px);
  background: var(--r-ui, #fff);
  border-left: 1px solid var(--r-border, #e4e4e4);
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  z-index: 90;
}
.side-resize-handle {
  position: absolute; top: 0; right: -4px; bottom: 0; width: 8px; cursor: col-resize; z-index: 2;
  &:hover { background: color-mix(in srgb, var(--r-accent, #999) 15%, transparent); }
}
.side-body-scroll { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 16px; overflow-y: auto; }
.mini-accordion {
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  border: none; background: none; cursor: pointer; padding: 6px 2px; flex-shrink: 0;
  font-size: 13px; color: var(--r-ink2, #555);
  &:hover { color: var(--r-ink, #1a1a1a); }
}
.toc-list-inline { max-height: 160px; overflow-y: auto; margin-top: 4px; }
.toc-item {
  display: block; width: 100%; text-align: left; border: none; background: none; cursor: pointer;
  padding: 7px 8px; border-radius: 6px; font-size: 13.5px; color: var(--r-ink2, #444);
  &:hover { background: color-mix(in srgb, var(--r-accent, #999) 8%, transparent); }
}

.save-vocab-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 350; display: flex; align-items: center; justify-content: center;
}
.save-vocab-box {
  background: #fff; border-radius: 12px; padding: 22px; width: min(360px, 90vw); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.svb-word { font-size: 16px; font-weight: 600; color: #1a1a1a; margin-bottom: 14px; }
.s-label { display: block; font-size: 12.5px; color: #666; margin-bottom: 6px; }
.svb-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.section-split-box { width: min(440px, 90vw); }
.section-chip-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; max-height: 160px; overflow-y: auto; }
.section-chip { background: #f2ece0; border-radius: 6px; padding: 4px 10px; font-size: 12.5px; color: #5a4f3c; }

.notes-pager { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.np-btn {
  width: 26px; height: 26px; border-radius: 7px; cursor: pointer; font-size: 15px; line-height: 1;
  border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff); color: var(--r-ink, #333);
}
.np-btn:disabled { opacity: 0.35; cursor: default; }
.np-sel {
  flex: 1; min-width: 0; padding: 5px 8px; font-size: 12.5px; border-radius: 7px;
  border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff); color: inherit;
}
.notes-box { margin-top: 0; border-top: none; padding-top: 0; flex: 1; display: flex; flex-direction: column; min-height: 0; }
.notes-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; flex-shrink: 0; }
.notes-ai-btn {
  border: 1px solid var(--r-border, #ddd);
  background: var(--r-ui, #fff);
  color: var(--r-accent, #3a86ff);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #3a86ff) 10%, var(--r-ui, #fff)); }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
}
.notes-area {
  width: 100%; flex: 1; min-height: 160px; padding: 0; font-size: 13.5px; line-height: 1.7; outline: none; box-sizing: border-box; overflow-y: auto;
  &:empty::before { content: attr(data-placeholder); color: #999; pointer-events: none; }
}
.vocab-target-row { margin-top: 8px; flex-shrink: 0; }
.vocab-target-toggle {
  border: none; background: none; cursor: pointer; color: #888; font-size: 12px; padding: 0;
  strong { color: #555; font-weight: 600; }
  &:hover { color: #555; }
}
.vocab-target-picker { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.s-select {
  border: 1px solid var(--r-border, #ddd); border-radius: 7px; padding: 6px 10px; font-size: 12.5px; outline: none; background: #fff;
  &:focus { border-color: #999; }
}
.s-input {
  border: 1px solid var(--r-border, #ddd); border-radius: 7px; padding: 6px 10px; font-size: 12.5px; outline: none;
  &:focus { border-color: #999; }
}

@media (max-width: 700px) {
  .reading { padding: 12px 14px 40px; flex-wrap: wrap; }
  .split-row { grid-template-columns: 1fr; gap: 4px; }
  .list-toolbar { flex-direction: column; align-items: stretch; }
  .list-search { width: auto; }
  .batch-bar { flex-direction: column; align-items: flex-start; }
  .article-row { flex-wrap: wrap; }
  .a-meta { order: 10; }
  .study-panel { width: 100%; }
  .save-vocab-box { width: calc(100vw - 32px); }
  .article-view { margin: 0; padding: 14px 14px 24px; }
  .side-panel-body { width: min(300px, 86vw); }
  .notes-area { min-height: 220px; }
}
.ghost-btn.disabled { opacity: 0.5; pointer-events: none; }

.shadow-bar {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 10px 12px; margin-bottom: 14px; border-radius: 10px;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 6%, transparent);
}
.sb-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--r-ink2, #777); }
.sb-sel {
  padding: 4px 8px; border-radius: 7px; font-size: 12.5px;
  border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff); color: inherit;
}
.shadow-item.playing {
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--r-accent, #8a4b3a);
  border-radius: 8px;
}

</style>

<style>
.reading-mark { border-radius: 2px; cursor: pointer; }
.hl-sand { background: #f3d98a; border-bottom: 2px solid #c9a227; }
.hl-sage { background: #b8d4a8; border-bottom: 2px solid #6b9450; }
.hl-mist { background: #a8c8dc; border-bottom: 2px solid #4a7fa0; }
.hl-rose { background: #e8b0b0; border-bottom: 2px solid #c06868; }
.hl-lilac { background: #c8b8e0; border-bottom: 2px solid #8868b8; }
.hl-clay { background: #e0b088; border-bottom: 2px solid #b87038; }
.zh-marked { background: #fdf3e0; border-radius: 4px; padding: 2px 4px; margin: -2px -4px; }
.word-token { cursor: pointer; border-radius: 3px; padding: 0 1px; }
.word-token:hover { background: #fde9c8; }

.notes-area p { margin: 0 0 8px; }
.notes-area p:last-child { margin-bottom: 0; }
.notes-area strong { color: var(--r-ink, #1a1a1a); }
.note-mark-link {
  color: var(--r-accent, #3a86ff);
  text-decoration: underline;
  text-decoration-style: dotted;
  cursor: pointer;
}
.note-mark-link:hover { text-decoration-style: solid; }
.note-expand-btn {
  border: none; background: none; cursor: pointer; color: #999; font-size: 11.5px; padding: 0 0 0 4px;
}
.note-expand-btn:hover:not(:disabled) { color: #666; }
.note-expand-btn:disabled { cursor: default; }
.note-word-detail {
  font-size: 12.5px; color: #666; margin: 2px 0 10px 6px; padding-left: 10px; border-left: 2px solid #eee;
}
.note-word-detail p { margin: 0 0 4px; }
.note-word-detail p:last-child { margin-bottom: 0; }
.note-word-detail.collapsed { display: none; }

.reader-wrap { position: relative; flex: 1; min-width: 0; }
.lb-toast {
  position: fixed; right: 20px; bottom: 20px; z-index: 200;
  max-width: min(460px, 80vw); padding: 11px 14px; border-radius: 10px;
  background: var(--r-ink, #1f2328); color: #fff; font-size: 13px; line-height: 1.6;
  box-shadow: 0 6px 20px rgba(0,0,0,.18); cursor: pointer; white-space: pre-wrap;
}

.chapter-toc {
  position: fixed;
  left: calc(var(--lb-nav-w, 178px) + 14px);
  top: 56px;
  width: 210px;
  max-height: calc(100vh - 76px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e2e2e2);
  border-radius: 10px;
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.07);
  overflow: hidden;
}
.chapter-toc.folded { width: auto; }

.toc-fold {
  border: none;
  background: transparent;
  color: var(--r-ink2, #888);
  font-size: 12.5px;
  padding: 7px 12px;
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
  &:hover { color: var(--r-ink, #333); }
}
.toc-scroll {
  overflow-y: auto;
  border-top: 1px solid var(--r-border, #f0f0f0);
  padding: 4px 0 6px;
}
.toc-row {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--r-ink2, #666);
  font-size: 12.5px;
  line-height: 1.5;
  padding: 5px 12px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  &:hover { background: var(--r-ui, #f5f5f5); color: var(--r-ink, #222); }
  &.on { color: var(--r-accent, #8a4b3a); font-weight: 600; }
}

@media (max-width: 1280px) {
  .chapter-toc { top: 84px; right: 8px; width: 168px; }
}
@media (max-width: 860px) {
  .chapter-toc { display: none; }
}
.a-cleanup, .a-export {
  border: none; background: none; color: #ccc; cursor: pointer; font-size: 13px;
  opacity: 0; transition: opacity .12s ease, color .12s ease; white-space: nowrap;
  &:disabled { cursor: default; color: #ddd; }
}
.article-row:hover .a-export { opacity: 1; }
.a-export:hover { color: var(--r-accent, #8a4b3a); }
.a-del { opacity: 0; transition: opacity .12s ease; }
.article-row:hover .a-del { opacity: 1; }
.article-row:hover .a-cleanup { opacity: 1; }
.a-cleanup:hover:not(:disabled) { color: var(--r-accent, #8a4b3a); }
.ghost-btn.disabled { opacity: 0.5; pointer-events: none; }

.shadow-bar {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 10px 12px; margin-bottom: 14px; border-radius: 10px;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 6%, transparent);
}
.sb-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--r-ink2, #777); }
.sb-sel {
  padding: 4px 8px; border-radius: 7px; font-size: 12.5px;
  border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff); color: inherit;
}
.shadow-item.playing {
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--r-accent, #8a4b3a);
  border-radius: 8px;
}

</style>
