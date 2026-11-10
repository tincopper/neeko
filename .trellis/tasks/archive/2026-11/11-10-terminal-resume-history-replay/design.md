# 技术设计：纯 shell 终端输出落盘与回放

> **第二版**：需求已从「回放 agent CLI transcript」更正为「回放纯 shell 终端的命令与输出」。
> 前一版 design（按 sessionId 新增 command 读 transcript、前端 `term.write`）整份作废。

## 1. 一句话架构

reader 线程把 PTY 输出**净化成纯文本**后经旁路写盘（每会话一个滚动截断的日志）；恢复时 `create_terminal_session` 按 `resumeFromSessionId` 读日志，把字节**推进新会话的 drain**，复用现有二进制 drain 通道成为 xterm 的第一批数据。零新 Tauri command、零前端 `term.write` 改动、零布局改动。

## 2. 边界

| 归属 | 职责 |
| --- | --- |
| `common/terminal/history/`（新目录，单一所有者） | `sanitizer.rs` 纯 ANSI 净化、`store.rs` 格式 / 路径安全 / 生命周期 / `HistoryPlan`、`writer.rs` 独立写线程、`contract.rs` 依赖倒置接口；`mod.rs` 只做声明与 re-export（红线 9） |
| `common/paths.rs` | 新增 `terminal_history_dir()` = `db_dir()/terminal_history` |
| `terminal/services.rs` | `spawn_reader_thread` 的 `flush` 增加旁路 sink；只对纯 shell 会话启用 |
| `terminal/commands.rs` / `manager.rs` | `create_terminal_session` 增 `resume_from`，`spawn_pty_pipeline` 前把历史字节 push 进新 drain |
| `live_sessions/registry.rs` | `adopt` / `unregister` / `restore_from_store` 的日志迁移与回收 |
| `features/terminal/` | `createSessionVal` / `taskTerminal.ts` 把 `resumeFromSessionId` 透传到 `create_terminal_session` |
| `conversation` 域 | **不改、不依赖** |

不新增 Tauri command、不新增 IPC 事件名（红线 5）、不改 `SessionView` wire 形状、不改 drain / backpressure 主干、不改 `fitAddon`、不改 DOM。

## 3. 数据流

**写入侧（纯 shell 会话运行期间）**
```
PTY reader 线程 (services.rs:427, 专用 OS 阻塞线程)
  → flush(:457)
      ├─ activity.observe          （现状，不动）
      ├─ SessionDrain::push        （现状，不动）
      └─ recorder::sink.try_send(bytes)   ← 新增：无锁、非阻塞
             → mpsc → 独立写线程（批量）
                    → 净化（strip CSI/OSC/charset/alt-screen，\r→\r\n）
                    → append 到 db_dir()/terminal_history/<session_id>.log
                    → 按 min(256KB, 5000 行) 取尾滚动截断
```

**回放侧（用户点侧栏恢复）**
```
sessionTabFactory.ts → createTerminalTabIn({ resumeFromSessionId, agentId: null })
  → TerminalViewBase.tsx:275 createSessionVal(..., resumeFrom)
  → terminal/commands.rs create_terminal_session(resume_from)
      → router → manager.create_session → spawn_pty_pipeline:
          1. drains.insert(newId)（services.rs:160）
          2. HistoryStore::prepare(resume_from) → HistoryPlan（seed = 旧日志正文，不再 copy 文件）
          3. recorder::read_tail(from) → replay_payload → drain.push(回放字节)
          4. recorder::start_writer(dir, newId) → 独立写线程
          5. spawn_reader_thread（:202）→ 输出排在回放之后
  → 前端 drainTerminal(newId) 拿到 [回放 | 分隔线 | 新 shell 输出]
  → onSessionCreated → adoptLiveSession(from, newId)
      → registry.adopt 成功后 recorder::remove(from)（旧日志）
```

### 为什么「推进 drain」而不是前端 `term.write`

`manager.rs:144 spawn_command` 在 invoke 返回前就启动了 shell；前端 `onSessionCreated`（`TerminalViewBase.tsx:285`）触发时首帧已进 drain。把回放字节在 `spawn_pty_pipeline` 之前 push 进同一个 drain，**顺序由队列本身保证**，不依赖前后端时序，也不用新增 command。旧 id 没有 drain（`router.rs:242` 按 `owner_of` 查），所以必须推进**新** drain。

## 4. 契约

### 4.1 recorder（Rust，新模块）

