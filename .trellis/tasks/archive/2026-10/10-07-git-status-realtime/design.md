# 设计：Git changes 实时化

> 配套：`prd.md`（需求/验收）、`implement.md`（执行计划）。

## 1. 第一性原理

1. **仓库是文件系统数据库**，磁盘字节是唯一真相；UI 全部是「磁盘状态 → 派生值」的缓存。
2. **派生值新鲜度 = 集合包含**：`被监听/被触发重算的输入集合 ⊇ 该派生值依赖的输入集合`。
   落在监听集合之外的输入 = 无上界陈旧。
3. **一个投影一个生产者**：两个生产者 = 两套版本/通道/触发时机 → 必然漂移
   （`git-domain.md` §12）。

据此，改动只有两件事：**补齐监听集合**（refs） + **把 ahead/behind 收进唯一生产者**。

## 2. 派生值定义

```
GitStatusSnapshot = f(HEAD, index, workdir, refs)
  entries/truncated/branch  <- HEAD, index, workdir
  ahead/behind              <- 本地分支 ref, remote-tracking ref
```

`refs` 由 worker / pull 现算读取；不要求快照携带 refs 本身。

## 3. 漏洞与修复对照

| 输入 | 现状 | 修复 |
| --- | --- | --- |
| `workdir` | 主 watcher 递归 + gitignore 过滤 → `ThrottleScheduler` → `worker.check()` | 不变 |
| `HEAD` | git-meta watcher → 同时 hint + `git-changed` | 不变 |
| `index` | git-meta watcher → hint | 不变 |
| `refs/**`、`packed-refs` | **无** | git-meta watcher 增递归监听 `refs/` + 识别 `packed-refs` → hint（只发信号） |
| ahead/behind 计算 | 独立 pull 命令，3 个散落触发点 | 并入 worker / pull 生产者的同一迭代 + change gate |

## 4. 契约

### 4.1 快照（跨栈，前后端同形）

```rust
// common/git/status_worker/writer.rs
pub struct GitStatusSnapshot {
    pub repo_key: String,
    pub version: u64,
    pub project_id: String,
    pub worktree_path: Option<String>,
    pub branch: String,
    pub entries: Vec<FileChange>,
    pub truncated: bool,
    #[serde(default)]
    pub ahead: u32,
    #[serde(default)]
    pub behind: u32,
}
```

```ts
// src/shared/types/git.ts
export interface GitStatusSnapshot {
  repo_key: string; version: number; project_id: string;
  worktree_path: string | null; branch: string;
  entries: FileChange[]; truncated: boolean;
  ahead: number; behind: number;
}
```

### 4.2 计算规则（worker 与 pull 共用语义）

`git rev-list --left-right --count @{upstream}...HEAD` → `left\tright`：
- `left` = 上游独有 = `behind`
- `right` = 本地独有 = `ahead`

`@{upstream}` 不存在（无 tracking / detached）/ 命令失败 → `(0, 0)`，**不是错误**。
（既有 `operations::get_ahead_behind` 硬编码 `origin/`，是另一处已知缺口；本次 worker 侧直接
用 `@{upstream}`，pull 生产者暂时复用既有函数以控范围 —— 见「未采纳」。）

### 4.3 change gate

worker 的 `status_unchanged` 必须纳入 `ahead` / `behind`：

```rust
let status_unchanged = current == last_status
    && current_branch == last_branch
    && ahead == last_ahead
    && behind == last_behind;
```

否则外部 push（workdir/HEAD/index 全不变）不会 emit —— 这正是当前漏掉的那格。

### 4.4 监听层只发信号

新增的 refs 回调**只** `scheduler_tx.send(())`，不 emit 事实、不新增事件名。事实一律由
`git-status-snapshot` 携带。这与 index 回调语义同构（「信号≠事实」，避免自反馈）。

## 5. 数据流

```
外部 git push
  └─ 改写 .git/refs/remotes/origin/<b>          (loose ref，实测)
       └─ git-meta watcher（refs/ 递归）
            └─ classify = RefsChanged
                 └─ on_refs_changed → ThrottleScheduler.send(())
                      └─ worker.check()
                           ├─ git status --porcelain（不变，用于 change gate）
                           ├─ rev-parse --abbrev-ref HEAD（不变）
                           └─ rev-list --left-right --count @{upstream}...HEAD  ← 新增
                                └─ 变化 → version+1 → git-status-snapshot
                                     └─ 前端 applyStatus + setAheadBehind  ← 单通道
```

## 6. 平台与成本

- `.git/refs` 递归监听：refs 目录通常规模有限；`packed-refs` 在 `git_dir` 根下（既有非递归监听
  已覆盖路径，只差分类）。
- 每轮多一次 `rev-list`。worker 本就每轮跑 `git status`（更重），故可接受。若未来需优化：
  先用一次 `git rev-parse @{upstream} HEAD`（单进程两 OID）比较，仅 OID 变化才跑 `rev-list`
  —— 纯优化，不改契约。
- WSL/SSH 无 push 生产者，不在本次范围（仍「显示即拉」）。

## 7. 风险与缓解

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| `refs/` 目录不存在 | 尚无分支的仓库 | `is_dir()` 门控，不存在则跳过，不算失败 |
| `refs/` 监听失败 | 权限 / 竞态 | 告警但不使整个 watcher 失效（HEAD/index 仍有效） |
| 远端 pull 生产者漏填 | 徽标被打回 0 | `compute_and_record` 同步填字段（R3.2） |
| `serde` 兼容 | 旧 payload 无字段 | `#[serde(default)]` |
| 自反馈回路 | refs 变化 → 重算 → 写 refs？ | change gate 幂等：无变化不 emit、不写 refs |

## 8. 未采纳方案

| 方案 | 否决理由 |
| --- | --- |
| 只调小心跳周期（30s → 1s） | poll 频率不是正确性来源，且外部 push 仍依赖同一条不完整集合 |
| 前端 focus 时补 `getAheadBehind` | 保留双生产者，不 focus 就不更新；漂移仍在 |
| 新增 `git-refs-changed` 事件 + 前端拼刷新 | 增加事件名（红线 5 成本）与第二条触发链，违背生产者单源 |
| worker 内复用 `operations::get_ahead_behind`（`origin/` 硬编码） | 非 origin 远端会算错；worker 侧用 `@{upstream}` 修正 |

## 9. 记忆点（写回 spec 的候选）

- `.trellis/spec/backend/git-domain.md` §12 补一条：**派生值的依赖集合必须被监听集合覆盖**；
  ahead/behind 属于「第四个输入（refs）」，随快照单源投递。
- git-meta watcher 的监听范围从「HEAD / index」扩展为「HEAD / index / refs」。
