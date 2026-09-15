# 执行计划：Java Debug 双后端

> 里程碑顺序按三轮第一性原理复核确定，取舍原则是**最便宜、不确定性最高的验证最先做**：
> - 第 1 轮：原「M0 配置键与路由骨架」拆为 M0（契约解耦）与 M1。
> - 第 2 轮：新增 S0 真机原型 spike（go/no-go）；M0/M1 判据去重（能力探测取代通知订阅）。
> - 第 3 轮：**S0 提到最前** —— S0 不需要任何生产代码，却是否决 M0/M1/M2 的最便宜闸门；若 no-go，先做 M0 则重构完全白做。S0 通过后才执行 M0。
> - 第 4–5 轮（业界对照 + D1–D8 采纳）：M2 增**选择器不变式**（launch 前语义校验 / launch 后 0 用例硬失败）、**参数构造单点化**、**bundle pin + 校验**、`updateBuildConfiguration` 保持 `interactive`；M3 增"确认 A 无自动调用路径"；M4 改「静态 terminal 一次性询问 + 其他报错给显式入口」（取消自动降级）；新增「后续（不在本期）」收录服务端选择器 / Run 统一 / SSH 转发。
> - 第 6 轮（实现前提复核）：**M0 缩小为"外部端点会话入口"**（不触碰 5 处共享 spawn 面）；M1 增 **LSP 在途 progress token 跟踪**；M2 增 **前端门控修正**（`jdtls`/`auto` 必须跳过 `dapCheckAdapter('java')`，否则 B' 永不启动）与**失败诊断入口**；S0 增 **轴 ② 需求 checkpoint**（不需三项增量则改走中间档）。

