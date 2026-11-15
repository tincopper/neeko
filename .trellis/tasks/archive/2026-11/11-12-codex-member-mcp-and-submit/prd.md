# 修复 codex 成员：MCP 工具面不可达导致任务板永不更新 + TUI 投递不提交

## Goal

两个用户可见缺陷，同一个受害者（codex 成员），两条独立链路：

1. **任务板永不更新**：codex 成员拿不到 `neeko-team` MCP 工具（`tool_search` 恒空），
   于是 `task_claim / task_update / team_send` 一个都调不到 —— 成员在干活，板上永远是
   「待认领」。根因是**下发给 codex 的鉴权形状（`Authorization: Bearer`）与团队 MCP 门
   接受的形状（`x-neeko-team-token`）不一致**，成员的首个 `initialize` 就吃 403，
   rmcp 关掉传输层，工具面整体不存在（证据：`research/00-evidence.md` §1）。
2. **消息停在 codex TUI 输入框里不发送**：`Pty` 投递的「正文 + `\r` 两笔」被 codex 的
   paste-burst 判据当成「粘贴 + 粘贴里的换行」，回车被吞成换行（证据：同文件 §2）。
   修法是用 codex 已开启的 bracketed paste 声明一次显式粘贴，让回车确定性提交。

## Requirements

- R1 团队 MCP 的鉴权门必须接受**准入表向成员宣传的全部鉴权形状**：自定义头
  `x-neeko-team-token`（claude-code / codebuddy / qoder / pi…）与
  `Authorization: Bearer <token>`（codex 的 `bearer_token_env_var`）。
  判据的落点必须是**一份实现**（门的凭证列表由一处构造，boot 与测试共用）。
- R2 `Pty` 投递的「提交形态」是**每个 CLI 的实测事实**，只允许落在准入表
  （`AgentAdmission`）的字段里；通用模块禁止 `if agent_id == "codex"`（红线 15 的同族）。
- R3 未实测的 CLI 行为**逐字节不变**：现有两笔协议（正文一笔 → 间隔 → `\r` 一笔）
  对除 codex 之外的成员保持原样。
- R4 两条修复都必须是**编译期/测试期可判**的：门少装一种凭证、或某个 CLI 的提交形态
  被误改，都要有测试变红，而不是靠人记得。
- R5 不引入新表、不引入迁移、不加 IPC 命令、不改 event 名（红线 4/5 零负担）。

## Non-Goals

- 不改成 `codex` 用 `http_headers` 注入（准入表已注明该形状「parses but was never
  proven to be sent」，未实测的通道不进代码）。
- 不写 codex 的用户全局配置（`disable_paste_burst` 之类）—— 那是碰用户配置。
- 不做「成员 MCP 握手失败」的新 UI 提示/新成员状态位（本轮只修可达性 + 落日志级别不变）。
- 不给 claude-code / pi / codebuddy 换投递形态（它们今天能用，改动收益为负）。
- 不碰 `work-items` 域与前端看板。

## Acceptance Criteria

- [x] AC1 `cargo test -p neeko agent::team::boot` 中新增的护栏测试证明：**门接受 Bearer 与
      自定义头两种形状**，且错 token / 空集合仍然拒绝（`AuthGate` 的单一比较点不变）。
- [x] AC2 同一条护栏在**只删掉 Bearer 凭证**时变红（变异验证，需在 PR 说明里贴一次）。
- [x] AC3 `admission` 的表驱动测试：`codex` → `PtySubmit::BracketedPaste`，其余已准入成员
      → `PtySubmit::Plain`（形态是数据，不是分支）。
- [x] AC4 `delivery` 的纯函数测试：`BracketedPaste` 计划的第一笔字节 ==
      `ESC[200~` + 正文 + `ESC[201~`，第二笔仍是单字节 `\r`，间隔沿用同一常量；
      `Plain` 计划的字节与改动前**逐字节相同**（既有断言不改即通过）。
- [x] AC5 `deliver` 的调用点按成员行的 `agent_id` 取提交形态（执行层注入，投递层不认识 CLI）。
- [ ] AC6 手工验证（在 Neeko 里，**待用户确认**）：起一个 codex 成员的团队 → 成员 `task_list` 能列出板、
      `task_claim` 成功且**看板/分配图状态随快照更新**；`team_send` 投递一行消息后
      codex TUI 里该消息**自行提交**（不再停在输入框）。
- [x] AC7 `pnpm check:quick` 绿；改动波及的 Rust 模块 `cargo test` 绿（`check:quick`
      不跑 `cargo test`，见 AGENTS.md「覆盖面要诚实」）。

## Notes

- 证据与复查用 SQL / 日志行 / codex 源码位置：`research/00-evidence.md`。
- 本轮不修 `pi-arch` 侧的任何行为（它本来就正常）。
