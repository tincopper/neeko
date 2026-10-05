# 设计：无墙钟 + 可取消 + 可见（git 长操作）

> 需求与验收见 `prd.md`。与 `.trellis/spec/backend/git-domain.md §13` 互为详略。

## 1. 第一性：墙钟不是挂死防护

push / fetch / pull / commit 的耗时由 hook 与网络决定、**没有上界**。墙钟兜它们只会把
「正常慢」误判成失败，且**不杀进程**（旧实现超时只停止等待）——用户看到失败而远端状态未知。
正解是取消通道：让用户显式终止，并杀掉整棵进程树。

## 2. 职责分解

| 单元 | 职责 | 本任务后不再承担 |
| --- | --- | --- |
| `git_command_timeout(args)` | 唯一超时判据（长操作 None） | 散落的 network/local 分支 |
| `GitSyncSlots`（`Mutex<HashMap<RepoRef::key(), GitSyncEntry>>`） | 仓库单元单飞 + 取消目标匹配 | 全局单槽（异仓误拒） |
| `GitRunHooks { on_output, cancel }` | 一次运行的 Console 出口 + 取消句柄（owned） | 借用句柄（命令层无法单点装配） |
| `begin_git_run(state, repo, app_handle, run_id)` | 命令层唯一「占槽 + 产 hooks」点 | 7 处复制 |
| `run_shell_streaming` / `finish_git_output` | Local/WSL/SSH 共享生命周期 | 三份复制 |
| `drain_stream` 合流 | 事件频率上界 + EOF 冲刷尾巴 | 逐读块 emit |
| 前端 `runGitConsoleOp` | 全入口统一的 open→成功/认证/失败收尾 + 仓库级 busy 去重 | 各入口自复制 begin/finish/fail |

## 3. 契约

```rust
pub struct GitRunHooks { pub on_output: Option<ExecChunkSink>, pub cancel: Option<GitSyncHandle> }
pub struct GitSyncSlots { slots: Mutex<HashMap<String, GitSyncEntry>> } // 键 = RepoRef::key()
pub struct GitSyncEntry { pub handle: GitSyncHandle, pub run_id: Option<String> }
pub struct GitSyncGuard<'a> { slots: &'a GitSyncSlots, key: String } // Drop 释放本单元
impl GitSyncSlots {
    pub fn begin(&self, key: String, run_id: Option<String>) -> Result<(GitSyncHandle, GitSyncGuard<'_>), AppError>;
    pub fn cancel_matching(&self, run_id: Option<&str>) -> Result<usize, AppError>;
}
impl GitSyncEntry { pub fn matches(&self, requested: Option<&str>) -> bool } // None 请求 = 取消当前

pub(super) fn begin_git_run<'a>(state, repo: &RepoRef, app_handle, console_run_id)
    -> Result<(GitRunHooks, GitSyncGuard<'a>), AppError>;

pub(crate) async fn run_shell_streaming(target, program, shell_cmd, label, timeout, hooks)
    -> Result<ExecOutput>;
pub(crate) fn finish_git_output(output, command) -> Result<String>;
```

- **owned handle**：命令层要一次产出 hooks，借用会引入自引用生命周期（E0521/E0308）。
  `GitSyncHandle` 是 watch 通道的廉价 `Clone`，owned 反而简单。
- **仓库单元分槽**：同单元（同 HEAD/index/workdir）串行 ⇒ 显式拒绝；异单元并行。
  与 §12 的身份模型一致，跨仓不再误拒。
- **取消匹配**：带 `console_run_id` 就只取消同一次运行；`None` 取消全部。
- **合流**：`FLUSH_BYTES=16KB` / `FLUSH_INTERVAL=50ms`；有积压时读带 `select!` 超时，
  EOF 强制交付 `pending`（最后一次输出不得丢）。无 sink 时走 `read_to_end`，逐字等价旧行为。
- **前端 busy 去重**：同一仓库级 tab 在飞（`running`/`stopping`）时新入口返回 `busy`，
  不触碰 tab（否则旧 run 的 reject 会把被接管的新 tab 误标 `failed`）。

## 4. 失败语义

- 取消 → `ExecError::Killed` → `anyhow!("git command cancelled: <label>")`。
- 超时（仅读类）→ `git command timed out after Ns`，**不杀进程**（既有语义）。
- Lock 中毒 → `AppError::LockPoisoned`；并发冲突 → `AppError::InvalidInput`（已有槽）。

## 5. 测试策略

- 纯函数/切片：`split_utf8` 三分类、`GitSyncEntry::matches` 四形。
- 单飞注册表：`GitSyncSlots` 同单元互斥 / 异单元并行 / 守卫释放后可重占 / 按 run id 取消只命中匹配。
- 合流：小读合流（交付次数 < 写次数）、宽限交付、EOF 尾巴完整。
- 取消：kill 闭包 + Killed；端到端 `push_cancel_aborts_pre_push_hook_and_returns_promptly`（树杀）。
- 前端：`runGitConsoleOp` 的 busy / stopping 不接管 / stopped / auth / ok；tab 稳定去重、
  失败态、悬挂 200s 不判失败。
