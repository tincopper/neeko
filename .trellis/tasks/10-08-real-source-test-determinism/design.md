# design — 真实源测试的确定性契约

> 对应 `prd.md` 的 R1–R5 / D1–D3。本文件只讲技术设计与边界，不重复需求。

## 1. 契约模型（D1 的落地形态）

真实源测试里合法 / 非法的断言，用一张判定表钉死（同时是 spec 正文的骨架）：

| 断言对象 | 形态 | 例 | 归属层 | 真机测试 |
| --- | --- | --- | --- | --- |
| 分类 / 划分 | 精确（`==`/`!=`/集合） | `classify([index]) == IndexChanged` | 纯函数 | ✅ 唯一落点 |
| 事件观察者 | 绝对零 / 精确集合 | `assert_eq!(refs.load(..), 0)` | — | ❌ 禁止 |
| 事件观察者 | 与运行时基线比较 | `assert_eq!(count, baseline)` | 真机 | ✅ 差分式 |
| 事件观察者 | 单向可达 | `probe.wait_reached(..)` / `assert_ne!(n, 0)` / `n > 0` | 真机 | ✅ 唯一正向写法 |

两条推论（写入 spec 正文）：

1. 真实源承诺 `≥`（至少一次），不承诺 `=`；对 `≥` 只能断言"目标发生过"。
2. 失败方向成本不对称 —— 过触发 = 一次幂等重算（有界），漏触发 = 无界陈旧（危险）。
   所以真机测试**只保护假阴性方向**，对假阳性必须容忍。

## 2. R1 — 遏制（`git_meta/tests/watcher.rs`）

- 删除 `130/131`（index 测试的 head / refs 零断言）与 `206/207`（refs 测试的 index / head 零断言）。
- 各测试保留正向可达断言；head / packed 测试本无跨回调断言，不动。
- `classify_git_meta_event` 与 `GitMetaPaths` 一行不改（D2）。
- 文件头「确定性约定」注释改为指向 spec 的指针（避免第二份规则正文），并保留"负向分类属性由
  units.rs 覆盖"的说明。

## 3. R3 — 观察探针（`CallbackProbe`）

**位置**：`src-tauri/src/common/file/watcher/probe.rs`，`#[cfg(test)]` + `pub(crate)`，
在 `watcher/mod.rs` 以 `#[cfg(test)] mod probe;` 挂载。选独立模块而非塞进 `sink.rs`：
probe 是"闭包回调"形态，`CollectingSink` 是"sink"形态，语义不同；且独立模块让 guard 的域判定
（见 §4）不会因定义点而误伤。

**API（正向唯一、计数不暴露）**：

```rust
pub(crate) struct CallbackProbe { hits: Arc<AtomicUsize> }

impl CallbackProbe {
    pub(crate) fn new() -> Self;
    /// 每次调用产出一个可传给 create_git_meta_watcher 的回调。
    pub(crate) fn callback(&self) -> impl FnMut() + Send + 'static;
    /// 有界轮询：反复 poke（可重试写入）直到回调至少命中一次。
    /// 只回答「到达过」；没有 count()/hits() 访问器 ⇒ 绝对零写不出来。
    pub(crate) fn wait_reached(&self, timeout: Duration, poke: impl FnMut()) -> bool;
}
```

**为什么不是过度设计**：它替换的正是现有 `Arc<AtomicUsize>` + 手写 `wait_until` 组合；
净代码量近似持平，但把"计数"从可访问状态变成封装内部。YAGNI 边界：不做超时配置对象、
不做事件类型参数化、不触碰 `CollectingSink`。既有 `sink.rs` 用例与 `lifecycle_tests.rs`
不强制迁移（R3 只要求闭包回调形态有唯一正原语）。

**迁移面**：`git_meta/tests/watcher.rs` 的 `spawn_watcher_for` / `spawn_git_meta_watcher_spy`
返回三个 `CallbackProbe`，删除本地 `wait_until` 与 `AtomicUsize/Ordering` import。

