# Search — Implementation Plan

> Ordered checklist. Each step lands behind a test (TDD: Red → Green → Refactor).
> Validation commands at the end of each milestone.

## M1 — Backend `search/` domain

- [ ] 1.1 `Cargo.toml` 追加 `grep-searcher = "0.1"`、`grep-regex = "0.1"`，确认编译。
- [ ] 1.2 `types.rs`：`SearchMode` / `SearchOptions` / `SearchMatch` / `SearchPage` DTO + 常量。
- [ ] 1.3 `matcher.rs`：Pattern 编译（正则/字面/大小写/全词）+ **先写测试**（非法正则、\b 全词、大小写、include/exclude glob 前缀匹配）。
- [ ] 1.4 `engine_local.rs`：ripgrep 库封装（WalkBuilder + Searcher）+ **先写测试**（tempfile 项目：命中行列、二进制跳过、多字节/中文、sort+分页、TOTAL_CAP 截断）。
- [ ] 1.5 `engine_remote.rs`：远程 grep 构造 + 输出解析 + 超时 truncated + regex 降级 degraded + **测试**（命令参数断言、解析函数、超时分支）。
- [ ] 1.6 `services.rs`：ExecTarget 分发 + 取消 token 注册表 + **测试**（分发路由、取消旧请求）。
- [ ] 1.7 `commands.rs`：`search_in_files` 薄层 + root 解析 + canonicalize + `search_in_files` 注册进 `neeko_invoke_handler!` + `pub mod search;`。
- [ ] 1.8 **里程碑验证**：`cargo test --manifest-path src-tauri/Cargo.toml` 全绿；`cargo check --manifest-path src-tauri/Cargo.toml` 通过；`pnpm lint`（Rust fmt + clippy）通过。

## M2 — Frontend `features/search/`

- [ ] 2.1 `api/searchApi.ts`：`searchInFiles`（invoke + AbortController + requestId）。
- [ ] 2.2 `store/searchStore.ts`：zustand 状态 + actions + **先写测试**（debounce、requestId 递增、loadMore 合并、reset、模式切换）。
- [ ] 2.3 `hooks/useSearch.ts`：编排 debounce + 取消 + 分页 + **先写测试**（renderHook：query 变更触发、旧请求取消、错误态）。
- [ ] 2.4 组件：`SearchInput` / `SearchOptionsBar` / `SearchModeTabs` / `SearchStatusBar` / `SearchPanel` 多模式容器。
- [ ] 2.5 `SearchResultsTree`：文件分组 + 虚拟滚动（复用 gitlog virtualScroll）。
- [ ] 2.6 File 模式：复用 `fuzzy.ts` + `fileIndex.ts` 本地过滤 + `openProjectFile` 跳转。
- [ ] 2.7 组件测试：命中跳转调用 `openProjectFile`、加载更多、截断/降级提示（mock invoke）。
- [ ] 2.8 **里程碑验证**：`pnpm test:run`、`pnpm type-check` 全绿。

## M3 — Integration & verification

- [ ] 3.1 Dock 注册：`panelMeta.ts`（search, left, order 1）、`registry.ts`（Search icon + lazy）、`DockPanelWrappers.tsx`。
- [ ] 3.2 快捷键：`shortcutRegistry.ts`（`searchInFiles` + IDEA preset）+ `useKeyboardShortcuts.ts` case + Command Palette action。
- [ ] 3.3 会话恢复：query/filters/开合持久化；项目切换保留 query + 自动重搜提示。
- [ ] 3.4 WSL/SSH 真机验证（可用的测试环境）：远程 grep 行为、超时、参数传递。
- [ ] 3.5 全量回归：`cargo test` + `pnpm test:run` + `pnpm type-check` + `pnpm lint` 全绿。
- [ ] 3.6 Review gates：无 `any`、无 deprecated `local::exec`、命令层极薄、mod.rs 极薄、if-let ≤3 层、路径安全。

## Rollback points

- M1 完成后若 ripgrep 库编译/体积不可接受 → 回退 `engine_local` 为 `ignore+regex` 手写实现（接口不变）。
- M2 完成后若面板形态不达预期 → 仅调整 `features/search/components`，store/后端不动。
- 任意时刻：`git checkout main -- <files>` 回退单文件改动。
