# 收敛命令执行三重枚举（GitTransportKind / ExecTarget / ProjectEnvironment）

## Goal

当前命令执行层面存在三个描述「项目/命令在哪个执行环境运行」的枚举——`ProjectEnvironment`、`ExecTarget`、`GitTransportKind`，它们拥有**完全相同的变体形状**（Local / Wsl{distro} / Remote{host,port,username,auth}），构成三重冗余 + 双向转换 + 泄漏方法的高耦合。本任务将它们收敛为「**一份规范 + 一份持久化视图**」：删除 `GitTransportKind`，让 `GitTransport` 直接 `impl for ExecTarget`。**不改变任何运行时行为**。

## 背景 / 已确认事实

### 三个枚举字段逐一相同

| 变体 | ProjectEnvironment | ExecTarget | GitTransportKind |
|------|-------------------|-----------|------------------|
| `Local` | ✓ | ✓ | ✓ |
| `Wsl{distro}` | ✓ (cfg win) | ✓ (无 cfg) | ✓ (cfg win) |
| `Remote{host,port,username,auth}` | ✓ | ✓ | ✓ |

### 耦合形态

```
ProjectEnvironment ──to_git_transport──▶ GitTransportKind ──exec_target()──▶ ExecTarget ──create_executor──▶ Box<dyn CommandExecutor>
        │                                        ▲
        └─────────────to_exec_target─────────────┘
```

1. **三重重复**：加一个字段要改 3 个 enum + 无数 match 臂。
2. **双向转换**：领域类型 `ProjectEnvironment` 同时依赖 `GitTransportKind` + `ExecTarget`；`GitTransportKind` 又依赖 `ExecTarget`。基础设施互相耦合，领域层向下渗。
3. **泄漏的 `GitTransport::exec_target()`**（transport.rs:189,545）：Git 抽象暴露「给我执行目标」。由 `resolve_project()` 返回 `Arc<dyn GitTransport>`（app_state.rs:117）逼出——调用方只想拿 ExecTarget 跑命令，却必须穿过 Git 抽象再掏出来。
4. **`#[cfg]` 不一致**：`ExecTarget::Wsl` 无 cfg（全平台存在，运行期报错），`ProjectEnvironment::Wsl` 与 `GitTransportKind::Wsl` 都 `#[cfg(target_os="windows")]`。同一概念三处门控不同。

## 方案（第一性原理）

三个枚举描述同一根轴线的三个消费视图：
- `ProjectEnvironment` —— 持久化/领域模型（serde，挂在 `Project` 上）
- `ExecTarget` —— 运行时调度键（`create_executor` → `Box<dyn CommandExecutor>`）
- `GitTransportKind` —— 包装 `impl GitTransport`

核心洞察：`GitTransportKind` **没有任何增量信息**，它唯一的存在理由是「我要实现 GitTransport」。既然字段与 `ExecTarget` 完全相同，直接让 `ExecTarget` 实现 `GitTransport`。

### 变更清单

1. **删除** `GitTransportKind` enum（transport.rs:195-215）及其全部 `impl GitTransport` match 臂（transport.rs:220-565）
2. transport.rs 改为 `impl GitTransport for ExecTarget`，match 臂解构 `ExecTarget`（逻辑逐行平移）
3. **删除** `GitTransport::exec_target()`（transport.rs:189 / 545-564）
4. **删除** `ProjectEnvironment::to_git_transport()`（project.rs:46-71）
5. `resolve_project()`（app_state.rs:117）改为返回 `(ExecTarget, String)`，不再包 `Arc<dyn GitTransport>`

### 目标依赖关系

```
ProjectEnvironment ──to_exec_target()──▶ ExecTarget
                                              ├──create_executor──▶ CommandExecutor
                                              └──impl GitTransport──▶ git 操作
```

`impl GitTransport for ExecTarget` 内部复用 `create_executor(self)`，天然对齐「Git 是 Executor 的一个特殊消费者」的分层。业务侧 `t.exec_target()` 直接消失（`t` 本身即 `ExecTarget`）。

## Requirements

1. 建立顶层 `src-tauri/src/platform/` 平台适配层（已有，非本任务）之外，将命令执行的三重枚举收敛为二重。
2. `GitTransportKind` 从代码库中移除；`GitTransport` 改为 `impl for ExecTarget`。
3. `GitTransport::exec_target()` 方法删除。
4. `ProjectEnvironment::to_git_transport()` 删除。
5. `resolve_project()` 返回 `(ExecTarget, String)`（或等价），不再返回 `Arc<dyn GitTransport>`。
6. 所有调用点（`file/commands.rs`、`git/commands.rs`、`agent/commands_commit.rs`、`app_state.rs` 等）改用新的 `ExecTarget` 直接消费。
7. **不改变任何运行时行为**：仅移动代码位置、统一接口、删除冗余类型。

## Acceptance Criteria

- [ ] `GitTransportKind` 从代码库中移除，无残留引用。
- [ ] `GitTransport` 由 `ExecTarget` 实现；`impl GitTransport for ExecTarget` 与旧 `GitTransportKind` 实现逐行为等价。
- [ ] `GitTransport::exec_target()` 方法已删除。
- [ ] `ProjectEnvironment::to_git_transport()` 已删除；`ProjectEnvironment::to_exec_target()` 保留。
- [ ] `resolve_project()` 返回 `ExecTarget`，不再返回 `Arc<dyn GitTransport>`。
- [ ] 业务代码中不再存在「穿过 Git 抽象掏 ExecTarget」（`t.exec_target()`）的反模式。
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 全部通过。
- [ ] `pnpm lint`（Rust fmt + clippy）通过，无 `-D warnings` 告警。

## Notes

- 保持 `ProjectEnvironment`（持久化）与 `ExecTarget`（运行时）两个类型，单向转换，不合并。
- 不重命名 `ExecTarget`。
- Wsl 的 `#[cfg]` 门控不一致问题不在本任务处理（out of scope）。
