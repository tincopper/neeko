# 平台差异集中化重构（Platform Adapter 分层）

## Goal

将当前散落在 20+ 个文件中的 96 处 `#[cfg(...)]` 平台差异逻辑，按「主题优先、平台次之」集中到独立的平台适配层（`src-tauri/src/platform/`），通过统一接口对外暴露。目标：**遗漏某平台实现时编译器立即报错**（而非换平台构建才暴露），同时保持高内聚、不改变任何运行时行为。

## 方案定位（两层防线）

本任务解决的是「**组织层**」的编译问题根因：平台实现缺失/`#[cfg]` 分支不完整导致的「换平台才炸」。

- **组织层（本任务）**：`platform/<theme>/` + `#[cfg] + pub use`，把「每个平台必须有实现」从约定变为**编译期强制**——缺一个平台 impl，`mod.rs` 的 `pub use` 在本机直接报错。
- **行为层（已有 CI，非本任务新增）**：`.github/workflows/ci.yml` 的 `backend-check` / `backend-test` 已在 **ubuntu / macos / windows 三平台矩阵**上跑 `cargo check` + `cargo clippy -- -D warnings` + `cargo test`（`fail-fast: false`）。它兜底「能编译但行为不对」的错误。

两者结合才是完整防线：重构后 CI 矩阵从「抓编译错误」升级为「抓行为错误」，分工更清晰。本任务只做组织层；CI 矩阵是既有组成部分，不新增、不改动。

## Background / 已确认事实

- 当前 `src-tauri/src` 下共有 **96 处 `target_os` / `unix` / `windows` 条件编译**，散落在 20+ 个文件。
- 反模式典型：同一函数体内用 `#[cfg]` 块堆叠多平台实现，例如：
  - `browser/devtools.rs` 的 `ensure_detached_devtools`（macOS / Linux / Windows 三平台 detach 轮询）
  - `file/commands.rs` 的 `build_reveal_command`（explorer / open / xdg-open）
  - `lsp/session/utils.rs` 的 `sample_process_memory_mb`（ps / procfs / 跳过）
  - `terminal/process_reaper.rs` 的 `snapshot_process_tree`（libproc / procfs）
  - `core/exec_env.rs` 的 `init_host_user_path`（unix / windows）
- 这些平台实现**共享同一函数体**，遗漏某平台时当前平台编译不报错，只有换平台构建才暴露。
- 项目规范明确「策略集已知且固定时用 `Enum + match` 代替 `Box<dyn Trait>`」；但平台差异是**编译期确定**的，不适用运行期抽象，应坚持编译期 cfg + 每平台文件。
- 项目自身未直接使用 `cfg-if` / `cfg_aliases`（仅作为传递依赖存在），也没有 `platform_impl` 模式。

## Requirements

1. 建立顶层平台适配层 `src-tauri/src/platform/`，作为平台差异的统一门面。
2. 按**主题**组织（实现阶段扩展后共 12 个：DevTools、文件管理器 reveal、进程树快照、进程内存采样、PATH 解析、Git 凭据、Shell 任务命令、进程启动标志、IDE 启动、技能链接、file:// 解析、通知基地址），每个主题一个目录，目录内每平台一个实现文件。
3. 每个主题的 `mod.rs` 用 `#[cfg]` 选择平台实现并 `pub use`，对外只暴露统一接口（函数签名或 trait）。
4. 业务代码只依赖 `platform::<theme>::` 统一接口，删除原函数体内的 `#[cfg]` 块。
5. **不改变任何运行时行为**：迁移只移动代码位置、统一接口，不重写平台逻辑。
6. 平台差异集中化后，遗漏某平台实现时编译器立即报错。

## Acceptance Criteria

- [x] `src-tauri/src/platform/` 存在，包含各主题目录（12 个），每个主题 `mod.rs` 用 `#[cfg]` + `pub use` 选择平台实现。
- [x] 第一批（纯函数主题）迁移完成：文件管理器 reveal、进程树快照、进程内存采样、PATH 解析。
- [x] 原 `file/commands.rs`、`terminal/process_reaper.rs`、`lsp/session/utils.rs`、`core/exec_env.rs` 中的平台 `#[cfg]` 实现块已移除，改为调用 `platform::<theme>::` 统一接口。
- [x] 第二批（逻辑差异大）迁移完成：DevTools 打开、Git 凭据。
- [x] 实现阶段扩展主题迁移完成：shell_launch、process_spawn、ide_launch、symlink、file_url、notify_base。
- [x] 业务代码中不再存在「函数体内堆叠多平台 `#[cfg]` 实现」的反模式（`devtools.rs`、`file/commands.rs`、`lsp/session/utils.rs` 等已清理；剩余 `#[cfg]` 均在 `#[cfg(test)]` 内或为 unix 共享逻辑）。
- [x] `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` 全部通过（79 passed，含 `process_reaper` 的 unix 测试）。
- [x] `pnpm lint`（Rust fmt + clippy）通过。
- [ ] 交叉编译检查：`cargo check --target x86_64-pc-windows-msvc` 与 `cargo check --target x86_64-unknown-linux-gnu` 通过（如本机已安装 target；否则由 CI 三平台矩阵兜底）。

## Out of Scope

- 不迁移 `app_menu.rs`（macOS 菜单与 Tauri Menu API 深度绑定，抽离收益低）。
- 不迁移 `terminal/mod.rs` 的 shell 选择（已是简单策略，抽离增加间接层）。
- 不迁移 `job_object`、`wsl` 模块（已是 Windows 专属独立模块，符合集中化）。
- 不新增/改动 CI 多平台矩阵：`.github/workflows/ci.yml` 已存在三平台矩阵，作为行为层兜底（本任务仅组织层重构，CI 是既有组成部分）。
- 不改变任何平台逻辑实现（仅移动位置、统一接口）。

## Open Questions

- 平台模块命名：`platform/` 还是对齐 Tauri/winit 生态的 `platform_impl/`？（倾向 `platform/`，简洁且语义清晰）
- 是否引入 `cfg_aliases` crate 定义语义化别名（`macos`/`linux`/`windows`/`unix`），以进一步降低拼写错误概率？（倾向引入，但需确认是否接受新增 build 依赖）
- 第二批（devtools / git_credential）是否纳入本任务，还是仅先做第一批纯函数主题？
