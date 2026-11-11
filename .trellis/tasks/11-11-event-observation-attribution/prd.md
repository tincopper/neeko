# 事件观测归属化：共享 sink 等待必须按单元 key

## Goal

终结「共享观测口 + 归属无关谓词 ⇒ 用例证明的不是它声称的那件事」这一类假失败（2026-11
Windows CI `declaring_two_units_mounts_both` 首次现身），把归属从「测试作者记得」升级为
**类型系统强制**，并给观测口加一条防回退护栏。

## 事故链（已核实）

`git/services/status.rs:657-661`：等「A 的首份快照」，谓词是 `!sink.event_names().is_empty()`。
`activate_many`（`status.rs:376-379`）一次只注入**一个**端口给整批单元 ⇒ B 的
`git-status-snapshot` 满足该谓词；同时 A 的冷窗口超时（`RECALC_WAIT_TIMEOUT = 1500ms`）
是**合法** `Pending`，A 的 worker 仍在算 ⇒ `snapshot(&repo_a)` 为 `None` ⇒ 断言炸。

反证产品侧无缺陷：`deliver_push`（`manager/core.rs:1164-1180`）先写登记表再 emit；
`release_one` 不删登记数据；`MAX_ENTRIES = 64` 不会因两个单元触发淘汰。也就是
「A 的快照事件已到但登记表没有 A」在结构上不可能 —— 断言失败只能说明那条事件**不是 A 的**。

同一弱判据另有 3 处（`status.rs:609`、`:698-702`，以及 `lifecycle_tests.rs` 的
`wait_for_event` / `wait_for_more_events`），条件相同、迟早以同形态炸。

## Requirements

- R1 **归属是一等字段**：`CollectingSink` 记录每条事件的 `(name, workspace_key)`，归属来源是
  `WatcherEvent::workspace_key()`（与 `name()` 对称的**载荷身份单一映射源**），不由观测口猜。
- R2 **无归属查询面卸载**：`CollectingSink` 只暴露带 `workspace_key` 的查询
  （`count_for` / `names_for`）；`count(name)` / `event_names()` 从公共面消失 ⇒ 弱谓词**编译不过**。
- R3 **等待原语单点且归属化**：`wait_for_unit_event(sink, workspace_key, name, at_least, timeout)`
  是唯一 sink 等待入口，只在 `sink.rs::test_support` 声明；各测试文件不得自造轮询循环。
- R4 **迁移既有调用点**：`git/services/status.rs`（4 处）、`manager/lifecycle_tests.rs`
  （9 处等待 + 13 处计数）、`manager/callback_tests.rs`（5 处）全部改为按单元归属断言。
- R5 **护栏防回退**（`tools/guards/checks/check_event_wait_attribution.py`）：
  - J1 `impl CollectingSink` 中的 `pub(crate) fn` 除 `new` 外必须含 `workspace_key` 参数；
  - J2 除 `sink.rs` 外，测试代码不得出现「循环 + sink 查询」的手写轮询（= 自造等待原语）。
- R6 **规格同步**：机制与判据写进 `.trellis/spec/unit-test/real-source-determinism.md`
  （与既有「真实源只承诺单向可达」同域），护栏 `docs` 指针指向它。

## Constraints

- 纯测试支撑 + 护栏 + 文档改动，**不动产品语义**（`Pending` 仍是合法结局，事件仍是收敛保证）。
- 不放宽任何既有断言强度：迁移后「A 的快照已落地」必须由 A 自己的快照事件证明；
  `assert!` 的时限（`FIRST_EVENT_TIMEOUT = 8s`）不变。
- 不引入新依赖；`sink.rs` 已可用 `tokio`（测试支撑模块在 `#[cfg(test)]` 内）。

## Acceptance Criteria

- [x] AC1 `CollectingSink` 不再提供无归属查询；`cargo check --all-targets` 通过（编译期强制）。
- [x] AC2 `sink.rs` 新单测：只投 B 的快照 ⇒ 等 A **超时返回 false**、等 B **立即 true**
      （先写 Red，旧实现下必红）。
- [x] AC3 `sink.rs` 新单测：`WatcherEvent::workspace_key()` 对 5 个变体全部返回载荷的单元 key。
- [x] AC4 迁移后的既有用例全绿：`cargo test --lib` 中
      `git::services::status::tests::*`、`common::file::watcher::manager::*` 全通过。
- [x] AC5 护栏在旧代码上红、在新代码上绿（本地用 `python3 tools/guards/run.py run --only check_event_wait_attribution`
      验证；违规样本至少覆盖 J1、J2 各一条）。
- [x] AC6 `pnpm check:quick` 通过（含新护栏）。
- [x] AC7 spec 章节落地，护栏 `docs` 指针可解析。

## 落地记录

- 归属字段：`WatcherEvent::workspace_key()`（`sink.rs`，`#[cfg(test)]` —— 唯一消费者是观测口）。
- 观测口：`CollectingSink{name, workspace_key}` + `count_for` / `names_for` /
  `wait_for_unit_event` / `wait_for_unit_snapshot`；`count` / `event_names` **已删除**（编译期强制）。
- 迁移：`git/services/status.rs` 4 处、`manager/lifecycle_tests.rs` 22 处、`manager/callback_tests.rs` 7 处。
  顺带删除一条**恒真假断言**（`pull_branch_computes_without_mounting_or_releasing_other_units`
  里的 `sink.event_names().is_empty()`：sink 从未交给任何被调方，永远为空 ⇒ 钉不到任何东西），
  改为结构性说明。
- 护栏：`tools/guards/checks/check_event_wait_attribution.py`（J1 观测口归属化、J2 等待原语单点），
  配套 12 条单测；在**旧代码**上实测 5 条违规（`event_names` / `count` / 3 处手写轮询），新代码 0。
- 台账：`ledger/invariants.json` → `event-observation-attribution`（tier=guard）。
- 规格：`.trellis/spec/unit-test/real-source-determinism.md`「归属」节 + 判定表 + 事故锚点，
  并写明为何不并入 `check_nondeterministic_event_assertions`（判据域不同：归属与「源是否真实」无关）。
- 门禁：`pnpm check:quick` 通过（41 条护栏 0 违规）；`cargo test --lib` 中
  `common::file::watcher`（143 passed）与 `git::services::status`（12 passed）全绿。
