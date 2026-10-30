# 执行计划：opencode v1/v2 双存储读取

> 需求见 `prd.md`，设计见 `design.md`。TDD：每项先写失败用例（Red）→ 实现（Green）。
> 阶段独立可回滚；v1 的 SQL 与映射不动。

## P1 · 判定与骨架（Rust，纯函数优先）

- [x] 1.1 `adapters/opencode/store.rs`：`Store{V1,V2}` + `open_detected(path) -> (Connection, Store)`
      + SQLite 侧文件指纹。
      **Red**：三种状态（v2 有数据 → V2；只有 v1 表 → V1；`session_v2` 空 + v1 有数据 → V1）。
- [x] 1.2 `adapters/opencode.rs` 分派：`parse_all_metas_for_project` / `parse_meta` /
      `parse_messages` 三处按 `Store` 分流；v1 代码以既有实现为准（仅抽公共 open）。
      **Red**：v1 夹具经分派后结果与改前一致（既有用例不改编即可覆盖）。

## P2 · v2 读取（Rust）

- [x] 2.1 `adapters/opencode/v2.rs` 列表：`parent_id IS NULL AND time_archived IS NULL`，
      `ORDER BY time_updated DESC`，项目过滤（`directory` 等值或前缀），`title` 可空。
      **Red**：子会话 / 归档 / 项目过滤 / 空标题四条。
- [x] 2.2 计数与预览：`is_turn` 判据（user `text` 非空、assistant `content` 非空）统一给
      列表计数、单会话计数、正文解析三处；预览只取文本项。
      **Red**：`meta.message_count == parse_messages().len()` 对每个夹具会话成立；
      `system`/`compaction`/`idle` 不计数；工具输出不出现在预���。
- [x] 2.3 块映射：`text`→Text、`reasoning`→Thinking、`tool` completed→ToolUse+ToolResult 成对、
      error→`is_error=true`、pipeline 状态只有 ToolUse。
      **Red**：逐条断言；变异验证（把 `name` 读成 `tool` → `ToolUse.name` 断言红）。
- [x] 2.4 `parse_meta`（单会话）走 v2 版本，计数与列表同源。
- [x] 2.5 验证：`cargo test --lib conversation`；`cargo clippy -D warnings`。
- **回滚点 A**。

## P3 · WAL 指纹（Rust）

- [x] 3.1 `scan_cache::source_signature_with_sidecars(path, &["-wal"])`：len 求和、mtime 取最大；
      无侧文件时等于原函数。
      **Red**：只写 `-wal` 时指纹变化；只写主文件时也变化；没有侧文件时与 `source_signature` 相同。
- [x] 3.2 opencode adapter 的批量元数据缓存改用该指纹。
- **回滚点 B**。

## P4 · 收尾

- [x] 4.1 真机核对（临时探针，跑完删除）：`store=V2`、顶层 473 条、`/…/neeko` 前缀 **227** 条
      （冷启动索引修前 184 条 / 最新 09-28），最新 **2026-10-30**；抽查 4 条会话
      `message_count == parse_messages().len()`（18/33/4/10）。
- [x] 4.2 同步 spec：`backend/conversation-adapter.md`（§4.3.2 opencode 行改双存储、§4.6.3 计数
      来源、§4.7 删除里 opencode 的「v2 权威」一句）。
- [x] 4.3 `pnpm check:quick`（收尾跑一次）+ `cargo test --lib`；`add_session.py` 记录；**不主动提交**。
