# 并发指南

> Rust 后端中的线程与同步模式。

---

## 概述

后端混合使用 **OS 线程**（用于 PTY I/O）和 **tokio**（用于 SSH I/O 和 Tauri 异步命令）。共享状态通过 `std::sync::Mutex` 和 `Arc<Mutex<HashMap>>` 同步。

---

## 线程模型

### 每个本地终端会话：2 个 OS 线程

| 线程 | 名称 | 用途 |
|------|------|------|
| 读取器 | `pty-reader-{id[..8]}` | 以 4KB 块读取 PTY 输出，发送 `terminal-output-{id}` 事件 |
| 监视器 | `pty-watcher-{id[..8]}` | 每 100ms 轮询 `child.try_wait()`，退出时发送 `terminal-closed-{id}` |

### 每个 SSH 终端会话：1 个 OS 线程

| 线程 | 名称 | 用途 |
|------|------|------|
| I/O | `ssh-io-{id[..8]}` | 运行独立的 `tokio::runtime::Runtime`，通过 `tokio::select!` 多路复用输入/输出/调整大小 |

### 每个已挂载仓库单元：文件监视线程（git 单元另加 status 生产者）

粒度是**仓库单元**（`RepoRef::key()`），不是 project —— 一个 project 有 1 + N 个单元
（linked worktree 各有一套 HEAD / index / workdir）。

- 文件监听：由 `notify` crate 的 debouncer 管理 —— 1 个防抖线程 + 1 个轮询线程（10 秒间隔）；
- git 单元另加：`GitStatusWorker`（status 的 push 生产者）+ `ThrottleScheduler`（合并 notify
  事件驱动 `worker.check()`）+ git-meta 监听（`.git/HEAD` 等，外部切分支时刷新）；
- 非 git 单元只保留文件监听，不启动任何 git 资源。

「每项目至多一套挂载资源」是用户决策 D-B：并发挂载的原子化与释放范围见本文件
「后台线程资源所有权」小节。

### 线程命名约定

```rust
std::thread::Builder::new()
    .name(format!("pty-reader-{}", &session_id[..8]))
    .spawn(move || { ... })
    .ok();
```

始终为线程命名以便于调试。会话 ID 使用 `{id[..8]}` 缩写。

---

## 同步原语

### `Mutex<T>` —— 用于不频繁修改的状态

在 `AppStateWrapper` 中用于需要外部修改的 Manager：

```rust
pub struct AppStateWrapper {
    project_manager: Mutex<ProjectManager>,
    agent_manager: Mutex<AgentManager>,
    active_project_id: Mutex<Option<String>>,
    // ...
}

// 在命令中的使用（内部锁用 expect，外部状态锁用 map_err）
let sessions = self.sessions.lock().expect("infallible: sessions lock");
let mut pm = state
    .project_manager
    .lock()
    .map_err(|e| AppError::LockPoisoned(e.to_string()))?;
```

### `Arc<Mutex<HashMap<String, T>>>` —— 用于并发会话映射

在 `TerminalManager` 和 `RemoteTerminalManager` 中用于会话集合：

```rust
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    pty_handles: Arc<Mutex<HashMap<String, PtyHandle>>>,
}
```

`Arc` 允许跨线程共享。每个线程在派生前克隆 `Arc`：

```rust
let sessions = self.sessions.clone();  // Arc 克隆
let handles = self.pty_handles.clone();

std::thread::Builder::new()
    .name(format!("pty-reader-{}", &id[..8]))
    .spawn(move || {
        // 通过 Arc 访问 sessions 和 handles
        let mut map = sessions.lock().expect("infallible: pty sessions");
        // ...
    })
    .ok();
```

### `Arc<AtomicBool>` —— 用于停止信号

在 `WatcherManager` 中用于通知轮询线程停止：

```rust
let stop = Arc::new(AtomicBool::new(false));
let stop_clone = stop.clone();

std::thread::spawn(move || {
    while !stop_clone.load(Ordering::Relaxed) {
        // 轮询...
        std::thread::sleep(Duration::from_secs(10));
    }
});

// 停止时：
stop.store(true, Ordering::Relaxed);
```

### 后台线程资源所有权 —— 单一强所有者 + Weak 借用者（watcher 生命周期与挂载契约）

> 2026-09-24 缺陷沉淀：旧 watcher 不释放（同一变更 emit 多次、每次项目激活泄漏一套线程），
> 根因是 `spawn_maintenance_thread` 强持有 `Arc<Mutex<RecommendedWatcher>>`，而退出条件
> `rx.recv()` 断开依赖的 `maintenance_tx` clone 又被 notify 闭包（活在 watcher 内）持有 ——
> **双向保活**，`unwatch` 只置 stop_signal 而仅心跳线程轮询它。

**契约**（`common/file/watcher/`）：

1. **单一强所有者**：`WatcherHandle` 聚合**该仓库单元**全部运行资源（watcher / 线程 / 发送端），
   drop 即释放。后台辅助线程（maintenance）一律持 `Weak`：每条消息 `upgrade()`，失败即
   `break`——「所有者已释放 ⇒ 无需再维护」，**复用既有的断开即退出语义，不新造停机协议**。
2. **入口幂等**：`watch()` 遇同 key 已注册 → `log::warn!` 直接返回。**key 的粒度是仓库单元
   （`RepoRef::key()`），不是 project** —— 一个 project 有 1 + N 个单元（linked worktree 的
   HEAD / index / workdir 各自独立），按 project 幂等会把 worktree 的挂载判成「已注册」而
   整块跳过（`common/git/repo_ref.rs`，详版 `git-domain.md` §12）。重复注册会**翻倍投递事件
   并再泄漏一套线程**，不变量必须在所有者入口强制，而非依赖调用方自觉。
