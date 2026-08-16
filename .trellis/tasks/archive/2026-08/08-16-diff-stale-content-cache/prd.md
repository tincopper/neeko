# PRD：Diff 内容陈旧——后端单一缓存（输入指纹校验）+ 前端去缓存

## 目标与用户价值

修复"文件已更新，但应用打开 Diff 页面时显示的内容仍是旧的"的问题，从架构上消除整类缓存陈旧 bug。

**用户价值**：开发者在编辑器改完代码后，切到 Neeko 看 diff 时能立刻看到最新改动；不再出现"内容不刷新、必须手动点刷新/碰运气"的困惑。

## 背景与确认事实（分析结论，非臆测）

1. Diff 是**派生值**：`diff = f(HEAD_oid, index 状态, 工作区文件内容)`，输入是"活的"。
2. **后端** `common/git/cache.rs` 的 `DIFF_CACHE`（LRU，cap 50，**无 TTL、无输入指纹**）是 `get_file_diff`（工作区 diff）的唯一消费者；`invalidate_repo_caches()` 的 17 个调用点全部是 git 写操作，**普通文件编辑不清缓存** → 后端返回旧 diff。
3. **前端** `useDiffData.ts` 模块级 `diffCache`（Map，跨卸载存活）：仅当挂载期间收到 file-changed/git-refresh 信号且键未变才删除；**重挂载时 `isRefresh=false` → 不删缓存 → 命中旧值** → "关闭后再打开仍是旧内容"。
4. 同一派生值被**双层缓存**（前端 + 后端）各缓存一份、两套失效策略 → 两个独立陈旧来源，互相掩盖。
5. 感知通道现状：watcher 只 watch 本地主仓库根（worktree 目录不在内）；WSL/远程**完全没有事件源**；前端 `useDiffData` 只订阅了精确路径匹配的 `file-changed`，**未订阅路径无关的 `git-status-diff`**。

## 需求

| ID | 需求 | 优先级 |
|---|---|---|
| R1 | 后端工作区 diff 缓存必须**输入指纹校验**（文件 mtime+size + HEAD oid）：命中时先校验，指纹不一致即重算并刷新。正确性不依赖任何事件管道。 | P0 |
| R2 | 后端缓存策略**按输入稳定性**划分：commit/stash（输入不可变）按稳定键长期缓存；工作区本地/worktree 用指纹校验缓存；远程/WSL 工作区 diff **不缓存**（每次现算）。 | P0 |
| R3 | 前端**删除** `useDiffData` 模块级 `diffCache`，成为**无状态消费者**：每次展示/聚焦直接 invoke；不再信任任何跨挂载缓存。 | P0 |
| R4 | 前端感知通道分层保留并增强：订阅 `git-status-diff`（仓库级、路径无关）作为本地自动刷新主信号；保留手动刷新按钮。感知只影响"新鲜度"，不承担正确性。 | P1 |
| R5 | 修复 worktree 事件盲区（激活 worktree 时对 worktree 目录起 watcher）——独立交付物，可拆分为子任务或后续。 | P2 |

## 验收标准

| ID | 验收标准 | 关联 |
|---|---|---|
| AC1 | 本地：Diff tab 已打开，编辑该文件后，`git-status-diff` 事件到达时 diff 自动刷新为新内容（不再显示旧 hunk）。 | R4 |
| AC2 | 本地：关闭 Diff tab → 编辑文件 → 重新打开，**直接显示新内容**（原 bug 现场，不依赖"打开期间收到事件"）。 | R3+R1 |
| AC3 | 本地：Git 面板手动刷新按钮始终能拿到最新 diff 内容。 | R4 |
| AC4 | 后端正确性不依赖事件：连续两次 `get_file_diff`，中间修改文件，**第二次返回新内容**（指纹校验生效，即使无任何事件）。 | R1 |
| AC5 | commit / stash diff 仍命中缓存，无性能回归（不可变输入长期缓存语义保留）。 | R2 |
| AC6 | 回归测试：Rust 指纹缓存单测（改文件后重算）+ 前端 `useDiffData` 去缓存后的行为测试（无缓存命中、显示即拉）。 | R1+R3 |

## 边界与范围外（Out of Scope）

- WSL/远程的**自动推送感知**：无事件源是物理边界，仅保证"聚焦/手动刷新时拉到的就是真的"，不做远程自动事件。
- Diff 大文本虚拟滚动 / IPC 2MB 流式化（与本问题无关，已有 collapse 护栏）。
- worktree watcher 补齐（R5）：若本任务内不动，记录为后续；不影响 AC1-AC6。
- 不改变 `get_file_diff` 等 IPC 命令签名、不改变 `DiffResult` 结构、不改变前端组件 props。

## 关键约束

- TDD：每个改动先写复现/行为测试（Red）再实现（Green）。
- 不引入新依赖；不改变 IPC 契约；保持 Command 层极薄。
- 后端缓存属于 `common/git` 域，改动集中在 `cache.rs` + `local.rs` 消费点。
