# Fix unversioned dir expansion cache staleness in Git Changes panel

> 修订 v2（2026-09-24）：按代码核实结论收窄范围（B 限定 local 主路径）、改写 AC3/AC4/AC5/AC7、新增 AC9 与传输层范围声明、把执行顺序改为「A 先行 → 验证 → 再评估 B」。
> 核实记录见 design.md §8（含引用更正）；所有 file:line 论断已对当前代码逐条验证。

## Goal

修复 Git Changes 面板 Unversioned 分组中，折叠 untracked 目录展开结果不随目录内容变化而刷新的缺陷，使目录内新增/删除文件能实时反映到 Changes 列表。

## Problem Statement

用户在 Neeko 自研 Git Changes 面板中发现：新建 untracked 目录（如 `.trellis/tasks/09-24-editor-ai-completion/`）后，面板 Unversioned 组只显示**首次展开时刻**目录内已有的文件；之后在该目录内新建的文件（`design.md`、`implement.md`、`prototypes/editor-ai-completion.html` 等）永不出现，手动刷新也无效。CLI `git status --porcelain -uall` 能看到全部 7 个文件。

## Root Cause (已逐条核实)

两层叠加：

1. **前端展开缓存永不失效**（`src/features/git/hooks/useUntrackedDirExpansion.ts:63-90`）
   - 后端 status 把 untracked 目录折叠为单条目录条目（有意设计，防内存爆炸）。
   - 面板的子文件列表由前端按需展开（`get_untracked_files`）并缓存在 `dirFilesMap`。
   - 缓存仅在 `dirFilesMap[f.path] === undefined` 时拉取；一旦写入永不重拉，且无任何失效信号。
   - 手动刷新只更新外层 status（折叠目录条目 path 不变），hook 内缓存照样命中 —— 这就是「刷新也无用」。

2. **后端 status 快照比较闸门产生盲区**（`src-tauri/src/common/git/status_worker/worker.rs:90-92`）
   - 折叠目录**内部**增删文件时，`git status --porcelain` 输出一字不变。
   - worker 的「查询-比较闸门」判定无变化 → 不 emit 新快照、version 不递增。
   - 因此前端即使想靠 `git-status-snapshot` 事件失效缓存也收不到信号。

**两条缺陷的作用范围不同**（决定 R1 是通用修复、R2 是 local 专项）：

| 缺陷 | local 主路径 | WSL / SSH / worktree 激活态 |
|---|---|---|
| 1 前端缓存 | 成立 | 成立（同样陈旧） |
| 2 后端闸门 | 成立（worker 硬编码 `ExecTarget::Local`，`worker.rs:7,147,163,209`） | **不成立**：不挂 watcher（`git/commands/query.rs:59-66` 注释），读接口返回 `version: 0` |

## Scope（传输层）

- 本次目标：**local 主路径**（含 worktree 未激活态）的展开缓存自动失效 + 闸门语义修正。
- WSL / SSH / worktree 激活态：无 watcher → 无 `file-changed` 事件；读接口 `version` 恒 0 → 无版本信号。失效信号需独立设计，**本次登记为已知缺口，不修**，但不得因本次改动恶化（AC9）。
- 若实现过程中该缺口的成本被发现低于预期（例如身份信号即可覆盖），可在 Step 2 决策点（implement.md D1）并入本次范围。

## Requirements

### R1（方案 A · 前端，必做且**先做**）

- 折叠 untracked 目录的展开结果必须可失效：目录内文件发生变化（`file-changed` 事件命中该目录前缀）时逐出对应缓存并重新拉取。
- 手动刷新（面板刷新按钮 / window focus 触发的 status 更新）必须使展开缓存失效，确保用户主动刷新能看到最新目录内容。**该条不依赖快照 version 前进**（local 下刷新可能 `version` 不变、仅 `files` 引用换新，见 design.md §2.1）。
- 失效信号必须以「已应用快照版本前进」为主（local），版本不可用时才退化为引用身份（远程）；**不得**无条件用 `files` 数组身份当失效信号（会在每次聚焦/刷新触发全量逐出）。
- 展开拉取失败必须**可判别地**回传：现状 `GitCommitPanel.tsx:173-183` 自行 `catch` 后 `return []`，把失败伪装成「空目录」，hook 的 `catch`（`useUntrackedDirExpansion.ts:76-78`）实为死代码。失败不得写缓存键（继续显示目录占位），**且不得形成无限重试**（同一目录连续失败必须退避，不得因自身 `setState` 触发下一轮拉取）。
- 失效/重拉必须有 inflight 去重（trailing 合并），避免事件风暴导致对同一目录重复拉取。

