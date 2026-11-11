# 合并 multi-agent 分支到 feat-team 主线

## Goal

把 `multi-agent`（87 提交、356 文件、+72k 行）合入 `feat-team`，**以 feat-team 现行代码为唯一基线**：
冲突一律先取 feat-team 侧，再按 feat-team 的既有惯例补回 multi-agent 的语义增量；
multi-agent 里落后于主线的代码（`SessionSpec`、dock `barItems`、`ExtraConsumer`、`existingSessionId`
接管模型、`common::text` 搬迁）**反向适配到主线 API**，不得把主线改回旧形态。

净结果：拿到 multi-agent 的两个新子系统（`agent-team` 协调基质、`work-items` 统一任务中心）
及其面板/命令/事件/迁移，而主线的既有行为、结构、测试断言不被改乱。

## Background

两条线从 `d00a4861`（2026-10-30）分叉，各自**独立重构了同一批地基**，所以 46 个冲突里有一批
是「同一件事的两套答案」，不是两边各加几行：

| 地基 | feat-team（基线，2026-11-11） | multi-agent（2026-11-10） |
| --- | --- | --- |
| 终端创建 | `TerminalLaunch{cols,rows,shell,command,resume_from}` + `TerminalRegistration` + 历史回放 | `SessionSpec{env,workspace_root,cwd,cols,rows,shell,launch,extra_env}` |
| dock 布局 | `placements / viewSizes / leftSlotSize`（单一真相） | `barItems / rightPanelSizes / leftPanelSize` |
| hooks 消费者 | `Vec<HookSink>`（组合根装配 N 个消费者） | `ExtraConsumer`（单槽「额外消费者」+ `compose_consumers`） |
| ANSI 剥离 | `conversation::text::strip_ansi`（+ `common::agent::transcript_noise` 放噪声） | 搬到 `common::text::strip_ansi` |
| 会话接管 | `attachSessionId`（接回后端已登记的活会话，`sessionTabFactory` 统一铸造 tab） | `existingSessionId`（tab 直接采纳后端 PTY id，WSL/SSH 抛 `takeoverUnsupported`） |
| schema 版本 | 符号常量 `LIBRARY_MIGRATION_LAST` / `CACHE_MIGRATION_STEP` / `LATEST_VERSION = 13` | 裸数字字面量 + `LATEST_VERSION = 21`（步骤 13..=20 属 team / work_items） |

冲突统计：46 个文件；另外 30 个文件两边都改过但**自动合并成功**（multi-agent 的改动被静默拼进来，
其中 `git/services/commit/prompt.rs` 已变成引用 `common::text`）。

新特性耦合度实测（这是「嫁接可行」的依据）：

- multi-agent 新增 Rust 文件 41 个、前端文件 202 个，**无一引用**上述任何被改的地基 API
  （`SessionSpec` / `common::text` / `live_sessions` / `barItems` 全部零命中）。
- 真正的适配点只有 4 处：`app/team_executor.rs`（唯一用 `SessionSpec` 的新文件）、
  `agent/team/sentinel.rs`（用 `common::text`）、`app/boot.rs` 组合根（要挂 team 消费者）、
  `common/db/migrations.rs`（要接 13..=20 的步骤）。
- 前端新特性的接入面全在 4 个共享接线文件：`app/dock/registry.ts`、`shared/dock/panelMeta.ts`、
  `shared/dock/types.ts`、`shared/events.ts`。

## Requirements

- **R1（基线唯一）**：feat-team 现有文件的语义保持。允许的改动只有两类 ——
  ① 为接纳新特性所必需的**接线**（注册表条目、面板元数据、事件常量、模块声明、迁移步骤、命令注册）；
  ② 新特性需要的**扩展点**（`TerminalLaunch` 增加环境注入字段）。不允许把主线结构改回 multi-agent 的旧形态。
- **R2（冲突处理顺序）**：每个冲突文件先落 feat-team 版本，再按 feat-team 的惯例把 multi-agent 的语义增量加回去。
  禁止直接采用 multi-agent 侧已被主线淘汰的结构：`SessionSpec`、`ExtraConsumer`/`compose_consumers`、
  dock `barItems`、`existingSessionId` 接管、`common::text` 搬迁、裸数字迁移步骤。
- **R3（新特性完整）**：`agent-team`、`work-items` 两个子系统在合并后可编译、命令可注册、面板可出现、
  事件通道可用、迁移步骤可执行（数据库从 v13 升到 v21 路径可行）。
- **R4（适配而非照抄）**：multi-agent 落后调用点改写到主线 API ——
  team 成员会话走 `TerminalLaunch` + `TerminalRegistration`；team 消费者作为第三个 `HookSink` 挂到组合根；
  team tab 入口改用 `attachSessionId`/`sessionTabFactory`；迁移步骤用符号常量命名。
- **R5（可验证）**：`cargo check` / 相关域 `cargo test` / `pnpm check:quick` 全绿；
  主线既有测试**不得为了让代码通过而改断言**（唯一例外：新特性确实改变了被断言的行为，此时必须在
  implement.md 记录理由）。
- **R6（历史保留）**：合并形态是一个 merge commit，父提交为 `feat-team` 与 `multi-agent`，
  合入前的 feat-team 顶端有备份分支。

## 非目标

- 不顺手重构主线（`strip_ansi` 三处实现并存的问题留给后续任务，见 design D3）。
- 不扩展 CI 门禁覆盖面、不新增护栏 check。
- 不修改 `packages/`、不动 `.trellis/spec/` 之外的历史文档（spec 增量按 R1 ① 处理）。

## 验收标准

- **AC1**：`git log --merges -1` 显示 merge commit，两个父提交正确；`git merge-base --is-ancestor multi-agent HEAD` 成立。
- **AC2**：46 个冲突文件全部解决且无冲突标记残留（`grep -rn '^<<<<<<<\|^>>>>>>>'` 为空）。
- **AC3**：`cargo check --all-targets` 通过（`src-tauri/`）。
- **AC4**：`pnpm check:quick` 通过（含 eslint / tsc / fmt / clippy / 仓库护栏）。
- **AC5**：主线结构的抽样断言 —— `src-tauri/src/terminal/router.rs` 的 `create_session` 签名仍是
  `(env, registration, workspace_root, launch, app_handle)`；`src/shared/store/dockStore.ts` 仍是
  `placements/viewSizes`；`agent::hooks::ingest::dispatch` 仍是 `HookSink` 广播；`conversation::text`
  仍是 ANSI 剥离的落点。四项全中。
- **AC6**：团队/工作项可用的最小证据 —— `team_snapshot` / `work_item_list` 命令已注册（`generate_handler!` 内可见），
  team 面板与 work-items 面板在 `registry.ts` 有条目，`AGENT_TEAM_EVENT` 常量双端同名。
- **AC7**：合入前 feat-team 顶端在 `backup/feat-team-pre-merge`，随时可回退。

## 关联任务

- `07-26-unified-task-hub`（planning）—— work_items 子系统落地后，该任务的 PRD 需要按实际实现重写基线。
- `07-26-ui-design-audit`（in_progress）—— 本合并会引入 team / work-items 两个新界面，审计范围随之扩大。
