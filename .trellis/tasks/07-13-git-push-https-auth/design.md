# Git Push HTTPS 登录支持 — 技术设计

## 架构决策

### 方案选择：`git credential` 子系统 + 类型化 `PushOutcome`（非 GIT_ASKPASS）

否决 `GIT_ASKPASS` + IPC 桥接方案（需随附 askpass 可执行文件 + 本地 socket + 请求关联，移动部件多）。采用 git 原生 `git credential fill/approve/reject` 子系统：

- 复用系统凭据存储（macOS Keychain / Windows Credential Manager / Linux libsecret 或 `store` 回退），持久化由 git 自己管。
- 无需 askpass 二进制、无需事件往返。
- 鉴权需要时由 `push` 命令**快速返回类型化结果**（非阻塞等待弹窗），前端驱动重试循环——天然规避「弹窗等待被网络超时误杀」(R2/AC9)。

### 调用流（核心）

```
前端 push(transport, setUpstream)
   │ invoke('push')
   ▼
commands::push → operations::push → transport.run_git(["push"])
   │ git 失败 → stderr 命中鉴权模式（GIT_TERMINAL_PROMPT=0 使其快速失败）
   ▼
返回 PushOutcome::AuthRequired { remote_url, username_hint }   ← 快速，< 网络超时
   │
前端 catch AuthRequired → 打开 GitCredentialDialog（无超时压力）
   │ 用户输入 username + PAT
   ▼
invoke('push_with_credentials', { transport, setUpstream, username, password })
   │
后端：
   1. git credential approve  (缓存到系统 helper)
   2. git push                 (git 经 helper 取回刚缓存的凭据)
   │ 仍失败鉴权 → git credential reject → 返回 PushOutcome::AuthRequired（前端可再循环，上限 3 次）
   │ 成功 → PushOutcome::Success
```

`pull` / `fetch` 同理（鉴权失败 → `AuthRequired` → 前端弹窗 → `pull_with_credentials` / `fetch_with_credentials`）。

### 关键点 1：`run_git` 签名扩展

当前 `run_git(&self, args, work_dir)` 无 env 注入点。新增可选配置参数（保持现有调用方零改动）：

```rust
pub struct GitExecOptions<'a> {
    pub env: &'a [(&'a str, &'a str)],
    pub extra_config: &'a [(&'a str, &'a str)], // 渲染为 -c key=val，前置于 args
}
impl Default for GitExecOptions<'_> { /* 空切片 */ }

pub async fn run_git(&self, args: &[&str], work_dir: &str) -> Result<String> { self.run_git_opts(args, work_dir, GitExecOptions::default()).await }
pub async fn run_git_opts(&self, args: &[&str], work_dir: &str, opts: GitExecOptions<'_>) -> Result<String>
```

网络操作统一注入：
- `GIT_TERMINAL_PROMPT=0`（杜绝提示挂死，AC5）
- `-c credential.helper=<detected>`（确保 fill/approve 能落到真实 helper，AC2 持久化，R1 缓解）

WSL/Remote 分支：env 通过命令字符串 `KEY=val git ...` 注入；`-c` 直接拼进 git 参数。

### 关键点 2：credential helper 检测

```rust
fn resolve_credential_helper(transport, work_dir) -> String {
    // 1. git config --get credential.helper 命中 → 用用户配置
    // 2. 否则按平台默认：
    //    macOS → "osxkeychain"
    //    Windows → "manager"
    //    Linux → 探测 libsecret，不可用则 "store"（明文，记 warn 日志）
}
```

检测在首次需要凭据时执行一次并缓存到进程内（按 transport+work_dir）。

### 关键点 3：`git credential` 协议封装

```rust
struct Credential { protocol: String, host: String, username: Option<String>, password: Option<String> }

// fill: 写入 protocol/host[/username]\n\n，解析返回；password=None 表示无缓存
async fn credential_fill(transport, work_dir, helper, url) -> Result<Option<Credential>>
// approve: 写入 protocol/host/username/password\n\n
async fn credential_approve(transport, work_dir, helper, cred) -> Result<()>
// reject: 同 approve 写法
async fn credential_reject(transport, work_dir, helper, cred) -> Result<()>
```

