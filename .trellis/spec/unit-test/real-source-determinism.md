# 真实源测试的确定性契约

> **唯一正文**：本文件是「测试对真实外部源（OS 文件事件 / 进程 / 时钟 / 线程调度）做断言」的
> 完整规则。`index.md` 与 `backend-testing.md` 只放指针，不复述判据。
> 护栏：`tools/guards/checks/check_nondeterministic_event_assertions.py`（id 同名）。
> 不变量台账：`tools/guards/ledger/invariants.json` → `nondeterministic-event-assertion-ban`。

## 第一性原理：真实源只承诺 `≥`

真实源（notify/FSEvents/inotify/ReadDirectoryChangesW、进程、时钟、线程调度）**只承诺单向可达**：
「目标至少发生过一次」，**不承诺事件集合精确**，也不承诺「某回调不发生」。

- 因此对真实源只能断言**目标发生过**（`≥`）；对补集（「没发生」）的精确断言必然不可靠。
- 失败方向成本**不对称**：过触发 = 一次幂等重算（有界）；漏触发 = 无界陈旧（危险）。
  所以真机测试**只保护假阴性方向**，对假阳性必须容忍。
- 想断言精确集合 / 分类正确性，就把它**下沉到纯函数层**（那里可以确定性覆盖全域）。

「真实优于 mock」(`index.md` 指导原则 2) 只铺开了「用真实源」这一半；本文件是它的**对偶条款**：
用真实源时，断言口径必须跟着退到 `≥`。

## 判定表（钉死合法 / 非法）

| 断言对象 | 形态 | 例 | 归属层 | 真机测试 |
| --- | --- | --- | --- | --- |
| 分类 / 划分 | 精确（`==` / `!=` / 集合） | `classify([index]) == IndexChanged` | 纯函数 | ✅ **唯一落点** |
| 事件观察者 | 绝对零 / 精确集合 | `assert_eq!(refs.load(..), 0)` | — | ❌ **禁止** |
| 事件观察者 | 与运行时基线比较 | `assert_eq!(count, baseline)` | 真机 | ✅ 差分式 |
| 事件观察者 | 单向可达 | `probe.wait_reached(..)` / `assert_ne!(n, 0)` / `n > 0` | 真机 | ✅ **唯一正向写法** |

两条推论：

1. 真实源承诺 `≥`（至少一次）⇒ 用真实源时，断言只能表达「目标发生过」。
2. 负向断言二分法（D1）：
   - **分类 / 划分类负向**（「index 事件不得被判为 refs」「事件集合精确」）→ **只在纯函数层断言**，
     真机测试禁止。`classify` 是全域可确定性覆盖的；真机只承诺 `⊇`，断言补集必然不可靠。
   - **时序 / 生命周期类负向**（「unwatch 后不再投递」「不泄漏到别的单元」）→ 真机允许，但强制
     **差分式 + 静默窗口**：`基线 = 观测 → 触发 → quiet → delta == 0`，且
     `quiet > debounce 上限`（否则把「还没 flush」误判成「没有事件」）。这类性质无法下沉纯函数层，
     差分式对背景噪声免疫，只产生假通过、不产生假失败。

## 反例 / 正例

```rust
// ❌ 反例 1（绝对零）：跨回调精确零 —— Windows ReadDirectoryChangesW 的目录级事件会命中
//    refs 分支（`p.starts_with(refs_dir)` 含目录自身），CI 必挂（2026-10-08 事故）。
assert_eq!(refs_changed.load(Ordering::SeqCst), 0);

// ❌ 反例 2（精确集合，无论快慢）：真实到达次数由后端聚合行为决定，不是契约。
assert_eq!(index_changed.load(Ordering::SeqCst), 1);

// ✅ 正例 1（单向可达，唯一正向写法）：闭包回调形态用 CallbackProbe。
assert!(index_changed.wait_reached(Duration::from_secs(5), || {
    std::fs::write(meta.git_dir.join("index.lock"), "v2").unwrap();
    std::fs::rename(meta.git_dir.join("index.lock"), meta.git_dir.join("index")).unwrap();
}));

// ✅ 正例 2（差分式生命周期负向）：与运行时基线比较，quiet > debounce 上限。
let baseline = sink.count(FILE_CHANGED_EVENT);
manager.unwatch(&unit);
std::thread::sleep(QUIET_WINDOW);
assert_eq!(sink.count(FILE_CHANGED_EVENT), baseline);
```

## 观察原语：`CallbackProbe`

