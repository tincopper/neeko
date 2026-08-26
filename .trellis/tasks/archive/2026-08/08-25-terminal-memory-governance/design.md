# Design — 终端输出链路内存治理

## 0. 设计公理（来自第一性原理推导）

> 无限速率的源接入有限速率的消费者，中间任何无界缓冲必然单调增长至被处决。

五条公理，每条封死一类增长途径：

| 公理 | 对应改造 |
|---|---|
| 有界化 | 泵缓冲上限、drain 队列上限 |
| 背压 | 满载停读（OS 层限流）+ 前端拉取节奏（信用制） |
| 合流 | 16ms 定频 flush，emit 次数下降 1~2 个数量级 |
| 二进制编码 | drain 走 `tauri::ipc::Response` raw bytes |
| 断开放大回路 | resize 统一入口（幂等收敛 + trailing） |

## 1. 现状与目标数据流

### 现状（问题链路）

```
PTY ──4KB read──> 每次 emit(Vec<u8>) ──JSON number[] (~6x膨胀)──>
listen<number[]> ──term.write()──> xterm writeBuffer(无界) ──> 渲染
      ▲                                                  │
      └────── SIGWINCH ← fit风暴(agent TUI 整屏重绘) ←────┘   ← 正反馈回路
```

### 目标（信用制拉取 + 全链路有界）

```
PTY ──read──> OutputPump [有界缓冲 256KB]        ← 满载停读 = OS 层背压
                  │ 定频 flush 16ms（合流）
                  ▼
             DrainQueue per-session [Mutex<Vec<u8>> 上限 512KB]
                  │ 非空 → 轻量唤醒事件 terminal-drain-{id}（节流，载荷≈0）
                  ▼
前端 listener ──invoke terminal_drain(sid)──> Response(raw ArrayBuffer)
                  │ 循环 drain 直到返回空
                  ▼
             term.write(chunk) ──xterm──> 渲染
                  │ 积压超阈值 → 暂缓下次 drain（JS 层背压）
```

关键性质：

- **不丢字节**：积压传导路径 = 前端慢 → 不 drain → Rust 队列涨 → 泵停读 → 内核 PTY
  缓冲承接 → 前台进程 write 阻塞。终端语义下这是唯一正确的背压形式（不能丢帧）。
- **合流**：无论源端输出多碎，IPC 往返频率 ≤ 60Hz，且每次都是大块二进制。
- **编码**：`tauri::ipc::Response::new(Vec<u8>)` 前端得到 `ArrayBuffer`，零 JSON 开销。

## 2. 模块边界与契约（高内聚低耦合）

### 2.1 新增 `src-tauri/src/terminal/pump.rs`

```rust
pub(crate) struct PumpConfig {
    pub max_buffer: usize,        // 256 KB，超过则暂停 read
    pub flush_interval: Duration, // 16 ms
}

/// 单会话输出泵：reader 线程内运行，产出合流后的字节块
pub(crate) struct OutputPump { /* ... */ }

impl OutputPump {
    /// 阻塞泵循环：读到 EOF/Err 前，按 interval 合流输出。
    /// flush_fn 由调用方注入（写入 DrainQueue 并触发唤醒事件），
    /// 便于单测注入 fake clock / fake sink。返回总字节数。
    pub(crate) fn run(
        reader: Box<dyn Read + Send>,
        cfg: &PumpConfig,
        mut flush_fn: impl FnMut(&[u8]) -> bool, // false = sink 满载 → 暂停读
    ) -> u64;
}
```

- 泵只关心「读→攒→按策略吐」，不知道 Tauri/session 存在（依赖倒置，flush_fn 注入）；
- 单测可全同步驱动：fake Read + 手动推进，无需真实 PTY。

### 2.2 `services.rs` 改造

- `spawn_reader_thread` 内改为构造 `OutputPump::run`，flush_fn 闭包完成：
  1. append 到该 session 的 `DrainQueue`
  2. 若队列从空变非空 → emit 唤醒事件（节流：距上次唤醒 < flush_interval 则跳过，
     反正 drain 循环会持续拉）
