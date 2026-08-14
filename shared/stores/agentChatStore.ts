import { defineStore } from 'pinia'
import { ref } from 'vue'
import { askAiWithTools, AiError, type AiTool } from '@/shared/core/aiClient'
import { isAiConfigured } from '@/shared/core/aiSettings'
import { addTodo } from '@/shared/core/studyTodos'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
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
      const system = `你是一个耐心的英语学习助手。${todayContext()}`
      const result = await askAiWithTools(
        `${contextLine}以下是对话上下文：\n${historyText}\n\n请针对用户最后的问题给出简洁、有帮助的中文回答。如果用户是在要求你记住/提醒某件事，调用 add_todo 工具去真的建一条待办，不要只是嘴上说"好的我记住了"。`,
        TOOLS,
        executeAddTodo,
        system
      )
      chatHistory.value.push({ role: 'assistant', content: result.text || '好的' })
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

  return { chatHistory, chatSending, lastToolCallAt, sendChat, pushAssistantMessage, pushUserMessage, clearChat }
})
