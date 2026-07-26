# PRD：Git Changes 支持一键撤销全部改动

## 背景

当前 Neeko 的 Git Changes 面板虽然已对单个文件提供 `Discard changes` 按钮（hover 时显示），但点击后立即执行、无二次确认，容易误操作；同时也缺少一键撤销所有改动的入口。用户需要更安全、完整的改动撤销体验。

后端其实已存在 `discard_all` Tauri 命令与 `gitApi.discardAll` 调用，但未被接入统一的 `ProjectCommands` 能力层，前端也未暴露对应 UI。

## 目标

在 Git Changes 面板统一改动撤销体验：
1. 为单文件 `Discard changes` 增加二次确认对话框。
2. 新增「撤销全部改动 / Discard All Changes」按钮，允许用户一键将当前工作区所有改动（含 tracked 与 untracked）恢复到干净状态。
3. 两者均通过二次确认防止误操作。

## 需求范围

### In Scope

1. 后端命令已存在，无需新增 Rust 命令；本次只补齐调用链与 UI。
2. 将 `discardAll` 接入 `ProjectCommands` 统一能力层（Local / WSL / Remote 通用）。
3. 在 Changes 面板头部增加「Discard All」按钮。
4. 点击文件行的 `Discard changes` 按钮后，弹出二次确认对话框。
5. 点击「Discard All」按钮后，弹出确认对话框，展示即将被撤销的文件数量与影响说明。
6. 确认后调用对应 discard 命令，完成后刷新 Git 状态并清空相关文件选择。
7. 支持 `loading` 状态与错误提示（toast）。
8. 对空 changes 列表禁用「Discard All」按钮。
9. 补充前端单元测试。

### Out of Scope

1. 撤销某一次 discard 操作（即 undo discard / 回收站机制）。
2. 撤销最后一次 commit（undo last commit）。
3. 自定义撤销策略（如只撤销 tracked、保留 untracked 等）。
4. 快捷键绑定（后续可扩展）。

## 术语说明

- `discard`：在本项目中对应 Git 的 `git checkout -- .` + `git clean -fd`，即撤销工作区改动并删除 untracked 文件。后端 `discard_all` 已实现该语义。
- `撤销全部改动`：与现有单文件 discard 语义一致，只是批量作用于全部文件。
- `撤销单个文件`：对指定文件执行 `git checkout -- <file>`，恢复为 index 状态；untracked 文件被删除。

## 验收标准

1. `ProjectCommands` 接口暴露 `discardAll(): Promise<void>`。
2. `createProjectCommands` 中 `discardAll` 调用 `discard_all` Tauri 命令，并正确传递 `worktreePath`。
3. Changes 面板在存在改动时，头部显示「Discard All」按钮（图标 + 文字或纯图标，遵循现有 `Undo2` 图标风格）。
4. 点击文件行的「Discard changes」按钮弹出确认对话框，文案包含文件路径与影响说明。
5. 点击「Discard All」弹出确认对话框，文案包含类似：「This will discard all X changes and delete untracked files. This action cannot be undone.」。
6. 确认后执行撤销，成功后刷新 changes 列表并显示 toast（单文件为「Discarded changes」，全部为「Discarded all changes」）；失败时显示错误 toast。
7. 撤销过程中按钮与列表处于 loading 状态，不可重复触发。
8. 当 changes 为空时，「Discard All」按钮 disabled。
9. `commandFactory.test.ts` 包含 `discardAll` 调用断言。
10. 运行 `pnpm type-check`、`pnpm test:run` 与 `cargo test` 均通过。

## 风险与约束

1. **破坏性操作**：`discard_all` 会丢失工作区改动且无法恢复，必须二次确认。
2. **WSL/Remote 兼容性**：`discard_all` 命令本身通过 `ProjectCommands` 已在三种环境下统一，但需确认 `commandFactory` 透传 `worktreePath` 无误。
3. **untracked 文件删除**：确认文案必须明确提示会删除未跟踪文件，避免用户误判为仅撤销 tracked 修改。
4. **当前后端语义**：若后端 `discard_all` 实际未清理 untracked 文件，本任务需要同步调整后端实现（见设计文档）。

## 后续可扩展

- 在 Git 历史面板增加「Undo last commit」入口。
- 增加全局操作历史与 undo 栈。
- 为 discard 动作提供临时备份/回收站能力。