3. **挂载临界区原子化**：`release_except` + `watch` 这一对必须由 `mount_only(repo, sink)` 在
   **同一个临界区**内完成（`mount_lock: Arc<Mutex<()>>`）。单线程下「先释放再挂载」看起来等价，
   但两个并发的 `activate`（快速切项目 / 连点）会交错成 `c1.release, c2.release, c1.watch,
   c2.watch` ⇒ 两套挂载常驻。**不变量属于资源所有者**：只要调用方还需要记得调用顺序，
   它就不是不变量，而是约定。锁内走无锁内核 `release_except_inner`（否则自死锁）。
4. **事件出口依赖倒置**：watcher 域不接触 Tauri `AppHandle`——统一走
   `WatcherEventSink`（`sink.rs`，`WatcherEvent` 枚举 + 单方法 trait），生产适配器
   `AppHandleSink` 在组合根注入。这同时让**无 GUI 契约测试**成为可能
   （`lifecycle_tests.rs` 注入 `CollectingSink`）。
5. **契约测试必须 Red 验证**：新加的生命周期测试要临时回退修复确认会失败
   （当年 4/5 失败、恢复后 5/5 绿），否则「恰好绿」抓不住回归。并发不变量尤其如此 ——
   去掉 `mount_lock` 后 `concurrent_mount_*` 用例必须（在布障同步下）稳定变红，
   否则用例只是顺序重复了一遍。

**Wrong**：新建后台线程时把 `Arc<T>` clone 进线程，又把回传的 sender 存进 `T` 内部——
环形强引用让「断开即退出」永不触发。
**Correct**：线程持 `Weak<T>` + 每消息 `upgrade()`；或确保持有的引用链严格单向（所有者 → 线程）。

**Wrong**（挂载）：调用方依次写 `manager.release_except(&keep); manager.watch(repo, sink);` ——
两步各自加锁，中间那段敞开着，并发调用即可留下两套挂载。
**Correct**（挂载）：只调 `manager.mount_only(repo, sink)`；锁在所有者内部，调用方无从破坏顺序。

### `tokio::sync::mpsc::UnboundedSender/Receiver` —— 用于 SSH I/O 通道

用于将输入和调整大小事件从 Tauri 事件处理器传递到 SSH I/O 线程：

```rust
let (input_tx, mut input_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
let (resize_tx, mut resize_rx) = tokio::sync::mpsc::unbounded_channel::<(u32, u32)>();
```

---

## tokio 的使用

尽管配置了 `tokio = { features = ["full"] }`，tokio 的使用范围有限：

1. **Tauri 的异步运行时** —— 运行异步命令（`create_remote_terminal_session` 等）
2. **SSH I/O 线程** —— 创建独立的 `tokio::runtime::Runtime` 并使用 `block_on`
3. **`tokio::select!`** —— 多路复用 SSH 通道的读/写/调整大小
4. **`tokio::io::AsyncWriteExt`** —— 写入 SSH 通道

本地终端操作**完全同步/基于线程** —— 不涉及 tokio。

### `core::exec` 的同步桥语义（`collect_blocking` / `collect_blocking_with` / `spawn_detached` / `command_exists_blocking`）

同步桥内部通过 `block_on_sync` 在**临时 runtime** 上驱动 future，因此**不借用调用方 runtime、任何上下文都不 panic**：

- 无 runtime 上下文时 → 在本线程直接跑；
- 已在 runtime 内时 → 自动改到独立 OS 线程执行，并用 `log::warn!` 记录调用点。

所以「会不会 panic」不是判断依据，**「在 async driver 线程里做同步阻塞」才是性能反模式**。分工：

| 场景 | 该用什么 |
|------|----------|
| async 命令 / async manager | async 变体 `run` / `collect` / `command_exists` |
| 同步逻辑整体很多 | `tokio::task::spawn_blocking` 或 `common::runtime::run_blocking` |
| 独立 OS worker 线程（如 `status_worker`） | 同步桥，允许 |
| 同步 `#[tauri::command]` | 同步桥，允许 |

（原 AGENTS.md 审查红线 1 的同步桥段落，2026-09-25 迁入；红线主干见 `src-tauri/AGENTS.md`。）

---

## 通信：前端 <-> 后端

### Tauri 事件用于流式数据

终端 I/O 使用 Tauri 事件（不是命令返回值）：

```rust
// 后端发送输出
app_handle.emit(&format!("terminal-output-{}", session_id), &output_bytes)?;

// 前端监听
listen<number[]>(`terminal-output-${sessionId}`, (event) => { ... });
```

```rust
// 前端通过事件发送输入
emit(`terminal-input-${sessionId}`, inputBytes);

// 后端监听
app_handle.listen(&format!("terminal-input-{}", session_id), move |event| { ... });
```

### 命令用于请求/响应

一次性操作使用命令：

```rust
invoke<GitInfo>("get_git_info_command", { path })
```

---

## Scenario: 本地终端关闭不阻塞 IPC

### 1. Scope / Trigger

- Trigger：关闭运行中 Agent（如 Claude/Codex/opencode）的终端 tab 时，子进程可能不响应 SIGTERM，`graceful_kill` 最多等待 3 秒。
- Scope：`close_terminal_session` 命令、`TerminalManager` 会话映射、PTY handle 清理、前端 terminal cache 销毁。

### 2. Signatures

```rust
#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>)

impl TerminalManager {
    pub fn close_session_in_background(&self, session_id: &str);
    pub fn close_session(&self, session_id: &str);
}
```

### 3. Contracts

1. 前端 tab 关闭调用 `close_terminal_session` 时，命令必须快速返回，不等待 `graceful_kill` 完成。
2. `close_session_in_background` 先从 `sessions` 和 `pty_handles` 移除会话，再派生 `pty-close-{id[..8]}` 线程关闭 PTY。
3. 后台关闭线程负责注销 input listener、drop PTY master、执行 `graceful_kill`。
4. `close_all_sessions` 仍可使用同步 `close_session`，保证应用退出时尽量完成资源清理。
5. 禁止在持有 `pty_handles` 锁时执行 `graceful_kill` 或其他可能阻塞的进程等待。