通过 `run_git_opts(["credential","fill"], ...)` + stdin 注入实现。**注意**：`run_git_opts` 当前用 `.output()` 一次性收 stdout，stdin 需改为 `Stdio::piped()` + 写入后收 output。新增 `run_git_with_stdin(opts, stdin_bytes)` 内部方法。

### 关键点 4：错误分类（AC8）

拆分 `AUTH_FAILURE_PATTERNS`：

```rust
const AUTH_PATTERNS: &[&str] = &[
    "Authentication failed", "Permission denied (publickey)",
    "could not read Username", "HTTP Basic: Access denied",
    "request failed with status 401", "could not read Password",
];
const NETWORK_PATTERNS: &[&str] = &[
    "fatal: unable to access", "Could not resolve host",
    "Connection timed out", "Failed to connect", "RPC failed",
];
const AMBIGUOUS_PATTERNS: &[&str] = &[
    "Could not read from remote repository", "Repository not found",
    // 这些既可能是鉴权(私有仓库 404)也可能是网络/路径，结合 exit code 与是否 401 上下文判定
];
```

分类返回 `ErrorKind::{Auth, Network, Ambiguous}`，前端据此决定弹窗还是纯提示。

### 关键点 5：SSH（AC6）

SSH remote 不走 `git credential`。`git push` 失败 stderr 含 `Permission denied (publickey)` → 归类 `Auth(Ssh)` → `PushOutcome::AuthRequired` 携带 `ssh: true` 标志 → 前端不弹密码框，改提示「配置 ssh-agent / ssh-add」。

### 数据契约

```rust
// commands::push / pull / fetch 返回类型由 () 改为：
pub enum PushOutcome {
    Success,
    AuthRequired { remote_url: String, username_hint: Option<String>, ssh: bool },
}
// 新命令
push_with_credentials(transport, set_upstream, username, password) -> Result<PushOutcome, AppError>
pull_with_credentials(...) / fetch_with_credentials(...) 同构
```

前端 `gitApi.ts` 增加 `pushWithCredentials`，`PushOutcome` 类型加入 `src/types.ts`（单一源）。

### 前端

- 新组件 `src/features/git/components/GitCredentialDialog.tsx`：复用 `src/ui/dialog.tsx`，prop 契约仿 `RemoteAuthDialog`（`isOpen` / `onCancel` / `onSubmit(username, password)`），字段：username（预填 hint）、password/PAT、host 只读展示。
- `GitCommitPanel.tsx` / `CommitDialog.tsx` / `ProjectsPanel.tsx`：push/pull 调用改为处理 `PushOutcome`——`AuthRequired` 且 `!ssh` → setState 打开凭据对话框 + 暂存当前操作上下文；`AuthRequired` 且 `ssh` → toast 引导；`Success` → 正常。
- 重试循环上限 3 次，超出后 toast 终止。
- `withTimeout` 仍包裹 invoke；因 `AuthRequired` 是快速返回（不阻塞），60s 超时不受弹窗影响（弹窗在前端层，已在 invoke 返回之后）。

### 兼容性 / 回滚

- `run_git` 旧签名保留（委托新方法），现有调用方零改动。
- `local.rs` 旧 `push`/`commit_and_push` 删除（AC7）——确认无调用方（调研已证）。
- 回滚点：若 `git credential` 跨平台 helper 检测出问题，退化到「只加 `GIT_TERMINAL_PROMPT=0` + 类型化 AuthRequired + 前端提示去外部配置」，即不实现 in-app 缓存但仍消除挂死。

### 测试策略（TDD）

**Rust（`#[cfg(test)]`）**
- `classify_stderr`：auth / network / ambiguous 各模式命中（纯函数）
- `parse_credential_output`：解析 `git credential fill` 的 stdout（含/不含 password）
- `resolve_credential_helper`：mock `git config` 返回，覆盖三平台分支
- `PushOutcome` 序列化：serde round-trip
- 集成：tempdir git repo + 假 remote（`git daemon` 或本地 bare repo）+ `credential.helper=store`，验证 fill→approve→push 链路

**前端（Vitest）**
- `isAuthRequiredOutcome(outcome)` 纯函数
- `GitCredentialDialog`：渲染、提交、取消（`@testing-library/react`）
- push handler：mock `invoke` 返回 `AuthRequired` → 断言对话框打开 + 调用 `pushWithCredentials`
