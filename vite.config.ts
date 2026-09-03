import path from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  /**
   * 强制启动期预打包 xterm 系依赖（design D7.2 根治 "Importing a module
   * script failed."）：applyRenderer 走 `import('@xterm/addon-canvas' /
   * '@xterm/addon-webgl')` 动态导入。若不在 include 里，Vite 只在**首次发现**
   * 时才按需 optimize —— dev server 长时间运行后（.vite 缓存被清 / 依赖版本
   * 变更 / optimizer 状态失效），运行中重载页面触发动态导入会拿到 504
   * Outdated Optimize Dep，WebKit 表现即 "Importing a module script failed."，
   * 终端因此停在 DOM renderer（实测 2026-09-03）。include 声明后 dep
   * optimization 在 server 启动时确定性完成，与运行期发现时序彻底解耦。
   * @xterm/xterm 与 fit/unicode11 是静态导入本就会被扫到，一并显式声明保持
   * 同批 browserHash，避免两批 optimize 产物交错。
   */
  optimizeDeps: {
    include: [
      '@xterm/xterm',
      '@xterm/addon-fit',
      '@xterm/addon-unicode11',
      '@xterm/addon-canvas',
      '@xterm/addon-webgl',
    ],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/.*/**'],
    },
  },
  build: {
    target: 'chrome110',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-unicode11'],
          highlight: ['highlight.js/lib/core'],
          lucide: ['lucide-react'],
          mermaid: ['mermaid'],
          codemirror: [
            '@codemirror/autocomplete',
            '@codemirror/commands',
            '@codemirror/language',
            '@codemirror/state',
            '@codemirror/view',
            '@lezer/highlight',
            '@uiw/codemirror-themes',
            '@uiw/react-codemirror',
          ],
        },
      },
    },
  },
}));
