# 领域模型：App → Project → Workspace

> **本文是领域分层术语的唯一定义处。** 其它 spec / 代码注释只引用、不复述定义
> （复述会让同一条术语在不同文件里各自漂移）。
>
> 与 `docs/ARCHITECTURE.md`（技术架构）互补：本文只回答「这些名词各指什么、谁拥有谁」。

---

## 分层

```text
App
 └ Project                                  （environment、agent/ide 配置、主仓登记路径）
      └ Workspace   kind: Main | Worktree     ← 能力容器 / 隔离与寻址单位
           ├ checkout : { path, kind, branch, HEAD }   ← 仓库信息是属性
           ├ root     : 目录（scope 基准）
           └ ide / agent / editor / debug / lsp / terminal
```

## 术语表

| 术语 | 含义 | 基数 | 归属 |
| --- | --- | --- | --- |
| **`App`** | 应用进程/窗口；持有当前打开的全部 project（`SessionStore` 持久化其集合与激活态） | 1 | 顶层 |
| **`Project`** | 用户添加的一个**逻辑产品**；属性：`environment`(Local/WSL/SSH)、agent/ide 配置、主仓登记路径 | 1..N | — |
| **`Workspace`** | Project 下的一个**独立工作空间**：承载 IDE / Agent / editor / debug / LSP / terminal 的状态；是这些功能状态的**隔离与寻址单位** | 1..N per Project | 中间层 |
| **`workspace.checkout`** | 该 workspace 对应的 git 工作副本（**属性**）：`{ path, kind: Main \| Worktree, branch, HEAD }` | 1 per Workspace | Workspace 属性 |
| **`workspace.root`** | 该 workspace 的根目录 = scope 基准 = `${workspaceFolder}` = LSP workspace root | 1 per Workspace | Workspace 属性 |

## 等价关系（跨栈契约）

- `workspace.root` ≡ DAP launch 的 `${workspaceFolder}` ≡ LSP `workspace/workspaceFolders` 的项。
- `WorkspaceKey`（TS）/ `WorkspaceRef::key()`（Rust）≡ `workspace.checkout` 的**身份**（属性，不是容器名）。
  它**保留现名不改**：改 wire 契约（`workspace_key`）零功能价值、高迁移风险。
- `WorkspaceRef` / `CheckoutPath`（`src-tauri/src/common/git/`）是 `workspace.checkout` 的引用与其路径值对象。
- LSP 的 `WorkspaceEdit` / `workspace/workspaceFolders` 是**协议名词**，与本领域对象 `Workspace`
  处于不同命名空间，二者**不冲突**；不需要（也不允许）为规避而改协议名。

## 判据：该用哪个词

| 问题 | 用 |
| --- | --- |
| 这是哪个应用/窗口？ | `App` |
| 这是哪个逻辑产品（环境、agent/ide 偏好）？ | `Project` |
| 这是哪个可独立打开/编辑/运行的工作空间？ | `Workspace` |
| 这个 workspace 对应的 git 工作副本在哪、什么分支？ | `workspace.checkout` |
| 文件读写 / cwd / 适配器 workspace 的基准目录？ | `workspace.root` |

## 不变量

1. **一个概念一个名字；属性不进容器名。** 「仓库」是 `Workspace` 的属性（`checkout`），不单独成层。
2. **功能状态的隔离边界 = `Workspace`。** editor / terminal / status / watcher 已按 `Workspace` 分槽；
   agent / debug / LSP 的目标态亦如此（当前部分仍按 `Project`，属待补缺口）。
3. **`repo = 一个完整业务逻辑` 是经验规律，不是不变量。** worktree 常对应一个 feature/branch，
   但主仓也是一个 checkout；不要把它写进类型或命名。

## 命名边界规则（判定新符号的唯一判据）

一个词只命名一类事物：

| 词 | 只允许命名 | 例 |
| --- | --- | --- |
| `Workspace` | **容器**（承载 IDE/Agent/editor/debug/LSP/terminal 的状态） | `workspaceStore` / `WorkspaceRef` / `useWorkspaceState` / `activeWorkspaceRoot` |
| `checkout` | 容器的 **git 属性**（路径 / 分支 / kind） | `Checkout` / `CheckoutPath` / `activeCheckoutPath` / `openedCheckouts` |
| `worktree` | **仅 git 原生** | `create/remove/rename_worktree`、`WorktreeList`、`isWorktreeDirty`、`canonicalWorktreePath`、linked-vs-main 类型谓词 `isActiveWorktree` |
| `RepoKey`/`repo_key` | （已退役）→ `WorkspaceKey` / `workspace_key` | — |

**勿与历史已删除符号混淆**：`activeWorktreePath` 曾是一个已删除的 store 镜像字段名；注释/历史文档里保留它是为了记录
「为什么删」，**不得**把它当当前字段用（护栏 `check_workspace_identity` 按符号拦截）。

**持久化例外**（改名需迁移，登记为不动）：`worktree_state`（sessions.json 字段）、`repo_key_prefix`（git 缓存键前缀）。

## 寻址根 vs 展示根（文件 IO 契约）

文件读写的**地址 = `WorkspaceSession`**（`{ projectId, worktreePath }`，`worktreePath === null` = 主 checkout）；
后端由 `AppStateWrapper::resolve_workspace` **唯一解析**出**寻址根**（= `workspace.root`，宿主形态）。

- **寻址根**：`workspace` 地址对象 → 后端解析（`read_file` 的 `InProject` scope、watcher/gitignore 根同源）。
  前端**不**传任意 root 路径（那会把同一份身份变成散参，且在 worktree 下默认值恒错）。
- **展示根**：`workspaceRootOf(workspaceKey, projectRoot)`（前端主机绝对路径），只用于路径相对化 / 同文件判定；
  与寻址根**不得**混用为同一个 `rootPath`。

**编辑 tab 组键 = checkout 的身份 `WorkspaceKey`**（唯一编码；`:wt:` 已退役）。

## 未完成（登记）

- 若某子系统的状态键仍是 `Project`（如 debug 活动会话、LSP 会话根），它尚未达到「按 `Workspace` 隔离」——
  这是能力边界缺口，与命名无关。
- 命名迁移（`App → Project → Workspace`、`RepoKey`→`WorkspaceKey`、`RepoRef`→`WorkspaceRef`、
  `repo_key`→`workspace_key` 等）已在本任务全部落地；完整映射见
  `.trellis/tasks/10-08-workspace-naming/design.md` 的 Tier 表。
- **刻意保留**：`repo_key_prefix`（git 缓存键前缀，非单元身份）、LSP `WorkspaceEdit` /
  `${workspaceFolder}`（协议/外部约定名）。
