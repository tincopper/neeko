# 重构规划：M3 诊断 QuickFix / AI 动作耦合收敛

> 依据：2026-09-20 neeko-check 只读审查（main 分支 dirty 约 53 路径：M3 codeAction + applyEdit + 诊断 AI 动作 + `interactive_prompt_args`）；`design.md` D1（语言无关）/ D4（白名单）/ §1.6（差异数据化）；`implement.md` M3 续做 1-17。
> 性质：纯重构，不加新行为。所有改动保持对外行为不变，逐项 TDD（先补失败测试 → 最小改 → 重跑门禁）。

## 原则

* 高内聚：终端创建、菜单分组、视图解析各归其域；`lspQuickFix.ts` 只做装配。
* 低耦合 / DIP：lsp 域不直接 import editor 具体实现，只依赖注入的 `EditorViewResolver` / 注册表端口。
* OCP：新增 agent 形态走 `AgentConfig` 数据（`interactive_prompt_args`），不加 `agent.id` 特判（已达成，保持）。
* R5：不引入任何 `language_id == "xxx"` 分支（本次 grep 已确认无，保持）。

## F1 `applyCodeAction` 注入视图解析（DIP，还原 `lspWorkspaceEdit` 的设计）

* 现状：`src/features/lsp/hooks/lspWorkspaceEdit.ts:99` `applyWorkspaceEdit(edit, uri, resolveView)` 已注入；但 `src/features/lsp/api/codeAction.ts:148` `applyCodeAction` 又直接 `import { resolveEditorViewFromUri }`，导致 lsp→editor 硬依赖，与 `useFileEditorLsp.ts:12` 的 editor→lsp 形成双向依赖。
* 目标签名：
  ```ts
  applyCodeAction(uri: string, action: LspCodeAction, resolveView = resolveEditorViewFromUri): boolean
  ```
  默认参数保持调用方零改动；测试传桩。`runAiQuickFixAction` 不动（它走注册表端口，已是 DIP）。
* 测试：`codeAction.test.ts` 新增"传桩 resolver 未打开返回 false / 打开返回 true"，断言不再需要 editorViews 真实现。
* 回滚：默认参数即回滚点；调用方无须改。

## F2 `sendAfterBoot` 收回 terminal 域（消除重复建 tab 知识）

* 现状：`src/features/editor/hooks/useFileEditorState.ts:100` 手造 `Tab{kind:'terminal', taskCommand}`、魔数 `terminalCount >= 10`、`crypto.randomUUID`，绕开 `useTerminalTabs`；hook 同时耦合 agent / project / editorStore / terminal。
* 目标：terminal 域暴露一个创建函数（如 `createTaskTerminal(projectId, agentId, taskCommand): boolean`，配额/ID/排序收敛一处），editor 侧只调它。魔数 10 与命名规则随实现迁移，不在 editor 留第二份。
* 测试：`useFileEditorState.aiAction.test.ts` 改断言到"调用 terminal 端口 + `buildAgentPromptCommand` 输出一致"；配额边界测试归 terminal 域。
* 回滚：保留旧 `sendAfterBoot` 为内联 fallback 一版，确认新端口行为一致后再删。

## F3 `aiActionRegistry` 同文件多 tab 竞态

* 现状：`src/features/editor/api/aiActionRegistry.ts:35` `Map<string, handler>` 按 `tabIdentityOf` 单键；同文件开双 tab 时后挂载覆盖，先卸载 `delete` 会误删存活页的 handler。
* 目标：引用计数或按 tab 实例键区分（`identity → Map<tabKey, handler>` / 计数器），`runAiActionForUri` 取任一存活 handler；`unregister` 只在计数归零时删。保持 `editorViews.ts` 注册表同构（两处要么都改要么都不改，结构不漂移）。
* 测试：registry 单测"注册两个同身份 → 注销一个 → 仍可派发；注销全部 → 返回 false"。
* 回滚：单键 Map 即回滚点。

## F4 Windows shell 选择验证（红线 2，不确定项先验证再改）

* 现状：`src/shared/utils/agentPromptCommand.ts:21` 仅转义单引号；`sendAfterBoot` 的 `taskCommand` 走 PTY 执行。Unix `sh -c` 下成立，Windows `cmd /c` 下单引号转义语义不同。
* 目标：先确认 terminal taskCommand 执行分支已有 `cmd /c` vs `sh -c` 区分（参照 `terminal/mod.rs` task-command 分支）；有则补 Windows 用例（prompt 含空格/引号），无则在 terminal 域补分支，不在 editor/util 侧打补丁。
* 测试：`agentPromptCommand.test.ts` 加含引号 prompt 用例；Windows 分支以 terminal 域测试为准。
* 回滚：不改拼装，只加测试即零风险。

## F5 `lspQuickFix.ts` 拆分 + DEV 探针清理

