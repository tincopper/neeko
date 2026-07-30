# 资源库管理动作

## Goal

在 Neeko 现有 Skill / Action 体系上，落地「资源库」统一管理能力，并通过 Action Palette 提供一等入口。
让用户可以创建、搜索、复用 **Skills / Prompts / Actions**，并从 Action 一键使用。

## Context

- 参考：[vb.do Library](https://vb.do/library)（Themes / Prompts / Media 三类可复用资产）
- Neeko 已有一等 Skill 资源库（中央库、Marketplace、Tag Group、Agent/Project 同步），作为 Library 一等 Tab 复用，不重写
- Action Palette 当前仅静态动作，需要新增「打开资源库 / 创建 Prompt / 插入 Prompt」等入口
- 设计文档：`design.md`（同目录）
- 交互原型：`prototypes/resource-library.html`（同目录）

## 关键决策（已确认）

| # | 问题 | 决策 |
|---|------|------|
| 1 | Dock 面板 ID | **新建 `panelId: library`**，旧 `skills` 保留但不再作为主入口 |
| 2 | Prompt slash | **MVP 即支持**（如 `/review`） |
| 3 | Insert 目标 | **Agent 输入为主**，终端也支持（写入 PTY） |
| 4 | 项目级覆盖 | **项目级优先级更高**，同名 slash 项目覆盖全局 |
| 5 | 视图模式 | **网格 + 列表双视图**，用户可切换 |

## Requirements

### P0 — MVP

- [ ] 新增 Dock 面板 `panelId: library`（独立于现有 `skills`）
- [ ] Library 壳：Tabs = Skills / Prompts / Actions，双视图（网格 + 列表）可切换
- [ ] Skills tab 内嵌现有 SkillsPanel 能力（安装/标签/Agent/Project/Marketplace）
- [ ] Prompts CRUD：创建、编辑、删除、搜索、标签过滤
- [ ] Prompt 支持 slash 命令（如 `/review`），项目级覆盖全局同名
- [ ] Prompt Insert：Agent 输入（主）+ 终端 PTY（次）
- [ ] Action Palette 新增：`Open Resource Library` / `New Prompt…` / `Insert Prompt…`
- [ ] 快捷键：`Ctrl/⌘+Shift+L` 切换 Library 面板
- [ ] 空状态引导（对齐 vb.do 风格）
- [ ] 面板关闭再打开保留上次 kind + 视图模式

### P1 — 动态化 + 使用闭环

- [ ] Action Palette 动态 Provider：最近 Prompt、自定义 Action
- [ ] Save as Prompt（从 Agent 输入 / 终端命令沉淀）
- [ ] Prompt 变量填充（`{{branch}}` 等 + 上下文自动填充）
- [ ] usage / recent 排序

### P2 — 扩展

- [ ] Action 模板入库
- [ ] 资源导入/导出（JSON bundle）
- [ ] Themes / Media 接入（按需）

## Constraints

- 不推翻现有 Skill 系统（skillStore / skill DB / Marketplace 保持不变）
- 不引入云同步 / 账号体系（MVP）
- 新 `panelId: library` 与旧 `skills` 并行存在，避免破坏现有用户习惯
- Themes / Media 明确延后

## Acceptance Criteria

- [ ] Action Palette 搜索 `library` 可打开新 Library 面板（`panelId: library`）
- [ ] Skills tab 行为与现网一致（安装/标签/Agent/Project/Marketplace）
- [ ] 可创建 Prompt（含 slash）并在列表中搜索到
- [ ] 项目级 Prompt 同名 slash 覆盖全局
- [ ] Insert Prompt 写入 Agent 输入；终端场景写入 PTY
- [ ] 删除 Prompt 需确认，刷新后不再出现
- [ ] 面板关闭再打开保留上次 kind + 视图模式
- [ ] 网格/列表双视图切换正常
- [ ] 关键 skill 回归测试通过
- [ ] 原型 `prototypes/resource-library.html` 覆盖主路径交互

## Artifacts

- `design.md` — 技术设计（数据模型、前后端架构、Action 系统、分阶段落地）
- `prototypes/resource-library.html` — 可交互原型
- `implement.md` — 执行计划
