# 持久化与缓存基础设施

> `neeko.db` 是本应用的**共享 SQLite 库**。本文记录它的连接、迁移链与通用 KV 缓存契约。
>
> 落点：`src-tauri/src/common/db/`（池 + 迁移链分派）、`src-tauri/src/common/cache/`（KV 缓存）、
> `src/shared/cache/`（前端通用层）。
>
> 立文档的任务：`10-19-generic-sqlite-cache`（2026-10）。

---

## 0. 一句话形态

```
                  boot 期一次
                       │
        ┌──────────────┴──────────────┐
        │   common/db::open_pool()    │   ← 唯一池、唯一迁移链
        └──────────────┬──────────────┘
                       │  inject
        ┌──────────────┴──────────────┐
        │                             │
  LibraryStore                  CacheStore
  (library 域的表)               (cache_entries)
        │                             │
   skills/prompts/…              任何域的 KV（value 不透明）
                                       │
                              Tauri 命令（薄）
                                       │
                              shared/cache/（前端通用层）
                                       │
                        ┌──────────────┴──────────────┐
                   注释翻译                      文档翻译（二期）
```

**核心不变式**：`common/db` 不认识任何业务；`library` 与 `cache` 互不依赖，只共享池。

---

## 0.1 库目录可以隔离：`NEEKO_DB_DIR`（多 worktree / CI 必读）

`user_version` 是**整个文件一个整数**，不能协商：某个 build 把库迁到 v14 之后，早于它的
checkout 必须拒绝打开（`common/db/migrations.rs` 的 fail-closed 判据 —— 旧代码写新 schema 会
静默损坏数据）。所以「两个 worktree 共用 `~/.neeko/neeko.db`」等价于互相踢出局：

> 2026-10-30 实测事故：`multi-agent` worktree 的**未提交**迁移把 `LATEST_VERSION` 提到 14 并跑过一次，
> 共享库被升到 14；随后 main（支持 13）启动即 panic ——
> `Failed to create library store: Database schema version (14) is newer than this app supports (13)`。
> 恢复只需 `PRAGMA user_version = 13`（那条迁移是纯新增表且全 `IF NOT EXISTS`，两向安全）。

隔离旋钮（`common/paths.rs`）：

| 函数 | 目录 | 内容 |
| --- | --- | --- |
| `paths::app_dir()` | `~/.neeko/` | 无版本门禁的状态：`config.json` / `sessions.json` / 冷启动索引 / skills 仓库 / 用户工程 worktree |
| `paths::db_dir()` | 默认同 `app_dir()`，可被 **`NEEKO_DB_DIR`** 覆写 | `neeko.db` + `agent_sessions.db`（两个版本化库同目录，隔离单位是**目录**） |

```bash
# 一个 worktree 独占一套库（首次可从共享库拷一份，保留 library / skills 数据）
mkdir -p ~/.neeko-db-dev && cp ~/.neeko/neeko.db* ~/.neeko-db-dev/ 2>/dev/null
NEEKO_DB_DIR=~/.neeko-db-dev pnpm tauri dev
```

判据与例外：

- **覆写值必须是绝对路径**：相对路径会随 cwd 漂移（同一进程换目录就建出第二个库，那不是隔离是随机）；
  空值 / 相对路径一律当未设置并回退默认 —— 认不出覆写值就绝不把库放到意料之外。
- **只覆盖库目录，不覆盖整个 `~/.neeko/`**：`worktrees/` 是用户工程的真实 git worktree，路径已写进
  各自仓库与 session 记录；搬走整根目录会让它们落在「预期根之外」并触发路径守卫（红线 8 的同源校验）。
- 切换目录后 `agent_sessions.db` 也会跟着走；只搬 `neeko.db` 会让两库的 `user_version` 分别漂移。
- **不要**为此加自动搬迁逻辑：两个 build 争抢同一份数据比隔离更危险。

## 1. 库里有两个独立 SQLite 库（先认清再动手）

| 库 | 文件 | 迁移 | 状态 |
| --- | --- | --- | --- |
| library + cache | `~/.neeko/neeko.db` | `common/db/migrations.rs`（唯一链，`user_version`） | **本期已归一** |
| agent 会话 | `~/.neeko/agent_sessions.db` | `agent/chat/session_store.rs` 的**私有** `run_migrations` | **未归一，别动** |

改迁移相关代码前必须确认自己在哪条链上。`agent/chat/session_store.rs` 里有同名私有函数
`run_migrations`，它与 `neeko.db` 的链无关 —— 曾有把它误当同一条链的风险。

---

## 2. 迁移链：版本链唯一，SQL 归属分域

### 2.1 为什么必须这样分

`user_version` 是 SQLite 的**单值 pragma**，一个库文件只有一个版本号。物理上不可能让两个域
各自维护一条链。但如果把 `cache_entries` 的建表塞进 `library/migrations.rs`，会产生两个后果：

