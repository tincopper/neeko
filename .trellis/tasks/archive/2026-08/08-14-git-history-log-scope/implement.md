# Git 历史展示域重构 — 执行计划

## 执行顺序（每步均保持测试绿 / 编译通过）

### Phase A：原型 HTML（设计评审物，先行产出）
- [x] A1. 产出 `.trellis/tasks/08-14-git-history-log-scope/prototypes/history-scope-prototype.html`：交互式原型，含
  - 分支徽章切换 → 历史跟随当前分支（模拟 BranchSwitcherPanel + git log <branch>）
  - refs 分类标签染色（branch/remote/tag/stash）
  - 分类规则演示（`refs/synara/checkpoints` 归 tool → 丢弃）
  - 复制按钮 hover 反馈
- [x] A1b. 产出 `.trellis/tasks/08-14-git-history-log-scope/prototypes/stash-panel-v2.html`：交互式原型，含
  - 点击行展开文件列表；点击文件内联展开单文件 diff（hunk/add/del/ctx 着色）
  - 行 hover 显示 Apply / Pop 按钮（Apply 绿、Pop 危险色）
  - Pop 后条目移除 + 徽章计数更新 + toast；操作中 loading 禁用
- [x] A2. 浏览器打开原型，与用户确认设计方向后再进入实现（评审门禁）

### Phase B：Rust 后端（TDD）
- [x] B1. 写失败测试（红）：
  - `parse_decorate_refs`：branch/remote/tag/stash/HEAD 解析；`refs/synara/checkpoints` 丢弃；空 decorate
  - `parse_stash_list`：`git stash list --format` 输出解析（selector/hash/message/branch/timestamp）；空输出
- [x] B2. 实现 refs 分类纯函数 + stash list 解析（绿）
- [x] B3. `operations::get_commit_log` 与 `local::get_commit_log` 移除 `--all`，固定 `--decorate=full --topo-order HEAD`
- [x] B4. `CommitEntry` 增 `refs_list: Vec<ParsedRef>`；`parse_commit_log_output` 填充；`refs` 字段写为「仅可展示类别的过滤后 decorate」
- [x] B5. 新增 `StashEntry` 类型 + `operations::get_stash_list` / `get_stash_files`（`git stash show --numstat/--name-status`，复用 numstat/status 合并模式抽公共函数）
- [x] B5b. 新增 `StashActionResult` 类型 + `operations::get_stash_file_diff`（`git stash show -p <selector> -- <path>`，复用 `parse_unified_diff`）/ `stash_apply` / `stash_pop`
- [x] B6. `git/commands.rs` 新增 `get_stash_list` / `get_stash_files` 命令；注册进 `neeko_invoke_handler!`（`lib.rs`）
- [x] B6b. `git/commands.rs` 新增 `get_stash_file_diff` / `stash_apply` / `stash_pop` 命令；注册进 `neeko_invoke_handler!`（`lib.rs`）
- [x] B7. 补集成测试：tempfile 仓库建分支 + 孤立 `refs/synara/checkpoints` + stash，验证 log 不含 synara、decorate tool 过滤、stash list/files 正确
- [x] B7b. 补集成测试：stash 单文件 diff 解析、apply/pop 成功与冲突路径（pop 冲突时条目保留）
- [x] B8. `cargo test` 全绿

