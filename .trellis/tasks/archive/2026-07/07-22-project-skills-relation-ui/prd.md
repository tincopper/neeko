# Project UI: surface tag-group ↔ skill relations

## Goal

在 Skills 面板的 **Projects** 界面完整呈现并管理「项目 ↔ 标签组（Tag Group）↔ Skill ↔ Agent」关系。用户可以看到项目绑定组和磁盘 Skill 数量，管理绑定、target Agent 与每个 Skill 的 Agent 部署状态。

## Background

### 数据模型（不改 schema）

- 关联链：`Project → project_tag_groups → TagGroup → tag_group_skills → Skill`
- 自由标签 `skill_tags` 仅用于搜索，不与项目直接关联
- DB 绑定声明与项目磁盘部署是两个状态，但绑定保存会按本任务约定同步两者
- `apply_project_skills` 只向项目 `selected_agent` 对应的项目本地 Skill 目录做 install-only 同步，绝不写全局 `~/.agent/skills`

### 最终产品语义

1. 项目行的主数字是磁盘 Skill 数，副数字是绑定 Tag Group 数。
2. 绑定新增组时，只把新增组内 Skill 安装到项目 `selected_agent` 的项目本地目录。
3. 没有可用 target Agent 时仍保存绑定，磁盘同步成功跳过。
4. 解绑时删除仅由已解绑组提供的项目 Skill；仍被任一保留组覆盖的 Skill 不删除。
5. target Agent 必须存在、启用并具有非空 `skill_path`，前后端使用相同判定。

## Requirements

### R1 — 左侧项目摘要

- Projects 行同时展示磁盘 Skill 数和绑定 Tag Group 数。
- 通过批量 IPC 加载所有项目的绑定组数，避免 N 次串行调用。
- 行内只读；点击仍进入对应 Project Skills 视图。

### R2 — 右侧绑定关系与同步

- 展示 Bound Tag Groups 区域，包含组名、组内 Skill 数、空态和 Manage 入口。
- 保存新增绑定后，仅向项目 target Agent 安装新增组内 Skill，并按 Skill ID 去重。
- 无 target Agent 或 target Agent 无 `skill_path` 时只保存绑定，不写磁盘。
- 解绑删除不再被保留组覆盖的 Skill，保留共享 Skill。
- `apply_project_skills`、绑定同步和手动 Import 均限制在项目根目录内。

### R3 — Project Skills 管理

- 支持按 bound Tag Group 过滤，重复点击组或选择 All groups 可清除过滤。
- Skill 卡片展示所属绑定组和每个可用 Agent 的部署状态。
- 已关联 Agent 可 enable/disable；未关联且 project-capable 的 Agent 可执行 install-only 添加。
- 页头展示并可设置、切换、清除项目 target Agent。

### R4 — 导航与 Agents 视图

- Library、Tag、Agent、Project、Marketplace 导航目的地互斥。
- Agents List view 支持显式多选模式、当前过滤结果全选和批量删除。

### R5 — 可访问性与一致性

- 新控件沿用 Skills 面板现有 token、菜单、toast 与错误处理模式。
- 图标按钮具有 `label` / `title`，筛选与选择状态可被辅助技术识别。
- 固定格式控件具有稳定尺寸，窄布局可换行或滚动，不遮挡相邻内容。

## Acceptance Criteria

- [x] **AC1** 左侧 Projects 每行同时显示磁盘 Skill 数和绑定 Tag Group 数；无绑定显示 0。
- [x] **AC2** 右侧显示已绑定 Tag Group 的名称与 Skill 数；无绑定时有明确空态。
- [x] **AC3** Manage 可打开绑定对话框；保存后刷新详情和左侧计数；新增组只同步到 `selected_agent`，无 target 时不写盘。
- [x] **AC4** 解绑后组数和列表立即更新；只删除已解绑组独占 Skill，共享 Skill 保留。
- [x] **AC5** 项目选择、Add Skill、Import、remove、enable/disable 原有流程保持可用。
- [x] **AC6** SkillsPanel、ProjectSkillContent 与 AgentSkillContent 关键路径有前端回归测试。
- [x] **AC7** Project Skills 可按绑定 Tag Group 过滤，并支持重复点击和 All groups 清除。
- [x] **AC8** Project Skill 卡片展示绑定组；页头展示 target Agent。
- [x] **AC9** 未关联 project-capable Agent 可添加 Skill；已关联 Agent 可 enable/disable；target Agent 在卡片高亮。
- [x] **AC10** Projects 页头可设置、切换和清除 `selected_agent`。
- [x] **AC11** `apply_project_skills`、绑定同步与 Import 只写项目本地 Agent 目录，不写全局 `~/.agent/skills`。
- [x] **AC12** Library、Tag、Agent、Project、Marketplace 互斥选中。
- [x] **AC13** Agents 视图有显式多选、当前过滤结果全选和批量删除。

## Out of Scope

- 修改 DB schema 或迁移版本
- 自由 `skill_tags` 与项目绑定
- 主侧栏 `features/project` 项目树展示 Skill 关系
- 左侧项目行内编辑绑定
- 将一个项目绑定同步到多个 Agent
- 改造 Marketplace 主流程

## Decisions

| # | 决策 | 选择 | 日期 |
|---|------|------|------|
| D1 | 展示落点 | 左侧摘要 + 右侧详情/管理 | 2026-07-22 |
| D2 | 交互深度 | 右侧管理绑定；左侧只读 | 2026-07-22 |
| D3 | 左侧数字语义 | 主=磁盘 Skill 数；副=绑定组数 | 2026-07-22 |
| D4 | 绑定保存副作用 | 新增组 install-only 同步到 target Agent；解绑删除不再被保留组覆盖的项目 Skill | 2026-07-22 |
| D5 | target Agent 能力 | Agent 必须存在且具有非空 `skill_path`；否则保存声明并跳过同步 | 2026-07-22 |

## Constraints

- 不引入新的跨 feature 依赖方向；IPC 继续封装在 `features/skill/api/skillApi.ts`。
- 不跨 `await` 持有 Rust manager 锁。
- 项目同步目标必须经项目根目录约束，禁止退回全局 Agent Skill 路径。
- 关键变更使用 Vitest 与 Rust 临时文件系统测试覆盖。

## Notes

- `repository.get_all_project_skill_counts` 的历史 SQL 语义与 `commands.get_all_project_skill_counts` 的磁盘扫描语义不同；本任务继续以命令侧磁盘结果作为左侧主数字。
- 交互原型位于同目录 `prototype.html`，仅作为规划参考；实现以本 PRD、D4/D5 和代码 spec 为准。