1. **表归属错乱**：`cache_entries` 与 skills/MCP 毫无语义关系，却由 library 域负责演进；
2. **依赖方向错**：cache 域若要自己迁移，就得依赖 library 域。

所以把**版本链**与**SQL 归属**解耦：

- 版本链（`LATEST_VERSION` + 循环 + 事务 + 超前拒绝）→ `common/db/migrations.rs`，**唯一一份**；
- 每一步的 SQL → 各自域的文件，`common/db` 按版本号分派。

### 2.2 落点

```
src-tauri/src/common/db/
  mod.rs            pub use open / open_in_memory / open_pool / 迁移入口
  pool.rs           DbPool 类型 + open_pool() + open_memory_pool()
  migrations.rs     LATEST_VERSION + run_migrations() 分派器

src-tauri/src/library/migrations.rs   step(conn, from) → 12 个私有 migrate_vN_to_vM
src-tauri/src/common/cache/migrations.rs   v12_to_v13（建 cache_entries）
```

### 2.3 分派器

```rust
pub const LATEST_VERSION: u32 = 13;

pub fn run_migrations(conn: &mut Connection) -> Result<()> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if current > LATEST_VERSION { bail!("…newer than this app supports…"); }
    if current == LATEST_VERSION { return Ok(()); }

    for version in current..LATEST_VERSION {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Exclusive)?;
        migrate_step(&tx, version)?;
        tx.pragma_update(None, "user_version", version + 1)?;
        tx.commit()?;
    }
    Ok(())
}

fn migrate_step(conn: &Connection, from_version: u32) -> Result<()> {
    match from_version {
        0..=11 => crate::library::migrations::step(conn, from_version),
        12 => crate::common::cache::v12_to_v13(conn),
        _ => bail!("unknown migration version: {from_version}"),
    }
}
```

### 2.4 三条硬约束

1. **签名是 `&mut Connection`** —— `conn.transaction()` 需要 `&mut`。旧实现用
   `execute_batch("BEGIN EXCLUSIVE")` 绕开，那等于手写事务管理，错误分支要自己 ROLLBACK。
   用 `Transaction` 后 drop 自动回滚。
2. **`LATEST_VERSION` 的修改必须与建表 SQL 同一次提交**。分开提交会出现「版本号说 v13、
   但库里没有那张表」的中间态，且升级路径已经跳过它。
3. **现有 12 步函数体不改**。迁移 SQL 是最不该顺手重构的东西。

### 2.5 WAL 下 `EXCLUSIVE` 的真实作用域（实测，别写错测试）

写过「EXCLUSIVE 阻止其他连接读」的测试，跑出来是**绿**。探针实测确认这是 SQLite 行为：

| journal_mode | EXCLUSIVE 持有期间，另一连接 `SELECT` |
| --- | --- |
| WAL | **成功** —— 读者拿迁移前快照 |
| DELETE | 失败（`DatabaseBusy`, database is locked） |

`neeko.db` 用 WAL，所以：

- **EXCLUSIVE 的价值在写侧**：阻止其他写者在迁移中途插入 DDL/DML；
- **读者不受影响，也不需要受影响**：WAL 的读者看到 begin 时刻的一致快照，不会看到半迁移
  schema。想「让读者也等」既做不到也无必要；
- **因此不要写「读者必须被拒」的测试** —— 那是错判据，绿得毫无意义。真正该钉住的是
  **每步原子性**：失败不推进 `user_version`、不留半张表（见 `atomicity_tests`）。

### 2.6 升级测试怎么写（AC3 的形态）

必须有真实 v12→v13 的升级用例，而不是只测「新库能建到最新」：

```rust
#[test]
fn upgrades_v12_database_preserving_library_data() {
    let dir = tempfile::tempdir().unwrap();       // 红线 13：路径由 tempdir 推导
    let path = dir.path().join("neeko.db");
    // 1) 手工跑 library 的 12 步 → user_version == 12
    // 2) 插入 skills / prompts / mcp_servers 各一行
    // 3) 跑新的 run_migrations
    // 4) 断言 user_version == 13、cache_entries 存在、三张表数据逐字相等
}
```

只测「新库能到最新」会漏掉迁移搬家的全部风险 —— 而搬家正是本类改动最容易破坏的东西。

---

## 3. 连接池

### 3.1 选型是硬约束（别随手 `cargo add`）

项目 `rusqlite = 0.32`，而 `r2d2_sqlite` 各版本对 rusqlite 硬绑定：

| r2d2_sqlite | 要求 rusqlite |
| --- | --- |
| 0.25 | ^0.32 ← **本项目的** |
| 0.26 | ^0.33 |
| 0.27 | ^0.34 |
| 0.30 | ^0.36 |
| 0.35 | ^0.40 |

`cargo add r2d2_sqlite` 默认装最新（0.35），会与现有 rusqlite 冲突。