### 4. Validation & Error Matrix

| 场景 | 预期行为 | 错误风险 |
|------|----------|----------|
| 关闭普通 shell tab | IPC 快速返回，后台线程完成关闭 | 无 |
| 关闭运行中 Agent tab | UI 不等待 3 秒；后台超时后 SIGKILL | 若同步等待会导致 tab 关闭卡顿 |
| 后台线程创建失败 | 记录错误，不阻塞命令返回 | handle 会随闭包 drop，需关注日志 |
| 应用退出 close_all_sessions | 同步遍历关闭剩余会话 | 退出路径允许等待资源清理 |

### 5. Good/Base/Bad Cases

- Good：`close_terminal_session` 调用 `close_session_in_background`，前端立即完成 tab 状态更新。
- Base：后台线程里执行 `close_pty_handle(session_id, handle)`，统一清理 listener/master/child。
- Bad：命令层直接调用同步 `close_session`，导致 Agent 不退出时 IPC 等满 `GRACEFUL_TIMEOUT_SECS`。

### 6. Tests Required

- 单元/集成可测点：关闭命令调用后，`sessions` 与 `pty_handles` 立即移除对应 id。
- 回归验证点：运行 Agent 后关闭 tab，前端 `close_terminal_session` 的 Promise 不应接近 `GRACEFUL_TIMEOUT_SECS`。
- 日志验证点：后台仍可看到 `PID ... did not exit ... SIGKILL`，但 UI 不被这段等待阻塞。

### 7. Wrong vs Correct

#### Wrong

```rust
#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.terminal_manager.close_session(&session_id);
}
```

#### Correct

```rust
#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state
        .terminal_manager
        .close_session_in_background(&session_id);
}
```

---

## Scenario: 命令入口的路径解析不阻塞 worker（路径归一 = 阻塞 fs）

### 1. Scope / Trigger

- Trigger：命令入口把「项目 + worktree 路径」解析成仓库单元身份时会走 `exists` / `canonicalize`
  （同步阻塞 fs）。网络盘 / 无响应挂载点上单次调用可阻塞到秒级，而这条路径位于**每次
  git / file 命令的入口** ⇒ 同一 worker 承载的 PTY 输出、watcher 事件与 IPC 全部停摆。
- Scope：`AppStateWrapper::resolve_repo`（29 处调用点）、`file/commands.rs::resolve_base`（8 处）、
  命令层直连的 `UnitPath::resolve`（6 处）、`file/commands.rs::read_dir_tree` 的单元身份解析（1 处）、
  `common/git/operations/info.rs::get_git_branch_info_shell` 的清单逐条归一（1 份清单）；
  以及**仓库打开 / 校验**这一类（2026-10-02 补齐）：`transport.open_repo`（git2 `Repository::open`）、
  `local::assert_git_repo`、`is_git_repo` 的 Local 分支。
  例外（已在阻塞池内，无需再包）：`common/git/local/worktree.rs::get_worktrees` —— 只在
  `info.rs` 的 `spawn_blocking` 闭包内被调用；`operations/worktree.rs::normalized_worktree` ——
  同步函数，调用方（`parse_worktree_list`）在阻塞池里等它。

### 2. Signatures

```rust
// 领域原语（同步、纯 + fs）：单元测试与「已在阻塞池内」的代码用
pub fn resolve(target: &ExecTarget, raw: &str) -> Result<UnitPath>;

// 唯一异步入口：把 fs 调用隔离到阻塞池
pub async fn resolve_async(target: &ExecTarget, raw: &str) -> Result<UnitPath>;

// 仓库打开 / 校验同构：同步核心 + 异步入口成对提供（同步核心只给「已在池内」的调用方）
fn open_repo(&self, path: &str) -> Option<git2::Repository>;              // 池内
async fn open_repo_async(&self, path: &str) -> Option<git2::Repository>;  // 无默认实现
pub fn assert_git_repo(path: &Path) -> Result<()>;                        // 池内
pub async fn assert_git_repo_async(path: &str) -> Result<()>;

// 域级入口（async，各自只包一次 spawn_blocking）
pub async fn resolve_repo(&self, project_id: &str, worktree_path: Option<&str>)
    -> Result<(ExecTarget, RepoRef), AppError>;                       // app_state.rs
async fn resolve_base(target: &ExecTarget, root_path: Option<&str>, wd: &str)
    -> Result<String, AppError>;                                      // file/commands.rs
```

### 3. Contracts

1. 命令层（`#[tauri::command] async fn`）只允许经 `resolve_async` / `resolve_repo` / `resolve_base`
   触达路径归一，**禁止**直接调同步的 `UnitPath::resolve` / `RepoRef::resolve`。
2. 领域原语保持同步：要能在 `#[cfg(test)]` 里无运行时直接跑，也要能被已在阻塞池内的代码复用
   （把领域模型改成 async 会把 async 传染给全部测试与调用方）。
3. `resolve_repo` 用**一次** `spawn_blocking` 包住「项目根 + worktree」两次解析：一次 hop，
   且两次解析共用同一时刻的 fs 视图。
4. 错误两级穿透：闭包内的领域错误（`..` / NUL / 非 UTF-8 / `canonicalize` 失败）逐字保留；
   只有 `JoinError`（阻塞池 panic / 运行时关停）才映射为 `AppError::Unknown`。
5. `spawn_blocking` 不可取消：本场景不引入超时语义。
6. 需要解析**一批**路径（如 `git worktree list` 的清单）时，一次 `spawn_blocking` 包住整批：
   逐条 hop 会把线程池往返乘以条目数，并让批内结果来自不同时刻的 fs 视图。
7. 同一命令里若两个返回值来自**不同的解析语义**（如 `resolve_base` 的空路径回落 vs 单元身份），
   保持各自一次 hop，不要为省一次往返而合并 —— 合并会顺手改变语义（行为变更不在本场景范围）。