非确定性域的**闭包回调**形态有一份受祝福的观察原语（`src-tauri/src/common/file/watcher/probe.rs`，
`#[cfg(test)]` + `pub(crate)`）：

```rust
pub(crate) struct CallbackProbe { /* hits 私有 */ }

impl CallbackProbe {
    pub(crate) fn new() -> Self;
    pub(crate) fn callback(&self) -> impl FnMut() + Send + 'static;
    /// 有界轮询：反复 poke（可重试写入）直到回调至少命中一次。只回答「到达过」。
    pub(crate) fn wait_reached(&self, timeout: Duration, poke: impl FnMut()) -> bool;
}
```

- 正向只有「最终到达」一种写法；**不暴露** `count()` / `hits()` 访问器 ⇒ 精确集合 / 绝对零断言
  在该原语上**没有对应 API**。
- sink 形态（`sink.rs::test_support::CollectingSink`）是既有原语，保持兼容，不强制迁移；
  `manager/lifecycle_tests.rs` 的差分式负向已合规，沿用即可。

## 护栏（机械化兜底）

`check_nondeterministic_event_assertions` 对**非确定性域**内测试代码施加域级不变量：

- **域判定（结构信号，看文件是否真的用真实异步事件源 / 有界等待原语）**——命中任一即入域：
  `create_git_meta_watcher(` / `RecommendedWatcher::new(` / `WatcherManager::new(` /
  `fn wait_until` / `fn wait_for_event` / `fn touch_and_wait` / `fn wait_reached` /
  逃生舱注解 `@nondeterministic-domain`（只**扩大**域，不放行）。
- **判据**：域内 `assert_eq!` 两侧恰好一侧是裸整数字面量，另一侧是**裸** `.load(..)` / `.count(..)`
  读取 ⇒ 违规（绝对零与精确集合同罪）；同形的 `assert!(observer == 0)` 同罪（换宏不绕过）。
  `assert_ne!` / `assert!(observer != 0)` 不拦；差分式（`count(..) - baseline`）与
  正向可达（`> 0` / `wait_reached`）放行。
- **已知边界（诚实登记）**：域判定是结构启发式，不是类型级保证；手搓 `AtomicUsize` 并显式绕过仍
  可能，此时由本 guard 兜住——这正是它登记为 `guard` 档而非 `type` 档的理由。

## 事故锚点

- 2026-10-08，CI run `37725051884`，commit `eba3c7b0`，仅 windows-latest 红：
  `common::file::watcher::git_meta::tests::watcher::git_meta_watcher_detects_index_change_on_real_fs`
  的 `watcher.rs:131: assert_eq!(refs_changed.load(Ordering::SeqCst), 0)`（left: 1, right: 0）。
  正向部分（`index_changed > 0`）通过，说明事件链路正常；被打破的只是「写 index 不得触发 refs」。
- 同类事故（同一产生器）：
  - 工作区换行字节断言（红线 11）：`assert_eq!(bytes, "…\n")` —— 误把工作区物化字节当契约；
  - macOS FSEvents 迟到事件污染：`assert_eq!(index_changed, 0)` —— 误把事件集合精确当契约；
  - 本次 Windows refs 误触发：`assert_eq!(refs_changed, 0)` —— 同上。

## 收敛规则（同类事故必须遵守）

同类事故（「对不确定的真实源做精确断言」）**必须回答「它属于哪条域级不变量」**：

1. 先归域：它属于真实源断言域吗？属于哪条既有不变量（本文件 / `worktree-byte-assertion-ban`）？
2. **现有规则拦不住时，必须先提升为更一般的形式**——扩大域判定（加入新的真实源结构信号）或
   增加同域子判据；**禁止**新增一条特例 guard。
3. 只有当事故确实**无法归入任何既有域**时，才允许新增独立不变量，且必须在 spec 里写明
   **为何不能泛化**。

本不变量与既有的 `worktree-byte-assertion-ban` 是同一元类「环境契约被当作应用契约」的两个特化：

| | 字节断言护栏（既有） | 事件观察者护栏（本文件） |
| --- | --- | --- |
| 对象 | 工作区**物化字节** | OS **事件流** |
| 触发平台差异 | autocrlf / 行尾 | FSEvents / inotify / RDC 后端 |
| 额外约束 | 禁止注入 `core.autocrlf`（生产配置） | — |
| 判据锚点 | `read_to_string` + `assert_eq!(字面量)` | 入域文件 + `assert_eq!(observer, 整数字面量)` |

两者不重复拦截（一个只对 `read_to_string` 变量，一个只对 `.load(` / `.count(`），合并会丢判据，
因此只做本层的类归属声明。
