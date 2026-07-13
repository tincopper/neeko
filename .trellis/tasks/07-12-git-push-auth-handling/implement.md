# Git Push 鉴权挂死修复 — 实施清单

## 1. 后端：transport.rs 改造

**文件**: `src-tauri/src/common/git/transport.rs`

- [ ] 1.1 添加常量 `LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(30)`, `NETWORK_GIT_TIMEOUT: Duration = Duration::from_secs(180)`
- [ ] 1.2 添加 `type TransportTimeout = Duration` 枚举/常量（或按 transport 类型返回不同超时）
- [ ] 1.3 将 `GitTransport::Local` 分支中的 `.output()` 改为 `spawn_blocking` + `tokio::time::timeout`
- [ ] 1.4 同上改造 `GitTransport::Wsl` 分支（platform gated）
- [ ] 1.5 在 stderr 解析后插入鉴权错误检测（`AUTH_FAILURE_PATTERNS`），匹配时返回带 `[AuthRequired]` 前缀的 `anyhow::bail!`
- [ ] 1.6 添加超时错误的消息提示（区分"Command timed out"与"Authentication required"）

## 2. 前端：CommitDialog.tsx 补齐超时

**文件**: `src/features/git/components/CommitDialog.tsx`

- [ ] 2.1 导入 `withTimeout`
- [ ] 2.2 `handleCommit` 中的 `push()` 调用包裹 `withTimeout(push(...), 60_000, 'push')`
- [ ] 2.3 `handlePush` 中的 `push()` 调用包裹 `withTimeout(push(...), 60_000, 'push')`

## 3. 前端：ProjectsPanel.tsx 补齐超时

**文件**: `src/features/project/components/ProjectsPanel.tsx`

- [ ] 3.1 导入 `withTimeout`
- [ ] 3.2 `handlePush` 中的 `push()` 调用包裹 `withTimeout(push(...), 60_000, 'push')`
- [ ] 3.3 `handlePull` 中的 `pull()` 调用包裹 `withTimeout(pull(...), 60_000, 'pull')`

## 4. 质量门禁

- [ ] 4.1 `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] 4.2 `pnpm lint`
- [ ] 4.3 `pnpm type-check`

## 回滚点

如果 `spawn_blocking` + `timeout` 导致新问题，退化到：
- 只在前端补齐 `withTimeout`（至少不会永久挂死）
- 保持后端 `.output()` 不变
