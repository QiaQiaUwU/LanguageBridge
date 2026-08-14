
export type RelationType = 'synonym' | 'antonym' | 'word_family' | 'morphology'

export const RELATION_COLORS: Record<RelationType, string> = {
  synonym: '#4a9eff',
  antonym: '#ff6b6b',
  word_family: '#4caf50',
  morphology: '#c084fc'
}

export const RELATION_WEIGHTS: Record<RelationType, number> = {
  synonym: 0.8,
  antonym: 0.6,
  word_family: 0.7,
  morphology: 0.4
}

export const RELATION_LABELS: Record<RelationType, string> = {
  synonym: '近义词',
  antonym: '反义词',
  word_family: '同根词',
  morphology: '词形变换'
}

export const SOURCE_COLORS: Record<string, string> = {
  初中: '#10b981',
  高中: '#06b6d4',
  'CET-4': '#3b82f6',
  'CET-6': '#8b5cf6',
  考研: '#ec4899',
  托福: '#f59e0b',
  雅思: '#14b8a6',
  SAT: '#ef4444',
  GRE: '#6366f1',

  CET4: '#3b82f6',
  CET6: '#8b5cf6',
  TOEFL: '#f59e0b',
  IELTS: '#14b8a6',
  高考: '#06b6d4',

  default: '#60a5fa'
}

export const SOURCE_ORDER = [
  '初中',
  '高中', '高考',
  'CET-4', 'CET4',
  'CET-6', 'CET6',
  '考研',
  '雅思', 'IELTS',
  '托福', 'TOEFL',
  'SAT',
  'GRE'
]

export function sourceColorsOf(sources?: string[]): string[] {
  const list = (sources || []).map(s => SOURCE_COLORS[s]).filter(Boolean)
  return list.length ? list : [SOURCE_COLORS.default]
}

export const MASTERY_COLORS: Record<string, string> = {
  mastered: '#fff4d6',  // 已掌握：暖白，最亮
  known: '#7fd1ff',     // 认识：亮蓝
  fuzzy: '#4a7fa8',     // 模糊：中等
  unknown: '#8a5a5a',   // 不认识：暗红
  unmarked: '#2f3a4a'   // 没学过：接近背景的暗灰蓝
}

const TOPIC_PALETTE = [
  '#4a9eff', '#ff6b6b', '#4caf50', '#f59e0b', '#a78bfa',
  '#14b8a6', '#ec4899', '#84cc16', '#06b6d4', '#f97316'
]
export function topicColor(topic: string, allTopics: string[]): string {
  const i = allTopics.indexOf(topic)
  return i < 0 ? SOURCE_COLORS.default : TOPIC_PALETTE[i % TOPIC_PALETTE.length]
}