**`r2d2` 必须单独声明为直接依赖**：只写 `r2d2_sqlite` 会报 `cannot find module or crate r2d2`
—— Rust 2018+ 不允许使用未在 `Cargo.toml` 声明的 crate，哪怕它是别人的传递依赖。

```toml
r2d2 = "0.8"
r2d2_sqlite = "0.25"
```

### 3.2 池解决什么、不解决什么

`Mutex<Connection>` 的问题不是「锁开销」，是**语义串行**：

| 操作 | Mutex 单连接 | 池 + WAL |
| --- | --- | --- |
| 两个读并发 | 排队 | 并行（WAL 读者不互斥） |
| 读遇到写 | 阻塞到写完成 | 读快照，不阻塞 |
| 两个写并发 | 排队 | **仍排队**（SQLite 单写者） |

第三行是关键：**池不能加速写**。它只让读不被写挡住。写密集场景该做的是批量合并，不是加池。

### 3.3 PRAGMA 必须放 `with_init`

```rust
pub type DbPool = Pool<SqliteConnectionManager>;

pub fn open_pool(db_path: &Path, max_size: u32) -> Result<DbPool> {
    let manager = SqliteConnectionManager::file(db_path).with_init(|c| {
        c.execute_batch(
            "PRAGMA journal_mode=WAL;\
             PRAGMA busy_timeout=7000;\
             PRAGMA foreign_keys=ON;",
        )
    });
    Ok(Pool::builder().max_size(max_size).build(manager)?)
}
```

`busy_timeout` / `foreign_keys` 都是**连接级** pragma，而池是**惰性建连接**的。只在
`build()` 之后设一次，后续新建的连接会静默失去超时与约束 —— 这是最容易踩的坑。
`journal_mode=WAL` 是库级（持久化在文件头），重复设无害。

**测试断言要用非默认值**：`rusqlite 0.32` 的 `busy_timeout` 默认就是 5000，断言 5000
时把 PRAGMA 删掉测试仍然绿（实测踩过）。本仓用 `7000`，让配置与库默认可区分。

### 3.4 内存库：`max_size(1)`

`SqliteConnectionManager::memory()`（r2d2_sqlite 0.25）内部是
`file:<uuid>?mode=memory&cache=shared`，**同一 manager 的连接共享**同一个库。
即便如此仍固定 `max_size(1)`：测试夹具需要确定性（不让第二个连接看到半写事务）。

`open_memory_pool()` 设的 pragma 必须与 `open_pool()` 对称 —— 夹具若把池交给第二个写者，
不能突然失去超时保证。

### 3.5 换池的做法：删字段，让编译器指认

不保留兼容路径。`conn: Mutex<Connection>` 一经删除，所有仍用 `self.conn` 的地方
**编译期全部报错** —— 这比人工数调用点可靠得多（本任务 77 处，形态零变体）。

```rust
// before（5 行 × 77 处）
let conn = self.conn.lock()
    .map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;

// after（1 行）
let conn = self.pool.get()?;
```

**一个池 per 数据库文件**：`AppStateWrapper` 从 `library_store.pool().clone()` 派生
`CacheStore`，不再新开第二个池。两个池意味着同一个句柄有两个所有者，且 `max_size` 不再约束任何事。

---

## 4. 通用 KV 缓存（`cache_entries`）

### 4.1 表结构与为什么

```sql
CREATE TABLE IF NOT EXISTS cache_entries (
  namespace TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,   -- 对后端不透明
  version   INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_cache_entries_lru ON cache_entries(namespace, at);
```

- **`value` 对后端不透明**：后端不做业务判断，序列化与校验归消费者。这样加一个消费者
  不需要改 schema、也不需要改后端代码。
- **`WITHOUT ROWID`**：主键就是查询路径（`namespace + key`），省一层隐式 rowid 索引。
- **`idx_cache_entries_lru(namespace, at)`**：`evict` 按此索引，否则退化成全表扫。
- **库表不得出现业务概念**：没有 `segment` / `profile` / `translation` 这类列名。

### 4.2 `version` 是读过滤条件，不是装饰

```rust
// 错：version 只写不读 —— 改规则后旧条目继续命中
WHERE namespace = ?1 AND key = ?2

// 对：version 参与过滤，换版本即整域失效，不需要迁移或删除
WHERE namespace = ?1 AND key = ?2 AND version = ?3
```

「改了 prompt / 校验规则但线上行为没变」是最难定位的一类 bug：没有任何报错，只是新逻辑
不生效。让 `version` 参与读取是唯一的结构性防御。

### 4.3 批量写必须单事务

```rust
let tx = conn.transaction()?;
{
    let mut stmt = tx.prepare_cached("INSERT OR REPLACE …")?;
    for (key, value) in entries { stmt.execute(params![…])?; }
}   // stmt 必须在这里 drop，否则 commit 报 "stmt is borrowed"
tx.commit()?;
```

