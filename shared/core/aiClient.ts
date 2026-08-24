import { aiSettings, isAiConfigured, modelForHeavyTask } from './aiSettings'

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

/**
 * jsonOnly：这次调用要的是结构化数据，不是聊天。
 *
 * 带思考过程的模型（deepseek-r1、gemini thinking 之类）会把推理写在
 * `reasoning_content` 里，正文 `content` 有时是空的。聊天场景下把
 * reasoning 拿来顶上还算聊胜于无；但要 JSON 的时候，
 * 拿到的是一整段"我们分析单词 undersize d……"，解析必然失败，
 * 而且一路重试都是同样的结果 —— 补全和教材跑不通就是这么来的。
 *
 * 所以要 JSON 时：content 里的 <think> 段先剥掉；content 真为空就直接报错，
 * 明说这个模型不适合结构化输出，别把思维链塞给上层去解析。
 */
export async function askAi(
  prompt: string,
  system?: string,
  maxTokens = 4000,
  timeoutMs = 60_000,
  jsonOnly = false
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

  /**
   * 被截断就加大配额重来一次。
   *
   * 推理模型的思考要占输出配额，同一个提示词，思考长短每次都不一样 ——
   * 固定一个 max_tokens 必然时灵时不灵，这正是"有时能跑通有时全失败"的来源。
   * 翻倍一次通常就够；还不够就如实报出来，让人知道该调小批量而不是换模型。
   */
  try {
    return await askOpenAiCompatible(prompt, system, timeoutMs, maxTokens, false, jsonOnly)
  } catch (e) {
    if (!(e instanceof TruncatedError)) throw e
    const bigger = Math.min(32000, maxTokens * 3)
    if (bigger <= maxTokens) throw e
    console.warn(`[AI] 输出被截断（max_tokens=${maxTokens}），加大到 ${bigger} 重试一次`)
    try {
      return await askOpenAiCompatible(prompt, system, timeoutMs * 2, bigger, false, jsonOnly)
    } catch (e2) {
      if (e2 instanceof TruncatedError) {
        throw new AiError(
          `输出两次都被截断（${maxTokens} → ${bigger} tokens 都不够）。` +
          '这个模型的思考过程太长，把每批处理的数量调小，或换一个不带思考过程的模型。'
        )
      }
      throw e2
    }
  }
}

/**
 * 输出被长度上限截断。单独一个类型，好让上层认出来并加大配额重试。
 */
export class TruncatedError extends Error {
  constructor(public usedTokens: number) {
    super(`输出被截断（max_tokens=${usedTokens}）`)
    this.name = 'TruncatedError'
  }
}

/**
 * 从一段夹着推理文字的回复里，把 JSON 主体捞出来。
 *
 * 只做定位，不做解析 —— 解析交给各调用方自己那套（它们对数组/对象的要求不同）。
 * 取最外层第一个 `[`…`]` 或 `{`…`}`，按括号配对找真正的收尾，
 * 而不是简单地取 lastIndexOf（推理文字里也可能出现括号）。
 */
export function salvageJson(text: string): string | null {
  const t = String(text || '')
  const found: string[] = []

  /**
   * 每个起始括号都试一遍，最后取**最长**的那个。
   *
   * 只取第一个会被推理文字里的小括号骗到 —— 比如思考里写了
   * `"topics":[]`，那个空数组会先被捞到，真正的结果反而丢了。
   */
  for (const [open, close] of [['[', ']'], ['{', '}']] as const) {
    for (let start = t.indexOf(open); start >= 0; start = t.indexOf(open, start + 1)) {
      let depth = 0
      let inStr = false
      let esc = false
      for (let i = start; i < t.length; i++) {
        const c = t[i]
        if (inStr) {
          if (esc) esc = false
          else if (c === '\\') esc = true
          else if (c === '"') inStr = false
          continue
        }
        if (c === '"') { inStr = true; continue }
        if (c === open) depth++
        else if (c === close) {
          depth--
          if (depth === 0) {
            const body = t.slice(start, i + 1)
            try { JSON.parse(body); found.push(body) } catch { /* 不是合法 JSON */ }
            break
          }
        }
      }
      if (found.length > 40) break   // 够多了，别在超长文本里死磕
    }
  }

  if (!found.length) return null
  return found.sort((a, b) => b.length - a.length)[0]
}

/**
 * 剥掉思维链标签。
 *
 * 有的服务商不分 reasoning_content，把思考和正文一起塞进 content、用标签隔开。
 * 标签名各家不同，这里按 SillyTavern 那份常见清单来 ——
 * 除了 think/thinking，还有推理模型常用的 thought、reflection，
 * 以及某些国产模型用的全角括号形式 ◁think▷。
 *
 * 两种情况都要管：
 *  - 成对出现  <think>…</think>   → 整段删掉
 *  - 只有开标签（输出被截断，闭合标签还没写出来）→ 从开标签删到结尾
 */
const THINK_TAGS = ['think', 'thinking', 'thought', 'reasoning', 'reflection']

