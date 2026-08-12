# 技术设计：清理 .catch(() => {}) 静态吞错 → 接入 reportFrontendError

## 1. 目标边界

- 纯前端机械改造：把 `features/` 中 16 个文件 47 处 `.catch(() => {})`
  改为可感知上报，或加豁免注释。
- 不改变成功路径、不改变 Promise 链返回值语义。
- 依赖已有 `reportFrontendError`（前序任务已在 `registerGlobalErrorHandlers.ts`
  提供，`src/app/registerGlobalErrorHandlers.ts:54`）。

## 2. 架构约束（关键）

`import/no-restricted-paths` 防火墙（`.eslintrc.cjs`）：
- `app → features` 禁止（composition 层不得反向依赖 feature 实现，仅允许 `./app/editor`）。
- `features → layout` 禁止。
- **features 间禁止互引**（仅 index/store/types 门面）。
- `shared/*` 是跨域公共层，`features` 与 `app` 均可消费。

**遗留难点**：`reportFrontendError` 当前位于 `src/app/registerGlobalErrorHandlers.ts`
（app 层）。若 16 个 feature 文件直接 `import { reportFrontendError } from '@/app/...'`，
会造成 feature → app 的反向依赖，虽未被当前 zone 显式拦截，但违背「shared 为跨域公共家」
的架构语义，且会把这些文件从"可独立测试/复用"变成"依赖 app 组合层"。

### 决策：将上报器下沉到 `src/shared/utils/errorReporting.ts`

把 `reportFrontendError` / `resetFrontendErrorThrottle` 及节流状态**迁移**到
`src/shared/utils/errorReporting.ts`（该目录已有 `fileAsset.ts` 用
`eslint-disable-next-line no-restricted-imports` 托管 IPC 入口的先例）。

- `src/app/registerGlobalErrorHandlers.ts` 改为 `export { reportFrontendError, resetFrontendErrorThrottle } from '@/shared/utils/errorReporting'` 
  再 `export *` 或直接 re-export，保持既有调用方（`ErrorBoundary.tsx`、
  既有测试）零改动。
- 16 个 feature 文件统一 `import { reportFrontendError } from '@/shared/utils/errorReporting'`。
- `errorReporting.ts` 内部持有 IPC 调用（复用 `errorApi.logFrontendError`
  —— 但 shared 不得依赖 app/api）。

#### IPC 访问：shared 不宜依赖 app/api
将 `logFrontendError` 的 invoke 一并下沉到 `src/shared/utils/errorReporting.ts`
内部（`eslint-disable-next-line no-restricted-imports` 的方式，参考 `fileAsset.ts`），
`src/app/api/errorApi.ts` 删除或改为 `export { logFrontendError } from '@/shared/utils/errorReporting'`
re-export 以兼容（若 `errorApi` 无其他消费者则直接删除，需核对）。

> 若担心两处 IPC 入口重复，可用单一事实源：`errorReporting.ts` 是唯一 invoke
> `log_frontend_error` 的地方，`errorApi.ts` 若仍被引用则薄 re-export。

## 3. 单处改造的最小侵入模式

```ts
// 改前
void someApi(x).catch(() => {});

// 改后（能拿到 Error 语义时）
void someApi(x).catch((err) => reportFrontendError('feature.someApi', err));

// 或（纯尽力而为、无需堆栈时，仍上报轻量信息）
void someApi(x).catch(() => {
  reportFrontendError('feature.someApi', 'operation failed');
});
```

- `source` 命名：`<feature>.<operation>`（如 `session.save`、`terminal.resize`、
  `browser.setVisible`），节流按 source 5s 一次，天然防高频刷屏。
- **不**改动 `.catch` 之外的代码；`void promise.catch(...)` 结构保留。

## 4. 豁免清单（保持静默 + 强制注释）

低价值 / 高频 / 用户可感知已另处理，允许静默但必须加注释：

| 位置 | 原因 |
| --- | --- |
| `TerminalViewBase` / `terminalCache` 中 `emit('terminal-input-*', ...)`、高频 `resize` 的 catch | 高频尽力而为，毛刺抖动；上报无意义且节流会挡 |
| `BranchSwitcherPanel` `navigator.clipboard.writeText` | 剪贴板失败浏览器的兜底已静默，用户无感知必要 |
| `reportFrontendError` 内部 invoke 的 catch | 上报链路自身，天然豁免（已有） |

其余非豁免项一律上报。

## 5. 改造清单（47 处，developer 全量覆盖）

见 prd.md R1 文件清单。逐文件：非豁免 → `reportFrontendError`；豁免 → 注释。

## 6. 兼容性 / 回滚

- 纯增量：新增 `shared/utils/errorReporting.ts`，迁移上报函数，feature 侧仅改 catch。
- 回滚：还原 catch 体即可；`shared/utils/errorReporting.ts` 保留无害。
- `errorApi.ts` re-export 兼容，避免破坏前序任务。

## 7. 测试策略

| 层级 | 用例 |
| --- | --- |
| `reportFrontendError`（shared） | 迁移后既有 app 层测试仍绿（re-export 兼容） |
| 组件/hook（改动文件抽查） | 成功路径行为不变；catch 回调被触发时调用 `reportFrontendError`（可对 2-3 个有代表性文件补断言） |
| 静态 | 全仓库 `rg "\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}"` 仅剩豁免/上报链路 |

## 8. 关联

- 上游：`08-12-fix-markdown-link-crash-global-error-guard`（已提供 `reportFrontendError`）。
- 风险：两任务并行改 `app/registerGlobalErrorHandlers.ts` 与 `app/api/errorApi.ts`，需在
  `task.py start` 前确认前一任务已合入/无冲突。
