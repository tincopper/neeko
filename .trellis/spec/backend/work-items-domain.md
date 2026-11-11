# 工作项域（Work Items / Local Provider）

> 统一任务中心（Tasks）的 Local Provider：本地工作项的 CRUD、阶段轨、执行记录。
>
> 落点：`src-tauri/src/work_items/`（types / store / manager / commands / mod）。
> 设计契约：`.trellis/tasks/07-26-unified-task-hub/design.md` §3.1 / §3.2.1 / §3.4 / §8 / §11.5。
> 立文档的切片：2026-11-02（`work-items-core` + `provider-local`）。

---

## 1. 分层与谁有判据

| 文件 | 只有这些职责 | 明确**不**在这里 |
| --- | --- | --- |
| `types.rs` | 数据 + 纯函数（阶段轨派生、枚举 ↔ 落库文本、载荷截断） | 阶段流转的**判定**、持久化 |
| `store.rs` | `v17_to_v18` + SQL CRUD | 业务判断（"谁能改 stage"） |
| `manager.rs` | 唯一写入口：校验、时间戳、流转合法性、`NotFound` 判定 | IPC、SQL 细节 |
| `commands.rs` | 接收参数 → 线上字符串 → 枚举的转换 → **入口政策**（只有 `single` 能落库）→ 调度 manager（红线 6） | 业务校验、合并、默认值 |

判据与 `agent/team` 同一套：**两份判断迟早会分叉**。所以 `store` 层的 `update` / `delete`
故意返回 `bool`（是否命中一行），由 manager 决定那是不是 `NotFound` —— `UPDATE` 打到 0 行
在 SQLite 里也是成功，静默丢掉一次写入是最难查的一类缺陷。

---

## 2. 迁移（v17 → v18）

- 建表 SQL 在 `work_items::store::v17_to_v18`，版本链在 `common/db/migrations.rs`
  加一行分派 —— **两份必须同一次提交**（见 [persistence-and-cache.md](./persistence-and-cache.md) §2.4）。
- 版本号只有 `LATEST_VERSION` 一个来源。**不要再写 `assert_eq!(version, 17)` 这类字面量**：
  每次 bump 都会变成一条要手工追的债（本切片顺手还掉了 `agent/team/store.rs` 里的 3 处）。
- `CREATE TABLE IF NOT EXISTS` 的必要性：`ALTER TABLE ADD COLUMN` 不幂等，而
  `CREATE TABLE IF NOT EXISTS` 可以手工重放。判据：`migration_step_is_idempotent`。
- 表：`work_item` + `work_item_run`（后者 `ON DELETE CASCADE` 到前者；池里 `foreign_keys=ON`）。

---

## 3. 跨栈契约（三条，改任一条都是改 IPC）

### 3.1 可空字段的「清空」用空值表达

Tauri 的**扁平**参数解码区分不了「没传」与「传了 `null`」——两者都落 `Option::None`。
所以「不改」与「清空」必须用不同形状表达：

| 字段 | `undefined`（缺键） | 空值 | 备注 |
| --- | --- | --- | --- |
| `priority` | 不改 | `''` = 清空 | 前端类型**必须**允许 `''`，否则编辑对话框发不出清空 |
| `assignee` | 不改 | `''` = 清空 | 空白也算清空（`non_empty` 先 trim） |
| `labels` | 不改 | `[]` = 清空 | 整批替换，不是合并 |
| `title` | 不改 | `''` = **拒绝**（`InvalidInput`） | 必填 |
| `body` | 不改 | `''` = 清空正文 | 正文不 trim（首行缩进有意义），所以 `''` 是唯一能表达「空正文」的值 |

前端对应 `UpdateWorkItemParams`（`src/features/work-items/types.ts`）的联合类型里带 `''`。
**不要**为了"类型干净"把 `''` 去掉 —— 那会让「清空负责人」在类型层就发不出去，而 UI 表面无错。

### 3.2 `ref` 是 Rust 关键字，线上键仍是 `ref`

```rust
// WorkItemRun
#[serde(rename = "ref")]
pub run_ref: RunRef,
```

`WorkItemRun` 指针字段在 Rust 里叫 `run_ref`，**IPC 与前端一律读 `ref`**。改这个键名等于改契约
（`design.md` §3.4 与前端 `types.ts` 都按 `ref` 写）。改前先 `grep -rn "\"ref\"" src/`。

### 3.3 阶段轨的边只有一个产生点

`StagePlan::from_stages()` 是**唯一**派生函数：相邻两两、双向（跨阶段直达会让「经过 Review」
变成一句没人执行的承诺，design §11.5 的灰色圆）。`can_transition` / `neighbors` / 前端
`stageNodes` 都是它的消费者 —— 前端**查 `transitions` 表，不从 `stages` 自己推**：
将来后端允许跳级时，前端不需要改一行。

`manager::stage_plan()` 是命令出口与校验判据的**同一份**来源（关联函数而非方法：判据与哪个
manager 实例无关）。

---

## 4. 本域**不**做的事