### R2（方案 B · 后端闸门语义修正，local 专项，A 验证后独立评估）

- status 快照需感知折叠 untracked 目录的内容变化：目录内文件增删时（local 主路径）`version` 必须递增、`git-status-snapshot` 必须 emit。
- 保持折叠语义不变：快照条目仍输出折叠目录条目（1 条），**不**展开为每个文件（内存爆炸防护，测试 `local/status.rs:283` `should_collapse_untracked_dir_to_single_entry` 钉死）。变化检测通过目录内容摘要实现，不改变 IPC 条目数。
- 探测侧**禁止**复用展示层的 500 条截断语义（`operations/files.rs:63-70`）：输入被截断会让超限目录的后续变化永远检测不到（漏发）。摘要必须覆盖完整集合，或超限时按「未知」放行。
- 探测开销必须有界：仅对**已存在的折叠 untracked 目录条目**探测，且仅在 porcelain 判定「未变化」的快路径上探测；成本模型必须基于「每目录枚举成本」而非仅「目录数量稀疏」，并给出实测数据或前置过滤（如目录 mtime 短路）方案。

### R3（一致性 / 不回归）

- 现有行为不回归：折叠语义、version gate、stage-all、diff stats、worktree 分支行为均保持。
- 新增行为必须有回归测试覆盖（前端 hook 测试 + Rust worker/operations 测试）。
- 本次**不改** `FileChange` / `GitStatusSnapshot` 的 IPC 载荷形状（内容寻址 token 备选方案见 design.md §5.2，若采用需单开变更）。

## Acceptance Criteria

- [ ] AC1：untracked 目录首次展开后，在该目录内新建文件 → Changes 面板 Unversioned 列表在无手动操作的情况下自动出现新文件（local 由 file-changed 驱动即 S1；B 落地后快照被替换也会命中 S2 的「引用替换」通道）。
- [ ] AC2：untracked 目录内删除文件 → 该文件从 Unversioned 列表消失（同样自动）。
- [ ] AC3：手动刷新（面板刷新按钮 + 窗口聚焦路径）后，面板显示的目录内容与 `git status --porcelain -uall` 一致（即使此前已有旧缓存）。判定只依赖 A 的逐出通道，**不**要求 `version` 前进 —— 两条刷新路径都不推进 version（刷新按钮走 `get_git_info` 不经 gate、聚焦走 `allowEqual` 同版本放行），故 S2 以「`changed_files` 引用被替换」为信号。
  - **判定方式（自动化，已落地为绿）**：`useUntrackedDirExpansion.test.ts` 的 S2-1（引用替换 → 后台重拉 + 旧值保留到新值落地）、S2-2（引用不变不重拉）、S2-3（目录消失则丢弃缓存键）+ Step 2 手测第 4 项。
- [ ] AC4：展开拉取失败（IPC 报错）后不被空列表永久吞没：下一次失效信号/刷新可重试成功；**且**连续失败场景下无无限重试（判定：静默窗口内同一目录至多 1 次 `get_untracked_files` 调用，无 IPC 风暴、无重复错误 toast 刷屏）。
  - **判定方式（自动化，已落地为绿）**：`useUntrackedDirExpansion.test.ts` 的 S3-1（失败不写缓存键 → 目录条目继续占位；下一次失效信号重试成功）、S3-2（持续失败各目录至多 1 次拉取，无自激）。
- [ ] AC5：（local 主路径）折叠目录内文件增删时 `git-status-snapshot` emit 且 `version` 单调递增。WSL/SSH/worktree 不在本 AC 范围（见 Scope）。
  - **判定方式（自动化，已落地为绿）**：`common/git/status_worker/worker.rs` 的 `untracked_dir_burst_creates_emit_exactly_one_snapshot`（同批次 10 次创建 → 恰好 1 次 emit + version 前进 + 仍 1 条 `is_dir` 条目，即折叠语义保持不变）；对照 `untracked_dir_unchanged_does_not_emit`（内容不变不得 emit）；摘要契约另由 `collapsed_probe.rs` 6 条单测钉死。
