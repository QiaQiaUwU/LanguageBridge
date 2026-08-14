import { aiSettings, isAiConfigured } from './aiSettings'

export class AiError extends Error {}

const PROXY_PATH = '/__ai_proxy'

interface ProxyRequest {
  url: string
  method?: 'GET' | 'POST'
  headers: Record<string, string>
  payload?: unknown
}

async function callViaProxy(req: ProxyRequest, timeoutMs = 60_000): Promise<any> {
  let res: Response
  const secs = Math.round(timeoutMs / 1000)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    res = await fetch(PROXY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal
    })
    clearTimeout(timer)
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new AiError(`请求超时（${secs}秒），服务商可能响应缓慢，请稍后重试`)
    }
    throw new AiError(
      '无法连接本地服务，请确认是通过 启动LanguageBridge.bat 打开的（不是直接双击 index.html，也不是用 npm run dev 之外的方式打开）'
    )
  }

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new AiError(`服务商返回了非预期内容(状态码 ${res.status})：${text.slice(0, 200)}`)
  }

  if (data.__proxyError) {
    throw new AiError(`请求转发失败：${data.__proxyError}`)
  }
  if (!res.ok) {
    const msg = data.error?.message || data.error || JSON.stringify(data).slice(0, 200)
    let hint = ''
    if (res.status === 401) hint = '（API Key 不对，401 未授权）'
    else if (res.status === 403) hint = '（没有权限访问，403）'
    else if (res.status === 404) hint = '（接口地址不对，404——多数中转站 Base URL 要以 /v1 结尾）'
    throw new AiError(`调用失败(${res.status})${hint}：${msg}`)
  }
  return data
}

export async function askAi(
  prompt: string,
  system?: string,
  maxTokens = 2000,
  timeoutMs = 60_000
): Promise<string> {
  if (!isAiConfigured()) {
    throw new AiError('尚未配置 API Key，请先在设置中填写')
  }
  if (!aiSettings.model.trim()) {
    throw new AiError('模型名称还没填，请在设置里把"模型名称"这一栏填好再试（注意占位提示文字不是实际值）')
  }
  if (aiSettings.provider === 'anthropic') {
    return askAnthropic(prompt, system, maxTokens, timeoutMs)
  }
  return askOpenAiCompatible(prompt, system, timeoutMs)
}

export interface AiTool {
  name: string
  description: string
  parameters: Record<string, any>
}

export interface ToolCallResult {
  text: string
  toolCalls: { name: string; input: any; result: string }[]
}

const MAX_TOOL_ROUNDS = 3

export async function askAiWithTools(
  prompt: string,
  tools: AiTool[],
  executeTool: (name: string, input: any) => Promise<string>,
  system?: string,
  maxTokens = 1000
): Promise<ToolCallResult> {
  if (!isAiConfigured()) throw new AiError('尚未配置 API Key，请先在设置中填写')
  if (!aiSettings.model.trim()) throw new AiError('模型名称还没填，请在设置里把"模型名称"这一栏填好再试')
  if (aiSettings.provider === 'anthropic') {
    return anthropicToolLoop(prompt, tools, executeTool, system, maxTokens)
  }
  return openAiToolLoop(prompt, tools, executeTool, system)
}

async function anthropicToolLoop(
  prompt: string,
  tools: AiTool[],
  executeTool: (name: string, input: any) => Promise<string>,
  system: string | undefined,
  maxTokens: number
): Promise<ToolCallResult> {
  const anthropicTools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  const messages: any[] = [{ role: 'user', content: prompt }]
  const toolCalls: { name: string; input: any; result: string }[] = []
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callViaProxy({
      url: `${aiSettings.baseUrl.replace(/\/$/, '')}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': aiSettings.apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: {
        model: aiSettings.model,
        max_tokens: maxTokens,
        system: system || undefined,
        tools: anthropicTools,
        messages
      }
    })
    const blocks = data.content || []
    const toolUseBlocks = blocks.filter((b: any) => b.type === 'tool_use')
    const text = blocks
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text || '')
      .join('')
      .trim()
    if (!toolUseBlocks.length) return { text, toolCalls }
    messages.push({ role: 'assistant', content: blocks })
    const resultBlocks: any[] = []
    for (const tb of toolUseBlocks) {
      const result = await executeTool(tb.name, tb.input)
      toolCalls.push({ name: tb.name, input: tb.input, result })
      resultBlocks.push({ type: 'tool_result', tool_use_id: tb.id, content: result })
    }
    messages.push({ role: 'user', content: resultBlocks })
  }
  return { text: '（工具调用轮数太多，没能给出最终总结，但上面的操作已经执行了）', toolCalls }
}

async function openAiToolLoop(
  prompt: string,
  tools: AiTool[],
  executeTool: (name: string, input: any) => Promise<string>,
  system: string | undefined
): Promise<ToolCallResult> {
  const openAiTools = tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
  const messages: any[] = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }]
  const toolCalls: { name: string; input: any; result: string }[] = []
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callViaProxy({
      url: `${aiSettings.baseUrl.replace(/\/$/, '')}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiSettings.apiKey}`
      },
      payload: {
        model: aiSettings.model,
        stream: false,
        tools: openAiTools,
        messages
      }
    })
    const msg = data.choices?.[0]?.message
    const calls = msg?.tool_calls || []
    if (!calls.length) return { text: (msg?.content || '').trim(), toolCalls }
    messages.push(msg)
    for (const c of calls) {
      let input: any = {}
      try {
        input = JSON.parse(c.function?.arguments || '{}')
      } catch {
      }
      const result = await executeTool(c.function?.name, input)
      toolCalls.push({ name: c.function?.name, input, result })
      messages.push({ role: 'tool', tool_call_id: c.id, content: result })
    }
  }
  return { text: '（工具调用轮数太多，没能给出最终总结，但上面的操作已经执行了）', toolCalls }
}

async function askAnthropic(prompt: string, system?: string, maxTokens = 2000, timeoutMs = 60_000): Promise<string> {
  const data = await callViaProxy({
    url: `${aiSettings.baseUrl.replace(/\/$/, '')}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': aiSettings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: {
      model: aiSettings.model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }]
    }
  }, timeoutMs)
  return (data.content || []).map((c: any) => c.text || '').join('').trim()
}

