# Project 跨端统一重构

## Goal

消除 Neeko 前后端中 Local / WSL / SSH 三种项目类型的存储与类型分裂，统一为带 `ProjectEnvironment` 的单一 `Project` 结构体，使所有领域（git、session、terminal、editor）通过统一的 `project_id` 即可获取完整项目信息（路径 + 运行环境），无需前端手动构造 transport 对象。

当前三种项目分裂存储导致：
- git PR 命令因前端漏传 `transport` 参数而崩溃
- 前端 store 三套独立（`useProjectStore` + `useConnectionStore` 分裂存储 WSL/Remote）
- 新领域需要重复实现三路聚合逻辑
- `use-active-project` hook 有一整层的跨 store 优先级合并代码

## Deliverables

本 task 为 parent task，产出由 7 个 child tasks 分别交付：

### P1: 后端 core 模块 — Project + ProjectEnvironment 定义
- 新建 `src-tauri/src/core/` 模块
- 定义 `ProjectEnvironment` 枚举（Local / Wsl / Remote）
- 将 `Project` 结构体移入 core（原 `project/model.rs` 定义），追加 `environment` 字段
- `ViewMode` 一并移入 core
- `project/types.rs` 改为重新导出来自 core 的 `Project`
- `project/model.rs` 移除 `Project`/`ViewMode` 定义，仅保留 git/PR 类型

### P2: 后端 ProjectManager 统一 + resolve_project
- `ProjectManager` 扩展为支持 **所有** 项目类型（Local + WSL + Remote）
- 新增 `add_wsl_project()` / `add_remote_project()` 等方法
- Session 加载时，`wsl_entries` / `remote_entries` 转为带 environment 的 `Project` 写入 `ProjectManager`
- `AppStateWrapper` 新增 `resolve_project(project_id) -> (GitTransport, PathBuf)` 方法
- 向后兼容：持久化 `session.json` 格式不变，仅在运行时做转换

### P3: 后端 git 命令迁移 — 去除 transport 参数
- `git/commands.rs` 所有命令去掉 `transport: GitTransportKind` / `transport: FileTransportKind` 参数
- 统一改为 `project_id: String` + `state: State<AppStateWrapper>`
- 内部调用 `state.resolve_project()` 获取 transport 信息
- 删除 `GitTransportKind` / `FileTransportKind` enum 定义
- 更新 `lib.rs` 中 `neeko_invoke_handler!` 宏
- 修复当前 PR 命令的 transport 参数缺失 bug

### P4: 前端类型 + Store 统一
- 定义统一 `Project` 接口（含 `environment: ProjectEnvironment`）
- 删除 `WSLProject` / `RemoteProject` 独立接口
- 扩展 `useProjectStore` 存储所有项目（不再分 store）
- 简化 `useConnectionStore` 为仅存连接管理状态（对话框、auth）
- 删除 `LocalConnectionContext` / `WslConnectionContext` / `RemoteConnectionContext`
- 适配 session 持久化 API 返回类型

### P5: 前端 API + Factory 迁移
- `gitApi.ts`：所有函数去掉 `transport` 参数
- `fileApi.ts`：所有函数去掉 `transport` 参数
- `commandFactory.ts`：`createProjectCommands(projectId)` 不再构造 transport
- `use-active-project/index.ts`：去掉跨 store 合并逻辑、去掉 connectionContext 构造

### P6: 前端消费者迁移
- 更新所有直接引用 `useConnectionStore` 获取项目数据的组件/hooks
- 更新 terminal 三个策略文件（不再构造 transport）
- 更新 `useDiffData.ts`、`useFileView.ts`、`useAppShell.ts`
- 更新 `MainContent.tsx`、`OpenIdeButton.tsx`、`DockPanelWrappers.tsx`、`ProjectsPanel.tsx`
- 更新 `WslContext` / `RemoteContext`（仅保留连接状态，移除项目数据）
- 更新 `useKeyboardShortcuts.ts`、`useProjectSelection.ts`、`useProjectList.ts` 等
- `useCrossTypeSelection.ts` → 折叠/废弃

### P7: 清理收尾
- 删除废弃的类型定义和导出
- 重写/更新所有受影响的测试文件
- 运行 `pnpm lint`、`pnpm type-check`、`pnpm test:run`、`cargo check` 通过
- 确认 `tauri.conf.json` / `capabilities` 权限无残留 transport 引用

## Constraints

1. **持久化格式不变**：`session.json` 的 `wsl_entries` / `remote_entries` 字段在存储时保持原样。仅在加载时转换为统一 Project。
2. **后端 API 兼容**：Tauri 命令签名变更后，前端必须同步更新 invoke 调用。P3 与 P4 需要在同一次发布中同时上线。
3. **WA 兼容**：WSL 相关代码仅在 `cfg(target_os = "windows")` 下生效，macOS 下 `ProjectEnvironment::Wsl` 不应可用。
4. **Worktree**：worktree 项目继承父项目的 environment。

## Acceptance Criteria

- [ ] P1: `cargo check` 通过，core 模块定义清晰，`Project` 结构体携带 `environment` 字段
- [ ] P2: `ProjectManager` 可存储三种项目类型，session 加载/保存前后数据不丢失
- [ ] P3: 所有 git 命令不再接受 transport 参数，PR 命令正常工作
- [ ] P4: 前端 `useProjectStore` 包含所有项目，`useConnectionStore` 不再存项目
- [ ] P5: `gitApi.ts`/`fileApi.ts` 所有函数不再接受 transport，调用链正常工作
- [ ] P6: 所有组件从统一 store 获取项目数据，没有编译/运行时错误
- [ ] P7: `pnpm lint`、`pnpm type-check`、`pnpm test:run`、`cargo test` 全部通过
- [ ] 端到端验证：本地项目/Git操作/SSH连接/WSL连接功能正常