```rust
// common/terminal/history/{sanitizer,store,writer}.rs
pub const MAX_LOG_BYTES: usize = 256 * 1024;
pub const MAX_LOG_LINES: usize = 5000;

/// PTY 原始字节 → 可回放的纯文本（纯函数，可直测）。
/// 剥离 CSI / OSC / charset / alt-screen / 其它 ESC 序列；\r → \r\n；
/// 保留可见文本与 \n；超长行不单独截断（由 tail 统一收敛）。
pub fn sanitize(bytes: &[u8]) -> String;

/// 按字符边界取尾，控制在 MAX_LOG_BYTES 与 MAX_LOG_LINES 之内。
pub fn tail(existing: &[u8], appended: &[u8]) -> Vec<u8>;

/// 回放载荷 = 历史正文 + 一条分隔线。
pub fn replay_payload(log: &[u8]) -> Vec<u8>;

/// 流式**单行编辑器**：跨 chunk 保留半截 ESC 序列 / UTF-8 字节 / 当前行 / 光标列。
/// `\r` 归位（不换行）、`\n` 提交行、`ESC[K/J` 擦除、`ESC[G/C/D/P` 移光标/删字符。
pub struct Sanitizer { pending: Vec<u8>, line: Vec<char>, col: usize }
impl Sanitizer {
    pub fn new() -> Self;
    pub fn feed(&mut self, bytes: &[u8]) -> String;
    pub fn finish(&mut self) -> String;
}

/// 实际实现形态（**用 channel 生命周期替代显式 stop**）：
/// reader 线程持有 SyncSender，退出时 sender drop → 写线程收到 Disconnected
/// → finish() + 最后一次原子写后自行退出。不需要 JoinHandle，也不会漏调清理而泄漏线程。
// 单一所有者 HistoryStore（目录由组合根注入）
pub struct HistoryStore { dir: PathBuf }
impl HistoryStore {
    pub fn prepare(self: &Arc<Self>, resume_from: Option<&str>) -> Option<HistoryPlan>;
    pub fn prune(&self, live_ids: &HashSet<String>);
}
impl SessionHistory for HistoryStore { /* on_adopt / on_unregister */ }

// 三端共用的单次决策结果与唯一接线接缝
pub struct HistoryPlan;
impl HistoryPlan {
    pub fn attach(&self, drain: &SessionDrain, session_id: &str) -> Option<Recorder>;
}

/// resume_from 来自前端，拼进文件名前的安全校验（红线 8）：
/// 仅 ASCII 字母数字 / `-` / `_`，长度 ≤128；非法 id 一律不碰文件系统。
pub fn is_safe_session_id(session_id: &str) -> bool;
```

- **净化器不复用 `conversation/text.rs:31 strip_ansi`**：它是 `pub(crate)` 内部实现（`conversation/mod.rs:16`），跨域直引违反模块防火墙，且只覆盖纯 CSI（不覆盖 `?1049h` / OSC / `\r`）。参照前端 `shared/utils/stripAnsi.ts:29` 与 `inputTitle.ts:145` 的跨块解析判据，在 Rust 侧自己实现。
- **写盘不拖慢读泵**：`flush` 只做 `try_send`（无锁、非阻塞）；净化、拼接、截断、落盘都在独立写线程。红线 3 只禁 async Command 内直接阻塞，PTY reader 用 `std::thread` 是既有约定（`concurrency-guidelines.md:691`）。
- **背压**：mpsc 有界；队列满时丢最旧的 chunk（历史是「尽力而为」的回放，不能反压 PTY 造成卡顿或死锁）。
- **原子写**：tmp + rename，参照 `conversation/disk_index.rs:72 save_index`，避免崩溃留下半截日志。

### 4.2 后端命令参数

```rust
#[tauri::command]
pub fn create_terminal_session(
    // ...既有参数（cols / rows / cwd / command / agent_id ...）
    resume_from: Option<String>,   // 新增：旧 session_id，仅纯 shell 恢复时传
) -> Result<TerminalSession, AppError>
```

- 命令层仍保持极薄（红线 6）：把 `resume_from` 透传给 `manager.create_session`，业务逻辑在 `manager` / `recorder`。
- 只有 `agent_id` 为空（纯 shell）且 `resume_from` 有值时才启用 recorder 与回放；agent TUI 完全不碰这条路径。
- Tauri 自动 camelCase ↔ snake_case；前端传 `resumeFrom`。

### 4.3 前端透传

- `features/terminal/api/taskTerminal.ts` 的 `createSessionVal` 增可选 `resumeFrom`，透传到 `invoke('create_terminal_session')`。
- `TerminalView.tsx` 已有稳定的 `resumeFromSessionId` 读取（`fullTabData`），下传给 `TerminalViewBase`；**用 `useRef` 锁首次值 / 不进主 effect 依赖数组**，避免 `handleSessionCreated` 一次性消费标记后触发 cleanup + PTY 重建（前一版 design 已识别的陷阱，仍适用）。
- `TerminalViewBase` 不改 `writeChunk`、不改 `term.write` 调用点。

### 4.4 生命周期迁移

| 事件 | 位置 | 动作 |
| --- | --- | --- |
| `adopt(from, into)` | `live_sessions/registry.rs`（`write_entry`、`delete_cursor`） | 经注入的 `SessionHistory::on_adopt` 回收旧资源；新日志由 `HistoryStore::prepare` 的 seed 生成，`adopt` 失败时不触发本事件，旧文件仍可再次恢复。 |
| `unregister` | `registry.rs:459` → `session_store.rs:442 delete_cursor` | `recorder::remove` |
| 用户删除行 | `app/session_lifecycle.rs:47 delete_live_session` | 随 `unregister` 删除 |
| 启动 GC | `app/boot.rs::on_setup`（组合根） | `HistoryStore::prune(live_ids)`；`boot::restore()` 是纯回填，零 IO。 |
| 应用退出 | `begin_shutdown` | **不删**（`unregister` 在退出流程只摘内存、不删行；日志同理保留） |

- `adopt` 只接受终止态 `from`（`registry.rs:340`）；失败时 from 行仍在，日志保持在旧 id，新会话不写历史（降级，AC8）。

### 4.5 回放载荷

- 上限 256KB（与 `drain.rs:31` 分离态尾容量一致），**不经 JSON**：`terminal_drain` 走 `tauri::ipc::Response`（红线 4 只限 JSON 6× 膨胀），无需分页。
- 单次 `term.write` 巨载荷会撞 `TerminalViewBase.tsx:41` 的 12s stall 自愈，故不取 512KB。
- 末尾追加一条纯文本分隔线（`─── 以上为历史回放 · 以下为本次会话 ───\r\n`）与若干空行，把历史顶进 scrollback。
- 内容是净化后的纯文本，不含 ESC ⇒ 新 shell 首帧只能追加，不会抹掉 scrollback（纯 shell prompt 不发 `2J`/`3J`，见 research §7）。

## 5. 关键技术决策

1. **落盘净化文本，不是原始字节**：原始字节含全屏重绘 / 光标寻址，回放会只剩末帧；体积无界；还可能被 `2J`/`3J` 清空。净化文本可读、体积可控、不受控制序列影响。
2. **文件而非 DB 表**：日志无 schema 版本门禁，`agent_sessions.db` 的私有迁移链只为 `session_cursors` 补列（无第二张业务表先例）；独立文件避免把 256KB×N 的 BLOB 塞进会话库、避免 WAL 膨胀。代价是需要显式生命周期迁移与孤儿清理（§4.4 已列全）。
3. **放 `db_dir()` 而非 `app_dir()`**：`NEEKO_DB_DIR` 只覆 `db_dir()`（`common/paths.rs:44`），与版本化会话数据同隔离单位，符合 `persistence-and-cache.md` §0.1 的「隔离单位是目录」。
4. **只对纯 shell 落盘**：agent TUI 输出几乎全是重绘帧（实测 pi 启动 4 秒 293KB），存下来也不可用；且用户明确限定范围。判据用会话的 `agent_id`，不写 `agent_id == "…"` 分支（红线 10）。
5. **回放走 drain，不走新 command**：顺序由队列保证，零新增 IPC 面。
6. **失败全降级**：无日志 / 读失败 / 写失败 / 非纯 shell → 照常新建终端，不弹错、不留空白区（与 `resumeLaunch` 既有「拿不到就退回新建」同口径）。

## 6. 兼容性

- `create_terminal_session` 新增**可选**参数：所有既有调用方不传即行为不变（WSL / SSH 路径同样不受影响）。
- `SessionView` / `TerminalTabData` wire 形状不变；`resumeFromSessionId` 一次性消费语义不变。
- 无数据库迁移、无新表、无 `user_version` 变更。
- `--resume` / `adopt` / `drain` / `terminalCache` 主干不动。
- 旧版本（无 recorder）的会话没有日志 ⇒ 恢复时降级为空终端，不报错。

## 7. 回滚

- 前端：不传 `resumeFrom` 即回到现状；删掉 `createSessionVal` 的透传即可。
- 后端：`create_terminal_session` 的 `resume_from` 无调用方后摘除；`recorder` 无调用方后删模块与目录。
- 日志文件可整体删除（纯缓存，删了只是失去回放）。
- 无 schema 残留，回滚不留痕迹。

## 8. 待验证假设（实现第一步）

1. ~~**A0'**~~ **已验证（PASS，2026-11-10）**：真实 PTY 下 zsh / bash 首帧零 `2J` / `3J` / `?1049h`，只有 `?2004h` / `?1034h` 等无害私有模式；净化文本回放不会被抹掉。证据见 `research/current-state.md` §7 A0'。`spawn_pty_pipeline:160/202` 的窗口也已在代码中确认。
2. ~~drain 提前创建~~ **已确认**：`services.rs:160` 插入 drain，`:202` 才启动 reader，窗口存在。剩余待验证的是 256KB 单次 `term.write` 是否触发 12s stall。
3. 256KB 单次 `term.write` 在目标机器上是否触发 `TerminalViewBase` 的 12s stall；必要时降到 128KB 或分片（分片需保证仍早于 reader 首帧）。
4. `adopt` 之后 `TerminalView.tsx:73` 消费标记的时机与 `create_terminal_session` 读取日志的先后（跨进程时序，需用集成测试钉住）。
