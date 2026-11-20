# 设计：LSP 安装判据与项目移除生命周期

## 0. 边界

`src-tauri/src/lsp/{installer.rs,session/instance.rs(提示文案)}` +
`src-tauri/src/project/commands.rs`。不动安装脚本（`java_install.rs`）、不动 exec env 构造、
不新增命令。

## 1. 三件

### 1.1 判据与产物同环境（止血）

```
安装（脚本，跑在目标环境）  →  $HOME/.neeko/bin/<bin>          ← 产物
判据 check_binary_installed →  command_exists_blocking(target, "<bin>")   ← 只看 PATH
```

Local 由 `platform::host_path::prepend_neeko_bin` 把 `~/.neeko/bin` 置顶到**进程 PATH**，所以
Local 一致；WSL / SSH 没有这一步 ⇒ 每次会话创建都判「未安装」→ 重下 ~100MB → 装完仍判未安装。

改法（只改判据，不改脚本）：

```rust
pub fn check_binary_installed(binary: &str, target: &ExecTarget) -> bool {
    if command_exists_blocking(target, binary) {
        return true;
    }
    // 下载式安装（jdtls 官方发行版包装脚本）落在**目标环境**的 `$HOME/.neeko/bin`；
    // 远端 PATH 通常不含该目录。按绝对路径再判一次 —— `command_exists` 在
    // WSL/SSH 上走 `command -v <name>` 的脚本形态，`$HOME` 由目标 shell 展开。
    // Local 不需要（`prepend_neeko_bin` 已置顶），且本地 `$HOME` 不会被展开。
    if !matches!(target, ExecTarget::Local) {
        let probed = command_exists_blocking(target, &format!("$HOME/.neeko/bin/{binary}"));
        log::info!("[LSP][installer] absolute-path probe {binary} on target: {probed}");
        return probed;
    }
    false
}
```

**为什么不是「注入 PATH」**：那要让 `LspExecContext::for_session` 为每个目标读取现有 PATH 并前缀
（远端多一次 exec + 缓存），属于 exec env 构造的平台改造（红线 10），已记 out of scope。
判据侧修完的直接收益是：**不再重复下载**，且失败文案能说清真正的原因。

配套：`session/instance.rs` 的「installed but still not found」文案改为指向
`~/.neeko/bin` 与 PATH（现在的文案让用户以为是安装失败）。

### 1.2 去重键含 target，同键改为等待

```rust
// installer.rs
static INSTALL_IN_PROGRESS: LazyLock<Mutex<HashSet<InstallKey>>>;   // InstallKey = (String, String)
```
`ExecTarget` 不是 `Hash`（含连接信息），用 `format!("{target:?}")` 还是给它一个稳定标识？
看现状：日志用 `std::mem::discriminant(target)`（`Discriminant(0)`）。判别式只区分**种类**
（Local / Wsl / Remote），不区分具体主机 —— 对去重语义足够（同语言 + 同类目标视为同一次安装），
而且不引入路径/凭据进键。故键 = `(language_id, discriminant)`（用 `u64`/`String` 存）。

同键并发：**等待**。做法（不加依赖、不引入 ConditionVar 复杂度）：

```rust
// 已在装 → 轮询等待（上限 = 安装预算），而不是直接 Err
loop {
    if !in_progress.contains(&key) { break; }
    if started.elapsed() > INSTALL_WAIT_TIMEOUT { return Err("... timed out waiting ...") }
    thread::sleep(INSTALL_WAIT_POLL);          // 50ms
}
```
注意调用点语义：`install_plugin_server` 在 `spawn_blocking`/装配线程里跑，轮询等待可接受
（有界、低频）。等待结束后走**正常安装路径**（此时前一次已成功 → 判据为真 → 快速返回 true）。

### 1.3 删除项目拆 LSP

`project/commands.rs::remove_project`：删之前取 `get_project(&project_id).map(|p| p.path.clone())`，
删之后（与终端/watcher 同段）调 `state.lsp_manager.close_sessions_for_project(&path)`。
它已是既有单一入口（close + `profiles.remove` + `attempt_diag.evict_project`），不要在这里
重复那三件事。

## 2. 失败与边界矩阵

| 场景 | 期望 |
| --- | --- |
| Local，`jdtls` 在 PATH | `true`（不变） |
| Local，只在 `~/.neeko/bin` | `true`（`prepend_neeko_bin` 已置顶，走第一条分支） |
| WSL/SSH，只在 `$HOME/.neeko/bin` | `true`（绝对路径兜底） |
| WSL/SSH，两处都没有 | `false` → 安装一次；装完再判 |
| 同语言同目标并发安装 | 后者等待，最终 `true` |
| 同语言**不同**目标并发安装 | 各自独立（键含 target 判别式） |
| 删除项目 | LSP 会话关闭 + profiles/诊断键驱逐 |

## 3. 权衡

| 选择 | 代价 | 为什么仍选它 |
| --- | --- | --- |
| 判据按绝对路径兜底 | 远端每次判据多一次 exec | 与「重下 100MB」相比可忽略；且只在 PATH 失败时发生 |
| 去重键用目标**判别式**而非完整连接 | 同类型两个远端视为同一次安装 | 完整目标含凭据/主机，进键后会把「同一台机器换个跳板」判成两次；安装是幂等的 |
| 同键改为轮询等待 | 引入 50ms 轮询 | 不加依赖；等待有界；比「直接失败让用户手动装」更符合预期 |
| `remove_project` 复用 `close_sessions_for_project` | 关闭是异步收口（不 await） | 与项目停用同一条路径；删除项目时进程退出由关闭序列兜底 |

## 4. 兼容与回滚

- 无 wire / 脚本 / 事件变化。
- 回滚 = revert 单个 commit：远端回到「重复下载」，删除项目回到「LSP 活到退出」。
- 风险：远端「已装但不在 PATH」时，判据为真但 spawn 仍失败（本轮不注入 PATH）。失败文案必须
  把这一点说清（"installed at ~/.neeko/bin but not on PATH"），否则用户会困惑为什么「已安装」却用不了。
