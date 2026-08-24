<template>
  <div class="reading" :class="{ 'shadow-on': viewSubMode === 'shadow' && alignedCount > 0 }">
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
          >
            <span class="toc-text">{{ ch.title }}</span>
            <span v-if="article.lastChapter === ch.sentenceIndex" class="toc-mark" title="上次读到这里">🔖</span>
          </button>

          <button class="toc-add" title="把别的文章作为新章节加到这本书末尾" @click="showAppendPicker = true">
            + 添加章节
          </button>
        </div>
      </div>

      <!-- 书的章节列表：照 TypeWords book/[id].vue 的两栏布局，
           左列 w-80(20rem) 常驻可滚，右列正文。不是浮层目录。 -->
      <!-- 章节列表照 ArticleList.vue：顶部搜索框，每条是「序号. 标题」+ 副标题，
           右侧一个操作位。它是页内的一栏，本来就不需要折叠；我们这里做成浮层，
           所以补一个折叠钮。 -->
      <aside
        v-if="currentBook && bookChapters.length > 1"
        class="book-side"
        :class="{ folded: bookSideFolded }"
        :style="bookSideFolded ? undefined : { width: bookSideWidth + 'px' }"
      >
        <!-- 右边缘拖动改宽度：章节标题长的时候把框往右拖 -->
        <div v-if="!bookSideFolded" class="bs-resizer" @pointerdown="startBookResize"></div>
        <div class="bs-head">
          <span v-if="!bookSideFolded" class="bs-title">{{ currentBook.name }}</span>
          <button class="bs-fold" :title="bookSideFolded ? '展开目录' : '收起目录'" @click="bookSideFolded = !bookSideFolded">
            {{ bookSideFolded ? `目录 ${bookChapters.length}` : '‹' }}
          </button>
        </div>

        <template v-if="!bookSideFolded">
          <div class="bs-search">
            <input v-model="chapterSearch" placeholder="搜章节，输数字直接跳" />
          </div>

          <div class="bs-list">
            <div v-for="(c, i) in shownChapters" :key="c.id" class="bs-slot">
              <button
                v-if="!chapterSearch && c.idx > 0"
                class="bs-join up"
                title="与上一章合并"
                @click.stop="mergeChapters(c.idx - 1, c.idx)"
              >+</button>

              <!-- 章节名改成可以双击重命名，右侧给一个删除 -->
              <input
                v-if="renamingChapter === c.idx"
                ref="chapterRenameInput"
                v-model="chapterRenameText"
                class="bs-rename"
                @keydown.enter="commitChapterRename(c.idx)"
                @keydown.esc="renamingChapter = -1"
                @blur="commitChapterRename(c.idx)"
              />
              <!-- 章节也能拖着换顺序，跟文章列表一个手感 -->
              <button
                v-else
                class="bs-item"
                :class="{ on: c.idx === bookIndex, 'drop-before': chDropIdx === c.idx && chDropAfter === false, 'drop-after': chDropIdx === c.idx && chDropAfter === true }"
                draggable="true"
                @click="gotoBookChapter(c.idx)"
                @dblclick.stop="startChapterRename(c.idx, c.title)"
                @dragstart="onChDragStart(c.idx, $event)"
                @dragover.prevent="onChDragOver(c.idx, $event)"
                @dragleave="onChDragLeave(c.idx)"
                @drop.prevent="onChDrop(c.idx)"
                @dragend="onChDragEnd"
              >
                <span class="bs-no">{{ c.idx + 1 }}.</span>
                <!-- 正在播的那一章挂个喇叭：整本循环会自己跳章，
                     不给个标记的话不知道现在放到哪本书的哪一章了 -->
                <span v-if="playingChapterIdx === c.idx" class="bs-speaker" title="正在播放">
                  <svg viewBox="0 0 24 24" width="12" height="12">
                    <path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>
                  </svg>
                </span>
                <span class="bs-name" title="双击可以改名">{{ c.title }}</span>
                <span class="bs-cnt">{{ c.sentences.length }}</span>
                <span class="bs-ops">
                  <span class="bs-op" title="上移" @click.stop="moveChapter(c.idx, -1)">↑</span>
                  <span class="bs-op" title="下移" @click.stop="moveChapter(c.idx, 1)">↓</span>
                  <span class="bs-op" :class="{ hot: chapterFlag(c.idx, 'pinned') }" title="置顶" @click.stop="toggleChapterFlag(c.idx, 'pinned')">顶</span>
                  <span class="bs-op" :class="{ hot: chapterFlag(c.idx, 'starred') }" title="收藏" @click.stop="toggleChapterFlag(c.idx, 'starred')">★</span>
                  <span class="bs-op" title="改名" @click.stop="startChapterRename(c.idx, c.title)">改名</span>
                  <span class="bs-op danger" title="移出这本书" @click.stop="removeChapter(c.idx)">移出</span>
                </span>
              </button>

              <button
                v-if="!chapterSearch && c.idx < bookChapters.length - 1"
                class="bs-join down"
                title="与下一章合并"
                @click.stop="mergeChapters(c.idx, c.idx + 1)"
              >+</button>
            </div>
            <p v-if="!shownChapters.length" class="bs-empty">没有匹配的章节</p>

            <!-- 目录末尾：从已有文章里挑一篇加进来当章节 -->
            <button class="bs-add" @click="showChapterPicker = true">
              <span class="nb-plus">+</span> 添加章节
            </button>
            <!-- 一次选一堆音频，自动跟章节配对 -->
            <label class="bs-add">
              <span class="nb-plus">♪</span> 批量导入音频
              <input type="file" accept="audio/*,video/*" multiple hidden @change="onBatchAudio" />
            </label>
          </div>
        </template>
      </aside>

      <!-- 配对结果确认：猜错了可以改，也可以整条不要 -->
      <div v-if="showPairConfirm" class="picker-mask" @click.self="showPairConfirm = false">
        <div class="picker-box">
          <div class="picker-head">
            <strong>确认配对（{{ audioPairs.length }} 个）</strong>
            <button class="ghost-btn small" @click="showPairConfirm = false">取消</button>
          </div>
          <div class="picker-list">
            <div v-for="(p, i) in audioPairs" :key="i" class="pair-row">
              <span class="pi-title">{{ p.chapter.title }}</span>
              <span class="pair-arrow">←</span>
              <span class="pi-title">{{ p.file.name }}</span>
              <span class="pair-score" :class="{ weak: p.score < 0.5 }">{{ p.reason }}</span>
              <button class="tc-btn" title="不要这条" @click="audioPairs.splice(i, 1)">移除</button>
            </div>
          </div>
          <div class="picker-head">
            <span class="pi-cnt">确认后会逐个导入并排队对轴</span>
            <button class="dark-btn small" :disabled="!audioPairs.length" @click="confirmBatchAudio">
              确认导入
            </button>
          </div>
        </div>
      </div>

      <!-- 选文章加进书里：只列没被别的书收走的 -->
      <div v-if="showChapterPicker" class="picker-mask" @click.self="showChapterPicker = false">
        <div class="picker-box">
          <div class="picker-head">
            <strong>添加章节到《{{ currentBook?.title }}》</strong>
            <button class="ghost-btn small" @click="showChapterPicker = false">关闭</button>
          </div>
          <input v-model="chapterPickSearch" class="picker-search" placeholder="搜索文章标题" />
          <div class="picker-list">
            <button
              v-for="a in pickableArticles"
              :key="a.id"
              class="picker-item"
              @click="addChapterFromArticle(a)"
            >
              <span class="pi-title">{{ a.title }}</span>
              <span class="pi-cnt">{{ a.sentences.length }} 句</span>
            </button>
            <p v-if="!pickableArticles.length" class="bs-empty">没有可添加的文章</p>
          </div>
        </div>
      </div>

      <div v-if="currentBook && bookChapters.length > 1" class="book-nav">
        <button class="ghost-btn small" :disabled="bookIndex <= 0" @click="gotoBookChapter(bookIndex - 1)">‹ 上一章</button>
        <select class="book-sel" :value="bookIndex" @change="gotoBookChapter(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="(c, i) in bookChapters" :key="c.id" :value="i">
            第 {{ i + 1 }} 章 · {{ c.title }}
          </option>
        </select>

        <button class="ghost-btn small" :disabled="bookIndex >= bookChapters.length - 1" @click="gotoBookChapter(bookIndex + 1)">下一章 ›</button>
        <span class="book-pos">{{ bookIndex + 1 }} / {{ bookChapters.length }}</span>
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
        <!-- 三档拨杆：中间=中英都显示，拨左=遮中文，拨右=遮英文。
             像双掷开关，点一下换一档，转一圈回到中间。 -->
        <button class="lang-toggle" :class="'pos-' + langPos" :title="langTitle" @click="cycleLang">
          <span class="lt-side" :class="{ dim: !showChinese }">中</span>
          <span class="lt-track"><span class="lt-knob"></span></span>
          <span class="lt-side" :class="{ dim: !showEnglish }">英</span>
        </button>
        <!-- 「复述练习」按钮去掉了：跟读模式里把英文关掉就是复述，
             不该是两个并列的模式。 -->
        <button class="ghost-btn" :class="{ on: viewSubMode === 'shadow' }" title="放一句原声，自己跟一句，录下来对比" @click="viewSubMode = viewSubMode === 'shadow' ? 'read' : 'shadow'">跟读模式</button>
        <!-- 导入音频/视频的入口原来只在右下角 AI 面板的动作列表里，找不到。放到顶栏。 -->
        <button class="ghost-btn" :class="{ on: viewSubMode === 'audioAlign' }" @click="viewSubMode = viewSubMode === 'audioAlign' ? 'read' : 'audioAlign'">音频 / 视频</button>
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

      <!-- 复述面板已并入跟读模式：关掉英文即为复述 -->

      <!-- 跟读模式也能划线做笔记：这个 mouseup 原来只挂在阅读模式那边 -->
      <div v-if="viewSubMode === 'shadow'" class="shadow-panel" @mouseup="onTextSelected">
        <!-- 跟读现在不做识别也不打分，这条提示留着只会误导：
             它说的「没有自动打分」在任何浏览器上都成立。整条去掉。 -->
        <div v-if="alignedCount > 0" class="shadow-bar" :style="shadowBarStyle">
          <div class="sb-drag" title="拖动可以移动这个面板" @pointerdown="onBarDragStart"></div>
          <!-- 播放键居中，两侧留给次要控件，看起来才像个播放器 -->
          <div class="sb-row">
            <div class="sb-left">
              <select v-model="loopMode" class="sl-pick" title="循环方式">
                <option value="none">不循环</option>
                <option value="sentence">单句循环</option>
                <option value="article">本篇循环</option>
                <option value="list" v-if="bookChapters.length > 1">整本循环</option>
              </select>
            </div>
            <div class="sb-play">
              <button class="ghost-btn small" title="上一句" @click="jumpShadow(playingIdx - 1)">‹</button>
              <button class="dark-btn small play-btn" @click="toggleContinuous">
                {{ continuousOn ? '⏸' : '▶' }}
              </button>
              <button class="ghost-btn small" title="下一句" @click="jumpShadow(playingIdx + 1)">›</button>
            </div>
            <span class="sb-right">
              <label class="sb-item" title="点播放 = 一句原声 + 一段留白，留白里自动录音">
                <input v-model="shadowDrill" type="checkbox" /> 跟读
              </label>
              <label class="sb-item" title="句子下面出现输入框，自己把这句写出来">
                <input v-model="reciteMode" type="checkbox" /> 复述
              </label>
              <!-- 放什么：原声 / 自己的录音 / 原声接录音。
                   这儿原来是个「连听 N」按钮，一有录音就冒出来把别的控件挤掉，
                   而且它只会整篇拼一遍播，跟循环、速度、停顿都不搭。
                   挪进下拉之后，逐句播放和整篇循环都按这个来源走。 -->
              <select v-if="recCount" v-model="playSource" class="sl-pick" title="放什么">
                <option value="origin">原声</option>
                <option value="mine">我的录音</option>
                <option value="both">原声 → 我的</option>
              </select>
              <button v-if="recCount" class="ghost-btn small" title="逐句对比原声和自己读的时长" @click="showRecCompare = true">
                对比
              </button>
              <span class="sb-idx">{{ playingIdx >= 0 ? `${playingIdx + 1}/${article.sentences.length}` : '' }}</span>
            </span>
          </div>

          <!-- 一行一条拉条：左边选调什么，右边一条通用的拉条。
               三条并排太占地方，竖排又太高，这样最省空间。 -->
          <div class="sb-slider">
            <select v-model="sliderTarget" class="sl-pick">
              <option value="volume">音量</option>
              <option value="rate">速度</option>
              <option value="gap">停顿</option>
            </select>
            <input
              class="sl-range"
              type="range"
              :min="sliderCfg.min"
              :max="sliderCfg.max"
              :step="sliderCfg.step"
              :value="sliderCfg.value"
              @input="onSliderInput(($event.target as HTMLInputElement).valueAsNumber)"
            />
            <span class="sl-val">{{ sliderCfg.text }}</span>
          </div>
        </div>

        <div
          class="shadow-item"
          v-for="(s, i) in article.sentences"
          :key="i"
          :class="{ playing: playingIdx === i }"
          @click="jumpShadow(i)"
          :ref="el => setShadowRowRef(el, i)"
        >
          <!-- 跟读模式原来只渲染英文，中英拨杆当然没反应——没有中文可显示 -->
          <div v-if="showEnglish" class="shadow-en">
            <!-- 用 ClickableSentence 而不是裸 span：跟读模式原来鼠标浮上去
                 没有释义，就是因为这里没走那个组件（它才带悬浮查词和标记） -->
            <ClickableSentence
              :text="s.en"
              :sent-idx="i"
              :marks="marksForSentence(i)"
              @token-click="onTokenClick"
            />
            <button class="icon-btn" @click.stop="playSentenceSmart(i)">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>
            </button>
          </div>
          <p v-if="showChinese && s.zh" class="shadow-zh">{{ s.zh }}</p>


          <!-- 同上：控制条里的按钮各自 stop 过了，但按钮之间的空白没有 -->
          <div class="shadow-controls" @click.stop>
            <!-- 跟读就是录音，一个按钮：录下声音 + 同时识别打分。
                 之前拆成「开始跟读」和小麦克风两个，各做一半 ——
                 点前者只识别不录音（所以看不到音量波动），点后者只录音不打分。 -->
            <button
              v-if="shadowDrill"
              class="mic-btn"
              :class="{ on: recordingIdx === i }"
              :style="recordingIdx === i ? { '--lv': micLevel } : undefined"
              :title="recordingIdx === i ? '停止（再点一次结束）' : (hasRec[i] ? '重录这一句（会覆盖旧的）' : '录下自己读的')"
              @click.stop="toggleRecord(i, s.en)"
            >
              <svg v-if="recordingIdx === i" viewBox="0 0 24 24" width="13" height="13">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="15" height="15">
                <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>
              </svg>
            </button>

            <!-- 一排竖条跟着说话跳动。每根对应一个频段，高低各自变化 -->
            <span v-if="recordingIdx === i" class="wave">
              <i
                v-for="(h, b) in micBands"
                :key="b"
                :style="{ transform: `scaleY(${(0.2 + h * 0.8 * waveShape[b]).toFixed(3)})` }"
              ></i>
            </span>
            <span v-if="recordingIdx === i" class="rec-hint">{{ recSeconds }}s</span>

            <!-- 录完就一行：多长、放一下、删掉。原声用句子右边那个喇叭，不重复放按钮 -->
            <template v-if="shadowDrill && hasRec[i] && recordingIdx !== i">
              <span class="rec-len">{{ recLen[i] ? recLen[i].toFixed(1) + 's' : '已录' }}</span>
              <button class="icon-btn" title="听我读的" @click.stop="playMine(i)">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
              </button>
              <!-- 原声接着自己的连着放。分两次点中间隔几秒，差别就听不出来了 -->
              <button class="icon-btn" :class="{ on: abIdx === i }" title="原声 → 我的，连着放" @click.stop="playBoth(i)">
                <svg viewBox="0 0 24 24" width="15" height="15">
                  <path fill="currentColor" d="M4 6h2v12H4zM8 5v14l8-7zM18 6h2v12h-2z"/>
                </svg>
              </button>
              <button class="icon-btn danger" title="删掉，重新录" @click.stop="dropRecording(i)">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 7h12l-1 13H7L6 7zm3-3h6l1 2H8l1-2z"/></svg>
              </button>
            </template>

            <!-- 分数先不显示。本机 wav2vec2-base 对短录音的识别很糙，
                 拿它去比对算出来的分只会误导人。等识别质量能看了再放出来。 -->
          </div>

          <!-- 文字版就在录音下面。识别出来的话自动落这儿，也能自己改。
               只用一个箭头收放，不加多余文案。 -->
          <!-- 一直在，只是默认折起来。之前写成"有内容才显示"，
               等于没内容时压根找不到入口 -->
          <!-- 整块吞掉点击：这一行的 @click 是「跳到这句并播放」，
               而点输入框、点折叠箭头都会冒泡上去，本意是想打字，结果开始朗读 -->
          <div v-if="reciteMode" class="recite-wrap" @click.stop>
            <button class="recite-toggle" :title="reciteOpen[i] ? '收起' : '展开'" @click="toggleRecite(i)">
              {{ reciteOpen[i] ? '▾' : '▸' }}
              <span v-if="!reciteOpen[i]" class="recite-peek">{{ reciteDrafts[i] }}</span>
            </button>
            <template v-if="reciteOpen[i]">
              <textarea
                v-model="reciteDrafts[i]"
                class="recite-inline"
                rows="1"
                @input="autoGrow"
                @blur="saveReciteDrafts"
              ></textarea>
            </template>
          </div>
        </div>
      </div>

      <div
        v-else-if="viewSubMode === 'audioAlign'"
        class="align-panel"
        @dragover="onMediaDragOver"
        @dragleave="onMediaDragLeave"
        @drop="onMediaDrop"
      >
        <div v-if="!article.audioFileName" class="drop-zone" :class="{ active: dropActive, busy: videoBusy }">
          <div class="dz-main">{{ videoBusy ? videoProgress : '把视频 / 音频 / 字幕拖到这里' }}</div>
          <div class="dz-actions">
            <label class="ghost-btn" :class="{ disabled: videoBusy }">
              选择视频
              <input type="file" accept="video/*" hidden :disabled="videoBusy" @change="onPickVideo" />
            </label>
            <button class="ghost-btn" :disabled="alignLoading" @click="doPickAudio">
              {{ alignLoading ? '选择中…' : '选择音频' }}
            </button>
          </div>
        </div>
        <div class="align-audio-row" v-else>
          <span class="lib-status">已关联「{{ article.audioFileName }}」</span>
          <button class="ghost-btn small" @click="doPickAudio">换一个</button>
          <button class="ghost-btn small" @click="doClearAudio">取消关联</button>
        </div>
        <!-- 关联还在但读不到：以前这里什么都不显示，
             整个播放器和对轴列表凭空消失，看着像功能坏了 -->
        <div v-if="article.audioFileName && !audioObjectUrl" class="align-audio-row">
          <span class="err-text">读不到这个文件，可能被移动或删掉了</span>
          <button class="ghost-btn small" @click="doPickAudio">重新选择</button>
        </div>
        <p v-if="alignMessage" class="err-text">{{ alignMessage }}</p>

        <div class="align-audio-row">
          <label class="ghost-btn">
            导入字幕
            <input type="file" accept=".srt,.vtt,.txt" hidden @change="onPickSubtitle" />
          </label>
          <!-- 手动标时间点时常需要放慢来听清 -->
          <label v-if="audioObjectUrl" class="sb-item">
            播放速度
            <select v-model.number="alignRate" class="sb-sel">
              <option :value="0.5">0.5x</option>
              <option :value="0.6">0.6x</option>
              <option :value="0.75">0.75x</option>
              <option :value="0.9">0.9x</option>
              <option :value="1">1.0x</option>
              <option :value="1.25">1.25x</option>
            </select>
          </label>
        </div>
        <div class="align-audio-row" v-if="audioObjectUrl">
          <button class="ghost-btn" :disabled="autoAligning" @click="doAutoAlign">
            {{ autoAligning ? '对轴中…' : '按长度估算' }}
          </button>
          <button class="dark-btn" :disabled="myAligning || !audioObjectUrl" @click="doForcedAlign">
            {{ myAligning ? myAlignText : '强制对齐' }}
          </button>
          <button class="ghost-btn" :disabled="myAligning || !audioObjectUrl" @click="doTranscribe">
            {{ myAligning ? '识别中…' : '语音识别对轴' }}
          </button>
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
          <!-- 点色块划线；右键把它设成默认色（收藏单词、语法分析这类入口用默认色） -->
          <span
            v-for="c in HL_COLORS"
            :key="c.name"
            class="color-dot"
            :class="{ cur: defaultHl === c.name }"
            :style="{ background: c.hex }"
            :title="defaultHl === c.name ? c.label + '（当前默认）' : c.label + '　右键设为默认'"
            @click="confirmMark(c.name)"
            @contextmenu.prevent="defaultHl = c.name"
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
              <!-- 选项要用 notePageTitles：书的章节在 bookChapters 里，
                   而这里原来读的是 article.chapters（旧模型的分章），
                   书里那个是空的 —— 分页器显示出来了却一个选项都没有。
                   另外必须走 gotoNotePage：直接 v-model 改值不会先存当前页，
                   用下拉切页编辑内容就丢了。 -->
              <select
                :value="chapterPage"
                class="np-sel"
                @change="gotoNotePage(Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="(t, i) in notePageTitles" :key="i" :value="i">
                  第 {{ i + 1 }}/{{ chapterCount }} 页 · {{ t }}
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
      <div class="search-row">
        <input v-model="articleSearch" class="list-search" placeholder="搜索标题或正文…" />
      </div>

      <div class="list-toolbar">
        <select v-model="groupFilter" class="list-select">
          <option value="all">全部分组（{{ readerStore.articles.filter(a => !a.partOfBook).length }}）</option>
          <option value="none">未分组（{{ ungroupedCount }}）</option>
          <option v-for="g in readerStore.groups" :key="g.id" :value="g.id">{{ g.name }}（{{ groupCount(g.id) }}）</option>
        </select>
        <button class="ghost-btn" @click="showGroupManager = true">管理分组</button>
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
        <div
          class="drop-zone"
          :class="{ active: fileDropActive, busy: importingFile }"
          @dragover.prevent="fileDropActive = true"
          @dragleave="fileDropActive = false"
          @drop.prevent="onFileDrop"
        >
          <div class="dz-main">{{ importingFile ? '正在解析文件…' : '把文件拖到这里，或' }}</div>
          <div class="dz-actions">
            <label class="file-btn">
              选择文件（可多选）
              <input type="file" multiple :accept="SUPPORTED_ARTICLE_EXTS" hidden :disabled="importingFile" @change="onFilePick" />
            </label>
          </div>
          <span class="hint">TXT / MD / HTML / DOCX / PDF</span>
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
        <button v-if="batchCleaning" class="ghost-btn small danger" title="停止，已完成的部分保留" @click="unstickBatch">停止</button>
        <button class="ghost-btn small" :disabled="selectedIds.size < 2 || merging" @click="openMergeDialog">
          {{ merging ? '合并中…' : '合成一本书' }}
        </button>
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
          :class="{
            sel: selectedIds.has(a.id),
            completed: a.completed,
            cleaning: cleaningOneId === a.id,
            aligning: !!taskFor(a.id)
          }"
          :style="cleaningOneId === a.id ? { '--clean-pct': cleanPct }
            : taskFor(a.id) ? { '--clean-pct': pctOf(taskFor(a.id)!.ratio) } : undefined"
          draggable="true"
          @pointerdown="onRowPointerDown(a.id, $event); armDrag(a.id)"
          @pointerup="disarmDrag"
          @pointerleave="disarmDrag"
          @dragstart="onDragStart(a, $event)"
          @dragover.prevent="onDragOver(a, $event)"
          @dragleave="onDragLeave(a)"
          @drop.prevent="onDrop(a)"
          @dragend="onDragEnd"
        >
          <span v-if="dropHintId === a.id" class="drop-line" :class="dropMode"></span>
          <!-- 左侧红色书签：告诉你这一行现在可以拖了 -->
          <span v-if="dragReadyId === a.id || draggingId === a.id" class="drag-flag"></span>
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
            :class="{ 'is-book': a.isBook }"
            @click="selectMode ? onRowClick(a.id, $event) : openBookOrArticle(a)"
          >{{ a.title }}<span v-if="a.isBook" class="book-badge">{{ a.chapterIds?.length || 0 }} 章</span></span>
          <button v-if="editingListTitleId !== a.id" class="a-rename" title="重命名" @click.stop="startListTitleEdit(a)">
            <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <div class="a-tail">
            <span class="a-flag" :class="{ ghost: !a.needsCleanup }">{{ a.needsCleanup ? '待整理' : '' }}</span>
            <!-- 只显示属于这一篇的进度：以前用的是全局 aligningId，
                 多篇同时跑时进度会串到别的文章那一行 -->
            <span v-if="taskFor(a.id)" class="a-meta align-msg">{{ taskFor(a.id)!.detail }}</span>
            <!-- 书的章数已经在标题后面的徽章里了，这里不再重复；
                 它自己没有正文，显示句数恒为 0 更没意义 -->
            <span v-else-if="a.isBook"></span>
            <span v-else class="a-meta">{{ a.sentences.length }} 句</span>
            <button class="a-export" title="导出这一篇" @click.stop="exportOne(a)">导出</button>
            <button
              v-if="cleaningOneId === a.id"
              class="a-cleanup stop"
              title="停止整理（已完成的部分会保留）"
              @click.stop="stopCleanup"
            >停止</button>
            <button
              v-else
              class="a-cleanup"
              :disabled="!!cleaningOneId"
              :title="a.needsCleanup ? 'AI 整理这一篇' : '重新整理这一篇（会重翻全篇）'"
              @click.stop="cleanupOne(a)"
            >{{ a.needsCleanup ? '整理' : '重新整理' }}</button>
            <button
              v-if="(a.chapters?.length || 0) > 1"
              class="a-export"
              :disabled="merging"
              title="按章拆成独立文章，原书保留"
              @click.stop="splitBookBack(a)"
            >拆开</button>
            <button class="a-del" @click.stop="removeArticle(a.id)">删除</button>
          </div>
        </div>
        <!-- 列表末尾的新建书：把文章拖到这里也能直接建一本 -->
        <button
          v-if="filteredArticles.length"
          class="new-book-box"
          :class="{ hot: newBookHot }"
          @click="createEmptyBook"
          @dragover.prevent="newBookHot = true"
          @dragleave="newBookHot = false"
          @drop.prevent="onDropToNewBook"
        >
          <span class="nb-plus">+</span>
          <span>新建一本书{{ draggingId ? '（把文章拖进来）' : '' }}</span>
        </button>

        <p v-if="!filteredArticles.length" class="empty-hint">
          {{ readerStore.articles.length ? '这个分组/搜索下没有文章' : '还没有文章，点上面"新建/导入文章"开始' }}
        </p>
      </div>
    </aside>
    </div>
  </div>

    <div v-if="showGroupManager" class="append-mask" @click.self="showGroupManager = false">
      <div class="append-box">
        <div class="append-title">管理分组</div>
        <div class="append-list">
          <div v-for="g in readerStore.groups" :key="g.id" class="grp-row">
            <span class="grp-name">{{ g.name }}</span>
            <span class="grp-cnt">{{ groupCount(g.id) }} 篇</span>
            <button class="ghost-btn small" @click="renameGroupById(g.id, g.name)">改名</button>
            <button class="ghost-btn small danger" @click="deleteGroupById(g.id, g.name)">删除</button>
          </div>
          <p v-if="!readerStore.groups.length" class="append-empty">还没有分组</p>
        </div>
        <div class="merge-actions">
          <input v-model="newGroupName" class="list-search" placeholder="新分组名称" @keydown.enter="doCreateGroup" />
          <button class="ghost-btn small" :disabled="!newGroupName.trim()" @click="doCreateGroup">新建</button>
          <button class="ghost-btn small" @click="showGroupManager = false">关闭</button>
        </div>
      </div>
    </div>

    <div v-if="showMergeDialog" class="append-mask" @click.self="showMergeDialog = false">
      <div class="append-box">
        <div class="append-title">给这本书起个名字</div>
        <input
          v-model="mergeName"
          class="list-search"
          placeholder="书名"
          @keydown.enter="mergeIntoBook"
        />
        <div class="merge-actions">
          <button class="ghost-btn small" @click="showMergeDialog = false">取消</button>
          <button class="ghost-btn small" :disabled="!mergeName.trim() || merging" @click="mergeIntoBook">
            {{ merging ? '合并中…' : '确定' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showAppendPicker" class="append-mask" @click.self="showAppendPicker = false">
      <div class="append-box">
        <div class="append-title">选一篇加到《{{ article?.title }}》末尾</div>
        <div class="append-list">
          <button
            v-for="a in appendCandidates"
            :key="a.id"
            class="append-item"
            @click="appendChapter(a)"
          >
            <span class="ai-title">{{ a.title }}</span>
            <span class="ai-meta">{{ a.sentences.length }} 句</span>
          </button>
          <p v-if="!appendCandidates.length" class="append-empty">没有别的文章可以加</p>
        </div>
        <button class="ghost-btn small" @click="showAppendPicker = false">取消</button>
      </div>
    </div>

    <!-- 录音对比。只列能客观量出来的：原声多长、我多长、快了还是慢了。
         不打分 —— 打分要能听懂我读的是什么，本机识别做不到。 -->
    <div v-if="showRecCompare" class="rc-mask" @click.self="showRecCompare = false">
      <div class="rc-card">
        <div class="rc-head">
          <h3>录音对比</h3>
          <button class="icon-btn" title="关闭" @click="showRecCompare = false">×</button>
        </div>
        <p class="rc-sum">{{ recCompareSummary || '这篇还没对过轴，只能看自己每句读了多久' }}</p>

        <ul class="rc-list">
          <li class="rc-row rc-hd">
            <span class="rc-no">#</span>
            <span class="rc-text">句子</span>
            <span class="rc-len">原声</span>
            <span class="rc-len">我的</span>
            <span class="rc-verdict">语速</span>
            <span class="rc-pad"></span>
          </li>
          <li v-for="r in recCompareRows" :key="r.idx" class="rc-row">
            <button class="rc-no rc-link" title="回到这一句" @click="gotoSentence(r.idx)">{{ r.idx + 1 }}</button>
            <span class="rc-text">{{ r.text }}</span>
            <span class="rc-len">{{ r.refLen != null ? r.refLen.toFixed(1) + 's' : '—' }}</span>
            <span class="rc-len">{{ r.myLen.toFixed(1) }}s</span>
            <span class="rc-verdict" :class="{ off: r.ratio != null && (r.ratio > 1.1 || r.ratio < 0.9) }">{{ r.verdict }}</span>
            <button class="icon-btn" title="原声 → 我的，连着放" @click="playBoth(r.idx)">
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path fill="currentColor" d="M4 6h2v12H4zM8 5v14l8-7zM18 6h2v12h-2z"/>
              </svg>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <WordLookupPopover />
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
import { stripTranscriptNoise, aiReorganizeTranscript, aiTranslateLines, aiTranslateToEnglish, aiOutlineChapters, aiFixEnglish, analyzeTranscript } from '@/shared/core/transcriptClean'
import { similarityScore } from '@/shared/core/textSimilarity'
import type { Article, ArticleMark, ArticleChapter, ArticleSentence } from '@/shared/types/Article'
import type { WordItem } from '@/shared/types/WordItem'
import { setAgentSelectionContext, setArticleQuickActions, clearArticleQuickActions, setLastQuickActionResult, openAgentPanelWithPrefill, type ArticleQuickAction } from '@/shared/core/agentPanelState'
import { useAgentChatStore } from '@/shared/stores/agentChatStore'
import { readingSidePanelOpen as sidePanelOpen, readingArticleTitle } from '@/shared/core/readingPanelState'
import { openWordLookup, setCollectMarkHook } from '@/shared/core/wordLookup'
import { alignJobs } from '@/shared/core/alignJob'
import { taskFor, startTask, updateTask, finishTask, failTask, endTask } from '@/shared/core/taskCenter'
import WordLookupPopover from '@/apps/word-core/components/WordLookupPopover.vue'
import * as be from '@/shared/core/backendClient'
import { pickArticleAudioFile, getArticleAudio, getArticleAudioFile, clearArticleAudio, audioPickerSupported, saveArticleAudioBlob } from '@/shared/core/audioAlign'
import { uploadArticleAudio } from '@/shared/core/articleAudio'
import { parseSubtitles, alignCuesToSentences } from '@/shared/core/subtitles'

function splitIntoWordTokens(segment: string, onWordClick: (text: string, event: MouseEvent) => void) {
  const tokens = segment.split(/(\s+|[.,!?;:"'()])/g).filter(t => t !== '')
  return tokens.map(t => {
    if (!/^[A-Za-z']+$/.test(t)) return t
    return h('span', {
      class: 'word-token',
      onClick: (e: MouseEvent) => onWordClick(t, e),
      // 悬停查词：单击已被划词标记占用，所以查词走悬停，跟 TypeWords 的
      // WordLookupPopover 一致。停 350ms 才弹，鼠标划过不打扰。
      onMouseenter: (e: MouseEvent) => hoverLookup(t, e.currentTarget as HTMLElement),
      onMouseleave: cancelHoverLookup
    }, t)
  })
}

let hoverTimer: ReturnType<typeof setTimeout> | null = null

function cancelHoverLookup() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
}

function hoverLookup(word: string, el: HTMLElement) {
  cancelHoverLookup()
  hoverTimer = setTimeout(() => {
    hoverTimer = null
    openWordLookup(word, el, async candidates => {
      for (const c of candidates) {
        const hit = wordStore.words.find(w => w.word.toLowerCase() === c.toLowerCase())
        if (hit) return hit
      }
      return null
    })
  }, 350)
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
      /**
       * 定位不到就**不染色**。
       *
       * 原来是：只要这句有标记，就把整句中文糊上高亮。
       * 划词时如果记下了对应的中文（zhText）还好，可像「收进生词本」这类入口
       * 建的标记根本没有 zhText —— 结果收藏一个单词，整句译文全被点亮，
       * 看着像出了 bug。整句染色传达的信息也没有意义：它并不指向任何具体的词。
       */
      if (!precise.length) return props.text
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
// 报当前文章给 AI 助手用
const agentChat = useAgentChatStore()
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

const fileDropActive = ref(false)

/** 拖文件进来 = 选文件，走同一条导入路径 */
async function onFileDrop(e: DragEvent) {
  fileDropActive.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  await importFiles(files)
}

async function onFilePick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  await importFiles(files)
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

/** 点书就进它上次读到的那一章；普通文章照常打开 */
function openBookOrArticle(a: Article) {
  if (!a.isBook) { openArticle(a.id); return }
  const ids = a.chapterIds || []
  if (!ids.length) return
  const i = Math.min(Math.max(0, a.lastLearnIndex || 0), ids.length - 1)
  openArticle(ids[i])
}

function openArticle(id: string) {
  readerStore.selectArticle(id)
  nextTick(() => {
    const a = article.value
    // 进书里的哪一章，就把进度记到书上
    const b = a?.partOfBook ? readerStore.articles.find(x => x.id === a.partOfBook) : null
    if (b) {
      const i = (b.chapterIds || []).indexOf(id)
      if (i >= 0 && b.lastLearnIndex !== i) readerStore.saveArticle({ ...b, lastLearnIndex: i })
    }
    // 有书签就回到上次读的那一章，没有才从头开始
    const mark = a?.lastChapter
    if (a && (a.chapters?.length || 0) > 1 && typeof mark === 'number' &&
        a.chapters!.some(c => c.sentenceIndex === mark)) {
      jumpToChapter(mark)
      return
    }
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
/**
 * 打开导入面板时，默认落到**当前正在看的那个分组**上。
 * 之前默认是空的，人在某个分组下点「新建/导入文章」，导进来的东西
 * 却掉到「未分组」里，还得手动再挪一次。
 * 已经手动选过分组就不覆盖（面板关掉重开才重新跟随）。
 */
watch(showImportPanel, open => {
  if (!open) return
  if (groupFilter.value !== 'all' && groupFilter.value !== 'book') {
    pasteGroupId.value = groupFilter.value
  }
})
const selectedIds = ref<Set<string>>(new Set())
const merging = ref(false)

const showGroupManager = ref(false)

async function renameGroupById(id: string, old: string) {
  const name = prompt('分组新名字', old)
  if (!name || name === old) return
  await readerStore.renameGroup(id, name)
}

async function deleteGroupById(id: string, name: string) {
  const n = groupCount(id)
  if (!confirm(`删除分组「${name}」？里面的 ${n} 篇文章不会被删，会变成未分组。`)) return
  await readerStore.deleteGroup(id)
  if (groupFilter.value === id) groupFilter.value = 'all'
}
const showAppendPicker = ref(false)

/** 当前文章所属的书（分组标了 isBook 才算书，普通收纳文件夹不算） */
/** 当前正在看的书：要么正打开着书本身，要么打开的是书里的某一章 */
const currentBook = computed(() => {
  const a = article.value
  if (!a) return null
  if (a.isBook) return a
  if (a.partOfBook) return readerStore.articles.find(x => x.id === a.partOfBook) || null
  return null
})

/** 书里的章节，按 order 排；order 里没有的排在后面 */
const bookChapters = computed(() => {
  const b = currentBook.value
  if (!b?.chapterIds?.length) return []
  const byId = new Map(readerStore.articles.map(a => [a.id, a]))
  return b.chapterIds.map(id => byId.get(id)).filter(Boolean) as Article[]
})

const bookIndex = computed(() =>
  bookChapters.value.findIndex(a => a.id === article.value?.id)
)

/**
 * 把某一章并进它上一章。
 *
 * 视频常常一篇被切成好几段导入，合并回去比重导一遍省事。
 * 句子接到上一章末尾，被并的那篇删掉，order 同步更新。
 */
async function mergeChapters(a: number, b2: number) {
  const list = bookChapters.value
  const b = currentBook.value
  if (!b || a < 0 || b2 >= list.length || a >= b2) return
  const prev = list[a]
  const cur = list[b2]
  if (!confirm(`把《${cur.title}》并进《${prev.title}》？合并后前者保留。`)) return

  const merged = {
    ...prev,
    sentences: [...prev.sentences, ...cur.sentences.map(x => ({ ...x }))],
    updatedAt: new Date().toISOString()
  }
  await readerStore.saveArticle(merged)
  await readerStore.deleteArticle(cur.id)
  await readerStore.saveArticle({
    ...b,
    chapterIds: (b.chapterIds || []).filter(id => id !== cur.id)
  })
  if (article.value?.id === cur.id) openArticle(prev.id)
  batchMessage.value = `已并入《${prev.title}》，共 ${merged.sentences.length} 句`
}

const bookSideWidth = ref(Number(localStorage.getItem('lb-book-side-w')) || 320)

/** 拖右边缘改宽度，范围 220–720px */
function startBookResize(e: PointerEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startW = bookSideWidth.value
  const move = (ev: PointerEvent) => {
    bookSideWidth.value = Math.max(220, Math.min(720, startW + (ev.clientX - startX)))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    localStorage.setItem('lb-book-side-w', String(bookSideWidth.value))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const bookSideFolded = ref(localStorage.getItem('lb-book-side') === '0')
watch(bookSideFolded, v => localStorage.setItem('lb-book-side', v ? '0' : '1'))
const chapterSearch = ref('')

/**
 * 章节搜索，逻辑照 ArticleList.vue 的 localList：
 * 按空格分词、任一词命中即可（比整串 includes 好用），
 * 纯数字直接把那一条捞出来，完整包含的排前面。
 */
const shownChapters = computed(() => {
  const all = bookChapters.value.map((c, idx) => ({ ...c, idx }))
  const key = chapterSearch.value.trim().toLowerCase()
  if (!key) return all

  const parts = key.split(' ').filter(Boolean)
  const res = all.filter(item => parts.some(w => item.title.toLowerCase().includes(w)))

  const d = Number(key)
  if (!isNaN(d) && d - 1 >= 0 && d - 1 < all.length && !res.includes(all[d - 1])) {
    res.push(all[d - 1])
  }

  return res.sort((a, b) => {
    const am = a.title.toLowerCase().includes(key)
    const bm = b.title.toLowerCase().includes(key)
    if (am && !bm) return -1
    if (!am && bm) return 1
    return 0
  })
})

/**
 * 章节拖动排序。
 *
 * 跟文章列表同一套做法：落在上半是排到前面，下半是排到后面。
 * 顺序直接写回书的 chapterIds，那本来就是个有序数组。
 */
const chDragIdx = ref(-1)
const chDropIdx = ref(-1)
const chDropAfter = ref<boolean | null>(null)

function onChDragStart(idx: number, e: DragEvent) {
  chDragIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function onChDragOver(idx: number, e: DragEvent) {
  if (chDragIdx.value < 0 || idx === chDragIdx.value) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  chDropAfter.value = (e.clientY - r.top) / r.height > 0.5
  chDropIdx.value = idx
}

function onChDragLeave(idx: number) {
  if (chDropIdx.value === idx) { chDropIdx.value = -1; chDropAfter.value = null }
}

function onChDragEnd() {
  chDragIdx.value = -1
  chDropIdx.value = -1
  chDropAfter.value = null
}

async function onChDrop(targetIdx: number) {
  const from = chDragIdx.value
  const after = chDropAfter.value
  onChDragEnd()
  if (from < 0 || from === targetIdx) return

  const book = currentBook.value
  if (!book) return
  const ids = [...(book.chapterIds || [])]
  const moved = ids.splice(from, 1)[0]
  // 摘掉一个之后，落点在原位之后的话下标要往前挪一位
  let to = targetIdx + (after ? 1 : 0)
  if (from < to) to--
  ids.splice(Math.max(0, Math.min(ids.length, to)), 0, moved)
  await readerStore.saveArticle({ ...book, chapterIds: ids })
}

/**
 * 章节排序 / 置顶 / 收藏。
 *
 * 书就是文章的目录，文章列表有的这几样它也该有。
 * 顺序直接改书的 chapterIds —— 那本来就是一个有序数组，
 * 不用另存 sortIndex。
 */
async function moveChapter(idx: number, delta: number) {
  const book = currentBook.value
  if (!book) return
  const ids = [...(book.chapterIds || [])]
  const to = idx + delta
  if (to < 0 || to >= ids.length) return
  ;[ids[idx], ids[to]] = [ids[to], ids[idx]]
  await readerStore.saveArticle({ ...book, chapterIds: ids })
}

/**
 * 正在播的是第几章。
 * 只有音频真的在响时才算 —— 停下之后喇叭要跟着消失，
 * 否则会一直挂在那儿，看不出现在到底放没放。
 */
const audioPlaying = ref(false)
const playingChapterIdx = computed(() =>
  audioPlaying.value && bookIndex.value >= 0 ? bookIndex.value : -1
)

onMounted(() => {
  const tick = setInterval(() => {
    const el = audioEl.value
    audioPlaying.value = !!el && !el.paused && !el.ended && el.currentTime > 0
  }, 500)
  onBeforeUnmount(() => clearInterval(tick))
})

function chapterFlag(idx: number, key: 'pinned' | 'starred'): boolean {
  return !!bookChapters.value[idx]?.[key]
}

async function toggleChapterFlag(idx: number, key: 'pinned' | 'starred') {
  const ch = bookChapters.value[idx]
  if (!ch) return
  await readerStore.saveArticle({ ...ch, [key]: !ch[key] })
}

/** 「添加章节」弹窗 */
const showChapterPicker = ref(false)
const chapterPickSearch = ref('')

/**
 * 能被加进这本书的文章。
 * 排除：书本身、已经属于任何一本书的章节、已经在这本书里的。
 */
const pickableArticles = computed(() => {
  const book = currentBook.value
  const already = new Set(book?.chapterIds || [])
  const q = chapterPickSearch.value.trim().toLowerCase()
  return readerStore.articles.filter(a => {
    if (a.isBook || a.partOfBook || already.has(a.id)) return false
    if (q && !a.title.toLowerCase().includes(q)) return false
    return true
  })
})

/**
 * 批量导入音频：先配对，列出来让用户确认，再排队跑对轴。
 *
 * 不直接落库 —— 配错了写进去比不配还糟。
 */
const audioPairs = ref<{ file: File; chapter: Article; score: number; reason: string }[]>([])
const showPairConfirm = ref(false)

async function onBatchAudio(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return

  const chapters = bookChapters.value
  if (!chapters.length) { batchMessage.value = '这本书还没有章节'; return }

  const { matchAudioToChapters } = await import('@/shared/core/audioAlign')
  const pairs = matchAudioToChapters(files.map(f => f.name), chapters.map(c => c.title))
  audioPairs.value = pairs.map(p => ({
    file: files[p.fileIndex],
    chapter: chapters[p.chapterIndex],
    score: p.score,
    reason: p.reason
  }))
  showPairConfirm.value = true
}

/** 确认之后：逐个存音频，然后排队跑对轴（并发由设置里的上限控制） */
async function confirmBatchAudio() {
  showPairConfirm.value = false
  const list = audioPairs.value
  audioPairs.value = []
  if (!list.length) return

  const { saveArticleAudioBlob } = await import('@/shared/core/audioAlign')
  const { extractAudioFromVideo } = await import('@/shared/core/videoAudio')
  const { decodeTo16k } = await import('@/shared/core/w2v2Aligner')
  const { startAlignJob } = await import('@/shared/core/alignJob')

  let ok = 0
  for (const item of list) {
    try {
      const isVideo = /^video\//.test(item.file.type)
      const blob = isVideo ? (await extractAudioFromVideo(item.file)).blob : item.file
      await saveArticleAudioBlob(item.chapter.id, blob, item.file.name)
      const pcm = await decodeTo16k(blob)
      startAlignJob(item.chapter.id, pcm, item.chapter.title)
      ok++
    } catch (err) {
      batchMessage.value = `《${item.chapter.title}》导入失败：${err instanceof Error ? err.message : ''}`
    }
  }
  batchMessage.value = `已导入 ${ok} 个音频并排进对轴队列，进度看右下角`
}

/**
 * 把一篇文章收进某本书。
 *
 * 除了打 partOfBook，还要把它的 groupId 改成**书所在的分组** ——
 * 原来只写 partOfBook，于是一篇「未分组」或属于别的分组的文章拖进
 * TeachingDione 下的书之后，自己还留在原分组：分组计数、按分组筛选、
 * 笔记页的分组过滤全都对不上，从书里移出来时它也会跑回原来那一组。
 *
 * 三个入口（目录里「+ 添加章节」、拖到书上、拖出来建新书）共用这一个函数，
 * 不再各写各的。
 */
async function attachArticleToBook(book: Article, a: Article) {
  await readerStore.saveArticle({ ...a, partOfBook: book.id, groupId: book.groupId })
}

async function addChapterFromArticle(a: Article) {
  const book = currentBook.value
  if (!book) return
  const ids = [...(book.chapterIds || []), a.id]
  await readerStore.saveArticle({ ...book, chapterIds: ids })
  await attachArticleToBook(book, a)
  batchMessage.value = `《${a.title}》已加入，成为第 ${ids.length} 章`
  chapterPickSearch.value = ''
}

/**
 * 章节改名 / 移出。
 *
 * 书说到底就是文章的目录，目录该有的操作它也得有：改名、移出、排序。
 * 改名改的是那篇文章自己的标题（章节本来就是一篇文章）。
 */
const renamingChapter = ref(-1)
const chapterRenameText = ref('')

async function startChapterRename(idx: number, current: string) {
  renamingChapter.value = idx
  chapterRenameText.value = current
  await nextTick()
  const el = document.querySelector('.bs-rename') as HTMLInputElement | null
  el?.focus()
  el?.select()
}

async function commitChapterRename(idx: number) {
  if (renamingChapter.value !== idx) return
  const name = chapterRenameText.value.trim()
  renamingChapter.value = -1
  const ch = bookChapters.value[idx]
  if (!ch || !name || name === ch.title) return
  const art = readerStore.articles.find(x => x.id === ch.id)
  if (art) await readerStore.saveArticle({ ...art, title: name })
}

/** 把这一章移出书。文章本身不删，回到列表里独立存在。 */
async function removeChapter(idx: number) {
  const book = currentBook.value
  const ch = bookChapters.value[idx]
  if (!book || !ch) return
  if (!confirm(`把《${ch.title}》移出《${book.title}》？文章不会被删除，会回到文章列表。`)) return

  const ids = (book.chapterIds || []).filter(id => id !== ch.id)
  await readerStore.saveArticle({ ...book, chapterIds: ids })

  const art = readerStore.articles.find(x => x.id === ch.id)
  if (art) await readerStore.saveArticle({ ...art, partOfBook: undefined })
  batchMessage.value = `《${ch.title}》已移出，回到文章列表`
}

async function gotoBookChapter(i: number) {
  const list = bookChapters.value
  if (i < 0 || i >= list.length) return
  const b = currentBook.value
  if (b) await readerStore.saveArticle({ ...b, lastLearnIndex: i })
  openArticle(list[i].id)
}
const showMergeDialog = ref(false)
const mergeName = ref('')

function openMergeDialog() {
  const picked = readerStore.articles.filter(a => selectedIds.value.has(a.id))
  if (picked.length < 2) return
  // 用第一篇的标题去掉序号部分当默认书名
  mergeName.value = picked[0].title.replace(/^[\d.]+[-_\s]*/, '').replace(/[-_].*$/, '').trim() || '新书'
  showMergeDialog.value = true
}
const appendCandidates = computed(() =>
  readerStore.articles.filter(a => a.id !== article.value?.id && a.sentences?.length)
)

/**
 * 把另一篇文章作为新章节追加到当前这本书末尾。
 * 句子接到后面，chapters 记下新章起始句号 —— 跟合并时同一套结构。
 */
async function appendChapter(src: Article) {
  const book = article.value
  if (!book || !src.sentences?.length) return
  const sentences = [...book.sentences, ...src.sentences.map(x => ({ ...x }))]
  const chapters = [
    ...(book.chapters || [{ title: book.title, sentenceIndex: 0 }]),
    { title: src.title, sentenceIndex: book.sentences.length }
  ]
  await readerStore.saveArticle({
    ...book,
    sentences,
    chapters,
    needsCleanup: sentences.some(x => !x.zh && x.en.trim()),
    updatedAt: new Date().toISOString()
  })
  showAppendPicker.value = false
  batchMessage.value = `已把《${src.title}》作为新章节加到《${book.title}》末尾`
}

/**
 * 把选中的几篇合成一本书。
 *
 * 每篇原文变成新书的一章（章名沿用原标题），句子按顺序接起来，
 * chapters 里记下每章从第几句开始 —— 跟导入整本书时 buildArticle 产出的
 * 结构完全一致，所以左侧目录、跟读、笔记这些都能直接用。
 * 原文章保留不动，合并出来的是新的一篇。
 */
/**
 * 把一本合并出来的书拆回若干篇。
 * 按 chapters 的起止切片，每章还原成独立文章，书本身保留。
 */
async function splitBookBack(a: Article) {
  const chs = a.chapters || []
  if (chs.length < 2) {
    batchMessage.value = `《${a.title}》没有分章，拆不开`
    return
  }
  if (!confirm(`把《${a.title}》拆成 ${chs.length} 篇独立文章？原书保留。`)) return

  merging.value = true
  try {
    const now = new Date().toISOString()
    let ok = 0
    for (let i = 0; i < chs.length; i++) {
      const from = chs[i].sentenceIndex
      const to = i + 1 < chs.length ? chs[i + 1].sentenceIndex : a.sentences.length
      const part = a.sentences.slice(from, to)
      if (!part.length) continue
      await readerStore.saveArticle({
        id: `split-${Date.now().toString(36)}-${i}`,
        title: chs[i].title || `${a.title} ${i + 1}`,
        sentences: part.map(x => ({ ...x })),
        source: `拆自《${a.title}》`,
        groupId: a.groupId,
        createdAt: now,
        updatedAt: now,
        needsCleanup: part.some(x => !x.zh && x.en.trim())
      } as Article)
      ok++
    }
    batchMessage.value = `已拆出 ${ok} 篇，《${a.title}》仍然保留`
  } catch (e) {
    batchMessage.value = `拆分失败：${e instanceof Error ? e.message : '未知错误'}`
  } finally {
    merging.value = false
  }
}


/**
 * 合成一本书。
 *
 * 照 TypeWords 的模型来：它的 Dict.articles 是 Article[]，
 * **一本书 = 一组各自独立的文章**，每篇有自己的 title / text / sections，
 * 靠 Dict.lastLearnIndex 记读到第几篇。
 *
 * 我上一版是把所有句子首尾相接成一篇超长文章，等于把书拍扁成一卷 —— 翻不了页、
 * 每章的笔记和音频也没法各自独立。现在改成建一个分组当书，原文章归进去、
 * 内容一点不动，只记住顺序和读到第几章。
 */
/**
 * 合成一本书。
 *
 * 书是**文章列表里的一条**，不是新建分组 —— 分组是收纳文件夹，用户还得手动
 * 去删，而且书名会平白多出一个分组来。书本身不存正文，只按顺序引用章节；
 * 被收进书的文章打上 partOfBook，在列表里隐藏（它们已经在书里了）。
 */
async function mergeIntoBook() {
  const picked = readerStore.articles.filter(a => selectedIds.value.has(a.id))
  if (picked.length < 2) return

  const name = mergeName.value.trim()
  if (!name) return
  showMergeDialog.value = false

  merging.value = true
  try {
    const now = new Date().toISOString()
    const bookId = `book-${Date.now().toString(36)}`
    await readerStore.saveArticle({
      id: bookId,
      title: name,
      sentences: [],
      rawEnglish: '',
      source: `${picked.length} 篇合成`,
      notes: '',
      // 书留在原来的分组里 —— 分组是目录，书是目录下的一本，
      // 上一版我把 groupId 清了，书就跑到"未分组"去了。
      groupId: picked[0].groupId,
      isBook: true,
      chapterIds: picked.map(a => a.id),
      lastLearnIndex: 0,
      createdAt: now,
      updatedAt: now
    } as Article)

    for (const a of picked) {
      // 各章统一归到书所在的分组（书取的是第一篇的分组）——
      // 原来是各自保留 groupId，选中的几篇要是来自不同分组，合成一本书之后
      // 章节还散在各分组里。被 partOfBook 标记后它们不在列表里单独出现，
      // 但分组计数、筛选、导出仍然按 groupId 走。
      await readerStore.saveArticle({ ...a, partOfBook: bookId, groupId: picked[0].groupId })
    }
    selectedIds.value.clear()
    batchMessage.value = `《${name}》已建好：${picked.length} 章。各章仍是独立文章，已收进书里不再单独列出。`
  } catch (e) {
    batchMessage.value = `合并失败：${e instanceof Error ? e.message : '未知错误'}`
  } finally {
    merging.value = false
  }
}
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

/** 这一次拖动开始前已经选中的，拖动过程中要保住 */
let dragBase = new Set<string>()

function beginDrag(id: string) {
  dragSelecting = true
  dragAnchorIdx = filteredArticles.value.findIndex(a => a.id === id)
  lastPickedId.value = id
  dragBase = new Set(selectedIds.value)
  selectedIds.value = new Set([...dragBase, id])
}

function onRowPointerDown(id: string, e: PointerEvent) {
  if ((e.target as HTMLElement).closest('input,button,select,textarea')) return

  if (selectMode.value) {
    e.preventDefault()
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) selectedIds.value = new Set()
    beginDrag(id)
    /**
     * 这里原来调了 setPointerCapture。指针捕获会把后续所有 pointermove
     * 都定向到按下的那一行，window 上的监听根本收不到 —— 拖过其他行时
     * onRowPointerMove 一次都不触发，表现就是「拖拽多选没反应」。
     * 拖选需要的恰恰是全局的移动事件，所以不能捕获。
     */
    return
  }

  /**
   * 不在选择模式时，长按什么也不做 —— 拖动就是移动文章。
   *
   * 之前长按会自动进多选，于是"想拖文章"和"想框选"抢同一个手势，
   * 怎么调阈值都别扭。选择模式顶部本来就有入口，去掉这个隐式入口之后：
   *   不在选择模式 → 拖动 = 移动文章 / 拖进书
   *   在选择模式   → 拖动 = 框选
   * 两条路各走各的，不会再打架。
   */
}

function onRowPointerMove(e: PointerEvent) {
  if (!dragSelecting || dragAnchorIdx < 0) return
  autoScrollBy(e.clientY)
  const idx = rowIndexAt(e.clientX, e.clientY)
  if (idx < 0) return
  const list = filteredArticles.value
  const [lo, hi] = dragAnchorIdx < idx ? [dragAnchorIdx, idx] : [idx, dragAnchorIdx]
  // 在「拖动前已选中的」基础上加，而不是整个覆盖。
  // 原来每次移动都重建集合，手一抖或者松开重拖，之前选的全没了。
  const next = new Set(dragBase)
  for (let i = lo; i <= hi && i < list.length; i++) next.add(list[i].id)
  selectedIds.value = next
}

/**
 * 拖到列表上下边缘时自动滚动，否则选到屏幕底就走不动了。
 * 距边缘越近滚得越快，最快 24px/帧。
 */
let autoScrollRaf = 0
let autoScrollSpeed = 0

function autoScrollBy(clientY: number) {
  const EDGE = 60
  const top = 90
  const bottom = window.innerHeight
  if (clientY > bottom - EDGE) {
    autoScrollSpeed = Math.min(24, (clientY - (bottom - EDGE)) / 2)
  } else if (clientY < top + EDGE) {
    autoScrollSpeed = -Math.min(24, (top + EDGE - clientY) / 2)
  } else {
    autoScrollSpeed = 0
  }
  if (autoScrollSpeed && !autoScrollRaf) {
    const step = () => {
      if (!dragSelecting || !autoScrollSpeed) {
        autoScrollRaf = 0
        return
      }
      const box = document.querySelector('.article-list-view') as HTMLElement | null
      const scroller = box && box.scrollHeight > box.clientHeight ? box : document.scrollingElement
      scroller?.scrollBy(0, autoScrollSpeed)
      autoScrollRaf = requestAnimationFrame(step)
    }
    autoScrollRaf = requestAnimationFrame(step)
  }
}

function onRowPointerUp() {
  dragSelecting = false
  dragAnchorIdx = -1
  autoScrollSpeed = 0
  if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = 0 }
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
  // 被收进书里的章节不单独列出 —— 它们从书里进去
  let list = readerStore.articles.filter(a => !a.partOfBook)
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
  /**
   * 置顶 > 手动排序 > 原顺序。
   * sortIndex 只有拖动过的文章才有，没有的排在后面并保持原来的相对次序，
   * 这样拖了一篇不会把整个列表打乱。
   */
  const idx = new Map(list.map((a, i) => [a.id, i]))
  return [...list].sort((a, b) => {
    const pin = Number(!!b.pinned) - Number(!!a.pinned)
    if (pin) return pin
    const mark = Number(!!b.bookmarked) - Number(!!a.bookmarked)
    if (mark) return mark
    const sa = a.sortIndex ?? Number.MAX_SAFE_INTEGER
    const sb = b.sortIndex ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0)
  })
})
async function toggleBookmark(a: Article) {
  await readerStore.saveArticle({ ...a, bookmarked: !a.bookmarked })
}
async function toggleCompleted(a: Article) {
  await readerStore.saveArticle({ ...a, completed: !a.completed })
}
const ungroupedCount = computed(() => readerStore.articles.filter(a => !a.groupId && !a.partOfBook).length)
function groupCount(id: string) {
  // 书里的章节不算进分组计数 —— 列表里也不显示它们，数字得对得上
  return readerStore.articles.filter(a => a.groupId === id && !a.partOfBook).length
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

/**
 * 中断整理。
 *
 * 整理是个几十上百次请求的长循环，误点一下就只能干等着 —— 之前没有任何出口。
 * 每一批开始前查一次这个标志，已经补好的内容都已落盘，停下不会丢。
 */
const cancelCleanup = ref(false)

function stopCleanup() {
  cancelCleanup.value = true
  cleanupProgress.value = '正在停…'
}
/**
 * 进度条宽度。
 * 参数化之后每一行用自己那条任务的 ratio ——
 * 原来读的是全局 alignProgress，一篇在跑所有行都跟着动。
 */
function pctOf(ratio?: number) {
  return `${Math.max(3, Math.round((ratio ?? 0) * 100))}%`
}

const cleanPct = computed(() => {
  const m = /^(\d+)\/(\d+)$/.exec(cleanupProgress.value)
  if (!m) return '8%'
  return `${Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 100)}%`
})
/**
 * @param force 忽略「看起来已经整理好了」的判断，把整篇重新翻一遍。
 *   音频转译出来的稿子经常是格式合规但译文本身不准，这时候只有强制重译才有用。
 */
/**
 * 整理一本书：逐章跑，进度按「第几章/共几章」报。
 * 书本身没有正文，直接对它调 cleanupOne 什么也不会发生 —— 之前就是这样，
 * 所以长篇书籍点整理没反应。
 */
async function cleanupBook(book: Article) {
  const ids = book.chapterIds || []
  if (!ids.length) return
  if (cleaningOneId.value) return

  const byId = new Map(readerStore.articles.map(x => [x.id, x]))
  let done = 0
  for (const id of ids) {
    if (cancelCleanup.value) break
    const ch = byId.get(id)
    if (!ch) continue
    done++
    batchCleanProgress.value = `第 ${done}/${ids.length} 章`
    await cleanupOne(ch)
    // cleanupOne 内部出错会写 batchMessage，这里不吞掉，让用户看到是哪一章
    if (batchMessage.value.includes('失败') || batchMessage.value.includes('中断')) break
  }
  batchCleanProgress.value = ''
  if (!batchMessage.value.includes('失败') && !batchMessage.value.includes('中断')) {
    batchMessage.value = `《${book.title}》${ids.length} 章全部整理完成`
  }
}

/**
 * 修英文转写错误。
 *
 * 作为「重新整理」的第一步跑：中文是照着英文译的，英文里的错词
 * （self-taught 听成 selfish taught）不修掉，译文会跟着错一遍。
 * 提示词要求只改明显听错的词、不改写句子结构 —— 这些文本要跟音频逐句对齐，
 * 一润色跟读和对轴就全废了。
 */
const fixingEn = ref(false)
/** 上一次修英文的统计，用来在结果里说清楚到底发生了什么 */
let lastEnScan = 0
let lastEnOk = 0
let lastEnErr = 0
let lastEnErrMsg = ''

async function fixEnglish(a: Article) {
  if (fixingEn.value) return 0

  const sentences = a.sentences.map(x => ({ ...x }))
  const idx: number[] = []
  sentences.forEach((x, i) => { if (x.en.trim() && !isStructuralLine(x.en)) idx.push(i) })
  if (!idx.length) return 0

  fixingEn.value = true
  let fixed = 0
  let failed = 0
  /**
   * 分清「模型说没问题」和「压根没跑通」。
   * 之前两种情况都只让 fixed 停在 0，界面统一报「没发现要改的」——
   * 请求全挂了也是这句话，白白排查了两轮。
   */
  let okBatches = 0
  let errBatches = 0
  let lastErr = ''
  try {
    // 一批 5 句。10 句会整批超时（模型要逐句判断有没有听错，比翻译慢得多），
    // 批小一点单次更快，也更不容易被整批原样回吐。
    const BATCH = 5
    for (let k = 0; k < idx.length; k += BATCH) {
      if (cancelCleanup.value) break
      const slice = idx.slice(k, k + BATCH)
      cleanupProgress.value = `修英文 ${Math.min(k + BATCH, idx.length)}/${idx.length}`
      try {
        /**
         * 超时就把这批对半拆开重试，而不是直接判失败。
         *
         * 修英文比翻译慢得多（模型要逐句判断有没有听错），碰上响应慢的服务商，
         * 整批超时就全军覆没 —— 之前「3 批报错」全是这么来的。
         * 拆到只剩 1 句还超时，才认这一句跳过。
         */
        const fixSlice = async (part: number[], depth = 0): Promise<void> => {
          try {
            const got = await aiFixEnglish(part.map(i => sentences[i].en))
            part.forEach((i, j) => {
              const t = got[j]
              if (t && t !== sentences[i].en) { sentences[i].en = t; fixed++ }
            })
          } catch (e) {
            const timedOut = /超时/.test(e instanceof Error ? e.message : '')
            if (timedOut && part.length > 1 && depth < 3) {
              const mid = Math.ceil(part.length / 2)
              await fixSlice(part.slice(0, mid), depth + 1)
              await fixSlice(part.slice(mid), depth + 1)
              return
            }
            throw e
          }
        }

        let en: string[] | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await fixSlice(slice)
            en = null          // 结果已在 fixSlice 里就地写回
            break
          } catch (e) {
            if (attempt === 2) throw e
            await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 3000))
          }
        }
        failed = 0
        okBatches++
      } catch (e) {
        failed++
        errBatches++
        lastErr = e instanceof Error ? e.message : String(e)
        if (failed >= 3) break
      }
    }
    if (fixed) {
      await readerStore.saveArticle({ ...a, sentences })
      // 就地更新，后面补译文那一步要用修好的英文
      a.sentences = sentences
    }
    lastEnScan = idx.length
    lastEnOk = okBatches
    lastEnErr = errBatches
    lastEnErrMsg = lastErr
  } finally {
    fixingEn.value = false
  }
  return fixed
}

/**
 * 文章拖动排序 / 拖进书里当章节。
 *
 * 用原生 HTML5 拖拽，跟已有的 pointerdown 框选错开：选择模式下不允许拖，
 * 否则两套手势会互相抢事件。
 *
 * 落点分两种，鼠标在目标行的位置决定：
 *  - 悬在书的中间 → 收进这本书当新章节
 *  - 悬在上下边缘、或目标不是书 → 排到它前面 / 后面
 */
const draggingId = ref('')
const dropHintId = ref('')
const dropMode = ref<'before' | 'after' | 'into'>('before')

/** 列表末尾「新建一本书」的拖入高亮 */
const newBookHot = ref(false)

/**
 * 新建一本空书。
 * 书本身就是一条 isBook 的文章记录，没有正文，只按顺序引用章节。
 */
async function createEmptyBook(title?: string) {
  const name = (title || prompt('新书名字', '未命名的书') || '').trim()
  if (!name) return null
  const book: Article = {
    id: 'bk-' + Date.now().toString(36),
    title: name,
    source: 'book',
    sentences: [],
    isBook: true,
    chapterIds: [],
    lastLearnIndex: 0,
    groupId: groupFilter.value !== 'all' && groupFilter.value !== 'book' ? groupFilter.value : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as Article
  await readerStore.saveArticle(book)
  batchMessage.value = `已新建《${name}》，把文章拖进来就是章节`
  return book
}

/** 把拖过来的文章直接变成一本新书的第一章 */
async function onDropToNewBook() {
  newBookHot.value = false
  const srcId = draggingId.value
  onDragEnd()
  if (!srcId) return
  const src = readerStore.articles.find(x => x.id === srcId)
  if (!src) return
  if (src.isBook) { batchMessage.value = '书不能放进另一本书里'; return }

  const book = await createEmptyBook(src.title)
  if (!book) return
  await readerStore.saveArticle({ ...book, chapterIds: [src.id] })
  await attachArticleToBook(book, src)
  batchMessage.value = `已新建《${book.title}》，《${src.title}》成为第 1 章`
}

/**
 * 按住不动一小会儿就亮起左侧书签，表示"可以拖了"。
 *
 * 原生拖拽其实一按就能拖，但没有任何提示，用户不知道自己能不能拖 ——
 * 给一个明确的进入信号，手感才踏实。
 */
const dragReadyId = ref('')
let readyTimer: ReturnType<typeof setTimeout> | null = null

function armDrag(id: string) {
  if (readyTimer) clearTimeout(readyTimer)
  readyTimer = setTimeout(() => { dragReadyId.value = id }, 220)
}

function disarmDrag() {
  if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
  dragReadyId.value = ''
}

function onDragStart(a: Article, e: DragEvent) {
  /**
   * 拖拽一开始就把长按计时器掐掉。
   *
   * 长按 400ms 会进入多选模式，而多选模式下 draggable 是 false ——
   * 于是拖到 400ms 时拖拽被中途取消，表现就是「拖进书没反应」。
   */
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null }
  draggingId.value = a.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // 有些浏览器不设 data 就不触发 drop
    e.dataTransfer.setData('text/plain', a.id)
  }
}

function onDragOver(a: Article, e: DragEvent) {
  if (!draggingId.value || a.id === draggingId.value) return
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const y = (e.clientY - r.top) / r.height

  // 书：中间 60% 算"放进去"，上下各 20% 算排序
  if (a.isBook && y > 0.2 && y < 0.8) dropMode.value = 'into'
  else dropMode.value = y < 0.5 ? 'before' : 'after'

  dropHintId.value = a.id
}

function onDragLeave(a: Article) {
  if (dropHintId.value === a.id) dropHintId.value = ''
}

function onDragEnd() {
  draggingId.value = ''
  dropHintId.value = ''
  disarmDrag()
}

async function onDrop(target: Article) {
  const srcId = draggingId.value
  const mode = dropMode.value
  onDragEnd()
  if (!srcId || srcId === target.id) return

  const src = readerStore.articles.find(x => x.id === srcId)
  if (!src) return

  // 收进书里当新章节
  if (mode === 'into' && target.isBook) {
    if (src.isBook) { batchMessage.value = '书不能放进另一本书里'; return }
    const ids = [...(target.chapterIds || [])]
    if (!ids.includes(src.id)) ids.push(src.id)
    await readerStore.saveArticle({ ...target, chapterIds: ids })
    await attachArticleToBook(target, src)
    batchMessage.value = `《${src.title}》已收进《${target.title}》，成为第 ${ids.length} 章`
    return
  }

  // 排序：按当前显示顺序重排，再把位置写回每一篇
  const list = filteredArticles.value.filter(x => x.id !== srcId)
  const at = list.findIndex(x => x.id === target.id)
  if (at < 0) return
  list.splice(mode === 'before' ? at : at + 1, 0, src)
  for (let i = 0; i < list.length; i++) {
    if (list[i].sortIndex !== i) {
      await readerStore.saveArticle({ ...list[i], sortIndex: i })
    }
  }
}

/**
 * 整理之后重新给标记定位。
 *
 * 之前是一律 `sentIdx: -1` —— 句子重排了，旧下标确实不能要，但直接清成 -1
 * 等于把所有笔记的跳转能力废掉：笔记里的链接写的是 data-sent-idx="-1"，
 * 点了什么都不会发生。整理一次，全篇笔记就都点不动了。
 *
 * 现在按标记的原文去新句子里找：完全包含就用那一句，找不到再退回 -1。
 */
function reanchorMarks(marks: Article['marks'], sentences: { en: string; zh: string }[]) {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
  const lowered = sentences.map(x => norm(x.en))

  return (marks || []).map(m => {
    const text = norm(m.text || '')
    if (!text) return { ...m, sentIdx: -1, localStart: undefined, localEnd: undefined }

    let hit = lowered.findIndex(sent => sent.includes(text))
    // 整句找不到就用前几个词再找一次（整理可能改写了句尾）
    if (hit < 0) {
      const head = text.split(' ').slice(0, 4).join(' ')
      if (head.length >= 4) hit = lowered.findIndex(sent => sent.includes(head))
    }
    if (hit < 0) return { ...m, sentIdx: -1, localStart: undefined, localEnd: undefined }

    const local = lowered[hit].indexOf(text)
    return {
      ...m,
      sentIdx: hit,
      localStart: local >= 0 ? local : undefined,
      localEnd: local >= 0 ? local + text.length : undefined
    }
  })
}

async function cleanupOne(a: Article, force = false) {
  if (cleaningOneId.value) return
  cancelCleanup.value = false
  // 书是章节的容器，没有自己的句子，得逐章处理
  if (a.isBook) { await cleanupBook(a); return }
  cleaningOneId.value = a.id
  cleanupProgress.value = ''
  /**
   * 登记到任务中心：整理动辄跑好几分钟，得让用户能看到它还活着、
   * 跑完了、还是挂了。失败和完成都会留一条等确认。
   */
  const taskId = 'clean:' + a.id
  startTask({
    id: taskId,
    kind: '整理',
    subject: a.title,
    detail: '准备…',
    cancel: () => {
      // 只置标志位不够 —— 正在等的那次请求回来之前界面毫无反馈，
      // 看起来就像"点了没用"。这里立刻把状态写出来。
      cancelCleanup.value = true
      updateTask(taskId, { detail: '正在停止…（等当前这批返回）' })
    }
  })
  try {
    /**
     * 第一步先修英文，再补中文。顺序不能反 ——
     * 译文是照着英文出的，英文的错词不先修掉，译文会跟着错一遍。
     */
    const enFixed = await fixEnglish(a)
    if (cancelCleanup.value) return
    /**
     * 不管改没改都要报。
     * 之前只在 enFixed > 0 时才提示，结果模型一句没改的时候界面毫无动静，
     * 根本分不清是「这一步没跑」还是「跑了但没改动」—— 白白多花了一轮排查。
     */
    if (enFixed) {
      batchMessage.value = `已修正 ${enFixed} 句英文，继续补译文…`
    } else if (lastEnErr && !lastEnOk) {
      // 一批都没成功 —— 这是故障，不是「没问题」
      batchMessage.value =
        `修英文全部失败（${lastEnErr} 批报错）：${lastEnErrMsg}。先继续补译文，英文没动。`
    } else if (lastEnErr) {
      batchMessage.value =
        `英文改了 0 句，其中 ${lastEnErr} 批报错、${lastEnOk} 批模型说无需修改。继续补译文…`
    } else {
      batchMessage.value = `英文 ${lastEnOk} 批全部返回「无需修改」，继续补译文…`
    }

    const raw = a.rawEnglish || a.sentences.map(x => x.en).join(' ')

    /**
     * 先判断这是什么稿子，再决定怎么处理。
     *
     * 之前这些判断散在四五个 if/return 里，谁写在前面谁说了算 ——
     * aiReorganizeTranscript 就是这么被挡成死代码的（混排稿永远走不到它）。
     * 现在分析结论是显式的，也会告诉用户走了哪条路，出问题好对症。
     */
    const analysis = analyzeTranscript(raw, a.sentences)
    cleanupProgress.value = ''
    batchMessage.value = `《${a.title}》：${analysis.reason}`

    /**
     * 中英混杂：交给专门处理这种稿子的重排（提炼英文 + 配对译文）。
     *
     * 失败就**回落到下面原有的处理路径**，不要直接报错走人 ——
     * 这条路是我新加的，它挂掉不该让整篇比以前更糟。
     * 原来的本地重排 + 补译文虽然不理想，至少是能跑通的。
     */
    if (analysis.kind === 'mixed') {
      cleanupProgress.value = '整理中英混排…'
      try {
        const sentences = await aiReorganizeTranscript(raw, (done, total) => {
          cleanupProgress.value = total > 1 ? `${done}/${total}` : ''
        }, () => cancelCleanup.value)
        if (sentences.length) {
          const remarks = reanchorMarks(a.marks, sentences)
          await readerStore.saveArticle({ ...a, sentences, marks: remarks, needsCleanup: false })
          batchMessage.value = `《${a.title}》整理完成：中英混排稿重新提炼为 ${sentences.length} 句对照`
          return
        }
      } catch (e) {
        console.warn('[整理] 混排重排失败，回落到常规处理', e)
        batchMessage.value =
          `《${a.title}》：混排重排没成功（${e instanceof Error ? e.message : ''}），改用常规整理继续`
      }
      cleanupProgress.value = ''
    }

    // 纯中文稿：整理 = 把英文补出来（跟补译方向相反）
    const zhOnly = analysis.kind === 'chinese' ||
      (a.sentences.length > 0 && a.sentences.every(x => !x.en.trim()) && a.sentences.some(x => x.zh.trim()))
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
        if (cancelCleanup.value) break
        cleanupProgress.value = `${Math.min(k + BATCH, gaps.length)}/${gaps.length}`
        updateTask(taskId, { detail: cleanupProgress.value })
        try {
          /**
           * 单批失败先自己重试两次（退避 1s、3s）。
           *
           * 之前一批失败就直接跳过、连续 3 批失败就整篇中断 —— 而模型接口偶发
           * 超时是常事，结果就是前面译好了、后面原样没动，看着像"整理过但没变"。
           * 重试之后只有真正持续失败才会停。
           */
          let en: string[] | null = null
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              en = await aiTranslateToEnglish(slice.map(i => sentences[i].zh))
              break
            } catch (e) {
              if (attempt === 2) throw e
              if (cancelCleanup.value) throw e
              await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 3000))
            }
          }
          if (en) slice.forEach((i, j) => { if (en![j]) { sentences[i].en = en![j]; fixed++ } })
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
      // 没有缺口就是「格式合规但译文可能不准」的情况 —— 用户点重新整理
      // 想要的就是重翻一遍。不再拒绝，也不要求按什么键。
      if (!gaps.length) force = true
      if (force) {
        // 强制重译：整篇重来。这一支是英→中，按「有英文原文」挑，
        // 结构行照旧跳过。
        gaps.length = 0
        sentences.forEach((x, i) => { if (x.en.trim() && !isStructuralLine(x.en)) gaps.push(i) })
      }
      const BATCH = 20
      let fixed = 0
      let failedBatches = 0
      for (let k = 0; k < gaps.length; k += BATCH) {
        const slice = gaps.slice(k, k + BATCH)
        if (cancelCleanup.value) break
        cleanupProgress.value = `${Math.min(k + BATCH, gaps.length)}/${gaps.length}`
        updateTask(taskId, { detail: cleanupProgress.value })
        try {
          // 同上：单批先退避重试两次，别让偶发超时把整篇腰斩
          let zh: string[] | null = null
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              zh = await aiTranslateLines(slice.map(i => sentences[i].en))
              break
            } catch (e) {
              if (attempt === 2) throw e
              if (cancelCleanup.value) throw e
              await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 3000))
            }
          }
          if (zh) slice.forEach((i, j) => { if (zh![j]) { sentences[i].zh = zh![j]; fixed++ } })
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

    // 到这里是 english / bilingual / book 三类：都走本地重排 + 补译文，
    // 差别只在要不要先切章
    let restructured = buildArticle(a.title, raw, a.source)

    /**
     * 本地规则分不出章的话，让 AI 只判断"哪几行是章节标题"，
     * 拿回行号后仍然由本地代码切分、断句、配对 —— AI 不碰正文。
     *
     * 分析判定为 book 时一定要试一次：这类稿子章节结构是重点，
     * 本地规则漏了就得让 AI 补上。
     */
    if (analysis.kind === 'book' || !restructured.chapters || restructured.chapters.length < 2) {
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

      /**
       * 一句不缺 = 格式合规但译文可能是错的（音频转译的稿子最常见）。
       * 用户点「重新整理」要的就是重翻，之前这里直接 return 掉，
       * 报一句「结构完整，未调用 AI」，等于永远修不好那些烂译文。
       */
      if (!gaps.length) {
        sentences.forEach((x, i) => { if (x.en.trim() && !isStructuralLine(x.en)) gaps.push(i) })
      }

      let fixed = 0
      let structFailed = 0
      /**
       * 模型没回的行。
       * 之前 `if (zh![j])` 直接跳过，跑完也不说 —— 表现就是「重译 269/309」，
       * 剩下 40 句悄悄留着旧译文，用户只能自己发现。
       */
      const missed: number[] = []
      // 上限从 400 提到 4000：一本书动辄上千句，卡在 400 会静默什么都不做。
      // 真正的保护是上面的重试和中断提示，不是拒绝开工。
      if (gaps.length && gaps.length <= 4000) {
        const BATCH = 20
        for (let k = 0; k < gaps.length; k += BATCH) {
          const slice = gaps.slice(k, k + BATCH)
          if (cancelCleanup.value) break
        cleanupProgress.value = `${Math.min(k + BATCH, gaps.length)}/${gaps.length}`
        updateTask(taskId, { detail: cleanupProgress.value })
          /**
           * 这里原来是 catch { break } —— 一次失败就整篇停掉，而且不告诉用户。
           * 表现就是"整理过了，可前面变了后面一模一样"。
           * 现在单批退避重试两次，连续 3 批真失败才停，并且说清停在哪。
           */
          try {
            let zh: string[] | null = null
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                zh = await aiTranslateLines(slice.map(i => sentences[i].en))
                break
              } catch (e) {
                if (attempt === 2) throw e
                if (cancelCleanup.value) throw e
                await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 3000))
              }
            }
            if (zh) slice.forEach((i, j) => { if (zh![j]) { sentences[i].zh = zh![j]; fixed++ } })
            structFailed = 0
            // 模型偶尔会漏回几行，这些下标先记下来，整轮跑完再补一次
            if (zh) slice.forEach((i, j) => { if (!zh![j]) missed.push(i) })
          } catch (err) {
            structFailed++
            if (structFailed >= 3) {
              batchMessage.value =
                `《${a.title}》整理中断：连续 3 批失败（已译 ${fixed}/${gaps.length} 句）。` +
                `${err instanceof Error ? err.message : ''} 已保存进度，再点一次会接着译没译完的。`
              break
            }
          }
        }

        /**
         * 补跑没回的那些行。
         * 一次五句，批小一点模型更不容易再漏；补完还漏的就认了，
         * 但会在结果里说清楚，不再让用户自己去发现。
         */
        if (missed.length && !cancelCleanup.value) {
          const still: number[] = []
          for (let k = 0; k < missed.length; k += 5) {
            if (cancelCleanup.value) break
            const slice = missed.slice(k, k + 5)
            cleanupProgress.value = `补漏 ${Math.min(k + 5, missed.length)}/${missed.length}`
            updateTask(taskId, { detail: cleanupProgress.value })
            try {
              const zh = await aiTranslateLines(slice.map(i => sentences[i].en))
              slice.forEach((i, j) => {
                if (zh[j]) { sentences[i].zh = zh[j]; fixed++ }
                else still.push(i)
              })
            } catch {
              slice.forEach(i => still.push(i))
            }
          }
          missed.length = 0
          missed.push(...still)
        }
      }

      await readerStore.saveArticle({
        ...a,
        sentences,
        chapters: restructured.chapters,
        marks: reanchorMarks(a.marks, sentences),
        needsCleanup: false
      })
      batchMessage.value =
        `《${a.title}》整理完成：${sentences.length} 句` +
        `${restructured.chapters?.length ? ` · ${restructured.chapters.length} 章` : ''}` +
        `${gaps.length > 4000 ? `，共 ${gaps.length} 句超过单次上限，建议先拆成几章再整理` : `，重译 ${fixed}/${gaps.length} 句`}` +
        `${lastEnScan ? `，英文${enFixed ? `改了 ${enFixed}/${lastEnScan} 句` : `扫了 ${lastEnScan} 句、没有需要改的`}` : ''}` +
        `${missed.length ? `。补跑之后仍有 ${missed.length} 句没译出来，再点一次整理会接着补` : ''}`
      return
    }

    const sentences = await aiReorganizeTranscript(raw, (done, total) => {
      cleanupProgress.value = total > 1 ? `${done}/${total}` : ''
    }, () => cancelCleanup.value)
    const remarks = reanchorMarks(a.marks, sentences)
    await readerStore.saveArticle({ ...a, sentences, marks: remarks, needsCleanup: false })
    batchMessage.value = `《${a.title}》整理完成，共 ${sentences.length} 句`
    finishTask(taskId, `共 ${sentences.length} 句`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误'
    batchMessage.value = `《${a.title}》整理失败：${msg}`
    failTask(taskId, msg)
  } finally {
    cleaningOneId.value = ''
    cleanupProgress.value = ''
    if (cancelCleanup.value) {
      batchMessage.value = '已停止整理。已经补好的部分都保留了，再点一次会接着补没补完的。'
      cancelCleanup.value = false
      endTask(taskId)   // 用户主动停的，不用留痕
    }
  }
}

