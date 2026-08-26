# Implement — 终端输出链路内存治理

> 执行顺序即依赖顺序；每步独立提交 = 独立回滚点。
> 全程遵循 TDD：每步先红后绿再重构。

## Step 1 · Rust OutputPump 纯逻辑模块 `[P0]`

**产出**: `src-tauri/src/terminal/pump.rs` + 单元测试；`terminal/mod.rs` 仅加声明与 re-export。

- [ ] 1.1 Red：编写 `pump.rs #[cfg(test)]` 用例
  - 合流窗口内多次 read → 单次 flush 调用且字节序完整
  - 缓冲达 max_buffer → flush_fn 返回 true 后继续读（不丢字节）
  - flush_fn 返回 false → 暂停读取（fake reader 计数验证）
  - EOF 时残余缓冲 flush 一次后退出
  - 空 flush_interval 内零数据 → 不产生空 flush
- [ ] 1.2 Green：实现 `OutputPump::run(reader, cfg, flush_fn) -> u64`
- [ ] 1.3 Refactor：消除重复，确认 clippy 干净
- [ ] 1.4 统计日志：flush 次数/批量大小/暂停次数汇总（log_info，会话退出时输出）

**验证**: `cargo test --manifest-path src-tauri/Cargo.toml pump`
**回滚点**: revert 本步 commit，无外部影响。

## Step 2 · Rust DrainQueue + services 接入 + drain 命令 `[P0]`

**产出**: services.rs 泵接入、per-session DrainBuffer、唤醒事件常量、`terminal_drain` 命令注册。

- [ ] 2.1 Red：services 层测试
  - drain 取空语义：两次连续 drain 第二次为空
  - session 关闭后 DrainBuffer 回收（无悬挂 Arc）
  - 唤醒事件节流：flush 间隔内多次写入只发一次唤醒
- [ ] 2.2 Green：
  - `spawn_reader_thread` 改用 `OutputPump::run`，flush_fn 写 DrainQueue + 节流唤醒
  - 新增事件常量 `TERMINAL_DRAIN_EVENT`（Rust 侧）与 `terminal_drain_event(id)`
  - `terminal_drain(session_id) -> tauri::ipc::Response` 命令（极薄）
  - `close_pty_handle` 清理路径补 DrainBuffer 回收
  - 命令加入 `neeko_invoke_handler!`（lib.rs）
- [ ] 2.3 Refactor + Review Gate A：
  - Command 极薄 ✓ / mod.rs 无业务 fn ✓ / Event 常量双端对齐 ✓
  - `cargo check` + `cargo test` 全绿

**验证**: `cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`
**回滚点**: revert 本步 commit（前端仍走旧 listen<number[]> 路径不受影响——本步保留旧 emit 移除需与 Step 3 同步切换，见 3.4）。

⚠️ 切换注意：旧 `terminal-output-{id}` emit 的移除放在 Step 3.4（前后端同一 commit 内完成协议切换），避免中间态断流。

## Step 3 · 前端 drain 循环 + 二进制消费 `[P0]`

**产出**: terminalEvents.ts 常量、api 封装、TerminalViewBase 消费链路替换、scrollback 常量化。

- [ ] 3.1 Red：vitest — `drainOutput` 封装（mock invoke 返回 ArrayBuffer）；drain-to-empty 循环 helper
- [ ] 3.2 Green：
  - `shared/utils/terminalEvents.ts`: `TERMINAL_DRAIN_EVENT` + `terminalDrainEvent()`
  - `features/terminal/api`: `drainOutput(sid): Promise<ArrayBuffer>`
  - `shared/utils/terminal.ts`: `TERMINAL_SCROLLBACK = 5000`，TerminalViewBase 引用
- [ ] 3.3 Green：TerminalViewBase 替换 listener → 唤醒驱动 drain 循环；
  write 在途闸门（未回调计数 > 8 → 暂停等待下次唤醒）；sessionId 归属守卫
- [ ] 3.4 **协议切换 commit**（与 Step 2 配对）：移除旧 `emit(terminal-output)` 与
  `listen<number[]>` —— 此 commit 前后端必须同时生效
- [ ] 3.5 Refactor + Review Gate B：
  - store/types 导入防火墙 ✓ / 无 any ✓ / listener 归属审计通过 ✓

**验证**: `pnpm type-check && pnpm test:run`
**回滚点**: 与 Step 2 成对回退。

## Step 4 · resize 统一入口 scheduleFit `[P1]`

**产出**: 吸收现有 RO 断环未提交改动，修复 trailing 缺陷与失败重试语义。

