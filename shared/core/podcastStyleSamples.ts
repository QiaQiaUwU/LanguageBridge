/**
 * 播客文体的「范例」。
 *
 * 提示词里原来只有文风的**描述**（要具体、要有转、别用套话），
 * 描述再细也不如给模型看一段真东西 —— 少样本比形容词管用得多。
 *
 * 这里放的是用户自己已有的「沉浸式背单词」稿的开头几句（各取一段，不放全文：
 * 一是省 token，二是给全文模型容易照抄内容而不是学写法）。
 * 想换/加范例，改这个数组即可，generatePodcastArticle 会自动带上。
 *
 * 挑选标准：一句英文配一句中文、从具体的物或时刻起笔、有一次由景到人的转。
 */

export interface PodcastStyleSample {
  /** 这篇的题目，只用来在提示词里标注，不参与生成 */
  title: string
  /** 摘录的句对，顺序即原文顺序 */
  lines: { en: string; zh: string }[]
}

export const PODCAST_STYLE_SAMPLES: PodcastStyleSample[] = [
  {
    title: '我言秋日胜春朝',
    lines: [
      { en: 'When autumn arrives, have you noticed that your ability to perceive happiness suddenly gets amplified?', zh: '一入秋，你有没有觉得自己感知幸福的能力突然被放大了？' },
      { en: 'Maybe it happens when you step outside one morning and find that the muggy air has finally been replaced by a crisp coolness.', zh: '或者是某天早上出门，发现闷热的空气终于被一股清爽的凉意取代。' },
      { en: 'And you can smell that honey-like osmanthus scent in the air.', zh: '空气中还带着点桂花香。' },
      { en: 'Walking down the street, you often catch that sweet aroma of roasted chestnuts and baked sweet potatoes.', zh: '走在路上还时不时闻到一股浓浓的糖炒栗子和烤红薯的甜香味道。' },
      { en: 'What\'s even more wonderful is that you actually begin to enjoy cooking.', zh: '更奇妙的是，你开始享受下厨了。' },
      { en: 'Making meals in the summer heat felt like torture.', zh: '夏天在厨房做饭像受刑。' },
      { en: 'The truth is, autumn doesn\'t really add anything to life; it just lifts the burden off our senses.', zh: '其实秋天也没有给生活增加什么，它只是为我们的感官卸下了负担。' },
      { en: 'It\'s not that life gets better, it\'s that everything gets easier.', zh: '不是生活变好了，而是一切都变轻松了。' }
    ]
  },
  {
    title: '让你感觉穿越回过去的时刻',
    lines: [
      { en: 'But then, years later, some random algorithm plays that song again.', zh: '但多年以后，某个随机算法又播放起了那首歌。' },
      { en: 'It doesn\'t just remind you of the past; it floods you with it.', zh: '它不只是让你想起过去，而是让你淹没在回忆之中。' },
      { en: 'The streets you saw during your commute, the weather outside your window, the book you were reading back then, all surface in your mind along with the melody.', zh: '你通勤时看过的街景，窗外的天气，那时候读的书，随着旋律一同浮现在脑海。' },
      { en: 'It might be the scent of wet earth after rain, which smells like freedom.', zh: '有可能是雨后泥土的味道，带着自由的气息。' },
      { en: 'Sound is like the most precise time-traveling jukebox.', zh: '声音则像一台最精准的时光点唱机。' },
      { en: 'The moment the intro plays, you see the unfinished homework, the passed notes, and a youth you can never get back.', zh: '前奏一响，你眼前就是写不完的作业、传来传去的纸条，和回不去的青春。' },
      { en: 'Our senses are secretly holding on to it for us.', zh: '而是被我们的感官秘密地保存着。' },
      { en: 'They preserve every moment we truly lived.', zh: '它封存着我们每一段认真活过的时光。' }
    ]
  },
  {
    title: '雨季·全世界的水都会重逢',
    lines: [
      { en: "This year's rainy season seems to have overstayed its welcome.", zh: '今年的雨季似乎格外漫长，赖着不肯走。' },
      { en: 'The dampness gets into everything—books and every little corner.', zh: '潮湿的空气无处不在，渗进书本，渗进每一个角落。' },
      { en: "Maybe it's not just the room getting musty—people do too.", zh: '也许发霉的不只是环境，人也一样。' },
      { en: 'Negative thoughts start creeping in, spreading like little patches of mold.', zh: '消极情绪悄悄滋生，像霉斑一样蔓延开来。' },
      { en: 'People are at their most vulnerable when they\'re soaked by rain.', zh: '人被雨淋湿的时候是最脆弱的。' },
      { en: 'In the rain, any anger dissolves into a sense of grievance.', zh: '在雨中，所有的愤怒都会化成委屈。' },
      { en: 'But if it wants to rain, just let it rain.', zh: '但雨要下，就让它下吧。' },
      { en: "We'll all be fine, and we'll walk through it slowly.", zh: '我们都会好好的，慢慢地走过去。' }
    ]
  },
  {
    title: '叙事·人类是唯一会讲故事的动物',
    lines: [
      { en: 'Humans might be the only animal that tells stories.', zh: '人类大概是唯一会讲故事的动物。' },
      { en: 'We give names to the stars and connect them into constellations.', zh: '我们给天上的星星起名字，把它们连成星座。' },
      { en: 'We create order from chaos and meaning from nothingness.', zh: '我们从混沌中创造秩序，从虚无中创造意义。' },
      { en: 'This is narrative identity theory.', zh: '这就是叙事身份理论。' },
      { en: 'You cannot change the facts, but you can always rewrite what they mean.', zh: '事实无法改变，但意义永远可以被重新赋予。' },
      { en: 'Meaning is the fuel of action.', zh: '意义是行动的燃料。' },
      { en: "A car without fuel can be pushed for a while, but you won't get far, and it won't last.", zh: '没有燃料的车可以推着走一段，但始终推不远，也推不久。' },
      { en: 'You just have to allow yourself to take one step.', zh: '而是允许自己先迈一步。' }
    ]
  }
]

/** 拼成提示词里那一段。没有范例就返回空串，调用方不用判空。 */
export function buildStyleSampleBlock(max = 3): string {
  const picked = PODCAST_STYLE_SAMPLES.slice(0, max)
  if (!picked.length) return ''
  const body = picked
    .map(s => `【范例·${s.title}】\n` + s.lines.map(l => `${l.en}\n${l.zh}`).join('\n'))
    .join('\n\n')
  return `下面是几段这个文体的真实范例，**学它的写法，不要用它的内容**：\n\n${body}\n`
}