两个易错点：

1. **`stmt` 必须在大括号内 drop**，否则 `tx.commit()` 报 `stmt is borrowed`；
2. **中途 `?` 提前返回 → `tx` drop → 自动 ROLLBACK → 整批零写入**。没有事务时，失败前
   已写的行会留在盘上，而调用方看到错误并认为什么都没落 —— 缓存静默持有截断的一批。

### 4.4 批量读要用一条语句

`get_many` 若按 key 逐个 `query_row`，前端 `load()` 一次要 5000 个 key 就是 5000 次语句执行
（在编辑器打开路径上）。用 `IN (...)` 一次查。SQLite 变量上限（老版本 999 / bundled 32766）
用 `chunks` 保守分块即可。

> **诚实标注**：本仓的 900 分块在当前 bundled SQLite（上限 32766）下并非必需 ——
> 去掉分块测试仍绿。它保留为防御，测试只声称「跨块算术正确」，不冒充「分块必要」。

### 4.5 事务次数的判别方式（`total_changes` 无效）

验证「批量写是一次事务而不是每条一次」，**不能用 `total_changes()`**：实测单事务写 3 条与
逐条各提交 3 条都报 `3`。要用语句跟踪：

```rust
conn.trace(Some(|sql| { if sql.starts_with("BEGIN") { count += 1 } }));
```

或用触发器注入中途失败，断言整批回滚（原子性）。

**注意 AC8 与 AC9 是两件事**：原子性测「失败时回滚」，一次事务测「成功路径只开一次事务」。
一个**永不失败**的逐条提交实现能通过原子性测试却违反一次事务。

---

## 4b. live-sessions 注册表的写穿策略（`agent_sessions.db`，2026-10-31）

`live_sessions::Registry` 是会话状态与标题的唯一内存事实，但它**不新开表、不新开库** ——
落盘复用 `agent/chat/session_store.rs` 的 `SessionStore`（与 `AgentChatManager` 同一个实例，
`AppStateWrapper` 注入时 `Arc::clone`）。新增一份「运行时状态表」等于让「哪些会话该恢复」
有两个答案，而两者会独立漂移。

### 4b.1 双向投影：`ResumeCursor::from_entry` / `into_entry`

`live_sessions/cursor.rs` 是**唯一**投影点（2026-11-05 起双向）：

**正向（运行时 → 持久化）**：只落**已出现在侧栏**的会话（`has_user_input`），chat 与
terminal（含纯 shell）一视同仁 —— 落盘的是**侧栏行**，不是「一个可恢复的进程」。行的字段 =
身份 + 标题 + 可见性 + 时间 + 原生恢复参数（`kind` / `project_id` / `worktree_path` /
`title` / `title_source` / `has_user_input` / `native_session_id`；`created_at` → `started_at`，
`last_activity` → `updated_at`）。

状态投影仍然是单向的词表映射（运行时 5 态 → 持久化 4 态）：

| 运行时（5 态） | 持久化 `SessionStatus`（4 态） | 理由 |
| --- | --- | --- |
| `Ready` / `Running` / `AwaitingApproval` | 同名 | 兼容既有 chat 恢复语义 |
| `Failed` / `Stopped` | `Closed` | 数据库不需要区分怎么结束的 |

**反向（持久化 → 运行时）**：`into_entry` 把行投影回 `SessionEntry`，且 `state` **固定为
`Stopped`** —— 启动时进程已经没了，凭空造一条 `Ready` 会话就是侧栏幽灵行。反向只用于
**回填侧栏列表**：不建 tab、不起进程、不 emit（`live_sessions::boot::restore` 在 `setup`
调用，前端挂载后自己拉快照）。不可读的行返回 `None`，判据只有一份
（[`ResumeCursor::is_restorable`]）：没名字、没单元、`Placeholder` 却带标题（损坏，不猜）。

投影穷举由 `every_runtime_state_projects_to_a_persisted_status` 与
`kind_and_title_source_maps_are_bijective` 钉住；全字段往返由
`entry_survives_a_projection_round_trip` 钉住。

### 4b.2 只覆盖创建期定格的字段

写穿前先 `load_cursor` 读回既有行，**只**保留 `model` / `runtime_mode`（其余字段——标题 /
可见性 / 地址 / 原生 id / 时间——以本次投影为准）。原因：`runtime_mode` 是用户在创建会话时
选的（如 `confirm`），用投影整体覆盖会把它静默改写回 `auto` —— 表现是「设置了一次，下次启动
又变回去」，而且没有任何报错（`persist_keeps_fields_the_registry_does_not_know`）。

### 4b.3 锁外落盘 + 失败只 warn

注册表锁内只做 map 操作与克隆（`concurrency-guidelines.md` 红线 3 口径）。**调用点只算
「是否变化 / 是否需要写」的结论，不携带快照**：`Registry::persist_entry` 在专用
`persist_gate: Mutex<()>` 内**重新**从内存投影再写。