- 新增 per-session 状态：`DrainQueue(Arc<Mutex<DrainBuffer>>)` 挂到既有 session 表；
- 新增命令 `terminal_drain(session_id) -> tauri::ipc::Response`：
  取走队列全部积压（swap take），空则返回空 Response；
  Command 保持极薄：校验 + 调度 manager。
- 会话关闭：清理 DrainQueue，防止悬挂（复用 close_pty_handle 清理路径）。

### 2.3 前端 `features/terminal`

- `terminalEvents.ts`：新增 `TERMINAL_DRAIN_EVENT = 'terminal-drain'` 与
  `terminalDrainEvent(id)`（双端单一事实源，Rust 侧同名常量对应）；
- `api/terminalApi.ts`（终端域 api 层）：封装 `drainOutput(sessionId): Promise<ArrayBuffer>`；
- `TerminalViewBase.tsx`：
  - 替换 `listen<number[]>(output)` → `listen(drainEvent)` 唤醒循环：
    ```
    onWake → while(true) { buf = await drain(); if empty break; term.write(buf) }
    ```
  - 积压闸门：统计在途 write 未回调数 > N（如 8）时，跳出循环等待下一次唤醒；
  - **resize 统一入口 `scheduleFit()`**：RAF 合帧 + 120ms trailing 定时器兜底 +
    cols/rows 收敛去重 + resize 失败保留 pending 待重试；RO/attach/字体/session 就绪
    四个触发源统一调用（吸收现有未提交断环改动并修复 trailing 缺陷）。

### 2.4 驻留预算

- `scrollback` 提取为常量 `TERMINAL_SCROLLBACK = 5000`（shared/utils/terminal.ts），
  Terminal 构造引用之；配置化延后（见 §6 取舍）。

## 3. 并发与生命周期

- 泵线程模型不变：每 session 一条 OS reader 线程（阻塞 read 天然挂起）；
- DrainQueue 生命周期 = session 生命周期，close_pty_handle 统一回收；
- 唤醒事件可能丢失/乱序无害：drain 循环以「取到空」为准，唤醒仅为优化；
- 前端组件卸载不 unlisten（维持 detach/reattach 保活架构），但 drain 循环必须
  以 sessionId 归属校验防串扰（沿用 currentKeyRef 守卫模式）。

## 4. 兼容性与平台

| 面 | 结论 |
|---|---|
| Local/WSL/SSH | 三策略共用 `spawn_reader_thread`，透明受益 |
| Windows ConPTY | 泵为纯 std I/O 逻辑，无平台分支；CI 编译门控 |
| input/close/watcher 事件 | 不动（低频，JSON 无碍） |
| agent 自动启动 | input 通路不变 |

## 5. Rollout / Rollback

- 按 implement.md 步骤推进，每步独立提交、独立可回退（git revert 粒度）；
- 不做运行时特性开关（YAGNI：回滚场景 = 整体回退某一步 commit，git 已足够）；
- 上线观察指标：`~/.neeko/neeko.log` 中泵统计日志（L0）+ Activity Monitor footprint。

## 6. 权衡记录（Trade-offs）

1. **推送 → 信用制拉取**：牺牲一次事件往返的首包延迟（≤16ms + RTT），
   换取二进制编码 + 显式背压 + 消费节奏自主权。终端流式场景值得。
2. **scrollback 仅降默认值、不做配置化**：控制本次爆炸半径；配置系统接入是
   独立横切关注点，混入会稀释本任务焦点（YAGNI/KISS）。
3. **停读背压而非丢帧**：极端慢消费下前台程序可能感到 write 变慢 —— 这是
   终端正确性的代价，且有 xterm 在途闸门兜底，实际难以触达。