8. **成对提供，异步层只许用异步入口**：每个阻塞原语都有「同步核心 + 异步入口」两件套
   （`UnitPath::resolve` / `open_repo` / `assert_git_repo` 是核心；`*_async` 与 async trait 方法是入口）。
   异步 trait 方法里直接调同步 helper 就是**假异步**（契约与实现相反）。
9. **异步入口不设默认实现**：trait 默认体只能回落同步核心 ⇒ 未来的 impl 会「默认阻塞」。
   缺实现时编译器报错，比默认值安全。
10. 护栏：`tools/guards/checks/check_blocking_fs_in_commands.py`（判据 = 同步原语 ∧ `async fn` 体内
    ∧ 不在 `spawn_blocking` / `run_blocking` / `run_blocking_result` 括号内；`std::fs::*` 刻意不收，
    见该文件文档）。判据在**抹平注释与字面量后的等长文本**上做字符配对 —— 原始文本上的配对会被
    `// 结束 }` 截断函数体（漏报）、被闭包里的 `'('` 破坏配平（误报），两个形态都有回归用例。

### 4. Validation & Error Matrix

| 场景 | 预期行为 | 错误风险 |
|------|----------|----------|
| 存在的 worktree（Local） | worker 不阻塞；结果与同步版逐字相同 | 直连同步原语 ⇒ 挂起 worker |
| 不存在的目标路径（create / rename） | 一次 hop 内完成「最深已存在祖先」锚定（syscall 数量级 = 路径深度） | 同上，且次数被放大 |
| 路径含 `..` / NUL / 非 UTF-8 | 领域错误原样返回 | 两级 `?` 缺一个即被 `JoinError` 文案覆盖 |
| 阻塞池 panic / 运行时关停 | `AppError::Unknown`（`path resolution task failed`） | 与领域错误混淆会让用户看到错误提示 |

### 5. Good/Base/Bad Cases

- Good：`let (t, repo) = state.resolve_repo(&project_id, worktree_path.as_deref()).await?;`
- Base：`resolve_base` 内部先 `UnitPath::resolve_async(target, path).await`，再投影 `.exec()`。
- Bad：`let worktree_path = UnitPath::resolve(&t, &worktree_path)?;` 直接写在
  `#[tauri::command] async fn` 里。
- Bad（仓库打开/校验类，2026-10-02 修）：`crate::common::git::local::assert_git_repo(...)?` 与
  `transport.open_repo(work_dir)` 直接写在 `pub async fn get_git_info` 里 → 改用
  `assert_git_repo_async(...).await` / `transport.open_repo_async(...).await`。

### 6. Tests Required

- `unit_path::tests::async_entry_matches_sync_entry`：异步入口 ≡ 同步入口（identity / exec 逐字）
  + 校验错误穿透（`..` 文案不得被 `JoinError` 覆盖）。
- `local::diff::tests::assert_git_repo_async_matches_sync_core`：仓库校验的同步核心 / 异步入口同结果，
  `not a git repository` 原样穿过异步边界。
- `transport::tests::test_local_open_repo_async_matches_sync_core`：`ExecTarget::Local` 的
  `open_repo_async` 必须真的打开仓库（其余 impl 全是返回 `None` 的假实现，无此直测则该分支
  坏了也全绿 —— 它是「静默退化到 shell 兜底」的唯一哨兵）。
- 护栏单测（框架强制）：`tools/guards/tests/test_check_blocking_fs_in_commands.py` —— 违规三形、
  同步函数体、池内闭包（`spawn_blocking` / `run_blocking` / `run_blocking_result` 三形态）、
  异步入口、`#[cfg(test)]` 豁免、scope 外文件；外加**判据自身的健壮性**：注释里的 `}`、闭包里的
  `'('`、`mod tests;` 分号形态、`use` 导入后的裸名（四个都曾是真实漏报 / 误报窗口）。
- 回归：`cargo test --lib` 与 `pnpm test:fe` 逐条不变 —— 这是「只改边界、不改行为」的判据。

### 7. Wrong vs Correct

#### Wrong

```rust
#[tauri::command]
pub async fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let (t, _wd) = state.resolve_project(&project_id)?;
    // 阻塞 fs 跑在 worker 线程上
    let worktree_path = UnitPath::resolve(&t, &worktree_path)?;
    operations::is_worktree_dirty(&t, worktree_path.exec())
        .await
        .map_err(AppError::from)
}
```

#### Correct

```rust
#[tauri::command]
pub async fn is_worktree_dirty(
    project_id: String,
    worktree_path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<bool, AppError> {
    let (t, _wd) = state.resolve_project(&project_id)?;
    // 阻塞 fs 落阻塞池
    let worktree_path = UnitPath::resolve_async(&t, &worktree_path).await?;
    operations::is_worktree_dirty(&t, worktree_path.exec())
        .await
        .map_err(AppError::from)
}
```

---

## Scenario: 进程树兜底（清理脱离进程组的 Agent 残留）

### 1. Scope / Trigger

- Trigger：关闭本地 Agent tab 后，对应 Agent 进程（或其派生子进程）仍残留不退出。
- 根因：`portable-pty` 用 `setsid()` 让 shell 成为会话/进程组 leader（PGID==PID），`graceful_kill` 发信号到 `-PGID` 只能覆盖**仍在组内**的进程。部分 CLI（Agent、语言服务器、daemon）自行 `setsid()` 脱离进程组，成为孤儿。
- Scope：`terminal::process_reaper`（枚举 + 终止）、`close_pty_handle` 的 Unix 分支。

### 2. 判定规则

进程属于某 PTY 会话（root 为 shell PID），满足任一即收编：

1. `pid == shell_pid`（shell 自身）
2. `sid == shell_pid`（同会话，未脱离）
3. 从 `ppid` 向上递归可达 `shell_pid`（脱离组但仍是后代，覆盖 daemonize 前/未完全脱离的场景）

### 3. Contracts

