/**
 * 文章音频：存在后端的 data/media/ 里，跟文章数据放在一起。
 *
 * 为什么不是文件句柄、也不是 IndexedDB：
 *
 *   句柄（原来「选择音频」走的路）存的只是一个指向你磁盘上那个文件的引用。
 *   权限活不过重启，原文件一移动/改名/删除就断，换台电脑更不用说。
 *
 *   IndexedDB blob（原来「视频抽音轨」走的路）文件本身是存住了，但它躺在
 *   浏览器的私有存储里 —— 用文件管理器翻不到、跟着 data/ 一起备份不了、
 *   清一次浏览器数据就没了。而这个项目的文章、词库全都是明明白白的文件。
 *
 * 后端（scripts/dataApi.mjs）本来就有 `/api/media/put-audio` 和
 * `/api/media/file/<name>`，视频抽音轨那条路早就在用这个目录了，
 * 只是「选择音频」一直没接上。现在两条路统一走这里。
 *
 * 存进去之后文章记录上留的是 `audioUrl`（形如 /api/media/file/audio-xxx.mp3），
 * 播放器直接用这个地址，不需要任何授权。
 */

/** 从文件名里取扩展名，交给后端决定落盘用什么后缀 */
function extOf(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName || '')
  return (m ? m[1] : 'wav').toLowerCase()
}

/**
 * 把音频交给后端保存。
 * 成功返回可直接播放的 URL，失败返回 null（调用方自己决定要不要兜底）。
 */
export async function uploadArticleAudio(blob: Blob, fileName: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/media/put-audio?ext=${encodeURIComponent(extOf(fileName))}`, {
      method: 'POST',
      body: blob
    })
    if (!res.ok) return null
    const j = await res.json()
    return typeof j?.url === 'string' ? j.url : null
  } catch {
    // 后端没起来（纯静态方式打开的时候）——调用方会退回 IndexedDB
    return null
  }
}

/** 这个地址还能不能取到文件。用来判断旧记录里的 audioUrl 是不是已经失效 */
export async function audioUrlAlive(url: string): Promise<boolean> {
  if (!url) return false
  if (url.startsWith('blob:') || url.startsWith('data:')) return true
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}
