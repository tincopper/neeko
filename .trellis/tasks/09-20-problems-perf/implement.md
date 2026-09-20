# 实施计划：P1 发布合并 → P2 折叠懒渲染 → P3 行 memo

> 契约依据：prd.md。单关注点性能修复，design 并入本计划（方案已在规划轮确定）。

## P1 发布合并（`lsp/store/lspStore.ts:367` 监听处）

1. **Red**：单测"200 个 uri 突发 publish → 订阅回调重渲染次数 ≤ 3"（先失败：现状 N 次）。
2. **Green**：监听回调内收敛到 microtask 批量 `set`（待处理 `{uri → diagnostics}` 表 +
   单次 flush；`setProjectDiagnostics` 单写点不动，语义仍整体替换）。
3. 注意：flush 时机用 `queueMicrotask`，测试用 `await Promise.resolve()`/fake timers；
   卸载时清 pending（对称释放已有 `safeUnlisten`，加 flush 兜底）。

## P2 默认折叠 + 行懒渲染（`lsp/components/DiagnosticsPanel.tsx`）

1. **Red**：单测"30 个文件组默认折叠且零行渲染；点击展开后行出现"（先失败）。
2. **Green**：组数超阈值（`COLLAPSED_GROUP_THRESHOLD = 20`，常量就近定义）默认折叠；
   折叠组不渲染行容器；`languageId` 按组算一次经 props 传行（删行内
   `getLspLanguageId(fromFileUri(...))` 重算）。
3. 阈值以下保持现状默认展开（小项目零行为变化）。

## P3 行 memo 化

1. **Red**：单测"无关 uri publish 后已渲染行不重渲染"（`renderCount` 断言，先失败）。
2. **Green**：诊断行抽 `React.memo` 组件（props：`diagnostic`、`uri`、`projectPath`、
   `languageId`、`onJump` 稳定回调经 `useCallback`）；`DiagnosticQuickFix` props 不变。
3. 行 `key` 保持现状（key 碰撞属已知小问题，不扩范围）。

## 门禁

- 每步：相关 vitest + `pnpm type-check`；收尾：`pnpm test:run` 相关域 + eslint 触及文件。
- 回滚点：每步独立提交可 revert；P1 flush 逻辑失败即回退直写（行为等价，性能回落）。

## 落地（2026-09-20，TDD 红绿留痕）

- P1：`lspStore.subscribeToProject` 内 `pendingDiag` 表 + `queueMicrotask` 单次 flush（会话边界
  清缓冲、卸载同步 flush 兜底）；`lspDiagnosticsBurst.test.ts`（200 uri ≤ 3 通知 / 同 uri 覆盖）；
  既有 `lspStore.test.ts` 订阅测试补 await flush。
- P2：`DiagnosticsPanel` 组数 >20 默认折叠（折叠组零行渲染）；`languageId` 按组算一次传入。
- P3：`DiagnosticRow.tsx`（`React.memo`，props 全稳定引用 + `onJump` useCallback）；
  `DiagnosticsPanel.perf.test.tsx`（30 组默认折叠/20 组默认展开/无关 publish 行不重渲染）。
- 门禁：lsp 域 360 passed + 全量 lsp/settings 423 passed，tsc/eslint 全绿。
