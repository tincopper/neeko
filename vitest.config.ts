import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/testing/setup.ts'],
    include: ['src/**/__tests__/*.{test,spec}.{ts,tsx}'],
    /**
     * 限制并发 worker 数（默认 ≈ 核数-1）。每个 jsdom worker 冷启动 40s+
     * （transform + setup + environment），且共享主进程的 setup/transform
     * 管道会互相拖慢：10 核机默认 9 并发时 13 个文件全部 "Timeout waiting
     * for worker to respond"（0 tests）；4 并发仍挂 8/13。2 并发实测稳定
     * （147 tests 全绿）。数值再低只影响总时长，不再影响成功率。
     */
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/app/main.tsx',
        'src/vite-env.d.ts',
        '**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
