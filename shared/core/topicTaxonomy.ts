
const SUPER_MAP: Record<string, string[]> = {
  人与社会: ['社会生活', '工作', '商业经济金融', '银行服务', '校园生活'],
  情感心理: ['情感态度'],
  知识与文化: ['学科', '艺术文化', '科技', '图书馆'],
  自然与环境: ['环境', '动植物', '地点'],
  生活与健康: ['日常物品', '医疗', '住宿', '运动'],
  出行: ['旅游', '交通'],
  时间与数量: ['时间数量']
}

const TOPIC_TO_SUPER = new Map<string, string>()
for (const [sup, topics] of Object.entries(SUPER_MAP)) {
  for (const t of topics) TOPIC_TO_SUPER.set(t, sup)
}

const FALLBACK_RULES: Array<[string, RegExp]> = [
  ['情感心理', /情感|情绪|心理|性格|态度|感受/],
  ['人与社会', /社会|人物|家庭|人际|关系|职业|工作|政治|法律|军事|战争|宗教|经济|金融|商业|企业|管理/],
  ['自然与环境', /自然|动物|植物|天气|气候|环境|地理|地质|海洋|农业|生态|资源|能源|地点|地区/],
  ['知识与文化', /学科|学术|教育|学校|研究|语言|文学|艺术|文化|哲学|数学|科技|技术|计算机|历史/],
  ['生活与健康', /身体|健康|医学|医疗|疾病|运动|饮食|食物|睡眠|物品|服饰|居住|住宿/],
  ['出行', /旅游|旅行|交通|出行|车|航/],
  ['时间与数量', /时间|数量|大小|形状|顺序|程度|度量/]
]

const POSITIVE = /喜悦|快乐|高兴|愉快|满意|兴奋|热情|希望|自信|勇敢|感激|温柔|善良|平静|安心|骄傲|欣赏|赞美|喜爱|幸福|乐观|友好|钦佩|放松|舒适|鼓励|欢迎|宽容|\b(joy|happy|glad|delight|pleased|cheer|hope|confident|brave|grateful|kind|calm|proud|admire|praise|love|content|optimis|friendly|relief|comfort|encourage|welcome)/i
const NEGATIVE = /悲伤|难过|痛苦|愤怒|生气|恐惧|害怕|焦虑|担忧|失望|沮丧|厌恶|讨厌|嫉妒|羞耻|内疚|孤独|绝望|烦躁|轻蔑|冷漠|悲观|不安|忧郁|敌意|怨恨|\b(sad|sorrow|grief|pain|anger|angry|rage|fear|afraid|anxious|worry|disappoint|depress|disgust|hate|jealous|shame|guilt|lonely|despair|irritat|contempt|gloom|hostil|resent)/i
const POLARITY_MARKED = /积极|正面|褒义|消极|负面|贬义|positive|negative/i

export function superTopicOf(topic: string): string {
  if (!topic) return '未分类'
  const hit = TOPIC_TO_SUPER.get(topic.trim())
  if (hit) return hit
  for (const [sup, re] of FALLBACK_RULES) if (re.test(topic)) return sup
  return '未分类'
}

export function refineTopic(topic: string, sample: string): string {
  if (!topic || superTopicOf(topic) !== '情感心理' || POLARITY_MARKED.test(topic)) return topic
  const pos = POSITIVE.test(sample)
  const neg = NEGATIVE.test(sample)
  if (pos && !neg) return `积极${topic}`
  if (neg && !pos) return `消极${topic}`
  return topic
}

export const SUPER_ORDER: string[] = [...Object.keys(SUPER_MAP), '未分类']
