# 研究：W2 macOS FSEvents 物理排除 —— 参考实现与落地草案

> 回答两个问题：**能不能参考 VS Code？** 能（技术）；**能不能复用它的代码？** 不能（语言边界）。
> 并给出 Neeko 自己的最小落地路径，把"很复杂"收敛到可界定范围。

## 1. VS Code 是怎么做的（可参考的「技术」，不可复用的「代码」）

- VS Code 的文件监听走 `@parcel/watcher`：
  `out/vs/platform/files/node/watcher/watcherMain.js` 的
  `subscribe(path, cb, { backend: PARCEL_WATCHER_BACKEND, ignore: <files.watcherExclude globs> })`。
- 其原生 macOS 后端**链接并调用** `FSEventStreamSetExclusionPaths`（本机 `nm -u` 实证，
  VS Code / OpenCode / Orca 三处 `.node` 均如此）。
- 即：**一条递归 FSEventStream + 一张 exclusion 路径列表**；排除是**流级**的 ——
  内核不再把这些子树的事件投递给该流（应用侧零回调）。
- **不能直接复用**：`@parcel/watcher` 是 Node 原生插件（`.node`），运行在 Node 宿主里；
  Neeko 是 Rust/Tauri 进程，跨语言边界，不能 `require` 它。

**结论：参考它的"技术选择"，自己用 Rust 实现同一次 API 调用。**

## 2. 真正的复杂度只有一条

- 技术本身 = 一次 `FSEventStreamSetExclusionPaths(stream, CFArray<CFString>)` 调用。
- 复杂度来源**唯一**：`notify` 6.1.1 把底层 FSEventStream 私有化（`fsevent.rs` 不暴露 stream），
  且 `watch_inner` 每次 `watch()` 都 `stop()` + 重建流。因此 **要么改 notify，要么自写后端**。
- 其余（算排除集合、边界变化重建流、运行时回退、真机验证）都是常规工程，不是难点。

## 3. 所需绑定已全部具备（本机实证，`fsevent-sys 4.1.0`）

`fsevent-sys`（已是 notify 的传递依赖）暴露：

```
FSEventStreamCreate / ScheduleWithRunLoop / Start / Stop / Invalidate / Release
FSEventStreamSetExclusionPaths                     ← 关键
core_foundation 模块：
  CFArrayCreateMutable / CFArrayAppendValue / CFArrayGetCount
  CFStringCreateWithCString / CFRunLoopGetCurrent / CFRunLoopRun
  kCFTypeArrayCallBacks / kCFAllocatorDefault
```

→ **A2 只需把 `fsevent-sys` 提为直接依赖，不需要新增任何 FFI crate。**

## 4. A2 落地草案（自写 macOS `notify::Watcher`）

**落点（红线 10）**：`src/platform/watch_backend/`（目录化：`mod.rs` + `macos.rs` +
`platform_watcher.rs`——草案阶段的 `fallback.rs` 最终并入 `platform_watcher.rs`，见 §9），
对外只暴露"按能力位构造平台 watcher"；通用模块不出现 `#[cfg(target_os)]`。

**类型**：`MacFseventWatcher`，实现 `notify::Watcher`
（`new/watch/unwatch/configure/kind`，`kind()` 返回 `WatcherKind::Fsevent`），内部持
`FSEventStreamRef` + runloop 线程 + flags→`notify::Event` 的转换。

**排除集合来源**：`WatchManifest.ignored_roots` ∪ 用户排除命中的顶层目录
（两者 W0/W4 已就绪，直接复用，不新造判定）。

**调用顺序**（关键，`SetExclusionPaths` 必须在 `FSEventStreamStart` 之前）：

```
算 WatchManifest（含 ignored_roots + user excludes）
  → 建 CFArray<CFString> of 排除路径
  → FSEventStreamCreate
  → FSEventStreamSetExclusionPaths(stream, cfArray)
  → FSEventStreamScheduleWithRunLoop + FSEventStreamStart
```

因此 `manager/core.rs::watch` 的现状「先 `RecommendedWatcher::new` 再 `register_root`」要
微调为「先算 manifest，再构造带 exclusion 的 watcher，再注册」。