async function doBatchCleanup(force = false) {
  cancelCleanup.value = false
  try {
    await runBatchCleanup(force)
  } finally {
    batchCleaning.value = false
    cleaningOneId.value = ''
    cleanupProgress.value = ''
    if (cancelCleanup.value) {
      batchMessage.value = '已停止批量整理。已完成的部分保留，再点一次会接着处理剩下的。'
      cancelCleanup.value = false
    }
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
  const failedTitles: string[] = []
  for (const a0 of needsAny) {
    if (cancelCleanup.value) break
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
        }, () => cancelCleanup.value)
        const remarks = reanchorMarks(a.marks, sentences)
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
    } catch (e) {
      /**
       * 原来这里是 catch {}，把异常全吞了。
       * 翻译一超时两个计数都停在 0，提示还写着「处理完成」——
       * 用户完全看不出发生过什么。
       */
      failedTitles.push(`《${a0.title}》：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  batchCleaning.value = false
  batchMessage.value =
    `批量处理完成：整理了 ${cleanedCount} 篇、翻译了 ${translatedCount} 篇` +
    `（选中 ${selected.length} 篇，其中 ${selected.length - needsAny.length} 篇本来就是完整的）` +
    (failedTitles.length ? `\n${failedTitles.length} 篇失败：\n${failedTitles.slice(0, 5).join('\n')}` : '')
  selectedIds.value = new Set()
}

/**
 * 停止批量整理。
 *
 * 原来这里只是把 batchCleaning 置回 false —— 界面看着停了，后台循环还在跑，
 * 该发的请求一个不少。现在置中断标志，循环每篇/每批开头都会查。
 */
function unstickBatch() {
  cancelCleanup.value = true
  batchMessage.value = '正在停止…已经整理好的部分都会保留。'
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

const viewSubMode = ref<'read' | 'shadow' | 'audioAlign'>('read')
/*
 * 浏览器语音识别（speechRecognition）这条也一起退场了。
 * 跟读不再做识别，唯一用到 speechSupported 的那条提示是在说
 * 「不支持识别就没有自动打分」—— 打分已经没有了，留着是错的信息。
 */

const audioEl = ref<HTMLAudioElement | null>(null)
const audioObjectUrl = ref('')
const alignCursor = ref(0) // 正在对哪一句的轴
const alignLoading = ref(false)
const alignMessage = ref('')

const continuousOn = ref(false)
let contWatcher: (() => void) | null = null


/**
 * 桌面悬浮球的播放控制落到这里。
 * 主窗口收起时球上那几个键就是调这个 —— 复用页面里已有的逻辑，
 * 不另写一套播放器。
 */
onMounted(() => {
  ;(window as any).__lbMediaHandler = (a: { type: string; value?: number }) => {
    if (a.type === 'toggle') { toggleContinuous(); return }
    if (a.type === 'prev') { jumpShadow(playingIdx.value - 1); return }
    if (a.type === 'next') { jumpShadow(playingIdx.value + 1); return }
    if (a.type === 'rate' && typeof a.value === 'number') {
      shadowRate.value = a.value
      if (audioEl.value) audioEl.value.playbackRate = a.value
    }
  }
})
onBeforeUnmount(() => {
  if ((window as any).__lbMediaHandler) delete (window as any).__lbMediaHandler
})

/**
 * 一本书连着听：这一章放完自动打开下一章接着放。
 *
 * 每章是一篇独立文章、各有各的音频，所以"连播"不是拼接音频，
 * 而是切换当前文章再从第一句起播。切章要等音频真的加载好，
 * 不然 currentTime 会被重置。
 */
/**
 * 循环方式，四选一：
 *  none     放完就停
 *  sentence 单句反复（练跟读）
 *  article  这一篇放完从头再来
 *  list     整本书循环：一章接一章，最后一章完了回第一章
 * 一个下拉比三个复选框清楚，也不会出现互相矛盾的组合。
 */
type LoopMode = 'none' | 'sentence' | 'article' | 'list'
const loopMode = ref<LoopMode>((localStorage.getItem('lb-loop-mode') as LoopMode) || 'none')

/**
 * 播放源：放原声、放自己的录音、还是原声接着自己的。
 *
 * 只在录过音的文章上出现（播放条里那个下拉）。逐句播放和连续播放都按它走 ——
 * 「只听自己录的」于是就是「播放源选我的录音 + 循环方式选本篇循环」，
 * 不需要另做一个"连听"按钮。
 */
type PlaySource = 'origin' | 'mine' | 'both'
const playSource = ref<PlaySource>((localStorage.getItem('lb-play-source') as PlaySource) || 'origin')
watch(playSource, v => localStorage.setItem('lb-play-source', v))
watch(loopMode, v => localStorage.setItem('lb-loop-mode', v))

/** 兼容原有逻辑：单句循环 / 连章 由 loopMode 推导 */
/**
 * 这篇是不是「读一句英文、紧跟着读一句中文」的双语音频。
 *
 * 判据只看文本：绝大多数句子都配了中文译文，就按双语音频对齐。
 * 对齐用的是英文声学模型，中文那几秒在转写里是空白；不告诉对齐这件事，
 * 它会把中文当成句间停顿从中点劈开（见 forcedAlign 里的说明）。
 */
function looksBilingual(list: { en?: string; zh?: string }[]): boolean {
  const withEn = list.filter(x => String(x.en || '').trim())
  if (withEn.length < 3) return false
  const withZh = withEn.filter(x => String(x.zh || '').trim()).length
  return withZh / withEn.length >= 0.8
}

const shadowLoopOne = computed(() => loopMode.value === 'sentence')
const chainChapters = computed(() => loopMode.value === 'list')

/**
 * 自动切章时置位：告诉那个"换文章就重置界面"的 watch 别把跟读模式踢掉。
 *
 * 切章会改变 article.id，而那个 watch 里有 viewSubMode = 'read' ——
 * 一跳章就退出跟读，音频元素跟着卸载，audioEl 变 null，
 * 于是等满 8 秒报「没有可播的音频」，循环就断在这里。
 */
let autoAdvancing = false

async function playNextChapter() {
  const chapters = bookChapters.value
  const here = bookIndex.value
  if (!chapters.length || here < 0) { stopContinuous(); return }
  if (here >= chapters.length - 1) {
    // 整本循环：最后一章放完回到第一章；否则停下
    if (loopMode.value !== 'list') {
      subMessage.value = '这本书已经放完了'
      stopContinuous()
      return
    }
  }
  const wrap = here >= chapters.length - 1
  const next = chapters[wrap ? 0 : here + 1]
  subMessage.value = wrap ? `整本循环，回到《${next.title}》` : `接着放下一章：《${next.title}》`

  autoAdvancing = true
  openArticle(next.id)
  // 切章后强制留在跟读界面
  await nextTick()
  viewSubMode.value = 'shadow'

  // 等新章的音频就位再起播，最多等 12 秒（换章要重新读一次音频文件）
  for (let k = 0; k < 60; k++) {
    await new Promise(r => setTimeout(r, 200))
    const el = audioEl.value
    const ready = el && el.readyState >= 2
    const aligned = (article.value?.sentences || []).some(x => x.audioStart != null)
    if (ready && aligned) {
      autoAdvancing = false
      continuousOn.value = true
      playFrom(0)
      return
    }
  }
  autoAdvancing = false
  subMessage.value = `《${next.title}》没有可播的音频（可能还没对轴），停在这里`
  stopContinuous()
}

/** 跳到指定句并从那里继续连读 */
/**
 * 跟读开关。
 * 开着：点句子 = 放一遍原声 → 停 → 自动开录音。
 * 关着：点句子就是普通播放，一路放下去，不停也不录。
 */
/**
 * 两个独立开关。
 *
 *   都不开 —— 就是个播客播放器，句子下面什么都没有
 *   跟读   —— 出现录音按钮；点播放变成「一句原声 + 一段留白」，留白里自动录音
 *   复述   —— 出现输入框，自己把这句写出来
 *
 * 两个可以同时开。之前把录音、输入框、语音转文字混在一个「跟读」开关里，
 * 结果不想录音的人也被塞了一堆东西，而转文字质量又撑不起来。
 */
const shadowDrill = ref(localStorage.getItem('lb-shadow-drill') === '1')
watch(shadowDrill, v => localStorage.setItem('lb-shadow-drill', v ? '1' : '0'))

const reciteMode = ref(localStorage.getItem('lb-recite-mode') === '1')
watch(reciteMode, v => localStorage.setItem('lb-recite-mode', v ? '1' : '0'))

/**
 * 点句子。
 *
 * 跟读开关打开时：放完这一句就停下并自动开录音 ——
 * 原声和录音同时开的话，你得等它读完才能开口，
 * 「它读完我接着读」这个效果根本做不出来。
 * 关掉跟读时就是普通播放，一路放下去，不停不录。
 */
function jumpShadow(i: number) {
  const list = article.value?.sentences || []
  const target = Math.max(0, Math.min(list.length - 1, i))
  /**
   * 已经在放这一句就什么都不做。
   *
   * 原来每点一下都重新起一遍：点两下就是两条 timeupdate 监听、两个定时器，
   * 各自到点又各自 playFrom，听感就是同一句被反复重放、越点越乱。
   */
  if (continuousOn.value && playingIdx.value === target) return
  continuousOn.value = true
  if (shadowDrill.value) playThenRecord(target)
  else playFrom(target)
}

/**
 * 跟读一句：先放原声，放完停下，自动开录音。
 *
 * 时间上限用「这句时长 + 10 秒」兜底：万一没检测到静音也不会一直录着。
 * 用户没出声的话，静音检测会在 1.6 秒后把它收掉。
 */
async function playThenRecord(idx: number) {
  const a = article.value
  const sent = a?.sentences[idx]
  const el = audioEl.value
  if (!a || !sent) return

  // 先把可能在录的收掉，避免原声被录进去
  if (recordingIdx.value !== null) await stopRecording(recordingIdx.value, '')

  playingIdx.value = idx
  scrollShadowIntoView(idx)

  if (el && sent.audioStart != null && sent.audioEnd != null) {
    await new Promise<void>(resolve => {
      const done = () => {
        if (el.currentTime >= (sent.audioEnd as number)) {
          el.removeEventListener('timeupdate', done)
          el.pause()
          resolve()
        }
      }
      el.playbackRate = shadowRate.value
      el.volume = shadowVolume.value
      el.currentTime = Math.max(0, (sent.audioStart as number) - 0.1)
      el.addEventListener('timeupdate', done)
      el.play().catch(() => { el.removeEventListener('timeupdate', done); resolve() })
      setTimeout(() => { el.removeEventListener('timeupdate', done); el.pause(); resolve() },
        ((sent.audioEnd as number) - (sent.audioStart as number)) * 1000 / shadowRate.value + 1200)
    })
  }

  // 原声停了再开录音，两边不重叠
  await new Promise(r => setTimeout(r, 200))
  await toggleRecord(idx, sent.en)

  // 兜底上限：这句时长 + 10 秒
  const cap = sent.audioEnd != null && sent.audioStart != null
    ? (sent.audioEnd - sent.audioStart) * 1000 + 10_000
    : 15_000
  setTimeout(() => { if (recordingIdx.value === idx) void stopRecording(idx, sent.en) }, cap)
}
const playingIdx = ref(-1)
/**
 * 中英显示的三档拨杆。
 * both（中间）→ 遮英文（拨左，只剩中文）→ 遮中文（拨右，只剩英文）→ 回 both
 */
const langPos = computed(() => {
  if (showChinese.value && showEnglish.value) return 'mid'
  return showChinese.value ? 'left' : 'right'
})
const langTitle = computed(() =>
  langPos.value === 'mid' ? '中英对照，点一下只看中文'
    : langPos.value === 'left' ? '只看中文，点一下只看英文'
      : '只看英文，点一下回到中英对照'
)
function cycleLang() {
  if (showChinese.value && showEnglish.value) {
    showEnglish.value = false          // 只剩中文
  } else if (showChinese.value) {
    showChinese.value = false          // 只剩英文
    showEnglish.value = true
  } else {
    showChinese.value = true           // 回到都显示
    showEnglish.value = true
  }
}

/** 播放速度。跟音量一样，改了立刻作用到正在播的音频，并记住 */
const shadowRate = ref(Number(localStorage.getItem('lb-shadow-rate')) || 1)
watch(shadowRate, r => {
  if (audioEl.value) audioEl.value.playbackRate = r
  localStorage.setItem('lb-shadow-rate', String(r))
})

/** 对轴面板里的试听速度。手动标时间点时常要放慢才听得清。 */
const alignRate = ref(1)
watch(alignRate, r => {
  if (audioEl.value) audioEl.value.playbackRate = r
})
/**
 * 句间停顿，按句子时长的比例。
 * 0 = 不停（连续播放）；1.0 ≈ 留出和这句一样长的时间跟读；1.2 稍宽裕。
 * 之前是固定 1 秒 / 2 秒，语速慢的人根本跟不上。
 */
const shadowGapRatio = ref(Number(localStorage.getItem('lb-shadow-gap')) || 0)

/**
 * 面板位置。默认贴在底部居中，用户拖过之后记住坐标。
 * 文章长的时候面板固定在底部会压住正文，能挪开更实用。
 */
const barPos = ref<{ x: number; y: number } | null>(
  (() => {
    try {
      const v = JSON.parse(localStorage.getItem('lb-shadow-bar-pos') || '')
      if (typeof v?.x === 'number' && typeof v?.y === 'number') return v
    } catch { /* 没存过就用默认位置 */ }
    return null
  })()
)

const shadowBarStyle = computed(() => {
  if (!barPos.value) {
    return {
      left: 'calc(var(--lb-nav-w, 178px) + 50%)',
      transform: 'translateX(-50%)',
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)'
    }
  }
  return { left: barPos.value.x + 'px', top: barPos.value.y + 'px', bottom: 'auto', transform: 'none' }
})

function onBarDragStart(e: PointerEvent) {
  const panel = (e.currentTarget as HTMLElement).parentElement
  if (!panel) return
  const r = panel.getBoundingClientRect()
  const offX = e.clientX - r.left
  const offY = e.clientY - r.top

  const move = (ev: PointerEvent) => {
    barPos.value = {
      x: Math.max(8, Math.min(window.innerWidth - r.width - 8, ev.clientX - offX)),
      y: Math.max(8, Math.min(window.innerHeight - r.height - 8, ev.clientY - offY))
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (barPos.value) localStorage.setItem('lb-shadow-bar-pos', JSON.stringify(barPos.value))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/** 当前这条拉条在调什么 */
const sliderTarget = ref<'volume' | 'rate' | 'gap'>(
  (localStorage.getItem('lb-slider-target') as any) || 'volume'
)
watch(sliderTarget, v => localStorage.setItem('lb-slider-target', v))

/** 拉条的范围和显示文字，按当前选的项来 */
const sliderCfg = computed(() => {
  if (sliderTarget.value === 'rate') {
    return { min: 0.5, max: 1.5, step: 0.05, value: shadowRate.value, text: shadowRate.value.toFixed(2) + '×' }
  }
  if (sliderTarget.value === 'gap') {
    return {
      min: 0, max: 1.2, step: 0.1, value: shadowGapRatio.value,
      text: shadowGapRatio.value === 0 ? '不停' : shadowGapRatio.value.toFixed(1) + '×'
    }
  }
  return { min: 0, max: 1, step: 0.05, value: shadowVolume.value, text: Math.round(shadowVolume.value * 100) + '%' }
})

function onSliderInput(v: number) {
  if (sliderTarget.value === 'rate') shadowRate.value = v
  else if (sliderTarget.value === 'gap') shadowGapRatio.value = v
  else shadowVolume.value = v
}

/** 播放音量。改了立刻作用到正在播的音频上 */
const shadowVolume = ref(Number(localStorage.getItem('lb-shadow-vol') ?? '1'))
watch(shadowVolume, v => {
  if (audioEl.value) audioEl.value.volume = v
  localStorage.setItem('lb-shadow-vol', String(v))
})
watch(shadowGapRatio, v => localStorage.setItem('lb-shadow-gap', String(v)))
let contTimer: ReturnType<typeof setTimeout> | null = null
const shadowRows = new Map<number, HTMLElement>()
function setShadowRowRef(el: any, i: number) {
  if (el) shadowRows.set(i, el as HTMLElement)
  else shadowRows.delete(i)
}

/** 停止：回到未播放状态（切文章、出错时用） */
function stopContinuous() {
  continuousOn.value = false
  playingIdx.value = -1
  if (contTimer) { clearTimeout(contTimer); contTimer = null }
  if (audioEl.value && contWatcher) {
    audioEl.value.removeEventListener('timeupdate', contWatcher)
    contWatcher = null
  }
  if (audioEl.value) audioEl.value.pause()
}

function toggleContinuous() {
  if (continuousOn.value) { pausePlayback(); return }

  /**
   * 从暂停的地方接着播，不要回到句首。
   *
   * 之前暂停时把 playingIdx 清成了 -1，再点播放 from 就变成 0 —— 整篇从头重放。
   * 而且 playFrom 会 seek 到句首，就算下标对也会跳回这句开头。
   * 所以只要音频还停在中途，就直接 play()，一个 seek 都不做。
   */
  const el = audioEl.value
  continuousOn.value = true
  if (el && el.currentTime > 0.05 && !el.ended) {
    el.playbackRate = shadowRate.value
    attachWatcher(playingIdx.value >= 0 ? playingIdx.value : 0)
    el.play().catch(() => stopContinuous())
    return
  }
  playFrom(playingIdx.value >= 0 ? playingIdx.value : 0)
}

/** 暂停：保留当前位置和句号，跟「停止」区分开 */
function pausePlayback() {
  continuousOn.value = false
  if (contTimer) { clearTimeout(contTimer); contTimer = null }
  audioEl.value?.pause()
}

/**
 * 播放。
 *
 * 默认**不切句**：从当前句一路放下去，高亮跟着时间走。
 * 之前每到句尾都 pause 一下再续播，而对轴总有误差，听感就是"一段一段"的 ——
 * 那种停顿只有练跟读时才需要，所以只在开了「单句循环」或设了「句间停顿」时才停。
 */
/**
 * 挂上进度监听。播放和「暂停后继续」共用，所以单独抽出来 ——
 * 之前继续播放那条路没有监听，高亮会停在原地不动。
 *
 * @param idx 当前在第几句
 */
/**
 * 跟读流程里正在录的是第几句。
 * -1 表示这次录音是用户自己点的，不是跟读流程带出来的 —— 那种情况录完就停，不往下走。
 */
let drillIdx = -1

function attachWatcher(idx: number) {
  const el = audioEl.value
  if (!el) return
  const arts = article.value?.sentences || []
  const s = arts[idx]

  if (contTimer) { clearTimeout(contTimer); contTimer = null }
  if (contWatcher) { el.removeEventListener('timeupdate', contWatcher); contWatcher = null }

  // 只有练跟读的两个开关才需要在句尾停
  /**
   * 跟读开着就一定要在句尾停。
   *
   * 原来只看 shadowGapRatio > 0，而它默认是 0 —— 于是跟读开关打开了，
   * 句子放完还是直接冲下一句，停顿拉条怎么调都没反应。
   */
  const pauseAtEnd = shadowDrill.value || shadowLoopOne.value || shadowGapRatio.value > 0

  contWatcher = () => {
    if (!continuousOn.value) return
    const t = el.currentTime

    if (!pauseAtEnd) {
      // 连续播放：只更新高亮，一个字都不碰播放
      let cur = -1
      for (let k = 0; k < arts.length; k++) {
        const a = arts[k].audioStart
        const b = arts[k].audioEnd
        if (a == null || b == null) continue
        if (t >= a && t < b) { cur = k; break }
      }
        if (cur >= 0 && cur !== playingIdx.value) {
        playingIdx.value = cur
        scrollShadowIntoView(cur)
        // 把当前句子报给桌面悬浮球的控制台
        const g = window as any
        g.__lbNowTitle = article.value?.title || ''
        g.__lbNowLine = arts[cur]?.zh || arts[cur]?.en || ''
        g.__lbNextLine = arts[cur + 1]?.zh || arts[cur + 1]?.en || ''
      }
      return
    }

    // 跟读：真的播过这句才算读完，留 0.15 秒余量防边界抖动
    const endAt = (s?.audioEnd ?? 0) + 0.15
    if (t < endAt) return
    el.pause()
    if (contWatcher) { el.removeEventListener('timeupdate', contWatcher); contWatcher = null }

    /**
     * 留白时长 = 这句时长 × 「句间停顿」拉条的比例。
     * 拉满约等于再给你一句话的时间，够跟读一遍；拉到最左就是不停。
     */
    const dur = ((s?.audioEnd ?? 0) - (s?.audioStart ?? 0)) / shadowRate.value
    const gapMs = dur * shadowGapRatio.value * 1000

    /**
     * 跟读开着：留白期间自动开录音。
     *
     * 关键是 drillIdx —— 说完之后静音检测会把录音停掉，
     * 但"停录音"和"进下一句"是两回事：原来只停不走，
     * 用户还得手动再点一次，而再点又会重放原声，就卡在那儿了。
     * 记下这一句在跟读流程里，stopRecording 收尾时自己往下走。
     */
    if (shadowDrill.value) {
      drillIdx = idx
      void toggleRecord(idx, s?.en || '')

      /**
       * 什么时候进下一句：**等你说完**，不是等一个固定时长。
       *
       * 说完由静音检测判定（stopRecording 里会自动往下走）。
       * 这里的定时器只是兜底 —— 万一环境太吵一直判不出静音，
       * 也不能无限录下去。上限给得宽松：这句本身的时长 ×(1+停顿比例) 再加 4 秒，
       * 停顿拉条在这里的作用是「最多再多给你几成时间」。
       */
      const cap = dur * 1000 * (1 + shadowGapRatio.value) + 4000
      contTimer = setTimeout(() => {
        if (recordingIdx.value === idx) void stopRecording(idx, s?.en || '')
      }, cap)
      return
    }

    contTimer = setTimeout(() => {
      if (!continuousOn.value) return
      playFrom(shadowLoopOne.value ? idx : idx + 1)
    }, gapMs)
  }
  el.addEventListener('timeupdate', contWatcher)
}

/**
 * 从第 i 句开始播。
 *
 * 默认**不切句**：一路放下去，高亮跟着时间走。之前每到句尾都 pause 再续播，
 * 而对轴总有误差，听感就是"一段一段"的 —— 那种停顿只有练跟读才需要。
 */
function playFrom(i: number) {
  const arts = article.value?.sentences || []
  let idx = i
  while (idx < arts.length && arts[idx].audioStart == null) idx++
  if (idx >= arts.length || !audioEl.value) {
    // 这一篇放完了，按循环方式决定下一步
    if (idx >= arts.length) {
      if (loopMode.value === 'article') { playFrom(0); return }
      if (loopMode.value === 'list') { void playNextChapter(); return }
    }
    stopContinuous()
    return
  }

  const s = arts[idx]
  playingIdx.value = idx
  scrollShadowIntoView(idx)

  const el = audioEl.value
  el.playbackRate = shadowRate.value
  el.volume = shadowVolume.value
  // 往前留 0.12 秒：seek 有精度误差，不留提前量第一个音容易被削掉
  el.currentTime = Math.max(0, (s.audioStart as number) - 0.12)
  el.play().catch(() => stopContinuous())

  attachWatcher(idx)
}

function scrollShadowIntoView(i: number) {
  const el = shadowRows.get(i)
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

watch(viewSubMode, m => { if (m !== 'shadow') stopContinuous() })
onBeforeUnmount(stopContinuous)

/**
 * 取当前文章的音频文件（给需要 File 的地方用，比如上传去 MFA 对齐）。
 * 优先后端那份，其次才是历史遗留的 IndexedDB / 句柄。
 */
async function currentAudioFile(): Promise<File | null> {
  const a = article.value
  if (!a) return null
  if (a.audioUrl) {
    try {
      const res = await fetch(a.audioUrl)
      if (res.ok) {
        const blob = await res.blob()
        return new File([blob], a.audioFileName || 'audio.wav', { type: blob.type })
      }
    } catch { /* 取不到就往下走老路径 */ }
  }
  return await getArticleAudioFile(a.id)
}

/**
 * 关联的音频还在、但这次打开需要重新授权。
 * 只有这一种情况才显示「重新授权」按钮：文件根本没关联时不该出现。
 */
const audioNeedsPermission = ref(false)

async function loadArticleAudio(interactive = false) {
  const a = article.value
  if (!a) return
  alignMessage.value = ''
  audioNeedsPermission.value = false

  // 后端那份：直接用地址，不需要任何授权
  if (a.audioUrl) {
    if (audioObjectUrl.value.startsWith('blob:')) URL.revokeObjectURL(audioObjectUrl.value)
    audioObjectUrl.value = a.audioUrl
    return
  }

  /**
   * 没有 audioUrl 的都是老数据（IndexedDB blob 或文件句柄）。
   * 读到之后**顺手搬到后端**并写回 audioUrl —— 一次性的，
   * 搬完这篇以后就走上面那条路，不用再管授权、也不怕源文件被删。
   * 句柄那种读不到就只能等用户点一次「重新授权」，那一下有手势才能要到权限。
   */
  const r = await getArticleAudio(a.id, interactive)
  if (audioObjectUrl.value.startsWith('blob:')) URL.revokeObjectURL(audioObjectUrl.value)

  if (r.kind === 'ok') {
    const url = await uploadArticleAudio(r.file, a.audioFileName || r.file.name)
    if (url) {
      await readerStore.saveArticle({ ...a, audioUrl: url })
      await clearArticleAudio(a.id)   // 后端已经有了，本地这份不用再占地方
      audioObjectUrl.value = url
      return
    }
    audioObjectUrl.value = URL.createObjectURL(r.file)
    return
  }

  audioObjectUrl.value = ''
  audioNeedsPermission.value = r.kind === 'need-permission'
}

/**
 * 用户点按钮触发 —— 带着手势去要权限，这时 requestPermission 才允许调用。
 * 要到之后立刻把文件内容转存进库里，这样只需要授权这最后一次。
 */
/**
 * 老数据里存的是文件句柄，要读它得先要权限，而**要权限必须有用户手势**。
 *
 * 不为这件事单独做一个按钮：那是个只会用到一次的东西，用完就成了界面上的垃圾。
 * 改成搭车 —— 用户点开「音频 / 视频」这个面板本身就是一次点击，
 * 在这个时机去要权限是合法的。要到之后立刻搬进 resources/media/，
 * 从此这篇再也不走句柄那条路，也就不会再触发第二次。
 */
watch(viewSubMode, async m => {
  if (m !== 'audioAlign') return
  if (!audioNeedsPermission.value) return
  await loadArticleAudio(true)
})

const videoBusy = ref(false)
const videoProgress = ref('')
const subMessage = ref('')

async function onPickVideo(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  await handleVideoFile(f)
}

/**
 * 从视频里抽音轨。
 *
 * 原来是把整个视频 POST 给本地服务、调 ffmpeg —— 而绝大多数人机器上没有
 * ffmpeg，一点就是「本机没装 ffmpeg」，等于这功能不存在。现在改成浏览器
 * 自己解码（decodeAudioData + OfflineAudioContext 重采样到 16kHz 单声道），
 * 不依赖任何外部程序，视频也不用上传。
 */
async function handleVideoFile(f: File | null | undefined) {
  if (!f || !article.value) return
  if (!/^video\//.test(f.type) && !/\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(f.name)) {
    alignMessage.value = '这不像是视频文件'
    return
  }

  videoBusy.value = true
  alignMessage.value = ''
  try {
    /**
     * 先看看视频里有没有内嵌字幕轨 —— 有的话直接拿来对轴，比跑模型准得多，
     * 而且几秒钟就好。抽完音轨视频就丢了，所以必须在那之前取。
     */
    let embedded: { start: number; end: number; text: string }[] = []
    try {
      videoProgress.value = '找字幕轨…'
      const { extractEmbeddedSubtitles } = await import('@/shared/core/videoSubtitles')
      const tracks = await extractEmbeddedSubtitles(f, m => { videoProgress.value = m })
      // 有多条轨时优先英文
      const pick = tracks.find(t => /^en/i.test(t.language)) || tracks[0]
      if (pick?.cues.length) embedded = pick.cues
    } catch {
      /* 取不到就算了，后面还有别的对轴办法 */
    }

    const { extractAudioFromVideo } = await import('@/shared/core/videoAudio')
    const r = await extractAudioFromVideo(f, (stage, ratio) => {
      videoProgress.value = `${stage} ${Math.round(ratio * 100)}%`
    })
    // 抽出来的音轨也走后端，跟「选择音频」同一个去处
    const upUrl = await uploadArticleAudio(r.blob, r.fileName)
    if (upUrl) {
      await readerStore.saveArticle({ ...article.value, audioFileName: r.fileName, audioUrl: upUrl })
    } else {
      await saveArticleAudioBlob(article.value.id, r.blob, r.fileName)
      await readerStore.saveArticle({ ...article.value, audioFileName: r.fileName })
    }
    await loadArticleAudio()
    alignCursor.value = 0
    const mb = r.blob.size / 1048576
    let extra = ''
    if (embedded.length && article.value) {
      // 拿内嵌字幕直接对轴，不用再跑模型
      const timedWords: { word: string; start: number; end: number }[] = []
      for (const c of embedded) {
        const ws = (c.text.match(/[A-Za-z0-9']+/g) || [])
        if (!ws.length) continue
        const span = Math.max(0.001, (c.end - c.start) / ws.length)
        ws.forEach((w, k) => {
          timedWords.push({ word: w, start: c.start + k * span, end: c.start + (k + 1) * span })
        })
      }
      const { alignSentencesToTranscript, matchRate } = await import('@/shared/core/forcedAlign')
      const timings = alignSentencesToTranscript(
        article.value.sentences.map(x => x.en),
        timedWords,
        undefined,
        looksBilingual(article.value.sentences)
      )
      const rate = matchRate(timings)
      if (rate > 0.2) {
        const sentences = article.value.sentences.map((sent, i) => {
          const t = timings[i]
          return t ? { ...sent, audioStart: t.start, audioEnd: t.end, audioZhStart: t.zhStart } : sent
        })
        await readerStore.saveArticle({ ...article.value, sentences })
        extra = `，并用视频自带的 ${embedded.length} 条字幕自动对好了轴（命中率 ${(rate * 100).toFixed(0)}%）`
      }
    }

    subMessage.value =
      `已抽出音轨 ${Math.round(r.seconds / 60)} 分钟 / ${mb.toFixed(1)}MB，原视频没有保存` + extra +
      (mb > 150 ? '。这份偏大，浏览器存储吃紧的话建议先把长视频切段再导入。' : '')
  } catch (err) {
    alignMessage.value = '抽取失败：' + (err instanceof Error ? err.message : String(err))
  } finally {
    videoBusy.value = false
    videoProgress.value = ''
  }
}

/** 拖放到面板上 */
const dropActive = ref(false)

function onMediaDragOver(e: DragEvent) {
  e.preventDefault()
  dropActive.value = true
}

function onMediaDragLeave() {
  dropActive.value = false
}

async function onMediaDrop(e: DragEvent) {
  e.preventDefault()
  dropActive.value = false
  const f = e.dataTransfer?.files?.[0]
  if (!f || !article.value) return
  if (/^video\//.test(f.type) || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(f.name)) {
    await handleVideoFile(f)
    return
  }
  if (/^audio\//.test(f.type) || /\.(mp3|m4a|wav|ogg|aac)$/i.test(f.name)) {
    await saveArticleAudioBlob(article.value.id, f, f.name)
    await readerStore.saveArticle({ ...article.value, audioFileName: f.name })
    await loadArticleAudio()
    alignCursor.value = 0
    subMessage.value = `已关联「${f.name}」`
    return
  }
  if (/\.(srt|vtt|txt)$/i.test(f.name)) {
    await applySubtitleFile(f)
    return
  }
  alignMessage.value = '拖进来的不是音频、视频或字幕文件'
}

async function onPickSubtitle(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  await applySubtitleFile(f)
}

/** 字幕对轴。选文件和拖放两条路都走这里。 */
async function applySubtitleFile(f: File | null | undefined) {
  if (!f || !article.value) return
  subMessage.value = ''
  try {
    const cues = parseSubtitles(await f.text())
    if (!cues.length) { subMessage.value = '没解析出字幕条目，确认是 .srt / .vtt 格式'; return }

    // 跟转写走同一套词级对齐：字幕断句和文章断句往往不一致
    // （一条字幕可能横跨两句，或者一句被切成三条），按条顺序凑必然错位。
    const timedWords: { word: string; start: number; end: number }[] = []
    for (const c of cues) {
      const ws = (c.text.match(/[A-Za-z0-9']+/g) || [])
      if (!ws.length) continue
      const span = Math.max(0.001, (c.end - c.start) / ws.length)
      ws.forEach((w, k) => {
        timedWords.push({ word: w, start: c.start + k * span, end: c.start + (k + 1) * span })
      })
    }
    const { alignSentencesToTranscript, matchRate } = await import('@/shared/core/forcedAlign')
    const timings = alignSentencesToTranscript(
      article.value.sentences.map(x => x.en),
      timedWords,
      undefined,
      looksBilingual(article.value.sentences)
    )
    const rate = matchRate(timings)
    if (rate < 0.15) {
      subMessage.value = `解析到 ${cues.length} 条字幕，但只对上 ${(rate * 100).toFixed(0)}% 的词，确认字幕和文章是同一篇`
      return
    }
    const sentences = article.value.sentences.map((sent, i) => {
      const t = timings[i]
      return t ? { ...sent, audioStart: t.start, audioEnd: t.end, audioZhStart: t.zhStart } : sent
    })
    await readerStore.saveArticle({ ...article.value, sentences })
    subMessage.value = `已对轴 ${sentences.length} 句，词级命中率 ${(rate * 100).toFixed(0)}%`
  } catch (err) {
    subMessage.value = '读取失败：' + (err instanceof Error ? err.message : String(err))
  }
}

const w2vBusy = ref(false)

/**
 * 当前这篇的对轴状态。
 *
 * w2vBusy / w2vProgress 是全局 ref —— 任何一篇在跑，所有文章的对轴面板
 * 都会显示「识别第 10/17 段」。进度是属于某一篇的，得按文章 id 取。
 */
const myAlignJob = computed(() => (article.value ? alignJobs[article.value.id] : undefined))
const myAligning = computed(() => !!myAlignJob.value?.running || w2vBusy.value)
const myAlignText = computed(() => myAlignJob.value?.msg || w2vProgress.value || '处理中…')
const w2vProgress = ref('')

/**
 * 在 Worker 里跑识别，返回带时间的词。
 *
 * 计算全在另一个线程，主线程只收进度 —— 所以对轴期间可以随便切页面，
 * 任务照跑。之前放在主线程，切到设置页就卡死、请求超时报"后端未连接"。
 */
/**
 * 起对轴任务。不 await —— 任务挂在模块级的 alignJob 上，
 * 页面切走再回来照样能看到进度，结果由 watch 接住。
 */
/**
 * 对轴任务池的进度。
 *
 * 现在可以同时跑几篇，所以不能再用一份全局状态 ——
 * 每篇的进度各归各的，页面上只显示"当前打开的这一篇"的。
 */
watch(
  () => Object.values(alignJobs).map(j => `${j.articleId}|${j.running}|${j.msg}|${j.ratio}`).join(','),
  () => {
    const mine = article.value ? alignJobs[article.value.id] : undefined
    if (mine?.running) {
      aligningId.value = mine.articleId
      alignProgress.value = { msg: mine.msg, ratio: mine.ratio }
      subMessage.value = mine.msg
    } else {
      aligningId.value = ''
      alignProgress.value = null
      w2vBusy.value = false
      asrBusy.value = false
    }
  }
)

/** 任何一篇报错都要说出来，标明是哪一篇 */
watch(
  () => Object.values(alignJobs).map(j => j.articleId + '|' + j.error).join(','),
  () => {
    for (const j of Object.values(alignJobs)) {
      if (!j.error) continue
      subMessage.value = `《${j.title}》对齐失败：${j.error}`
      j.error = ''
    }
  }
)

/** 任何一篇跑完，就把它的词级结果对到它自己的句子上 */
watch(
  () => Object.values(alignJobs).map(j => j.articleId + '|' + (j.result ? j.result.length : 0)).join(','),
  async () => {
    for (const job of Object.values(alignJobs)) {
      const words = job.result
      if (!words?.length) continue
      job.result = null

      const target = readerStore.articles.find(x => x.id === job.articleId)
      if (!target) continue

      const { alignSentencesToTranscript, matchRate } = await import('@/shared/core/forcedAlign')
      // 把音频真实时长一并传进去，末尾那段没识别出词的部分才不会被截掉
      const dur = audioEl.value?.duration
      const timings = alignSentencesToTranscript(
        target.sentences.map(x => x.en),
        words,
        Number.isFinite(dur) ? dur : undefined,
        looksBilingual(target.sentences)
      )
      const rate = matchRate(timings)
      const sentences = target.sentences.map((sent, i) => {
        const t = timings[i]
        return t ? { ...sent, audioStart: t.start, audioEnd: t.end, audioZhStart: t.zhStart } : sent
      })
      await readerStore.saveArticle({ ...target, sentences })

      const done = rate > 0.35
        ? `《${target.title}》对齐完成：识别 ${words.length} 个词，命中率 ${(rate * 100).toFixed(0)}%`
        : `《${target.title}》只对上 ${(rate * 100).toFixed(0)}% 的词——音频和文章可能不是同一篇`
      subMessage.value = done

      /**
       * 对完轴直接进跟读界面 —— 但只在"这篇正开着"的时候。
       * 后台跑的其他文章不该把当前界面抢走。
       */
      if (rate > 0.35 && article.value?.id === target.id) {
        viewSubMode.value = 'shadow'
      }
    }
  }
)

async function startAlign(a: Article, pcm: Float32Array) {
  const { startAlignJob } = await import('@/shared/core/alignJob')
  if (!startAlignJob(a.id, pcm, a.title)) {
    // 现在只有"这一篇自己已经在跑/在排队"才会被拒，别的文章不影响
    subMessage.value = `《${a.title}》已经在对轴了`
    return false
  }
  const { runningCount, queuedCount } = await import('@/shared/core/alignJob')
  subMessage.value = queuedCount()
    ? `已加入队列：正在跑 ${runningCount()} 个，前面还排着 ${queuedCount()} 个`
    : '开始对轴，可以去看别的文章，进度在右下角'
  return true
}

/** 对轴进度：文章列表那一行画一条进度条，跟整理的进度条用不同颜色区分 */
const alignProgress = ref<{ msg: string; ratio: number } | null>(null)
/** 正在对轴的文章 id */
const aligningId = ref('')

/**
 * 声学强制对齐：本机跑 wav2vec2 CTC，拿逐帧概率和文本做 Viterbi 对齐。
 * 这是真正的 forced alignment（torchaudio 教程那套），不是按长度估的。
 * 模型地址可在设置里配；没配就提示，不静默失败。
 */
async function doForcedAlign() {
  const a = article.value
  if (!a) return
  const file = await getArticleAudioFile(a.id)
  if (!file) { subMessage.value = '先关联音频再对齐'; return }

  w2vBusy.value = true
  aligningId.value = a.id
  alignProgress.value = { msg: '准备…', ratio: 0 }
  subMessage.value = ''
  try {
    const { decodeTo16k } = await import('@/shared/core/w2v2Aligner')
    const pcm = await decodeTo16k(file, (m, r) => {
      w2vProgress.value = m
      alignProgress.value = { msg: m, ratio: r ?? 0 }
    })

    await startAlign(a, pcm)
  } catch (e) {
    subMessage.value = '强制对齐失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    w2vBusy.value = false
    w2vProgress.value = ''
    aligningId.value = ''
    alignProgress.value = null
  }
}

const autoAligning = ref(false)

/**
 * 一键自动对轴：按每句的音节数把音频时长分下去。
 * 不需要字幕，也不用手动点几百次「标记开始」。
 */
async function doAutoAlign() {
  const a = article.value
  if (!a || !audioEl.value) return
  const dur = audioEl.value.duration
  if (!dur || !isFinite(dur)) {
    alignMessage.value = '音频还没加载好，等它读出时长再试'
    return
  }
  autoAligning.value = true
  subMessage.value = ''
  try {
    const { autoAlign, looksReasonable } = await import('@/shared/core/autoAlign')
    const r = autoAlign(a.sentences, dur)
    if (!r.timings.length) {
      subMessage.value = '这篇没有可用的英文句子，对不了'
      return
    }
    const sentences = a.sentences.map((sent, i) => {
      const t = r.timings[i]
      return t ? { ...sent, audioStart: t.start, audioEnd: t.end, audioZhStart: t.zhStart } : sent
    })
    await readerStore.saveArticle({ ...a, sentences })
    alignCursor.value = 0
    subMessage.value =
      `已对轴 ${r.timings.length} 句（按音节数分配，语速 ${r.syllablesPerSecond.toFixed(1)} 音节/秒）。` +
      (looksReasonable(r.syllablesPerSecond)
        ? '个别句子偏差可以在下面手动微调。'
        : '语速看着不太对，确认这段音频和这篇文章是同一篇。')
  } catch (e) {
    subMessage.value = '自动对轴失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    autoAligning.value = false
  }
}

const asrBusy = ref(false)

/**
 * 语音识别对轴。
 *
 * 优先在浏览器里做：wav2vec2-base-960h 本身就是 CTC 语音识别模型，跟「强制对齐」
 * 用的是同一份模型、同一份缓存，第一次下过之后不再下载。所以这条**不需要装
 * whisper、也不需要启动后端**。
 * 只有浏览器这条走不通（模型下不到）时，才退回本机 whisper。
 */
async function doTranscribe() {
  const a = article.value
  if (!a) return
  asrBusy.value = true
  aligningId.value = a.id
  alignProgress.value = { msg: '准备…', ratio: 0 }
  subMessage.value = ''
  try {
    const file = await getArticleAudioFile(a.id)
    if (!file) throw new Error('先关联音频再转写')

    const { decodeTo16k } = await import('@/shared/core/w2v2Aligner')
    const pcm = await decodeTo16k(file, (m, r) => { alignProgress.value = { msg: m, ratio: r ?? 0 } })

    await startAlign(a, pcm)
  } catch (e) {
    subMessage.value = '识别对轴失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    asrBusy.value = false
    aligningId.value = ''
    alignProgress.value = null
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
    /**
     * 选完直接把文件交给后端存下来，文章上只留一个 audioUrl。
     *
     * 原来存的是文件句柄 —— 指向你磁盘上那个文件，权限活不过重启、
     * 原文件一删就废。现在文件进了 data/media/，跟文章数据放在一起，
     * 源文件删掉也照样能播，也不用再授权。
     */
    const picked = await pickArticleAudioFile()
    if (picked) {
      const url = await uploadArticleAudio(picked, picked.name)
      if (url) {
        await readerStore.saveArticle({ ...article.value, audioFileName: picked.name, audioUrl: url })
      } else {
        // 后端没起来时退回旧办法，至少这次会话能用
        await saveArticleAudioBlob(article.value.id, picked, picked.name)
        await readerStore.saveArticle({ ...article.value, audioFileName: picked.name, audioUrl: undefined })
        alignMessage.value = '后端没响应，音频暂存在本地库里'
      }
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
  // 选了「我的录音」或「原声 → 我的」就交给 playBoth/playMine，它们已经处理好了顺序
  if (hasRec.value[i]) {
    if (playSource.value === 'mine') { void playMine(i); return }
    if (playSource.value === 'both') { void playBoth(i); return }
  }
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
/*
 * 这里原本还有 reciteRecognizer / reciteBaseText / reciteScoring /
 * reciteFeedback / shadowRecordingIdx 五个，都是打分那条链路的零件。
 * 链路拆掉之后它们只剩「声明」和「换文章时重置」两处引用，
 * 没有任何地方读它们的值。留着会让人以为打分还在，一起删掉。
 */
/**
 * 跟读打分整条链路已经拆掉了。
 *
 * 原来这里存 { text, score }：本机 wav2vec2 盲听几秒短录音转出文字，
 * 再跟原文比对算一个分。转写质量撑不起来（"SAMER ON MOUN'S ALL AT ONCE" 这种），
 * 算出来的分自然也是胡来的 —— 六千多分那次就是这么来的。
 * 转写去掉之后这个 ref 再没人写过，doneCount 恒为 0、
 * 「复盘跟读」按钮永远不出现、askShadowReview 永远进不去，全是死代码。
 *
 * 现在改成不打分：只给能客观量出来的东西 —— 原声这句多长、我读了多久、
 * 快了还是慢了，以及原声接着自己的连着听。见下面的「录音对比」。
 */

/** 实时听到的文字，显示在句子下面 */
const liveText = ref('')


/* ---------- 逐句录音 ---------- */

const recSupported = ref(false)
const recordingIdx = ref<number | null>(null)
const micLevel = ref(0)
/** 哪些句子已经有录音 */
const hasRec = ref<Record<number, boolean>>({})
const recCount = computed(() => Object.values(hasRec.value).filter(Boolean).length)


let recHandle: import('@/shared/core/voiceRecorder').RecordingHandle | null = null
let levelTimer: ReturnType<typeof setInterval> | null = null
/** 已经录了几秒，显示在按钮旁边，让人知道它确实在录 */
/**
 * 中间高两边低的包络。
 * 各条等权的话看着是柱状图；乘上这个包络才像一段声波。
 */
const waveShape = [0.45, 0.65, 0.85, 1, 1, 1, 0.85, 0.65, 0.45]

const recSeconds = ref(0)
let secTimer: ReturnType<typeof setInterval> | null = null
/** 识别到的最终文本，停止时用来打分 */
let heardText = ''
/** 声波竖条的实时高度 */
/**
 * 声波竖条。9 根就够 —— 16 根挤在 30px 高的行里每根只有 3px，
 * 区分不出高低，反而像一团噪点。
 */
const micBands = ref<number[]>(new Array(9).fill(0))

/** 每条录音多长（秒），显示在播放键左边 */
const recLen = ref<Record<number, number>>({})
/** 哪几句的文本框是展开的 */
const reciteOpen = ref<Record<number, boolean>>({})

/** 输入框跟着内容长高，不要一上来就占两行 */
function fitBox(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function autoGrow(e: Event) {
  fitBox(e.target as HTMLTextAreaElement)
}

/**
 * 展开时重新量一次高度。
 *
 * autoGrow 只在 @input 时跑，而识别结果是程序填进去的、不触发 input；
 * 更麻烦的是 el.style.height 是写在元素上的内联样式，
 * Vue 在 v-for 里复用 DOM —— 上一句撑高的高度会原样留给下一句，
 * 于是一个只有一行字的框顶着三行的高度杵在那儿。
 */
async function fitReciteBox(i: number) {
  await nextTick()
  const row = shadowRows.get(i)
  fitBox(row?.querySelector('.recite-inline') as HTMLTextAreaElement | null)
}

/*
 * 复述行底下原本印着一句 `原文：xxx`，后来改成「看原文」按钮 —— 两版都是多余的：
 * 想看原文，用顶上那个中/英切换开关就行，不需要在每句底下再来一套。
 */
function toggleRecite(i: number) {
  const open = !reciteOpen.value[i]
  reciteOpen.value = { ...reciteOpen.value, [i]: open }
  if (open) void fitReciteBox(i)
}

onMounted(async () => {
  const { recordingSupported } = await import('@/shared/core/voiceRecorder')
  recSupported.value = recordingSupported()
})

/** 换文章时重新统计哪些句子录过 */
watch(() => article.value?.id, async () => {
  hasRec.value = {}
  /**
   * recLen 也要清。
   *
   * 它记的是「第 i 句录了几秒」，按下标存 —— 换一篇文章，下标含义就变了，
   * 不清的话上一篇第 3 句的时长会挂到这一篇第 3 句上。
   * 原来只清 hasRec，这个残留一直在，只是以前只用来显示一个小小的
   * 「2.3s」不容易察觉；录音对比表把它摆成一列之后就会明显读错。
   */
  recLen.value = {}
  const a = article.value
  if (!a) return
  const { recordedIndexes } = await import('@/shared/core/voiceRecorder')
  const list = await recordedIndexes(a.id, a.sentences.length)
  const map: Record<number, boolean> = {}
  for (const i of list) map[i] = true
  hasRec.value = map
})

/**
 * 跟读 = 录音 + 识别，一个动作做完。
 *
 * 之前拆成两个按钮各做一半：「开始跟读」只识别不录音，小麦克风只录音不打分，
 * 所以点跟读时既看不到音量波动，也留不下录音。现在合成一个：
 * 按下同时开录音和识别，再按一次停止，两边结果一起落地。
 *
 * @param idx 第几句
 * @param original 这句的原文，用来打分
 */
async function toggleRecord(idx: number, original = '') {
  const a = article.value
  if (!a) return

  // 正在录这一句 → 停下，存录音 + 出评分
  if (recordingIdx.value === idx) {
    await stopRecording(idx, original)
    return
  }

  // 正在录别的句子 → 先把那句收干净，避免两段录音重叠
  if (recordingIdx.value !== null) await stopRecording(recordingIdx.value, '')

  try {
    const { startRecording } = await import('@/shared/core/voiceRecorder')
    recHandle = await startRecording()
    recordingIdx.value = idx
    recSeconds.value = 0
    liveText.value = ''
    heardText = ''

    /**
     * 每 60ms 取一次：音量、各频段高度、以及安静了多久。
     * 说完话安静 1.6 秒就自动收 —— 参照通用做法（自由录音一般设 2.5 秒，
     * 跟读一句话的停顿短得多）。用户手动点停止当然也行。
     */
    levelTimer = setInterval(() => {
      if (!recHandle) return
      micLevel.value = recHandle.level()
      /**
       * 竖条做平滑：涨得快、落得慢。
       *
       * 直接把每帧的原始值贴上去，条子会高频抖动，看着毛躁。
       * 涨的时候跟手（取新值），落的时候按 0.72 衰减 ——
       * 这是音量表的常规做法，视觉上跟得住声音又不刺眼。
       */
      const raw = recHandle.bands(9)
      micBands.value = micBands.value.map((prev, k) => {
        const next = raw[k] ?? 0
        return next > prev ? next : prev * 0.72
      })
      if (recHandle.silentFor() > 1600) void stopRecording(idx, original)
    }, 100)
    secTimer = setInterval(() => { recSeconds.value++ }, 1000)

    /**
     * 录音期间**不**开浏览器语音识别。
     *
     * MediaRecorder 和 SpeechRecognition 抢同一个麦克风：识别把流拿走之后，
     * 我这边的 AnalyserNode 读到的就是一条直线 —— 既判不出"说完了"，
     * 也拿不到文字。这两个毛病其实是同一个原因。
     *
     * 改成录完之后用本机 wav2vec2 转写（跟音频对轴同一份模型，不额外下载），
     * 麦克风全程只有录音在用。代价是没有实时字幕，换来的是这两件事真的能用。
     */
  } catch (e) {
    recordingIdx.value = null
    subMessage.value = '打不开麦克风：' + (e instanceof Error ? e.message : String(e))
  }
}

/** 收尾：停录音、停识别、存起来、算分 */
async function stopRecording(idx: number, original: string) {
  const a = article.value
  const h = recHandle
  recHandle = null
  recordingIdx.value = null
  if (levelTimer) { clearInterval(levelTimer); levelTimer = null }
  if (secTimer) { clearInterval(secTimer); secTimer = null }
  micLevel.value = 0
  micBands.value = new Array(9).fill(0)

  /**
   * 收尾：存录音 → 本机转写 → 填文本框 → 打分。
   *
   * 转写用的是跟音频对轴同一份 wav2vec2，在录音停下之后才跑，
   * 全程只有一个东西用麦克风，不存在抢流的问题。
   */
  liveText.value = ''
  if (!h || !a) return

  const secs = recSeconds.value
  const blob = await h.stop()
  if (!blob.size) return

  const { saveRecording } = await import('@/shared/core/voiceRecorder')
  await saveRecording(a.id, idx, blob)          // 同一句再录就是覆盖
  hasRec.value = { ...hasRec.value, [idx]: true }
  recLen.value = { ...recLen.value, [idx]: secs }
  reciteOpen.value = { ...reciteOpen.value, [idx]: true }

  /**
   * 先跳下一句，转写放到后台继续。
   *
   * 原来这段在转写之后 —— 转写要跑好几秒模型，于是读完一句得干等，
   * 等模型出结果才跳，跟读的节奏全断在这儿。
   * 录音已经存好了，跳走不影响稍后把文字填回这一句。
   */
  if (drillIdx === idx) {
    drillIdx = -1
    if (contTimer) { clearTimeout(contTimer); contTimer = null }
    if (continuousOn.value) {
      // 留半拍再放下一句，紧接着放会显得急
      contTimer = setTimeout(() => {
        if (continuousOn.value) playFrom(shadowLoopOne.value ? idx : idx + 1)
      }, 300)
    }
  }

  /**
   * 不再做语音转文字。
   *
   * 试过两条路都不成：wav2vec2 是为强制对齐选的（已知原文只对时间轴），
   * 盲听几秒短录音出来的是 "SAMER ON MOUN'S ALL AT ONCE" 这种；
   * 换 Whisper 要从 CDN 下 75MB 模型，加载慢、还不一定下得来。
   *
   * 跟读要的本来就不是转文字 —— 是「听原声、自己读、回放对比」。
   * 录音留下来能回放就够了；想核对文字，复述模式的输入框自己写更准。
   */

}

/**
 * 原声 → 我的，连着放。
 *
 * 成熟的影子跟读工具都有这个（SpeechShadowing 叫 Play Both Audio）：
 * 分两次点，中间隔几秒，细微的语调差别就听不出来了；连着放才听得出。
 */
const abIdx = ref<number | null>(null)

async function playBoth(idx: number) {
  const a = article.value
  if (!a) return
  if (abIdx.value === idx) { abIdx.value = null; return }
  abIdx.value = idx

  const sent = a.sentences[idx]
  const el = audioEl.value

  // 先放原声这一句
  if (el && sent?.audioStart != null && sent.audioEnd != null) {
    await new Promise<void>(resolve => {
      const stop = () => {
        if (el.currentTime >= (sent.audioEnd as number)) {
          el.removeEventListener('timeupdate', stop)
          el.pause()
          resolve()
        }
      }
      el.playbackRate = shadowRate.value
      el.currentTime = Math.max(0, (sent.audioStart as number) - 0.1)
      el.addEventListener('timeupdate', stop)
      el.play().catch(() => { el.removeEventListener('timeupdate', stop); resolve() })
      // 兜底：万一 timeupdate 不触发，按时长的两倍收
      setTimeout(() => { el.removeEventListener('timeupdate', stop); resolve() },
        ((sent.audioEnd as number) - (sent.audioStart as number)) * 2000 + 800)
    })
  }
  if (abIdx.value !== idx) return   // 中途被取消了

  // 中间留半拍，不然两段黏在一起反而难分辨
  await new Promise(r => setTimeout(r, 350))
  if (abIdx.value !== idx) return

  await playMine(idx)
  abIdx.value = null
}

/** 听自己录的那一条 */
async function playMine(idx: number) {
  const a = article.value
  if (!a) return
  const { loadRecording } = await import('@/shared/core/voiceRecorder')
  const blob = await loadRecording(a.id, idx)
  if (!blob) { subMessage.value = '这句还没有录音'; return }
  const url = URL.createObjectURL(blob)
  const el = new Audio(url)
  el.onended = () => URL.revokeObjectURL(url)
  el.play().catch(() => URL.revokeObjectURL(url))
}

/** 删掉这句的录音 */
async function dropRecording(idx: number) {
  const a = article.value
  if (!a) return

  /**
   * 删录音等于"这一句不要了"，整条流程都得停：
   * 正在录就先收掉、跟读队列不再往下走、在转的也不用转了。
   * 原来只删数据不管流程，删完它还在那儿自顾自往下跑。
   */
  if (recordingIdx.value === idx) {
    const h = recHandle
    recHandle = null
    recordingIdx.value = null
    if (levelTimer) { clearInterval(levelTimer); levelTimer = null }
    if (secTimer) { clearInterval(secTimer); secTimer = null }
    micLevel.value = 0
    micBands.value = new Array(9).fill(0)
    h?.cancel()
  }
  if (drillIdx === idx) drillIdx = -1
  if (contTimer) { clearTimeout(contTimer); contTimer = null }
  continuousOn.value = false
  audioEl.value?.pause()

  const { deleteRecording } = await import('@/shared/core/voiceRecorder')
  await deleteRecording(a.id, idx)
  const next = { ...hasRec.value }
  delete next[idx]
  hasRec.value = next
  const lens = { ...recLen.value }
  delete lens[idx]
  recLen.value = lens
  subMessage.value = `第 ${idx + 1} 句的录音已删除`
}

/* ---------- 录音对比（不打分） ---------- */

const showRecCompare = ref(false)

/**
 * 录过音的句子，逐条列出可以客观量出来的东西。
 *
 * **不打分**。能量的只有时长：原声这句多长（要对过轴才有）、我读了多久、差多少。
 * 语速快慢是真信息，"你这句 72 分"不是 —— 后者需要能听懂我读了什么，
 * 而本机那个识别做不到（见上面 shadowResults 那段说明）。
 */
interface RecCompareRow {
  idx: number
  text: string
  /** 原声时长，秒。没对过轴就是 null */
  refLen: number | null
  /** 我的录音时长，秒 */
  myLen: number
  /** 我的 ÷ 原声。null 表示没法比 */
  ratio: number | null
  verdict: string
}

const recCompareRows = computed<RecCompareRow[]>(() => {
  const a = article.value
  if (!a) return []
  const out: RecCompareRow[] = []
  a.sentences.forEach((sent, i) => {
    if (!hasRec.value[i]) return
    const myLen = recLen.value[i] || 0
    const refLen = sent.audioStart != null && sent.audioEnd != null
      // 对过轴的话，本句区间就是原声长度；双语音频要去掉中文那段
      ? Math.max(0, (sent.audioZhStart ?? sent.audioEnd) - sent.audioStart)
      : null

    let ratio: number | null = null
    let verdict = '没有原声可比'
    if (refLen && refLen > 0.3 && myLen > 0.3) {
      ratio = myLen / refLen
      // 一成以内算持平 —— 停顿位置的差别本来就会带来几个点的浮动，
      // 卡得太死会让每句都显示"偏慢"，那就成噪音了
      if (ratio > 1.35) verdict = '慢不少'
      else if (ratio > 1.1) verdict = '偏慢'
      else if (ratio < 0.75) verdict = '快不少'
      else if (ratio < 0.9) verdict = '偏快'
      else verdict = '差不多'
    } else if (!refLen) {
      verdict = '这篇没对过轴'
    }
    out.push({ idx: i, text: sent.en, refLen, myLen, ratio, verdict })
  })
  return out
})

/** 有原声可比的那些句子里，我整体偏快还是偏慢 */
const recCompareSummary = computed(() => {
  const rows = recCompareRows.value.filter(r => r.ratio != null)
  if (!rows.length) return ''
  const avg = rows.reduce((n, r) => n + (r.ratio as number), 0) / rows.length
  const pct = Math.round(Math.abs(avg - 1) * 100)
  if (pct <= 10) return `${rows.length} 句可比，整体跟原声差不多`
  return `${rows.length} 句可比，整体比原声${avg > 1 ? '慢' : '快'} ${pct}%`
})

/** 跳到那一句并高亮，方便边看表边回去重录 */
function gotoSentence(i: number) {
  showRecCompare.value = false
  nextTick(() => {
    const row = shadowRows.get(i)
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

/** 把这篇所有录音连起来听一遍 */
/*
 * 这里原来有 playAllRecordings：把整篇录音拼成一条 blob 播一遍。
 * 现在「只听自己录的」= 播放源选「我的录音」+ 循环方式选「本篇循环」，
 * 速度、停顿、单句循环这些也都能用上，不需要单独一个连听按钮。
 */

/**
 * 告诉查词弹窗：在这个页面收藏单词时顺带划一道线。
 * 离开页面必须注销 —— 否则在别的页面收藏会调进一个已经卸载的组件。
 */
onMounted(() => setCollectMarkHook((w, opts) =>
  opts?.remove ? unmarkWordByText(w) : markWordByText(w, opts?.surface)
))
onBeforeUnmount(() => setCollectMarkHook(null))

onBeforeUnmount(() => {
  recHandle?.cancel()
  if (levelTimer) clearInterval(levelTimer)
})

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
    const sentences = await aiReorganizeTranscript(article.value.rawEnglish, undefined, () => cancelCleanup.value)
    const remarks = reanchorMarks(article.value.marks, sentences)
    await readerStore.saveArticle({ ...article.value, sentences, marks: remarks, needsCleanup: false })
    nextTick(migrateMarksToSentenceAnchor)
  } catch (e) {
    urlError.value = e instanceof AiError ? e.message : 'AI 整理失败，请稍后重试'
  } finally {
    cleaning.value = false
  }
}

const notesDraft = ref('')

/**
 * 当前这本书的章节列表。
 *
 * 这里原来只认旧模型（书 = 一个分组，靠 groupId 找同组文章）。
 * 而现在的书是 `isBook: true` + `chapterIds` —— 打开书里的章节时
 * groupId 那条路取不到东西，isBookMode 判成 false，笔记就落到章节
 * 自己的 notes 上，右侧笔记栏按另一套逻辑读，于是「右边没有同步记录」。
 *
 * 现在两种模型都认：先看新模型（自己是书 / 自己属于某本书），
 * 取不到再回退到按分组找。
 */
const bookArticles = computed(() => {
  const a = article.value
  if (!a) return []

  // 自己就是一本书
  if (a.isBook) {
    return (a.chapterIds || [])
      .map(id => readerStore.articles.find(x => x.id === id))
      .filter(Boolean) as Article[]
  }

  // 自己是某本书的章节
  if (a.partOfBook) {
    const book = readerStore.articles.find(x => x.id === a.partOfBook)
    if (book) {
      return (book.chapterIds || [])
        .map(id => readerStore.articles.find(x => x.id === id))
        .filter(Boolean) as Article[]
    }
  }

  // 旧模型：同一分组下的多篇文章算一本书
  const gid = a.groupId
  if (!gid) return []
  const list = readerStore.articlesOfGroup(gid)
  return list.length > 1 ? list : []
})

/** 笔记存在哪本书上：新模型存书的 id，旧模型存分组 id */
const bookNoteKey = computed(() => {
  const a = article.value
  if (!a) return ''
  if (a.isBook) return a.id
  if (a.partOfBook) return a.partOfBook
  return a.groupId || ''
})
const isBookMode = computed(() => bookArticles.value.length > 1)
const bookPage = computed(() => bookArticles.value.findIndex(a => a.id === article.value?.id))

const chapterCount = computed(() =>
  isBookMode.value ? bookArticles.value.length : (article.value?.chapters?.length || 1)
)
/**
 * 笔记分页的标题，跟 chapterCount 的口径必须一致。
 *
 * 书模式下每一页对应一章（bookArticles），
 * 单篇多章模式下对应 article.chapters —— 原来模板里写死读 article.chapters，
 * 书里那个是空的，于是分页器有按钮却没有选项。
 */
const notePageTitles = computed<string[]>(() => {
  if (isBookMode.value) return bookArticles.value.map((a, i) => a.title || `第 ${i + 1} 章`)
  const chs = article.value?.chapters || []
  if (chs.length > 1) return chs.map((c, i) => c.title || `第 ${i + 1} 节`)
  return [article.value?.title || '笔记']
})

const chapterPage = ref(0)
watch(bookPage, i => { if (isBookMode.value && i >= 0) chapterPage.value = i }, { immediate: true })

function readNotePage(i: number): string {
  const a = article.value
  if (!a) return ''
  if (isBookMode.value) return readerStore.getBookNote(bookNoteKey.value, i)
  if (chapterCount.value <= 1) return a.notes || ''
  return a.chapterNotes?.[i] ?? (i === 0 ? a.notes || '' : '')
}

function stashNotePage() {
  const a = article.value
  if (!a) return
  if (isBookMode.value) {
    readerStore.saveBookNote(bookNoteKey.value, chapterPage.value, notesDraft.value)
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

/**
 * 词汇区的起止位置。
 *
 * 原来用的是 /<div id="note-vocab-section">([\s\S]*?)<\/div>/ ——
 * 非贪婪匹配到**第一个** </div>。而展开过「详情」的词条里含
 * <div class="note-word-detail">…</div>，正则在那个内层 </div> 就截断了：
 * 解析时只看到截断处之前的词条，回写时又用新内容替换那一段，
 * 于是每存一个新词就把前面的词顶掉。
 *
 * 改成按 <div> 配平扫描，内层再嵌多少层都不会截错。
 */
const VOCAB_OPEN = '<div id="note-vocab-section">'

function findVocabSection(html: string): { start: number; inner: string; end: number } | null {
  const at = html.indexOf(VOCAB_OPEN)
  if (at < 0) return null
  let i = at + VOCAB_OPEN.length
  let depth = 1
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)
    if (nextClose < 0) return null
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      if (depth === 0) return { start: at, inner: html.slice(at + VOCAB_OPEN.length, nextClose), end: nextClose + 6 }
      i = nextClose + 6
    }
  }
  return null
}
const VOCAB_ENTRY_RE = /<p>[\s\S]*?<\/p>(?:<div class="note-word-detail"[^>]*>[\s\S]*?<\/div>)?/g

function getVocabEntries(html: string): { sentIdx: number; entryHtml: string }[] {
  const sec = findVocabSection(html)
  /**
   * 包裹层没了也要能捞回旧词条。
   *
   * 笔记是 contenteditable —— 用户一旦在里面敲过字，浏览器会重排 HTML，
   * `<div id="note-vocab-section">` 这个包裹层可能被拆掉或挪位。
   * 找不到区块就返回空的话，下一次存词等于"没有旧词"，
   * 整段被新词覆盖 —— 这就是"只剩最新一个词"。
   *
   * 兜底：直接从全文里把带 note-mark-link 的段落捞出来当词条。
   */
  if (!sec) return looseVocabEntries(html)
  const entries: { sentIdx: number; entryHtml: string }[] = []
  let em: RegExpExecArray | null
  VOCAB_ENTRY_RE.lastIndex = 0
  while ((em = VOCAB_ENTRY_RE.exec(sec.inner))) {
    const block = em[0]
    const sm = block.match(/data-sent-idx="(-?\d+)"/)
    entries.push({ sentIdx: sm ? parseInt(sm[1], 10) : -1, entryHtml: block })
  }
  return entries
}

/** 从全文里捞词条：包裹层丢失时的兜底 */
function looseVocabEntries(html: string): { sentIdx: number; entryHtml: string }[] {
  const out: { sentIdx: number; entryHtml: string }[] = []
  const re = /<p>(?:(?!<\/p>)[\s\S])*?class="note-mark-link"[\s\S]*?<\/p>(?:\s*<div class="note-word-detail"[^>]*>[\s\S]*?<\/div>)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const sm = m[0].match(/data-sent-idx="(-?\d+)"/)
    out.push({ sentIdx: sm ? Number(sm[1]) : -1, entryHtml: m[0] })
  }
  return out
}

function setVocabEntries(html: string, entries: { sentIdx: number; entryHtml: string }[]): string {
  const section = `${VOCAB_OPEN}${entries.map(e => e.entryHtml).join('')}</div>`
  const sec = findVocabSection(html)
  if (sec) return html.slice(0, sec.start) + section + html.slice(sec.end)

  /**
   * 包裹层丢了：先把散落在全文里的旧词条摘掉，再把完整的一段放回去。
   * 不摘的话它们会和新区块并存，笔记里出现两份同样的词。
   */
  const loose = looseVocabEntries(html)
  if (loose.length) {
    let cleaned = html
    for (const e of loose) cleaned = cleaned.replace(e.entryHtml, '')
    return cleaned.replace(/(<p>\s*<\/p>)+/g, '') + section
  }
  const header = entries.length ? '<p><strong>划线词汇</strong></p>' : ''
  return header + section + html
}

/**
 * 插入一条词条，按它在文章里出现的先后排。
 *
 * 之前只比句号，同一句里的几个词就按点击顺序堆着 ——
 * 笔记读起来跟原文对不上。现在同句内再比词在句中的位置。
 */
function insertVocabEntry(html: string, entryHtml: string, sentIdx: number, localStart = -1): string {
  const entries = getVocabEntries(html)
  const posOf = (e: { sentIdx: number; entryHtml: string }) => {
    const m = e.entryHtml.match(/data-local-start="(\d+)"/)
    return m ? Number(m[1]) : -1
  }
  const tagged = entryHtml.includes('data-local-start')
    || localStart < 0
    ? entryHtml
    : entryHtml.replace('<p>', `<p data-local-start="${localStart}">`)

  let insertAt = entries.length
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.sentIdx < 0 || sentIdx < 0) continue
    if (e.sentIdx > sentIdx) { insertAt = i; break }
    if (e.sentIdx === sentIdx && posOf(e) > localStart && localStart >= 0) { insertAt = i; break }
  }
  entries.splice(insertAt, 0, { sentIdx, entryHtml: tagged })
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
    /**
     * 词库里没有的，先建一条最简条目再说。
     *
     * 原来 addWord 只写在 `if (needGenerate.size)` 里面 ——
     * 也就是只有触发了 AI 生成才会进词库。没配 AI、或这个词不需要生成时，
     * 它就只进笔记不进词库，于是"同步的单词表不全"。
     * 划线收藏的本意就是把词收起来，进不进得了词库不该取决于 AI 有没有跑。
     */
    for (const item of resolved) {
      if (item.entry) continue
      const target = (item.genTarget || item.mark.text).trim()
      if (!target || !/^[a-zA-Z][a-zA-Z'-]*$/.test(target)) continue

      const dup = wordStore.words.find(w => w.word.toLowerCase() === target.toLowerCase())
      if (dup) { item.entry = dup; continue }

      const now = new Date().toISOString()
      const basic: WordItem = {
        id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        word: target,
        phonetic: '',
        meanings: [{ chinese: '', partOfSpeech: '' }],
        level: 'IELTS',
        source: `阅读：${article.value.title}`,
        status: 'unmarked',
        createdAt: now,
        updatedAt: now
      }
      await wordStore.addWord(basic)
      item.entry = basic
    }

    /**
     * 统计到词表：走 autoCollectMarkAsVocab，不要自己写 vocabBookId。
     *
     * vocabBookId 是「手动指定词表」用的字段，代码不该去改它。
     * 自动归属那套（文件夹 → 文章 两级词表）已经封在 autoCollectMarkAsVocab 里，
     * 我在两个地方各写了一遍并行实现，结果不同入口进来的词归属不一致。
     */
    for (const item of resolved) {
      if (item.entry) await autoCollectMarkAsVocab(item.entry.word)
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
  { name: 'sand', hex: '#c9b287', label: '沙' },
  { name: 'sage', hex: '#9ab094', label: '青' },
  { name: 'mist', hex: '#94a8b8', label: '雾' },
  { name: 'rose', hex: '#c49e9e', label: '绯' },
  { name: 'lilac', hex: '#aaa0ba', label: '紫' },
  { name: 'clay', hex: '#c49480', label: '陶' }
]

interface PendingSel { text: string; start: number; end: number; isSingleWord: boolean }
const markMenu = ref<{ x: number; y: number } | null>(null)
const editMarkMenu = ref<{ x: number; y: number; markId: string } | null>(null)
const pendingSelIsWord = ref(false)
const pendingSelDef = ref('')
const pendingSelBaseForm = ref('')
let pendingSelZhText: string | null = null // 从中文那侧点句子标记时，直接就知道对应的中文是什么，不用等AI猜
const pendingSel = ref<PendingSel | null>(null)

/**
 * 摆放标记菜单。
 *
 * 宽高原来是写死的（MENU_H = 140、按宽 200 算左移 100）。菜单实际比这矮或窄时，
 * 就会悬在离选中的词很远的地方 —— 这就是「弹框离单词太远」。
 * 这里先按估计值放一个初始位置，渲染出来之后再量真实尺寸重新贴紧（见 refineMarkMenu）。
 */
function placeMarkMenu(centerX: number, top: number, bottom: number): { x: number; y: number } {
  const GUESS_H = 120
  const GUESS_W = 200
  const MARGIN = 8
  const x = Math.min(Math.max(8, centerX - GUESS_W / 2), window.innerWidth - GUESS_W - 8)
  if (top - GUESS_H - MARGIN >= 0) return { x, y: top - GUESS_H - MARGIN }
  if (bottom + GUESS_H + MARGIN <= window.innerHeight) return { x, y: bottom + MARGIN }
  return { x, y: Math.max(8, Math.min(top, window.innerHeight - GUESS_H - 8)) }
}

/**
 * 渲染之后按真实尺寸贴紧选区。
 * 只能在 DOM 出来之后做 —— 之前所有位置都是拿估计值算的。
 */
async function refineMarkMenu(anchor: DOMRect, which: 'mark' | 'edit' = 'mark') {
  await nextTick()
  const el = document.querySelector('.mark-menu') as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  const MARGIN = 8

  const centerX = anchor.left + anchor.width / 2
  const x = Math.min(Math.max(8, centerX - r.width / 2), window.innerWidth - r.width - 8)

  let y: number
  if (anchor.top - r.height - MARGIN >= 0) y = anchor.top - r.height - MARGIN
  else if (anchor.bottom + r.height + MARGIN <= window.innerHeight) y = anchor.bottom + MARGIN
  else y = Math.max(8, window.innerHeight - r.height - 8)

  const pos = { x: Math.round(x), y: Math.round(y) }
  // edit 菜单带着 markId，只更新坐标，别把它冲掉
  if (which === 'edit') {
    if (editMarkMenu.value) editMarkMenu.value = { ...editMarkMenu.value, ...pos }
  }
  else if (markMenu.value) markMenu.value = pos
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
  // 渲染后按真实尺寸再贴一次，别停在估算位置上
  refineMarkMenu(rect, 'mark')
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
    /**
     * 编辑菜单也贴着被点的那段标记，不再拿鼠标坐标硬摆。
     * 点在行尾时 clientX + 固定偏移会把菜单甩到很远的位置。
     */
    const hitRect = (event.target as HTMLElement)?.getBoundingClientRect?.()
    editMarkMenu.value = hitRect
      ? { ...placeMarkMenu(hitRect.left + hitRect.width / 2, hitRect.top, hitRect.bottom), markId }
      : { x: Math.min(event.clientX, window.innerWidth - 190), y: event.clientY + 14, markId }
    if (hitRect) refineMarkMenu(hitRect, 'edit')
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

/**
 * 默认高亮色。
 *
 * 划线时点哪个色块用哪个；不点、或从「收藏单词」这类入口进来的，用这里定的默认色。
 * 之前默认色是写死的 'mist'，想换得改代码。
 */
const defaultHl = ref(localStorage.getItem('lb-default-hl') || 'sand')
watch(defaultHl, v => localStorage.setItem('lb-default-hl', v))

/**
 * 在译文里找这个词对应的中文。
 *
 * 有它，中文那侧才只染对应的那几个字。释义常写成「突然；忽然」这种，
 * 逐个去译文里找，命中哪个用哪个；都找不到就不染（不硬凑）。
 * 手动划线和「收藏」两条路共用这一个。
 */
function findZhForWord(word: string, zhSent: string): string {
  if (!word || !zhSent) return ''
  const entry = wordStore.words.find(x => x.word.toLowerCase() === word.toLowerCase())
  for (const m of entry?.meanings || []) {
    for (const piece of (m.chinese || '').split(/[；;，,、/]/)) {
      const t = piece.trim()
      if (t.length >= 2 && zhSent.includes(t)) return t
    }
  }
  return ''
}

/**
 * 笔记里那一条词条长什么样。
 *
 * 划线和「收进生词本」必须产出**同一种**条目 —— 收藏本来就是划线的快捷方式，
 * 只是只能整词、不能划短语。之前收藏那条只放了个光秃秃的词链接，
 * 没有释义也没有「详情」按钮，两边看着像两个功能。
 */
function vocabNoteLine(displayText: string, sentIdx: number, def = '', withExpand = true): string {
  const link = `<a href="#" class="note-mark-link" data-sent-idx="${sentIdx}">${escapeHtml(displayText)}</a>`
  const expand = withExpand ? ` <button class="note-expand-btn" data-word="${escapeHtml(displayText)}">详情 ▸</button>` : ''
  return def ? `<p>• ${link}：${escapeHtml(def)}${expand}</p>` : `<p>• ${link}${expand}</p>`
}

/**
 * 按词划线（不依赖当前选区）。
 *
 * 「收进生词本」是从查词弹窗点的，那时没有选区，走不了 confirmMark。
 * 这里自己到正文里找这个词第一次出现的位置，建一条标记 ——
 * 收藏完页面上能看见，笔记里也留一条，不再是点了没反应。
 */
/**
 * 取消划线：把标记和笔记里那一条一起去掉。
 *
 * 收藏之前是单向的，点了就没法反悔 —— 划错一个词只能自己去笔记里删。
 */
async function unmarkWordByText(word: string) {
  const a = article.value
  if (!a || !word) return
  const w = word.trim().toLowerCase()

  const hit = (a.marks || []).find(m => m.text.toLowerCase() === w)
  if (!hit) return

  await readerStore.saveArticle({ ...a, marks: (a.marks || []).filter(m => m.id !== hit.id) })

  // 笔记里对应那条也删掉，不然笔记和正文对不上
  const entries = getVocabEntries(notesDraft.value)
    .filter(e => !new RegExp(`>${hit.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a>`, 'i').test(e.entryHtml))
  notesDraft.value = setVocabEntries(notesDraft.value, entries)
  syncNotesEditorFromDraft()
  stashNotePage()
  await readerStore.saveArticle({
    ...article.value!,
    notes: chapterCount.value > 1 ? article.value!.notes : notesDraft.value,
    chapterNotes: chapterCount.value > 1 ? article.value!.chapterNotes : undefined
  })
}

/**
 * 按词划线。
 *
 * @param word 词典给的原形，比如 arrive
 * @param surface 你实际点的那个词形，比如 arrives。没有就只用原形找
 */
async function markWordByText(word: string, surface = '') {
  const a = article.value
  if (!a || !word) return
  const w = word.trim()
  if (!w) return

  // 已经划过就不重复划
  if ((a.marks || []).some(m => m.text.toLowerCase() === w.toLowerCase())) return

  /**
   * 原形和实际词形都要试。
   *
   * 收藏是从查词弹窗点的，那里给的是**原形**（arrive），
   * 而文章里写的是变形（arrives / arrived）—— 只按原形找就匹配不到，
   * 直接 return，表现就是"有的单词收藏不进去"。
   * 再退一步用前缀匹配兜住 -s/-ed/-ing 这类常见变化。
   */
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tries = [surface.trim(), w].filter(Boolean).map(t => new RegExp(`\\b${esc(t)}\\b`, 'i'))
  if (w.length >= 4) tries.push(new RegExp(`\\b${esc(w)}(?:s|es|ed|d|ing)\\b`, 'i'))

  let sentIdx = -1
  let localStart = -1
  outer:
  for (const re of tries) {
    for (let i = 0; i < a.sentences.length; i++) {
      const hit = re.exec(a.sentences[i].en || '')
      if (hit) { sentIdx = i; localStart = hit.index; break outer }
    }
  }
  if (sentIdx < 0) return          // 这篇里真的没有这个词，不硬造标记

  const shown = a.sentences[sentIdx].en.slice(localStart, localStart + w.length)

  /**
   * 找出这个词对应的中文，存进 zhText。
   *
   * 有它，中文那侧才只染对应的那几个字；没有的话要么整句糊上高亮（旧行为，很难看），
   * 要么干脆不染（我上一版，等于丢了功能）。
   * 释义可能是「突然；忽然」这种带分隔符的，逐个去译文里找，命中哪个用哪个。
   */
  const zhHit = findZhForWord(w, a.sentences[sentIdx].zh || '')

  const mark = {
    id: `mk-${Date.now().toString(36)}`,
    text: shown,
    sentIdx,
    localStart,
    localEnd: localStart + w.length,
    start: 0,
    end: 0,
    color: defaultHl.value,
    note: '',
    zhText: zhHit || undefined,
    createdAt: new Date().toISOString()
  }
  await readerStore.saveArticle({ ...a, marks: [...(a.marks || []), mark] })

  // 释义从词库里取，跟手动划线拿到的是同一份
  const entry = wordStore.words.find(x => x.word.toLowerCase() === w.toLowerCase())
  const def = entry?.meanings?.find(m => m.chinese)?.chinese || ''

  /**
   * 统计到这篇文章的词表，走跟手动划线同一个函数。
   *
   * 项目里本来就有 autoCollectMarkAsVocab：它会自动建「文件夹 → 文章」两级词表，
   * 词进库、进文章表、进父级表一次做完。
   * 我上一版没找到它，自己写了套并行的 fileIntoVocabBook，
   * 结果两条入口进来的词归属不一致 —— 已经删掉，统一走这个。
   */
  await autoCollectMarkAsVocab(shown)
  notesDraft.value = insertVocabEntry(
    notesDraft.value,
    vocabNoteLine(entry?.word || shown, sentIdx, def, true),
    sentIdx
  )
  syncNotesEditorFromDraft()
  stashNotePage()
  await readerStore.saveArticle({
    ...article.value!,
    notes: chapterCount.value > 1 ? article.value!.notes : notesDraft.value,
    chapterNotes: chapterCount.value > 1 ? article.value!.chapterNotes : undefined
  })
}

async function confirmMark(color = defaultHl.value, skipNotesLine = false) {
  if (!pendingSel.value || !article.value) return
  const { text, start, end } = pendingSel.value
  /**
   * 从中文那侧划的能直接知道对应中文；从英文那侧划的没有，
   * 之前就一直没有 zhText —— 于是中文栏怎么都不跟着高亮。
   * 这里补一次查找。
   */
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
        {
          id: markId, text, start, end, sentIdx: anchorIdx, localStart, localEnd, color, note: '',
          zhText: knownZhText
            || (anchorIdx >= 0 ? findZhForWord(text, article.value.sentences[anchorIdx]?.zh || '') : '')
            || undefined,
          createdAt: new Date().toISOString()
        }
      ]
  await readerStore.saveArticle({ ...article.value, marks })

  if (!existed && !skipNotesLine) {
    notesDraft.value = insertVocabEntry(
      notesDraft.value,
      vocabNoteLine(baseForm || text, anchorIdx, wasWord ? wordDef : '', isVocabbable(text)),
      anchorIdx
    )
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
  await confirmMark(defaultHl.value, true)
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

/** 记书签：读到哪一章就存哪一章，下次打开自动回到这里 */
let bookmarkTimer: ReturnType<typeof setTimeout> | null = null
function rememberChapter(sentenceIndex: number) {
  const a = article.value
  if (!a || (a.chapters?.length || 0) < 2) return
  if (a.lastChapter === sentenceIndex) return
  if (bookmarkTimer) clearTimeout(bookmarkTimer)
  // 翻章可能很快，攒一下再落盘
  bookmarkTimer = setTimeout(() => {
    bookmarkTimer = null
    if (article.value?.id === a.id) {
      readerStore.saveArticle({ ...article.value, lastChapter: sentenceIndex })
    }
  }, 800)
}

function jumpToChapter(sentenceIndex: number) {
  activeChapter.value = sentenceIndex
  rememberChapter(sentenceIndex)
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
  // 离开阅读助手时把笔记存一次。光靠输入框的 @blur 不保险：
  // 直接点侧栏跳走时，失焦和卸载谁先发生并不确定
  saveNotes()
  window.removeEventListener('keydown', onKeydown)
  clearArticleQuickActions()
  readingArticleTitle.value = null
  sidePanelOpen.value = false
})

const mfaAligning = ref(false)

async function runMfaAutoAlign() {
  if (!article.value) return
  mfaAligning.value = true
  try {
    let file = await currentAudioFile()
    if (!file) {
      // 还没关联音频，就地让用户选一个，顺手存好
      const picked = await pickArticleAudioFile()
      if (!picked) { mfaAligning.value = false; return }
      const url = await uploadArticleAudio(picked, picked.name)
      await readerStore.saveArticle({
        ...article.value,
        audioFileName: picked.name,
        audioUrl: url || undefined
      })
      if (!url) await saveArticleAudioBlob(article.value.id, picked, picked.name)
      file = picked
    }
    if (!file) throw new Error('没能读取到关联的音频文件')
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
    key: 'hardwords',
    label: '挑出这篇的难词',
    disabled: !aiReady.value,
    title: aiReady.value ? '先过一遍最可能拦住你的词' : '请先在设置里配置 API Key',
    run: askHardWords
  })
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

/**
 * 把当前文章报给 AI 助手。
 *
 * 之前这个页面一处 setPageContext 都没有（只有词汇宇宙调了），
 * 所以问它"这篇讲了什么"它完全不知道你在读哪一篇。
 * 只报标题、进度和开头几句 —— 整篇塞进去每轮对话都要重发，太贵。
 */
watch(
  () => [article.value?.id, article.value?.title, viewSubMode.value] as const,
  () => {
    const a = article.value
    if (!a) { agentChat.setPageContext(''); return }

    const head = a.sentences.slice(0, 6).map(x => x.en).filter(Boolean).join(' ').slice(0, 400)
    const aligned = a.sentences.filter(x => x.audioStart != null).length
    const parts = [
      `用户正在阅读助手里看《${a.title}》，共 ${a.sentences.length} 句`,
      aligned ? `其中 ${aligned} 句已对好音频轴` : '还没有对音频轴',
      viewSubMode.value === 'shadow' ? '当前在跟读界面' : '',
      head ? `开头是：${head}` : ''
    ].filter(Boolean)

    agentChat.setPageContext(parts.join('；'))
  },
  { immediate: true }
)

/**
 * 练之前：先要一份这篇里的难词。
 *
 * 参考成熟工具的做法（Victor AI 的 pre-lesson explanation、
 * Shadowfy 的 tap any word）—— 先把拦路的词过一遍，再开口顺得多。
 */
function askHardWords() {
  const a = article.value
  if (!a?.sentences.length) return
  const text = a.sentences.map(x => x.en).filter(Boolean).slice(0, 80).join(' ')
  setAgentSelectionContext(text)
  openAgentPanelWithPrefill(
    '这是我准备跟读的材料。请挑出其中最可能拦住我的 10 个词或短语，' +
    '每个给：读音要点（哪里容易读错）、在这句话里的意思、一个短例句。' +
    '已经很常见的词不用列。'
  )
}

/*
 * 这里原来有个 askShadowReview：把每句的「识别文本 + 得分」交给 AI 复盘。
 * 分数没了之后它就无米可炊 —— AI 听不到录音，光知道句号和时长给不出有用的点评，
 * 硬留着只会让人点了失望。整块删掉，对应的 Agent 按钮也撤了。
 */

/**
 * 只在**换文章**时重置界面状态，不是每次保存都重置。
 *
 * article 是 computed，而 saveArticle 现在整体替换数组元素（为了清掉旧字段），
 * 引用一变这个 watch 就触发 —— 于是导入音频、跑完对齐这些「保存一下」的操作
 * 都会把 viewSubMode 打回 'read'，界面自己跳回阅读模式。
 * 改成比 id：id 没变就只更新笔记草稿，其余状态一律不动。
 */
watch(() => article.value?.id, () => {
  const a = article.value
  /**
   * 笔记页要跟着当前打开的章节走。
   * 原来固定回到第 0 页 —— 打开第 3 章却显示第 1 章的笔记，
   * 看起来就像「笔记没同步」。
   */
  /**
   * 打开文章时把笔记读出来。
   *
   * 原来这里自己拼了一套读法：`a.chapters.length > 1 ? a.chapterNotes[0] : a.notes`。
   * 它**漏掉了书模式** —— 书里的笔记存在 getBookNote（书那条记录的 chapterNotes，
   * 旧模型存在分组的 bookNotes 上），根本不在当前这篇章节的 a.notes 里。
   * 于是打开书里任何一章，笔记面板都是空的，而正文里的划线还在，
   * 看起来就像「笔记丢了」。
   *
   * 现在直接用 readNotePage —— 它三种情况（书 / 单篇多章 / 单篇）都处理了，
   * 读和写走同一套口径。
   *
   * 旧注释说这里不能调 readNotePage 会撞暂时性死区，那是这个 watch 还在文件前部
   * 时的情况；它现在在文件末尾，readNotePage 和它依赖的 isBookMode / bookNoteKey
   * 都早就初始化好了。
   */
  chapterPage.value = isBookMode.value && bookPage.value >= 0 ? bookPage.value : 0
  notesDraft.value = ensureNotesHtml(readNotePage(chapterPage.value))
  syncNotesEditorFromDraft()
  readingArticleTitle.value = a?.title || null
  syncReciteDrafts(a || null)
  reciteRecordingIdx.value = null
  showOriginal.value = false
  // 自动切章时别把跟读模式踢掉，否则连播一跳章就断
  if (!autoAdvancing) viewSubMode.value = 'read'
  editingTitle.value = false
}, { immediate: true })

watch(() => article.value?.sentences.length, () => {
  if (viewSubMode.value === 'recite' || reciteDrafts.value.length) syncReciteDrafts(article.value || null)
})

watch(sidePanelOpen, open => { if (open) syncNotesEditorFromDraft() })

/**
 * 书里的章节：笔记页定位到当前这一章。
 *
 * 放在文件末尾是因为它用到 isBookMode / bookPage / readNotePage，
 * 这些都声明在前面 —— 提前调用会撞上暂时性死区。
 */
watch(
  () => [article.value?.id, isBookMode.value, bookPage.value] as const,
  () => {
    /**
     * 从「学习笔记」页点进来时，直接翻到那一章的笔记。
     * 用 sessionStorage 传是因为路由跳转不带参数，读完就清掉。
     */
    const want = sessionStorage.getItem('lb-open-note-page')
    if (want !== null) {
      sessionStorage.removeItem('lb-open-note-page')
      const n = Number(want)
      if (n >= 0 && n < chapterCount.value) {
        chapterPage.value = n
        notesDraft.value = ensureNotesHtml(readNotePage(n))
        syncNotesEditorFromDraft()
        sidePanelOpen.value = true
        return
      }
    }

    if (!isBookMode.value || bookPage.value < 0) return
    if (chapterPage.value === bookPage.value) {
      /**
       * 页号已经对上了也要读一次。
       *
       * 上面那个 watch 刚把 chapterPage 设成 bookPage，这里再比一次必然相等，
       * 于是直接 return —— **打开第 1 章时 bookPage 是 0、chapterPage 初始也是 0**，
       * 一路短路下来谁都没去读 getBookNote，笔记就一直是空的。
       */
      notesDraft.value = ensureNotesHtml(readNotePage(chapterPage.value))
      syncNotesEditorFromDraft()
      return
    }
    // 切到别的章之前，先把当前这页的草稿存住，不然翻一下就没了
    stashNotePage()
    chapterPage.value = bookPage.value
    notesDraft.value = ensureNotesHtml(readNotePage(bookPage.value))
    syncNotesEditorFromDraft()
  }
)
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
/* 搜索独占一行、居中；筛选和操作按钮另起一行。
   原来挤在同一行，搜索框被压得很窄。 */
.search-row {
  display: flex; justify-content: center;
  padding: 4px 0 12px;
}
.search-row .list-search {
  width: min(520px, 100%); max-width: none; flex: none;
  text-align: center;
}
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
/* 左侧书签：这一行进入可拖状态 */
.drag-flag {
  position: absolute; left: 0; top: 50%;
  width: 4px; height: 26px; margin-top: -13px;
  border-radius: 0 3px 3px 0;
  background: #c0392b;
  pointer-events: none;
  animation: flagIn .18s ease;
}
@keyframes flagIn {
  from { transform: scaleY(.2); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
}

/* 拖拽落点提示：上下边缘是排序，整行高亮是"放进这本书" */
.drop-line { position: absolute; left: 0; right: 0; pointer-events: none; }
.drop-line.before { top: -1px; height: 2px; background: var(--r-accent, #8a4b3a); }
.drop-line.after { bottom: -1px; height: 2px; background: var(--r-accent, #8a4b3a); }
.drop-line.into {
  inset: 0; border: 2px dashed var(--r-accent, #8a4b3a); border-radius: 8px;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 8%, transparent);
}

/* 列表末尾的新建书按钮 */
.new-book-box {
  width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 8px; padding: 14px;
  border: 1.5px dashed var(--r-border, #d8dce1);
  border-radius: 10px;
  background: none; cursor: pointer;
  font-size: 13px; font-family: inherit;
  color: var(--r-ink2, #9aa0a6);
  &:hover, &.hot {
    border-color: var(--r-accent, #8a4b3a);
    color: var(--r-accent, #8a4b3a);
    background: color-mix(in srgb, var(--r-accent, #8a4b3a) 6%, transparent);
  }
}
.nb-plus { font-size: 16px; }

.article-row {
  /* drop-line 是绝对定位的，基础样式必须有 relative，
     否则提示线会以整个页面为参照跑到角落去 */
  position: relative;
  display: flex; align-items: center; gap: 10px; padding: 11px 16px;
  /* 高度固定成原来两行的高度，内容垂直居中；按钮多了横向裁掉，不再撑高。 */
  flex-wrap: nowrap; overflow: hidden;
  height: 64px; box-sizing: border-box;
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
/* 书在列表里的样子：左边一条书脊，跟普通文章一眼能分开 */
.a-title.is-book {
  position: relative;
  padding-left: 14px;
  font-weight: 600;
  &::before {
    content: '';
    position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    width: 5px; height: 1.5em; border-radius: 2px;
    background: linear-gradient(180deg, #b08968, #8a5a3b);
    box-shadow: inset -1px 0 0 rgba(255,255,255,.35);
  }
}
.book-badge {
  margin-left: 8px; padding: 1px 7px; border-radius: 999px;
  background: var(--r-ui, #f0f2f5); color: var(--r-ink2, #8a9099);
  font-size: 11.5px; font-weight: 400;
}
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
/* 对轴进度条：跟整理那条区分开，用蓝色 */
.article-row.aligning { position: relative; }
.article-row.aligning::after {
  content: '';
  position: absolute; left: 0; bottom: 0; height: 2px;
  width: var(--clean-pct, 3%);
  background: #4a7fa8;
  transition: width .3s ease;
}
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
/* 按钮不许被压缩：没有 flex-shrink:0 时它们会被标题挤扁然后掉到第二行，
   这就是「合成书之后删除跑到下一行」的原因。 */
.align-msg { color: #4a7fa8; }
.a-del, .a-export, .a-cleanup, .a-rename, .a-meta {
  flex-shrink: 0;
  white-space: nowrap;
}
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

/* 章节列表宽度取自它的 3xl:w-80 = 20rem */
.book-side {
  position: fixed;
  left: calc(var(--lb-nav-w, 178px) + 14px);
  top: 56px;
  bottom: 14px;
  max-width: calc(100vw - var(--lb-nav-w, 178px) - 3rem);
  display: flex; flex-direction: column;
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e2e2e2);
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .07);
  overflow: hidden;
  z-index: 40;
}
.book-side.folded { width: auto !important; bottom: auto; }
.bs-resizer {
  position: absolute; right: -3px; top: 0; bottom: 0; width: 8px;
  cursor: col-resize; z-index: 3;
  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 25%, transparent); }
}
.bs-head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  padding: 0.7rem 0.8rem; border-bottom: 1px solid var(--r-border, #f0f0f0);
}
.bs-title {
  font-size: 0.95rem; font-weight: 600; color: var(--r-ink, #1f2328);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bs-fold {
  flex-shrink: 0; border: none; background: none; cursor: pointer;
  color: var(--r-ink2, #9aa0a6); font-size: 0.85rem; padding: 0 0.2rem;
  &:hover { color: var(--r-ink, #1f2328); }
}
/* 搜索框对应它的 .search，列表 gap 1rem 那一档 */
.bs-search { padding: 0.6rem 0.7rem 0; }
.bs-search input {
  width: 100%; box-sizing: border-box;
  padding: 0.45rem 0.6rem; font-size: 0.9rem;
  border: 1px solid var(--r-border, #e5e7eb); border-radius: 0.5rem;
  background: var(--r-paper, #fff); color: var(--r-ink, #1f2328); outline: none;
  &:focus { border-color: var(--r-accent, #8a4b3a); }
}
.bs-empty { color: var(--r-ink2, #9aa0a6); font-size: 0.85rem; padding: 0.6rem 0.8rem; }
.bs-list { flex: 1; overflow-y: auto; padding: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; }
/* 每条外面套一层，用来放上下两个 + */
.bs-slot { position: relative; }
.bs-join {
  position: absolute; left: 50%; transform: translateX(-50%);
  width: 1.5rem; height: 1.1rem; line-height: 1;
  border: 1px solid var(--r-border, #dfe3e8); border-radius: 999px;
  background: var(--r-paper, #fff); color: var(--r-ink2, #9aa0a6);
  font-size: 12px; cursor: pointer; z-index: 2;
  opacity: 0; transition: opacity .12s ease;
  &.up { top: -0.55rem; }
  &.down { bottom: -0.55rem; }
  &:hover { color: var(--r-accent, #8a4b3a); border-color: var(--r-accent, #8a4b3a); }
}
.bs-slot:hover .bs-join { opacity: 1; }

/* 正在播放的章节标记 */
.bs-speaker {
  display: inline-flex; flex-shrink: 0; margin-right: 4px;
  color: var(--r-accent, #8a4b3a);
  animation: spk 1.6s ease-in-out infinite;
}
@keyframes spk {
  0%, 100% { opacity: 1; }
  50% { opacity: .45; }
}

/* 章节拖动的落点提示线 */
.bs-item.drop-before { box-shadow: inset 0 2px 0 var(--r-accent, #8a4b3a); }
.bs-item.drop-after { box-shadow: inset 0 -2px 0 var(--r-accent, #8a4b3a); }

/* 目录末尾的「添加章节」 */
.bs-add {
  width: 100%; margin-top: 6px; padding: 9px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  border: 1.5px dashed var(--r-border, #d8dce1); border-radius: 8px;
  background: none; cursor: pointer;
  font-size: 12.5px; font-family: inherit; color: var(--r-ink2, #9aa0a6);
  &:hover {
    border-color: var(--r-accent, #8a4b3a); color: var(--r-accent, #8a4b3a);
    background: color-mix(in srgb, var(--r-accent, #8a4b3a) 6%, transparent);
  }
}

/* 选文章弹窗 */
.picker-mask {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0, 0, 0, .35);
  display: flex; align-items: center; justify-content: center;
}
.picker-box {
  width: 460px; max-width: calc(100vw - 40px); max-height: 70vh;
  display: flex; flex-direction: column;
  background: var(--r-paper, #fff); border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .25);
  overflow: hidden;
}
.picker-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid var(--r-border, #eee);
}
.picker-search {
  margin: 10px 14px; padding: 7px 10px;
  border: 1px solid var(--r-border, #e5e7eb); border-radius: 8px;
  font-size: 13px; font-family: inherit;
}
.picker-list { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
.pair-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px; font-size: 12.5px;
  &:hover { background: var(--r-ui, #f2f4f7); }
}
.pair-arrow { flex-shrink: 0; color: var(--r-ink2, #9aa0a6); }
.pair-score {
  flex-shrink: 0; font-size: 11.5px; color: #3a8a5c;
  &.weak { color: #b5843c; }
}
.picker-item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border: none; background: none; cursor: pointer;
  border-radius: 8px; font-size: 13px; font-family: inherit; text-align: left;
  color: var(--r-ink, #1f2328);
  &:hover { background: var(--r-ui, #f2f4f7); }
}
.pi-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-cnt { flex-shrink: 0; color: var(--r-ink2, #9aa0a6); font-size: 12px; }

/* 章节改名输入框，跟 bs-item 同宽同高，切换时不跳动 */
.bs-rename {
  flex: 1; min-width: 0;
  padding: 6px 8px; border-radius: 8px;
  border: 1px solid var(--r-accent, #8a4b3a);
  font-size: 0.95rem; font-family: inherit;
  background: var(--r-paper, #fff); color: var(--r-ink, #1f2328);
}
.bs-ops { display: none; gap: 6px; margin-left: 6px; flex-shrink: 0; }
.bs-item:hover .bs-ops { display: inline-flex; }
.bs-op {
  font-size: 11.5px; color: var(--r-ink2, #9aa0a6);
  &:hover { color: var(--r-accent, #8a4b3a); }
  &.danger:hover { color: #b5493c; }
  /* 已置顶 / 已收藏的常亮，不用悬停也看得见 */
  &.hot { color: var(--r-accent, #8a4b3a); }
}

.bs-item {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.55rem 0.7rem; border: none; border-radius: 0.5rem;
  background: none; cursor: pointer; text-align: left;
  font-size: 0.95rem; color: var(--r-ink2, #666);
  &:hover { background: var(--r-ui, #f5f5f5); color: var(--r-ink, #222); }
  &.on { background: var(--r-ui, #f0f2f5); color: var(--r-accent, #8a4b3a); font-weight: 600; }
}
.bs-no { flex-shrink: 0; width: 1.6rem; color: var(--r-ink2, #b8bec6); font-size: 0.85rem; }
.bs-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bs-cnt { flex-shrink: 0; color: var(--r-ink2, #b8bec6); font-size: 0.8rem; }

/* 推杆开关 */
.lang-toggle {
  display: inline-flex; align-items: center; gap: 7px;
  border: none; background: none; cursor: pointer;
  padding: 4px 6px; font-size: 13px; font-family: inherit;
}
.lt-side {
  color: var(--r-ink, #1f2328); transition: opacity .18s ease, color .18s ease;
  &.dim { opacity: .35; }
}
.lt-track {
  width: 40px; height: 18px; border-radius: 999px;
  background: var(--r-border, #d8dce1);
  position: relative;
}
.lt-knob {
  position: absolute; top: 2px; left: 13px;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--r-accent, #8a4b3a);
  box-shadow: 0 1px 2px rgba(0,0,0,.2);
  transition: left .18s ease;
}
/* 拨到一侧时旋钮跟着走 */
.lang-toggle.pos-left .lt-knob { left: 2px; }
.lang-toggle.pos-right .lt-knob { left: 24px; }

.book-nav {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 0 12px; border-bottom: 1px solid var(--r-border, #eee); margin-bottom: 12px;
}
.book-sel {
  flex: 1; min-width: 180px; max-width: 420px;
  padding: 6px 10px; border: 1px solid var(--r-border, #e5e7eb); border-radius: 8px;
  background: var(--r-paper, #fff); color: var(--r-ink, #1f2328); font-size: 13.5px;
}
.book-pos { color: var(--r-ink2, #9aa0a6); font-size: 12.5px; }
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
/* 行距放开：标记高亮带内边距后，1.6 的行距会让上下行的高亮块贴在一起 */
.sentence-row .en { margin-bottom: 6px; line-height: 1.9; }
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


/* 拖放区。原来只有一个写着「拖入 / 选择视频」的按钮，可 <label> 不接受拖放，
   拖上去没有任何反应。这里给整个面板挂 drop 事件，并画出明确的落点。 */
.drop-zone {
  border: 2px dashed var(--r-border, #d8dce1);
  border-radius: 12px;
  padding: 28px 20px;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  transition: border-color .15s ease, background-color .15s ease;
}
.drop-zone.active {
  border-color: var(--r-accent, #5b7a99);
  background: color-mix(in srgb, var(--r-accent, #5b7a99) 7%, transparent);
}
.drop-zone.busy { opacity: .75; }
.dz-main { font-size: 15px; color: var(--r-ink2, #8a9099); }
.dz-actions { display: flex; gap: 10px; }

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
/* .shadow-score / .shadow-heard 是给分数和识别文本用的，两样都没了，样式一起删 */

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

/* 跟读操作栏钉在窗口底部。
   文章长的时候滚到中间就够不着顶部的播放键了。
   同时给正文加一段下边距，栏不会压住最后几行字。 */
.shadow-bar {
  position: fixed;
  z-index: 60;
  display: flex; flex-direction: column; align-items: stretch; gap: 10px;
  /* 圆角从 999px（胶囊）改成 14px：里面现在是一列拉条，
     胶囊的大圆角会把两端的文字切掉。宽度也放到 420，数值不再挤出去。 */
  width: max-content; min-width: 460px;
  max-width: calc(100vw - var(--lb-nav-w, 178px) - 32px);
  padding: 8px 14px 10px; border-radius: 12px;
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e5e7eb);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .16);
}
/* 拖动手柄：整条顶部都能拖 */
.sb-drag {
  height: 14px; margin: -4px -6px 0; cursor: grab;
  display: flex; align-items: center; justify-content: center;
}
.sb-drag:active { cursor: grabbing; }
.sb-drag::before {
  content: ''; width: 38px; height: 4px; border-radius: 2px;
  background: var(--r-border, #dfe3e8);
}
/* 跟读模式下正文留出底栏的高度，最后几行才不会被盖住 */
.reading.shadow-on .content { padding-bottom: 96px; }
.sb-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; color: var(--r-ink2, #777);
  flex-shrink: 0; white-space: nowrap;   /* 宁可挤别处，也不能把「跟读」两个字竖起来 */
}
.sb-item input { flex-shrink: 0; margin: 0; }
/* 控制条：播放键居中，两侧宽度相等，中间才是真的居中 */
.sb-row { display: flex; align-items: center; gap: 10px; flex-wrap: nowrap; }
.sb-left, .sb-right { flex: 1; min-width: 0; font-size: 12.5px; color: var(--r-ink2, #9aa0a6); }
/* 左侧三个控件横着排开。原来外层是个 label 又套了两个 label（HTML 不允许嵌套 label，
   点循环下拉会连带触发外层），而且没写 gap / nowrap，被挤到宽度不够时
   「跟读」两个字就竖起来了。 */
.sb-left { display: flex; align-items: center; gap: 12px; }
/* 跟读/复述放在播放键右边 —— 那侧地方宽裕，不会被挤到换行 */
/* 跟读/复述挪到播放键右边之后，这一侧要横向排开；
   text-align 是原来那条的，合并进来，别留两条 .sb-right */
.sb-right { display: flex; align-items: center; justify-content: flex-end; gap: 12px; text-align: right; }
.sb-idx { flex-shrink: 0; }
.sb-play { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.play-btn { min-width: 44px; font-size: 15px; }
.sb-slider { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.sl-pick {
  flex-shrink: 0; border: none; background: none; cursor: pointer;
  font-size: 12.5px; font-family: inherit; color: var(--r-ink2, #6b7280);
  padding: 2px 4px; border-radius: 6px;
  &:hover { background: var(--r-ui, #f2f4f7); }
}
.sl-range { flex: 1; min-width: 60px; accent-color: var(--r-accent, #8a4b3a); }
.sl-val { flex-shrink: 0; min-width: 3rem; text-align: right; color: var(--r-ink2, #9aa0a6); font-size: 12px; }

.sb-sel {
  padding: 4px 8px; border-radius: 7px; font-size: 12.5px;
  border: 1px solid var(--r-border, #ddd); background: var(--r-paper, #fff); color: inherit;
}
/* 录音按钮：外圈半径跟着说话音量走 */
.mic-btn {
  position: relative;
  width: 30px; height: 30px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%; cursor: pointer;
  background: var(--r-ui, #f2f4f7); color: var(--r-ink2, #6b7280);
  &:hover { color: var(--r-accent, #8a4b3a); }
  &.on { background: #c0392b; color: #fff; }
}
/* 声波竖条：每根一个频段，高度直接由实时数据给，不用 keyframes ——
   匀速动画看着是装饰，跟着声音走才是反馈 */
/**
 * 声波竖条。
 *
 * 用 transform: scaleY 而不是改 height —— 改 height 每帧都触发布局重排，
 * 同一行的按钮和文字会跟着微微抖动，手感发黏。transform 只走合成层，
 * 不影响周围任何元素。整块宽度也固定住，条数变化不会撑动布局。
 */
.wave {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 3px; width: 44px; height: 22px; flex-shrink: 0;
}
.wave i {
  display: block; width: 3px; height: 100%;
  border-radius: 2px;
  background: #c0392b;
  transform-origin: center;
  transform: scaleY(.2);
  /* 平滑已经在数据层做了，这里只兜住采样间隔 */
  transition: transform .09s ease-out;
  will-change: transform;
}

/* 实时识别的文字：跟最终结果区分开，用虚线下划线表示"还在听" */
.live-text {
  font-size: 12.5px; color: var(--r-accent, #8a4b3a);
  border-bottom: 1px dashed currentColor; padding-bottom: 1px;
}

.rec-len { font-size: 12px; color: var(--r-ink2, #9aa0a6); }


/* 录音中的秒数。加录音时用了这个类却忘了写样式，全项扫描才发现 */
.rec-hint { font-size: 12px; color: #c0392b; flex-shrink: 0; }

/**
 * .icon-btn 的顶层样式。
 *
 * 本文件用了它 8 处（跟读那排的播放/连放/删除、对比面板里的按钮），
 * 但整个文件里只有 `.shadow-en .icon-btn` 那一份**嵌套**定义，
 * 以及下面这条 danger:hover —— 也就是说 .shadow-controls 和别处的
 * icon-btn 一直在吃浏览器默认的 button 样式（灰底 + 边框）。
 * WordCard.vue 里那份是 scoped 的，管不到这里。
 */
.icon-btn {
  border: none; background: none; padding: 2px; cursor: pointer;
  color: var(--r-ink2, #8a9099); line-height: 0;
  &:hover { color: var(--r-ink, #1f2328); }
}
.icon-btn.danger:hover { color: #b5493c; }

.recite-wrap { margin-top: 6px; }
.recite-toggle {
  display: flex; align-items: center; gap: 6px; max-width: 100%;
  border: none; background: none; cursor: pointer; padding: 0;
  font-size: 12px; font-family: inherit; color: var(--r-ink2, #9aa0a6);
  &:hover { color: var(--r-accent, #8a4b3a); }
}
/* 收起时把内容露一行出来，不用展开也知道自己说了什么 */
.recite-peek {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px;
}

.recite-inline {
  /* 一行起、跟着内容长。边框平时不画 —— 它多数时候只是承接识别结果，
     画个空框在那儿占视觉重量，聚焦时再显形就够了 */
  display: block; width: 100%; margin-top: 4px;
  padding: 4px 8px; border-radius: 6px;
  border: 1px solid transparent;
  font-size: 12.5px; font-family: inherit; line-height: 1.55;
  background: var(--r-ui, #f6f7f9); color: var(--r-ink, #1f2328);
  resize: none; overflow: hidden;
  transition: border-color .15s ease, background-color .15s ease;
  &:hover { border-color: var(--r-border, #e5e7eb); }
  &:focus {
    outline: none;
    border-color: var(--r-accent, #8a4b3a);
    background: var(--r-paper, #fff);
  }
}

.shadow-zh {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--r-ink2, #6b7280);
}

.shadow-item.playing {
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--r-accent, #8a4b3a);
  border-radius: 8px;
  /* 内边距要够，否则背景块紧贴文字，跟标记高亮的下边框叠在一起就"压住"了字。
     左边 3px 是 inset 阴影的宽度，再加 9px 才不会顶着首字母。 */
  padding: 8px 12px 8px 12px;
  margin: 0 -12px;
}
.shadow-item { padding: 6px 12px; margin: 0 -12px; line-height: 1.95; }


.append-mask {
  position: fixed; inset: 0; z-index: 3000;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
}
.append-box {
  width: min(460px, 88vw); max-height: 70vh;
  background: var(--r-paper, #fff); border-radius: 12px;
  padding: 18px; display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .25);
}
.append-title { font-size: 15px; font-weight: 600; color: var(--r-ink, #1f2328); }
.append-list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.append-item {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  padding: 9px 10px; border: none; background: none; border-radius: 8px;
  cursor: pointer; text-align: left; font-size: 14px;
  &:hover { background: var(--r-ui, #f4f5f7); }
}
.ai-title { color: var(--r-ink, #1f2328); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-meta { flex-shrink: 0; color: var(--r-ink2, #9aa0a6); font-size: 12px; }
.append-empty { color: var(--r-ink2, #9aa0a6); font-size: 13px; margin: 8px 0; }
.merge-actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.grp-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px;
  &:hover { background: var(--r-ui, #f4f5f7); }
}
.grp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.grp-cnt { flex-shrink: 0; color: var(--r-ink2, #9aa0a6); font-size: 12px; }
.toc-row { display: flex; align-items: center; gap: 6px; }
.toc-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toc-mark { flex-shrink: 0; font-size: 12px; }
.toc-add {
  width: 100%; margin-top: 6px; padding: 7px 10px;
  border: 1px dashed var(--r-border, #d8dce1); border-radius: 8px;
  background: none; color: var(--r-ink2, #9aa0a6); font-size: 13px; cursor: pointer;
  &:hover { color: var(--r-ink, #1f2328); border-color: var(--r-ink2, #9aa0a6); }
}
</style>

<style>
/* 当前默认色加个圈，一眼看出收藏单词会用哪个 */
.color-dot.cur { box-shadow: 0 0 0 2px var(--r-paper, #fff), 0 0 0 3.5px var(--r-accent, #8a4b3a); }

/**
 * 自定义高亮色。
 *
 * 设置里选的颜色写进 --lb-custom-hl，这里用它上色。
 * 六个预设走各自的 .hl-xxx 类，自定义走这一条，两套互不干扰。
 */
.hl-custom {
  background: var(--lb-custom-hl, #c9b287);
  border-bottom: 2px solid color-mix(in srgb, var(--lb-custom-hl, #c9b287) 70%, #000);
}

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
  /* 宽度对齐 TypeWords 的 --panel-width: 24rem，原来 210px 太窄，
     章节名一律被截断成省略号。 */
  width: 24rem;
  max-width: calc(100vw - var(--lb-nav-w, 178px) - 3rem);
  max-height: calc(100vh - 76px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--r-paper, #fff);
  border: 1px solid var(--r-border, #e2e2e2);
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.07);
  overflow: hidden;
  padding: 0 0.5rem 0.5rem;
}
.chapter-toc.folded { width: auto; }

.toc-fold {
  border: none;
  background: transparent;
  color: var(--r-ink2, #888);
  font-size: 0.9rem;
  padding: 0.7rem 0.75rem;
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
  &:hover { color: var(--r-ink, #333); }
}
/* 目录尺度对齐 TypeWords：面板 --panel-width 24rem，
   列表 .list { gap: 1rem }，正文级字号（它的 .translate 是 1rem）。
   原来是 12.5px 字号 + 5px 内边距，挤成一小团。 */
.toc-scroll {
  overflow-y: auto;
  border-top: 1px solid var(--r-border, #f0f0f0);
  padding: 0.6rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.toc-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--r-ink2, #666);
  font-size: 0.95rem;
  line-height: 1.6;
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  text-align: left;
  &:hover { background: var(--r-ui, #f5f5f5); color: var(--r-ink, #222); }
  &.on { background: var(--r-ui, #f0f2f5); color: var(--r-accent, #8a4b3a); font-weight: 600; }
}

@media (max-width: 1280px) {
  .chapter-toc { top: 84px; right: 8px; width: 168px; }
}
@media (max-width: 860px) {
  .chapter-toc { display: none; }
}
.a-cleanup.stop { color: #b05a4a; font-weight: 600; }
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





/* ---------- 录音对比面板 ---------- */
.rc-mask {
  position: fixed; inset: 0; z-index: 70;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .3);
  padding: 24px;
}
.rc-card {
  background: var(--r-paper, #fff); border-radius: 14px;
  width: min(720px, 100%); max-height: 80vh;
  display: flex; flex-direction: column;
  padding: 18px 20px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, .2);
}
.rc-head { display: flex; align-items: center; justify-content: space-between; }
.rc-head h3 { margin: 0; font-size: 16px; }
.rc-sum { font-size: 13px; color: var(--r-ink2, #777); margin: 6px 0 12px; }
.rc-list { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
.rc-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 0; border-bottom: 1px solid var(--r-border, #f0f0f0);
  font-size: 13px;
}
.rc-hd { color: var(--r-ink2, #999); font-size: 12px; border-bottom-width: 1px; }
.rc-no {
  width: 30px; flex-shrink: 0; text-align: center;
  color: var(--r-ink2, #999); font-size: 12.5px;
  border: none; background: none; padding: 0;
}
.rc-link { cursor: pointer; &:hover { color: var(--r-accent, #8a4b3a); } }
.rc-text {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--r-ink, #1f2328);
}
.rc-len { width: 52px; flex-shrink: 0; text-align: right; color: var(--r-ink2, #777); }
.rc-verdict { width: 62px; flex-shrink: 0; text-align: right; color: var(--r-ink2, #999); }
.rc-verdict.off { color: var(--r-accent, #8a4b3a); }
.rc-pad { width: 28px; flex-shrink: 0; }
</style>
