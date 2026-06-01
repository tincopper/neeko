# PRD: Watcher 只监控激活项目

## 背景

`src-tauri/src/common/file/watcher.rs` 当前为 session 中**每个**项目都启动一整套 watcher：
`notify 推荐 watcher + ThrottleScheduler + GitStatusWorker + 200ms file-debounce + 500ms tree-debounce + 30s heartbeat`。

其中 `heartbeat` 每 30s 调用一次 `git status --porcelain --no-optional-locks`，用户即使只浏览一个项目，所有项目都会持续触发 `git` 子进程。日志中可见：

```
[WARN][neeko_lib::common::git::status_worker:156] [GitWorker] git status failed (exit exit status: 129) at ...
```

`exit status: 129` 在 Unix 上对应 SIGHUP（128+1），属于非致命失败但持续产生警告噪声。

## 目标

把"watcher 是项目属性"重塑为"watcher 是激活会话属性"：应用启动与运行期间**最多**一个 watcher 挂在激活项目上。其他项目完全无线程开销。

## 范围

### 改动文件
- `src-tauri/src/project/commands.rs` — `set_active_project` / `add_project` / `remove_project` / `change_project_path`
- `src-tauri/src/app.rs` — 启动期挂载逻辑
- `src-tauri/src/common/git/status_worker.rs` — 诊断日志增强（exit 129 明细）
- `src-tauri/src/common/file/watcher.rs` — 可能新增 `check_immediate` 或保留 `check()` 公共方法

### 行为契约

| 场景 | 当前 | 目标 |
|------|------|------|
| 启动 N 个项目 | N 个 watcher | 0~1 个（按 session.active_project_id） |
| `add_project` | 立即挂 watcher | 不挂，激活时才挂 |
| `set_active_project(A → B)` | 仅更新状态 | unwatch(A) + watch(B) + 立即 check 一次 |
| `set_active_project(null → A)` | 仅更新状态 | watch(A) + 立即 check 一次 |
| `set_active_project(A → A)` | 替换状态 | no-op |
| `remove_project(active)` | unwatch | unwatch + 清空 state.active_project_id |
| `remove_project(non-active)` | unwatch | unwatch（no-op 兜底） |
| `change_project_path(active)` | unwatch + watch | unwatch + watch(new path) |
| `change_project_path(non-active)` | unwatch + watch（多余） | 不动 watcher |

### 非目标
- WSL/SSH 项目的 watcher 单独优化（共用 WatcherManager）
- Heartbeat 间隔调整（维持 30s，单项目可接受）
- status_worker `--no-optional-locks` fallback 逻辑
- 前端任何改动（invoke 形参 `projectId` 不变）

## 验收

1. `pnpm type-check` 通过
2. `pnpm test:run` 通过（set_active_project 调用相关用例不受影响）
3. `cargo test --manifest-path src-tauri/Cargo.toml` 通过
4. 手动验证：
   - 启动应用，log 中 `[GitWorker]` 仅出现在激活项目对应路径
   - 切到另一个项目 → 30s 后 log 切换到新路径，旧路径不再出现
   - 添加新项目 → log 中不出现新路径，直到点击该卡片
   - 移除激活项目 → log 中该路径心跳消失

## 风险

- session.active_project_id 指向已删除项目 → 启动时用 `filter` 校验，丢弃则不挂 watcher
- 前端 useLocalProjects 已处理"被删后谁是下一个 active"，后端不需要选下一个
- 多并发 set_active_project 不会发生（Tauri command handler 单线程执行）
