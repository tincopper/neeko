# Implement — git status 可观测性重构（父任务：任务地图与集成验收）

> 本文件是**父任务**的执行地图。实际代码改动在四个子任务里各自拥有 `implement.md`。
> 子任务顺序 C1 → C2 → C3 → C4，**不可并行**（C2 依赖 C1 的读语义，C3 依赖 C2 删除挂载概念，
> C4 依赖 C2 的新命令签名）。

## 0. 前置（每个子任务开工前必做）

- [ ] 读 `src-tauri/AGENTS.md` 与 `src/AGENTS.md`（硬指令：动手改任一侧前必须 Read 对应子目录）。
- [ ] 读 `.trellis/spec/backend/git-domain.md §12`（Workspace 身份与 status 生产者单源）与 `§14`
      （派生值新鲜度契约）—— 本任务要**反转 §12 的 D-B**，必须知道原文。
- [ ] 读 `.trellis/spec/backend/concurrency-guidelines.md`「`core::exec` 的同步桥语义」（红线 3）。
- [ ] 确认基线绿：`pnpm check:quick`。

## 1. 任务地图

| 子任务 | 目录 | 交付 | 修复 |
| --- | --- | --- | --- |
| C1 状态模型 | `11-04-status-freshness-model` | `StatusEntry{snapshot, computed_at, dirty}`；读永远可答；refs/workdir 双维度 | 「完全不显示」→「按优先级延迟」 |
| C2 移除排他 | `11-04-drop-exclusive-mount` | `set_visible_workspaces`；删除 D1–D6、D10 | 「互踢 / 不及时」结构性消失 |
| C3 观测单流化 | `11-04-watch-hub-single-stream` | 每 host 单流 + PrefixIndex + manifest 缓存 + 日志降噪（D12） | 延迟与 CPU 大幅下降 |
| C4 前端单一写者 | `11-04-frontend-single-writer` | `useVisibleWorkspaces`；删除 D7–D9 | 消除残余抖动源 |

## 2. 每步的验证命令（统一）

```bash
# 单文件红绿反馈（TDD 观察用，不是门禁）
cargo test <name> --manifest-path src-tauri/Cargo.toml
pnpm vitest related <file>

# 收尾一次性（不要每改一个文件跑）
pnpm check:quick
```

- `pnpm check:quick` **只在每个子任务收尾跑一次**。
- `.rs` 改动不被 `check:quick` 的 vitest 覆盖（无 import 图）⇒ 每个子任务的 Rust 部分必须显式跑
  `cargo test`（或至少 `cargo test <module>`）并记录结果。
- 不要主动跑 `pnpm check`（pre-push / CI 兜底）。

## 3. Review gates（每个子任务合入前）

- [ ] **G1 删除优先**：diff 里若出现「保留旧机制 + 加守卫」，驳回（`design.md §2` 判断标准）。
- [ ] **G2 删除台账**：`design.md §2` 对应项必须在本子任务 diff 里消失，并在子任务 `implement.md` 勾除。
- [ ] **G3 无反方向测试**：删除「证明互斥成立」的测试（如 `activate_releases_the_previous_unit`），
      替换为「证明互不影响」的断言。留旧测试 = 留旧不变量。
- [ ] **G4 契约同步**：若改动 §12 的措辞，`.trellis/spec/backend/git-domain.md` 必须在**同一 PR** 更新。
- [ ] **G5 红线**：5（无新事件名）/ 6（命令层薄）/ 3（阻塞隔离）/ 10（平台差异落 `platform/`）
      逐条对照本 diff。
- [ ] **G6 可回滚**：每个子任务是独立 commit（或少数同类 commit），整体 revert 不产生半成品状态。

## 4. 集成验收（父任务自有工作，全部子任务完成后执行）

- [ ] **I1** 手测 AC1：同时打开 ≥3 个 git 项目 + neeko 主仓 + `multi-agent` worktree。
      每个单元首个快照 ≤2s 出现；日志中同一单元 60s 内 activate/release 次数 ≤1。
- [ ] **I2** 手测 AC2：在**非激活**项目里改文件，其 changed 计数 ≤2s 更新。
- [ ] **I3** 采集 AC3/AC4：5 分钟编辑活动后 `~/.neeko/neeko.log` <1MB，无 `ignore::walk` 行，
      无 `exclusion roots exceed FSEvents max`。
- [ ] **I4** 机械核对 AC5：`rg 'release_except|mount_tickets|version_floors|requestedIntent' src src-tauri/src` 为空。
- [ ] **I5** 手测 AC7：主仓 ↔ worktree 抖动 30 次 + 删除 worktree，状态收敛无残留旧数据。
- [ ] **I6** 新增护栏 `check_observability_contract.py` 接入 `pnpm lint` 与 CI，并自身有正向/反向用例。
- [ ] **I7** spec 更新：`git-domain.md §12`（D-B 反转记录 + 新契约）+ 根 `AGENTS.md` 红线表新增 16/17
      + `tools/guards/ledger/gates.json` 若新增门需同步接线。
- [ ] **I8** 删除本任务造成的死代码：`collapsed_probe` 若仅服务于 `check_and_wait` 冷窗口适配，
      评估后决定去留并记录（不许「留了没人用」）。

## 5. 回滚点

| 阶段 | 回滚方式 | 回滚后状态 |
| --- | --- | --- |
| C1 后 | revert C1 | 回到当前行为（读按挂载分支），功能不缺 |
| C2 后 | revert C2 | 回到 C1 行为：所有单元可读，但仍是单槽 → 互踢复发（已知） |
| C3 后 | revert C3 | 回到 per-repo 多流（功能正常，成本高） |
| C4 后 | revert C4 | 前端回到 reconciliation 形态（依赖 C2 的集合命令仍存在，需同时 revert 命令签名） |

**禁止**用环境变量开关长期保留两套模型（`NEEKO_DISABLE_*` 式的旧例）；迁移期若需临时开关，
必须在同一任务内删除并记录。

## 6. 收尾

- [ ] 只跑一次 `pnpm check:quick` 确认绿。
- [ ] 同步 spec（见 I7）。
- [ ] `python3 ./.trellis/scripts/add_session.py --title "git status 可观测性重构" --commit "<hash>"`
- [ ] 不主动提交代码（除用户要求）。
