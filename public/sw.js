// LanguageBridge service worker
//
// 故意写得很"薄"：只注册一个 fetch 监听（PWA 可安装的硬性要求之一），
// 不做激进的离线缓存。原因：每次构建产物文件名都带内容哈希，
// 如果这里缓存了旧版本的 JS/CSS，你更新代码之后浏览器可能还在用缓存的旧文件，
// 出现"明明换了新版本，页面却还是老样子"的诡异 bug——这比装不上 PWA 更麻烦。
// 所以这里所有请求都直接放行走网络，不拦截、不缓存。

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // 故意不调用 event.respondWith()：什么都不做，请求照常走网络，
  // 只是"存在一个 fetch 监听"这件事本身就满足了安装条件。
})
