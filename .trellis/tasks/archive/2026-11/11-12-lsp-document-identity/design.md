# 设计：LSP 文档身份（重启不再丢登记与所有权）

## 0. 边界

`src-tauri/src/lsp/{session_store,manager,commands}.rs` + 前端 `src/features/lsp/api/**`
（删死 wrapper）。不动 `session_key` 语义、不动事件名、不动 `open_docs` 的存储结构。

## 1. 缺陷形状（证据：归档任务 `research/audit-channel.md` D7/D8、`audit-contracts.md` #2/#5）

```
重启路径 ──► close_session(key) ──► remove(session)
                                   ├─ clear_open_documents(key)   ← 重放的数据源被清掉
                                   └─ editor_owned.remove(key)    ← 所有权守卫失效
           ──► 新会话建好 ──► reopen_documents(...) → 恒 0 条（死代码）
```

两个后果：

1. **诊断消失**：服务器端该文档不在了，编辑器也不会重发 didOpen → hover / definition /
   诊断都没有，直到用户编辑（didChange 才把文档带回服务器）。
2. **未保存缓冲区被覆盖**：`editor_owned` 被清 ⇒ 后端认为「没人在编辑」⇒ 下一次
   `ensure_document_open` 按**磁盘文本**代开 ⇒ 服务器算出的坐标与编辑器文本错位
   （`lsp-domain.md` §7.5 记录过的事故形态）。

## 2. 目标形态

### 2.1 拆开「摘会话对象」与「清键级状态」

`session_store` 现在只有一把 `close_session`（三件事一起做）。改为两把：

```rust
/// 摘除会话对象。**保留** open_docs / editor_owned —— 重启是替换，
/// 新服务器需要同一批文档（否则重放是空的、所有权守卫也失效）。
pub(crate) fn take_session(&self, key: &str) -> Option<LspSession>

/// 摘除会话 + 清空该键的文档登记 / 编辑器所有权 / restart streak —— 会话「就此结束」。
pub(crate) fn close_session(&self, key: &str) -> Option<LspSession>
```

`manager::take_for_close(notice)` 的映射：

| notice | 入口 | 用哪个 |
| --- | --- | --- |
| `Announce` | 用户 stop / 项目停用 | `close_session`（清空，行为不变） |
| `Silent` | 重启 / 崩溃重试 | `take_session`（保留登记与所有权） |

**注意 streak 的连锁**：`close_session` 里的 `clear_restart` 是「用户 stop = 从头开始」的语义。
重启走 `take_session` 后不再清零 —— 与 11-12 刚立的「重启是同一故障 episode 的延续」一致，
但 `manager` 里那句「`close_session_for_restart` 内部会 `clear_restart`」的注释必须同步改掉
（`set_restart_count(prev+1)` 仍是绝对值写入，语义不变）。

### 2.2 `reopen_documents` 保持单写点

`manager.rs:671` 的调用点不变（新会话建好后重放）。它现在有数据可放了。
重放走 `send_did_open`（唯一出口），版本取登记表里的值 + `next_open_version` 的单调推进。

### 2.3 `didChange` 让登记表与服务器同源

生产路径上 didChange 只从 `commands.rs::lsp_transport` 的通用转发出去（前端 wrapper
零调用），所以在那里拦截：

```rust
if method == "textDocument/didChange" {
    // 全量同步（contentChanges 里没有 range）→ 文本 + 版本都可信；
    // 增量同步 → 只能推版本，文本标记为陈旧（重放时打 warn，不假装文本是新的）。
    state.lsp_manager.record_document_change(&project_path, &language_id, uri, version, full_text);
}
```

`session_store` 增加 `update_open_document(key, uri, version, full_text: Option<&str>)`：
命中条目 → 推版本；`Some(text)` 时同时替换文本。未登记（例如前端在 Neeko 之外打开的文档）
→ 不造条目（登记表只记录我们确实 didOpen 过的文档）。

### 2.4 删除死 IPC 面

`lsp_open_document` / `lsp_change_document` / `lsp_close_document`（`commands.rs:118-196`）
与前端 `lspOpenDocument` / `lspChangeDocument` / `lspCloseDocument`（`lspApi.ts:47-99`）零调用，
且 `lsp_open_document` 是 didOpen 的**第四个出口**（绕过 `send_did_open` 的「重复先补 didClose」）。
直接删除；didOpen/didClose 只经 `lsp_transport` → `send_did_open` / `unregister_open_document`。

> 判据：`lspApi.ts` 里不得再出现这三个名字；Rust 侧无对应 `#[tauri::command]`。
> 若将来确实要「后端主动开文档」，走 `ensure_document_open`（它已经处理所有权与版本）。

## 3. 失败与边界矩阵

| 场景 | 期望 |
| --- | --- |
| 重启（登记表有 2 个文档） | 新会话 `reopen_documents` 重放 2 条 didOpen，版本 ≥ 旧版本 |
| 重启后编辑器发 didChange | 登记表版本前进（全量同步时文本也更新） |
| 重启后未编辑就 hover | 不复用磁盘文本（`editor_owned` 仍为真）→ 直接用服务器端已有文档 |
| 用户 stop | 登记表与所有权清空（下次打开走 didOpen，版本从 `next_open_version(None)=0` 起） |
| 增量 didChange 后重启 | 重放用**最后一次全量文本** + 打 `warn` 说明文本可能陈旧（不假装新鲜） |
| 未登记的 uri 收到 didChange | 不造条目（登记表 = 「我们 didOpen 过的文档」） |

## 4. 权衡

| 选择 | 代价 | 为什么仍选它 |
| --- | --- | --- |
| 拆成 `take_session` / `close_session` 两把 | 多一个 API | 把「替换」与「结束」的区别从调用方注释变成**类型选择**；否则下次还会有人用错 |
| didChange 在 `lsp_transport` 拦截 | 命令层多一个分支 | 那是生产唯一路径；放在 `send_notification` 里会让所有内部通知都过一遍解析 |
| 增量同步只推版本 | 重放文本可能陈旧（有 warn） | 后端无编辑器缓冲区，重建全量文本要靠前端重发 didOpen（已记 out of scope） |
| 删死 IPC 而不是让它委托 | 删掉三个「看起来有用」的命令 | 零调用 + 绕过唯一出口 = 定时炸弹；需要时用 `ensure_document_open` |

## 5. 兼容与回滚

- 无 wire / 事件名 / 前端行为变化（删的三个 wrapper 零调用）。
- 回滚 = revert 单个 commit；回滚后重启再次丢登记表（回到本 bug）。
- 风险：重启后重放 didOpen 会给服务器多发几条消息（预期行为），大工程多开文档时重放开销
  与「用户逐个编辑触发 didChange」相当。