这一层闸门不是装饰：同一会话有三个写者（Tauri 命令线程 / hook HTTP 线程 / chat 事件泵），
而 `store` 是阻塞 IO、不能放进 `sessions` 锁。若直接把锁内快照拿到锁外写，后拿到锁的写者
可能用**更旧**的快照覆盖用户改名 / `native_session_id`（只在重启后暴露）。闸门内重读让写入
顺序与内存顺序一致（全量快照，最后一次写必然包含此前全部变更）。`unregister` 的删除同闸：
否则一个在途旧快照会把刚删的行又写回去。写失败只 `log::warn!`：内存事实已是权威，让一次
磁盘抖动阻断状态转移只会把 UI 卡在旧状态。

### 4b.3b 写穿节流：只写「真的变了」的变化

两条分支的节流判据不同，因为调用频率差一个量级：

- **`apply` / `apply_activity`**（chat 事件泵、PTY 活动推断，高频）：只在 **`turn_count` 变化**
  或 **新状态是终态** 时落盘；`Running` / `AwaitingApproval` 中间态**不写**。
- **report 家族**（`report` / `report_first` / `report_user_input` / `report_terminal_input` /
  `report_authoritative` / `set_title`，每回合或每次用户提交一次）：真变化就写穿 —— 否则标题、`has_user_input`、
  `native_session_id` 永远进不了库（而它们正是重启后侧栏行与 `--resume` 的依据）。

`apply` 的调用点在 `agent_chat` 的 16ms 合帧 emit 闭包里（`tauri::async_runtime::spawn`
的任务内），每次转移同步写两次 SQLite 就是把这些阻塞调用压在异步执行器线程上（红线 3 取向）。
节流后每个回合只写一次，且语义对全部读者等价（`persist_is_throttled_to_reader_relevant_transitions`）。
report 家族的调用频率本身是「一回合一次」，无需再压。

### 4b.4 标题 / 可见性必须落盘（2026-11-05 改写）

旧结论「标题不落盘、反向投影不存在」已被用户实测推翻：应用退出后侧栏会话列表整片消失。
新契约（`prd.md` R7）：

| 事件 | 落盘 |
| --- | --- |
| 会话首次进入侧栏（`has_user_input` 置位 / 首次 Engage） | 建行（标题可能同批到达） |
| 标题升级 / 用户改名（`User` 来源） | 更新 `title` / `title_source` —— 用户改的名字必须活过重启 |
| `native_session_id` 回填 | 更新 —— 点击恢复的唯一入参 |
| 状态转移 | 沿用 §4b.3b 的节流 |
| `unregister`（用户删除 / 进程结束） | **DELETE** 行（不是标 `Closed`） |
| `begin_shutdown` 之后 | 只摘内存，**不删行**（退出不等于清空） |

**判据只有两份，各有名字，不要各自重写**：

| 名字 | 位置 | 回答的问题 |
| --- | --- | --- |
| **写门** `has_user_input` | `live_sessions::cursor::from_entry` | 这一行**该不该存在**（用户确实动过这条会话） |
| **读门** `ResumeCursor::is_restorable` | `agent::chat::session_store`（与类型同住） | 这一行**能不能投影回侧栏**（能定位单元 + 不是损坏行；**标题可以空**） |

`SqliteSessionStore::list_restorable` 的 `WHERE project_id != ''` 只是**粗筛**
（性能），必须是读门的**超集**；真正的过滤在 Rust 侧 `filter(ResumeCursor::is_restorable)`。
漏一行的代价是「重启后会话消失」，多放一行只是浪费一次投影 —— 所以判据只准往「漏」的方向
收紧，且只能改上面那一处。测试替身（`RecordingStore`）同样调读门，不重写规则
（`list_restorable_applies_the_rust_gate_on_top_of_the_sql_prefilter`）。

**标题可以为空**（第 35 轮）：可见性与命名是两件事。终端首条输入不再产生标题，无 hook 的
CLI 永远等不到名字；把 `title != ''` 当读门会让这些会话重启后整条消失。读门只拒绝
「无单元」与「`Placeholder` 却带标题」（损坏）两种行。

### 4b.5 退出抑制：`Registry::begin_shutdown`

`shutdown_background_and_exit` 第一行调 `begin_shutdown()`（`AtomicBool`）。之后任何清理路径
（`close_all_sessions` → `unregister`）只摘内存条目、不删持久化行 —— 否则「退出」会被写成
「用户删光了所有会话」，下次启动侧栏为空。崩溃 / 强杀天然满足（根本没走到 `unregister`）。

### 4b.6 列所有权：`ResumeCursor::with_creation_fields_of`

