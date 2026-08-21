/**
 * 悬浮球窗口的 preload。
 * 只暴露三个方法，不把整个 ipcRenderer 交给页面。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lbBall', {
  /** 鼠标是否压在球上：决定这个窗口要不要吃掉点击 */
  setOverBall: over => ipcRenderer.send('ball:mouse', !!over),
  /** 打开主窗口 */
  openApp: () => ipcRenderer.send('ball:open-app'),
  /** 展开/收起时改窗口大小 */
  resize: (w, h) => ipcRenderer.send('ball:resize', w, h),
  /** 长按：打开对话窗口 */
  openChat: () => ipcRenderer.send('ball:open-chat'),
  /** 播放控制转发给主窗口的页面 */
  media: action => ipcRenderer.send('ball:media', action),
  /** 待复习词数变化 */
  onDue: fn => ipcRenderer.on('ball:due', (_e, n) => fn(n)),
  /** 每天一次的复习提醒 */
  onRemind: fn => ipcRenderer.on('ball:remind', (_e, n) => fn(n))
})
