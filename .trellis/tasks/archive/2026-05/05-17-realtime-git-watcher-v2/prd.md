# PRD: 实时 Git Watcher v2 -- 对标 VS Code

## 前置依赖

本任务是 `05-17-realtime-git-watcher`（v1）的后续。v1 解决了 5 个基础瓶颈（递归监听、去轮询、diff-aware、split 路径、仓库复用），将延迟从 3-5s 降到 < 1s。

v2 目标是从"基本流畅"推到"无感知"，完全对标 VS Code Git 扩展。

## 当前差距（v1 实现后）

| 差距 | 当前（v1 后） | VS Code |
|------|--------------|---------|
| 最小响应延迟 | 800ms（debounce 下限） | ~100-200ms（throttle + git status 执行时间） |
| Repository 生命周期 | 每次刷新重新 open | 常驻进程，零启动开销 |
| 前端更新粒度 | 全量替换 changed_files 数组 | 增量 diff，只推变化的条目 |
| git status 锁竞争 | 默认模式，可能与用户操作冲突 | `--no-optional-locks` 避免锁竞争 |

## 决策汇总

| # | 决策 | 改动范围 |
|---|------|---------|
| 1 | 800ms debounce → throttle 调度器 | `watcher.rs` |
| 2 | 常驻 git 子进程池（`git status` 专用 worker） | 新模块 `git_worker.rs` |
| 3 | 前端增量 diff 更新 changed_files | `useSessionBootstrap.ts` + `appStore.ts` |
| 4 | `git status --no-optional-locks` | `watcher.rs` / `git_worker.rs` |

## 不做的事

- 不替换 `git2` crate（现有的 diff/branch/worktree 操作继续用 git2，只有 status 走常驻进程）
- 不做 WebSocket 实时推送（Tauri event 机制已足够）
- 不做多仓库并行 status（一个项目一个 worker 即可）

---

## TDD 开发计划

### Slice 1: Debounce → Throttle 调度器

**问题**：`notify_debouncer_mini` 是固定 800ms debounce -- 收到事件后等 800ms 无新事件才触发。连续编辑时延迟累积。

**目标行为**：throttle 模式 -- 收到第一个事件后立即启动一次处理，处理期间的新事件排队，处理完成后如有排队立刻再处理一次。

**行为测试（Rust）**：
- `throttle_fires_immediately_on_first_event` -- 第一个事件到达后立即触发回调，不等待
- `throttle_coalesces_events_during_processing` -- 处理期间收到多个事件，处理完成后只触发一次
- `throttle_no_spurious_fires` -- 无事件时不触发回调

**改动文件**：
- `src-tauri/src/watcher.rs`: 去掉 `notify_debouncer_mini`，改用 `notify` 原生 watcher + 自定义 throttle 逻辑（channel + worker thread）
- `src-tauri/Cargo.toml`: 可移除 `notify-debouncer-mini` 依赖

**接口设计**：
```rust
/// Throttle 调度器：收到信号后立即触发一次回调，
/// 执行期间的信号合并，执行完成后若有排队则再触发一次。
struct ThrottleScheduler {
    tx: mpsc::Sender<()>,
}

impl ThrottleScheduler {
    fn new(callback: impl Fn() + Send + 'static) -> Self;
    fn notify(&self);  // 非阻塞，发送信号
}
```

### Slice 2: 常驻 git status worker

**问题**：每次 watcher 触发都 spawn `git status --porcelain` 子进程，进程启动 + git index 加载有固定开销。

**目标行为**：项目启动时创建一个专用 worker 线程，接收"请检查"信号，执行 `git status --porcelain --no-optional-locks`，对比上次结果，有变化时通过 channel 发送新状态。

**行为测试（Rust，真实临时仓库）**：
- `git_worker_detects_new_file` -- 创建文件后发信号，worker 返回包含新文件的 status
- `git_worker_detects_deleted_file` -- 删除已跟踪文件后发信号，worker 返回变化
- `git_worker_no_change_no_event` -- 无文件变化时发信号，worker 不产生输出
- `git_worker_uses_no_optional_locks` -- 验证子进程参数包含 `--no-optional-locks`

**改动文件**：
- 新增 `src-tauri/src/git_worker.rs`: `GitStatusWorker` 结构体
- `src-tauri/src/watcher.rs`: debounce 回调改为向 worker 发信号，worker 输出驱动 `git-changed` 事件
- `src-tauri/src/app_state.rs`: 可选 -- worker 生命周期由 WatcherManager 管理