## 执行状态（2026-09-13 完成）

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| S0 真机 spike | ✅ **GO** | Phase 1 + Phase 2 全绿：bundle 注入 → `startDebugSession` → DAP 直连 → `launch` → **断点命中** → 栈/作用域/**求值** → `terminateDebuggee` 杀掉 JVM。握手确认 `LaunchBeforeBreakpoints`。详见 `research/jdtls-debug-spike.md` |
| M0 外部端点会话入口 | ✅ 完成 | `DapSession::start_with` / `connect`、`transport::connect_tcp_addr`、`cfg.request` 驱动命令名；共享 spawn 面未动；单测齐 |
| M1 配置键、能力端口、路由骨架 | ✅ 完成 | `dap.javaBackend` 权威读取、能力端口（dap 定义 / lsp 实现）、LSP 在途 progress token、`plan_java_debug`（可无 `AppHandle` 单测）、前端门控修正 + 下载/重启/重试闭环、Settings Debug 分区 |
| M2 JDTLS 实现（B'） | ✅ 完成 | `bundles` 注入（会话创建时求值）+ bundle pin/下载/SHA-256 校验；launch 载荷三约束（`args` 字符串 / launcher 前置 / `projectName`）；选择器不变式 ①②；模块根与聚合根守卫；SSH 显式拒绝；失败文案指向 LSP 日志 |
| M3 A 收尾 | ✅ 完成 | `target/classes` 前置、聚合根拒绝、产物缺失时**一次性** `test-compile`、SSH 显式不支持；classpath 分隔符按**目标环境**派生（`classpathSeparatorFor`，见 `shared/utils/javaClasspath.ts`）；A 路径本身零改动 |
| M4 auto/UX 收尾 | ✅ 完成 | 三态 UX、后端**常驻标注**（`jdtls` / `host` / `host (fallback)`）、求值输入按能力禁用、降级记忆（仅项目会话）与「重试 JDTLS」入口、warming 文案明确"再点 Debug 即重试" |

**未覆盖（唯一项）**：WSL 回环端口可达性 —— 本机无 WSL 环境，结论待补（Local 已验证；SSH 已显式拒绝）。

## S0 真机原型 spike（R9，go/no-go，不写生产代码，产物只有结论）

> 目的：把 B' 依赖的外部事实前置验证。可用一次性脚本 / 临时分支 / 手工 `curl`+`mvn`+`java` 组合，**不得**并入生产代码。

* [ ] bundle 热装：`initializationOptions.bundles` 指向 `com.microsoft.java.debug.plugin` 后，`workspace/executeCommand{vscode.java.startDebugSession}` 能返回端口。
* [ ] `vscode.java.resolveClasspath(testClass, projectName, "test")`：Maven 单模块返回非空；多模块以 `projectName` 消歧成功；记录 import 未完成时的返回形态（确认可作 `Warming` 判据）。
* [ ] `launch{mainClass:ConsoleLauncher, classPaths, modulePaths, args}` 能起被测 JVM 且断点命中 + 变量展开 + 求值可用。
* [ ] `shortenCommandLine` 是否被 `com.microsoft.java.debug.core` 接受（接受则固定 `argfile`）。
* [ ] `classPaths` 同时含 console-standalone 与项目自带 junit 引擎的实际行为（重复引擎 / 版本偏差）。
* [ ] WSL（或明确记录"本机无 WSL 环境，结论待补"）：`127.0.0.1:<port>` 是否可达。
* [ ] `disconnect{terminateDebuggee:true}` 后被测 JVM 是否退出。
* [ ] **plugin 来源（D5）**：先验官方 Maven Central jar，再验 Zed fork（pin 0.53.2），比较二者在 `launch` 路径的行为差异；
  判据是**行为**而非"官方优先"；官方不可用则直接采用 fork（禁止自建 fork）。Zed **弃用官方改用自家 fork**
  是"上游可能不够用"的一手证据，结论必须进 go/no-go。
* [ ] **classpath 新鲜度（D6）**：`resolveClasspath` 是否返回陈旧结果；是否需要 `vscode.java.buildWorkspace` 预刷新。
* [ ] **选择器不变式可行性（D1）**：确认"0 用例"的可靠可观测证据（Console Launcher 输出 / `--reports-dir` XML），
  以及 `documentSymbol` 能否稳定给出"类/方法是否存在"。
* [ ] **服务端选择器成本（D1③）**：记录引入 java-test bundle 的真实代价（30 jar、无 Maven 坐标、需自 VSIX 提取或自建），
  作为独立后续任务的决策输入（不阻塞本任务）。
* [ ] **轴 ② 需求 checkpoint（第 6 轮，必须显式判断并写入结论）**：列出 A 与 B' 的用户可见差异
  （求值表达式 / 跨库源码查找 / HCR；断点、步进、栈、变量 A 全有），判断是否属本期真实需求。
  **若否 → 停止 M0/M1/M2，改走中间档**（保留 A 引擎 + `resolveClasspath` 喂 classpath），本任务收缩。
* [ ] 产出 `.trellis/tasks/<本任务>/research/jdtls-debug-spike.md`（目录不存在则创建）：逐项结论 + **go/no-go**。
* 决策：
  * **go → 依次执行 M0 → M1 → M2 → M3 → M4 → M5**。
  * **no-go → 跳过 M0/M1/M2**（不做契约改造、不做能力探测、不做 B' 实现），仅保留 M3（A 的 bugfix 与 SSH 显式不支持）+ 文档收敛，并同步更新 prd / design。
  * **轴 ② checkpoint 判定"不需要" → 同样跳过 M0/M1/M2**，改走中间档（保留 A 引擎 + `resolveClasspath` 喂 classpath），另立任务或收缩本任务范围。

## M0 外部端点会话入口（R8，硬门槛，S0 go 后执行；未完成不得进入 M2）

> 第 6 轮缩减：**不改造共享 spawn 抽象**（`AdapterSpawn` / `AdapterProcess` / `AdapterTransport` / `connect_transport` / `resolve_spawn` 签名全部不动），
> 改为给会话层加一条外部端点入口 —— go / lldb / A 三条既有路径逐字不动，回归面最小。

* [ ] `DapSession` 拆分：`start_with(io: DapIo, guard: Option<ProcessGuard>, …)`（共享尾部：建会话、`Arc::new_cyclic`、proc_out 泵、handshake、失败清理）；`start(…)` 保持原签名 = 现有前半段 + `start_with(io, Some(guard), …)`。
* [ ] 新增 `DapSession::connect(addr, …)`：`transport::connect_tcp_addr(addr)` + `start_with(io, None, …)`，**跳过 `is_available` 与 `pre_launch_task`**（可用性由 M1 能力探测负责）。
* [ ] 新增 `transport::connect_tcp_addr(addr) -> Result<DapIo, AppError>`：直连、`proc_out_rx` 空通道、`stderr_buf` 空、无 kill 信号；`connect_transport` 不动。
* [ ] 后端形态改由配置驱动：`launch_request_command(cfg: &LaunchConfig)` 返回 `cfg.request`（Go / Lldb 恒 `"launch"`）；`JavaAdapter` 的 `build_launch_args` 据 `cfg.request` 分支。
* [ ] 单测：`start_with` 传 `None` guard 时会话可建、`stop()` 不 terminate；`launch_request_command` 三分支（go/lldb/java 的 launch 与 attach）；`connect_tcp_addr` 失败返回 `AppError::Dap`。
* [ ] 回归：go / lldb / Java-A 三条路径行为与文案不变（严禁出现 `program:""` 哨兵或假管道）。
* 验证：`cargo test --manifest-path src-tauri/Cargo.toml` + `pnpm lint`。

## M1 配置键、能力端口与路由骨架（TDD）

* [ ] 后端 `dap.javaBackend` 读取纯函数（`pointer("/dap/javaBackend")`，缺键/非法→`auto`）+ 单测（缺键/auto/jdtls/host/非法 5 分支）。
* [ ] dap 侧窄端口 `JavaDebugCapabilityProvider` + 三态类型（`Ready` / `Warming` / `Unavailable{reason, staticallyDetectable}`，reason ∈ `LspUnavailable|BundleMissing|ProbeFailed`）+ 环境判定纯函数（Local true、WSL/SSH 按策略）+ 单测（各态构造与 `staticallyDetectable` 分类：无 JDK21/未安装 → true，其余 → false）。
* [ ] lsp 侧实现探测：`startDebugSession` 成功即 Ready 前提、`resolveClasspath`（两段）非空即 Ready；**空值须交叉判定**——有进行中 import 进度才 `Warming`，无进度则 `Unavailable(ProbeFailed)` 直接报错（对齐 VSCode/Zed 的硬报错可预测性）；未知命令即 BundleMissing；单测（mock 命令返回：成功/空+有进度/空+无进度/未知命令/其他错误 5 分支）。
* [ ] `AppStateWrapper` 注入该端口；dap 单测注入 fake（禁 dap 直接持有 `LspManager`）。
* [ ] **LSP 在途 progress token 跟踪（第 6 轮补）**：会话内维护 token 集合（`begin` 加入 / `end` 移除，`report` 只更新），
  并暴露"该 project+language 是否有在途 import 进度"的查询供探测使用（现有 `notify.rs` 只转发事件、不保留状态）+ 单测（begin→end→清空 / 多 token / 无 token）。
* [ ] `DapManager::start_java_debug(target, mode)` 路由骨架（`host` 直达 A / `jdtls` 与 `auto` 共用可用性判定、**均不自动切换引擎**；`auto` 仅把 `staticallyDetectable` 透传给前端供其决定询问或报错）——**探测立即返回，单次 invoke 内不做长时间等待** + 单测（三态 × 两 mode × 静态/动态 terminal）。
* [ ] 前端 `JavaDebugBackend` 类型 + `debugJavaStart` wrapper（`{project_id,cwd,test_class,method,project_name,mode}` → `{kind:"session"|"warming"|"unavailable", reason?, staticallyDetectable?}`）+ Settings 三选 UI + dispatch hint 读取（mock invoke 单测）。
* 验证：`cargo test dap:: lsp::` + `pnpm test:run features/dap features/lsp` + `pnpm type-check`。

## M2 JDTLS 实现（B'）

* [ ] `JavaAdapter` 接入外部端点路径：`launch_request_command(cfg)` 返回 `"launch"`、`build_launch_args` 组 launch 载荷、manager 经 `DapSession::connect(addr, …)` 起会话（不 spawn、`guard=None`）+ 单测（形态 shape）。
* [ ] `build_launch_args` launch 形态（`mainClass` / `classPaths` / `modulePaths` / `args` / `cwd`，`shortenCommandLine` 按 S0 结论）+ 单测（字段断言）。
* [ ] **选择器不变式（D1）**：
  * launch 前：`test_class` / `method` / `@Nested` 链经 LSP 语义（`documentSymbol`）**存在性校验**（现有 `withJavaNestedClassPath` 只补层级，需补"不存在即硬报错、不建会话"）+ 单测（存在/不存在/嵌套链不匹配）。
  * launch 后（**仅测试目标**；main class 分支不适用）：**0 用例即终止会话 + 报错**（附请求的选择器与可能原因），依据 S0 确认的可观测证据（Console Launcher 摘要行 / `--reports-dir` XML）+ 单测（测试目标有/无用例、main class 不校验 三分支）。
* [ ] **启动参数构造单点化（D8）**：用例身份 → Console Launcher 参数收敛为唯一纯函数；Debug 走该函数 + jdwp 注入，Run 仍走既有路径但复用同一函数（**Run 行为不变**）+ 单测（两形态共用同一输出）。
* [ ] `lsp/plugin/builtins/java.rs`：`initialization_options` 追加 `bundles + settings`；清理 npm 残留指引；单测（options 含 bundles 路径占位）。
* [ ] **bundle pin + 校验（D5）**：固定版本（禁止 `latest`/浮动），下载后校验（hash 或固定 URL 版本），失败即 `BundleMissing` 报错 + 单测（校验失败分支）。
* [ ] bundle 加载失败 / 已存在 session 未加载新 bundle → 显式重启一次 session 或提示重启（不得静默失败）+ 单测（分支）。
* [ ] `start_java_via_jdtls`（消费探测结果建 `LaunchConfig{request:"launch"}` → `launch_session(Connect)`）+ 集成单测（mock 窄端口：三态各一）。
* [ ] 多模块/多入口歧义 → **硬报错**并要求显式指定 `projectName`/test class（对齐 Zed 的
  `Project have multiple entry points…` 语义；禁止静默取第一个候选）+ 单测（唯一/多候选/推导失败）。
* [ ] `updateBuildConfiguration` 保持 **`interactive`**（对齐业界）；classpath 新鲜度按 S0 结论决定是否调用 `vscode.java.buildWorkspace`；仅当 S0 证明 `resolveClasspath` 陈旧且 `buildWorkspace` 无效时才切 `automatic` 并记录理由 + 单测（options 载荷断言）。
* [ ] **前端门控修正（第 6 轮，关键）**：`launchSession`（`src/features/debug/store/debugStore.ts:203-216`）按 `dap.javaBackend`
  决定是否调用 `dapCheckAdapter('java')` —— `jdtls` / `auto` 跳过（否则缺 host jar 的目标用户被拦，B' 永不启动），
  `host` 保留；跳过时不得出现 host jar 文案；`dap_check_adapter` 语义不变 + 单测（三种取值）。
* [ ] **失败诊断入口**：B' 错误文案指向既有 LSP 服务器日志（`get_server_logs` / 日志面板）—— B' 无 adapter stderr 可聚合 + 单测（文案含日志入口）。
* [ ] disconnect 语义：`terminateDebuggee: true` + `ManagedSession.debuggee = None` 路径 + 单测（shutdown 不发 terminate）。
* [ ] 前端 `Warming` 态（loading + 可取消 + 「重试 / 改用 Host」，重试时机另可由既有 LSP 进度提示触发；**无高频轮询**）+ 失败进 console + notification。
* [ ] 真机冒烟回归（`#[ignore]`，Local + WSL 若有）：S0 结论项全部复现为自动化用例。
* 验证：`cargo test --manifest-path src-tauri/Cargo.toml` + `pnpm lint:fe` + `pnpm lint`。

## M3 自研 Host 收尾（A，仅 bugfix，不做形态增强）

* [x] `target/classes + target/test-classes` 自动前置（**分隔符按目标环境派生**：Local 宿主 Windows `;`、
  其余 `:`；Wsl/Remote 恒 `:`）+ **仅在产物缺失时触发一次 `test-compile`**，失败阻断报错
  + 单测（posix/windows/产物存在/缺失四分支；`classpathSeparatorFor` 5 例 + 端到端 `--class-path` 传递）。
* [ ] 聚合根（`packaging=pom`）拒绝 + 指引文案 + 单测。
* [ ] `start_java_attach` 更名下沉为 `start_java_via_host`（逻辑不变，`JavaDebuggee` 不动）+ 回归单测。
* [ ] host 缺失/JDK 缺失文案回归（指向 `build.sh` / `dap.adapterBinaries.java`）。
* [ ] SSH 环境显式不支持错误（不得静默降级到 A）+ 单测。
* [ ] **确认 A 不存在自动调用路径**（唯一入口是 `host` 配置或用户确认降级）+ 单测/检索佐证。
* 验证：既有 Java DAP 单测全绿 + A 真机冒烟（单模块）。

## M4 auto 路由与 UX 收尾

* [ ] `Unavailable` 分流 UX：`staticallyDetectable = true` → **一次性显式询问**「改用 Host 后端（功能受限）」，
  用户确认才走 A，并按**项目会话**记忆（不写全局配置）；拒绝则中止并保留 jdtls 配置。
  其他 `Unavailable` → 报错 + 显式切换入口（不询问、不自动）+ 组件单测（确认/拒绝/动态分支）。
* [ ] 降级后 UX：notification + DebugPanel 常驻标注（`jdtls | host | host (fallback)`）+ 求值禁用提示 + 「重试 JDTLS」+ 组件单测。
* [ ] `Warming` UX：进度驱动、可取消、「重试 / 改用 Host」入口（无高频轮询）+ 单测。
* [ ] 文档：Settings 文案（Auto 语义、JDK21 门槛、SSH 不支持 Java 调试、host 能力受限、单模块外推 B' 指引）。
* 验证：`pnpm type-check` / `pnpm test:run` / `pnpm lint:fe` / `pnpm lint` / `cargo test` 全绿。

## M5（延后）删除 A 条件

* 触发：JDK21 覆盖达标且 B' 真机稳定两个版本（Local + WSL 结论明确）。
* 删除：`tools/java-host/` + `java_debuggee.rs` + `attach/sourcePaths/Noop` 分支 + `debug_java_attach` 旧命令（调用方全迁 `debug_java_start`）；`DapSession::connect + launch` 留存。
* 验证：`grep -r "java-host\|JavaDebuggee\|attach.*jdwp" src-tauri/src/dap` 为空；全量门禁绿。

## 后续（不在本期，已记录决策输入）

* **服务端测试选择器（D1③）**：引入 vscode-java-test bundle（`vscode.java.test.junit.argument`）
  以消除文本级选择器的精度缺口。代价已实测：依赖闭包 30 个 jar、`com.microsoft.java.test.plugin`
  不在 Maven Central、需自 VSIX 提取或自建 → 由 S0 记录成本后另立任务决策。
* **Run 完整统一（D8）**：Run 路径切到与 Debug 同一份参数构造（本期只做单点化）。
* **SSH 端口转发**：使 B'（及 A）在 SSH 可用。

## 质量门禁与回滚

* 每 M 结束：`pnpm type-check`、`pnpm test:run`、`pnpm lint:fe`、`pnpm lint`（cargo fmt + clippy，`-D warnings`）、`cargo test --manifest-path src-tauri/Cargo.toml`。
* Review Gates：命令层极薄；`core::exec + ExecTarget`（禁裸 `Command`）；`mod.rs` 仅声明；`invoke` 不出 `api/`；`if-let` ≤3 层；路径 `canonicalize`；事件名常量化。
* 回滚点：
  * **S0 no-go（最先判定）→ 跳过 M0/M1/M2**，只保留 M3（A 的 bugfix + SSH 显式不支持）与文档收敛；不得先做 M0 再赌 S0；
  * **轴 ② checkpoint 不需三项增量 → 跳过 M0/M1/M2**，改走中间档（A 引擎 + `resolveClasspath`）；
  * M0 未达 → 在 M0 处暂停（不得以假管道/哨兵绕过；也不得为此改造共享 spawn 抽象——改用外部端点入口）；
  * M2 未达 → `auto`/`jdtls` 一律报错并给显式切换入口（不自动换引擎）；B' 代码 feature 门控；
  * M3 未达 → A 保持现状文案；
  * 全程不阻塞 Run 里程碑。

---

# 附：语言无关 DAP 架构重构（设计 §9 的执行计划，2026-09-14 追加）

> 设计依据见 `design.md` §9。目标：把 Java 专属编排从通用 DAP 层（manager / 组合根 / types /
> external_source）收敛到 `dap/adapter/java/` 语言后端，使新增 Go / Rust / TS 语言时零通用层改动。
> 既有正确骨架（`DebugAdapterPlugin` 协议层 / `SessionRoute` / `DapSession::connect` / external_source 授权模型）
> **不推翻**。全程 TDD，每步独立验收可回滚（§9.8）。

## A-1 语言文件归位（纯结构，行为零漂移）

* [x] `dap/java_debuggee.rs` → `dap/adapter/java/debuggee.rs`；`dap/java_capability.rs` → `dap/adapter/java/capability.rs`；`dap/java_source_path.rs` → `dap/adapter/java/source_path.rs`；`dap/adapter/java.rs` → `dap/adapter/java/protocol.rs`（协议层与目录同名触发 `module_inception`，改 `protocol.rs`；`use` 路径随动）。
* [x] `dap/mod.rs` 收敛：删除根级 java 模块声明（neeko-check B1 已兑现兼容别名：`lsp/java_debug_probe.rs`、`lsp/java_source_materializer.rs`、`manager.rs`（生产 + 测试）全改为直导 `adapter::java::`，`dap/mod.rs` 别名已删）。
* [x] `dap/adapter/java/mod.rs`：声明 + re-export（JavaAdapter / JavaBackend / capability / source_path / debuggee 均为 `pub` 子模块）。
* [x] 验收：`cargo test` 全绿（dap 243）；`protocol.rs` 仅 import 路径变化。

## A-2 LanguageBackend trait + Java 编排下沉 + manager 瘦身（核心，§9.4 方案 C）

> **方案 C 定案**：独立 `LanguageBackend`（编排层）组合 `DebugAdapterPlugin`（协议层），**不是**并入。
> 协议层保持 static 零大小单例、零改动；编排层承载有状态依赖（Java 端口）。

* [x] 新建 `adapter/backend.rs`：`LanguageBackend` trait + `SessionPlan` / `SessionRoutePlan` / `DebugRequest` / `DebugStartOutcome`。
  trait 方法：`plugin() -> &dyn DebugAdapterPlugin`、`supported_on` / `unsupported_error`（默认通用）、
  `adapter_source_path`（默认原样）、`plan`（三态，默认 spawn）。
  **实现偏差**：① 未独立 `ProbeResult` —— 探测并入 `plan` 三态（`SessionPlan::Warming/Unavailable` 已覆盖，避免重复抽象）；
  ② 未保留 trait 级 `describe_unavailable` —— `Unavailable.message` 在 plan 内直接构造（结构化 reason 无法经 `&str` 透传）；
  ③ `SessionRoutePlan::Spawn` 携带 `debuggee_output: Option<Receiver>`，`pump_output` 从 `debuggee.rs` 迁到通用 `launch_support.rs`。
* [x] 新建 `adapter/java/backend.rs`：`JavaBackend`（零大小，端口经 `state` 注入）—— 从 `manager.rs` 搬运
  `plan_attach`（A: spawn JVM + attach + debuggee + output_rx）、`plan_jdtls`（B': 探测三态 + connect）、
  `supported_on` / `unsupported_error`（SSH 拒绝）、`load_java_backend`、`describe_unavailable`、`adapter_source_path`（jdt 翻译）。
  9 个 Java 编排单测随迁并适配 `DebugRequest` / `SessionPlan`。
* [x] `manager.rs` 瘦身（1785 → 1322 行）：删除 `start_java_via_host` / `start_java_debug` / `plan_java_debug` /
  `load_java_backend` / `describe_unavailable` / `java_debug_unsupported` / `unsupported_remote_error` / `JavaDebugPlan`；
  新增通用入口 `start_language_debug(state, request) -> DebugStartOutcome`：`backend_for(kind)` 命中 → `backend.plan` →
  `launch_session`（含 debuggee 输出泵挂载）；断点翻译 `adapter_source_path`/`adapter_breakpoints` 增 `backend` 参数。
* [x] `commands.rs`：`debug_java_attach` / `debug_java_start` 保留签名，内部改调 `start_language_debug`；
  前者解包 `Session`（A 不可用即 Err），后者映射 `DebugStartOutcome` → `JavaDebugStartOutcome`（IPC 契约不变）。
* [x] 验收：Go / Lldb / Java-A / Java-B' 四条路径行为与文案不变（1206 + 100 测试全绿）；`manager.rs` 显著变薄；
* [x] `commands.rs`：`debug_java_attach` / `debug_java_start` 保留 IPC 签名，内部改调 `start_language_debug`
  （commands 返回 `DebugStartOutcome`→`JavaDebugStartOutcome` 的机械同构映射仅为 IPC 契约过渡，
  neeko-check C 已收敛：见下）。

## B2 会话存 kind，会话级翻译改按 kind 查 backend（neeko-check 优化，2026-09-14）

* [x] `DapSession` 新增 `kind()` 访问器（`const fn`，`#[must_use]`；建会话时已由 `start_with` 从
  launch `type` 经 registry 派生，无新增状态）。
* [x] `set_breakpoints`（live toggle）与 `resolve_external_source`→`authorize_external_source`→
  `translated_source_path` 改按**会话 kind**反查 `self.backend_for(kind)`，删两处 `backend_for("java")`
  硬编码；`authorize_external_source` 与 `translated_source_path` 增 `backend` 参数透传。
* [x] 受影响 4 个 `authorize_external_source` 单测改走 `state.dap_manager`（有 fake 注册）传 backend。
* [x] 验收：`cargo test dap` 243 全绿；`clippy` + `fmt` 零警告（含新增 `const fn` 修正）。

## C 结果类型与测试构造收敛（neeko-check 优化，2026-09-14）

* [x] 统一 `DebugStartOutcome`：`debug_java_start` 直接返回统一类型，删除 `JavaDebugStartOutcome`
  及机械映射层；`types.rs` 的 `kind` tag 序列化测试随迁（契约同构，前端类型零改动）。
* [x] `LaunchConfig` 加 `Default` 派生；`discover.rs`（生产唯一非 Java 构造点）与 `go.rs` / `registry.rs`
  测试 helper 切 `..Default::default()`，非 Java 侧不再逐字段拼 `None`。
* [x] 验收：`cargo test --lib` 1206、`cargo test dap` 243 全绿；`fmt` + `clippy`（生产口径）零警告。

## C2 neeko-check 二次优化：门面纯净化 + trait 返回类型去 Java 化 + Facet 下沉（2026-09-14）

> 首轮 neeko-check 发现 3 项（B1 门面混 store、B2 trait 返回 Java 专属类型、B3 runTarget 混
> CodeMirror Facet），修复如下。B2 的"会话 kind"路由已在上一轮 B2 章节完成，本批聚焦三处新问题。

* [x] **B1 门面纯净化**：`runner/index.ts` 删除 store 系导出（`useTestResultsStore` /
  `statusForCase` / `subtestsForCase` / `testResultsFileKey` / `TestCaseStatusInfo`）——store 是
  防火墙白名单直导面，不经门面二次导出。消费方（`editor/gutter/runContribution`、`runMarkers`、
  `testStatusContribution`、`runLspOverlay`、`useUnifiedGutter`、3 个测试）全改直导具体文件
  （`runner/runnables/*`、`runner/utils/*`、`runner/store/testResults`、`runner/runTarget`）。
* [x] **B2 trait 返回类型去 Java 化**：`LanguageBackend::adapter_source_path` 返回类型
  `SourcePathResolution` 从 `adapter/java/source_path.rs` 上移到 `adapter/backend.rs`
  （语言无关的"可解析/不可解析"二态）；`source_path.rs` / `java/backend.rs` / `manager.rs` /
  `lsp/java_source_materializer.rs` 改引 `adapter::SourcePathResolution`（经 `adapter/mod.rs`
  re-export）。新增 Go/Rust backend 不再被迫复用 Java 的枚举。
* [x] **B3 Facet 下沉 editor**：`runCodelensConfig` / `RunCodelensConfig`（CodeMirror Facet 配置，
  编辑器状态原语）从 `runner/runTarget.ts` 迁出到 `editor/gutter/runCodelensConfig.ts`；
  `runTarget.ts` 归零 `@codemirror` 依赖（纯运行目标身份），`runner/index.ts` 不再导出 Facet。
  消费方（`editor/gutter/runContribution`、`runMarkers`、测试）改引 editor 文件。
* [x] 验收：`tsc` 0 错误；`eslint src` 0 error（仅既有 `VirtualList` warning）；`cargo test --lib`
  1206、`cargo test dap` 243、`lsp` 165 全绿；前端 vitest 406 文件 / 3530 测试全绿；
  `fmt` + `clippy`（生产口径）零警告；`SourcePathResolution` / `runCodelensConfig` 定义各自单源。

## A-3 组合根瘦身 + registry 双表（§9.4/9.5）

* [x] `DapManager` 增 `backends: HashMap<kind, Arc<dyn LanguageBackend>>` 字段（std `Mutex`，短临界区同步锁）+ `register_backend` / `backend_for` 方法；`plugin_for` 协议层 static 单例不变。
* [x] `adapter/registry.rs` 删除 static `JAVA_BACKEND` 单例与全局 `backend_for`（JavaBackend 需构造注入，不能 static）；`backend_for` 收敛为 `DapManager` 方法。
* [x] `JavaBackend` 改为构造注入：`JavaBackend::new(capability, source_path)`，`plan_jdtls` 用 `self.capability`、`adapter_source_path` 用 `self.source_path`；不再是零大小单例。
* [x] `app_state.rs` 删 `java_debug_capability` / `java_source_path` 字段；`new_with_storage_and_library` 构造 `JavaBackend::new(LspJavaDebugCapability, LspJavaSourcePath)` 并 `register_backend("java", …)`；组合根无 Java 字段（仅装配处一次性触碰）。
* [x] dap 单测 fake 注入点改为 `register_backend`：manager 测试 `java_route_state_named` / `source_path_state`、backend 测试 `java_route_state_named` 均注册 fake backend；`fake_backend(cap)` helper 构造注入实例；外部源码授权测试改用 `state.dap_manager`（有 fake 注册）。
* [x] 验收：`AppStateWrapper` 无 Java 字段；`cargo test` 全绿（1206 + 100）；plan 三态 / 断点翻译 / 外部源码授权测试全部迁移通过。

## A-4 通用类型收敛（§9.6 M-D）

* [x] `types.rs::LaunchConfig`：Java 字段（`main_class` / `project_name` / `module_paths`）标注 **adapter 专属**（§9.4）——文档注释声明"仅 `adapter/java/` 构造站点赋值；通用层不得消费"。不做 `#[doc(hidden)]`（避免影响 launch.json 序列化/文档语义）；`expand_config` 的 `..cfg.clone()` 天然透传，未改。
* [x] `external_source.rs` 去 Java 语义：模块文档 / `FrameSource` / `is_authorized` 注释改语言中立（A-2 已把 `resolved` 改为调用方经 `backend.adapter_source_path` 预翻译传入，本步只清文档表述）。
* [ ] 非 Java adapter 测试 helper（`go.rs` / `registry.rs`）移除 Java 字段填充 —— **保留**（无害显式声明，且 LaunchConfig 无 `Default`、移除需加 `..Default::default()` 行为改动；收益仅整洁性，按最小原则不做）。
* [x] 验收（部分）：`grep -rn "main_class\|project_name\|module_paths" src-tauri/src/dap --include=*.rs` 生产构造站点仅 `adapter/java/`（+ discover/config 测试 helper 的 `None` 填充）；`cargo test` + `pnpm lint` 全绿。

## 验证清单（全部里程碑完成后）

* [x] `pnpm type-check` / `pnpm test:run` / `pnpm lint:fe` / `pnpm lint` / `cargo test` 全绿（Rust：1206 + 100 测试，fmt + clippy `-D warnings` 零警告）。
* [x] 新增语言路径验证抽象够用：`manager.rs` / `app_state.rs` / `external_source.rs` 不再含语言名（Java 编排收敛到 `adapter/java/`）；新增语言只需 `adapter/<lang>/backend.rs` 实现 `LanguageBackend` + 组合根 `register_backend`，通用层零改动。

## 回滚（§9.8）

* A-1 可独立回滚（纯 move）。A-2 若任一既有路径行为/文案漂移 → 暂停，回退到"Java 编排留 manager"现状
  （trait 扩展保留但不迁移）。A-3/A-4 各自独立可回滚；任何一步未达验收即停，不叠加后续。

---

# 附二：前端 features/runner 域迁移（设计 §10 的执行计划，2026-09-14 追加）

> 设计依据见 `design.md` §10。目标：把散落的前端运行能力（debug / editor/runner / editor/utils
> 命令构造 / editor/syntax / editor/runnables / shared/utils 误置件）收敛为与后端对位的
> `features/runner` 域。**gutter 是 editor 概念（CodeMirror 渲染层）留 editor**；runner 是纯逻辑域
> （零 CodeMirror 渲染）。执行项 R-0..R-4 需用户确认 §10.7 三个边界后开工。

## R-0 建骨架 + 迁移 debug 非渲染部分

* [ ] 建 `features/runner/{api,exec,store,utils,syntax,runnables,components,hooks}` 骨架（`git mv` 保留历史）。
* [ ] `features/debug/api/*` → `runner/api/`；`debug/components/*`（非 gutter）→ `runner/components/`；
  `debug/store/debugStore.ts` → `runner/store/`；`debug/types.ts` → `runner/types.ts`；
  `debug/{navigate,openStopSource,sourceContent,stackFrames,statusMeta,variableTree}.ts` → `runner/` 根；
  `debug/index.ts` → `runner/index.ts`（门面改造，扩为 run+debug）。
* [ ] 消费方改指：`app/panels/TitleBarActions.tsx`、`app/panels/registry.ts`、`status-bar/items/DebugItem.tsx`
  （`@/features/debug` → `@/features/runner`）。
* [ ] 验证：`npx tsc --noEmit` + `pnpm test:run` 绿。

## R-1 迁移 exec + 命令构造 + syntax

* [ ] `features/editor/runner/*` → `runner/exec/`（launch/java/native/registry/results/context/debugConsole/index）。
* [ ] `features/editor/utils/{runLanguages,testCases,testCommands,testResultParsers,javaDocumentSymbol,cargoManifest}.ts` → `runner/utils/`。
* [ ] `features/editor/syntax/*` → `runner/syntax/`（用例发现 AST，纯 run）。
* [ ] 内部相对路径随迁；`useRunActions` 的 import 改指。
* [ ] 验证：`tsc` + `pnpm test:run` 绿。

## R-2 迁移 runnables + testResults + useRunActions

* [ ] `features/editor/runnables/{provider,runnable}.ts` → `runner/runnables/`。
* [ ] `features/editor/store/testResults.ts` → `runner/store/`。
* [ ] `features/editor/hooks/useRunActions.ts` → `runner/hooks/`（纯动作，无 codemirror）。
* [ ] 消费方：`FileEditor.tsx` 的 `useRunActions` 改指 `@/features/runner`；`gutter/testStatusContribution` 改指 `runner/store`。
* [ ] 验证：`tsc` + `pnpm test:run` 绿。

## R-3 gutter 归位（渲染层留 editor）

* [ ] `debug/gutter/breakpointContribution.ts` → `editor/gutter/`（CodeMirror 渲染扩展）。
* [ ] `debug/hooks/{useCurrentLineHighlight,useBreakpointGutter}.ts` → `editor/hooks/`（含 codemirror）。
* [ ] `editor/gutter/{contribution,registry}.ts` + `run*` + `testStatusContribution` **保持原位**（通用 gutter 框架 + 渲染）。
* [ ] 验证：`tsc` + `pnpm test:run` 绿。

## R-4 shared/utils 误置件 + 消费方收敛 + 删 debug

* [ ] `shared/utils/javaClasspath.ts` + `javaConsoleSummary.ts` → `runner/utils/`。
* [ ] 全部消费方改指 runner 门面 / store 直导（`grep "features/debug\|editor/runner"` 收敛）。
* [ ] 删除 `features/debug/` 空目录；`editor/index.ts` 门面不动（本就无 run 导出）。
* [ ] 验证：`grep -rln "features/debug" src` 为空；`grep -rln "editor/runner" src` 为空。

## 验证清单（R 全部完成后）

* [ ] `pnpm type-check` / `pnpm test:run` / `pnpm lint:fe` 全绿。
* [ ] `git diff` 审查：纯 move + import 路径，零逻辑改动。
* [ ] 后端零改动（`git diff src-tauri` 不含本次前端迁移）。

## 回滚（§10.6）

* 每 R 独立可回滚（`git revert` 恢复 move）。任一步 `tsc` 失败 → 暂停，不叠加后续 R。
* R-3 若破坏 gutter 渲染 → 回退 breakpointContribution / 渲染 hooks 至 debug，改走门面而非移动。
