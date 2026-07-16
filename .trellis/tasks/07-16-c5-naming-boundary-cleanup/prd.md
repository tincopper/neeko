# C5: 命名与边界规整

> Parent: [07-16-env-scatter-cleanup](../07-16-env-scatter-cleanup/prd.md)

## Goal

收尾清理：消除两套并行类型命名系统、修正放错模块的文件、更新已过时的架构 spec。这是 C1-C4 结构合并完成后的规整层，确保 3-way 分裂只保留在真正必要的 transport 层。

## Background

分析发现的命名/边界问题：

1. **两套并行类型系统**：后端枚举 `ProjectEnvironment::{Local,Wsl,Remote}`；前端既有 `environment.type: "Local"|"Wsl"|"Remote"`，又有小写 `ProjectType = "local"|"wsl"|"remote"` 和 `ConnectionContext { type: "local"|"wsl"|"remote" }` 并存于同一文件。代码不断在两者间转换（`useCrossTypeSelection` L68-70、`use-active-project/adapters.ts` 的 `ENV_TYPE_TO_VIEW_TYPE`、`ProjectsPanel` 字面量 `'wsl'`/`'remote'`）
2. **`RemoteItems.tsx`** 导出 `WSLItem` + `RemoteItem` + `SectionHeader`——WSL 组件放在 "Remote" 命名的文件里
3. **`common/git/{wsl,remote}.rs`** 只做目录树读取（非 git），放错模块——应随 C2 移到 file 服务
4. **`common/connection/`**（model.rs 12 行 / types.rs 12 行）几乎空，只放 `AuthMethod`，名字暗示更多
5. **架构 spec 过时**：`.trellis/spec/frontend/directory-structure.md`、`backend/directory-structure.md`、`guides/cross-layer-thinking-guide.md` 仍描述旧路径（`src/components/`、`models/project.rs`、三 store 分裂、`WSLProject`/`RemoteProject`），与统一后代码不符

## Requirements

- **统一类型命名**：消除小写 `ProjectType` / `ConnectionContext.type` 与枚举 `environment.type` 的二元并存，收敛为单一命名系统（建议以 `environment.type` 的 PascalCase 为准，或明确定义唯一映射点）；删除散落的 `ENV_TYPE_TO_VIEW_TYPE` 转换
- **文件重命名**：`RemoteItems.tsx` → 中性命名（如 `ConnectionItems.tsx`），或拆分 `WslItem` / `RemoteItem` 到各自文件；更新 `connection/index.ts` re-export
- **模块归位**：确认 C2 已将 dir-tree 函数移出 `common/git/`；评估 `common/connection/` 是否并入更合适的位置
- **spec 更新**：更新 `frontend/directory-structure.md`、`backend/directory-structure.md`、`state-management.md`、`cross-layer-thinking-guide.md`、`code-reuse-thinking-guide.md`，使之反映统一后的真实结构（扁平 projects、单一 hook、合并策略）；移除 `WSLProject`/`RemoteProject`/`useWslProjects`/`useRemoteProjects` 等已废弃引用

## Constraints

1. **最后执行**：依赖 C1-C4 全部完成，否则 spec 会记录中间态
2. **spec 与代码一致**：更新后 spec 描述的路径/类型必须在代码中真实存在（避免再次漂移）
3. **无行为变更**：本 task 以重命名、移动、文档为主，不改运行时行为

## Acceptance Criteria

- [ ] 前端只有一套 environment 类型命名，无 `ProjectType` lowercase 二元系统
- [ ] `RemoteItems.tsx` 重命名/拆分，无 WSL 组件放在 Remote 命名文件的情况
- [ ] `common/git/` 下无非 git 的 dir-tree 函数
- [ ] 受影响的 spec 文档已更新且与代码一致
- [ ] `pnpm test:run` + `npx tsc --noEmit` + `cargo check` 全绿

## Dependencies

- 依赖 C1、C2、C3、C4 全部完成。这是最后收尾。
