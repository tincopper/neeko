# C4: 前端终端策略与缓存合并

> Parent: [07-16-env-scatter-cleanup](../07-16-env-scatter-cleanup/prd.md)

## Goal

合并前端终端的三路并行策略与缓存后端。三个策略已实现共享的 `TerminalStrategy` 接口，接近可折叠——主要差异只在 `createSession` 的 API 调用、`agentDelayMs`、`connectingMessage`。

## Background

| 并行项 | 行数 | 差异 |
|---|---|---|
| `strategies/local.ts` / `wsl.ts` / `remote.ts` | 105 / 75 / 107 | `createSession` API、`agentDelayMs`（本地即时 / WSL 500ms / SSH 800ms）、`connectingMessage` |
| `terminalCache.ts` 并行缓存 | — | `terminalCache`/`wslTerminalCache`/`remoteTerminalCache`、`refreshTerminal`/`refreshWslTerminal`/`refreshRemoteTerminal`、`launchAgentInWslTerminal`/`launchAgentInRemoteTerminal`、`getWslOpenProjectIds`/`getAllWslOpenProjectIds` |
| `WSLTerminalView.tsx` / `RemoteTerminalView.tsx` | 27 / 68 | 均为 `TerminalViewBase` + strategy hook 的薄封装 |

`EditorGroupPane.tsx`（L365-375）用内联 IIFE 检查 `p?.environment.type === 'Wsl'` 选择 View。

## Requirements

- **合并策略**：三个 strategy 文件 → 单个按 `ProjectEnvironment` 参数化的 strategy 工厂（或配置表 driven）。差异项（API 命令、`agentDelayMs`、`connectingMessage`）抽为按 environment 查表的配置
- **统一缓存**：`terminalCache` 三套 Map → 单个 key by cache-key 的 Map（cache-key 已含环境前缀，见 CLAUDE.md 终端缓存约定 `wsl:{distro}:{projectId}` / `remote:{entryId}:{projectId}`）；`refresh*` / `launchAgentIn*Terminal` / `get*OpenProjectIds` 收敛为单组函数
- **合并 View**：`WSLTerminalView` / `RemoteTerminalView`（+ Local）→ 单个 `TerminalView`，environment 作为 prop 驱动 strategy 选择
- `EditorGroupPane` 去内联 environment 判断，直接渲染统一 View

## Constraints

1. **依赖 C1**：统一 project（`environment` 字段）是策略参数化的前提
2. **PTY 存活语义不变**：终端在组件 unmount/remount 时保持存活（DOM detach/reattach）；cache-key 语义必须与后端一致
3. **agentDelayMs 保留**：本地即时 / WSL 500ms / SSH 800ms 的启动延迟差异必须保留（作为配置项，非删除）

## Acceptance Criteria

- [ ] 三个 strategy 文件合并为单个参数化 strategy
- [ ] `terminalCache` 单一缓存 Map + 单组操作函数，无 `wsl*`/`remote*` 并行
- [ ] `WSLTerminalView` / `RemoteTerminalView` 合并为单个 `TerminalView`
- [ ] `EditorGroupPane` 无内联 environment 分支
- [ ] agentDelayMs 差异以配置形式保留
- [ ] `pnpm test:run` + `npx tsc --noEmit` 全绿，终端缓存/复用回归无问题

## Dependencies

- 依赖 C1。可与 C2/C3 并行。
