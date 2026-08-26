# 终端输出链路内存治理：合流泵+二进制IPC+背压闭环

## Goal

基于 Jetsam/sample dump 根因分析：WebContent 进程 8.7 分钟膨胀至 5.2GB（峰值 10.4GB），
主因是终端输出链路全链路无界缓冲 + resize 正反馈回路。
按五条公理（有界化/背压/合流/二进制编码/断开反馈环）实施根本性治理，
使 WebContent footprint 达到稳态可控。

## Background（根因结论）

证据链（2026-08-25 dump 分析）：

1. Jetsam：WebContent 反复突破 2048MB ActiveSoft 软限 → 回收重建 → 8 分钟再膨胀；
2. WebContent sample：主线程 68% 样本处于 microtask 中执行
   `operationArrayPush + tryFastCompactRealloc`（JS 无界数组累积特征）；
   RenderBlock paint/layout 高占比（渲染风暴）；
3. 主进程 sample：843MB 常驻（峰值 1.3G），线程全部健康空闲；
4. 代码核实：
   - `src-tauri/src/terminal/services.rs:279-297` reader 每次 4KB read 直接
     `emit(Vec<u8>)`，JSON 序列化为 `number[]`（~6x 膨胀），无合流、无背压；
   - 前端 `TerminalViewBase.tsx` `listen<number[]>(terminal-output-{id})`
     收到即 `term.write()`，消费速率与生产速率无任何协调；
   - `scrollback: 10000`（xterm 默认 10 倍），多会话常驻无总预算；
   - resize 反馈环（RO 自激 → SIGWINCH → agent TUI 整屏重绘 → 输出放大）
     已有部分断环改动（TerminalViewBase.tsx，未含 trailing 兜底）。

## Scope

### In Scope

- L1 Rust PTY 输出泵：定频合流 + 有界缓冲 + 满载暂停读（天然背压）
- L2 IPC 二进制化：terminal-output 从事件广播 JSON 载荷迁移到 Tauri Channel 二进制流
- L3 JS 消费侧流速感知：积压监控 + 反向通知 Rust 泵降频（闭环背压）
- L4 resize 统一入口：合并现有 RO 断环改造，补 trailing 兜底与失败重试语义
- L5 驻留预算：scrollback 下调/可配，多会话总预算封顶策略
- L0 度量基建：footprint / writeBuffer 深度 / emit 批量统计的日志观测点

### Out of Scope

- 主进程 843MB 治理（git 缓存/PTY 缓冲审计）→ 后续独立任务
- conversation/git diff 大文本链路
- WebGL addon 开关策略调整
- WSL/SSH 远程终端的特殊路径适配验证（架构兼容但不在本轮验收范围）

## Requirements

1. **不丢字节**：终端输出语义不容许数据丢失，治理只能延迟不能丢弃；
2. **不阻塞 UI**：Rust reader 线程停读等待时不得影响其他 session 与命令响应；
3. **向后兼容**：前端 xterm 渲染行为（TUI 应用、vim、agent CLI）无可见退化；
4. **遵循统一执行接口红线**：不引入绕开 `core::exec` / executor 的新命令执行路径；
5. **Event 名常量化红线**：新增 IPC 通道名沿用 `src/shared/utils/terminalEvents.ts`
   与 Rust 端常量的双端单一事实源模式；
6. **Command 层极薄**：新逻辑落在 services 层，不污染 command 层；
7. TDD：每层先写测试（Rust `#[cfg(test)]` / vitest），红→绿→重构。

## Acceptance Criteria

### 性能指标（复现基准：agent CLI 全速输出 + 连续拖拽窗口 10 分钟）

- [ ] WebContent Physical footprint 稳态 < 800MB，30 分钟增长斜率 ≈ 0
      （基线：8.7min → 5.2GB）
- [ ] Jetsam 日志零新增 `exceeded mem limit` 记录
- [ ] sample 中 microtask arrayPush 特征占比从 68% 降至噪声水平（<5%）

### 功能回归

- [ ] vim/htop/agent CLI 渲染无撕裂、无行错位
- [ ] resize 后列宽同步正确（含快速小幅拖拽后最终尺寸一致 —— trailing 兜底）
- [ ] 多会话（主终端 + side + worktree）并发输出互不串扰
- [ ] 会话关闭后无监听器/缓冲泄漏（注册表审计通过）

### 工程质量

- [ ] `pnpm lint`、`pnpm type-check`、`pnpm test:run` 全绿
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 全绿
- [ ] 新增 Rust 单元测试覆盖泵的合流/满载/恢复逻辑
- [ ] 新增前端测试覆盖流速感知闸门与 resize trailing 行为

## Constraints

- macOS 为首要验收平台；Windows ConPTY 路径保持编译通过（CI 门控）
- 不改变 sessions.json / config.json 存储格式（scrollback 若可配，作为新可选键，
  缺省回退内置默认值）

## Stakeholders

- Developer: tincopper
- 影响：终端 feature 全部策略（local/wsl/remote 共用 TerminalViewBase）
