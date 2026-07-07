import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['harness/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['harness/setup.ts'],
    globals: true,
  },
})
