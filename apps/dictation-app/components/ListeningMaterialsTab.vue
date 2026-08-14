<template>
  <div class="listening-materials">
    <div v-if="!supported" class="unsupported">
      当前浏览器不支持文件夹访问（需要 Chrome / Edge），无法使用本地听力材料扫描功能。
    </div>

    <template v-else>
      <div class="lm-toolbar">
        <button class="dark-btn" :disabled="scanning" @click="pickFolder">
          {{ scanning ? '扫描中…' : folderName ? `重新选择文件夹（当前：${folderName}）` : '选择听力材料文件夹' }}
        </button>
        <input v-model="search" class="search-input" placeholder="搜索文件名" />
      </div>
      <p class="lm-hint">文件夹内 mp3/wav/m4a 音频若有同名 .txt 文本，会自动作为原文展示；建议单词间用下划线或空格分隔命名。</p>

      <div v-if="!filtered.length && folderName" class="empty-hint">未找到音频文件</div>

      <div class="lm-list">
        <div
          v-for="m in filtered"
          :key="m.name"
          class="lm-item"
          :class="{ on: current?.name === m.name }"
          @click="select(m)"
        >
          <span class="lm-name">{{ m.name }}</span>
          <span v-if="m.hasText" class="lm-tag">有文本</span>
        </div>
      </div>

      <div v-if="current" class="lm-player">
        <audio ref="audioEl" :src="currentUrl" controls style="width: 100%"></audio>
        <div v-if="transcript" class="lm-transcript">
          <div class="lm-transcript-head">
            <h4>原文</h4>
            <button class="ghost-btn" :disabled="extracting" @click="extractVocab">
              {{ extracting ? '提取中…' : '提取生词并建词书' }}
            </button>
          </div>
          <p class="transcript-text">{{ transcript }}</p>
        </div>
        <p v-else class="no-transcript">该音频没有同名 .txt 文本文件</p>
      </div>
      <p v-if="extractMsg" class="extract-msg">{{ extractMsg }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useWordStore } from '@/shared/stores/wordStore'

interface Material {
  name: string
  fileHandle: FileSystemFileHandle
  hasText: boolean
  textHandle?: FileSystemFileHandle
}

const wordStore = useWordStore()
const supported = 'showDirectoryPicker' in window
const folderName = ref('')
const scanning = ref(false)
const materials = ref<Material[]>([])
const search = ref('')
const current = ref<Material | null>(null)
const currentUrl = ref('')
const transcript = ref('')
const extracting = ref(false)
const extractMsg = ref('')

const filtered = computed(() =>
  materials.value.filter(m => m.name.toLowerCase().includes(search.value.toLowerCase()))
)

const AUDIO_EXT = /\.(mp3|wav|m4a|ogg)$/i

async function pickFolder() {
  scanning.value = true
  extractMsg.value = ''
  try {
    const dirHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker()
    folderName.value = dirHandle.name
    materials.value = []
    await scanDir(dirHandle, '')
  } catch {
  } finally {
    scanning.value = false
  }
}

async function scanDir(dir: FileSystemDirectoryHandle, prefix: string) {
  const txtHandles = new Map<string, FileSystemFileHandle>()
  const audioHandles: { name: string; handle: FileSystemFileHandle }[] = []

  for await (const [name, handle] of (dir as any).entries()) {
    if (handle.kind === 'file') {
      if (AUDIO_EXT.test(name)) {
        audioHandles.push({ name: prefix + name, handle })
      } else if (name.toLowerCase().endsWith('.txt')) {
        txtHandles.set(name.replace(/\.txt$/i, '').toLowerCase(), handle)
      }
    } else if (handle.kind === 'directory') {
      await scanDir(handle, prefix + name + '/')
    }
  }

  for (const { name, handle } of audioHandles) {
    const base = name.split('/').pop()!.replace(AUDIO_EXT, '').toLowerCase()
    const textHandle = txtHandles.get(base)
    materials.value.push({ name, fileHandle: handle, hasText: !!textHandle, textHandle })
  }
}

async function select(m: Material) {
  current.value = m
  transcript.value = ''
  extractMsg.value = ''
  const file = await m.fileHandle.getFile()
  currentUrl.value = URL.createObjectURL(file)
  if (m.textHandle) {
    const txtFile = await m.textHandle.getFile()
    transcript.value = await txtFile.text()
  }
}

