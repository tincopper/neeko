# Design — 架构债务清理

## 0. 背景

neeko-check 15 支柱审计遗留：
- `useAppShell.ts` **455 行**（Warning：god hook，建议拆 useAppProviders / useAppModals / useAppLayout 三组）
- `ProjectWorkspace.tsx` **432 行**（Warning：组件 > 300 行红线）
- dock wrappers 深导入（Nit，**上一任务已修**）；本任务将审计**全库**深导入

## 1. 拆分原则

- **副作用类** → 抽为 hook（接受依赖输入，内部 useEffect/useCallback/useMemo/useRef）
- **纯数据/字符串逻辑** → 抽为纯函数（无 store 读写的副作用，可 100% 单测）
- **保持 hook 顺序等价**：抽出单元在组件内无条件调用、位置不变，effect 注册顺序不变
- 每抽一个单元：写测试（Red）→ 实现（Green）→ 接入 → 回归，再抽下一个

## 2. useAppShell 拆分方案（455 → 目标 ≤ 300）

抽出 4 个单职责 hook，`useAppShell` 退化为「数据编排 + 装配」组合器：

| 新 hook | 职责 | 行为要点 |
| --- | --- | --- |
| `useAppGlobalEffects` | 应用级全局副作用 | menuPaste / quick-open 跟踪 / 启动时 skills→appView 同步（原第 54-66 行） |
| `useAppInitialGitRefresh` | 启动后 WSL/远程缺失 git_info 项目补刷新（仅一次） | 内部 ref 守卫（原第 236-251 行） |
| `useAppStoreSync` | 视图态+动作引用写回 projectStore | `isTerminalView \|\| isActiveWorktree(path)`（原第 262-276 行） |
| `useAppEntryAddRefresh` | 新增 WSL/远程连接后 git 补刷新 | wsl/remote 各一回调（原第 410-430 行） |

装配段（context value / appProviders / appModals）仍留在 useAppShell —— 它们与 shell 数据强耦合，抽纯 builder 收益低于类型管道成本，本轮不抽（YAGNI）。

## 3. ProjectWorkspace 拆分方案（432 → 目标 ≤ 300）

| 新单元 | 类型 | 职责 |
| --- | --- | --- |
| `useProjectAgents` | hook | agent 安装状态缓存/校验 + 点击门控（toast 拦截） |
| `useTerminalTabs` | hook | 普通终端 Tab / 指定 agent 终端 Tab 创建+激活（含 10 个上限） |
| `useRemoteProjectSession` | hook | 远程会话派生：needsRemoteAuth / remoteProjectProp / 凭据动作 |
| `buildLayoutId` | 纯函数 `src/app/utils/layoutId.ts` | 布局持久化 key（local/wsl/remote/none 前缀） |

## 4. 全库深导入→门面标准化方案

1. 审计：`grep '@/features/<f>/components|hooks|utils|contexts/' src/`，排除白名单 `api/` `store/` `types/`
2. 对每条深导：
   - feature 门面已有该符号 → 直接改门面导入
   - 门面缺该符号且属「公开组件/hooks/utils」→ 补门面导出后再改
   - 内部实现（非公开、同 feature 内部除外）→ 记录到 implement.md，不强行导出
3. 上下文（context）归类：feature 内 context 若被跨 feature 消费，统一从 feature 门面（或 shared/contexts）导出
4. 改完后 eslint / type-check / 全量测试回归

## 5. 进度（如实记录，含流程修正说明）

> ⚠️ 流程修正：本任务在 prd.md/design.md 落盘前已误入实现阶段（useAppShell / ProjectWorkspace 两个拆分已完成并本地全绿）。现补写 PRD/Design 作为方法论文档；**深导入标准化（第 4 节）尚未开始**，将严格按「先方案后代码」执行。

已完成（本地已通过，未提交）：
- [x] useAppShell 4 个 hook 抽出 + 接入 + 14 个新测试（useAppGlobalEffects 3 / useAppStoreSync 3 / useAppEntryAddRefresh 4 / useAppInitialGitRefresh 4）
- [x] ProjectWorkspace 4 个单元抽出 + 接入 + 13 个新测试（useProjectAgents 4 / useTerminalTabs 4 / useRemoteProjectSession 5 / buildLayoutId 4）
- [x] `app/hooks/index.ts` 门面补充导出
- [x] eslint / type-check 通过；全量 `pnpm test:run` 尚未跑完（被流程中断）

待完成：
- [x] ~~全库深导入审计 + 修复（第 4 节）~~ → **已完成（2026-08-14 续做）**：47 处跨 feature 深导入改门面；补门面导出 `useFileDrop`（file）、`CommitDialog`（git）、`ConnectionProjectContextValue`（project）；default 导入改命名导入；lazy 改 `.then((m) => ({ default: m.X }))`；`shared/` 反向引用（useKeyboardShortcuts / editorStore）保持 pre-existing 豁免（门面化会触发循环依赖 + restricted-paths）
- [x] ~~`pnpm lint:fe` 全量 + `pnpm test:run` 全量 + `cargo test` 回归~~ → **已完成**：lint:fe 全绿（eslint 0 错误 / tsc 无错误 / vitest typecheck），test:run 198 文件 1687 通过 1 skipped，cargo test 通过
- [x] ~~spec 同步 + 收尾~~ → spec 已同步（quality-guidelines 新增「禁止跨 feature 深导入」条款；directory-structure 更新 app/hooks 说明）；task 收尾状态见 task.json
- [x] **useAppShell ≤300 补充**：装配段抽出 `buildAppShellValues`（纯函数，8 个测试）+ 数据编排抽 `useAppShellData`（hook 顺序等价）；useAppShell.ts 455 → **30 行**

补充说明（本次续做）：
- useAppShell 最终结构：`useAppShell`（30 行薄组合器）= `useAppGlobalEffects` + `useAppShellData`（数据编排组合器，379 行）+ `buildAppShellValues`（纯装配，297 行）
- 审计口径：`store/` `types/` `api/` 白名单可直导；`export type` 类型导入豁免；同 feature 内部直导合规；`shared/`→features 反向引用豁免

## 6. 风险与回滚

- 纯重构，无 API 变更；回归以全量测试 + type-check 为准。
- 深导入标准化可能触及大量文件；每改一批跑一次 eslint + 相关 feature 测试，避免长链条无验证。
- 如遇行为漂移（diff 语义不完整），立即回退该单元，先补测试再重试。
