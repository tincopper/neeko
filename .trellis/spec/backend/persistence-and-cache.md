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
