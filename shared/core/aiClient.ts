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

    /**
     * 预扣费类的 403 要把本次实际发出去的 max_tokens 带上。
     *
     * 中转站按 max_tokens 预扣费，这个参数我改过好几轮却一直查不清 ——
     * 因为报错里只有"需要预扣 ¥600"，看不出我们到底发了多少。
     * 把实发值打出来，一眼就能分辨是「没发/发大了」还是「构建没更新」。
     */
    const sent = (req.payload as any)?.max_tokens
    if (/预扣费|额度|quota|balance/i.test(String(msg))) {
      hint += `（本次实际发出的 max_tokens = ${sent ?? '未发送'}${
        sent ? '' : '——服务商会按它自己的默认上限预扣费，这就是要扣几百块的原因'
      }）`
    }
    throw new AiError(`调用失败(${res.status})${hint}：${msg}`)
  }
  return data
}

export async function askAi(
  prompt: string,
  system?: string,
  maxTokens = 4000,
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
  return askOpenAiCompatible(prompt, system, timeoutMs, maxTokens)
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

async function askAnthropic(prompt: string, system?: string, maxTokens = 4000, timeoutMs = 60_000, heavy = false): Promise<string> {
  const data = await callViaProxy({
    url: `${aiSettings.baseUrl.replace(/\/$/, '')}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': aiSettings.apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: {
      model: heavy ? modelForHeavyTask() : aiSettings.model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }]
    }
  }, timeoutMs)
  return (data.content || []).map((c: any) => c.text || '').join('').trim()
}

async function askOpenAiCompatible(
  prompt: string,
  system?: string,
  timeoutMs = 60_000,
  maxTokens = 4000,
  heavy = false
): Promise<string> {
  const data = await callViaProxy({
    url: `${aiSettings.baseUrl.replace(/\/$/, '')}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiSettings.apiKey}`
    },
    payload: {
      model: heavy ? modelForHeavyTask() : aiSettings.model,
      stream: false,
      /**
       * max_tokens 必须发，而且要给一个合理值。
       *
       * 这个参数被我来回改过三次，记录一下每次为什么错：
       *  1. 一开始不发 —— 中转站按它自己的默认上限（十万级）**预扣费**，
       *     四句话的请求也要预扣 ¥600，余额不够直接 403。
       *  2. 补上但给了 2000 —— 那时 chunkRaw 会把整篇几万字当成一块送进来，
       *     2000 装不下输出，模型返回空。
       *  3. 现在 chunkRaw 已经保证每块 ≤5000 字，4000 tokens 足够放下
       *     一块的 EN/ZH 配对，预扣费也只有几块钱。
       */
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt }
      ]
    }
  }, timeoutMs)
  /**
   * 空回复必须说清原因，不能默默返回 ''。
   *
   * 之前是 `content?.trim() || ''`，于是三种完全不同的情况都变成空串：
   *  - 推理类模型把正文放在 reasoning_content，content 本来就是空的
   *  - token 被思考过程吃光，finish_reason = 'length'
   *  - 服务商返回 200 但结构不一样
   * 上层只能报「AI 实际返回的开头是：（空）」，根本没法查。
   */
  const choice = data.choices?.[0]
  const m = choice?.message || {}
  const content = (m.content || '').trim()
  if (content) return content

  const reasoning = (m.reasoning_content || m.reasoning || '').trim()
  if (reasoning) return reasoning

  const finish = choice?.finish_reason || '未知'
  if (finish === 'length') {
    throw new AiError(
      '模型输出被长度上限截断，一个字都没返回（finish_reason=length）。' +
      '多半是该模型输出上限太小，或思考过程吃光了配额——换个模型，或把待处理段落调小。'
    )
  }
  throw new AiError(
    `模型返回空内容（finish_reason=${finish}）。实际结构：${JSON.stringify(data).slice(0, 300)}`
  )
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