4. **唤醒事件可能合并/丢失**：协议上允许（drain-to-empty 为准），换取
   无锁化简化 —— 事件仅是「可能有数据」的 hint。

## 7. 测试策略

| 层 | 用例 |
|---|---|
| Rust `pump.rs #[cfg(test)]` | 合流窗口内多段输入→单次 flush；满载暂停→flush 后恢复；EOF 残余 flush；flush_fn=false 阻断读取 |
| Rust services | drain 命令取空语义；session 清理回收 DrainQueue；唤醒节流 |
| vitest api 层 | drainOutput 封装（mock invoke） |
| vitest hook/组件 | scheduleFit trailing 兜底（fake timers）：快速连续变更后最终尺寸必达；收敛去重不发重复 resize；write 积压闸门暂停 drain |

## 8. 回炉修订：全 tab 冻结故障根因与协议补丁（2026-08-26）

### 8.1 故障根因（实测复现："单 tab 冻结 → 全部 tab 死 → 新建终端死"）

1. **协议丢失唤醒（单 tab 冻结根因）**：`take_and_rearm` 的补发 wake 存在三处不可恢复吞噬点 ——
   draining 期间到达被 `if (draining) return` 吞掉；门闸早退后新循环在首次 pull 前即 break；
   竞态补发的 wake 恰落在循环退出尾部。任一发生后：`wake_in_flight` 永久为 true，
   后续 push 全部不再唤醒 ⇒ 该 session 输出永久滞留（敲键盘回显也无法解冻）。
2. **放大器 A（全局瘫痪）**：`terminal_drain` 为同步命令 → 在 Rust 主线程串行执行；
   多会话并发输出时 invoke 洪泛挤占主线程，`create_terminal_session` 等全部命令排队饿死。
3. **放大器 B（持续性死亡）**：effect cleanup 未清 stall 定时器 + dispose 后 parse 回调
   永不触发导致 `pendingWrites` 泄漏 → 僵尸定时器周期性触发整终端重建（含 WebGL 上下文
   反复创建）→ 共享 WebContent 渲染管线 wedged。

### 8.2 协议补丁设计

**前端调度器 `createDrainScheduler`**（下沉 `src/shared/utils/drainLoop.ts`，纯协议无 DOM 依赖，
task/terminal 两域共用，避免跨 feature 引内部实现）：

- `pendingWake` 闩锁替代吞噬：draining 期间的 wake 记闩锁，循环退出后自动续跑一轮；
- `maybePending` 残留证据标志：仅当发生过「门闸早退」（`runDrainLoop` 以非 exhausted
  方式结束）或闩锁续跑时武装；`onWriteDigested` 仅在有残留证据且消化低于门闸时 kick，
  稳态零空转 invoke；
- 推进性论证：数据残留 ⇒ 必有（a）未来 wake（flag 保证）、（b）pendingWake 闩锁、
  （c）maybePending + 后续 digest kick 三者之一 ⇒ 循环必然再次启动，冻结不可能。

**Rust 侧**：

- `terminal_drain` 改 `async fn`：pull 移出主线程，消除放大器 A；
- `SessionDrain.closed` 标志：close 路径先 `close()` 再从 map 移除；closed 后 `push`
  吸收字节（返回 true 不缓冲）⇒ 孤儿 reader 读到 EOF 自然退出，不再永久停泊背压循环；
  `take_and_rearm` 在 closed 时返回空不再 re-arm；
- SSH `ChannelMsg::Data` 满载改为「拒收-停泊重试」契约（对齐本地泵，杜绝丢字节；
  input/resize 消息由既有 unbounded channel 缓存不丢失）。

**哨兵卫生**：effect cleanup 补 `clearStallWatch()`；`rebuildTerminal` 加 30s 冷却闸。

**B1 补迁**：`taskRunner.ts`（Task Console）与 `terminalFactory.ts`（editor-tab 终端）
从已消亡的 `terminal-output` 事件迁移到 drain 协议（经 scheduler，无门闸模式）。