一行被两个域写：agent 域写**创建期定格**列（`model` / `runtime_mode` / `started_at`，来自
`build_resume_cursor`），live_sessions 域写**投影**列（标题 / 可见性 / 地址 / 原生 id / 时间）。

字段清单只写在 `with_creation_fields_of` 一处，两条写路径都必须成立：

1. `Registry::write_cursor` 在写盘前读旧值并调该函数（与具体 store 实现无关）；
2. `SqliteSessionStore::save_cursor` 的 `ON CONFLICT DO UPDATE` **不含**这三列。

护栏：`creation_fields_survive_both_write_paths`（纯函数 + SQL 两条腿）、
`persist_keeps_fields_the_registry_does_not_know`（注册表侧）。改任一处清单都会红。

### 4b.7 三个已知张力（增长 / 去留 / 阻塞写）

**① 增长路径（红线 4 / 16）**：行只在 `unregister` 时删除，关 tab 的行永久保留，
`restore_from_store` 启动全量读回，而 `list_live_sessions` 单次返回整份快照 —— 这是**唯一**
单调增长的 IPC 载荷。红线 16 已给出正确形状：不要加 `LIMIT` 裁掉可观测集合，而是
「至多 N 个**热**行，其余惰性可读」（进入单元时按需拉）。保留策略（N 天 / 每单元最近 K 条）
是产品决策，未定；在它定之前，不要在读取侧偷偷加截断。

**② 同一事实两种去留（故意）**：终端进程自己结束 ⇒ `on_exit` → `unregister` **删行**；
用户点 X ⇒ `close_and_notify` → **保留行**（`Stopped`，跨重启的「点回来」入口）。
两条都不是缺陷，但产品若要统一，先改 `natural_exit_deletes_the_row_while_an_explicit_close_keeps_it`
这条用例再改实现。

**③ 阻塞写的位置（红线 3）**：`rename_live_session` / `report_live_session_activity` /
`adopt_live_session` 是**非 async** 的 `#[tauri::command]`，其中的 SQLite 写在 IPC 线程上
同步执行（`save_cursor` = SELECT + UPSERT）。当前体量（一次改名 / 一次活动 / 一次恢复）
可接受；若将来变慢，正确改法是 `tauri::async_runtime::spawn_blocking`，**不要**加 `async`
关键字（那会把阻塞 IO 挪进异步执行器线程，正是红线 3 反对的方向）。

**④ hook 回落不扫盘、只补空名**：无 `topic` 且 registry 尚无真标题的 hook 才调
`ConversationManager::cached_title_for_native`（纯内存缓存读），不触发 conversation scan /
不读磁盘 —— hook 跑在阻塞池线程上也不能顺手加扫描；缓存新鲜度由既有 scan 链路负责。
已有 `Native` / `User` 标题时不再查缓存，避免扫描快照把事件时刻的名字改回旧值。

## 5. 前端通用层（`src/shared/cache/`）

### 5.1 能力归属：什么该在 shared，什么该在 feature

`PersistentKeyValueStore<T>` 的四个能力 —— port IO / 序列化+版本 / 显式 flush / 损坏降级 ——
**全是持久化后端职责，与任何业务无关**。它们最初写在注释翻译的 feature 里，导致第二个消费者
（文档翻译）要重写一遍，而降级策略写错会阻断主流程。

**判据**：一个能力是否只服务某业务？不是 → 上移 shared 并泛型化，业务类型与 `validate`
由消费者注入。

### 5.2 Port 是**条目粒度**，不是整份字符串

```ts
export interface PersistentCachePort {
  load(): Promise<CacheSnapshot<unknown> | null>;
  putMany(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void>;
  deleteMany(keys: readonly string[]): Promise<void>;
}
```

初版是 `read()/write(整份字符串)`，把「序列化整份缓存」焊进了调用方：文件后端能忍，
但 SQLite 会退化成「全表 DELETE + 全表 INSERT」，写放大且丢掉增量能力。

**接口形状决定后端能否用对。**

### 5.3 `flush` 只提交变更过的键

`set` / `setMany` 只置脏并记录 `pendingKeys`；`flush` 只写这些键。若 `flush` 写整张表，
会话越长单批写入越大 —— 正是条目粒度要避免的写放大。

**写失败必须保留 dirty**：清了 dirty 会让该批数据永不落盘，且表面没有任何错误。

### 5.4 `load()` 必须回查后端，不能只回放本地 key 集合

KV 层按 key 寻址，新进程不知道该问哪些 key。所以需要 `list_keys`（只返 key 不返
value，受 `maxEntries` 约束）来发现，再用 `get_many` 取 value。

**只记「本实例写过的 key」会让持久化形同虚设** —— 进程内缓存和磁盘缓存看起来都能工作，
只有重启后才暴露（本任务第一版正是如此）。

### 5.5 namespace 归 Port，不归通用层

