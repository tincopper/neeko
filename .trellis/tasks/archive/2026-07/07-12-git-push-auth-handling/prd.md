# Git Push 鉴权挂死修复 — PRD

## 问题描述

当 `git push` 遇到以下鉴权情景时，应用永久挂死：
- **HTTPS remote** — git 在无 TTY 的子进程中等待 stdin 输入用户名/密码
- **SSH key 需要 passphrase** — ssh 等待 passphrase 输入
- **Remote 临时不可用 / 超时** — TCP 连接未在合理时间内失败

根因链：`std::process::Command::output()` 同步阻塞 tokio 线程 → git 进程无限等待 stdin → Tauri IPC 永不返回 → 前端 loading 状态持续到 timeout（甚至没有 timeout 的路径）。

## 验收标准

1. [AC1] 当 git push 因鉴权失败时，**不再挂死**，在合理时间内返回错误
2. [AC2] 错误消息明确指示是鉴权问题（如 "Authentication required"、"Permission denied (publickey)"）
3. [AC3] 所有 push/pull 前端路径均有 60s 网络超时保护
4. [AC4] 非鉴权类网络错误（如 remote 不可达）也有超时保护，不会挂死
5. [AC5] fetch/pull/push 等网络操作在 `transport.rs` 层统一受保护

## 影响范围

- `src-tauri/src/common/git/transport.rs` — 核心修复
- `src/features/git/components/CommitDialog.tsx` — 补齐超时
- `src/features/project/components/ProjectsPanel.tsx` — 补齐超时
