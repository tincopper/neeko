# 执行计划：纯 shell 终端输出落盘与回放

> 状态（2026-11-10）：实现完成，`cargo test --lib` 2675 通过、`pnpm check:quick` 27/27、
> `cargo check --target x86_64-pc-windows-gnu`（WSL 分支）通过。
> 本文记录**最终实现形态**；初版按 transcript 方案写的 planning artifacts 已作废。

## 1. 第一性原理与最终结构

日志是「会话身份」的附属资源 —— 它的目录、格式、写入、迁移、回收必须只有一处知道。
初版把这些职责散在 `terminal/services`、`live_sessions/registry`、`live_sessions/boot` 三个域，
导致反向依赖、纯函数被塞磁盘 GC、三端不对称。最终结构：

```
src-tauri/src/common/terminal/history/     ← 资源单一所有者
  mod.rs        只做 mod 声明 + pub use（红线 9）
  contract.rs   SessionHistory trait（依赖倒置端口）+ NoopHistory 安全默认
  sanitizer.rs  纯 ANSI 单行编辑器（无 IO）：Sanitizer / sanitize / parse_csi
  store.rs      HistoryStore：目录、格式、路径安全、生命周期、HistoryPlan
  writer.rs     Recorder + 独立写线程
  tests.rs      30 条测试，夹具全由 tempdir() 推导（红线 13）

src-tauri/src/terminal/
  launch.rs     TerminalLaunch 值对象（收拢 commands → router → manager → pipeline 参数雪崩）
  router.rs     prepare_history（唯一决策点，run_blocking 隔离阻塞 fs，红线 3）
  services.rs / manager.rs / remote.rs 都只调 HistoryPlan::attach（唯一接线接缝）

src-tauri/src/live_sessions/
  registry.rs   只依赖 SessionHistory trait，由组合根注入
  boot.rs       restore() 纯回填，零 IO
src-tauri/src/app/boot.rs  on_setup 里调 HistoryStore::prune（GC 归组合根）
```

## 2. 关键决策（为什么这样）

| 决策 | 理由 |
| --- | --- |
| `HistoryStore` 单一所有者 + 目录注入 | 消除跨域反向依赖；测试传 `tempdir()`，杜绝单测碰真实 `~/.neeko/`。曾因 `restore()` 里直接 `prune_orphans(terminal_history_dir())`，跑单测删光用户日志（现有 `restore_never_touches_session_history_side_effects` 与 `store_never_touches_the_real_user_directory` 两条护栏钉住）。 |
| 删 `copy_history`，旧日志读入内存直接作新写线程初值 | 少一次 `fs::copy`、少一个「copy 成功但 adopt 失败」竞态；`adopt` 失败时旧文件还在，可再次恢复。 |
| `HistoryPlan::attach` 单一接缝 | 「推进 drain + 起写线程」的顺序契约只在一处，Local / WSL / SSH 三端共用 → 不可能漏掉某一端；测试可直测顺序而不起真实 PTY。 |
| `router::prepare_history` 唯一决策点 | 三端对称 + `is_plain_shell` 单点裁决（前端不再自己判 `agentId`）。所有阻塞 fs 在 `run_blocking` 里完成，pipeline 只做纯内存操作（红线 3）。 |
| `SessionHistory` trait + 组合根注入 | 依赖倒置：`live_sessions` 不认识 `terminal` 域；`NoopHistory` 让未接线的单测零副作用。 |
| `MAX_LINE_CHARS` 与 `MAX_LOG_BYTES` 分离 | `Vec<char>` 按字符限、落盘按字节限；中文 3 字节/字，混用会让内存峰值达 3×。 |

## 3. 验证记录

- `cargo test --lib`：2675 passed / 9 ignored。
- `pnpm check:quick`：27/27 护栏全绿（含 eslint / tsc / fmt / clippy / 组件规模 ratchet）。
- `cargo check --lib --target x86_64-pc-windows-gnu`：WSL 分支编译通过；Linux 由 CI 三平台矩阵兜底。
- 真实 zsh 572 字节会话固化回归钉子：`real_zsh_session_replays_as_clean_commands_and_output`。
- 哨兵实证：在 `~/.neeko/terminal_history/` 放文件 → 跑全量单测 → 文件仍在。
- 变异验证：临时破坏 ANSI 剥离 / 字节上限，对应用例变红（曾做，恢复后绿）。

## 4. 风险与回滚

| 风险 | 兜底 |
| --- | --- |
| 切 tab 串味 | `resumeFrom` 按 `cacheKey` 重建（不锁组件实例）；`replayFromRef` 已删除。 |
| 回放载荷撑爆 drain / xterm stall | `min(256KB, 5000 行)` 取尾；`replay_payload_fits_the_drain_capacity` 钉住。256KB 的 stall 边界仍待真机长会话确认。 |
| 旧格式日志 | 文件头 `NEEKO-SHELL-LOG-v2`，无头降级为空。 |
| 回滚 | `HistoryPlan` 不接线即回到「纯新 PTY」；删 `history/` 与 `launch.rs` 即完全回滚，无 DB 迁移、无 wire 形状变更。 |

## 5. 不做

- agent TUI 终端输出落盘（全屏重绘帧不可回放）；读取 CLI transcript（前一版方案）。
- 回放原始 PTY 字节；独立只读历史分栏；让已结束进程复活。

## 6. 收尾约定

`pnpm check:quick` 只在收尾跑一次（已完成）→ spec 已同步（`.trellis/spec/backend/persistence-and-cache.md` §5b）→ 不主动提交代码。
