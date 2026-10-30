# 设计：opencode v1/v2 双存储读取

> 需求见 `prd.md`，执行序见 `implement.md`。

## 0. 第一性原理：谁是权威

会话数据的拥有者是 agent，Neeko 只读。v2 升级后**同一个文件里存在两份历史**：
`session_v2`/`session_message`（v2 之后唯一被写入的）与 `session`/`message`/`part`（迁移快照）。
由此推出：

- **C1 权威由「谁还在被写」决定，不由版本号决定**。Neeko 拿不到 opencode 版本，也不该拿
  （红线 10 的同源风险：按版本分支等于把「agent 内部实现」写进通用模块）。可用的事实只有
  「这套表存在吗、有数据吗」。
- **C2 同一 DB 只读一套**。混读会把迁移快照里的孤儿会话（v2 已删除/未迁移的 6 条）当成活会话，
  也会让计数与正文来自不同来源 ⇒ 列表与正文互相矛盾。
- **C3 判据必须两向安全**：判成 v2 而 v2 还空着（迁移未跑完）= 历史被隐藏；判成 v1 而 v2 已在用
  = 新历史被隐藏，且删除后行会复活。所以判据是
  `session_v2` 与 `session_message` 表都存在 **且 `session_v2` 非空** → V2，否则 V1。
  两侧的最坏情况都是「显示旧数据」而不是「显示不存在的数据」。

## 1. 能力面与代码结构

adapter 契约不变（`parse_all_metas(_for_project)` / `parse_meta` / `parse_messages` /
`extract_session_id` / `resume_command` / `delete_*`）。变化只在 adapter 内部：由 `Store` 分派。

```
adapters/opencode.rs            adapter + v1 读取（原样保留）+ 分派
adapters/opencode/store.rs      open_detected(path) -> (Connection, Store)；SQLite 侧文件指纹
adapters/opencode/v2.rs         v2 读取（新）+ v2 夹具测试
```

为什么不用 `agent_id ==`/版本分支：存储形态是 adapter 的知识，分派点只有一个（`store::detect`），
新增 v3 时只加一个变体与一个读取模块，manager/命令层/UI 零改动（开闭原则）。

## 2. 读取映射（v2 → 既有类型）

```rust
// 可见性判据（列表计数与正文解析共用同一实现，§4.6.3 的结构性保证）
fn is_turn(kind: &str, data: &Value) -> bool {
    match kind {
        "user" => data["text"].as_str().is_some_and(|s| !s.trim().is_empty()),
        "assistant" => data["content"].as_array().is_some_and(|a| !a.is_empty()),
        _ => false,   // system / synthetic / compaction / idle / *-switched
    }
}
```

块映射（与 v1 的 part 映射同形，前端配对管线不变）：

| v2 项 | 块 |
| --- | --- |
| `{type:"text",text}` | `Text{text}`（并拼进 `content` 扁平文本） |
| `{type:"reasoning",text}` | `Thinking{thinking}` |
| `{type:"tool",id,name,state}` | `ToolUse{id,name,input=state.input}` + completed ⇒ `ToolResult{content = state.content[*].text 拼接}`；error ⇒ `ToolResult{content=state.error,is_error=true}`；其他状态只有 `ToolUse` |

- 排序：`ORDER BY session_message.seq ASC`（v2 里 `seq` 是 `(session_id,seq)` 唯一索引，比时间戳权威）；
  输出 `ParsedMessage.seq` 仍是 `enumerate()` 序号（与 v1 一致 —— 前端只把它当渲染/定位 key，
  契约允许不连续，改成 DB seq 会让两条路径行为分叉）。
- 预览：`ORDER BY seq DESC LIMIT 5` 后反转，只取文本项（user 的 `text`、assistant 的 `text` 项拼接），
  空文本跳过。工具输出与 thinking 不进预览（红线 4）。
- 单会话 meta：一次 `session_v2` 行 + 同一 `is_turn` 判据的 `COUNT`，保证与列表徽标同源。

## 3. WAL 指纹（第二个独立缺陷）

`scan_cache::source_signature` 只看主文件 `(len, mtime)`。SQLite WAL 模式下提交先落 `-wal`，
主文件在 checkpoint 前不变 ⇒ 批量元数据缓存返回旧快照，「新会话不出现」在修完表结构后仍会出现。

修法：`source_signature_with_sidecars(path, &["-wal"])` —— 把主文件与侧文件的 `len` 求和、
`modified` 取最大；只有一个文件存在时行为与 `source_signature` 相同。
只给 opencode adapter 用（它知道自己是 SQLite），`scan_cache` 保持通用（不 sniff 扩展名）。

## 4. 权衡与被否方案

| 方案 | 否掉的理由 |
| --- | --- |
| 按 opencode 版本号分支 | Neeko 不持有版本事实；用户可能用 `OPENCODE_CONFIG_DIR` 指向旧库；版本与库状态不同步 |
| v2 表存在就读 v2（不看是否为空） | 迁移未跑完时历史被整体隐藏 —— 正是本次事故的形态 |
| v2 与 v1 结果合并去重 | 会复活 v2 已删的孤儿会话；计数/正文来源不一致 |
| 直接写 `session_message` 的 `seq` 当 `ParsedMessage.seq` | 与 v1 路径行为分叉（前端 paging/搜索按 index 语义校验）；契约本就允许不连续，但没必要引入差异 |
| 读 v2 的 `part` 表 | v2 不再写它；新会话里没有任何 `part` 行 |
| 顺手收紧工具输出长度 | 与 v1 现状不一致会制造两条路径的差异，且属另一件事（红线 4 的单项治理） |

## 5. 风险与回滚

- 判据误判 → 最坏是显示旧数据（C3）；`store::detect` 有 3 条用例钉住三种状态。
- v2 里出现未见过 `content` 项类型 → 该块被忽略但消息仍保留（与 v1 忽略未知 part 一致），
  计数不受影响（判据只看 `content` 是否非空）。
- 回滚粒度：`store.rs` + `v2.rs` 是新文件，删掉并把 `opencode.rs` 的分派改回直调 v1 即回滚；
  WAL 指纹是独立性改动，可单独回退。