1. `close_pty_handle` 先 `graceful_kill`（进程组 SIGTERM→2s→SIGKILL），随后调 `reap_session_tree(shell_pid)` 兜底。
2. 兜底对命中进程 SIGTERM → 复用 `GRACEFUL_TIMEOUT_SECS` → SIGKILL；已死进程自动跳过（`kill(pid,0)` 检测）。
3. 平台枚举：
   - **macOS**：`libproc` crate（`pids_by_type(ProcFilter::All)` + `pidinfo::<BSDInfo>` 拿 `pbi_ppid` + `libc::getsid`）。
   - **Linux**：遍历 `/proc/<pid>/stat`，按 `rsplit_once(')')` 后解析 ppid（fields[1]）与 session（fields[3]）。
   - **Windows**：不参与——Job Object 已覆盖全树（`services.rs` `close_pty_handle` Windows 分支）。
4. 全流程在 `pty-close-{id}` 独立 OS 线程执行，满足阻塞 I/O 隔离红线，不接触 tokio。

### 4. Validation

| 场景 | 预期 |
|------|------|
| shell 正常退出 | 兜底无可收编进程，跳过 |
| Agent 子进程 setsid 脱离 | 通过 ppid 祖先链被收编并终止 |
| 进程已死/竞态消失 | `kill(pid,0)` 失败即跳过，SIGKILL 无害 |
| Windows | 走 Job Object，不编译 reaper 代码 |

- 单元测试：`terminal::process_reaper::tests` 用真实 `fork`+`setsid` 构造脱离进程验证收集与终止（macOS/Linux）。

## Scenario: 终端输出信用拉取与有界合流泵（08-25 内存治理）

### 1. Scope / Trigger

- Trigger：旧链路 `PTY 4KB read → emit(Vec<u8>) → JSON number[] (~6x) → listen → term.write()` 全链路无界，WebContent 8.7min 膨胀至5.2GB，microtask 68% `arrayPush+realloc`。
- Scope：`terminal/pump.rs`（合流泵）、`common/terminal/drain.rs`（有界信用队列）、`terminal/services.rs`（reader泵接入）、`terminal/manager.rs`与`terminal/remote.rs`（双后端同构）、前端`shared/utils/drainLoop.ts`/`fitScheduler.ts` + `TerminalViewBase`。

### 2. Signatures

```rust
pub(crate) struct PumpConfig { pub max_buffer: usize, pub flush_interval: Duration, pub pause_poll: Duration }
impl Default for PumpConfig { fn default() -> Self { Self { max_buffer: 256*1024, flush_interval: 16ms, pause_poll: 2ms } } }
pub(crate) fn run(reader: Box<dyn Read+Send>, cfg: &PumpConfig, flush_fn: impl FnMut(&[u8])->bool) -> PumpOutcome
#[cfg(unix)] pub(crate) fn run_polling(fd: RawFd, reader: Box<dyn Read+Send>, cfg: &PumpConfig, flush_fn: impl FnMut(&[u8])->bool) -> PumpOutcome
pub(crate) struct SessionDrain { buffer: Mutex<DrainBuffer>, wake_in_flight: AtomicBool, closed: AtomicBool }
impl SessionDrain {
    pub(crate) fn push(&self, bytes: &[u8], wake: impl FnOnce()) -> bool // 满载返回false（泵停读），closed时黑洞返回true
    pub(crate) fn take_and_rearm(&self, wake: impl FnOnce()) -> Vec<u8> // 取空并补发竞态wake，closed时永不重臂
    pub(crate) fn close(&self)
}
pub(crate) type SessionDrainMap = Arc<Mutex<HashMap<String, Arc<SessionDrain>>>>;
#[tauri::command] pub async fn terminal_drain(session_id: String, state: State<'_, AppStateWrapper>) -> Result<tauri::ipc::Response, AppError>
```

### 3. Contracts

1. **合流**：`flush_interval 16ms`内多段read合并为一次`flush_fn`，事件频率≤60Hz；`max_buffer 256KB`达阈立即flush。
2. **有界**：`DrainBuffer 512KB`（> pump 256KB，数学上排除单批死锁）；`push`在非空且`len+bytes>512KB`时返回`false`，泵`sleep(pause_poll)`重试，不丢字节。
3. **背压**：`false`时泵停读，内核PTY缓冲承压→前台`write`阻塞（终端正确语义）；前端`MAX_IN_FLIGHT_WRITES=8`门闸，`pendingWrites>=8`时`runDrainLoop`提前退出，余量由下次轮询 tick 续拉。
4. **二进制**：`terminal_drain`返回`Response::new(Vec<u8>)`，前端`invoke<ArrayBuffer>`零JSON，走 custom protocol fetch（零 eval）。
5. **去事件化（方案 B）**：`terminal-drain-{id}` wake hint 已退役——调用点（`services.rs` reader flush、`remote.rs` SSH-IO push、双端 `take_and_rearm` 竞态补发）均传空闭包，不再 `emit`。原因：macOS 上 Tauri 事件送达 = 每次 `evaluateJavaScript`，WebKit 无条件对完成值克隆+stringify，高吞吐下 JSC libpas mapped 内存只增不减（WebContent RSS 实测 22GB+，JS live 堆零增长）。前端改为全局共享轮询器（`drainLoop.ts` `createPollingDrainScheduler`，100ms tick）驱动 credit-pull，invoke 走 fetch 零 eval 零克隆。`push`/`take_and_rearm` 的 wake 参数与 `wake_in_flight` 状态机保留（协议签名与测试不动），闭包为空即退役。
6. **Unix及时性**：`run_polling`用`poll(fd, timeout=flush_interval剩余)`，超时回到循环顶部评估flush，消除阻塞读的“静默期不flush”折衷；Windows回退`run`阻塞读。
7. **生命周期**：`SessionDrain`随`TerminalManager`/`RemoteTerminalManager`的`take_session_handle`与`watcher`退出路径同步清理；`close()`使孤儿泵的push黑洞化，避免永久背压。

