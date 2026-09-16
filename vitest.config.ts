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
      /**
       * 覆盖率闸门（分层，见 AGENTS.md「测试覆盖率要求」）。
       *
       * ① 全局 = **回归地板**：整体尚未达到 80% 目标（实测 stmts 55.6 / branch 48.9 /
       *    funcs 49.4 / lines 56.7），因此先把「不许回退」钉住（留 ~1.5pt 余量，避免无关
       *    文件的正常抖动误伤）；目标值 80 是全仓拉齐时的终点，不是今天的地板。
       * ② 本次改造涉及的模块 = **按策略线抬到实测水平**：纯函数 100%（仓库红线），
       *    机制/策略层 ≥80%。新增模块若被改造，应同步把该文件加进下面的列表。
       *
       * 注意：glob 必须能匹配到实际被测量的文件，否则该条目等于空转 —— 数值一律贴着实测
       * 值取整，任何下调都应在 PR 中说明理由。**新加条目必须体检**：把该条目的四个数值
       * 临时设成 `101` 跑一次，能按**文件名**报出该文件的 ERROR 才算条目生效（空转会静默通过）。
       * 本切片新增的 `fileRef.ts` / `stopLocation.ts` 两个条目均已如此复验过。
       * 全局阈值按**本次测量到的文件**计算，因此 `vitest run --coverage <子集>` 必然
       * 因只测了少量文件而失败 —— 该地板只对全量 `pnpm test:coverage` 有意义。
       */
      thresholds: {
        statements: 54,
        branches: 47,
        functions: 48,
        lines: 55,

        // 纯函数 / 唯一构造点：仓库要求 100%
        '**/runner/stackFrames.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        '**/runner/stopLocation.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        '**/runner/store/debug/stopGeneration.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // #14 门控的唯一实现（纯函数）
        '**/runner/sessionVisibility.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        '**/runner/hooks/useStopLocation.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 机制 / 策略层：关键路径覆盖，≥80%
        '**/runner/sourceOpen.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        '**/runner/sourceTab.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        '**/runner/navigate.ts': {
          lines: 100,
          statements: 85,
          functions: 100,
          branches: 80,
        },
        '**/editor/stopMatch.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 身份所有者（纯函数，被本切片扩展）：lines 实测 100；statements/branches 的缺口
        // 来自 jdt/LSP 解析的既有多分支（134/176/260/275，非本切片引入），故按实测地板钉住。
        '**/shared/utils/fileRef.ts': {
          lines: 100,
          statements: 98,
          functions: 100,
          branches: 95,
        },
        '**/editor/hooks/useDebugStopReveal.ts': {
          lines: 100,
          statements: 90,
          functions: 100,
          branches: 80,
        },
        // 组合装配层（F8 抽取后为独立模块；此前 0%）：由 FileEditor 组合冒烟测试覆盖。
        // `useFileEditorLsp` 一次渲染即全覆盖，故按「实测 100、分支留 10pt 余量」取值。
        '**/editor/hooks/useFileEditorLsp.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 90,
        },
        // 组件只门控「行 / 语句」（实测 95.23 / 90.9）：**分支与函数不设阈值** ——
        // 剩余未覆盖是「作为 props 传递但未被调用的内联回调」（其行为归属各自 hook / 子组件的测试），
        // 给它们设 <80 的阈值等于把低标准写进配置。
        '**/editor/components/FileEditor.tsx': {
          lines: 90,
          statements: 85,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
