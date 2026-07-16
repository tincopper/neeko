# C3: 前端 hook 合并 + connection 边界归位

> Parent: [07-16-env-scatter-cleanup](../07-16-env-scatter-cleanup/prd.md)

## Goal

合并前端镜像重复的 WSL/Remote hook 与 context，并把 `connection` feature 收窄为**只负责连接建立**（对话框、auth、distro/host 发现），项目生命周期（增删改查、刷新、选择）交还给统一的 `project` feature。

## Background

`connection` feature 当前越界拥有了两种环境的*项目生命周期*：

| 镜像对 | 行数 | 差异 |
|---|---|---|
| `useWslActions.ts` / `useRemoteActions.ts` | 240 / 214 | 换名词：`setWslEntries`/`setRemoteEntries`、`refreshWslGit`/`refreshRemoteGit`、`resetWslTransientState`/`resetRemoteTransientState`、`handleOpenWslIde`/`handleOpenRemoteIde` |
| `useWslProjects.ts` / `useRemoteProjects.ts` | 135 / 184 | entry CRUD 镜像；Remote 多 auth 处理 |
| `WslContext.tsx` / `RemoteContext.tsx` | 40 / 50 | 并行 context |

`worktreeStore` 还带并行字段 `wslActiveWtBranch`/`remoteActiveWtBranch`、`wslOpenedWt`/`remoteOpenedWt`（P1-P7 注释标为"待 WSL/Remote 完全迁移前保留"）。`ProjectsPanel.tsx`（L84-112）把统一列表手动 re-group 回 `wslGroups`/`remoteGroups`/`localProjects`。

## Requirements

- **合并 action hook**：`useWslActions` + `useRemoteActions` → 单个 `useProjectActions`（或 `useConnectionProjectActions`），环境相关差异通过 `environment` 分派或注入回调（参考 spec `code-reuse-thinking-guide.md` 的 callback 接口模式）
- **合并 project hook**：`useWslProjects` + `useRemoteProjects` → 与 `useLocalProjects` 统一，或收敛为单个按 environment 参数化的 hook；auth 作为 Remote 专属分支保留
- **合并 context**：`WslContext` + `RemoteContext` → 单个 `ConnectionProjectContext`（或直接并入统一 project context）
- **worktreeStore 去并行字段**：`wslActiveWtBranch`/`remoteActiveWtBranch` → 统一 `activeWtBranch`（key by projectId）；`wslOpenedWt`/`remoteOpenedWt` 同理
- **connection 边界归位**：`connection/` 只保留连接建立（`RemoteDialog`/`WSLDialog`/`RemoteAuthDialog`/`useRemoteAuthActions`/`services`），项目 hook 移入 `project/`
- **ProjectsPanel 去 re-group**：不再手动拆 wsl/remote/local 组；按统一 `environment` 分组渲染
- 两套并行类型系统的转换（`useCrossTypeSelection` / `ENV_TYPE_TO_VIEW_TYPE`）随之简化（命名收敛见 C5）

## Constraints

1. **依赖 C1**：统一 store（扁平 projects）是合并 hook 的前提
2. **auth 流程保留**：SSH 重连/认证是 Remote 专属，合并后不得丢失
3. **稳定引用**：所有 hook 返回函数保持 `useCallback` 包裹（项目 hook 设计原则）
4. **测试同步**：`useWslActions.test`/`useRemoteActions.test`/`useWslProjects.test`/`useRemoteProjects.test` 需重写为合并后的测试

## Acceptance Criteria

- [ ] `useWslActions` / `useRemoteActions` 合并为单一 action hook
- [ ] `useWslProjects` / `useRemoteProjects` 合并/统一
- [ ] `WslContext` / `RemoteContext` 合并为单一 context
- [ ] `worktreeStore` 无 `wsl*`/`remote*` 并行字段
- [ ] `connection/` feature 不再导出项目生命周期 hook（仅连接建立）
- [ ] `ProjectsPanel` 无手动 wsl/remote/local re-group
- [ ] `pnpm test:run` + `npx tsc --noEmit` 全绿

## Dependencies

- 依赖 C1。可与 C2/C4 并行。命名收敛（C5）在本 task 之后收尾。
