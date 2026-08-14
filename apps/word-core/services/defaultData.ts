import { wordDB } from '@/shared/core/database'
import type { WordItem, WordGroup } from '@/shared/types/WordItem'

export const defaultWordList: WordItem[] = [
  {
    id: 'w1',
    word: 'abandon',
    phonetic: '/əˈbændən/',
    meanings: [
      {
        chinese: 'v. 抛弃，遗弃；放弃',
        english: 'to give up completely; to desert',
        partOfSpeech: 'v.',
        examples: [
          'She abandoned her plans to travel around the world.',
          'The baby was abandoned by its parents.'
        ],
        root: 'a- (away) + bandon (proclamation)'
      }
    ],
    level: 'CET4',
    source: 'system-builtin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'w2',
    word: 'ability',
    phonetic: '/əˈbɪləti/',
    meanings: [
      {
        chinese: 'n. 能力；才能',
        english: 'the power or skill to do something',
        partOfSpeech: 'n.',
        examples: [
          'She has the ability to speak six languages.',
          'He showed great ability in mathematics.'
        ],
        synonyms: ['capacity', 'skill', 'talent']
      }
    ],
    level: 'CET4',
    audioUrl: '/assets/audio/ability.mp3',
    source: 'system-builtin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'w3',
    word: 'absolutely',
    phonetic: '/ˈæbsəluːtli/',
    meanings: [
      {
        chinese: 'adv. 绝对地；完全地',
        english: 'with no qualification, restriction, or limitation',
        partOfSpeech: 'adv.',
        examples: [
          'I absolutely love this song!',
          'She absolutely refused to go.'
        ]
      }
    ],
    level: 'CET4',
    source: 'system-builtin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'w4',
    word: 'academic',
    phonetic: '/ˌækəˈdemɪk/',
    meanings: [
      {
        chinese: 'adj. 学术的；学院的',
        english: 'relating to education and scholarship',
        partOfSpeech: 'adj.',
        examples: [
          'She received academic honors for her research.',
          'Academic standards have risen in recent years.'
        ]
      },
      {
        chinese: 'n. 大学生，学者',
        english: 'a teacher or scholar in a university or institute of higher education',
        partOfSpeech: 'n.',
        examples: [
          'The meeting was attended by academics from many countries.'
        ]
      }
    ],
    level: 'CET4',
    source: 'system-builtin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'w5',
    word: 'accelerate',
    phonetic: '/əkˈseləreɪt/',
    meanings: [
      {
        chinese: 'v. 加速；促进',
        english: 'to increase in speed or rate',
        partOfSpeech: 'v.',
        examples: [
          'The car accelerated to overtake the truck.',
          'Economic growth has accelerated in the region.'
        ]
      }
    ],
    level: 'CET4',
    source: 'system-builtin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
]

export const defaultGroups: WordGroup[] = [
  {
    id: 'all',
    name: '所有单词',
    description: '系统内所有单词',
    wordIds: defaultWordList.map(w => w.id),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'CET4',
    name: 'CET4核心词汇',
    description: '大学英语四级核心词汇',
    wordIds: defaultWordList.map(w => w.id),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    color: '#4285F4'
  },
  {
    id: 'review',
    name: '待复习单词',
    description: '需要复习的单词',
    wordIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    color: '#FBBC05'
  }
]

export async function initializeDefaultData() {
  console.log('🔍 检查LanguageBridge数据初始化...')

  try {
    const existingWords = await wordDB.getAllWords()
    const existingGroups = await wordDB.getAllGroups()

    if (existingWords.length === 0) {
      console.log('✨ 数据库为空 → 初始化默认数据')
      await wordDB.saveBatch(defaultWordList)
      console.log(`✅ 初始化了 ${defaultWordList.length} 个单词`)
    } else {
      console.log(`✅ 已加载 ${existingWords.length} 个单词，跳过初始化`)
    }

    if (existingGroups.length === 0) {
      console.log('✨ 初始化默认分组')
      for (const group of defaultGroups) {
        await wordDB.saveGroup(group)
      }
      console.log(`✅ 初始化了 ${defaultGroups.length} 个分组`)
    } else {
      console.log(`✅ 已加载 ${existingGroups.length} 个分组`)
    }

    console.log('🎉 LanguageBridge初始化完成')
    return true
  } catch (error) {
    console.error('❌ 初始化失败:', error)
    return false
  }
}