- [ ] AC6：快照条目数不变（折叠目录仍为 1 条 `is_dir=true` 条目），`should_collapse_untracked_dir_to_single_entry` 等既有测试继续通过。
- [ ] AC7：事件风暴（同一目录连续创建 10 个文件）下，每事件批次每折叠目录至多 1 次 `get_untracked_files` 调用，总调用数 ≤ 折叠目录数 × 事件批次数。
  - **判定方式（自动化，已在 Step 1 前落地为 Red）**：
    - 前端调用次数上界：`src/features/git/hooks/__tests__/useUntrackedDirExpansion.test.ts` 的 AC7-1～AC7-4（以注入的 `onExpandUntrackedDir` 调用次数为 IPC 代理 —— 它是 `get_untracked_files` 的唯一出口，故与 invoke 次数一一对应，无需 devtools 手工计数）；
    - 后端风暴不放大：`common/git/status_worker/worker.rs` 的 `untracked_dir_burst_creates_emit_exactly_one_snapshot`（同一批次 10 次创建 → 恰好 1 次 emit + version 前进）。
- [ ] AC8：`pnpm lint`、`pnpm type-check`、`pnpm test:run`、`cargo test --manifest-path src-tauri/Cargo.toml` 全部通过。
- [ ] AC9：WSL/SSH/worktree 项目不因本次改动产生回归（无 watcher / `version=0` 时，刷新仍更新外层 status；展开缓存行为与改动前一致或更好）。

## Constraints

- **禁止**开启 `recurse_untracked_dirs`（历史内存爆炸回归，测试钉死折叠语义）。
- **禁止**把展开子文件并入 status 主快照 entries（IPC 条目数上界不变）。
- 探测侧禁止复用展示层截断（截断属展示职责，见 R2）。
- 不得为修本 bug 引入新的定时轮询（复用既有 30s 心跳，`watcher/manager/core.rs:307-335`）。
- 后端红线：命令层保持极薄；阻塞 I/O 隔离；Event 名常量化（复用 `GIT_STATUS_SNAPSHOT_EVENT` / `FILE_CHANGED_EVENT` 常量，不新造字符串）。
- 前端红线：store 目录化直导、无全局 barrel；hook 测试用 `renderHook` + `act`；避免 `any`。
- 测试红线（G1/换行/路径身份）：不硬编码 POSIX 绝对路径进 `Path` 语义 API；不对工作区换行做字节级精确断言。

## Non-Goals

- WSL / SSH / worktree 激活态的展开缓存自动失效（无 watcher、无版本信号，需独立设计，见 Scope）。
- `FileChange` 载荷增加目录内容 token（内容寻址缓存方案，见 design.md §5.2，本次不做）。
- worktree 分支的展开缓存失效（worktree 激活时主快照不落 store，属独立场景，本次不扩）。
- 把折叠语义改为递归展开（永久否决）。
- Changes 面板 UI 结构调整（只修数据刷新，不动布局）。

## Notes

- 复现路径：`mkdir -p <repo>/tmp-untracked/a` → 面板出现折叠目录 → 展开显示初始文件 → 在 `a/` 内再新建文件 → 面板不更新（本 bug）。
- 时间线佐证：UI 显示的 4 个文件恰为 14:39 批次，14:44/14:47 新建的 3 个文件全被缓存挡住；后端 `get_untracked_files` 实测返回全部 7 个 —— 后端展开接口正常，问题在缓存策略 + 快照契约盲区。
- 执行顺序：A 先行并做端到端验证（含 AC1–AC4/AC7）→ 在决策点 D1 按闸门语义价值与实测开销单独评估 B（design.md §5.1、implement.md Step 2 D1）。
- 修订依据（2026-09-24 逐条核实）：`useUntrackedDirExpansion.ts`、`worker.rs`、`writer.rs`、`GitCommitPanel.tsx`、`ChangesList.tsx`、`gitStatus.ts`、`projectStore.ts`、`gitStatusEventsSync.ts`、`watcher/manager/core.rs`、`watcher/debounce.rs`、`git/commands/query.rs`、`operations/files.rs`、`local/status.rs`。
