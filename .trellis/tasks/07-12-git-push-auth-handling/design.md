# Git Push 鉴权挂死修复 — 技术设计

## 架构决策

### 方案选择：`spawn_blocking` + `tokio::time::timeout`

不使用 `tokio::process::Command`（Tauri 2 对 `tokio::process` 的 feature flag 管理不统一，且 `lib.rs` 中的 `tokio::main` 可能不包含 `process` feature）。

```
std::process::Command::output()  // 当前：同步阻塞
   ↓
spawn_blocking(move || { cmd.output() })  // 迁移到阻塞线程池
   + tokio::time::timeout(Duration::from_secs(git_timeout_secs), ...)
```

### Git 命令超时策略

| 阶段 | 超时值 | 原因 |
|------|--------|------|
| 当前无超时 | — | 任意网络操作可永久挂死 |
| 实施后 | `Local`: 30s / `Remote`/`WSL`: 180s | Local 操作不应有网络延时；网络操作给 3 分钟窗口 |

### 鉴权错误检测

在 `run_git` 返回错误前，扫描 stderr 匹配以下模式：

```rust
const AUTH_FAILURE_PATTERNS: &[&str] = &[
    "Authentication failed",
    "Could not read from remote repository",
    "Permission denied (publickey)",
    "could not read Username",
    "HTTP Basic: Access denied",
    "fatal: unable to access",
    "fatal: could not read",
    "request failed with status 401",
    "Repository not found",
];
```

匹配到时，错误消息前缀加上 `[AuthRequired]` 标签给前端消费。

### 前端错误消费模式

```typescript
function isAuthError(error: unknown): boolean {
  const msg = String(error);
  return AUTH_PATTERNS.some(p => msg.includes(p));
}
```

```typescript
// 在 push/pull 错误处理中：
if (isAuthError(e)) {
  showToast('Authentication required. 请配置 git 凭证后重试 (git config credential.helper / SSH key)', 'error');
}
```
