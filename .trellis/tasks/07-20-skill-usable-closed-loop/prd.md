# PRD: Skill 模块可用闭环

## Goal

让 Skills 主链路可用：安装 → 标签组 → 项目绑定 → 切项目增量同步到 Agent（只装不卸）。

## Requirements

1. 本地安装支持选择 skill 目录（不仅限 .md）
2. TagGroup 可创建；Skill 可加入标签组；可手动同步标签组
3. Sync 目标来自 Agent.default_skill_path（与 AgentManager 对齐）
4. Project Skills 页可绑定标签组
5. 切换 activeProject 时 `apply_project_skills`：增量装入绑定组 skill，不卸载其它 skill
6. UI 使用现有主题 token；错误经 toast 暴露

## Acceptance Criteria

- [ ] 目录安装 skill 后 Library 可见
- [ ] 创建 Backend 标签组并加入 skill
- [ ] 项目绑定 Backend 后，切到该项目会同步 skill 到 Agent skill 目录
- [ ] 切到未绑定项目不会删除已同步 skill
- [ ] 无 Coming soon 主路径

## Decisions

- 同步策略：**只装不卸（增量）**
- 标签唯一手段：TagGroup（不做 per-tool toggle 矩阵）

## Phase 2 (install UX)

1. Git/GitHub 安装对话框（preview 多选 confirm）
2. 市场安装后引导加入标签组
3. Git/market skill 检查更新 / 一键更新
4. owner/repo 简写与 source_ref 元数据修复
