import { createRouter, createWebHistory } from 'vue-router'

import WordCore from '../../apps/word-core/WordCore.vue'
import HomePage from '../../apps/study/HomePage.vue'
import StudyPage from '../../apps/study/StudyPage.vue'
import MasteredWords from '../../apps/study/MasteredWords.vue'
import NewWordsPage from '../../apps/study/NewWordsPage.vue'
import WrongBookPage from '../../apps/study/WrongBookPage.vue'
import StudyNotesPage from '../../apps/study/StudyNotesPage.vue'

const routes = [
  {
    path: '/',
    redirect: '/home'
  },
  {
    path: '/home',
    name: 'Home',
    component: HomePage,
    meta: { title: '主页' }
  },
  {
    path: '/study',
    name: 'Study',
    component: StudyPage,
    meta: { title: '学习' }
  },
  {
    path: '/mastered',
    name: 'Mastered',
    component: MasteredWords,
    meta: { title: '已掌握' }
  },
  {
    path: '/new-words',
    name: 'NewWords',
    component: NewWordsPage,
    meta: { title: '生词本' }
  },
  {
    path: '/wrong-book',
    name: 'WrongBook',
    component: WrongBookPage,
    meta: { title: '错词本' }
  },
  {
    path: '/match',
    name: 'MatchGame',
    component: () => import('@/apps/study/MatchGamePage.vue'),
    meta: { title: '卡片消消乐' }
  },
  {
    path: '/word-test',
    name: 'WordTest',
    component: () => import('@/apps/study/WordTestPage.vue'),
    meta: { title: '单词测试' }
  },
  {
    path: '/study-notes',
    name: 'StudyNotes',
    component: StudyNotesPage,
    meta: { title: '学习记录' }
  },
  {
    path: '/scenario',
    name: 'Scenario',
    component: () => import('../../apps/study/ScenarioPage.vue'),
    meta: { title: '场景学习' }
  },
  {
    path: '/universe',
    name: 'Universe',
    component: () => import('../../apps/study/UniversePage.vue'),
    meta: { title: '词汇宇宙' }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../../apps/study/SettingsPage.vue'),
    meta: { title: '设置' }
  },
  {
    path: '/words',
    name: 'WordCore',
    component: WordCore,
    meta: { title: '词汇中心' }
  },
  {
    path: '/dictation',
    name: 'Dictation',
    component: () => import('../../apps/dictation-app/DictationApp.vue'),
    meta: { title: '听写训练' }
  },
  {
    path: '/reading',
    name: 'Reading',
    component: () => import('../../apps/reading-assistant/ReadingAssistant.vue'),
    meta: { title: '阅读助手' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