| 不做的 | 原因 |
| --- | --- |
| 认识第三方 provider（GitHub/Linear…） | 那些 DTO 属于 provider 层，映射到本模型而不是相反；本地模型背着 `reviewDecision` 等于把 MVP 外的能力写进 schema |
| `import crate::agent::team` | 执行域的完成权威在团队板，本域只存指针 + 快照（design §3.4）。反向依赖会让「团队删掉后 hub 仍能渲染」变成空话 |
| 执行域明细（成员 / 团队任务 / transcript） | 红线 4：`work_item_run` 只存 `{mode, ref, snapshot}`，一行一条摘要 |
| 自定义阶段轨持久化 | 当前只有 `DEFAULT_STAGES`；`stage` 是自由文本（不是枚举），所以将来加"可配置轨"是加表 + 加一个 `from_stages` 调用点，不需要改枚举 |

---

## 5. 执行记录的写入面（`work_item_run_record`，2026-11-02 上线）

`WorkItemManager::record_run` 原先「有实现无入口」，现已由命令
`work_item_run_record` 开放（写入方 = `run-single`）：读侧 `work_item_run_list` + 详情「执行」区同期落地，
读写对称。

### 5.1 **只接受 `mode = single`**（本期政策，不是领域限制）

| 档 | 写入面 | 原因 |
| --- | --- | --- |
| `single` | ✅ `work_item_run_record` | 一次已起来的 agent 会话，写一条指针即可 |
| `team` | ❌ 拒绝（`InvalidInput`） | 还没有写入方：`run-team` 依赖 `10-30` 收尾 + `start_team_session` 的 `initialPrompt`。放开的后果**不是一条脏数据**，而是让 UI 可以伪造一条「已派给团队」的记录 —— 详情面板只会照着它渲染 mode 徽标与状态 chip，用户无从分辨 |
| `flow` | ❌ 拒绝（`InvalidInput`） | 连引擎都没有，没有可指向的 run |

拒绝消息写的是「尚未实现」（`run mode \`team\` is not implemented yet: only \`single\` runs can be recorded`），
而不是「你写错了」—— 这是能力缺失，不是调用方的参数错。`run-team` 落地时**不会**放宽这里，它会走自己的
命令（派给团队还要起队、起队长会话、过准入，远不止插一行记录）。

### 5.2 两条附加判据（都在命令层，不在 manager）

- **档位与指针必须配对**：`single` 只能指 `ref.kind = session`。一条「single 档指向团队」的记录跳不到任何地方，却在列表里宣称已派给团队。
- **`ref_id` 不得为空**：空指针 = 一条永远跳不过去的记录（[Open] 变成死按钮）。

这两条是**入口政策**，所以住在 `commands.rs` 的 `record_run_for`，不污染 manager：未来的 team / flow
写入方调 manager 时不该被「只有 single」这条判据拦住。

### 5.3 参数名 `run_state`（不是 `state`）

`state: tauri::State<AppStateWrapper>` 已经占用了 `state`，而**命令参数名就是线上键**。两个 `state` 无法共存：
前端传的执行状态会被当成应用状态，真正的参数则永远解码成缺失。所以线上键是 `runState`（Rust 侧 `run_state`）。
这条已由 `workItemsApi.test.ts`（前端）与 `record_run_for` 的用例双向钉住。

### 5.4 `single` 档的 `ref.id` = **终端 tab id**

PTY session id 在 tab 挂载时才生成、应用重启 / 终端重建后不复存在；tab id 由 `createTaskTerminal`
**返回**（端口内部 mint，`null` = 配额满），从建 tab 那刻就存在、`activateTab` 据此定位。
注意边界：**关掉 tab 后该 id 就再也指不到东西**（编辑器 tab 不跨重启持久化），所以 `session` 档的跳转
必须按「tab 还在不在」渲染（关掉 → `disabled` + 「该会话已关闭」），不能假设它永远可跳。
跳转目标的 tabKey **必须**走 `activeWorkspaceSession(projectId).key`，不自己拼。
tab 已被关掉时按钮 `disabled` + 「该会话已关闭」，不弹错、不隐藏（design §4.6）；`team` / `flow` 一律不给跳转按钮（没有目标）。

---

## 6. 测试判据（改这块时逐条过）

- [ ] `migration_step_is_idempotent`：v17→v18 的手工重放不炸
- [ ] `fresh_database_migrates_to_latest` 的表清单含 `work_item` / `work_item_run`
- [ ] 真实旧库升级路径：v12 库升到链尾后 `work_item` 存在、library 行逐字不变
- [ ] `app_state::tests::work_item_manager_is_wired_on_a_v18_migrated_pool`：
      组合根借的池**确实跑过** v18（借池不借迁移 = 第一次写就 `no such table`）
- [ ] 删除工作项 → 它的 run 一并消失（CASCADE 实测，不靠假设）
- [ ] 生产路径零 `unwrap` / `expect`（测试模块之外）
- [ ] `work_item_run_record` 已注册进 `neeko_invoke_handler!`（漏了只在**前端**表现为 `command not found`）
- [ ] `mode = team` / `flow` 被拒且消息含「not implemented」（被拒的写入不留任何记录）
- [ ] 记录的 `ref.id` 就是刚建的那个终端 tab（不是 PTY session id、不是空串）
- [ ] `cargo test work_item` + `cargo clippy --all-targets -D warnings` 绿