* 现状：`src/features/lsp/hooks/lspQuickFix.ts:1-675` 集 popup / 菜单 / gutter / 键位于一文件（nav/position 已抽出，方向对但未完成）；`lspQuickFix.ts:645`、`useEditorExtensions.ts:163` 有 `DEV console.info` 探针。
* 目标：按"popup / menu / gutter+keymap"拆 2-3 个模块，`lspQuickFix(ctx)` 只做装配（参照 `useEditorExtensions` 装配模式）；探针删除或降为 `log.debug` 可开关。`DiagnosticsPanel` 196 行现状保持，不动。
* 测试：现有 `lspQuickFix.test.ts` 行为断言不动（拆分后重跑即回归）；探针删除无测试影响。
* 回滚：纯文件搬移，逐文件搬 + 逐次跑 `vitest`，失败即停。

## F6 `workspace/applyEdit` 可观测补齐（小）

* 现状：后端 `server_request.rs:56` 乐观回 `applied:true` 已文档化；前端 `lspWorkspaceEdit.ts:105` 未打开仅 `console.warn`，服务端无从得知。
* 目标：不改变乐观应答（避免服务端卡住），只加可观测：前端 warn 保留 + 统一前缀 `[LSP] applyEdit skipped`（已是），后端 `push_apply_edit` emit 失败已 `log::error`（保留）。本次不引入"等前端 ack"的新命令与超时（那会重演卡住，design D4 已否决）。
* 测试：现有 `server_request.rs` 转发单测 + `lspWorkspaceEdit` 未打开单测即护栏，不新增。

## F7 超 300 行二拆（F5 遗留，2026-09-20 复审追加）

> 起因：F5 只做到"popup / menu / gutter"粗拆，`lspQuickFixMenu.ts` 新建即 391 行，
> `tauriLspTransport.ts` 被本次 +28 行顶到 387 行。上轮审查只卡"React 组件 <300 行"
> 漏掉了 hook / transport 类——超行即内聚告警，不分文件类型，本次补齐。

* F7a `lspQuickFixMenu.ts:391` 二拆：现状一文件含诊断定位（`diagnosticAtPosition`）
  + 动作派发（`applyPreferredFixAt` / `runAiFixAt` / `viewProblemAt`）+ 菜单 DOM
  （`appendSections` / `buildRow` + `MENU/ITEM` 样式常量）+ 弹出编排
  （`showQuickFixMenu` / `openQuickFixAt`）4 职责。目标拆为
  `quickFixMenuRender.ts`（DOM + 样式常量 + `showQuickFixMenu` 容器）vs
  `quickFixMenuActions.ts`（上下文 + 定位 + 派发 + `openQuickFixAt` 编排），
  `lspQuickFixMenu.ts` 只剩重导出或删除（调用方改 import，测试路径同步）。
* F7b `tauriLspTransport.ts:387` 抽探针：`TauriLspTransport` 类（3 种事件订阅 +
  pending 管理）与探针摘要函数群（`summarizeLifecycleMessage` /
  `summarizeCompletionRequest` / `rememberPendingCompletionId` /
  `summarizeCompletionDiagnostics` + `CompletionDiagnostics` 类型）混住。
  目标抽 `lspCompletionProbe.ts`（纯函数 + 类型，单测随之搬），transport 只留
  订阅/转发/生命周期。
* 测试：现有 `lspQuickFix.test.ts` / transport 相关单测行为断言不动（纯搬移重跑即回归）；
  探针函数单测随文件搬到新模块，不新增语义。
* 回滚：逐文件搬 + 逐次跑 `vitest`，失败即停；重导出垫片保留一版再删。
* 豁免（不拆）：`*.test.ts`、样式、锁文件；后端 `instance.rs:1330` /
  `resource_deployer.rs:905` 系存量胖，本次改动仅 +8/+1 行，不在此次范围。

## 顺序与验证

1. F1 → F3（纯前端小步，每步 `pnpm test:run` 相关单测）。
2. F2（跨域，需 terminal 域配合，改后跑 editor + terminal 单测）。
3. F4（先读 terminal taskCommand 执行分支，只验证不改则零风险）。
4. F5（文件搬移，最后做，避免与 F1-F3 冲突）。
5. F6（文档/日志确认，无代码或两行内）。
6. F7（F5 之后：menu 二拆 + probe 抽离，纯搬移，逐次跑单测）。

门禁（每项完成后）：`pnpm type-check` + `pnpm test:run` 相关域 + `cargo test --manifest-path src-tauri/Cargo.toml`（F1-F5 为前端主，Rust 侧仅 F6 相关单测重跑）。

## 不做清单

* 不引入"等前端 ack"的 applyEdit 确认协议（会重演服务端卡住）。
* 不做 rename / organizeImports / source.* 全量接入（design §3 已否决）。
* 不改 `interactive_prompt_args` 数据驱动设计（已符合 OCP，保持）。
* 不改 pnpm patch 流程；`patches/*.patch` 已纳入 git，改包后按已知问题 `rm -rf node_modules/.vite` 后验证。
