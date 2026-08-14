import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { wordDB } from '@/shared/core/database'
import * as be from '@/shared/core/backendClient'
import { trackSync } from '@/shared/core/syncStatus'
import type { Article, ArticleGroup } from '@/shared/types/Article'

export const useReaderStore = defineStore('reader', () => {
  const articles = ref<Article[]>([])
  const groups = ref<ArticleGroup[]>([])
  const currentId = ref<string | null>(null)
  const isLoading = ref(false)
  const backendReachable = ref(false)

  const current = computed(() => articles.value.find(a => a.id === currentId.value) || null)

  async function loadArticles() {
    isLoading.value = true
    try {
      const [beArticles, beGroups] = await Promise.all([be.beListArticles(), be.beListArticleGroups()])
      if (beArticles !== null && beGroups !== null) {
        articles.value = beArticles
        groups.value = beGroups
        backendReachable.value = true
        for (const a of beArticles) await wordDB.saveArticle(JSON.parse(JSON.stringify(a)))
        for (const g of beGroups) await wordDB.saveArticleGroup(JSON.parse(JSON.stringify(g)))
      } else {
        articles.value = await wordDB.getAllArticles()
        groups.value = await wordDB.getAllArticleGroups()
        backendReachable.value = false
      }
    } finally {
      isLoading.value = false
    }
  }

  async function saveArticle(article: Article) {
    article.updatedAt = new Date().toISOString()
    await wordDB.saveArticle(JSON.parse(JSON.stringify(article)))
    const idx = articles.value.findIndex(a => a.id === article.id)
    if (idx >= 0) Object.assign(articles.value[idx], article)
    else articles.value.unshift(article)
    trackSync('beSaveArticle', be.beSaveArticle(article))
  }

  async function deleteArticle(id: string) {
    await wordDB.deleteArticle(id)
    articles.value = articles.value.filter(a => a.id !== id)
    if (currentId.value === id) currentId.value = null
    trackSync('beDeleteArticle', be.beDeleteArticle(id))
  }

  async function deleteArticles(ids: string[]) {
    for (const id of ids) await wordDB.deleteArticle(id)
    const idSet = new Set(ids)
    articles.value = articles.value.filter(a => !idSet.has(a.id))
    if (currentId.value && idSet.has(currentId.value)) currentId.value = null
    for (const id of ids) trackSync('beDeleteArticle', be.beDeleteArticle(id))
  }

  function selectArticle(id: string | null) {
    currentId.value = id
  }

  async function createGroup(name: string): Promise<ArticleGroup> {
    const now = new Date().toISOString()
    const group: ArticleGroup = { id: `ag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim() || '未命名分组', createdAt: now, updatedAt: now }
    await wordDB.saveArticleGroup(JSON.parse(JSON.stringify(group)))
    groups.value.push(group)
    trackSync('beSaveArticleGroup', be.beSaveArticleGroup(group))
    return group
  }

  async function renameGroup(id: string, name: string) {
    const g = groups.value.find(x => x.id === id)
    if (!g) return
    g.name = name.trim() || g.name
    g.updatedAt = new Date().toISOString()
    await wordDB.saveArticleGroup(JSON.parse(JSON.stringify(g)))
    trackSync('beSaveArticleGroup', be.beSaveArticleGroup(g))
  }

  function articlesOfGroup(groupId: string) {
    return articles.value
      .filter(a => a.groupId === groupId)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  }

  function getBookNote(groupId: string, page: number): string {
    const g = groups.value.find(x => x.id === groupId)
    return g?.bookNotes?.[page] ?? ''
  }

  async function saveBookNote(groupId: string, page: number, html: string) {
    const g = groups.value.find(x => x.id === groupId)
    if (!g) return
    const notes = [...(g.bookNotes || [])]
    while (notes.length <= page) notes.push('')
    notes[page] = html
    g.bookNotes = notes
    g.updatedAt = new Date().toISOString()
    await wordDB.saveArticleGroup(JSON.parse(JSON.stringify(g)))
    trackSync('beSaveArticleGroup', be.beSaveArticleGroup(g))
  }

  async function deleteGroup(id: string) {
    await wordDB.deleteArticleGroup(id)
    groups.value = groups.value.filter(g => g.id !== id)
    trackSync('beDeleteArticleGroup', be.beDeleteArticleGroup(id))
    for (const a of articles.value) {
      if (a.groupId === id) {
        a.groupId = undefined
        await saveArticle(a)
      }
    }
  }

  async function moveArticlesToGroup(ids: string[], groupId: string | undefined) {
    const idSet = new Set(ids)
    for (const a of articles.value) {
      if (idSet.has(a.id)) {
        a.groupId = groupId
        await saveArticle(a)
      }
    }
  }

  async function restoreFromBackend(): Promise<{ articlesRestored: number; groupsRestored: number; backendReachable: boolean }> {
    const beGroups = await be.beListArticleGroups()
    const beArticles = await be.beListArticles()
    if (beGroups === null && beArticles === null) {
      return { articlesRestored: 0, groupsRestored: 0, backendReachable: false }
    }
    let groupsRestored = 0
    let articlesRestored = 0
    if (beGroups) {
      for (const g of beGroups) {
        if (!groups.value.find(x => x.id === g.id)) {
          await wordDB.saveArticleGroup(JSON.parse(JSON.stringify(g)))
          groups.value.push(g)
          groupsRestored++
        }
      }
    }
    if (beArticles) {
      for (const a of beArticles) {
        if (!articles.value.find(x => x.id === a.id)) {
          await wordDB.saveArticle(JSON.parse(JSON.stringify(a)))
          articles.value.push(a)
          articlesRestored++
        }
      }
    }
    return { articlesRestored, groupsRestored, backendReachable: true }
  }

  return {
    articles,
    groups,
    currentId,
    current,
    isLoading,
    backendReachable,
    loadArticles,
    saveArticle,
    deleteArticle,
    deleteArticles,
    selectArticle,
    createGroup,
    articlesOfGroup,
    getBookNote,
    saveBookNote,
    renameGroup,
    deleteGroup,
    moveArticlesToGroup,
    restoreFromBackend
  }
})
