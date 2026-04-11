# Tauri 后端模块重构

## Goal

对 Neeko 的 Tauri 后端进行全面模块重构，消除代码重复，按职责拆分过大的模块，建立清晰的模块层次结构，同时补充单元测试。

## Requirements

- 拆分 remote.rs（907行）为 3 个独立模块
- 消除 terminal.rs 的 create_session/create_wsl_session 代码重复
- 按领域拆分 state.rs 数据结构
- 统一 git.rs 的代码风格
- 提取 commands/mod.rs 中的工具函数
- 为新提取的函数补充单元测试

## Acceptance Criteria

- [ ] remote.rs 从 907 行降至 ~400 行
- [ ] terminal.rs 的 PTY 逻辑提取为共享函数
- [ ] state.rs 拆分为 5 个子模块
- [ ] git.rs 移入 git/ 目录，统一风格
- [ ] utils/fonts.rs 提取完成
- [ ] 所有模块编译通过（cargo check）
- [ ] 单元测试全部通过（cargo test）
- [ ] 无导入路径遗漏

## Definition of Done

- cargo check 编译通过
- cargo test 测试通过
- pnpm tauri dev 可正常启动
- 代码风格遵循现有约定

## Technical Approach

### Phase 1: remote.rs 拆分

- 新建 git/mod.rs, git/wsl.rs, git/remote.rs
- 从 remote.rs 提取 WSL Git 操作到 git/wsl.rs
- 从 remote.rs 提取 SSH Git 操作到 git/remote.rs
- 更新 commands/wsl_git.rs, commands/remote_git.rs 导入路径

### Phase 2: terminal.rs 去重复

- 提取 spawn_pty_pipeline() 共享 watcher/reader 线程逻辑
- 统一 PtyHandle 和 graceful_kill 到模块顶部

### Phase 3: state.rs 拆分

- 新建 state/ 目录
- 按领域拆分为 project.rs, terminal.rs, session.rs, diff.rs, auth.rs
- 更新所有导入路径

### Phase 4: git.rs 统一

- 将 git.rs 移入 git/local.rs
- 补充 parse_git_info_output, parse_status_line 测试

### Phase 5: utils 提取

- 新建 utils/mod.rs, utils/fonts.rs
- 从 commands/mod.rs 提取 get_monospace_fonts

## Out of Scope

- 不改变 public API（Tauri 命令签名不变）
- 不重构前端代码
- 不添加新功能

## Technical Notes

- WSL 函数使用 #[cfg(target_os = "windows")] 门控
- SSH 函数使用 tokio + russh 异步实现
- git2-rs 用于本地 Git 操作
- 约 15 个文件需要更新导入路径
