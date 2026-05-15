# Task Runner

## Overview

为 Neeko 添加 Task Runner 功能，参考 IDEA 2026 的任务执行按钮设计。用户可以在 TitleBar 中直接执行/停止预配置的任务（如 build、dev、test 等），并通过下拉菜单管理任务配置。

## Requirements

### Phase 1: TitleBar 布局调整

- [ ] 将项目名和分支名从 TitleBar 右侧移到左侧（紧跟 Neeko 图标之后）
- [ ] 中间留出 flex spacer
- [ ] WindowControls 保持在最右

### Phase 2: TaskRunButton 组件

- [ ] 在 TitleBar 中 spacer 和 WindowControls 之间添加 TaskRunButton
- [ ] 按钮左侧图标：未运行 = ▶ (Play)，运行中 = ⏸ (Stop)
- [ ] 按钮右侧下拉箭头 ▾，点击展开任务列表
- [ ] 点击按钮本体：执行上次选中的任务 / 停止当前运行的任务
- [ ] 下拉菜单内容：
  - 已配置任务列表（点击切换选中并执行）
  - 分隔线
  - "添加任务..." 入口
  - "管理任务..." 入口（可选，后续迭代）

### Phase 3: 任务配置

- [ ] 支持添加任务：任务名(name)、运行命令(command)、保存级别(scope: project | app)
- [ ] 应用级任务存储在 `~/.neeko/tasks.json`
- [ ] 项目级任务存储在项目目录 `.neeko/tasks.json`
- [ ] 支持删除任务
- [ ] 支持编辑任务

### Phase 4: 任务执行（后端）

- [ ] 新增 `src-tauri/src/task_runner.rs` 模块
- [ ] Tauri command: `get_task_configs` — 获取当前项目 + 应用级所有任务配置
- [ ] Tauri command: `save_task_config` — 保存/更新任务配置
- [ ] Tauri command: `delete_task_config` — 删除任务配置
- [ ] Tauri command: `run_task` — 在项目目录下创建 PTY session 执行命令
- [ ] Tauri command: `stop_task` — kill PTY session 停止任务
- [ ] 注册命令到 `neeko_invoke_handler!`

### Phase 5: 前端状态管理

- [ ] 新增 `src/types/task.ts` — TaskConfig, TaskState 类型定义
- [ ] 新增 `src/store/taskStore.ts` — 任务配置列表、运行状态、当前选中任务
- [ ] TaskRunButton 从 taskStore 读取状态并渲染

## Data Model

```typescript
interface TaskConfig {
  id: string;                    // UUID
  name: string;                  // 任务名，如 "Build", "Dev", "Test"
  command: string;               // 运行命令，如 "pnpm build", "cargo test"
  scope: "project" | "app";     // 保存级别
  projectId?: string;           // scope="project" 时关联的项目 ID
}

interface TaskState {
  configId: string;             // 关联的 TaskConfig.id
  status: "idle" | "running" | "success" | "failed";
  sessionId?: string;           // PTY session ID（运行中时）
}
```

## Acceptance Criteria

- [ ] TitleBar 项目名和分支显示在左侧（Neeko 图标之后）
- [ ] TaskRunButton 在 TitleBar 中可见，图标正确切换（play/pause）
- [ ] 可通过下拉菜单添加任务（名称 + 命令 + 级别）
- [ ] 点击按钮可执行/停止任务
- [ ] 任务配置持久化（重启后保留）
- [ ] 应用级和项目级任务分别正确存储和加载
- [ ] cargo check / cargo test / pnpm type-check / pnpm lint 全部通过

## Technical Notes

- 任务执行复用现有 PTY 基础设施（参考 `src-tauri/src/terminal.rs` 的 session 管理）
- 任务输出暂不展示（后续可作为终端 tab 展示），Phase 1 仅执行不展示
- TaskRunButton 需要 `data-tauri-drag-region` 兼容窗口拖拽
- 按钮不参与窗口拖拽（需要排除 drag region）

## Out of Scope

- 任务输出面板（后续迭代）
- 多任务并行执行（Phase 1 只支持单任务）
- 任务依赖/串联
- 任务模板/预设
