# TODO 未完成项优化方案

## Goal

围绕 `TODO.md` 中剩余 4 项前端结构问题，形成可分批执行的改造方案，降低类型与目录复杂度，统一导入与命名规则，控制迁移风险并保持功能行为不变。

## What I already know

* 剩余问题为：Barrel Export 缺失、类型组织混杂、目录组织不清晰、命名不一致。
* 当前缺失 `index.ts` 的目录为：`src/hooks/`、`src/utils/`、`src/adapters/`、`src/components/panels/`。
* `src/types.ts` 约 312 行，混合了配置、领域实体、连接、编辑器、文件视图、Skill 等多类类型。
* `components/panels` 与 `components/skills` 并存，且已有跨目录转发文件，例如 `project/ProjectSidebar.tsx -> panels/ProjectsPanel.tsx`、`skills/index.ts -> panels/SkillsPanel.tsx`。
* 命名混用仍存在，例如 `ProjectActionsContextValue` 同时暴露 `onSelectProject` 与 `handleSelectProject`。
* `useAppContainer.ts` 仍承担大量编排职责，包含命名与上下文注入策略的历史包袱。

## Decision from confirmation

* 已确认：类型拆分采用“按域拆分并移除 `src/types.ts`，全面切换新导入路径”。

## Assumptions

* 本轮目标为方案设计与实施分解，不直接进行全量迁移。
* 迁移采用分阶段提交，每阶段包含编译校验与可回滚边界。
* 命名规范基线：对外 props 或 context 回调统一 `on*`，内部局部处理函数统一 `handle*`。

## Open Questions

* 暂无阻塞问题。

## Requirements

* 给出 4 项未完成问题的根因分析、目标状态、验收方式。
* 给出分阶段方案，每阶段明确改动范围、收益、风险、回滚点。
* 给出新目录结构与类型目录结构，并说明迁移顺序。
* 给出命名规范落地规则与自动检查建议。
* 明确测试先行策略，列出每阶段先写或更新的测试范围。
* 明确 IPC 契约稳定策略：`invoke` 命令名、参数键名、事件名在本任务内保持不变。
* 明确规范同步项：更新 `AGENTS.md` 与任务文档中的类型组织说明。

## Acceptance Criteria

* [x] 四项问题均有目标状态、迁移步骤、验收口径。
* [x] 提供按依赖顺序的实施计划，能拆成小批次 PR。
* [x] 每阶段都包含失败回滚方案。
* [x] 所有“待确认项”已清零或降为非阻塞。
* [x] 每个阶段包含“先测试后实现”的执行步骤与可验证产物。
* [x] 每阶段结束后 `npx tsc --noEmit` 与 `pnpm test:run` 通过。
* [x] `invoke` 命令名、参数键名、事件名迁移后保持一致。
* [ ] 完成一次本地交互回归验证并记录结果。
* [x] `AGENTS.md` 类型规范已同步更新且与本 PRD 一致。

## Definition of Done

* 阶段内先补失败测试再修改实现，测试通过后再提交。
* `npx tsc --noEmit` 与 `pnpm test:run` 持续通过。
* 行为保持不变的结构改造具备回归验证记录。
* `AGENTS.md` 与任务文档已同步更新并通过评审。
* 每个阶段具备独立回滚点。

## Out of Scope

* Rust 后端模块结构调整。
* `src-tauri` 命令实现与参数校验逻辑修改。
* `tauri.conf.json` 中 allowlist 与 scope 调整。
* 新功能扩展与交互改版。
* 视觉样式重构。

## Technical Approach

### Approach A 结构优先分层 推荐

1. 先统一目录边界与命名规范
2. 再补齐 barrel
3. 最后拆分类型并切换全量 import

优点

* 认知负担下降后再进行类型切换，冲突更少。
* import 迁移范围可预测。

代价

* 前两阶段收益偏“结构治理”，业务感知较弱。

### Approach B 类型先拆分

1. 先拆分 `types.ts`
2. 再统一目录与命名

优点

* 优先消除最大单点文件。

代价

* import 改动瞬时放大，目录命名问题仍会干扰评审。

### Approach C 一次性全改

优点

* 周期最短。

代价

* 回归风险高，评审与回滚成本高。

结论

* 采用 Approach A。

## Implementation Plan small PRs

* PR1：统一命名约定，收敛 `on*` 与 `handle*` 边界，并补齐对应测试。
* PR2：重组 `components/panels` 目录边界，移除转发壳文件并完成导入迁移。
* PR3：补齐 `hooks/utils/adapters/sidebar` 的 barrel export，收敛跨目录导入路径。
* PR4：按域拆分类型并移除 `src/types.ts`，完成 IPC 契约核对与规范文档同步。

## Execution Status 2026-04-21

* 已完成：PR1 命名统一，`ProjectActionsContextValue` 仅保留 `on*` 对外回调。
* 已完成：PR3 barrel 补齐，新增 `hooks/utils/adapters/components/panels` 的 `index.ts`。
* 已完成：PR4 类型拆分，新增 `src/types/` 按域类型目录并移除 `src/types.ts`。
* 已完成：PR2 目录边界收敛，`FileViewer` 与 `FileTree` 已迁移到 `components/files`，`components/panels` 仅保留侧栏面板组件。
* 待完成：补充一次本地交互回归记录。


## Decision ADR-lite

**Context**

前端结构治理已完成高严重度问题，剩余问题主要是规范一致性与边界清晰度，适合采用低风险渐进改造。

**Decision**

先做结构收敛与命名统一，再推进类型拆分与全量导入切换。

**Consequences**

* 每个阶段可独立验收和回滚。
* 总周期略长，但稳定性更高。

## Technical Notes

### Repo constraints

* `tsconfig` 采用 `strict`，迁移期任何类型泄漏都会直接暴露。
* 当前无路径别名，import 全为相对路径，批量移动文件时需要完整更新引用。
* 现有 `components` 内存在“转发壳文件”，可作为兼容期手段。

### Structural findings

* 缺失 barrel 的目录已确认。
* `ProjectActionsContextValue` 命名混用是命名不一致的最集中入口。
* `panels` 目录已承担多个“侧边栏面板 + 主区文件查看”职责，语义边界不清。

### IPC and security boundaries

* 本任务只调整前端结构，不修改 `src-tauri` 命令实现。
* `tauri.conf.json` 的 allowlist 与 scope 保持现状。
* 涉及 `invoke` 的调用点只调整导入路径与类型引用，不调整命令名与参数键名。
* 如果出现跨端字段命名差异，先保持现状并记录为后续独立任务。


### Reference

* `TODO.md`
* `src/types/index.ts`
* `src/components/layout/AppLayout.tsx`
* `src/components/panels/ProjectsPanel.tsx`
* `src/components/files/FileViewer.tsx`
* `src/components/files/FileTree.tsx`
* `src/contexts/project-actions-context.tsx`