### 4. Validation & Error Matrix

| 场景 | 预期 | 风险 |
|---|---|---|
| agent CLI全速输出 | 合流后`flushes`≈`bytes/avgBatch`，`backpressure_pauses`可观测增长，footprint稳态<800MB | 无 |
| 前端慢消费(xterm未消化) | `push`返回`false`→泵停读→PTY缓冲→前端`pendingWrites>=8`暂停拉取，轮询 tick 续拉不丢 | 若阈值过低会误限流 |
| 512KB满载 | 新`push`拒收，`wake_in_flight`状态机仍保留，消费端`take_and_rearm`后继续 | 单批>512KB时空缓冲特例直接接收（最坏512KB+256KB） |
| 会话关闭后孤儿push | `close()`后`push`黑洞`true`不缓冲不唤醒，`take_and_rearm`空且不重臂 | 若未close会永久停泊 |
| SSH backpressure期间输入/resize | `remote.rs`专用`tokio::time::sleep.await`非`std::thread::sleep`，select不饿死 | 误用`thread::sleep`会饿死2ms*N |

### 5. Good/Base/Bad Cases

- Good：10段4KB burst在16ms窗口内→1次flush，byte序完整，`stats.bytes`准确。
- Base：`DRAIN 512KB`满载时`push` 300KB→`false`→泵等待`pause_poll 2ms`→`take`后恢复。
- Bad：在`async` SSH select内用`std::thread::sleep`→输入/resize分支饿死；或单次`emit(Vec<u8>)` JSON导致6x膨胀。

### 6. Tests Required

- `pump::tests::coalesces_burst_into_single_flush_in_order` / `backpressure_pauses_then_delivers_everything` / `run_polling`超时flush
- `drain::tests::closed_drain_*` 黑洞与永不重臂 / `concurrent_push_take` 50KB乱序不丢
- `fitScheduler.test` RAF合帧+trailing+失败重试 / `drainLoop.test` latch/maybePending/digest 闭环
- 集成：`terminal_drain`往返`Vec<u8>`与`ArrayBuffer`一致性

### 7. Wrong vs Correct

#### Wrong

```rust
let mut buf=[0u8;4096]; loop{ let n=reader.read(&mut buf)?; app.emit("terminal-output-{id}", &buf[..n])?; }
// 前端 listen<number[]>: term.write() 无界积压，IPC JSON 6x
// SSH: std::thread::sleep(2ms) 在 tokio select 内
```

#### Correct

```rust
let drain: Arc<SessionDrain>=...;
run_polling(fd, reader, &PumpConfig::default(), |batch| drain.push(batch, || app.emit("terminal-drain-{id}",())?));
// 前端: listen("terminal-drain")→ while { chunk=await invoke<ArrayBuffer>("terminal_drain"); if empty break; term.write(chunk, ()=>pending--) }
// SSH backpressure: tokio::time::sleep(2ms).await
```

## Scenario: 终端输出 long-poll 传输（09-03 去轮询化）

### 1. Scope / Trigger

- Trigger：credit-pull 协议的触发源是 100ms 全局共享轮询器（`drainLoop.ts` `createPollingDrainScheduler`），每 session 空闲期 ≈10 次/秒空 invoke，空闲首包延迟 ≤100ms。
- Scope：`common/terminal/drain.rs`（`Notify` + `wait_drain`）、`terminal/commands.rs`（`terminal_drain_wait`）、`app_state.rs`（owner 路由 + 超时钳制）、双 manager 的 `wait_drain`、`services.rs`/`remote.rs` 的 push 唤醒、前端 `drainLoop.ts`（`createLongPollScheduler`/`createDrainTransportScheduler`）+ 三消费方（TerminalViewBase / terminalFactory / taskRunner）。
- 约束：macOS native→JS 推送 = eval（内存事故根因），唤醒通道必须保持 fetch 拉取（零 eval）。Tauri ipc custom protocol 的 async command 响应可任意延迟（`UriSchemeResponder` 模型），long-poll 无需新协议面。

### 2. Signatures

```rust
pub(crate) fn notify_one(&self) // SessionDrain：push 成功后调，无 waiter 时存一个 permit
pub(crate) async fn wait_drain(&self, idle_timeout: Duration) -> Option<Vec<u8>>
pub(crate) async fn wait_drain(&self, session_id: &str, timeout: Duration) -> Option<Vec<u8>> // 双 manager 同构
#[tauri::command] pub async fn terminal_drain_wait(session_id: String, timeout_ms: u64, state: State<'_, AppStateWrapper>) -> Result<tauri::ipc::Response, AppError>
```

```typescript
export const DRAIN_WAIT_TIMEOUT_MS = 25_000;
export function createLongPollScheduler(deps: DrainSchedulerDeps): LongPollDrainScheduler
export function createDrainTransportScheduler(deps: DrainSchedulerDeps): DrainTransportScheduler // 默认 long-poll，VITE_TERMINAL_DRAIN_POLL=1 回退轮询
export function drainTerminalWait(sessionId: string, timeoutMs: number): Promise<ArrayBuffer>
export function drainTaskProcessOutputWait(sessionId: string, timeoutMs: number): Promise<ArrayBuffer> // task 侧本地镜像，不跨 feature 导入 terminalApi
```

### 3. Contracts

