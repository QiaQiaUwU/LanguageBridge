import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// 共享基础配置
export default defineConfig({
  // 模块化结构
  server: {
    port: 3000,
    fs: {
      allow: ['../../']
    }
  },

  // 每个模块有独立的base
  base: './',

  // 插件列表
  plugins: [
    vue()
  ],

  // 共享路径别名
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '@shared', replacement: resolve(__dirname, './shared') }
    ]
  },

  // 构建配置
  build: {
    target: 'es2020',
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV === 'development'
  }
})
