# 设计：路径解析的异步边界

> 需求与验收见 `prd.md`；执行顺序见 `implement.md`。参照物是本仓库既有机制
> （`spawn_blocking` / `run_blocking` + 文档化的调用纪律），不引入新框架。

## 1. 第一性：边界画在哪

阻塞的是**文件系统调用**，不是「路径」这个概念。所以：

- **领域原语保持同步**（`RepoRef::resolve` / `UnitPath::resolve`）。它们必须能在 `#[cfg(test)]`
  里直接跑（无运行时），也必须能被「已经在阻塞池内」的代码复用；改成 async 会把 async 传染给
  领域模型与全部测试，并让「纯函数」这一属性消失。
- **异步边界只包住 fs 调用本身**：`UnitPath::resolve_async` 是唯一异步原语，命令层只准用它的外壳；
  两处域级入口（`resolve_repo` / `resolve_base`）在外壳之上各包一次，调用点只加 `.await`。

这与脚手架里 `ShortcutRegistry` 那条原则同构：**不要为了可测试性把领域逻辑绑到运行时上**；
反过来，也不要为了省一次 `spawn_blocking` 让领域原语直接踩运行时线程。

## 2. 职责分解（唯一改变理由）

| 单元 | 职责 | 本任务后**不再**承担 |
| --- | --- | --- |
| `common/git/unit_path.rs::UnitPath::resolve` | 同步原语：词法校验 + 双渲染（含 fs 归一） | 被异步命令直接调用 |
| `common/git/unit_path.rs::UnitPath::resolve_async`（新） | **唯一异步入口**：把 fs 调用隔离到阻塞池 + 错误穿透 | 任何领域判定（不重复实现归一） |
| `app_state.rs::AppStateWrapper::resolve_repo`（改 async） | git 域唯一解析入口：项目根 + worktree 两次解析一次 hop | 阻塞 fs（已移出 worker 线程） |
| `file/commands.rs::resolve_base`（改 async） | file 域基准目录解析，复用 `resolve_async` | 同上 |
| `git/commands/*`、`agent/commands_commit.rs`、`git/services/status.rs` | `.await` + 按角色取视图（identity / exec） | 直接触达 fs 归一 |

依赖方向不变：`commands → app_state / unit_path → repo_ref / path_guard`；
`platform/path_identity` 仍只被 `unit_path` 消费（红线 10 的分层不被打破）。

## 3. 契约

```rust
// common/git/unit_path.rs
pub fn resolve(target: &ExecTarget, raw: &str) -> Result<UnitPath>;             // 同步（原，改动前语义）
pub async fn resolve_async(target: &ExecTarget, raw: &str) -> Result<UnitPath>; // 新：spawn_blocking 包装

// app_state.rs
pub async fn resolve_repo(
    &self,
    project_id: &str,
    worktree_path: Option<&str>,
) -> Result<(ExecTarget, RepoRef), AppError>;
```

- **错误语义**：闭包内的领域错误（`..` / NUL / 非 UTF-8 / `canonicalize` 失败）逐字保留；
  仅当阻塞池 panic 或运行时关停时才产生新错误（`JoinError` → `path resolution task failed: …`，
  走 `AppError::Unknown`，与 `git/commands/worktree.rs::create_worktree` 既有的 `create_dir_all`
  包装一致）。判据：`.await.map_err(…)?` 之后再 `?` 一次，两级 `?` 缺一不可。
- **所有权**：`resolve_async` 内部把 `ExecTarget`（`Clone`）与 `&str` 复制成 owned 交给闭包；
  `resolve_repo` 对外签名保持 `Option<&str>`，内部 `map(str::to_string)` 后 move —— 调用点只加
  `.await`，参数写法零改动（29 处 diff 各一行）。
- **为什么一次 hop 而不是两次**：`resolve_repo` 要解析 root 与 worktree 两次；各自 hop 会让线程池
  往返翻倍，也会引入「root 与 worktree 各自的时间点」。一次闭包内跑完 = 同一时刻的同一份 fs 视图。

## 4. 风险与对策

| 风险 | 对策 |
| --- | --- |
| `State<'_, T>` 跨 `.await` 使命令 future 非 `Send` | `State` 是 `Send + Sync` 引用包装；`tauri::command` 的 `Send` 约束由编译器三端验证 |
| 命令的等待 / 顺序语义被改坏 | `wait_*_status_fresh` 的位置与顺序一行不动；护栏 `check_repo_unit_identity` 第 5/6 类判据仍须 0 违规 |
| 阻塞池被解析挤占 | 解析是微秒级、每命令一次；git 子进程与 watcher 早已占用阻塞池，量级不成比例 |
| 测试里的同步调用被误改成 async | 保留 `UnitPath::resolve` 给测试；`file/commands.rs:237-246` 改为 `#[tokio::test]`（它断言的是 `resolve_base` 主体，改为 await 后语义不变） |
| 漏改调用点 | 编译器驱动（改签名后 `cargo check` 逐处报错）+ Acceptance 的 `rg` 复核 |

## 5. 测试策略（TDD）

1. **Red → Green（已做）**：`async_entry_matches_sync_entry` —— 异步入口 ≡ 同步入口
   （identity / exec 逐字相同）+ 拒绝错误穿透（校验 `..` 文案未被 `JoinError` 覆盖）。
2. 调用点改造不含新逻辑 ⇒ 由既有回归兜底：`cargo test --lib`（1385）与 `pnpm test:fe`（4483）
   必须逐条不变；任何一条变动都说明改了行为。
3. 门禁：`cargo clippy -- -D warnings`、`pnpm lint`（8 护栏）、`pnpm check`。