- [ ] 4.1 Red：vitest（fake timers）
  - 快速连续变更 → 结束后 trailing 必触发一次 fit（最终尺寸必达）
  - cols/rows 未变 → 不调用 resize
  - resize reject → pending 保留，下次触发重试成功
  - 四个触发源（RO/attach/font/session-ready）全部经统一入口
- [ ] 4.2 Green：实现 scheduleFit（RAF 合帧 + 120ms trailing + 收敛去重 + 成功才记录 lastFit）
- [ ] 4.3 Refactor：字体切换 effect、attach、session-ready 路径收敛到统一入口

**验证**: `pnpm test:run -- src/features/terminal`
**回滚点**: 独立 commit revert。

## Step 5 · 性能验收（复现基准） `[P0 Gate]`

- [ ] 5.1 构建 dev 运行，开启 agent CLI 全速输出场景 + 连续拖拽窗口 10 分钟
- [ ] 5.2 Activity Monitor 记录 WebContent footprint 曲线（目标稳态 <800MB、斜率≈0）
- [ ] 5.3 `log show --last 30m --predicate 'eventMessage CONTAINS "memorystatus"'`
      确认零新增超限记录
- [ ] 5.4 `sample <WebContent pid>` 抽查 microtask arrayPush 占比（目标 <5%）
- [ ] 5.5 功能回归清单：vim/htop 渲染、resize 最终尺寸一致、多会话并发、
      会话关闭无泄漏（DevTools Memory 对比）

**失败处置**: 任一指标不达标 → 回到 design.md 修订对应层假设，不叠加补丁式修复。

## Step 6 · 质量门与收尾 `[required]`

- [ ] 6.1 最小回归集全绿：
  ```bash
  pnpm lint && pnpm type-check && pnpm test:run
  cargo test --manifest-path src-tauri/Cargo.toml
  ```
- [ ] 6.2 spec 更新评估：若沉淀出「高频 IPC 流治理模式」，按流程更新
      `.trellis/spec/backend|frontend` 相应条目
- [ ] 6.3 会话记录脚本 + 用户确认提交（不自动 commit）

## Step 7 · Fix-1 前端协议补洞（丢失唤醒） `[P0]`

- [x] 7.1 Red：`drainLoop` 返回 `{total, exhausted}`；`createDrainScheduler` 用例 ——
  wake 启动循环 / draining 期间 wake 走 pendingWake 闩锁续跑 / 门闸早退后 digest 恢复拉取 /
  无残留时 digest 不发 invoke / drain reject 复位且可重启
- [x] 7.2 Green：`shared/utils/drainLoop.ts`（自 features/terminal/utils 迁移）实现
  scheduler；TerminalViewBase 接线（onWake/onWriteDigested），移除裸 listener 吞噬逻辑
- [x] 7.3 验证：`pnpm test:run -- shared/utils`

## Step 8 · Fix-2 terminal_drain 异步化 `[P0]`

- [x] 8.1 `terminal/commands.rs::terminal_drain` 改 `async fn` + `State<'_, AppStateWrapper>`
- [x] 8.2 验证：`cargo check`；手动冒泡 drain 命令仍通

## Step 9 · Fix-3 哨兵卫生 `[P0]`

- [x] 9.1 effect cleanup 补 `clearStallWatch()`；rebuildTerminal 加 30s 冷却闸
- [x] 9.2 验证：`pnpm type-check`

## Step 10 · Fix-4 Rust 加固 + B1 补迁 `[P0]`

- [x] 10.1 Red：drain.rs closed 标志用例（push 黑洞 / take 空 / 不 re-arm）
- [x] 10.2 Green：SessionDrain.closed；close 路径（mod.rs close_session、watcher、
      remote.rs）先 close 再 remove
- [x] 10.3 SSH Data 满载改停泊重试（remote.rs）
- [x] 10.4 B1：taskRunner.ts、terminalFactory.ts 迁移 drain 协议
- [x] 10.5 验证：`cargo test --manifest-path src-tauri/Cargo.toml && pnpm test:run`

## Step 11 · 回归门 `[required]`

- [x] 11.1 `pnpm lint && pnpm type-check && pnpm test:run`
- [x] 11.2 `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] 11.3 手动验收：agent CLI 全速输出多 tab 并发 + 新建终端即时性 +
      冻结 tab 敲键盘回显恢复

## 风险预案

| 风险 | 触发信号 | 处置 |
|---|---|---|
| 停读背压导致前台卡顿 | agent CLI 输出明显迟滞 | 调大 max_buffer/调小闸门阈值，重测 |
| 唤醒事件风暴 | log 中 drain 通知频率异常 | 加强节流或改轮询兜底 |
| xterm write 大块兼容性 | 渲染撕裂 | 分块上限（如 64KB/次 write）切片 |