**边界变化**（`.gitignore` 变更、用户装 `node_modules`）：`ignored_roots` 变化 → 停止并**重建流**
（频率远低于逐目录注册；可对短时间内的多次变更做合并）。

**平台选择与回退**：
- 能力位 `SubtreeExclusion` → 用 `MacFseventWatcher`；
- 否则（含构造失败）→ `RecommendedWatcher`（`RecursiveFilterOnly`）；
- **W1 的回调过滤始终是兜底**：正确性不依赖 W2，W2 只是省掉 OS 侧投递成本。

## 4b. A2 落地细节（采用「移植 notify 的 FSEvents 后端 + exclusion」）

**为什么是移植而不是重写事件语义**：notify 6.1.1 的 `src/fsevent.rs`（CC0-1.0 公共领域奉献，~450 行去掉测试）
已经把 FSEvent flags → `notify::Event` 的翻译做全了。重写一套会有**事件语义漂移**风险
（下游 `classify.rs` 依赖 `EventKind` 分类）。所以我们**原样移植该后端**（保留版权/来源注明），
只在 `run()` 里 `FSEventStreamStart` **之前**插入 `FSEventStreamSetExclusionPaths`。

**可移植性核查（本机）**：`fsevent-sys 4.1.0` 的 `core_foundation` 已暴露 notify 所需的全部符号
（`CFArrayCreateMutable/AppendValue/GetCount/GetValueAtIndex/RemoveValueAtIndex`、`CFStringCompare`、
`CFRunLoopGetCurrent/Run/Stop`、`str_path_to_cfstring_ref`、`kCFTypeArrayCallBacks` 等）；
仅 `CFRunLoopIsWaiting` 需自声明 extern（notify 也是自声明）。`notify::Sender` / `unbounded`
是 `pub(crate)`，移植时改用 `std::sync::mpsc`（`configure` 直接返回 `Ok(false)`，FSEvents 本就忽略配置）。

**落点（红线 10；同时把 W0 的单文件升级为目录）**：
```
src/platform/watch_backend/
  mod.rs            # 能力位 WatchBackend + watch_backend() + 工厂 create_file_watcher()
  platform_watcher.rs   # enum PlatformWatcher { Native(RecommendedWatcher), MacExclusion(MacFseventWatcher) }
                        #   实现 notify::Watcher，逐方法 delegate
  macos.rs          # #[cfg(target_os="macos")] MacFseventWatcher（移植 + exclusion_paths）
```

**排除集合来源**：`WatchManifest.ignored_roots`（W0 已就绪；用户排除已在 `GitIgnoreFilter` 里、
最终体现为 `ignored_roots` 的裁剪）→ 转成 `Vec<PathBuf>`（canonical/绝对）。

**顺序调整**：排除列表必须在 `FSEventStreamStart` 之前设置，因此 `manager/core.rs::watch` 需把
`WatchManifest::compute(...)` **上移**到建 watcher 之前，再把 manifest 传给 registration
（即 `register_root` 改为收预计算的 manifest，而非自己 compute）。

**回退**：`PlatformWatcher::Native` 在四种情况使用 —— 非 macOS / 排除集合为空 / Mac 后端
构造（`CFArray` 分配）失败 / 运行时环境变量 `NEEKO_DISABLE_FSEVENT_EXCLUSION`。这样默认
行为与今天逐字一致，W1 的回调过滤始终兜底。**注意**：`FSEventStreamSetExclusionPaths`
在 `run()` 内调用失败（返回 0）时**不**回退 `Native`（此时流已创建，工厂无法重造）；
只记 warn 并继续用本后端 —— 正确性由 W1 回调过滤保证，仅成本收益未兑现。

**不扩散**：`git_meta/watcher.rs` 继续用 `RecommendedWatcher`（它只看 `.git` 内部，无需排除）。

## 5. 测试策略（对齐 `.trellis/spec/unit-test/real-source-determinism.md`）

- **纯函数**（100%）：exclusion 路径集合的构造（manifest `ignored_roots` + user exclude）；
  CFArray 构建的路径集合正确；能力位 dispatch 分支。
- **真实源**：禁止"精确零事件"断言（真实源只承诺 `≥`；"排除后不投递"属**时序/生命周期类负向**）。
  用**差分式 + 静默窗口**：`基线 = 观察 → 在排除树下写入 → quiet > debounce 上限 → delta == 0`。
  注意它只保护假阴性方向，不保证假阳性。
