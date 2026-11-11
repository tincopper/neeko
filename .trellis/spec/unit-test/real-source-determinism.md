# 真实源测试的确定性契约

> **唯一正文**：本文件是「测试对真实外部源（OS 文件事件 / 进程 / 时钟 / 线程调度）做断言」的
> 完整规则。`index.md` 与 `backend-testing.md` 只放指针，不复述判据。
> 护栏：`tools/guards/checks/check_nondeterministic_event_assertions.py`（id 同名，次数口径）
> 与 `tools/guards/checks/check_event_wait_attribution.py`（身份口径，见「归属」节）。
> 不变量台账：`tools/guards/ledger/invariants.json` → `nondeterministic-event-assertion-ban`
> / `event-observation-attribution`。

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
| 事件观察者 | 归属无关（「有没有事件」当证据） | `!sink.event_names().is_empty()` | — | ❌ **禁止**（见「归属」节） |
| 事件观察者 | 按单元归属 | `wait_for_unit_snapshot(&sink, &unit.key(), 1, ..)` | 真机 / 合成 | ✅ **唯一正向写法** |

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

// ✅ 正例 1（单向可达）：**首选**注入合成事件，不建真实流。
// （旧写法 `CallbackProbe::wait_reached` 已随 2026-10 解耦删除，见「观察原语」节）
dispatch_git_meta_event(std::slice::from_ref(&meta.index), &meta,
    &mut index_hits, &mut head_hits, &mut refs_hits);
assert_eq!((index_hits, head_hits, refs_hits), (1, 0, 0));

// ✅ 正例 2（差分式生命周期负向）：与运行时基线比较，quiet > debounce 上限。
let baseline = sink.count(FILE_CHANGED_EVENT);
manager.unwatch(&unit);
std::thread::sleep(QUIET_WINDOW);
assert_eq!(sink.count(FILE_CHANGED_EVENT), baseline);
```

## 观察原语：优先「注入事件」，其次 `CollectingSink`

> **2026-10 修订**：原 `CallbackProbe`（`watcher/probe.rs`）已删除 —— 它的唯一用法是
> 「反复写真实文件直到回调命中」，而那条路径在 2026-10 的测试解耦中整体被替换成
> **事件注入**（见下节「成本约束」）。**不要**再按旧名去找它。

正向断言（「目标发生过」）现在有两条受祝福的路径，**优先第一条**：

**1. 回调注入（首选）** —— 被测对象是纯函数或已有注入缝时，直接喂合成事件：

```rust
// 回调层：build_notify_callback 返回 impl FnMut(Result<Event,_>)，签名本身就是纯函数
feed(Ok(notify::Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
    .add_path(root.join("a.txt"))));
assert_eq!(sink.count(FILE_CHANGED_EVENT), 1);   // 同步断言，零 sleep

// 状态机层：WatcherManager::new().without_real_fs() 把**合成扇出器**交给测试
let mut feed = manager.take_test_event_sink().expect("noop 模式必须交出回调");
feed.feed(Ok(event));   // 扇出器内部按生产同构路由（见下表最后一行）
```

**2. `CollectingSink`（真实投递已下沉后的残余）** —— `sink.rs::test_support::CollectingSink`，
保持兼容；`manager/lifecycle_tests.rs` 的差分式负向已合规，沿用即可。

两条路径都**不暴露**可直接与整数字面量比较的裸观察器 ⇒ 精确集合 / 绝对零断言无处表达。

## 归属：事件观察必须归因到被断言的主体（2026-11 新增）

「真实源只承诺 `≥`」管的是**次数口径**；本节管**身份口径**：观察到的这一次，是不是你以为
的那个主体发出来的？

- 批量入口（`git/services/status.rs::activate_many`、`WatcherManager::reconcile_mounted`）
  一次只注入**一个**端口给整批单元。端口观察到的事实永远是「这批里某个单元发生了某事」。
- 于是「有没有事件」不能作为「某个单元已就绪」的证据 —— 被兄弟单元的投递满足是**必然**的，
  只需要一台慢机（本地 macOS 上第一个快照通常几毫秒就绪，这个窗口根本张不开）。

判据（三层机制，逐层收紧）：

| 层 | 判据 | 落点 |
| --- | --- | --- |
| 数据 | 归属是事件载荷的一部分：`WatcherEvent::workspace_key()`（与 `name()` 对称的单点映射） | `sink.rs` |
| 类型 | 观测口**只**暴露带 `workspace_key` 的查询（`count_for` / `names_for`）；无归属查询**编译期不存在** | `sink.rs::test_support` |
| 结构 | 等待原语单点且强制带 key：`wait_for_unit_event` / `wait_for_unit_snapshot`；测试文件不得手写「循环体内查 sink」 | 护栏 `check_event_wait_attribution` |

```rust
// ❌ 反例（2026-11 CI 假失败的原形态）：等「A 的首份快照」，判据却是「任意事件」
while Instant::now() < deadline {
    if !sink.event_names().is_empty() { return true; }   // B 的推送满足它
    ...
}