async function askOpenAiCompatible(prompt: string, system?: string, timeoutMs = 60_000): Promise<string> {
  const data = await callViaProxy({
    url: `${aiSettings.baseUrl.replace(/\/$/, '')}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiSettings.apiKey}`
    },
    payload: {
      model: aiSettings.model,
      stream: false,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt }
      ]
    }
  }, timeoutMs)
  return data.choices?.[0]?.message?.content?.trim() || ''
}

export async function askAiWithImage(base64Data: string, mimeType: string, prompt: string): Promise<string> {
  if (!isAiConfigured()) {
    throw new AiError('尚未配置 API Key，请先在设置中填写')
  }
  if (!aiSettings.model.trim()) {
    throw new AiError('模型名称还没填，请在设置里把"模型名称"这一栏填好再试')
  }
  if (aiSettings.provider === 'anthropic') {
    const data = await callViaProxy({
      url: `${aiSettings.baseUrl.replace(/\/$/, '')}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': aiSettings.apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: {
        model: aiSettings.model,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
            { type: 'text', text: prompt }
          ]
        }]
      }
    })
    return (data.content || []).map((c: any) => c.text || '').join('').trim()
  }
  const data = await callViaProxy({
    url: `${aiSettings.baseUrl.replace(/\/$/, '')}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiSettings.apiKey}`
    },
    payload: {
      model: aiSettings.model,
      stream: false,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
        ]
      }]
    }
  })
  return data.choices?.[0]?.message?.content?.trim() || ''
}

function extractModelIds(data: any): string[] {
  const ids: string[] = []
  const push = (x: any) => {
    if (typeof x === 'string') {
      if (x.trim()) ids.push(x.trim())
    } else if (x && typeof x === 'object') {
      for (const k of ['id', 'name', 'model', 'model_name']) {
        if (typeof x[k] === 'string' && x[k].trim()) {
          ids.push(x[k].trim().replace(/^models\//, ''))
          break
        }
      }
    }
  }
  try {
    if (Array.isArray(data)) {
      data.forEach(push)
    } else if (data && typeof data === 'object') {
      for (const key of ['data', 'models', 'result', 'model_list']) {
        if (Array.isArray(data[key])) data[key].forEach(push)
      }
      if (!ids.length && (data.id || data.name)) push(data)
    }
  } catch {
  }
  return [...new Set(ids)]
}

export async function fetchAvailableModels(): Promise<string[]> {
  if (!aiSettings.apiKey.trim()) {
    throw new AiError('请先填写 API Key')
  }
  const base = aiSettings.baseUrl.replace(/\/$/, '')
  const candidates = [`${base}/models`]
  if (!/\/v1/i.test(base)) candidates.push(`${base}/v1/models`)
  if (aiSettings.provider === 'anthropic') candidates.unshift(`${base}/v1/models`)

  const bearerHeaders: Record<string, string> =
    aiSettings.provider === 'anthropic'
      ? { 'x-api-key': aiSettings.apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${aiSettings.apiKey}` }

  let lastErr = ''
  for (const url of candidates) {
    try {
      const data = await callViaProxy({ url, method: 'GET', headers: bearerHeaders })
      const ids = extractModelIds(data)
      if (ids.length) return ids.sort()
    } catch (e) {
      lastErr = e instanceof AiError ? e.message : String(e)
    }
  }

  try {
    const url = candidates[0] + (candidates[0].includes('?') ? '&' : '?') + `key=${encodeURIComponent(aiSettings.apiKey)}`
    const data = await callViaProxy({ url, method: 'GET', headers: {} })
    const ids = extractModelIds(data)
    if (ids.length) return ids.sort()
  } catch {
  }

  throw new AiError(lastErr || '这个接口没有返回可识别的模型列表，可能不支持标准的模型列表接口，直接手填模型名即可')
}
