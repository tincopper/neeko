# 执行计划：清理 .catch(() => {}) 静态吞错

> 遵循 TDD。任务激活：`python3 ./.trellis/scripts/task.py start`（review 通过后）。
> 全程不 git commit（归属用户）。

## 阶段 0：前置核对

- [ ] 确认 `reportFrontendError` / `resetFrontendErrorThrottle` 已由前序任务交付
      （当前已存在 `src/app/registerGlobalErrorHandlers.ts:44,54`）。
- [ ] 基线：`pnpm lint:fe`、`pnpm type-check`、`pnpm test:run` 绿。
- [ ] `rg "\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}" src` 当前计数 47，作为改造基线。

## 阶段 1：下沉上报器到 shared（前置重构）

1. 新建 `src/shared/utils/errorReporting.ts`：
   - 迁移 `reportFrontendError` / `resetFrontendErrorThrottle` + 节流 `lastReportAt`。
   - 内部持有 invoke `log_frontend_error`（`eslint-disable-next-line no-restricted-imports`
     方式，参考 `fileAsset.ts`），CONST：`THROTTLE_MS`、`MAX_MESSAGE_LENGTH`。
2. `src/app/registerGlobalErrorHandlers.ts`：
   - 移除本地实现，改为 `import { reportFrontendError, resetFrontendErrorThrottle } from '@/shared/utils/errorReporting'` 后原样 re-export，同时保留 `registerGlobalErrorHandlers` 本体。
3. `src/app/api/errorApi.ts`：
   - 若 `logFrontendError` 已无业务消费者，改为 re-export（保持 `registerGlobalErrorHandlers.test.ts` 的 mock 路径 `@/app/api/errorApi` 不变）；或确认后可删除并同步改测试。
4. `src/app/components/ErrorBoundary.tsx` 保持 `@/app/registerGlobalErrorHandlers` 导入不变（re-export 兼容）。
5. 运行既有相关测试（`registerGlobalErrorHandlers.test.ts`、`ErrorBoundary.test.tsx`）确认迁移零破坏。TDD：先写/保留测试，迁移后绿。

## 阶段 2：逐文件改造（非豁免 47 处）

按 prd.md R1 清单逐文件处理。每文件：
- 非豁免 `.catch(() => {})` → 注入 `reportFrontendError('<feature>.<op>', err)` 或轻量消息。
- 豁免项（见 design.md §4）→ 加 `// 静默豁免：...` 注释。
- 引入 `import { reportFrontendError } from '@/shared/utils/errorReporting'`（按 import/order 排序）。

分批提交式推进（不 commit，仅按模块归档 diff）：
- 批次 1：terminal 三件套（`terminalCache`7、`TerminalViewBase`5、`terminalCommands`2）——含豁免。
- 批次 2：session（`useSessionBootstrap`5、`useSessionPersistence`1）+ project（`useWorktreeActions`2、`WorktreeList`1、`onboardingApi`1、`ProjectPanel`1）。
- 批次 3：browser（`useBrowserPanel`5、`useBrowserPicker`1）+ editor（`usePaneAgents`1）+ search（`searchStore`1）。
- 批次 4：git（`GitDialog`2、`GitCommitPanel`1、`CommitDialog`1、`PullRequestsPanel`2、`PRFilesChangedPanel`1、`BranchSwitcherPanel`1——剪贴板豁免）。
- 批次 5：其余（`useFullscreen`3、`taskStore`2、`skill/bindProjectTagGroups`1）。

## 阶段 3：验证

- [ ] `rg "\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}" src` 仅剩豁免 + 上报链路豁免。
- [ ] `pnpm lint:fe`、`pnpm type-check`、`pnpm test:run` 全绿。
- [ ] 抽查 2-3 个改动文件：成功路径行为不变，catch 触发时调用 `reportFrontendError`（补少量组件/hook 断言）。
- [ ] 更新 spec（如 `mock-strategies.md` / `quality-guidelines.md` 已有豁免打标，确认覆盖本任务新增承诺）。

## Review Gates

1. 无新增 `.catch(() => {})`（除上报链路豁免）。
2. 非豁免项全部上报可追踪。
3. 未破坏 import 防火墙；feature 侧统一从 `shared/utils/errorReporting` 导入。
4. 成功路径行为零变化。
5. 前序任务文件（`registerGlobalErrorHandlers`/`errorApi`）re-export 兼容，既有测试不破坏。