1. **协议语义不变**：有界 `SessionDrain`、背压门闸 `MAX_IN_FLIGHT_WRITES`、drain-to-empty、`pendingWake` 闩锁 / `maybePending` 续拉全部保留；long-poll 每次返回天然等价一次 wake。
2. **超时钳制**：`Duration::from_millis(timeout_ms).clamp(DRAIN_WAIT_MIN, DRAIN_WAIT_MAX)`（1s–30s 具名常量）；前端取 25s（后端上限内，自兜底后续挂）；`timeout_ms == 0` 视为 1s。
3. **Notify 与 `wake_in_flight` 双轨**：`push` 把 `notify_one` 包在闩锁内；`wait_drain` 取到非空后自复位标志（否则门闸满早退路径下后续 notify 被吞，退化至 digest/25s 自愈）。无 waiter 时 permit 合并，take 与 await 注册间的竞态由 permit 覆盖。
4. **终止语义**：`wait_drain` 返回 `None`（closed/missing）→ 调用方转 `NotFound` → 前端 `break` 停挂；超时返回空块（不 write 不 onWake，直接续挂，无忙旋）。`invoke` 无 AbortSignal：`dispose` 置 flag + 丢弃迟到结果，fetch 本体由后端超时回收（孤儿任务无害，最长 30s 持一份 Arc）。
5. **错误口径**：`terminal_drain_wait` 的 None 一律 `Terminal session not found`（与 resize/close 一致）；`terminal_drain` 的 owner 命中但 drain 缺失保留 `drain queue not found`（真正的内部不一致，值得区分）。后端 `log::debug!` 记完整 session_id（dispose 泄漏排查用）。
6. **降级开关**：`VITE_TERMINAL_DRAIN_POLL=1` 整体回退轮询，call site 一行不改；轮询实现与测试原样保留（逃生门，非死代码）。
7. **HMR**：模块级 `longPollDisposers` 登记，`hot.dispose` 时清空（dev 残留循环最多存活 25s）。

### 4. Validation & Error Matrix

| 场景 | 预期 | 风险 |
|---|---|---|
| 有积压调用 | 立即返回字节，不挂起 | 无 |
| 空队列 | 挂起至 push/close/超时；push 先于 wait 注册时 permit 使其立即返回 | permit 丢失则挂满超时（由 `notify_one` + 首轮 buffer 检查双保险覆盖） |
| closed/missing | `None` → `NotFound`，前端停挂 + 后端 debug 日志 | 错误串改动不影响前端（按变体匹配） |
| 门闸满时首块到达 | `write` 照常，续拉经 `maybePending`→`onWriteDigested` | 若 `wait_drain` 不自复位标志，下一 push 的 notify 被吞（Warn-1 实测教训） |
| dispose / terminal-closed | 循环即停、迟到丢弃；closed 事件监听与 `entry.unlisten` 双收口（幂等） | 仅 dispose 置 flag，pending fetch 由后端超时回收 |
| SSH 背压期间 | `tokio::time::sleep.await`，input/resize 不饿死 | 误用 `thread::sleep` 会饿死 select（2026-09 实测遗留，红线 3） |

### 5. Good/Base/Bad Cases

- Good：空闲 session 每 25s 一次超时续挂（≈0.04/s），有数据时 ≈16ms（泵 flush）+ RTT 首包。
- Base：`VITE_TERMINAL_DRAIN_POLL=1` 下行为与旧轮询完全一致。
- Bad：`wait_drain` 不复位 `wake_in_flight` → 背压后首包延迟退化；`remote.rs` 用 `thread::sleep` → input/resize 饿死。

### 6. Tests Required

- `drain::tests::wait_drain_*`：立即返回 / 挂起后 push 唤醒 / push 先于 wait（permit）/ closed→None / 超时空 / `close` 唤醒 parked waiter。
- `manager/remote::tests::wait_drain_*`：有积压 / 缺席→None / 已关闭→None / 挂起后 push 唤醒（双 owner 同构）。
- `drainLoop.test`：首块 write+续挂 / NotFound 停 / dispose 丢迟到（deferred gate，禁微任务顺序假 GREEN）/ 门闸早退经 digest 续拉 / 开关两用例。
- 集成：`terminal_drain_wait` 往返 `Vec<u8>` 与 `ArrayBuffer` 一致性。

### 7. Wrong vs Correct

#### Wrong

```rust
// wait 取走数据但不复位闩锁 —— 门闸满早退后下一 push 的 notify 被吞
if !data.is_empty() { return Some(data); }
// SSH 背压在 tokio select 内阻塞睡 —— input/resize 分支饿死
while !drain.push(&data, || {}) { std::thread::sleep(2ms); }
```

#### Correct

```rust
if !data.is_empty() {
    self.wake_in_flight.store(false, Ordering::Release); // 自复位，后续 notify 可达
    return Some(data);
}
while !drain.push(&data, || drain.notify_one()) { tokio::time::sleep(2ms).await; }
```


## 常见错误

### 1. 跨 thread::spawn 或 await 持有 Mutex 锁

```rust
// 错误 —— 派生线程时持有锁
let mut pm = state.project_manager.lock().map_err(...)?;
std::thread::spawn(move || { /* pm 被捕获 */ });

// 正确 —— 提取数据，释放锁，然后派生
let data = {
    let pm = state.project_manager.lock().map_err(...)?;
    pm.get_data().clone()
};
std::thread::spawn(move || { /* 使用 data */ });
```

### 2. 关闭会话时忘记清理线程

关闭终端会话时，确保：
- 注销输入事件监听器
- 释放 PTY master（向子进程发送 HUP）
- 带超时的优雅终止（SIGTERM -> 等待 -> SIGKILL）

### 3. 对 PTY 操作使用 `tokio::spawn`

本地 PTY 操作使用阻塞 I/O。使用 `std::thread::spawn` 而非 `tokio::spawn`，以避免阻塞异步运行时。

### 5. 在异步上下文中使用 `std::process::Command::output()`

`std::process::Command::output()` 是同步阻塞调用。在 `async fn`（Tauri 命令）中直接调用会**阻塞整个 tokio 工作线程**，导致所有并发请求排队等待。

如果 git push 等待 stdin（鉴权场景），进程永不退出，Tauri IPC 永久挂死。

```rust
// 错误 —— 阻塞 tokio 线程
let output = std::process::Command::new("git")
    .args(args)
    .output()?;  // 阻塞！不释放线程
```

**修正方案**：使用 `tokio::process::Command` + `tokio::time::timeout`

