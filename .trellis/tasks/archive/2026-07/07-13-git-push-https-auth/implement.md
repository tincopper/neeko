# Git Push HTTPS 登录支持 — 实施清单

> TDD：每步先写失败测试再实现。每完成一个里程碑跑 `cargo test` + `pnpm test`。

## 1. 后端基础设施

**文件**: `src-tauri/src/common/git/transport.rs`

- [ ] 1.1 新增 `GitExecOptions<'a> { env, extra_config }` + `Default`；新增 `run_git_opts(args, work_dir, opts)`，旧 `run_git` 委托默认
- [ ] 1.2 `run_git_opts` Local 分支：注入 `opts.env`，把 `opts.extra_config` 渲染为 `-c k=v` 前置 args
- [ ] 1.3 新增 `run_git_with_stdin(args, work_dir, opts, stdin: &[u8])`：`Stdio::piped()` 写入 stdin 后收 output（供 `git credential` 用）
- [ ] 1.4 WSL/Remote 分支：env 以 `KEY=val` 前缀拼进命令字符串；`-c` 拼进 git 参数
- [ ] 1.5 测试：`run_git_opts` 注入 env 生效（`git -c x=y config x` 回读验证）；`run_git_with_stdin` 用 `git hash-object --stdin` 验证

## 2. 错误分类

**文件**: `src-tauri/src/common/git/transport.rs`

- [ ] 2.1 拆分 `AUTH_FAILURE_PATTERNS` → `AUTH_PATTERNS` / `NETWORK_PATTERNS` / `AMBIGUOUS_PATTERNS`
- [ ] 2.2 新增 `enum ErrorKind { Auth, AuthSsh, Network, Ambiguous, Other }` + `fn classify_stderr(stderr) -> ErrorKind`
- [ ] 2.3 测试：各类模式命中；SSH `Permission denied (publickey)` → `AuthSsh`；网络 `unable to access` → `Network`；空 stderr → `Other`

## 3. credential 协议封装

**文件**: `src-tauri/src/common/git/credential.rs`（新）+ `common/git/mod.rs` 注册

- [ ] 3.1 `struct Credential { protocol, host, username: Option, password: Option }` + `fn parse_credential_output(text) -> Result<Credential>`
- [ ] 3.2 `fn build_credential_input(cred) -> Vec<u8>`（`protocol=...\nhost=...\n[username=...]\n[password=...]\n\n`）
- [ ] 3.3 `fn resolve_credential_helper(transport, work_dir) -> String`：读 `git config --get credential.helper`，空则平台默认（mac→osxkeychain / win→manager / linux→探测 libsecret 否则 store+warn）
- [ ] 3.4 `async fn credential_fill/approve/reject(transport, work_dir, helper, cred)`：经 `run_git_with_stdin(["credential","approve"], ...)` + `-c credential.helper=<helper>`
- [ ] 3.5 测试：`parse_credential_output` 含/不含 password；`build_credential_input` round-trip；helper 解析三平台分支（mock `run_git`）

## 4. PushOutcome 契约

**文件**: `src-tauri/src/common/git/types.rs`（或 `git/commands.rs`）

- [ ] 4.1 `pub enum PushOutcome { Success, AuthRequired { remote_url, username_hint: Option<String>, ssh: bool } }`（derive Serialize/Deserialize）
- [ ] 4.2 测试：serde round-trip 三变体

## 5. operations 改造

**文件**: `src-tauri/src/common/git/operations.rs`

- [ ] 5.1 `push` 返回 `PushOutcome`：网络操作注入 `GIT_TERMINAL_PROMPT=0`；失败时 `classify_stderr` → `Auth/AuthSsh` 返回 `AuthRequired`（携 remote_url、username_hint 从 URL 解析），其他 `bail!`
- [ ] 5.2 新增 `push_with_credentials(transport, work_dir, set_upstream, username, password)`：`credential_approve` → `run_git(["push"])`；仍 auth → `credential_reject` + 返回 `AuthRequired`
- [ ] 5.3 `pull` / `fetch` 同构改造 + `pull_with_credentials` / `fetch_with_credentials`
- [ ] 5.4 测试：mock transport，断言 push 失败 auth 返回 `AuthRequired{ssh:false}`；SSH 失败返回 `ssh:true`