通用层刻意不知道 namespace（它只是 KV store）。文件后端根本不需要它（一个文件就是一个
namespace），加进通用层会让文件后端多一个无谓约束。正确位置是 Port 构造参数。

### 5.6 `invoke` 只在 `api/`

`shared/cache/api/cacheApi.ts` 是唯一的 IPC 入口。shared 层的 IPC 入口不受
`src/features/*/api/` 的 ESLint 豁免，需要带理由的定向 disable（先例：
`shared/utils/errorReporting.ts`）。

---

## 5b. 纯 shell 终端输出日志（`terminal_history/`，2026-11-10）

与版本化 SQLite 库并列的**非版本化文件缓存**，按 `common/paths.rs::terminal_history_dir()`
落在 `db_dir()/terminal_history/`。

| 项 | 契约 |
| --- | --- |
| 单一所有者 | `common/terminal/history/store.rs::HistoryStore` 持有目录与全部文件 IO；目录**只在组合根** `app_state.rs` 解析一次，测试注入 `tempdir()`。`live_sessions` 域只依赖同目录 `contract.rs` 的 `SessionHistory` trait（依赖倒置），由组合根注入实现。 |
| 文件 | `<session_id>.log`，文件头 `NEEKO-SHELL-LOG-v2\n` + 净化后的纯文本（无 ESC）；原子写用 `<id>.log.tmp` + rename。无头 = 旧格式，读回降级为空 |
| 隔离 | 挂在 `db_dir()` 而非 `app_dir()`，所以 `NEEKO_DB_DIR` 覆写时日志随版本化库一起走 |
| 上限 | 写入侧 `recorder::tail` 按 `min(256KB, 5000 行)` 取尾，字节截断落 UTF-8 边界、行截断落 `\n` 之后 |
| 写线程 | `recorder::start_writer` 起独立 OS 线程；reader 侧 `try_send` 非阻塞，队列满丢最旧，**绝不反压 PTY 读泵**。生命周期靠 channel：reader 退出 → sender drop → 写线程 `finish()` + 最后落盘后退出 |
| 范围 | 只有 `LiveTerminal::is_plain_shell()`（`agent_id` 为空）才落盘；agent TUI 全屏重绘帧不可回放 |
| 回放准备 | `HistoryStore::prepare` 在 router 的 `run_blocking` 里执行（红线 3），返回 `HistoryPlan` —— 三端共用；`HistoryPlan::attach` 是「推进 drain + 起写线程」的**唯一接线接缝**，Local / WSL / SSH 共用。旧日志已读入内存，直接作新写线程初值，不再 `fs::copy`（少一次 IO、少一个竞态）。 |
| 回收 | `HistoryStore` 实现 `SessionHistory` trait 的 `on_adopt` / `on_unregister`；`Registry` 通过注入端口通知，不认识 terminal 域。GC `prune` 归组合根 `app/boot.rs::on_setup`，**不在 `boot::restore` 里** —— `restore()` 是纯回填，曾被塞进 GC 导致单测删光真实用户日志（现有 `restore_never_touches_session_history_side_effects` 护栏钉住）。 |

**回放分界文案**：`store.rs::REPLAY_SEPARATOR`（`pub(super)`，测试引用同一个常量，不在断言里
抄第二份）。它是**用户直接读到的终端输出**，所以用英文 —— 与「错误消息 / 日志字符串用英文」
同一条规则；中文在等宽终端里按 2 列/字计宽，窄终端或非 CJK 字体下会折行把分界框撑断。
格式：`\r\n─── end of previous output · this session starts below ───\r\n\r\n`，纯文本、不含 ESC。

**为什么 `prepare` 是单点**：三端对称要求同一份回放决策，且所有阻塞 fs 必须在 async command 之外。`router::prepare_history` 是唯一调用点，`is_plain_shell` 单点裁决（前端不再自己判 `agentId`），`HistoryPlan::attach` 是唯一接线接缝。新增传输类型只需接 `attach`，无需复制历史逻辑。

**为什么不进 `agent_sessions.db`**：日志无 schema 版本门禁，且是 256KB×N 的 BLOB，塞进会话库会撑大 WAL；独立文件让「没有 cursor 行」成为唯一孤儿判据。

**为什么不回放原始 PTY 字节**：alt-screen / `2J` / 光标寻址使字节流不是稳定快照（回放只剩末帧），体积无界；净化文本可读、体积可控、不受控制序列影响。纯 shell 首帧实测零 `2J`/`3J`/`?1049h`（`research/current-state.md` §7）。

**净化器是单行编辑器，不是逐字节过滤器**（2026-11-10 实测回归）：shell 的 prompt 重绘靠
`\r` 光标归位 + `ESC[K`/`ESC[J` 擦除 + 覆盖写。zsh `PROMPT_SP` 会先输出「反显 `%` + 79 个补白 +
`\r \r\r` + `ESC[J`」再写真 prompt。若把单独 `\r` 当换行、又保留本该被擦除的文本，回放会出现
孤立 `%`、成片空白行、重复 prompt 与半截命令（`ttop`）。正确语义：

