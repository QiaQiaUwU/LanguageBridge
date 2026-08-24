import { createRouter, createWebHistory } from 'vue-router'
import { tasks } from '@/shared/core/taskCenter'

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

/**
 * 教材还在生成时，学习页直接进不去。
 *
 * 之前只是把主页那个按钮置灰 —— 可进学习页的路不止那一条
 * （词汇中心的范围弹窗、生词本/错词本的「练这批」、浏览器前进后退、
 * 直接敲地址），随便哪条都能绕过去，进去之后又只能自己退出来。
 * 拦在路由这一层，所有入口一次管住。
 *
 * 只拦学习页；听写、测试、消消乐不依赖教材，照常进。
 */
router.beforeEach((to, from, next) => {
  if (to.path !== '/study') return next()
  const running = tasks.some(
    t => t.status === 'running' && String(t.id || '').startsWith('syllabus')
  )
  if (!running) return next()

  // 已经在学习页里（比如刷新）就别把人踢走，那样更莫名其妙
  if (from.path === '/study') return next(false)
  next(from.path && from.path !== '/' ? false : '/home')
})

export default router
