# 研究：macOS 目录监听的可行方案（notify / kqueue / FSEvents exclusion + VS Code 实证）

> 目的：为 `macos-fsevent-exclusion-backend` 子任务提供后端可行性证据与路线对比。

## 1. FSEvents 的真实限制（澄清）

- FSEvents 的流**天然递归**（前缀语义）——不能像 inotify 那样"只看这一层、按名字报子项"。
- 但 FSEvents **有**子树排除 API：`FSEventStreamSetExclusionPaths(stream, CFArrayRef paths) -> Boolean`（macOS 10.9+）。
- 因此"FSEvents 无法排除子树"是**错的**；准确说法是**notify 6.1.1 没有调用该 API**。
- 运维约束：排除集合应在流启动前设置；边界变化（用户装 `node_modules`、改 `.gitignore`）通常意味着重建流。

## 2. notify 6.1.1 的 macOS 后端（FSEvents）

来源：`~/.cargo/registry/src/*/notify-6.1.1/src/fsevent.rs`

- `flags = kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer`
  → **逐文件事件、不延迟批量**（洪峰来源）。
- `recursive_info: HashMap<PathBuf, bool>`；回调里对每个事件路径遍历 watched paths：
  - `path.starts_with(p)` 且 `recursive` 或 `path == p` → 处理；
  - 否则若 `path.parent() == p`（NonRecursive）→ 处理，否则丢弃。
  → **`RecursiveMode::NonRecursive` 在 macOS 只是"事后过滤"，FSEvents 仍递归订阅整棵子树。**
- `watch_inner()`：`self.stop(); append_path(path, mode); self.run();`
  → **每次 `watch()` 都停掉并重建整个 FSEventStream**（N 次注册 = N 次流重建）。
- 全文件无 `FSEventStreamSetExclusionPaths` 调用 → **notify 无法真正排除子树**。

## 3. notify 6.1.1 的 kqueue 后端

来源：`notify-6.1.1/src/kqueue.rs`（442 行），feature `macos_kqueue`（**非默认**；
`RecommendedWatcher` 默认 = `FsEventWatcher`，见 `lib.rs:213/224/373`）。

- `add_watch()`：recursive 时 `WalkDir::new(path)` 遍历**每个 entry（含文件）**逐个 `add_single_watch`。
  → fd ∝ **被监听条目数**。
- 语义缺陷：kqueue 的目录 fd 只在**目录项增删改名**时 `NOTE_WRITE`；**子文件内容修改不通知目录 fd**
  （这正是它必须逐个文件 watch 的原因）。
- `Rename`：注释明确 "Kqueue not provide us with the infomation nessesary to provide the new file name"。
- `Link`（目录项变化）：注释 "remove and readd the whole directory ... This is a expensive operation,
  as we recursive through all subdirectories." → 重扫洪峰。

**结论：kqueue 语义更"纯"（注册即边界），但 fd ∝ 条目数 + 无文件名 + 需重扫 + 非默认后端，
且不减少卷级 fseventsd journal 成本。**

## 4. fsevent-sys 已暴露所需绑定

`~/.cargo/registry/src/*/fsevent-sys-4.1.0/src/fsevent.rs:113`（Neeko `Cargo.lock` 中为 4.1.0）：

```rust
pub fn FSEventStreamSetExclusionPaths(
    stream_ref: FSEventStreamRef,
    paths_to_exclude: CFArrayRef,
) -> Boolean;
```

→ 自写 macOS 后端 / patch notify **不需要新增 FFI 依赖**。

## 5. VS Code 的实现（本机实证）

- 文件监听走 `@parcel/watcher`：
  `/Applications/Visual Studio Code.app/.../out/vs/platform/files/node/watcher/watcherMain.js`
  ```js
  subscribe(a, (f,p)=>{...}, {
      backend: n.PARCEL_WATCHER_BACKEND,
      ignore: this.addPrede…        // 来自 files.watcherExclude
  })
  ```
- bundle 内提示串（定位语义）：
  "Use 'files.watcherExclude' setting to exclude folders with lots of changing files (e.g. compilation output)."
- 原生二进制链接了排除 API：
  ```
  $ nm -u ".../node_modules.asar.unpacked/@parcel/watcher/build/Release/watcher.node"
  _FSEventStreamCreate
  _FSEventStreamSetExclusionPaths      ← 排除子树
  _FSEventStreamStart / Stop / Invalidate / Release
  ```
  （OpenCode / Orca 内的 `@parcel/watcher-darwin-arm64/watcher.node` 同样如此。）

**结论：VS Code = `@parcel/watcher` + `files.watcherExclude` → macOS 上用
`FSEventStreamSetExclusionPaths` 物理排除 ignored 子树。**

## 6. macOS 限额（决定 kqueue 可行性）

```
launchctl limit maxfiles        → maxfiles 256          unlimited
sysctl kern.maxfilesperproc     → 184320
sysctl kern.maxfiles            → 92160
本仓库 tracked files = 4,245 ; tracked dirs = 889 ; target/debug/deps 顶层条目 = 883,175
```

## 7. 路线对比

| 方案 | 订阅复杂度 | 事件粒度 | ignored 子树 OS 成本 | 备注 |
| --- | --- | --- | --- | --- |
| **A. FSEvents + exclusion paths** | O(1) + 排除列表 | 精确文件名 | 不投递给本流 | VS Code 路径；绑定已具备；需 patch/自写后端 |
| B. kqueue（逐目录） | O(#目录) fd | **无文件名** | 真不注册 | 丢内容事件；需重扫 |
| B'. kqueue（递归） | O(#条目) fd | 无文件名 | 真不注册 | 撞 `maxfilesperproc`；target 会爆 |
| C. 不 watch 共同祖先 | O(#顶层可见) | 精确文件名 | 取决于分层 | 嵌套 ignored 仍需 A/B |
| D. 回调过滤（现状） | O(1) | 精确文件名 | 全量投递 | 成本最高 |

> 注：exclusion paths 只消除"送达本 stream 的事件"；卷级 `fseventsd` journal（Time Machine 需要）
> 与 Spotlight 索引不受其影响。A 减的是**应用侧**成本。
