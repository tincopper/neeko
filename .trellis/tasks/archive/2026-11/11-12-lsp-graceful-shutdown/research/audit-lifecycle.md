# LSP 进程与关闭生命周期审计（11-12）

| # | 位置 | 问题 | 判据（何时坏、坏成什么样） | 建议 | 类别 |
| --- | --- | --- | --- | --- | --- |
| 1 | `app_state.rs:126` + `shutdown.rs:26` | 退出清理把 `kill_all_live`（整树 SIGKILL）与 `close_all_sessions` 并行跑，两机制争同一进程所有权 | LSP 声明 `kill_tree` ⇒ 存活期恒在收敛表（`types.rs:137`）；SIGKILL 毫秒到、checkpoint 要秒 ⇒ **每次退出都截断**，是最高频的重演路径；`concurrency-guidelines.md:759` 要求它先跑，与 `lsp-domain.md` §2b 冲突。复现：开 Java 项目→退出→`.metadata/.log` 无正常关闭记录 | 串行化：先 join LSP，再 `kill_all_live`；或收敛表加 owner 维度 | 真缺陷 |
| 2 | `session/instance.rs:831` | `initialize` 握手无超时，`blocking_recv()` 只由「进程死」解锁 | 服务器活着但沉默（jdtls 等 `-data` 锁、自定义 server 不答 LSP）⇒ 创建线程永久阻塞并占住创建闸（`manager.rs:561`），每次重试再吃一个 spawn_blocking 线程 ⇒ 前端永停 `starting`、无错误可重试。复现：`command` 改 `sh -c 'sleep 9999'`，重试 10 次=10 个僵线程 | 握手加插件数据超时，超时即 kill+报错 | 真缺陷 |
| 3 | `manager.rs:925` + `commands.rs:38` | `close_session` fire-and-forget，而所有 LSP 命令都 `ensure_session_async` 懒重建 ⇒ stop 后立刻重开=双服务器 | §2b 的理由「stop 单向、调用方不立刻重建」被证伪：旧 jdtls 仍在 10s 宽限内，新 jdtls 立刻 spawn 抢同一 `-data` 锁，叠加 #2 即永久卡死。复现：状态栏 Stop→在已开的 `.java` 敲键 | 按 key 落 closing 闩，创建等它收口（同重启路径） | 真缺陷 |
| 4 | `manager.rs:909` vs `:561` | 关闭不取创建闸、无墓碑 ⇒ 创建中的会话收不到关闭 | 首次建会话耗数十秒（install/import）期间点 Stop 或停用定时器到期 ⇒ 事后 `insert`（`:677`）把已被要求关闭的会话发布出去，它活着并持 `-data` 锁。复现：首次启动 jdtls 期间点 Stop，会话照样出现 | 创建完成核对最近的关闭代，命中即 kill 不入库 | 真缺陷 |
| 5 | `manager.rs:1103` | 3s 退出预算是「每步」不是「总计」 | 同一 `budget` 被响应等待与退出等待各花一次 ⇒ 单会话可达 6s，兜底 `kill_child` 还在 deadline 之外 | 传绝对 deadline，每步 `min(grace, 剩余)` | 真缺陷 |
| 6 | `manager.rs:1105` | 退出只枚举 store，在途关闭不留痕 | stop/停用/重启已摘除会话但序列仍在阻塞线程跑 ⇒ 此刻退出直接 `process::exit(0)`，在 checkpoint 窗口内 SIGKILL（与 #1 独立的第二条截断路径） | 记录在途关闭任务并按同预算 join | 真缺陷 |
| 7 | `common/executor/ssh.rs:336` | 远端 `kill_tree` 回退语义错：组杀失败时只杀 bash | `kill -9 -pid` 依赖远端 shell 是组长；失败回退只杀 bash ⇒ JVM 成孤儿继续持远端 `-data` 锁，无复核 | 组杀后 `kill -0` 复核，失败改 `pkill -P` 杀后代 | 真缺陷 |

## 附录（已记录 / 可接受）

- 串行关闭 `N×2×grace`、预算耗尽硬杀、`grace` 取自 `LspServerTuning`：`lsp-domain.md` §2b 已记录。
- `grace` 兼作响应超时（响应慢会吃 checkpoint 窗口，与 #5 耦合）；`deactivate_gens` 只增不删、每次 deactivate 留一个 30 分钟任务；每会话 3 线程 + 4 任务、无 stdin 背压 —— 可接受。
