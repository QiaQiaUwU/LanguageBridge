let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist')
      const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })()
  }
  return pdfjsPromise
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}超时：这份文档可能过大或内部结构过于复杂（比如被反复编辑很多年、格式碎片很多），建议另存成更简单的格式后再试，或者直接复制文字用"粘贴导入"`)), ms)
    })
  ])
}

export function stripHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('script,style,nav,footer,header,aside').forEach(el => el.remove())
  const main = div.querySelector('article,main,.content,.article,.post,#content')
  return (main?.textContent || div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await withTimeout(mammoth.extractRawText({ arrayBuffer }), 30000, 'docx 文本提取')
  return result.value
}

export async function extractDocxSections(file: File): Promise<{ title: string; text: string }[] | null> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await withTimeout(mammoth.convertToHtml({ arrayBuffer }), 15000, '章节结构识别')
  const div = document.createElement('div')
  div.innerHTML = result.value

  const isWhollyBold = (el: Element): boolean => {
    const total = (el.textContent || '').replace(/\s+/g, '')
    if (!total) return false
    const bold = Array.from(el.querySelectorAll('strong, b'))
      .map(n => n.textContent || '')
      .join('')
      .replace(/\s+/g, '')
    return bold === total
  }
  const isHeadingLike = (el: Element): boolean => /^h[1-6]$/i.test(el.tagName) || isWhollyBold(el)
  const looksLikeHeading = (text: string): boolean =>
    text.length >= 2 && text.length <= 14 && !/^\d/.test(text)

  const sections: { title: string; text: string }[] = []
  let current: { title: string; parts: string[] } | null = null
  for (const el of Array.from(div.children)) {
    const text = (el.textContent || '').trim()
    if (!text) continue
    if (isHeadingLike(el) && looksLikeHeading(text)) {
      if (current && current.parts.join('').trim().length >= 30) {
        sections.push({ title: current.title, text: current.parts.join('\n') })
      }
      current = { title: text, parts: [] }
    } else if (current) {
      current.parts.push(text)
    }
  }
  if (current && current.parts.join('').trim().length >= 30) {
    sections.push({ title: current.title, text: current.parts.join('\n') })
  }
  return sections.length >= 3 ? sections : null
}

async function extractPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdfjsLib = await loadPdfjs()
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const lines: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let lastY: number | null = null
    let line = ''
    for (const item of content.items as any[]) {
      const y = item.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line)
        line = ''
      }
      line += item.str
      lastY = y
    }
    if (line) lines.push(line)
    lines.push('') // 分页留空行
  }
  return lines.join('\n')
}

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'docx') return extractDocx(file)
  if (ext === 'pdf') return extractPdf(file)
  if (ext === 'html' || ext === 'htm') return stripHtml(await file.text())
  return file.text()
}

export const SUPPORTED_IMPORT_EXTS = '.txt,.csv,.json,.md,.docx,.pdf'
export const SUPPORTED_ARTICLE_EXTS = '.txt,.md,.html,.docx,.pdf'