**接口设计**：
```rust
pub struct GitStatusWorker {
    signal_tx: mpsc::Sender<()>,
    // worker thread join handle managed internally
}

impl GitStatusWorker {
    /// 启动 worker。repo_path 是项目路径。
    /// on_change 在 status 结果发生变化时被调用，参数为新的 porcelain 输出。
    pub fn start(
        repo_path: PathBuf,
        on_change: impl Fn(String) + Send + 'static,
    ) -> Self;

    /// 请求一次 status 检查（非阻塞）
    pub fn check(&self);

    /// 停止 worker
    pub fn stop(self);
}
```

### Slice 3: 前端增量 diff 更新

**问题**：`git-changed` 事件触发后，前端用 `get_worktree_changed_files` 拿到完整文件列表，全量替换 store 中的 `changed_files`。大仓库中即使只改了一个文件，也会替换整个数组，触发所有消费组件重渲染。

**目标行为**：后端事件携带变化摘要（新增/删除/修改了哪些文件），前端做 patch 更新。

**行为测试（Vitest）**：
- `incremental_update_adds_new_file` -- 收到"新增 foo.rs"的变化事件，store 中 changed_files 追加 foo.rs，其他文件不变
- `incremental_update_removes_file` -- 收到"删除 bar.rs"的变化事件，store 中移除 bar.rs
- `incremental_update_no_change_no_rerender` -- 空变化事件不触发 store 更新

**行为测试（Rust）**：
- `diff_status_returns_added_files` -- 与上次 status 对比，新增文件出现在 diff 结果中
- `diff_status_returns_removed_files` -- 与上次 status 对比，消失的文件出现在 removed 列表中

**改动文件**：
- `src-tauri/src/git_worker.rs`: `on_change` 回调改为传递增量 diff（新增/删除/修改的文件路径列表）
- 新增 Tauri 事件 payload 类型 `GitStatusDiff { added: Vec<FileChange>, removed: Vec<String>, modified: Vec<FileChange> }`
- `src-tauri/src/watcher.rs`: 发送 `git-status-diff` 事件替代（或补充）`git-changed`
- `src/hooks/useSessionBootstrap.ts`: 监听 `git-status-diff` 事件，做 patch 更新
- `src/store/appStore.ts`: 新增 `patchChangedFiles` action

**接口设计（事件 payload）**：
```typescript
interface GitStatusDiff {
  project_id: string;
  added: FileChange[];
  removed: string[];       // 被删除文件的 path
  modified: FileChange[];  // status 变化的文件（如 Untracked → Added）
}
```

### Slice 4: `--no-optional-locks` 全局应用

**问题**：`git status` 默认会获取 `.git/index.lock`，如果用户正在做 `git add` / `git commit`，可能导致锁冲突和延迟。

**目标行为**：所有 watcher 触发的 `git status` 调用使用 `--no-optional-locks` 参数，避免与用户操作的锁竞争。

**行为测试（Rust）**：
- `git_status_command_includes_no_optional_locks` -- 验证构建的 Command 参数包含该 flag

**改动文件**：
- `src-tauri/src/git_worker.rs`: `Command::new("git").args(["status", "--porcelain", "--no-optional-locks"])`
- `src-tauri/src/watcher.rs`: 如果还有直接调用 git status 的地方，同步添加

---

## 架构变化概览

```
v1 架构:
  notify(Recursive) → 800ms debounce → git status --porcelain → diff-aware → emit("git-changed")
  前端: listen("git-changed") → get_worktree_changed_files → 全量替换 store

v2 架构:
  notify(Recursive) → ThrottleScheduler.notify() → GitStatusWorker.check()
                                                      ↓
                                               git status --porcelain --no-optional-locks
                                                      ↓
                                               diff vs last_status
                                                      ↓ (有变化时)
                                               emit("git-status-diff", { added, removed, modified })
  前端: listen("git-status-diff") → patchChangedFiles(diff) → 增量更新 store
        listen("git-changed") 保留作为 fallback 全量刷新
```

## 验收标准

1. `cargo test` 全部通过，含 throttle / git_worker / diff 测试
2. `pnpm test:run` 全部通过，含增量更新测试
3. `pnpm lint && pnpm type-check` 通过
4. 文件变化后 Commit Panel 刷新延迟 < 300ms（手动验证）
5. 连续快速编辑时无重复刷新（throttle 合并验证）
6. 用户执行 `git add` 同时 watcher 触发时无锁冲突报错