## 4. R4 — 域级 guard

**文件**：`tools/guards/checks/check_nondeterministic_event_assertions.py`
（id 与文件名一致，自动注册）；自测 `tools/guards/tests/test_check_nondeterministic_event_assertions.py`。

**Guard 元数据**：

```python
GUARD = Guard(
    id="check_nondeterministic_event_assertions",
    title="真实源事件观察者禁止绝对零 / 精确集合断言（只能单向可达或差分式）",
    scopes=("src-tauri/src/**/*.rs", "src-tauri/tests/**/*.rs"),
    red_lines=(),                       # 见 §9 决策待确认
    docs=".trellis/spec/unit-test/real-source-determinism.md",
    fix_hint="正向用 CallbackProbe::wait_reached / wait_for_event；负向分类下沉 units 纯函数；"
             "生命周期负向改差分式（assert_eq!(count, baseline)）",
)
```

**域判定（结构信号，看文件是否真的用真实异步事件源 / 有界等待原语）**——命中任一即入域：

- `create_git_meta_watcher(`
- `RecommendedWatcher::new(`
- `WatcherManager::new(`
- 有界等待原语定义：`fn wait_until` / `fn wait_for_event` / `fn touch_and_wait` / `fn wait_reached`
- 逃生舱注解：`@nondeterministic-domain`（未来接入进程 / 时钟 / 网络源时用；本次仅为可扩展点）

**判据（仅域内）**：`assert_eq!` 两侧**恰好一侧是裸整数字面量**，另一侧表达式含
`.load(` 或 `.count(` ⇒ 违规。`assert_ne!` 不拦（`assert_ne!(n, 0)` 是合法正向可达）。

**语料验证（已实测，作为 guard 自测的反例集）**：

| 文件 | 是否入域 | 结论 |
| --- | --- | --- |
| `git_meta/tests/watcher.rs` | ✅（`create_git_meta_watcher(`） | `130/131/206/207` 命中（R1 后归零） |
| `manager/lifecycle_tests.rs` | ✅（`WatcherManager::new(` + `fn wait_for_event`） | 负向均与 `baseline` 比较 ⇒ 不命中；`watcher_set_creations()` 无 observer 形态 ⇒ 不命中 |
| `sink.rs` | ❌ | `161–163` 不受影响（确定性替身） |
| `registration/tests.rs` | ❌ | 注入 MockWatcher、无等待原语 |
| `conversation/manager.rs` | ❌ | `1988` 假 adapter，确定性 |
| `lsp/diag_bus.rs` / `terminal/drain.rs` 等 | ❌ | 进程内计数器，无真实源 |

**自测矩阵（护栏没有测试 = 没有护栏）**：

1. 正例：入域文件 + `assert_eq!(refs.load(..), 0)` → VIOLATION（行号正确）。
2. 反例·确定性：**未入域**文件 + 同样断言 → PASS（钉住 `conversation/manager.rs` 语义）。
3. 反例·差分：入域文件 + `assert_eq!(sink.count(X), baseline)` → PASS。
4. 反例·正向：入域文件 + `assert!(sink.count(X) > 0)` / `assert_ne!(n, 0)` → PASS。
5. 空转：`context` 指向无匹配文件的临时仓库 → 由框架判 ERROR（`scanned == 0` 反空转），
   并断言 `scanned` 计入真实文件数（非 0 场景）。
6. 逃生舱：`@nondeterministic-domain` 文件 + 违规断言 → 命中（注解只扩大域，不放行）。

**已知边界（写入 spec，不隐藏）**：域判定是结构启发式，不是类型级保证；手搓 `AtomicUsize`
并显式绕过仍可能，此时由本 guard 兜住——这正是把它登记为 `guard` 档（而非 `type`）的诚实理由。

## 5. R2 / R5 — spec 与台账

**新 spec**：`.trellis/spec/unit-test/real-source-determinism.md`（机制详解，唯一正文）。含：
判定表（§1）、正/反例、本次事故锚点、`CallbackProbe` 用法、guard id、以及收敛规则。

