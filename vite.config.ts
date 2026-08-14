import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

function aiProxyPlugin() {
  return {
    name: 'ai-proxy',
    configureServer(server: any) {
      server.middlewares.use('/__ai_proxy', (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (chunk: any) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
        req.on('end', async () => {
          const ac = new AbortController()
          req.on('aborted', () => ac.abort())
          res.on('close', () => { if (!res.writableEnded) ac.abort() })
          try {
            const body = Buffer.concat(chunks).toString('utf8')
            const { url, method, headers, payload } = JSON.parse(body)
            const reqMethod = method === 'GET' ? 'GET' : 'POST'
            const upstream = await fetch(url, {
              method: reqMethod,
              headers: headers || {},
              body: reqMethod === 'GET' ? undefined : JSON.stringify(payload),
              signal: ac.signal
            })
            const text = await upstream.text()
            if (res.writableEnded) return
            res.statusCode = upstream.status
            res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8')
            res.end(text)
          } catch (e) {
            if (ac.signal.aborted || res.writableEnded) return
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ __proxyError: e instanceof Error ? e.message : String(e) }))
          }
        })
      })
      server.middlewares.use('/__serverinfo', async (req: any, res: any) => {
        const os = await import('node:os')
        const nets = os.networkInterfaces()
        let ip = '127.0.0.1'
        for (const name of Object.keys(nets)) {
          if (/^(vEthernet|VMware|VirtualBox|Loopback|docker|veth)/i.test(name)) continue
          for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) { ip = net.address; break }
          }
          if (ip !== '127.0.0.1') break
        }
        const port = server.config.server.port || 3000
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ lan_url: `http://${ip}:${port}/`, ip, port }))
      })
    }
  }
}

export default defineConfig({
  server: {
    port: 3000,
    host: true, // 监听 0.0.0.0，允许局域网内其它设备（手机/平板）访问
  },

  base: './',

  plugins: [
    vue(),
    aiProxyPlugin()
  ],

  resolve: {
    dedupe: ['three'],
    alias: [
      { find: '@', replacement: resolve(__dirname, '.') },
      { find: '@shared', replacement: resolve(__dirname, './shared') },
      { find: '@apps', replacement: resolve(__dirname, './apps') },
      { find: '@src', replacement: resolve(__dirname, './src') }
    ]
  },

  build: {
    target: 'es2020',
    emptyOutDir: true,
    sourcemap: false,

    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          graph: ['3d-force-graph'],
          vue: ['vue', 'vue-router', 'pinia'],
          pdf: ['pdfjs-dist'],
          docx: ['mammoth']
        }
      },
      maxParallelFileOps: 2
    }
  },

  optimizeDeps: {
    include: ['vue', 'vue-router', 'pinia']
  }
})
