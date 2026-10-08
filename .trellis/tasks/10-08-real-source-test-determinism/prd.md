# 真实源测试的确定性契约：域级不变量 + 观察探针 + 收敛台账

## Goal

把「测试对**真实外部源**（OS 文件事件 / 进程 / 时钟 / 调度）做精确断言」这一**反复发作的同类缺陷**，
从「每次事故加一条特例护栏」收敛为「一条域级不变量 + 默认正确的观察原语 + 机读台账」，
使**同类事故不再随事故数量线性增加规则**。

触发事故（2026-10-08，CI run 37725051884，commit `eba3c7b0`，仅 windows-latest 红）：

```
common::file::watcher::git_meta::tests::watcher::git_meta_watcher_detects_index_change_on_real_fs
watcher.rs:131: assert_eq!(refs_changed.load(Ordering::SeqCst), 0)   // left: 1, right: 0
```

## Background（已核实事实，含锚点）

**事故本身**

- 失败断言由 `286aefbf`（refs 监听提交）引入；`eba3c7b0` 是含该提交的第一次 CI 运行。
- 正向部分（`index_changed > 0`）通过，说明事件链路正常；被打破的只是「写 index 不得触发 refs 回调」。
- `classify_git_meta_event` 用 `p == packed_refs || p.starts_with(refs_dir)` 判 refs
  （`git_meta/classify.rs`）；`starts_with` **包含与目录自身相等**，即「`refs` 目录条目本身」
  也被判为 `RefsChanged`。Windows 的 `ReadDirectoryChangesW` 后端会产生目录级事件，命中该分支。
- **对产品无害**：`on_refs_changed` 只做 `scheduler_tx.send(())` 提示，不 emit 事实
  （`manager/core.rs:388+`）——多一次提示 = 一次幂等重算；漏一次提示 = 无界陈旧
  （正是 `286aefbf` 要修的 bug）。成本不对称方向明确：**过触发安全，漏触发危险**。

**同类事故史（同一产生器）**

| 事故 | 断言 | 误把环境当契约 |
| --- | --- | --- |
| 工作区换行字节断言（红线 11） | `assert_eq!(bytes, "...\n")` | 工作区物化字节 |
| macOS FSEvents 迟到事件污染 | `assert_eq!(index_changed, 0)` | 事件集合精确 |
| 本次 Windows refs 误触发 | `assert_eq!(refs_changed, 0)` | 事件集合精确 |

**产生器**：`.trellis/spec/unit-test/index.md` 指导原则写明「真实优于 mock」，但**没有对偶条款**
（真实源只承诺单向可达，断言必须单向）。准则缺一半 ⇒ 使用者把纯逻辑层的精确断言工具搬到真实源测试。
且该规则曾以注释形式写在 `git_meta/tests/watcher.rs` 文件头，**一个 commit 后即被违反** ⇒
「写下来」不构成强制。

**仓库内两套未命名的真实源负向惯例（本次 Q1 已裁决，见 Decisions）**

- `git_meta/tests/watcher.rs`（文件头）：不用墙钟窗口做负向断言；负向分类属性由 `units.rs` 纯函数覆盖。
  实际仍留了 4 条绝对零断言：`watcher.rs:130/131/206/207`。
- `manager/lifecycle_tests.rs`（1–35 行）：负向一律**差分式**——`记录基线 → 触发 → 静默 QUIET_WINDOW →
  计数不得增长`，且 `QUIET_WINDOW` 必须大于 debounce 上限。断言的是**生命周期**属性，无法下沉纯函数层。

**已有的机制资产（本任务复用，不重造）**

- 护栏契约：`tools/guards/core/contract.py`（`GuardResult`、`scanned` 必填反空转、退出码 1/2 区分）。
- 护栏自动注册：`tools/guards/checks/` 目录本身即清单；`check_worktree_byte_assertions.py` 是同类先例
  （模块头「第一性原理」+ `Guard(id, scopes, red_lines, docs, fix_hint)`）。
- 护栏自测先行：`core/selftest.py` 在每次 `run` 前跑 `tools/guards/tests/test_*.py`；无测试 = 注册表判错。
- 不变量台账：`tools/guards/ledger/invariants.json` + `check_invariant_enforcement`（六档
  type/structure/guard/lint/test/prose；指针式落点；红线引用校验）。
- 观察替身先例：`src-tauri/src/common/file/watcher/sink.rs::test_support::CollectingSink`。
- 注入接缝先例：`create_git_meta_watcher_with(watch_fn)`（失败分支确定性覆盖）。

**域判定可行性（已用真实语料核实）**

- 现役 4 条违规 `.load(...), 0` 全部且仅在 `git_meta/tests/watcher.rs`。
- `sink.rs:161–163` 的 `.count(...), 1/0`、`conversation/manager.rs:1988` 的 `.load(...), 0`、
  `lsp/diag_bus.rs:139`、`terminal/drain.rs:338` 等均为**确定性替身/进程内计数**，无真实源。
- `registration/tests.rs` 虽 import `notify::`，但用注入 MockWatcher、无异步等待，属确定性。

**约束**

- 根 `AGENTS.md` 体积余量仅 **995 字节**（cap 16384，`agents_md_routing.json`）；`src-tauri/AGENTS.md`
  余量 5010。新增红线正文若落在根文件不可行。

## Decisions

