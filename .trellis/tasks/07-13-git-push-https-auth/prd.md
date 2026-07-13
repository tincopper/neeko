# Git Push HTTPS 登录支持 — PRD

## 背景

当前应用 push/pull/fetch 通过无 TTY、无 stdin 的子进程调用 `git`。当 HTTPS remote 需要鉴权且本地无缓存凭据时：

- 未设置 `GIT_TERMINAL_PROMPT=0`，git 可能尝试提示输入而卡到超时；
- 没有 `GIT_ASKPASS` / credential helper 桥接，app 无法在进程内提供凭据；
- 任务 `07-12-git-push-auth-handling` 仅加了超时与 `[AuthRequired]` 错误识别，**并未实现 in-app 登录**，最终体验是「超时后提示用户去外部配置 git」。

本任务目标：让 app 真正支持 HTTPS remote 的 in-app 登录（用户名 + PAT/密码），凭据可持久化到系统凭据存储，后续 push/pull/fetch 免再次输入。

## 范围

**包含**
- HTTPS remote 的用户名 + PAT/密码 in-app 输入（覆盖 GitHub/GitLab 等主流 HTTPS 场景）
- 凭据持久化到系统凭据存储（macOS Keychain / Windows Credential Manager / Linux libsecret 或 git `store` 回退）
- 鉴权失败时前端弹窗重试，支持「凭据错误 → 重新输入」
- `GIT_TERMINAL_PROMPT=0` 兜底，杜绝子进程提示挂死
- 清理 `common/git/local.rs` 中无超时/无鉴权检测的旧同步 push 路径（`push` / `commit_and_push`）死代码

**不包含**
- SSH key passphrase 弹窗输入（SSH 仅依赖系统 ssh-agent，鉴权失败时给出引导提示）
- OAuth 设备码登录流程
- 远端 URL 内嵌凭据改写

## 用户故事

- US1：首次 push 到私有 HTTPS 仓库且本地无凭据时，app 弹出登录对话框，输入用户名 + PAT 后 push 成功。
- US2：凭据持久化后，后续 push/pull/fetch 不再弹窗。
- US3：输入错误凭据导致 push 鉴权失败时，app 重新弹窗让用户修正，并替换已缓存的错误凭据。
- US4：用户取消登录对话框时，push 以明确错误终止，不挂死。
- US5：SSH remote 鉴权失败时，提示用户配置 ssh-agent / ssh-add，不弹密码框。

## 验收标准

- [AC1] HTTPS remote 首次鉴权：push 触发前端登录弹窗，输入正确用户名 + PAT 后 push 成功
- [AC2] 凭据持久化：成功登录后重启 app，push/pull/fetch 免再次输入
- [AC3] 凭据纠错：输入错误凭据后 push 失败，自动重新弹窗；输入正确凭据后成功，旧错误凭据被替换
- [AC4] 取消对话框：用户取消登录时 push 在合理时间内返回明确错误（非挂死、非超时）
- [AC5] `GIT_TERMINAL_PROMPT=0` 对所有网络 git 子进程生效，无提示挂死路径
- [AC6] SSH 鉴权失败返回 `[AuthRequired]` 并附带 ssh-agent 引导，不弹密码框
- [AC7] `local.rs` 旧 `push` / `commit_and_push` 死代码已删除，`cargo check` / 测试通过
- [AC8] 错误分类清晰：鉴权错误与网络错误分别给出不同提示，不把网络错误误判为 `[AuthRequired]`
- [AC9] 所有 push/pull/fetch 前端路径仍受 `withTimeout` 保护，新增登录弹窗等待不影响超时语义（弹窗期间不计时或单独计时，不与网络超时叠加导致误杀）

## 约束

- 遵循 TDD：先写测试（鉴权错误分类、凭据缓存命中/未命中逻辑、askpass 桥接契约）
- 后端 `anyhow::Result` / `AppError` 错误传递约定不变
- 不引入明文存储凭据作为主方案（`store` helper 仅作无系统 keychain 时的回退，并在日志/文档中标注风险）
- 跨平台：macOS / Windows / Linux 均需可用；WSL/Remote transport 复用同一凭据流程的命令侧（在远端主机执行 `git credential`）

## 依赖与风险

- 风险 R1：`git credential` 子系统依赖 `credential.helper` 已配置；若用户环境未配置，需 app 主动注入 helper（`-c credential.helper=...`），否则 `approve` 不持久化。
- 风险 R2：登录弹窗是阻塞 push 的同步等待，需与前端 `withTimeout` 协调，避免弹窗等待期间被网络超时误杀。
- 风险 R3：macOS Keychain / Windows Credential Manager 的 helper 名称因 git 版本/安装方式不同（`osxkeychain` / `manager` / `manager-core`），需检测而非硬编码。
