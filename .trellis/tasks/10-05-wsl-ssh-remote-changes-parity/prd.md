# WSL/SSH 远端项目现场核对（Changes 面板 + 退出收敛）

## 背景

`09-26-worktree-repo-identity`（及其子链 `10-01-path-identity-alphabet` →
`10-01-async-path-resolution` → `10-02-blocking-fs-sweep`）已于 2026-10 归档。其 AC13
「WSL / SSH 项目现有行为与改动前逐项一致」**未闭合**，原因不是遗漏而是本机不可执行：

- `~/.neeko/sessions.json` 里 11 个项目 `environment.type` 全为 `Local`；
- 2026-09-29 那次现场手测的日志中 `ssh` / `wsl` 关键字命中 0 次 ⇒ 远端分支根本没被跑过，
  人的确认只覆盖本地。

代码层证据已给（`only_local_targets_get_a_push_producer` /
`status_porcelain_uses_transport_repo_check_not_local_filesystem` / 远端读路径经 transport
现算并注册表盖章），其余零回归担保在 CI 三平台矩阵。

另：`626dd7a3`（app 退出时收敛 git 子进程树，共享单一 `KillFn`）的 **WSL / SSH 退出收敛**
本地同样未能验证（Windows target 的 `lzma-sys` 原生依赖无法在本机构建）—— 一并在此现场核对。
本任务只做**现场闭合**（无代码交付）。

## Requirements

在有 **WSL 项目** 与 **SSH 项目** 的机器上，各走一遍本次身份链影响的主链路：

1. 激活远端项目 → 打开 Changes 面板，确认**能出条目**（不是空态、不是报错）；
2. 面板条目与远端 `git status --porcelain` 真值一致（抽样比对）；
3. 远端项目下切/切 worktree（若支持）后，视图不串本地主仓数据；
4. 无新增 `ERROR` / `not a git repository` 日志（`~/.neeko/neeko.log`）。
5. **退出收敛（WSL / SSH）**：跑一个长 git 操作（触发 pre-push/pre-commit hook，或在远端直接起一个
   可辨识的长进程），在操作进行中**直接退出 Neeko**；退出后确认远端/宿主的 git → hook 子树被收敛
   （远端 `ps` 不再有残留 `git` / hook 进程）。对应实现：`common/executor/child_registry` 在退出时
   由 `kill_all_live` 驱动共享 `KillFn` —— SSH 在**远端**新通道 `kill -9`、WSL 宿主侧树杀。

## Acceptance Criteria

- [ ] WSL 项目：Changes 面板出条目且与远端真值一致（附日志/截图或条目数）
- [ ] SSH 项目：Changes 面板出条目且与远端真值一致（附日志/截图或条目数）
- [ ] 远端路径下无跨单元串数据（切 worktree / 切项目不残留旧条目）
- [ ] `~/.neeko/neeko.log` 无新增 `ERROR` / `not a git repository`
- [ ] **WSL 退出收敛**：长操作进行中退出 Neeko → 宿主侧 git/hook 子树被树杀（`ps` 无残留）
- [ ] **SSH 退出收敛**：长操作进行中退出 Neeko → **远端** `ps` 无残留 git/hook 进程（证明在远端 kill，
      非本地按远端 pid 杀）；日志无 ERROR
- [ ] 结论回写本任务；若发现回归，另开修复任务并引用 10-05

## 前置

- 一台可访问 WSL（Windows）与 SSH 远端、且已接入 Neeko 的机器；
- 远端仓库有可观测的本地改动（否则 Changes 面板本就应空）。

## Notes

- 本任务**只有现场项**，没有代码交付；PRD-only 有效。
- 归档 `09-26` 时已明确接受「AC13 以本任务承接」这一事实，缺口不因归档而消失。
- 退出收敛项对应已合并实现 `626dd7a3`（共享 `KillFn` + `child_registry` + `shutdown_background_and_exit`
  的 `kill_all_live`）；本机仅 Local 路径有回归测试，WSL/SSH 交本任务现场闭合。
