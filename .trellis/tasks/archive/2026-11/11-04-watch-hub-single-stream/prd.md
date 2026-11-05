# C3 观测层：日志降噪（原「单流化」前提已消失）

> 父任务：`.trellis/tasks/11-04-git-status-observability/`
> **本任务的方案在开工时被修正**：原计划是「每 host 一条流 + 前缀索引 + manifest 缓存」，
> 但 C4 之后前提不成立（见 Background）。修正依据与决策记录在下面，**不要按旧名去实现单流化**。

## Goal

把日志里**第三方遍历库的逐目录 DEBUG** 挡在文件外，让 `neeko.log` 重新可用于事故排查。
其余原计划项（单流化 / 前缀索引 / manifest 缓存 / 排除根合并）本任务**不实现**，理由见 R2。

## Background（开工前的量化核对）

### 实测：日志的 ~20% 行来自一个依赖

```
tail -200000 ~/.neeko/neeko.log 按模块计数
31279  ignore::walk:      ← 单个模块就是最大来源
 6909  globset:
 1238  neeko_lib::…::status_worker::worker
 1137  ignore::gitignore:
  774  neeko_lib::conversation::manager
  607  neeko_lib::…::watcher::manager::core
```

`ignore`（gitignore 感知的目录遍历）+ `globset` 合计 39,325 / 200,000 行。我们的源码**从不读
这些行**（它们是 crates 内部 `log::debug!`），代价是：日志 9MB / 会话、轮转档 20–43MB，
以及**排查时被噪声淹没** —— 本次事故定位过程中确实必须先用 `grep -v` 过滤掉它们才能看清时序。

根因：`common/logger.rs` 把 `log::set_max_level(Debug)` 开满，而自定义 `Log` 实现不做 target 过滤。

### 为什么原计划的三项不再实现

| 原计划 | 现在的前提 | 结论 |
| --- | --- | --- |
| 每 host 一条流 + 前缀索引 | C4 之后**热集合 = 同屏内容可见的单元（典型 1 个）**，`reconcile_mounted` 保证在册挂载 ≈ 1–2 套 | 单流化只是把 1 条流换成 1 条流，收益 ≈ 0 |
| `WatchManifest` 按 (root, digest) 缓存 | 挂载次数确实随视图切换变多，但 C1 让读路径独立于挂载：面板先拿到 `pending`，随后由读/推送收敛 | 收益是「省一次几百毫秒的遍历」，代价是**缓存陈旧 ⇒ 漏掉切走期间新建的目录**（真回归）。不做 |
| 修 FSEvents 排除根 8 上限截断 | 实测日志：`applied=["neeko/node_modules", "src-tauri/target", "dsh-neeko/node_modules", …]` —— 重目录已在前几个，且正确性由回调过滤兜底 | 只损失成本收益，且当前每仓库只有 1 条流。不做 |

## Requirements

### R1 日志 target 过滤（P0）

- R1.1 自定义 `Log` 实现在写入前按 **target 前缀**丢弃第三方遍历噪声（`ignore::` / `globset::`）。
- R1.2 **不改** `set_max_level(Debug)`：我们自己的 DEBUG（`neeko_lib::…`）必须完整保留。
- R1.3 过滤清单是**有依据的白名单式黑名单**：只允许登记「实测占行数且我们从不读」的 target，
  并在常量文档里写清度量来源与再评估方法（不要收成「所有第三方都丢」）。
- R1.4 过滤不得影响 `LEVEL` 语义：`WARN`/`ERROR` 即便来自被过滤的 target 也应保留
  （那些是异常信号，不是逐目录噪声）。

### R2 决策记录（P0，只写文档）

- R2.1 在父任务 `prd.md` R4 与 `design.md §1.4` 登记「单流化 / manifest 缓存 / 排除根合并」的
  **前提消失**与理由（本文件 Background 的三行表），避免下一个人按旧计划重做。

## Acceptance Criteria

- [x] AC1 同一段操作后，`neeko.log` 中 `ignore::walk` / `globset::` 行数为 **0**。
- [x] AC2 我们自己的 DEBUG 仍在（`neeko_lib::common::git::status_worker` 等有行）。
- [x] AC3 来自被过滤 target 的 `WARN`/`ERROR` 仍落盘（单测覆盖）。
- [x] AC4 日志增长对比有数字（同一段操作前后），记录进 `implement.md`。
- [x] AC5 `cargo test --lib` 绿；`pnpm check:quick` 绿。

## 非目标

- 单流化 / 前缀索引（前提消失，R2.1 已登记）。
- `WatchManifest` 缓存（陈旧风险 > 收益）。
- FSEvents 排除根合并（重目录已命中，正确性已有兜底）。
- 不改日志格式 / 轮转策略 / `MAX_LOG_BYTES`。