// ✅ 正例：等的是**这个单元**的快照事件
assert!(wait_for_unit_snapshot(&sink, &repo_a.key(), 1, FIRST_EVENT_TIMEOUT));
// 登记表先写后 emit ⇒ 事件已到即数据已到（`deliver_push`：upsert_push → emit）
assert!(manager.snapshot(&repo_a).is_some());
```

配套事实（为什么正例的第二行可以这样写）：`deliver_push` 先 `upsert_push` 再 `emit`，因此
「该单元的 snapshot 事件已到」⇒「登记表里必有该单元」；反之不成立 —— **没有事件是合法的**，
冷窗口超时是 `Pending`，不是错误（见 `git-domain.md` §12）。

**为什么它不并入 `check_nondeterministic_event_assertions`**：那条的判据只在其**域内**生效
（域 = 真的用了真实异步事件源 / 有界等待原语的文件），而归属错误与「源是否真实」无关 ——
`without_real_fs` 的合成事件夹具同样会把旁单元的事件当成自己的证据，`git/services/status.rs`
这类服务层夹具甚至不在那条护栏的域里。判据机制也不同（后者扫 `assert_eq!` / `assert!` 的
实参形态，前者扫观测口的公开方法与循环体）。两者是同一元类「观察者读数 ≠ 被断言的命题」的
两个**适用范围不同**的特化，故分列而不合并。

## 成本约束：真实源测试的「性能税」（2026-10 新增）

断言口径合规**不等于**测试开销合规。真实源还有一条独立的成本特性，违反时测试会：

- 拖慢套件（本任务前：`watcher` 相关 48s → 改造后 6.6s）；
- 把 `fseventsd` 打到 100% CPU（实测）；
- 且 **debug 与 release 差异达 ~100 倍**（同一 `MacFseventWatcher` 测试：debug 78%，release 0.1~0.7%）。

### 判据：先问「断言的对象属于谁」

| 断言对象 | 归属 | 正确做法 |
| --- | --- | --- |
| **分类 / 分支 / 过滤逻辑** | 本仓代码 | **下沉纯函数，零 IO** |
| **状态机（号段 / 票号 / 快照槽位）** | 本仓代码 | 注入事件 + `worker_only` 风格替身，**零流** |
| **OS 是否真的投递了某事件** | **Apple / Linux 内核** | 不为它写测试（外部契约是既成事实） |

第三行是本节的硬结论：**「FSEvents 会把 `.git/index` 的改动送到回调」不是本仓的契约，
是 Apple 的**。为它建真实流，等于用测试去验证第三方实现的稳定性 —— 收益为零，成本是
100% CPU + 秒级耗时。`git_meta` 的四个 `*_on_real_fs` 用例因此被删除，改为
`dispatch_git_meta_event` / `should_handle_event` / `translate_flags` 的纯函数测试。

### 已落地的注入缝（复用，不要另造）

| 位置 | 缝 | 用途 |
| --- | --- | --- |
| `manager/callbacks.rs::build_notify_callback` | 返回 `impl FnMut(Result<Event,_>)` | 回调层全部语义（gitignore 过滤 / hard-noise / 结构事件 / git 元数据分类） |
| `manager/core.rs::WatcherManager::without_real_fs()` + `take_test_event_sink()` | 测试模式不建流、交出**扇出器** `TestWatchStream` | 编排与状态机测试 |
| `manager/git_meta_merge.rs::dispatch_git_meta_event` | 纯函数 | 「一批路径 → 分类 → 三出口」**唯一**分发实现（含合并路径与独立流，不得各写一份 match） |
| `git_meta/paths.rs::GitMetaPaths::touches` | 纯方法 | 「该批路径是否属于本单元 git 元数据」的**唯一**前缀判据 |
| `manager/git_meta_merge.rs::decide(root, git_repo, exclusions, backend_can_exclude, env_off, ws)` | 纯函数（`env_off` 是**参数**） | 合并可行性判定；不得在函数内读 `std::env` |
| `platform/macos_fsevent.rs::should_handle_event` / `translate_flags` | 纯函数 | 路径过滤与 flags→EventKind 映射 |
| `git_meta/watcher.rs::create_git_meta_watcher_with(watch_fn)` | 注入 `watch_fn` | 失败分支 |

> **两条传输必须同构**（2026-10-26 事故）：git 元数据走「合并进主回调」（macOS 递归后端）
> 或「独立流」（Linux 逐目录注册 / Windows 整树过滤），由 `decide` 的平台能力位决定。
> 因此测试替身不能只交出一条回调 —— 那在非 macOS 上两条传输都不存在，
> `.git/refs/**` 事件落进 `is_hard_noise_path` 被丢弃，而用例仍以为在验证生产链路
> （macOS 绿、Linux/Windows 红）。`TestWatchStream` 按事件路径扇出，拨的就是
> 该平台真实的扇出点。回归钉子：`synthetic_sinks_route_git_paths_to_whichever_transport_is_live`。

### 若确需真实流（平台后端契约）

只在「验证我们自己写的那层 FFI 封装」时保留，且：

- **串行**（进程级 `Mutex` 守卫）—— 并发流会把 fseventsd 峰值叠加成持续满载；
- **只写一次、纯等待**，不要 `while { write; sleep }` 循环重试 ——
  配合本后端的 `latency: 0.0 + NoDefer`，每次写入立刻唤醒一次处理，
  8s 超时下最多 40 次写入，实测把 CPU 打到 80%+；
- 优先在 **release** 下跑（debug 放大 ~100 倍）。

### 排查提示（避免重复踩坑）

`cargo test` 期间 `fseventsd` 高 CPU **不必然**来自本仓测试：

- 先在同一台机器上跑一个**完全不建文件**的测试模块（如 `parsers`）作对照 —— 若也应 0%，
  说明基线干净；
- 全量测试会大量创建/删除临时文件，**唤醒系统里所有 FSEvents client**
  （Electron 应用、WeChat、云盘、编辑器索引等），fseventsd 的 CPU 是它们共同造成的；
- 判定「本仓是否真的建了流」用确定性手段：在 `with_exclusions` / `watch` 加一次性计数器，
  比用 `sample` 反推可靠（`sample fseventsd` 需 sudo）。

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
- **判据（二）—— 归属**（`check_event_wait_attribution`，机制见上节「归属」）：
  `impl CollectingSink` 的公开方法（除 `new`）必须接 `workspace_key`；除 `sink.rs` 外
  不得出现「循环体内查 sink」的手写轮询。已知边界：经函数指针间接轮询、或在 A 函数里循环
  调用 B 函数里的查询，不在射程内（实测本仓无此写法）。
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
- 2026-11（仅 windows-latest 红）：`git::services::status::tests::declaring_two_units_mounts_both`
  的 `snapshot(&repo_a).is_some()` 失败。根因不是产品缺陷，而是**证据归属错位**：等待谓词是
  `!sink.event_names().is_empty()`，同批（`activate_many` 一个端口供整批）B 的 `git-status-snapshot`
  先到 ⇒ 等待返回，而 A 的冷窗口（合法 `Pending`）还在算。产品侧已由「事件先登记后 emit」
  反证不可能。修法见「归属」节：归属进观测口、等待原语单点且强制带 key + 护栏。

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
