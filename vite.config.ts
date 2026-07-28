// vite.config.ts
// ========================================
// Rain Vite 入口配置（Task 1）
// ========================================

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(() => {
  const e2eEntry = process.env.RAIN_E2E_BUILD === '1'
    ? './src/e2e/enabled-entry.tsx'
    : './src/e2e/entry.tsx'

  return {
    plugins: [react()],
    base: './',
    resolve: {
      alias: {
        '@/e2e/entry': resolve(__dirname, e2eEntry),
        '@': resolve(__dirname, './src'),
      },
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
    },
    build: {
      target: 'es2021',
      minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
      sourcemap: !!process.env.TAURI_DEBUG,
    },
  }
})