export function stripThinking(text: string): string {
  let out = String(text || '')
  for (const tag of THINK_TAGS) {
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi'), '')
    // 没闭合的开标签：后面全是思考，一并去掉
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*$`, 'i'), '')
  }
  // ◁think▷…◁/think▷ 这种全角变体
  out = out.replace(/◁think▷[\s\S]*?◁\/think▷/gi, '')
  out = out.replace(/◁think▷[\s\S]*$/i, '')
  return out.trim()
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

/** 关闭思考的参数集。各家名字不一样，一次都带上，认哪个算哪个 */
const NO_THINK_PARAMS = {
  reasoning_effort: 'none',
  enable_thinking: false,
  thinking: { type: 'disabled' },
  reasoning: { exclude: true },
  chat_template_kwargs: { enable_thinking: false }
} as const

/**
 * 服务端拒收过这些参数就别再发了。
 *
 * 多数 OpenAI 兼容实现会忽略不认识的字段，但有严格校验的会直接 400。
 * 撞过一次就记下来，本次会话内后续请求都不带 —— 否则每次都要白撞一回。
 */
let noThinkRejected = false

async function askOpenAiCompatible(
  prompt: string,
  system?: string,
  timeoutMs = 60_000,
  maxTokens = 4000,
  heavy = false,
  jsonOnly = false
): Promise<string> {
  /**
   * 带着"别思考"的参数发一次；服务端要是嫌弃这些字段（400），
   * 记下来、脱掉再发一次。这样严格的服务商也能正常用，
   * 宽松的（绝大多数）则一直享受"根本不产生思维链"的好处。
   */
  try {
    return await sendChat(prompt, system, timeoutMs, maxTokens, heavy, jsonOnly)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const looksLikeBadParam = /\b400\b|invalid|unsupported|unrecognized|unknown field|extra fields/i.test(msg)
    if (!jsonOnly || noThinkRejected || !looksLikeBadParam) throw e
    console.warn('[AI] 服务端不接受关闭思考的参数，脱掉重发一次：', msg)
    noThinkRejected = true
    return await sendChat(prompt, system, timeoutMs, maxTokens, heavy, jsonOnly)
  }
}

async function sendChat(
  prompt: string,
  system: string | undefined,
  timeoutMs: number,
  maxTokens: number,
  heavy: boolean,
  jsonOnly: boolean
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

      /**
       * 要结构化输出时，直接告诉服务端「别思考」。
       *
       * 这是之前一直漏掉的一条，也是 SillyTavern 那类项目处理推理模型的第一手段：
       * 与其在回复里跟思维链搏斗，不如从源头关掉它。
       * 各家参数名不统一，所以一次把常见的几种都带上 ——
       * OpenAI 兼容接口对不认识的字段一般是忽略，带上不会出错；
       * 万一某家严格校验报了 400，callViaProxy 那边会把错误带回来，
       * 到时候看错误信息里提到哪个字段，去掉那个就是。
       *
       *   reasoning_effort   OpenAI o 系列 / 多数中转站，'none' 或 'low'
       *   enable_thinking    Qwen、智谱等国产模型
       *   thinking           Anthropic 风格（经中转转发时也认）
       *   reasoning.exclude  OpenRouter：思考照跑但不返回
       *   chat_template_kwargs  vLLM / SGLang 自部署的开源模型
       *
       * 只在 jsonOnly 时发。普通对话时思考是有价值的，不该一刀切关掉。
       */
      ...(jsonOnly && !noThinkRejected ? NO_THINK_PARAMS : {}),

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
  const finishReason = choice?.finish_reason || ''

  /**
   * **先看有没有被截断，再看拿到了什么。**
   *
   * 这是之前处理得最不对的一处：finish_reason 的判断被放在最后，
   * 只有 content 和 reasoning 都空时才看得到。可推理模型的典型失败是
   * 「思考写了一大半、配额用光、JSON 一个字还没开始写」——
   * 这时 reasoning 是有内容的，于是走进 reasoning 分支、捞不到 JSON，
   * 报出来的却是"这个模型只输出了思考过程"。
   * 用户看到的是"模型不行"，真实原因是**我们给的 max_tokens 不够**。
   *
   * 思考本身要算输出 token，一次推理花掉几千是常事。
   * 所以截断时不该放弃，该带着更大的配额重来一次。
   */
  const truncated = finishReason === 'length'

  const content = stripThinking(m.content || '')
  if (content) {
    /**
     * 正文里也可能夹着一大段推理（没有 <think> 标签、就直接写在正文里）。
     * 要 JSON 的时候先试着把 JSON 主体捞出来，捞到就只交这一段，
     * 剩下的废话不必带给上层去解析。捞不到就原样交出去 ——
     * 上层还有自己的一套提取，别在这里把好数据掐掉。
     */
    if (jsonOnly) {
      const salvaged = salvageJson(content)
      if (salvaged) return salvaged
    }
    return content
  }

  const reasoning = (m.reasoning_content || m.reasoning || '').trim()
  if (reasoning) {
    /**
     * 正文空、只有思考时，**先从思考里把 JSON 捞出来**，别直接放弃。
     *
     * 上一版我在这里直接抛错"这个模型做不了结构化输出"—— 太武断了。
     * 带思考的模型经常是「推理一大段，末尾把答案写出来」，
     * 答案就埋在 reasoning 里，捞出来完全能用（试跑那条路就是这么过的）。
     * 真正该丢掉的是推理那部分文字，不是整个回复。
     *
     * 捞不到才报错，那时候才是真的没有答案。
     */
    if (jsonOnly) {
      const salvaged = salvageJson(reasoning)
      if (salvaged) return salvaged
      if (truncated) throw new TruncatedError(maxTokens)
      throw new AiError(
        '模型这次只输出了思考过程，里面找不到 JSON。' +
        '可以换一个不带思考过程的普通对话模型，或把每批处理的数量调小。'
      )
    }
    return reasoning
  }

  if (truncated) throw new TruncatedError(maxTokens)

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
