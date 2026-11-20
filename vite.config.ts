import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 相对路径：打包成桌面 exe 后用 file:// 直接加载，绝对路径会指到 C:\assets 去
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: false,
  },
})