| 输入 | 动作 |
| --- | --- |
| `\r` | 光标回行首（**不换行**），后续字符覆盖 |
| `\n` | 提交当前行，去尾部补白，追加 CRLF |
| `ESC[K` / `ESC[J` | 擦到行尾 / 清整行（参数 1/2 分别对应擦到光标 / 整行） |
| `ESC[G/C/D/P/@/X/H` | 设列 / 前后移 / 删字符 / 插空格 / 擦字符 / 设光标 |
| SGR / 私有模式 / OSC / DCS / charset | 忽略 |
| TAB | 展开到 8 列边界，保证光标列与显示列一致 |

没有 LF 的超长输出在内存里也按 `MAX_LOG_BYTES` 收敛，避免当前行无限增长。日志头带格式版本，
旧格式（逐字节过滤时代）读回直接降级为空，不回放垃圾。钉住用例：
`recorder::tests::zsh_prompt_sp_redraw_leaves_one_clean_prompt` /
`repeated_prompt_redraws_do_not_duplicate_lines` / `legacy_log_without_magic_is_ignored`。

**回放不走新 command**：`create_terminal_session(resumeFrom)` → router 一次 `prepare` → `HistoryPlan::attach(&drain, id)` 在 drain 创建后、reader 启动前 push 回放字节，复用二进制 `terminal_drain`。顺序由队列保证，不依赖前后端时序。`commands → router → manager → pipeline` 的启动参数收进 `terminal/launch.rs::TerminalLaunch` 值对象（IPC 边界保持扁平），新增字段只改一处。

**目录职责**：`history/` 按单一职责拆分 —— `sanitizer.rs`（纯 ANSI 行编辑器，无 IO）、`store.rs`（格式 / 路径安全 / 生命周期）、`writer.rs`（独立写线程）、`contract.rs`（依赖倒置接口）、`tests.rs`。`mod.rs` 只做声明与 re-export（红线 9）。`MAX_LINE_CHARS` 与 `MAX_LOG_BYTES` 分开：前者限制 `Vec<char>` 当前行，后者限制落盘字节，避免中文 3 字节/字导致内存峰值 3×。

## 6. 常见坑（都实际踩过）

| 坑 | 症状 | 正确做法 |
| --- | --- | --- |
| 只在 `build()` 后设 PRAGMA | 池新建的连接失去 `busy_timeout`，写冲突直接 `SQLITE_BUSY` | 放 `with_init` |
| 断言 pragma 的默认值 | 删掉 PRAGMA 测试仍绿（5000 是 rusqlite 默认） | 用非默认值（7000） |
| `version` 只写不读 | 改规则后旧缓存继续命中，无任何报错 | 读取时过滤 version |
| `flush` 写整张表 | 会话越久单批写入越大 | 只提交 `pendingKeys` |
| 写失败也清 `dirty` | 该批数据永不落盘，且无错误 | 保留 dirty，下次重试 |
| 靠本地 key 集合做 `load()` | 重启后缓存全 miss（持久化形同虚设） | 后端 `list_keys` 枚举 |
| 用 `total_changes` 测事务次数 | 单事务与逐条提交都报 N，无法区分 | 用 `trace` 数 `BEGIN` |
| 写「EXCLUSIVE 阻止读者」的测试 | WAL 下恒绿，毫无判别力 | 改测每步原子性 |
| `set` 不 `await` 就 `flush` | `flush` 先跑、`set` 后置脏 → 该批永不落盘 | `await store.set(...)` 再 `flush` |
| 两个池指向同一文件 | 同一句柄两个所有者，`max_size` 不再约束 | 从已有 store 派生 `pool().clone()` |
| `LATEST_VERSION` 与建表分开提交 | 版本说 v13 但表不存在，升级路径已跳过 | 同一次提交 |

---

## 7. 验证清单（改这块时逐条过）

- [ ] `LATEST_VERSION` / `run_migrations` 定义唯一（`grep -rn "pub fn run_migrations" src/`）
- [ ] `Lock poisoned` 在改用池的文件里零出现
- [ ] 老库升级测试：真实 v12 库 → 升到最新 → 业务表数据逐字不变
- [ ] 并发用例：写事务进行中读者能完成（WAL + 池的直接验证）
- [ ] 批量写：中途失败整批零写入（原子性）+ `trace` 数 `BEGIN` 为 1（一次事务）
- [ ] `evict` 按 `at` 保留最新 N 条，其他 namespace 不受影响
- [ ] 前端：新建 store 实例能读到上一个实例写的条目（跨进程语义）
- [ ] `pnpm check` 全绿；`cargo clippy --all-targets -D warnings` 零 warning
- [ ] **每条护栏用例做变异验证**：把实现改坏，它必须红
