# 资源库管理 Phase 2

## Goal

在 Phase 1 基础上，增加 Action 模板入库、资源导入/导出、Prompt 变量填充、usage/recent 排序，让资源库从"可用"走向"好用"。

## Context

- Phase 1 已交付：Library 壳、Prompts CRUD、Action Palette 入口、双视图、Save as Prompt、Insert 双目标
- Phase 1 任务：`07-29-resource-library`（已归档）
- Phase 1 设计参考：`.trellis/tasks/archive/2026-07/07-29-resource-library/design.md`

## Requirements

### Action 模板入库

- [ ] ActionResource 数据模型（`shared/types/library.ts` 已有定义）
- [ ] Action CRUD 后端命令（`save_action` / `list_actions` / `update_action` / `delete_action` / `run_action`）
- [ ] `actions` 表 migration
- [ ] Action 前端：Actions tab 列表 + 创建/编辑对话框
- [ ] Action 出现在 Action Palette 动态区（最近使用的 Action）
- [ ] Action 执行：根据 payload 类型分发（insert-prompt / run-skill / run-command / open-panel）

### 资源导入/导出

- [ ] `export_library_bundle` 命令：将 prompts + actions 导出为 JSON 文件
- [ ] `import_library_bundle` 命令：从 JSON 文件导入 prompts + actions
- [ ] 前端：LibraryHeader 增加"导入"/"导出"按钮
- [ ] 导出文件格式版本化（`version: "1.0"`）
- [ ] 导入时冲突处理（同名跳过 / 覆盖，弹出确认）

### Prompt 变量填充

- [ ] Prompt content 支持 `{{variable}}` 语法
- [ ] Insert 时检测变量，弹出变量表单
- [ ] 已知上下文自动填充：`{{branch}}`（当前分支）、`{{projectName}}`、`{{filePath}}`
- [ ] 用户填写后渲染最终内容再插入

### usage / recent 排序

- [ ] `use_prompt_cmd` 已记录 usage_count + last_used_at（Phase 1 已实现）
- [ ] 列表支持按"最近使用"排序
- [ ] 列表支持按"使用频率"排序
- [ ] Action Palette 动态区显示最近 5 个 Prompt/Action

## Constraints

- 不破坏 Phase 1 数据（prompts 表不变，新增 actions 表）
- 不破坏现有 Action Palette 静态 action
- 变量填充仅在 Agent 输入场景触发，终端 PTY 不触发
- 导入/导出为可选功能，MVP 先做导出

## Acceptance Criteria

- [ ] 可创建 Action 模板并在 Actions tab 显示
- [ ] Action 出现在 Action Palette 动态区
- [ ] 可执行 Action（run-command 类型写入终端）
- [ ] 可导出 Library 为 JSON 文件
- [ ] 可从 JSON 文件导入 Library
- [ ] Insert 含 `{{branch}}` 的 Prompt 时弹出变量表单
- [ ] 变量表单自动填充当前分支名
- [ ] 列表可按最近使用 / 使用频率排序
- [ ] Action Palette 显示最近 5 个资源
- [ ] 现有 844 前端测试 + 73 Rust 测试通过