**接线（可达性）**：
- `.trellis/spec/unit-test/index.md` 指导原则第 2 条「真实优于 mock」→ 紧跟对偶条款一句 +
  链接到新 spec；
- `.trellis/spec/unit-test/backend-testing.md` §常见错误 → 新增「错误 #6：真实源绝对零断言」，
  链接到新 spec。

**台账**（`tools/guards/ledger/invariants.json` 追加）：

```jsonc
{
  "id": "nondeterministic-event-assertion-ban",
  "title": "真实源事件观察：断言只能是单向可达 / 差分式，禁止绝对零与精确集合",
  "tier": "guard",
  "enforcement": [
    { "kind": "guard", "ref": "check_nondeterministic_event_assertions" },
    { "kind": "test",  "ref": "tools/guards/tests/test_check_nondeterministic_event_assertions.py" }
  ],
  "red_line": null
}
```

**收敛规则（写入新 spec，R5 的可度量定义）**：同类事故必须回答「它属于哪条域级不变量」；
现有规则拦不住时，**必须先提升为更一般的形式**（扩大域判定或增加同域子判据），
只有当事故确实无法归入任何既有域时，才允许新增独立不变量，并在 spec 写明为何不能泛化。
本不变量与既有 `worktree-byte-assertion-ban` 登记为「环境契约被当作应用契约」类的两个特化（D3）。

## 6. 与 `check_worktree_byte_assertions` 的分工（D3）

| | 字节断言护栏（既有） | 事件观察者护栏（本任务） |
| --- | --- | --- |
| 对象 | 工作区**物化字节** | OS **事件流** |
| 触发平台差异 | autocrlf / 行尾 | FSEvents/inotify/RDC 后端 |
| 额外约束 | 禁止注入 `core.autocrlf`（生产配置） | — |
| 判据锚点 | `read_to_string` + `assert_eq!(字面量)` | 入域文件 + `assert_eq!(observer, 整数字面量)` |

两者不重复拦截（一个只对 `read_to_string` 变量，一个只对 `.load(`/`.count(`），因此**合并会丢判据**，
只做 spec 层的类归属声明。

## 7. 兼容 / 回滚

- **零运行时语义变更**：改动只落 `#[cfg(test)]` 测试支撑 + Python guard + 文档。
- 回滚点：R1（纯删断言，可 revert）；R3（probe 为新增模块，回滚不影响生产）；R4/R5（guard 文件
  + 台账一行，删除即回滚）。
- 平台：guard 是纯静态 Python，三平台一致；真实源测试的 Windows 行为由 CI 复验。

## 8. 权衡（被否方案）

| 方案 | 否决理由 |
| --- | --- |
| Windows 上 skip / retry / 加 sleep | 把契约缺陷转成假绿或延迟债务 |
| 全局换 `PollWatcher` | 非确定性从 OS 挪到轮询时序，且牺牲该测试存在理由 |
| 收窄 `classify`（`p == refs_dir` 判 Nothing） | 用无界陈旧换 flake（违反成本不对称） |
| 只加一条 per-pattern guard | 事故第 3 个特例，规则随事故线性膨胀，不收敛 |
| 把 guard 判据写成"任意 `== 0`" | 会误伤 `drain.rs` / `diag_bus.rs` / `conversation` 等确定性替身 |

## 9. 决策待确认

- **是否新增红线**：根 `AGENTS.md` 余量仅 995B，新增一条红线（签名 + 表格行）会消耗约 200B
  且需把正文放进 `src-tauri/AGENTS.md`。本设计**默认不加红线**（`red_line: null`）：
  强制力来自 guard（每次 commit / CI 必跑）+ `trellis-before-dev` 可达的 spec，远强于散文红线；
  先例 `component-size-budget` / `gate-topology-single-source` 同样 `red_line: null`。
  若你要求可发现性优先，可改判为新增红线 16（正文落 `src-tauri/AGENTS.md`）。
