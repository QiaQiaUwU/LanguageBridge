import { defineStore } from 'pinia'
import { ref } from 'vue'
import { askAiWithTools, AiError, type AiTool } from '@/shared/core/aiClient'
import { isAiConfigured } from '@/shared/core/aiSettings'
import { addTodo } from '@/shared/core/studyTodos'
import { extractWidgets, TOOL_PROMPT, type WidgetSpec } from '@/shared/core/agentTools'
import { extractActions, ACTION_PROMPT, describeAction, needsConfirm, type ActionSpec } from '@/shared/core/agentActions'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 助手回答里嵌的交互部件（词汇宇宙小窗、单词卡、小测验…） */
  widgets?: WidgetSpec[]
  /** 待确认的操作。用户点了「执行」才真的动数据 */
  pendingAction?: ActionSpec
  /** 这个操作的人话描述，显示在确认条上 */
  actionText?: string
  /** 执行完的结果，执行后替换掉确认条 */
  actionResult?: string
  /**
   * 只给模型看、不显示给用户的消息（比如"刚才那个操作的执行结果"）。
   * 渲染时要跳过，否则用户会看到一条自己没说过的话。
   */
  hidden?: boolean
}

/**
 * 当前页面上有什么。页面自己往这里写，聊天时带给模型 ——
 * 这样用户说「讲讲屏幕上这几个词的关系」它才知道指的是谁。
 */
export const pageContext = ref('')
export function setPageContext(text: string) {
  pageContext.value = text
}

const TOOLS: AiTool[] = [
  {
    name: 'add_todo',
    description: '在用户的学习待办列表里新建一条待办事项，用户提到"提醒我""记得""待办"之类需求、或者明确说了要做什么事和什么时候做时调用。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待办内容，简洁描述要做的事' },
        due: { type: 'string', description: '截止日期，格式 YYYY-MM-DD；如果用户没提到具体时间就留空字符串' }
      },
      required: ['text']
    }
  }
]

async function executeAddTodo(name: string, input: any): Promise<string> {
  if (name !== 'add_todo') return `未知工具：${name}`
  const text = String(input?.text || '').trim()
  if (!text) return '失败：text 不能为空'
  const due = String(input?.due || '').trim()
  await addTodo(text, due)
  return due ? `已添加待办"${text}"，截止 ${due}` : `已添加待办"${text}"`
}

function todayContext(): string {
  const d = new Date()
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `今天是 ${iso}，${weekday}。用户提到"明天""周五""下周三"这类相对日期时，据此换算成 YYYY-MM-DD 再调用工具，不要把相对日期原样传给工具参数。`
}

export const useAgentChatStore = defineStore('agentChat', () => {
  const chatHistory = ref<ChatMessage[]>([])
  const chatSending = ref(false)
  const lastToolCallAt = ref(0)

  async function sendChat(text: string, context?: string) {
    const trimmed = text.trim()
    if (!trimmed || !isAiConfigured()) return
    chatHistory.value.push({ role: 'user', content: trimmed })
    chatSending.value = true
    try {
      const historyText = chatHistory.value
        .slice(-8)
        .map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
        .join('\n')
      const contextLine = context ? `用户在阅读时选中了这段原文："${context}"，接下来的问题是针对这段原文问的。\n\n` : ''
      const pageLine = pageContext.value ? `\n\n${pageContext.value}` : ''
      const system =
        `你是一个耐心的英语学习助手。${todayContext()}${pageLine}\n\n${TOOL_PROMPT}\n\n${ACTION_PROMPT}`
      const result = await askAiWithTools(
        `${contextLine}以下是对话上下文：\n${historyText}\n\n请针对用户最后的问题给出简洁、有帮助的中文回答。如果用户是在要求你记住/提醒某件事，调用 add_todo 工具去真的建一条待办，不要只是嘴上说"好的我记住了"。`,
        TOOLS,
        executeAddTodo,
        system
      )
      // 把回答里的部件和操作请求抽出来，正文里不留代码块
      const parsed = extractWidgets(result.text || '')
      const acted = extractActions(parsed.text)
      const action = acted.actions[0]

      chatHistory.value.push({
        role: 'assistant',
        content: acted.text || (parsed.widgets.length || action ? '' : '好的'),
        widgets: parsed.widgets.length ? parsed.widgets : undefined,
        // 会改数据的挂起来等确认；只读的也挂着，但确认条上写明"只是查询"
        pendingAction: action,
        actionText: action ? describeAction(action) + (needsConfirm(action.tool) ? '' : '（只是查询，不改数据）') : undefined
      })
      if (result.toolCalls.length) lastToolCallAt.value = Date.now()
    } catch (e) {
      chatHistory.value.push({
        role: 'assistant',
        content: e instanceof AiError ? e.message : '出错了，请稍后重试'
      })
    } finally {
      chatSending.value = false
    }
  }

  function pushAssistantMessage(content: string) {
    chatHistory.value.push({ role: 'assistant', content })
  }

  function pushUserMessage(content: string) {
    chatHistory.value.push({ role: 'user', content })
  }

  function clearChat() {
    chatHistory.value = []
  }

  return { chatHistory, chatSending, lastToolCallAt, sendChat, pushAssistantMessage, pushUserMessage, clearChat, setPageContext }
})

/**
 * 用户点了「执行」。
 *
 * 结果会作为一条系统消息回填进历史 —— 模型下一轮能看到自己那步做成没做成，
 * 才不会接着编"已经建好了"。
 */
export async function confirmAction(msgIndex: number, deps: any) {
  const msg = chatHistory.value[msgIndex]
  if (!msg?.pendingAction) return
  const spec = msg.pendingAction
  msg.pendingAction = undefined

  const { runAction } = await import('@/shared/core/agentActions')
  const res = await runAction(spec, deps)
  msg.actionResult = (res.ok ? '✓ ' : '✗ ') + res.summary

  // 回填给模型，下一轮它知道实际发生了什么
  chatHistory.value.push({
    role: 'user',
    content: `［系统］刚才那个操作的执行结果：${res.ok ? '成功' : '失败'}——${res.summary}。请据此接着回答，不要假设别的结果。`,
    hidden: true
  })
}

/** 用户点了「不用」 */
export function rejectAction(msgIndex: number) {
  const msg = chatHistory.value[msgIndex]
  if (!msg) return
  msg.pendingAction = undefined
  msg.actionResult = '已取消，没有改动任何数据'
}