- **真机验收**：在 `target/`（被排除）下 `cargo build`，观察本进程回调计数 ≈ 0（对比 W2 前），
  并复测 `fseventsd` CPU 与应用内存。

## 6. 工作量与风险

- **代码量**：约 300–500 LOC（macOS 后端）+ `core.rs` 构造顺序调整 + 平台 watcher 类型别名
  （`handle.rs` / `git_meta/watcher.rs` 目前写死 `RecommendedWatcher`，需按平台抽象）。
- **风险**：
  1. runloop 线程生命周期与退出（watcher drop 时必须 `Stop`/`Invalidate`/`Release` + 退出 runloop）；
  2. CF 对象释放（`CFRelease` 对应 `CFArrayCreateMutable`/`CFStringCreateWithCString`）；
  3. 事件 flags → `notify::Event` 的映射要与 notify 语义对齐（否则下游分类漂移）；
  4. 流重建的窗口期可能丢事件 —— 用 W1 回调过滤 + 既有 overflow→全树失效兜底。
- **替代路线**：
  - **A1 patch/vendor notify**：代码改动最小（给 `Config` 加 exclusion），但引入 fork 偏差与维护成本。
  - **A3 上游 PR**：长期最优，时间不可控。
  - A2 不新增依赖、不动上游，是当前推荐。

## 9. 实施结果（W2 落地 · 2026-10-09）

A2 已按本文档 §4/§4b 落地，实测有两条**与草案有出入的硬事实**，回归文档：

1. **`FSEventStreamSetExclusionPaths` 有硬上限 8 个目录**（Apple 头文件原文：
   "A maximum of 8 directories maybe specified."）。草案未提及。实现按
   [`MAX_FSEVENT_EXCLUSIONS = 8`](../../../../src-tauri/src/platform/watch_backend/macos.rs)
   截断（保序取前 8），超限只损失成本收益，正确性由 W1 回调过滤兜底。
2. **排除只过滤被排除目录的"内部"变化，不吞掉目录自身的边界事件**（本机实测）：
   对被排除的 `target/` 目录，`create target/` / `rm -rf target/` 仍以
   `path == <target>` 投递，而 `target/debug/x.o` 的写入零投递。这正好满足
   PRD R1/R4 与 AC2（ignored 根自身的出现/消失由父目录监听捕获）。

落地形态：`src/platform/watch_backend/` 目录（`mod.rs` 能力位 + 工厂 /
`platform_watcher.rs` `PlatformWatcher{ Native, MacExclusion }` / `macos.rs` 移植后端）。
工厂 `create_file_watcher(handler, config, exclusions)` 在 macOS 且集合非空时用
`MacFseventWatcher`，否则回退 `Native`；回退路径：非 macOS / 空排除 / 构造失败 /
运行时环境变量 `NEEKO_DISABLE_FSEVENT_EXCLUSION`。

测试：真实 FSEvents 差分用例 `excluded_subtree_delivers_zero_events_visible_subtree_still_arrives`
（排除子树写入 delta == 0；可见子树单向可达）与 `excluded_root_boundary_event_still_arrives`
（边界事件单向可达）。

## 7. 关键判断：W2 是**成本优化**，不是正确性所需

- W0（manifest/能力位）+ W1（结构事件收敛）+ W3（读层有界）+ W4（用户排除）**已经**实现
  「ignored 子树内部不产生任何应用级事件」——即用户目标「构建产物不该被监听」在**行为层面**已成立。
- W2 的唯一增量是**让 macOS 内核不再向本进程投递这些事件**（省 `fseventsd` 回调、应用侧 CPU/内存）。
- 因此：**W2 可以从本任务拆出，作为独立 spike，不阻塞 W0/W1/W3/W4 收口**。

## 8. 建议

1. 本任务按 W0/W1/W3/W4 收口（AC1–AC6 的行为面已覆盖；AC3 的能力位已就绪，W2 只是消费它）。
2. W2 另开一个 spike 任务（或在本任务末尾单独做），PRD 直接用本文件 §4 的 A2 草案；
   验收以**真机收益**（回调计数 / fseventsd CPU）为准，带运行时回退开关。