## 6. 命令层

**文件**: `src-tauri/src/git/commands.rs` + `src-tauri/src/lib.rs`

- [ ] 6.1 `push`/`pull`/`fetch` 返回类型 `()` → `PushOutcome`
- [ ] 6.2 新增 `#[tauri::command] push_with_credentials / pull_with_credentials / fetch_with_credentials`
- [ ] 6.3 `lib.rs` `neeko_invoke_handler!` git 段注册三个新命令
- [ ] 6.4 `cargo check --manifest-path src-tauri/Cargo.toml`

## 7. 删除旧死代码（AC7）

**文件**: `src-tauri/src/common/git/local.rs`

- [ ] 7.1 删除 `pub fn push`（1057）与 `pub fn commit_and_push`（981）及其测试
- [ ] 7.2 全量 `rg "commit_and_push|local::push\b"` 确认无残留引用
- [ ] 7.3 `cargo check` + `cargo test`

## 8. 前端类型与 API

**文件**: `src/types.ts` + `src/features/git/api/gitApi.ts`

- [ ] 8.1 `src/types.ts` 加 `PushOutcome` 联合类型
- [ ] 8.2 `gitApi.ts`：`push/pull/fetch` 返回 `PushOutcome`；新增 `pushWithCredentials/pullWithCredentials/fetchWithCredentials`
- [ ] 8.3 测试：`isAuthRequired(outcome)` 纯函数

## 9. 凭据对话框

**文件**: `src/features/git/components/GitCredentialDialog.tsx`（新）

- [ ] 9.1 复用 `src/ui/dialog.tsx`；prop：`isOpen` / `host` / `usernameHint` / `onSubmit(username,password)` / `onCancel`
- [ ] 9.2 字段：username（预填 hint）、password/PAT（password type）、host 只读
- [ ] 9.3 测试：渲染、填值提交、取消回调（`@testing-library/react`）

## 10. 前端 push/pull handler 改造

**文件**: `GitCommitPanel.tsx` / `CommitDialog.tsx` / `ProjectsPanel.tsx`

- [ ] 10.1 维护 `credentialDialog` state（{ open, host, usernameHint, pendingOp }）；`pendingOp` 描述待重试的 with_credentials 调用
- [ ] 10.2 push/pull 调用结果为 `AuthRequired` 且 `!ssh` → 打开对话框；`ssh` → toast「配置 ssh-agent / ssh-add」
- [ ] 10.3 对话框提交 → 调对应 `*WithCredentials`；结果仍 `AuthRequired` → 重开对话框（计数 ≤3）；`Success` → 关闭 + toast 成功
- [ ] 10.4 `withTimeout` 仍包裹 invoke（`AuthRequired` 快速返回，不受影响）
- [ ] 10.5 测试：mock invoke 返回 `AuthRequired` → 断言对话框开 + 提交后调用 `pushWithCredentials`；ssh 分支不弹框

## 11. 质量门禁

- [ ] 11.1 `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] 11.2 `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- [ ] 11.3 `pnpm test`
- [ ] 11.4 `npx tsc --noEmit`
- [ ] 11.5 `pnpm lint`
- [ ] 11.6 手动验证（AC1-AC6）：HTTPS 私有仓库首次 push、重启免输、错误凭据纠错、取消、SSH 引导

## 回滚点

- 若 `git credential` helper 检测跨平台出问题 → 退化为「只加 `GIT_TERMINAL_PROMPT=0` + `PushOutcome::AuthRequired` + 前端 toast 引导外部配置」，保留 AC5/AC4/AC7，放弃 AC1-AC3。
- 若 `run_git_opts` 签名改动引发回归 → 保留旧 `run_git` 行为，新逻辑走独立 `run_git_opts` 路径。
