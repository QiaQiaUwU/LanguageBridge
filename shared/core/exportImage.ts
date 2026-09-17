/**
 * 把一个 DOM 节点导出成 PNG。
 * 做法：克隆节点，把计算后的样式逐个内联（CSS 变量这时已经解析成具体颜色），
 * 放进 <svg><foreignObject>，画到 canvas 上。
 * 不引第三方库；页面里没有跨域图片，所以不会被 canvas 污染。
 */
const PROPS = [
  'display', 'position', 'top', 'left', 'right', 'bottom', 'box-sizing', 'width', 'height', 'min-width', 'max-width',
  'margin', 'padding', 'border', 'border-radius', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'background', 'background-color', 'background-image', 'color', 'opacity', 'box-shadow',
  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration', 'text-decoration-style', 'text-transform', 'white-space', 'word-break', 'overflow-wrap', 'vertical-align',
  'flex', 'flex-direction', 'flex-wrap', 'align-items', 'align-self', 'justify-content', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-column', 'transform', 'overflow',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-variant-numeric'
]

function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src)
  const parts: string[] = []
  for (const p of PROPS) {
    const v = cs.getPropertyValue(p)
    if (v) parts.push(`${p}:${v}`)
  }
  ;(dst as HTMLElement).setAttribute('style', parts.join(';'))
  // 去掉动画，导出的是静态图
  ;(dst as HTMLElement).style.animation = 'none'
  ;(dst as HTMLElement).style.transition = 'none'
  const sc = src.children, dc = dst.children
  for (let i = 0; i < sc.length; i++) if (dc[i]) inlineStyles(sc[i], dc[i])
}

export async function nodeToPngBlob(el: HTMLElement, scale = 2, background?: string): Promise<Blob> {
  // 用排版尺寸而不是屏幕尺寸：被缩放过的导图也按原大导出
  const w = Math.ceil(Math.max(el.offsetWidth, el.scrollWidth))
  const h = Math.ceil(Math.max(el.offsetHeight, el.scrollHeight))
  const clone = el.cloneNode(true) as HTMLElement
  inlineStyles(el, clone)
  clone.style.transform = 'none'
  clone.style.position = 'static'
  clone.style.width = w + 'px'
  clone.style.height = h + 'px'
  clone.style.overflow = 'visible'
  clone.style.margin = '0'
  // 交互按钮不进图
  clone.querySelectorAll('[data-export-hide]').forEach(n => n.remove())
  const bg = background || getComputedStyle(document.body).backgroundColor || '#fff'
  const xhtml = new XMLSerializer().serializeToString(clone)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="background:${bg};width:${w}px;height:${h}px">${xhtml}</div>` +
    `</foreignObject></svg>`
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('渲染失败')); img.src = url })
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0)
  return await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('导出失败'))), 'image/png'))
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function exportNodeAsPng(el: HTMLElement, name: string) {
  const blob = await nodeToPngBlob(el)
  downloadBlob(blob, name.endsWith('.png') ? name : `${name}.png`)
}
