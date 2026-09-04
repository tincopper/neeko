# design.md — terminal 锁统一

## D0 工作树 drain 改动审查结论（先审后改）

审查对象：未提交 diff（`drain.rs` +36，两 manager 各 −20 行左右）。总体判断：**提取方向正确，接入干净，可保留骨架，只做小幅优化**。

| 项 | 结论 |
|---|---|
| 5 helper 落点 `drain.rs` | ✅ 合理：drain map 类型别名与 `lock` 同文件，查表操作就近内聚 |
| `take_drain` 走 `take_and_rearm(\|\| {})` | ✅ 必须：空闭包不是冗余——`take_and_rearm` 负责复位 `wake_in_flight`，直接 `take_all` 会破坏唤醒合并。需补一行注释说明，否则后人必"优化"掉 |
| `wait_drain` | ✅ 直接透传，加 helper 只是为了统一查表锁 |
| `insert_drain` 内部 `default()` | ✅ 保留：两个调用点都是"新建会话"语义，无注入需求；YAGNI，不加 `Arc` 参数 |
| `close_and_remove_drain` | ✅ 保留：先 close 再移除，孤儿泵黑洞语义完整 |
| `session_ids` | ⚠️ 语义变更（见 D4），单测锁定 |
| manager 删掉的大段 wake-hint 注释 | ✅ 该删：退役语义三处重复，留一处（`take_drain` helper 注释）即可 |
| remote 删掉的 `"Drains lock poisoned"` map_err | ✅ 该删：正是本任务要消灭的 fail-loud |

优化动作（本任务内做）：给 `take_drain` 补 wake-复位注释；`lock` 转发 `lock_warn`（D2）后 5 helper 自动获得 warn。

## 决策

### D1 中毒策略：tolerate-and-continue + `log_warn`

与 `common/terminal/drain.rs::lock` 一致：

```rust
m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
```

理由：终端锁的临界区都是短小的 HashMap 查表/插入，poison 意味着"某个持锁线程 panic"，数据大概率仍可用；fail-loud 会把一次偶发 panic 放大为整条会话不可用。容忍继续 + warn 日志是最优折中。`resize_session` 等返回 `Result` 的路径保持签名不变，内部容忍（不再 `map_err` 中毒）。

### D2 helper 落点：`common/terminal/` 新建 `locks.rs`（待确认）

`drain.rs` 的私有 `fn lock` 只服务 drain map。建议新建 `common/terminal/locks.rs`：

```rust
pub(crate) fn lock_warn<T>(m: &Mutex<T>, what: &str) -> MutexGuard<'_, T>
```

- 行为 = `into_inner` 容忍 + 中毒时 `log::warn!("[terminal] {what} lock poisoned, continuing with inner")`。
- `drain.rs::lock` 改为复用它（或保持私有转发，避免一次改动面过大—— refac 阶段决定）。
- `mod.rs` 只做 `mod` + `pub use`（仓库红线 §9）。

替代方案（若希望改动最小）：把 `drain.rs::lock` 改为 `pub(crate)` 直接复用，不新建文件。本任务默认采用新建 `locks.rs`，因语义从"无日志容忍"变为"warn 容忍"，drain 路径也应补上 warn。

### D3 `remote.rs:164-169` 旁路收敛

该处是会话创建后立刻取 drain 给 reader/IO 泵。新增 `get_drain(map, id) -> Option<Arc<SessionDrain>>`（与 `take_drain/wait_drain` 并列），调用方 `ok_or(NotFound)` 语义不变。

### D4 `close_all_sessions` 枚举源：drains（维持现状，单测锁定）

工作树改动已切到 `session_ids(&drains)`。维持该选择，理由：drain 是"会话输出面"的事实注册表；`close_session` 本身以 drain close 为第一步。但需修复风险点 `remote.rs:152`（`ssh_handles` insert 失败静默）——统一 helper 后 insert 不再静默跳过（warn 可见），三者失配窗口只剩 insert 之间 panic，属可接受残差，单测覆盖"失配时 close 不漏 drain"即可。

## 改动清单（预估）

| 文件 | 改动 |
|---|---|
| `common/terminal/locks.rs` | 新增 `lock_warn`（新建文件 + `mod.rs` 两行声明） |
| `common/terminal/drain.rs` | 内部 `lock` 复用 `lock_warn`（5 处调用点行为不变 + warn） |
| `terminal/manager.rs` | `:188` map_err→helper；`:246` if-let→helper；`:253` .ok()→helper |
| `terminal/remote.rs` | `:121`、`:152`、`:164-169`（→`get_drain`）、`:264`、`:294`、`:298` → helper |
| 两文件 `#[cfg(test)]` | poison 注入单测（`let _ = Mutex::new(...); // poison via catch_unwind` 或直接 `Pool` 构造） |

## 风险

- `warn` 日志量：只在中毒时打一次/调用，无热路径开销。
- `clippy::missing_const_for_fn` / `-D warnings`：helper 涉及 log 调用，不可为 const，无影响。
- 与工作树未提交的 drain 改动同文件交叠：本任务基于当前工作树开发，提交时 squash 为一次或两次 commit 由执行时决定。
