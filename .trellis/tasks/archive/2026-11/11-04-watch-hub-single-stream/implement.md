# C3 Implement — 日志降噪

> 轻量任务（PRD + 本文件）。方案在原计划上被修正，理由在 `prd.md` Background。

## 0. 勘察

- [x] `rg -n "set_max_level" src-tauri/src` → `common/logger.rs:105` 开满 `Debug`，自定义 `Log`
      实现**不做 target 过滤**，因此 `ignore` / `globset` 的 crate 内部 `log::debug!` 全部落盘。
- [x] 量化（`tail -200000 ~/.neeko/neeko.log`，该窗口实际 51,606 行）：
      | 项 | 行数 | 占比 |
      | --- | --- | --- |
      | 会被新过滤器丢弃（DEBUG/TRACE ∧ target ∈ {ignore, globset}） | **39,353** | **76.3%** |
      | 同 target 的 WARN/ERROR（**保留**） | 0 | — |
      | 我们自己的 DEBUG（`neeko_lib::*`，保留） | 3,321 | 6.4% |
      按行均 ~120 B 估算，9 MB 会话日志降到 ~2 MB 量级。

## 1. 实现

| 步 | 落点 | 说明 |
| --- | --- | --- |
| 1 | `common/logger.rs` `NOISY_TARGETS` | 按**模块名**登记（`ignore` / `globset`），不是字符串前缀 —— `"globset"` 要同时命中 `globset` 与 `globset::glob::GlobSet`，但不能误伤将来叫 `globsetx` 的 crate（判据用 `strip_prefix` + `rest.is_empty() \|\| rest.starts_with("::")`） |
| 2 | `should_write(level, target)` | **只过滤 `Debug` 及以下**：同 target 的 `Info`/`Warn`/`Error` 是异常信号（如遍历库报目录不可读），必须保留。`log::Level` 的序是 `Error < Warn < Info < Debug < Trace` |
| 3 | `FileLogger::log` | `enabled()` 之后、拼行之前早退 —— 降噪发生在**格式化之前**，不做无用字符串拼接 |
| 4 | 不改 `set_max_level(Debug)` | 我们自己的 DEBUG 是排查挂载/重算时序的唯一一手证据 |

## 2. 测试（`common/logger.rs` 测试模块，+5 条）

| 用例 | 断言 |
| --- | --- |
| `third_party_traversal_debug_is_dropped` | `ignore::walk` / `ignore::gitignore` / `globset` / `globset::glob::GlobSet` 的 DEBUG、TRACE 均丢弃 |
| `our_own_debug_is_kept` | `neeko_lib::…watcher::manager::core`、`…status_worker::worker` 的 DEBUG 保留 |
| `third_party_debug_other_than_traversal_is_kept` | `notify::inotify` / `sqlx::query` 的 DEBUG 保留（黑名单只登记实测噪声源） |
| `warn_and_error_from_noisy_targets_are_kept` | 同 target 的 WARN/ERROR/INFO 保留 |
| `log_writes_only_what_the_filter_allows` | **接线**：直接驱动 `LOGGER`（临时文件，绕开真实 `~/.neeko`），噪声行不落盘、我们的 DEBUG 落盘 |

**变异验证**：把 `log()` 里那三行接线注释掉 ⇒ `log_writes_only_what_the_filter_allows` RED；恢复后 GREEN。
（只测谓词而不测接线的话，「谓词对了、噪声照样落盘」这类破法不会被抓到。）

## 3. 验证

- `cargo test --lib` → **2594 passed / 0 failed / 9 ignored**（+5 为本次新增）。
- `cargo clippy --all-targets -- -D warnings` → 0 诊断。
- `pnpm check:quick` → 通过（改动只含 `.rs`，9 条护栏入域）。

## 4. 未做（已登记进父任务 `prd.md` R4 + `design.md §1.4`）

单流化 / 前缀索引、`WatchManifest` 缓存、FSEvents 排除根合并 —— 三项的前提都被 C4 的
「热集合 ≈ 1」与 C1 的「读与挂载解耦」消掉了，度量与逐项理由见 `prd.md` Background 的表。
保留父任务 `design.md §1.4` 的原设计文本（标注「前提消失、不要照做」），供将来热集合真的变大时参考。
