# 实施计划：LSP 安装判据与项目移除生命周期

## S1 · 判据按绝对安装路径兜底（R1 / AC1）

- [ ] **Red**：`absolute_install_path_is_accepted_when_path_misses` —— 用可注入的探测替身
      （把 `command_exists_blocking` 抽成 `trait`/闭包，或加 `#[cfg(test)]` 的注入点）：
      第一次返回 false、第二次（绝对路径）返回 true ⇒ `check_binary_installed` 为 true；
      两次都 false ⇒ false。**不得起真实远端**。
- [ ] **Green**：`installer.rs` 按 design §1.1 加绝对路径兜底（仅非 Local）。
- [ ] 文案：`session/instance.rs` 的「installed but still not found」改为指向 `~/.neeko/bin` + PATH。
- [ ] **Gate A**：`rg -n 'installed but still not found' src-tauri/src` 零命中（旧文案已换）。

## S2 · 去重键含 target + 同键等待（R2 / AC2）

- [ ] **Red**：
  - `install_key_separates_targets`：同语言、不同 `ExecTarget` 判别式 ⇒ 键不同。
  - `concurrent_same_key_install_waits_instead_of_failing`：模拟第一个占位 → 第二个调用
    **不返回** "Install already in progress"，而是在占位释放后完成（用短超时 + 释放线程）。
- [ ] **Green**：`INSTALL_IN_PROGRESS` 改 `(language_id, u64 discriminant)`；
      占位冲突改为有界轮询等待（50ms / 上限 `INSTALL_WAIT_TIMEOUT`）。
- [ ] **Gate B**：`rg -n 'Install already in progress' src-tauri/src` 零命中。

## S3 · remove_project 拆 LSP（R3 / AC3）

- [ ] **Red**：`remove_project_closes_lsp_sessions` —— 插一个桩会话到 `lsp_manager.session_store`
      （用既有 testing 夹具），调 `remove_project` 命令体内抽出的函数/直接调 manager，
      断言该 path 的会话已关闭（store 无会话）。
- [ ] **Green**：`project/commands.rs::remove_project` 删前取路径，删后调
      `state.lsp_manager.close_sessions_for_project(&path)`。
- [ ] **Gate C**：`rg -n 'close_sessions_for_project' src-tauri/src/project/commands.rs` 命中 1 处。

## S4 · 收尾

- [ ] `cargo test --lib` 全绿；`cargo clippy --all-targets -- -D warnings` 干净。
- [ ] `pnpm check:quick` 全绿。
- [ ] spec：`lsp-domain.md` 的「可用性判据与消费点同环境」（原则 2）补一句绝对路径兜底与它的
      已知局限（不注入 PATH 时 spawn 仍需要 PATH）。

## 回滚点

- S1 / S2 独立（installer 内部）；S3 独立（一条命令）。
