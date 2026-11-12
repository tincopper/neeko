# LSP 请求通道健全性：错误响应不得重启服务器

## Goal

把「服务器答了一个 JSON-RPC error」与「通道断了/服务器死了」彻底分开：前者是**请求级失败**，
必须原样上抛、不得触发整台服务器重启；只有后者才进重启预算。顺带修掉 id 空间、无界等待、
写失败泄漏与双终态写者。

## Background

来自 11-12 的 4 维审计（证据与行号见
`.trellis/tasks/11-12-lsp-graceful-shutdown/research/audit-channel.md` 与 `audit-orchestration.md`）：

- `session/request.rs:119` 收到 error response 就 `bail!`，`manager.rs:785` 把它当会话故障走重启；
  而**活会话不会重建**，只把 `restart_count` 加一，成功也从不回零 ⇒ 5 次普通错误
  （`-32602` 文档未打开、`ContentModified` 编辑中常见）之后该 `project:lang` **永久**报
  `Max restart count exceeded`，chip 却仍显示 Running、没有重试入口。每次失败还先睡 1→8s。
- 三套 id 生成器共用一张以 id 为键的 `pending` 表：`initialize` 用 `1`、`shutdown` 用 `1000`、
  业务请求用进程级自增（`request.rs:17/73`）。`insert` 静默覆盖同 id 条目 ⇒ 前一个等待者被
  drop（→ 误判「无响应」→ 触发上面的重启），或 shutdown 的 response 被投给业务 waiter。
- 业务请求 `rx.await` 无 deadline（`request.rs:98`）：服务器沉默时 Tauri 命令永不 resolve，
  `pending` 与 `inflight` 桶永久占用（非单飞方法的桶永不回收，唯一兜底是 reader 退出）。
- 写失败 `writer.send(...)?`（`request.rs:94`）早退，已插入的 sender 与已登记的桶都不摘除；
  下一次同类探针会把泄漏 id 当「前一条在途」发 `$/cancelRequest`。
- 握手失败有**两个**终态写者（reader 的 `on_reader_exit` + manager 装配失败分支）⇒ 同一故障
  前端收两条不同文案的 error，`outcome` 依赖线程写序。

## Requirements

- **R1**：`AppError::Lsp` 上必须能区分「服务器回错」与「通道不可用」；前者不重启、计数不增长。
- **R2**：重启计数改为**连续失败 streak**，任一次成功即清零；只有通道不可用时重建会话。
  `Max restart count` 命中后状态栏必须可见（不能只写 warn 日志，chip 仍显 Running）。
- **R3**：出站请求 id 由**唯一** allocator 分配（含 initialize / shutdown），`pending` 插入
  遇到已存在 id 必须报错或断言，不得静默覆盖。
- **R4**：业务请求必须有 deadline（客户端超时后摘 sender + 发 `$/cancelRequest`），与
  `send_shutdown_request_bounded` 的看门狗同一不变量；超时预算复用 `request_timeout_ms`。
- **R5**：`send` 失败走与成功等价的清理路径（`pending.remove` + `inflight.complete`）。
- **R6**：握手期终态只允许一个写者（装配未成功前 reader 不写该键终态），文案与 `outcome` 同源。

## Acceptance Criteria

- **AC1**：新测试断言「服务器回 `-32602`」不产生重启事件、`restart_count` 不变、错误原样上抛。
- **AC2**：连续 5 次 `ContentModified` 后该 key 仍可正常请求；一次成功后 streak 归零（有测试）。
- **AC3**：并发 1000 条请求后不存在 id 冲突（测试直接断言 allocator 唯一性 + `insert` 对重复 id 的行为）。
- **AC4**：沉默服务器下业务请求在预算内失败，且 `pending` / `inflight` 均已清空。
- **AC5**：`cargo test --lib lsp::` 全绿；既有 restart/backoff 语义测试不改判据。

## Out of scope

- 关闭序列本身（11-12 已完成）；`-data` 归属与崩溃文案证据（11-12 已记 out of scope）。
