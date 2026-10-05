# WSL/SSH 远端项目 Changes 面板现场核对（worktree 身份链 AC13 遗留）

## 背景

`09-26-worktree-repo-identity`（及其子链 `10-01-path-identity-alphabet` →
`10-01-async-path-resolution` → `10-02-blocking-fs-sweep`）已于 2026-10 归档。其 AC13
「WSL / SSH 项目现有行为与改动前逐项一致」**未闭合**，原因不是遗漏而是本机不可执行：

- `~/.neeko/sessions.json` 里 11 个项目 `environment.type` 全为 `Local`；
- 2026-09-29 那次现场手测的日志中 `ssh` / `wsl` 关键字命中 0 次 ⇒ 远端分支根本没被跑过，
  人的确认只覆盖本地。

代码层证据已给（`only_local_targets_get_a_push_producer` /
`status_porcelain_uses_transport_repo_check_not_local_filesystem` / 远端读路径经 transport
现算并注册表盖章），其余零回归担保在 CI 三平台矩阵。本任务只做**现场闭合**。

## Requirements

在有 **WSL 项目** 与 **SSH 项目** 的机器上，各走一遍本次身份链影响的主链路：

1. 激活远端项目 → 打开 Changes 面板，确认**能出条目**（不是空态、不是报错）；
2. 面板条目与远端 `git status --porcelain` 真值一致（抽样比对）；
3. 远端项目下切/切 worktree（若支持）后，视图不串本地主仓数据；
4. 无新增 `ERROR` / `not a git repository` 日志（`~/.neeko/neeko.log`）。

## Acceptance Criteria

- [ ] WSL 项目：Changes 面板出条目且与远端真值一致（附日志/截图或条目数）
- [ ] SSH 项目：Changes 面板出条目且与远端真值一致（附日志/截图或条目数）
- [ ] 远端路径下无跨单元串数据（切 worktree / 切项目不残留旧条目）
- [ ] `~/.neeko/neeko.log` 无新增 `ERROR` / `not a git repository`
- [ ] 结论回写本任务；若发现回归，另开修复任务并引用 10-05

## 前置

- 一台可访问 WSL（Windows）与 SSH 远端、且已接入 Neeko 的机器；
- 远端仓库有可观测的本地改动（否则 Changes 面板本就应空）。

## Notes

- 本任务**只有现场项**，没有代码交付；PRD-only 有效。
- 归档 `09-26` 时已明确接受「AC13 以本任务承接」这一事实，缺口不因归档而消失。