- **D1（Q1，已定）真实源负向断言采用二分法**：
  - **分类 / 划分类负向**（「index 事件不得被判为 refs」「事件集合精确」）→ **只在纯函数层断言**，
    真机测试禁止。理由：`classify` 是全域可确定性覆盖的；真机只承诺 `⊇`，断言补集必然不可靠。
  - **时序 / 生命周期类负向**（「unwatch 后不再投递」「不泄漏到别的单元」）→ 真机允许，但强制
    **差分式 + 静默窗口**（`基线 → 触发 → quiet → delta == 0`，且 `quiet > debounce 上限`）。
    理由：这类性质无法下沉纯函数层，差分式对背景噪声免疫且只产生假通过、不产生假失败。
  - 否决 B（一刀切禁止一切真机负向）：会拆掉 `unwatch_stops_delivering_events` 这类泄漏守护
    （该缺陷 2026-09-24 真实回归过）。否决 C（维持绝对零 + 重试放宽）：等于不承认缺陷。
- **D2**：`classify_git_meta_event` 匹配语义**不动**（收窄 `p == refs_dir` 是以无界陈旧换 flake）。
- **D3**：新建**独立** guard，与 `check_worktree_byte_assertions` 显式分工而非合并 —— 后者含
  「禁止注入 `core.autocrlf`」这种**生产配置**约束（非测试断言），语义不同，合并会混淆两类落点。
  两者在 spec 中登记为同一「环境契约被当作应用契约」类的两个特化。

## Requirements

### R1 — L1 遏制：恢复 main 绿，且不削弱正向覆盖

修正 `git_meta/tests/watcher.rs` 的 4 条跨回调绝对零断言（`130/131/206/207`）。
- 保留各测试的**正向可达**断言（index/HEAD/refs/packed 各一条）。
- 分类正确性（index 优先级、refs 命中、config/ORIG_HEAD → Nothing）继续由 `units.rs` 纯函数覆盖。
- **不得**通过收窄 `classify` 让测试变绿（D2）。

### R2 — L1 语义：补齐准则（根因层）

把测试准则补齐为双向，并落地 D1 的负向分类法，写入 `.trellis/spec/unit-test/`。
- 明确：真实源（FS 事件 / 进程 / 时钟 / 线程调度）承诺 `≥`（至少一次 / 单向可达），**不承诺 `=`**。
- 由「真实优于 mock」推出对偶条款：用真实源时断言只能表达「目标发生过」。
- 给出 D1 判定表与正 / 反例代码，锚点指向本次事故；并写明**收敛规则**（见 R5）。
- 必须从 `trellis-before-dev` 的加载路径（`.trellis/spec/unit-test/index.md`）可达。

### R3 — L2 结构：让正确断言成为默认（观察探针）

为非确定性域的**闭包回调形态**提供受祝福的观察原语：
- 正向只有「最终到达」一种写法（有界轮询 + 重试触发）；
- 不暴露命中计数 ⇒ 精确集合 / 绝对零断言在该原语上**没有对应 API**；
- 既有 `CollectingSink` 保持兼容（sink 形态的既有原语，用例不改）。

### R4 — L3 机器：域级不变量（一条规则覆盖一类）

新增 guard，对「非确定性域」内测试代码施加**域级不变量**：
- 域判定基于**文件是否使用真实异步事件源 / 有界等待原语**（结构信号），不基于断言形状；
- 域内禁止把「事件观察者读取」与整数字面量做 `assert_eq!`（绝对零与精确集合同罪）；差分式
  （与运行时基线比较）与正向可达（`wait_reached` / `> 0` / `assert_ne!(_, 0)`）允许；
- 必须**不**命中确定性替身（`conversation/manager.rs:1988`、`sink.rs:161–163`、
  `registration/tests.rs`、`lifecycle_tests.rs` 的生命周期计数断言）；
- 必须有护栏自测（正例命中 / 反例不命中 / 空转）。

### R5 — L4 收敛：台账登记 + 收敛规则

- 在 `tools/guards/ledger/invariants.json` 登记本不变量（tier / enforcement 指针 / red_line）。
- 约定并写明**收敛规则**：同类事故必须回答「它属于哪条域级不变量」；现有规则拦不住时，
  **必须提升为更一般的规则（扩大域判定 / 增加同域子判据），而不是新增一条特例 guard**；
  只有当事故确实无法归入任何既有域时，才允许新增独立不变量并写明为何不能泛化。

## Acceptance Criteria

- [ ] AC1（R1）`git_meta/tests/watcher.rs` 不再含跨回调绝对零断言；各测试正向可达断言保留；
      本机 `cargo test git_meta` 全绿；Windows 由 CI 复验。
- [ ] AC2（R2）`.trellis/spec/unit-test/` 含双向准则 + D1 判定表 + 正/反例 + 事故锚点 + 收敛规则，
      且从 `.trellis/spec/unit-test/index.md` 可达。
- [ ] AC3（R3）非确定性域（闭包回调形态）存在唯一观察原语，只提供单向可达、不暴露计数；
      `sink.rs` 既有 `CollectingSink` 用例保持通过。
- [ ] AC4（R4）新 guard 自测通过（正例命中 / 反例不命中 / 空转）；`python3 tools/guards/run.py run`
      全绿；且不命中 R4 列出的全部确定性语料。
- [ ] AC5（R5）`invariants.json` 含本不变量且 `check_invariant_enforcement` 通过；收敛规则写入 spec。
- [ ] AC6 整体：`pnpm lint` 通过；`pnpm test:rust` 通过；`git_meta` 相关测试不依赖固定时序窗口做
      **分类**负向断言。

## Out of Scope

- 不改 `classify_git_meta_event` 匹配语义（D2）。
- 不做「全局换 `PollWatcher`」或「Windows 跳过 / 重试」。
- 不重构 `manager/lifecycle_tests.rs` 的既有差分式负向惯例（D1 判定其已合规）。
- 不改产品运行时行为（零运行时语义变更）。
- 不合并 / 重写 `check_worktree_byte_assertions`（D3）。
- 不为本不变量新增红线（见 design「决策待确认」：根 `AGENTS.md` 余量 995B）。