```rust
use tokio::process::Command as TokioCommand;

let output = tokio::time::timeout(
    Duration::from_secs(timeout_secs),
    TokioCommand::new("git")
        .args(args)
        .current_dir(work_dir)
        .output(),
)
.await
.map_err(|_| anyhow::anyhow!("git command timed out after {}s", timeout_secs))?
.map_err(|e| anyhow::anyhow!("git command failed: {}", e))?;
```

**超时策略（2026-10 起）**：读类命令保留 30s 上界（`LOCAL_GIT_TIMEOUT`）；长操作
（push / fetch / pull / commit）**不设墙钟** —— 耗时由 hook 与网络决定、没有上界，
墙钟会把「正常慢」误判成失败（pre-push 跑两套测试是分钟级）。判据单点在
`transport::git_command_timeout(args)`；挂死防护走取消通道（`GitSyncSlots` 按
`RepoRef::key()` 分槽：同仓库单元串行、异单元并行 + `cancel_git_sync(console_run_id)`
按 run id 匹配 + `kill_tree` 树杀（kill 确认有界 5s，防远端不收敛永久占槽））。长操作的 stdout/stderr 经
`collect_child_output_streaming` **按 16KB / 50ms 合流**后 emit（EOF 冲刷尾巴）——不可逐读块
发事件（macOS 事件送达 = 每次 `evaluateJavaScript`，会重演终端内存事故）。
依据与实测见 `backend/git-domain.md`「长操作超时策略与 Console 可见性」。

### 5b. 退出时子进程收敛（子进程登记表）

**判据**：应用退出（`Destroyed` → `shutdown_background_and_exit`）时，**仍在跑**的长操作子进程树
必须被收敛，不得孤儿化（父进程退出不回收子进程）。

- **登记表**：`common/executor::child_registry`——`run_shell_streaming` 在子进程存活期登记它的
  `KillFn`（= `Arc<dyn Fn() -> KillFuture>`，**与取消共用同一个动作**），返回 RAII `ChildLease`
  （正常完成 / 取消即注销）。动作的宿主/远端差异由 executor 按 `ExecTarget` 构造，登记表与传输层
  都不分支执行目标。**只对仍登记（存活）的项动手**，降低 pid / 进程组复用误杀。
- **收敛点**：`shutdown_background_and_exit` 的 `CleanupTask`（`"git-children"`）在所有后台服务
  关停前调 `kill_all_live()`（同步驱动，确认有界 5s）；Local / WSL 的动作用平台门面
  `platform::process_spawn::kill_process_tree`（红线 10）本地树杀；SSH 的动作在**远端** `kill -9`
  （新通道）—— 远端 pid 与本地 pid 无关，**不得**本地按 pid 杀。
- **不变量**：退出驱动与真实 killer 解耦（`kill_all_with(&dyn Fn(&KillFn))`），单测不触碰真实进程。
- **executor 契约**：`ExecChild.wait` 的实现**不得**跨 `await` 持有子进程句柄的 `Mutex`——否则退出收敛驱动
  共享 kill 动作时抢不到锁而死锁（Local / WSL 用短锁轮询 `try_wait`，不跨 `await` 持锁；回归测试
  `local::tests::kill_action_does_not_deadlock_while_wait_is_polling`）。
- **边界**：不改 Tauri 取消协议（运行期 future 被 drop 自动树杀不在范围）；不做远端同步清理。

机制详解与实测：`backend/git-domain.md`「退出收敛（子进程登记表）」。

```rust
/// 读类 30s；长操作 None（无墙钟，靠取消通道兜挂死）。
pub(crate) fn git_command_timeout(args: &[&str]) -> Option<Duration> {
    match args.first().copied() {
        Some("push" | "fetch" | "pull" | "commit") => None,
        _ => Some(LOCAL_GIT_TIMEOUT),
    }
}
```

`is_network_op`（检测同上）现仅用于注入 `GIT_TERMINAL_PROMPT=0`，不再决定超时。

### 6. Git 鉴权错误检测

在所有 git 命令执行后，扫描 stderr 匹配鉴权错误模式，返回带 `[AuthRequired]` 前缀的明确错误：

```rust
const AUTH_FAILURE_PATTERNS: &[&str] = &[
    "Authentication failed",
    "Could not read from remote repository",
    "Permission denied (publickey)",
    "could not read Username",
    "HTTP Basic: Access denied",
    "fatal: unable to access",
    "fatal: could not read",
    "request failed with status 401",
    "Repository not found",
];

fn check_auth_failure(stderr: &str) -> Option<&'static str> {
    AUTH_FAILURE_PATTERNS
        .iter()
        .find(|pat| stderr.contains(*pat))
        .copied()
}
```

搭配前端 `withTimeout` 和 `isAuthError` 检测，确保用户不会遇到永久挂死。

### 4. 移入线程前没有克隆 Arc

```rust
// 错误 —— 移走了 Arc，之后无法再使用
std::thread::spawn(move || {
    let map = self.sessions.lock().unwrap();  // self 被移走了！
});

// 正确 —— 先克隆 Arc
let sessions = self.sessions.clone();
std::thread::spawn(move || {
    let map = sessions.lock().unwrap();
});
```

### 5. 终端短临界区锁：tolerate-and-continue + warn（禁止静默吞锁）

终端 `sessions` / `pty_handles` / `ssh_handles` / `drains` 锁的临界区都是短小的 HashMap 查表/插入，poison 仅意味着"某个持锁线程 panic"，数据大概率仍可用——一律容忍继续，中毒时打一条 `warn` 日志。禁止三种写法：生产路径 `.lock().ok()`（调用方误判"无此会话"）、`if let Ok` 静默跳过（handle 丢失但会话照常创建）、`map_err("…poisoned")` fail-loud（一次偶发 panic 放大为整条会话不可用）。

```rust
// 统一入口：common/terminal/locks.rs
let mut handles = lock_warn(&self.pty_handles, "pty_handles");
```

测试内的 `.expect("infallible: … lock")` 与 poison 注入脚手架不受此限。