const STOPWORDS = new Set(
  'a an the is are was were be been being to of in on at for with and or but if not no do does did have has had this that these those i you he she it we they my your his her its our their'.split(
    ' '
  )
)

async function extractVocab() {
  if (!transcript.value || !current.value) return
  extracting.value = true
  extractMsg.value = ''
  try {
    const words = [...new Set((transcript.value.toLowerCase().match(/[a-z']{3,}/g) || []))].filter(
      w => !STOPWORDS.has(w)
    )
    const known = new Set(wordStore.words.map(w => w.word.toLowerCase()))
    const fresh = words.filter(w => !known.has(w)).slice(0, 200)

    if (!fresh.length) {
      extractMsg.value = '未发现新生词（可能已全部在词库中）'
      return
    }

    const now = new Date().toISOString()
    const groupName = current.value.name.replace(AUDIO_EXT, '')
    const group = {
      id: `book-${Date.now()}`,
      name: groupName,
      description: `听力材料生词：${current.value.name}`,
      wordIds: [] as string[],
      createdAt: now,
      updatedAt: now
    }
    const items = fresh.map(w => ({
      id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      word: w,
      phonetic: '',
      meanings: [{ chinese: '', partOfSpeech: '' }],
      level: 'IELTS' as const,
      source: `听力材料：${current.value!.name}`,
      status: 'unmarked' as const,
      createdAt: now,
      updatedAt: now
    }))
    for (const it of items) {
      group.wordIds.push(it.id)
      await wordStore.addWord(it)
    }
    await wordStore.createGroup(group)
    extractMsg.value = `已提取 ${items.length} 个生词，建成词书「${groupName}」，可在词汇中心导入补全释义`
  } finally {
    extracting.value = false
  }
}
</script>

<style lang="scss" scoped>
.listening-materials { padding-top: 4px; }
.unsupported { color: #b05a4a; background: #f9ece9; border-radius: 10px; padding: 16px; font-size: 14px; }

.lm-toolbar { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
.lm-hint { color: #999; font-size: 12.5px; margin-bottom: 16px; }
.dark-btn {
  box-shadow: 0 1px 2px color-mix(in srgb, var(--r-accent, #8a4b3a) 22%, transparent);
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease; border: none; background: var(--r-accent, #8a4b3a); color: #fff; border-radius: 8px; padding: 9px 18px; font-size: 13.5px; cursor: pointer; &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 82%, #000); } &:disabled { opacity: 0.5; } }
.ghost-btn {
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease; border: 1px solid color-mix(in srgb, var(--r-accent, #8a4b3a) 24%, transparent); background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff)); border-radius: 8px; padding: 7px 14px; font-size: 13px; cursor: pointer; &:hover:not(:disabled) { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); } &:disabled { opacity: 0.5; } }
.search-input { border: 1px solid var(--r-border, #ddd); border-radius: 8px; padding: 8px 12px; font-size: 13.5px; outline: none; &:focus { border-color: #999; } }

.empty-hint { color: #999; padding: 20px 0; text-align: center; }

.lm-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; margin-bottom: 18px; }
.lm-item {
  display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; border: 1px solid #eee; border-radius: 8px; cursor: pointer; font-size: 13.5px;
  &:hover { background: #fafafa; }
  &.on { border-color: transparent; background: #f5f5f5; }
}
.lm-name { color: #333; }
.lm-tag { font-size: 11px; color: #4a7d3a; background: #eef4e8; padding: 2px 8px; border-radius: 8px; }

.lm-player { border-top: 1px solid #eee; padding-top: 16px; }
.lm-transcript { margin-top: 14px; }
.lm-transcript-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; h4 { font-size: 14px; color: #1a1a1a; } }
.transcript-text { font-size: 14px; color: #444; line-height: 1.8; white-space: pre-wrap; background: #fafafa; border-radius: 8px; padding: 14px; max-height: 240px; overflow-y: auto; }
.no-transcript { color: #999; font-size: 13px; margin-top: 10px; }
.extract-msg { margin-top: 10px; color: #4a7d3a; font-size: 13px; }
</style>