### Phase C：前端 API 与逻辑
- [x] C1. `features/git/types.ts`：`CommitEntry` 增 `refs_list`，新增 `ParsedRef` 类型；新增 `StashEntry` 类型
- [x] C2. `shared/types/project.ts` `ProjectCommands` 增 `getStashList` / `getStashFiles`；`commandFactory.ts` 实现（invoke `get_stash_list` / `get_stash_files`，带 worktreePath）
- [x] C2b. `ProjectCommands` 增 `getStashFileDiff` / `stashApply` / `stashPop`；`commandFactory.ts` 实现（invoke `get_stash_file_diff` / `stash_apply` / `stash_pop`，带 worktreePath）
- [x] C3. `gitApi.ts` 增 `getStashList` / `getStashFiles` 工具函数
- [x] C3b. `gitApi.ts` 增 `getStashFileDiff` / `stashApply` / `stashPop` 工具函数
- [x] C4. `commitListUtils`：`formatRefs` 支持 `refs_list` 分类染色（branch/remote/tag/stash）；tool 类不渲染；补单测（红→绿）
- [x] C5. 新 `useStashList` hook（加载列表 + 展开详情 + 空态）；补单测
- [x] C5b. `useStashList` 扩展：`applyStash` / `popStash`（`actionSelector` + `actionLoading` 防重复，成功后刷新列表 + 触发 Git 面板刷新）+ 单文件 diff 按需加载（`requestSeq` 守卫）；补单测
- [x] C6. `pnpm type-check` / `pnpm test:run` 通过

### Phase D：前端 UI
- [x] D1. `CommitListItem` 用分类标签渲染（refs_list 优先，refs 子串回退）
- [x] D2. `GitControlTab` 扩展为 `'changes' | 'history' | 'stash'`（`GitControlPanel.tsx:14`）；tab 栏顺序 [Changes] [History] [Stash]；新增第三个 tab 按钮 + Stash 面板容器（keep-mounted + hidden 切换）
- [x] D3. 新 `StashPanel` 组件：stash 列表 + 点击展开文件变更 + 空态 + 数量徽章；接入 `GitControlPanel` / `GitControlPanelWrapper`
- [x] D3b. `StashPanel` 扩展：点击文件打开 diff tab（git feature 域 hook `useOpenStashDiff`，diffSource 为 stash 变体，标题 `stash@{n}: <message>`）；行 hover 显示 Apply / Pop 按钮，操作中 loading 禁用；成功后刷新列表 + 触发 Git 面板刷新（工作区已变）
- [x] D4. 确认 checkout 分支后历史跟随（现有 `onRefreshGit → refresh` 链路），必要时补测试
- [x] D5. `pnpm lint` / `pnpm type-check` / `pnpm test:run` 全绿

### Phase E：剪贴板统一修复
- [x] E1. 共享 hook `shared/hooks/useCopyToClipboard.ts`（插件 writeText → navigator 回退 → toast 报错）+ 单测
- [x] E2. capabilities 补 `clipboard-manager:allow-write-text`
- [x] E3. 调用点迁移：CommitListItem（核心，先去 unhandled rejection）、BranchSwitcherPanel、useFilePanelState、PromptListSection、DockPanelWrappers、ConversationViewer、NotificationDetail
- [x] E4. `cargo test` + `pnpm test:run`

### Phase F：收尾
- [x] F1. 全量质量门禁：`pnpm lint`、`pnpm type-check`、`pnpm test:run`、`cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] F2. 校验 acceptance criteria；更新 task.json 元信息
- [ ] F3. 同步必要 spec（git 域：历史展示范围约定）

## 验证命令

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm type-check
pnpm lint:fe
pnpm test:run
```

## 审查门禁（Review Gates）

- 统一命令执行接口：新代码只走现有 `transport.run_git` / `run_cmd_local`，不得裸用 `std::process::Command`
- Command 层保持极薄：`get_commit_log` 只透传，不内联 git 逻辑
- 不硬编码 synara：分类基于前缀规则
- `mod.rs` 只做 re-export；refs 分类抽独立模块
- 复制路径禁止吞错：统一走 hook 的 toast 反馈

## 回滚点

- B3/B4 若影响面过大：仅恢复 `operations.rs` / `local.rs` 的 `--all`，refs 过滤逻辑保留（防御性）
- E 若剪贴板回归：恢复各调用点原 `navigator.clipboard.writeText` + catch，移除 hook 引用
- 原型 HTML 独立于源码，删除不影响应用