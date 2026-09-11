# Runnable 检测升级设计：快路径 + LSP 结构化覆盖

> 任务：`09-04-editor-test-run-buttons`。日期：2026-09-11。启动：2026-09-04。
> 调研依据：`research/runnable-detection-matrix.md`（四家实现 + LSP 扩展 spec + 正则边界实证）。
>
> **状态（2026-09-11 更新）**：P0–P4 **均已实现**（P4 = 测试发现 AST 化 + Go 表格子测试 +
> 菜单去重）。交付顺序：P0 §5 → P1 §6 → P2 §7.5 → P3 §7.6 → P2' §7.7 → P4 §7.8/§7.9。
>
> **读本文档前请先看「权威顺序」**：
> - **实现契约以 §7.9 为准**（语言无关 AST 发现契约、注册表 `RunLanguage`、静态子测试索引）。
> - §7.5–§7.8 是**按交付顺序叠加的当时设计/诊断记录**，其中的符号引用可能已被替换 ——
>   主要是 `parse*Cases` / `parse*Main` 与 `utils/languageSyntax.ts`（四语言全部 AST 化后**已删除**）；
>   读这些节时请以 §7.9 校准。**已知需校准的具体位置**（不逐处改写，避免制造新的漂移）：
>   §7.5 改动表与验收（`parseGoCases` → `syntax/go.ts::discoverGoTests`）、§7.7.1 的
>   `parseJavaCases` 表述、§7.8.3.6「接入点」与 §7.8.3.7「模块形态」（当时计划改 `parseGoCases`
>   签名，**实际落点**是新增 `syntax/go.ts` + 注册表 `discoverTests`，见 §7.9.3）；
>   §7.8.8 已附显式状态更新。
> - `research/*.md` 是**历史证据快照**（记录当次实测），按既有约定**不追改**。

## 0. 决策（已确认）

**按钮策略 = 常在 + 确定性分级**：

| 级别 | 条件 | 行为 |
|---|---|---|
| ① LSP 权威 | LS 已就绪并给出 runnable | 用 LS 的 `cargoArgs` + `executableArgs` + `cwd` + `environment` 直跑 |
| ② 快路径唯一可判 | LS 未就绪/未装/不可用，但语法 + 构建布局**唯一确定**（单 bin、根清单、Go 包目录、TS 路径） | 用现有启发式直跑 |
| ③ 判定不了 | 参数确实不可判（Rust 多 target 且**需要**锁定） | 不直跑：明确报错/让用户选（绝不静默猜错） |

> **③ 的实测修正（2026-09-11 实施期）**：P0 落地时发现 Run 链路**从不锁定 target**
> （`buildRustRunCommand` 不传 `--lib/--bin/--test`），Debug 链路的 target 锁又已被产物解析
> 兜住（`binary_not_found` / `binary_ambiguous` 明确报错）。所以「歧义 → 弹选择器」在 P0
> **无证据支撑，已删**（YAGNI）；真实缺陷是**零命中静默**，治理见 §5 P0.2。

**为什么不用「LS 就绪」当开关**（否决 LS-only）：
1. **执行不依赖 LS**：Neeko 今天不装 jdtls / gopls / rust-analyzer 也能 Run/Debug（cargo / go /
   java + Maven 生成的 classpath / vitest 都在工具链侧）。LS-only 会把今天可用的能力藏起来。
2. LSP 提供的是**精确参数**，不是执行能力；把「可用性」和「精确性」混成一个开关是最差折衷。
3. VS Code/Zed 的 codelens 确实等 LS，但它们的「执行」另有任务 / 终端 / `launch.json` 兜底，
   而 gutter 图标是 Neeko 的**主入口**（没有图标就没有「这一行可运行」的发现能力）。

**为什么不改用 tree-sitter（方案 C）**：能覆盖 Go/Java/Rust 的语法级检测，但引入 3 套语法与
查询、前端体积与维护成本，收益低于「先接 LS（Neeko 基建已就位）+ 保留正则兜底」。**本期不做**。

---

## 1. 现状缺陷（本设计要解决的三个具体问题）

| # | 缺陷 | 证据 |
|---|---|---|
| D1 | **没有按钮**：快路径漏识别 | `RUST_MAIN_LINE` 漏 `async fn main`（2026-09-11 线上 bug，已修）；仍漏 `pub(crate)`、属性同行 |
| D2 | **零命中静默**：命令 exit 0 但一个用例都没跑到（用例在 `examples/`、自定义 `[[test]] path`、`test = false` 的目标、名称未对齐）→ gutter 无状态、无任何提示 | Run 链路从不锁 target（`buildRustRunCommand` 无 `--lib/--bin/--test`）；`finalizeRunResults` 空结果只清 running |
| D3 | **语言知识漂移**：同一件事两套正则（`RUST_FN_LINE` 有 `async`、`RUST_MAIN_LINE` 没有） | `testCases.ts:31` vs `mainEntries.ts:27`（修复前） |

---

## 2. 架构：两层，快路径出 UI + LSP 覆盖参数

```
文件打开 / 保存 / 切换
        │
        ├─(同步, 立即)── 快路径：逐行正则 → RunTarget[] → gutter 图标（必须先出现）
        │
        └─(异步, 300ms debounce)─ LSP runnables（Rust）
                                    │  按 location 行号区间匹配
                                    ▼
                            覆盖 RunTarget.lsp（label/args/cwd/env）
                                    │
        ┌───────────────────────────┘
        ▼
 点击 Run/Debug
   ├─ tier ① 有 target.lsp → 用 LS 参数构造命令
   ├─ tier ② 快路径唯一可判 → 现有启发式构造
   └─ tier ③ 歧义 → 选择器 / 明确通知（不执行）
```

**关键不变量**
- 快路径必须**同步可用**，且是「是否有按钮」的唯一决定者 → LS 不可用时代价仅为「参数不够精确」，不是「没有功能」。
- LSP 结果**不得**进入 CM6 `StateField` 的同步 marker 构建（保持纯函数）；只能经 effect 注入
  （现成通道：`gutter/runContribution.ts` 的 `refreshRunCodelensEffect` + 现有 300ms debounce）。
- 三级判定只影响**动作**，不影响**图标**（图标常在）。

---

## 3. 数据模型

```ts
/** LSP 给出的确定性 runnable（形状对齐 rust-analyzer，不做额外抽象）。 */
interface LspRunnable {
  label: string;
  kind: 'cargo' | 'shell';
  args: {
    cwd: string;
    workspaceRoot?: string;
    cargoArgs?: string[];
    executableArgs?: string[];
    program?: string;            // kind === 'shell'
    args?: string[];
    environment?: Record<string, string>;
  };
}

// RunTarget 扩展（gutter/runContribution.ts）
type RunTarget =
  | { kind: 'test'; testCase: TestCaseInfo; lsp?: LspRunnable }
  | { kind: 'main'; entry: MainEntry; lsp?: LspRunnable };
```

`RunMarker.eq` 需纳入 `lsp` 的稳定标识（用 `label` + `args` 序列化）以避免无谓重建；
若判定为噪音，可只比 `label`（记录取舍）。

---

## 4. 命令构造优先级（`utils/testCommands.ts` + `runner/`）

1. **tier ①**：`buildRunCommand` / `buildMainRunCommand` / `buildMainDebugBuildCommand` 增加
   可选 `lsp?: LspRunnable` 入参：
   - `kind:'cargo'` → `cargo <cargoArgs…> -- <executableArgs…>`（仍过 `shQuote`，env 经
     `SpawnOptions.with_env` 或 POSIX 前缀，参照既有 `RUSTC_BOOTSTRAP=1` 前缀惯例）；
   - `kind:'shell'` → `program args…`。
2. **tier ②**：沿用现有纯函数（`resolveRunContext` / `goPkgDir` / `deriveJavaFqcn` /
   `resolveCargoManifestDirForFile`）。
3. **tier ③**（实现期修正）：**P0 不做**。理由：Run 链路本就不锁 target（`cargo test <filter>`
   会构建该 package 的全部 test target），Debug 链路的锁错由产物解析明确报错；
   「判别联合 + 歧义选择器」无证据支撑，已删（YAGNI）。真正的风险形态是**零命中静默**，
   由 §5 P0.2 的 `shouldReportNoMatch` 告警治理。

---

## 5. P0：快路径健壮性 + 消灭静默猜错（无 LSP 依赖，可独立交付）

| 步骤 | 文件 | 内容 |
|---|---|---|
| P0.0 消除漂移 | **新建** `src/features/editor/utils/languageSyntax.ts`；改 `utils/testCases.ts`、`utils/mainEntries.ts` | 每语言一份「函数声明 / 方法声明」模式，两处共用（三个模式统一契约：`g1` = 名称）；Rust 修饰符（`async` / `pub` / `pub(crate)` / `unsafe` / `extern "C"`）只写一次。✅ 已实现 |
| P0.1 补全快路径 | `utils/mainEntries.ts` + `utils/__tests__/mainEntries.test.ts` | 覆盖 `pub(crate)` / `pub(super)` / `pub(in path)`；顺带修 Java `main(final String[] args)`（注释早已声称支持，正则其实不支持）。✅ 已实现 |
| P0.2 零命中显式化 | `runner/results.ts`（新增 `RunOutcome` + `shouldReportNoMatch` + 告警）、`runner/launch.ts`（`onExit(exitCode)` 透传 exitCode 与命令）+ `runner/__tests__/results.test.ts`、`hooks/__tests__/useRunActions.test.ts` | **exit 0 且 0 命中** → 通知（`Test Run`，附实际命令）+ `console.warn`；排除两类预期内 0 命中：退出码非 0（编译失败已有输出）、Windows 本地 Rust（`cmd.exe` 无 `VAR=x cmd` 前缀 → 结构化流不可用，已声明限制）。✅ 已实现 |
| P0 验收 | — | `pnpm type-check` / `pnpm lint:fe` / `pnpm test:run` 绿；新增用例：`languageSyntax` 漂移护栏 6、`shouldReportNoMatch` 4、Run 链路「0 命中告警 / 编译失败不告警」2 |

**歧义面收敛说明**（为什么 P0 只需动 Rust 快路径）：Go 包目录由文件路径唯一推导（`goPkgDir`），
Java FQCN 由路径推导 + classpath 单一，TS 路径唯一；Rust 的 target 锁只用于 Debug 且已有产物解析兜底。

---

## 6. P1：Rust 接 rust-analyzer `experimental/runnables`（拿到确定性参数）

### 6.0 实测载荷（rust-analyzer 1.97.1，2026-09-11，真机 stock-buddy 工作区）

按**测试函数位置**请求 `experimental/runnables` 得到（节选）：

```json
{ "label": "cargo test -p api --bin stock-buddy -- routes::sentiment::tests::test_x --exact --nocapture --include-ignored",
  "kind": "cargo",
  "args": {
    "environment": { "RUSTC_TOOLCHAIN": "…/stable-aarch64-apple-darwin" },
    "cwd": "…/stock-buddy/crates/api",
    "workspaceRoot": "…/stock-buddy",
    "cargoArgs": ["test", "--package", "api", "--bin", "stock-buddy"],
    "executableArgs": ["routes::sentiment::tests::test_x", "--exact", "--nocapture", "--include-ignored"] } }
```

同时返回粗粒度项：`cargo check -p api --all-targets`、`cargo run -p api`、`cargo test -p api --all-targets`。
**注意两处与设计假设不同**（已修正设计）：
1. **响应不含 `location`**（实测 0 处）→ 无法用整文件请求按行映射，必须**按 position 逐目标请求**；
2. 同一位置返回多种粒度 → 必须**显式选择**（`REQUIRED_CARGO_SUBCOMMAND` + tier 排序），不能取第一个。

### 6.1 实施步骤（含实施期修正）

| 步骤 | 文件 | 内容 |
|---|---|---|
| P1.1 声明 client capability | `src-tauri/src/lsp/plugin/types.rs`（新增 `client_capabilities` 字段 + builder）、`session/instance.rs`（`merge_client_capabilities` + initialize 组装）、`plugin/builtins/rust_lang.rs`、各 `mod tests` | 采用**插件级**声明（设计里的「规范备选」）而非全局注入：`None` 时 initialize 载荷逐字节不变 → **gopls / jdtls 零影响**，无需跨语言验证。护栏测试断言 rust 插件声明 `experimental.runnables.kinds = ["cargo","shell"]` |
| P1.2 拉取与覆盖 | **新建** `features/editor/runnables/runnable.ts`（类型 + `parseRunnables` + `selectRunnable`）、`runnables/provider.ts`（逐行请求 + 缓存 + 就绪门控）、`gutter/runContribution.ts`（`RunTarget.lsp` + `lspRunnablesField` + 异步 loader）、`utils/testCommands.ts`（tier ① 命令构造，复用 `shQuote`） | 逐目标行 `lspRequest(projectPath,'rust','experimental/runnables',{ textDocument:{uri}, position:{line: line-1, character:0} })`；`parseRunnables` 丢弃畸形项（版本漂移防御）；`selectRunnable` 按目标类型选具体用例 / `cargo run` |
| P1.3 刷新 / 缓存 / 降级 | 同上 provider + `lspStore`（`…/lspStore.ts:30` 的 `ready`）+ `request` 触发的 300ms debounce（复用 `createRunCodelensCore` 既有定时器） | 缓存键 = 项目 + 文件 + **目标行集合**（runnable 不依赖文档正文；增删用例自然换 key）；**未 `ready` / 请求失败 / 无命中 → 静默回退 tier ②**（不产生 UI 噪音）；派发前校验目标集合未变，防陈旧覆盖 |
| P1.4 命令构造取舍 | `utils/testCommands.ts` 的 `buildRustRunnableRunCommand` / `buildRustRunnableBuildCommand` | tier ① 测试 Run **保留本项目结构化结果流参数**（`RUSTC_BOOTSTRAP=1 … -Z unstable-options --format=json --show-output`）并沿用 LS 的完整测试路径 + `--exact`；**丢弃** RA 的 `--nocapture`（会把测试 stdout 打进管道、污染 JSON 行）与 `--include-ignored`（改变「显式 ignore 是否执行」语义，与快路径不一致）。Debug 构建 = LS 的 target + `--no-run --message-format=json`；main Debug = LS 的 `run` 子命令换 `build` |
| P1 验收 | — | ① 测试 Run 命令含 `--package api --bin stock-buddy` + `routes::…::test_x --exact`；② main Run = `cargo run --package api`；③ workspace member 不再依赖清单猜测（无 `--manifest-path`）；④ LS 未装/未就绪 → 与 P0 命令完全一致（**回归用例覆盖**）；⑤ 零新增依赖 |

### 6.2 P1 已知未覆盖（记录，不在本轮验收）

- **`environment` 未注入**：RA 给 `RUSTC_TOOLCHAIN`，但任务会话（`startTaskProcessSession`）无 env 通道（既有已声明限制）→ 字段保留在类型里，缺失时用默认工具链。
  **已确证**：`startTaskProcess → startTaskProcessSession(projectId, cols, rows, cwd, command)` 无 env 形参；
  注入需前端选项 + Rust 命令形参 + PTY spawn env 三处同改（跨层 + IPC 契约变更）→ 属独立立项，不在本任务内顺手做。
- ~~**worktree 下 LSP 会话键**：就绪门控读 `sessions[projectPath]`；若实际会话键是 worktree 根则门控不通过 → 静默回退快路径（安全降级，后续对齐）。~~
  **2026-09-11 查实：不存在错配，此隐患撤销。** 三方键一致为 `activeProject.path`：
  生产侧 `status-bar/bridges/LspSubscriptionBridge.tsx`（`:13/18/26` 订阅、`:37` `setSessionState`、`:49` `onProjectActivated`）
  = 消费侧门控 `FileEditor.projectPath`（`ProjectWorkspace.tsx:285 projectPath={activeProject.path}`）=
  获取侧 `useLspClient.ts:68 acquireLspPlugin(projectPath, …)`。worktree 是**独立 prop**（`ProjectWorkspace.tsx:288 worktreePath`），
  只经 `runner/context.ts:20 resolveRunCwd = activeWorktreePath ?? projectPath` 影响**执行 cwd**，不参与 LSP 键。
  *未验证项*：worktree 激活时 Rust 侧 LSP server 的 root 语义（是否覆盖 worktree 文件）—— 属既有行为，与本门控键无关。
- **Go / Java**：见 §7 P2。

---

## 7. 刷新时序与「就绪」判定

- **同步**：快路径解析（文件 open + 文档变更防抖 300ms）→ gutter 图标 + tier ② 动作可用。
- **异步**：LSP runnables 拉取（仅在 LS `ready` 时发起；`indexing` 期间不拉，避免拿到空集后
  又得重拉）→ 结果经 effect 触发一次 gutter 重建 → tier ① 生效。
- **就绪判定**：`lspStore` 的 per(project, language) 状态；`ready` 才拉。LS 重启/崩溃 → 状态回落
  → 自动退回 tier ②（无需额外逻辑）。

---

## 7.5 P2：Go benchmark（2026-09-11 实现）——含「为什么不接 gopls」的实证

### 7.5.1 实测：gopls codelens 能给什么（gopls v0.23.0，真机 scratch module）

开启 `initializationOptions: { codelenses: { test: true } }` 后 `textDocument/codeLens` 返回：

```json
{ "range": { "start": { "line": 4, "character": 0 }, … },
  "command": { "title": "run test", "command": "gopls.run_tests",
    "arguments": [ { "URI": "file://…/math_test.go", "Tests": ["TestAdd"], "Benchmarks": null },
                   { "source": "codelens" } ] } }
```

对比我们的 Go 快路径：

| 能力 | 快路径（正则 + `goPkgDir`） | gopls codelens |
|---|---|---|
| 顶层测试名 / 行号 / 包目录 / `-run '^Name$'` 锚定 | ✅ 全部已有 | 完全相同（**无增量**） |
| 子测试 `t.Run` | ❌ | **❌ 也不提供**（实测：含 `t.Run("positive")`/`("zero")` 的表格测试只回 `Tests: ["TestTableDriven"]`） |
| **benchmark** | ❌ 原本刻意不支持 | ✅ 提供 `Benchmarks: [...]`（文件级 lens + 每个 `BenchmarkXxx` 行的 lens） |

**结论**：对现有功能，接 gopls 是**行为等价**的（多一次往返、参数不变）；唯一真实增量是 **benchmark**。
因此 P2 只做 benchmark 能力，**不启用 gopls codelens**（避免为等价结果付往返成本）——
这也是原始设计里 `research/runnable-detection-matrix.md` 所述「平台能力决定取舍」的落地。

### 7.5.2 实现（纯前端；零 Rust 改动、零新增依赖）

| 环节 | 文件 | 内容 |
|---|---|---|
| 发现 | `utils/testCases.ts` | `TestCaseInfo.kind?: 'test' \| 'benchmark'`（缺省 = 用例，其它语言不受影响）；`parseGoCases` 同时识别 `Test*` 与 `Benchmark*`（未校验 `*testing.B` 签名：误报由 P0 的零命中告警兜住） |
| Run 命令 | `utils/testCommands.ts` | 基准：`go test -run '^$' -bench '^Name$' -count=1 -json <pkg>`；`-count=1` **必须**——缓存命中时 go 只回包级事件、无 benchmark 输出，会被零命中告警误判 |
| Debug | `utils/testCommands.ts` | 构建命令不变（`go test -c` 同样编入基准）；launch args 传显式 `['-test.run','^$','-test.bench','^Name$']` —— 首参以 `-` 开头 → GoAdapter **原样透传**（不拼 `-test.run`），无需改 adapter |
| 结果解析 | `utils/testResultParsers.ts` | 实测：benchmark 的 test2json **没有 per-benchmark 终态事件**（只有 `run` + `output`，终态是包级 `pass`/`fail`）→ 维护 pending 集合，包级终态统一收口；测量行（`… ns/op`）与 panic 文本作为 `stdout` 携带（供 gutter tooltip） |
| 文案 | `hooks/useRunActions.ts` | 基准菜单文案 `Benchmark '<name>'` / `Debug 'Benchmark <name>'`（避免 `Test 'BenchmarkAdd'` 的误导） |

**验收**：`parseGoCases` 产 `kind:'benchmark'`；run 命令含 `-bench '^X$' -count=1`；debug launch args 为显式 bench flag；
解析器对通过/失败（panic）两种真实事件序列均产出终态；**联动**：基准成功 → 落 ✓ 且不触发零命中告警。

**已知不做**（YAGNI / 平台限制）：Go 子测试（无法从 codelens 获得，需自研 `t.Run` 解析 —— 已由 P3
以**动态发现**路线交付，见 §7.6）；`Fuzz*`；`Example*`；`-benchmem` / `-benchtime` 等调参（用户可在 Task Console 复制命令自行加）。

## 7.6 P3：Go 动态子测试（2026-09-11 实现）——运行时发现而非静态解析

**问题**：`t.Run` 子测试无法单跑（对齐 vscode-go 局限）。两条候选路线：

| 路线 | 机制 | 取舍 |
|---|---|---|
| (b) 静态子测试 gutter | 解析源码 `t.Run("name", …)` 调用点 → 在调用行加 gutter 图标 | GoLand 走这条（PSI 语义级）。文本级解析受 GoLand 官方文档所列**三条约束**（测试数据须为 slice/array/map、须在 `t.Run` 同函数定义、名字须是字符串字段/拼接/`fmt.Sprintf`）；变量名 / helper 内生成的名字识别不到 |
| **(a) 动态子测试** ✅ 采用 | 从上次真实运行的 test2json 事件流取子测试全名 → 菜单提供「单跑该子测试」 | 名字 100% 真实（含变量名 / helper 生成 / 嵌套任意层），零静态猜测、零 LSP 依赖；代价是**需要先跑过一次**父用例才能发现 |

### 7.6.1 实测（Go 1.26.4，真机 scratch module）

1. **发现来源**：`go test -run '^TestTable$' -json .` 的 `Test` 字段按执行序给出
   `TestTable`、`TestTable/positive`、`TestTable/zero`、`TestTable/with.dot`、`TestTable/a+b`；
   嵌套为 `TestNested/outer`、`TestNested/outer/inner`。子测试**有**自己的终态事件
   （`pass`/`fail`/`skip`），且父级终态在其后到达。
2. **单跑模式**：`-run '^TestTable$/^\Qwith.dot\E$'` 精确命中该子测试（父级也报 `pass`）。
   Debug 路径同样成立：编译产物 `.test` 加 `-test.run '^TestNested$/^\Qouter\E$/^\Qinner\E$'`
   正确执行三层。
3. **必须 `\Q…\E` 引用**：`-run` 逐层做**正则**匹配。未引用时 `^TestTable$/^a+b$` 完全匹配不到
   字面量子测试名 `a+b`（实测：只有父级 `PASS`）。顶层用例名是 Go 标识符（无元字符），
   故保持既有 `^Name$` 形态，仅含元字符的段加 `\Q…\E` —— 与 GoLand 的
   `^\QTestAdd\E$/^\Qsub\E$` 同款。

### 7.6.2 实现（纯前端；零 Rust 改动、零新增依赖）

| 环节 | 文件 | 内容 |
|---|---|---|
| 模式构造 | `utils/testCommands.ts` | `goTestRunPattern(name)`：按 `/` 分段、每段独立锚定；含元字符的段 `\Q…\E`。**Run 与 Debug 共用**（杜绝两条链路各自拼 `-run`/`-test.run` 而漂移，同 `languageSyntax` 单一事实源教训） |
| 发现 | `utils/testResultParsers.ts` | `collectSubtestNames(events, parent)`：取 `Test` 以 `<父>/` 开头的全名（`/` 边界严格，不吞 `TestTableExtra/x`），去重 + 字典序（终态事件天然子先于父，排序还原层级序），上限 `MAX_DISCOVERED_SUBTESTS = 200` |
| 缓存 | `store/testResults.ts` | `FileResults.subtests`（父名 → 全名字典序列表），**跨运行归并**：单跑一个子测试只发现它自己，归并避免菜单里的兄弟项消失；仅 `invalidateFile`（文件编辑）丢弃。与 `cases` 生命周期不同故独立存放，非 `cases` 派生值 |
| 贯通 | `runner/results.ts` | 读取器返回 `{ results, subtests? }`；只有 test2json 通道产出 `subtests`（benchmark 不发现，`b.Run` 子基准不在本期范围）；`finalizeRunResults` 先 `recordSubtests` 再 `applyResults` |
| 菜单 | `hooks/useRunActions.ts` | Go 用例菜单：Run/Debug 两条后接**分隔条** + 每个已发现子测试的 **Run + Debug 两条**（`Test '<父>/<层级>'` / `Debug 'Test <父>/<层级>'`，与父用例同构）。未发现则整段省略 |
| 菜单可容纳性 | `shared/components/ContextMenu.tsx` | 子测试条目数不定（可达上限 200 × 2 条）→ 容器加 `max-height: calc(100vh - 8px)` + `overflow-y: auto`，定位下界夹到 4px。否则超长菜单 `top` 变负、整个菜单被推出视口（此前无长菜单场景故未暴露） |
| Debug 产物名 | `utils/testCommands.ts` | `goDebugBinaryRelPath` 消毒：`t.Run` 名字是任意字符串，不能直接当 `-o` 文件名（见 §7.6.3） |

**验收**：`goTestRunPattern` 顶层逐字节不变 / 子测试层级锚定 / 元字符引用；菜单在已发现时列出子测试并可
单跑单调试、未发现时不显示；运行父用例后子测试入 store（发现），兄弟项不因单跑而丢失；benchmark 不产子测试发现；
顶层用例的 Debug 产物名逐字节不变。

**已知不做**：**子测试级状态回填**（gutter 一行只对应源码里的父用例，子测试无独立源码行 → 单跑子测试时父用例
显示运行/终态，具体哪个子测试过/挂看 Task Console；子测试树 UI 属另一形态，不在本期）；
静态子测试 gutter 图标（路线 (b)，名字表达式受三条约束）；`Fuzz*` 产出的合成子测试。

### 7.6.3 子测试 Debug（同日补齐）——`-o` 产物名消毒 + dlv 实证

子测试 Debug 与 Run 只差「无头构建 → dlv `mode:exec`」，机制完全复用，唯一真实缺口是 `-o` 产物名。

**实测（Go 1.26.4 + dlv 1.27.0，真机 scratch module）**：

1. `go test -c -o '.neeko/test-bin/TestTable/with.dot' -gcflags 'all=-N -l'` **成功**——go 会自建父目录
   （所以「含 `/` 直接跑」不会报错，但把 `.neeko/test-bin` 撑成一棵树）。
2. `:` 在 macOS/Linux 合法（实测 `-o '.neeko/test-bin/a:b'` 成功），但 Windows 文件名保留字符
   `: * ? " < > |` 会让 `-o` 失败 —— 本地开发**不会**暴露，跨平台才炸。*（该约束为推理结论，
   未在 Windows 真机验证。）*
3. **端到端 dlv 实证**：预编译测试二进制 + `dlv exec <bin> -- -test.run '^TestTable$/^\Qwith.dot\E$'`，
   子测试内写 marker 文件 → 只有 `with.dot` 落盘（`positive`/`zero` 未执行），dlv 目标输出亦仅
   `=== RUN TestTable/with.dot`。**即 delve 路径的层级锚定确实只跑目标子测试。**
4. GoAdapter **零改动**：`dap/adapter/go.rs` 的 `mode:exec` 分支在首个 arg 不以 `-` 开头时拼
   `-test.run`（`go.rs:79-88`），前端只传裸模式 —— 与子测试模式天然契合。

**实现**：`goDebugBinaryRelPath(name)` 把 `[^A-Za-z0-9._-]` 替换为 `_`；**仅当发生过替换**时追加
原名 FNV-1a 哈希后缀。追加哈希是必需的：`TestTable/zero` 与 `TestTable_zero` 清洗后同形，共用产物文件会让
后一次构建覆盖前者的二进制 → 调试挂到错误 target。顶层用例名是 Go 标识符（无替换）→ 产物名与既有形态
**逐字节一致**，零行为变化。

---

## 7.7 Java P2'：用核心 jdt.ls 修 `@Nested` 选择器（2026-09-11 设计）

### 7.7.1 问题（已真机证实，非推理）

现状 `deriveJavaFqcn(relPath)` 从**文件路径**推 FQCN，对 `@Nested` 内层类失效：

| 选择器 | 真机结果（launcher 1.14.4） |
|---|---|
| `com.example.AppTest#testTop` | ✅ `RAN testTop`（1 test） |
| `com.example.AppTest#testNested` ← **现状会发的** | ❌ `PreconditionViolationException: Could not find method with name [testNested] in class [com.example.AppTest]` |
| `com.example.AppTest$InnerCases#testNested` | ✅ `RAN testNested`（1 test） |

夹具与命令见 `research/jdtls-runnables-probe.md` §3。**可复现**：任意含 `@Nested` 的 JUnit 5 夹具 →
`javac -cp <junit-platform-console-standalone-1.14.4.jar> -d out <src>` →
`java -jar <jar> execute -cp out -m '<选择器>'`（真机回归用的临时夹具在 `/tmp`，已清理；
**持久化证据** = 提交进仓库的真实载荷夹具 `utils/__tests__/fixtures/jdtls-document-symbol.json`）。
**检测本身没问题**：`parseJavaCases` 能检出 `testNested`（`@Nested` 不以 `Test` 结尾、不误命中；`@Test` → 下一个 `void <name>(` 命中）——**缺口只在 FQCN 组合**。

### 7.7.2 实测边界：**核心 jdt.ls 没有 runnable 端点**

`research/jdtls-runnables-probe.md` 实测（连 Zed 那份 jdt.ls）：
- `executeCommandProvider.commands` 31 条**全是 `java.*`**；`vscode.java.resolveMainClass` / `resolveClasspath`
  报 `-32601 No delegateCommandHandler`
- `codeLensProvider: null`，但 `textDocument/codeLens` 返回的 4 个 lens 全是
  `data:[uri,pos,"references"]` 且**不带 `command`** → 引用计数装饰，非运行按钮
- **`documentSymbol` 可用**（`documentSymbolProvider: true`），实测给出
  语义**层级**（package → class → 嵌套 class → method，带 `range`/`selectionRange`）
- **但 `documentSymbol` 不含注解** → 「哪个方法是测试」仍必须读源码文本

**VS Code 对照**（`research/vscode-java-run-debug-mechanism.md`，直读源码）：VS Code 的精度来自
**额外分发的 OSGi bundle**（`com.microsoft.java.debug.plugin` / `com.microsoft.java.test.plugin`）
经 `initializationOptions.bundles` 注入，由服务端返回 `range`/`mainClass`/JUnit 选择器
（测试 part 含 `nested-class:`）。**对齐 VS Code == 引入外部 jar 供给面**，本轮不做（见 §8）。

### 7.7.3 方案（零新增依赖，纯前端）

**数据源**：核心 `textDocument/documentSymbol`（不注入任何 bundle）。

#### 7.7.3.1 实测：Neeko 拿到的**不是**层级树，而是扁平 `SymbolInformation[]`（且已足够）

关键风险已实测排除：Neeko 的 `build_client_capabilities()` **完全没声明 `documentSymbol`**
（更无 `hierarchicalDocumentSymbolSupport`）→ 按 LSP 规范服务端返回扁平形状。真机对照
（同一夹具跑了「声明 vs 不声明」两次）：

| capabilities | 形状 | 条目 |
|---|---|---|
| 声明 `hierarchicalDocumentSymbolSupport: true` | 层级 `DocumentSymbol[]`（`children` + `range`/`selectionRange`） | package + class(嵌套 children) |
| **不声明（= Neeko 现状）** | 扁平 `SymbolInformation[]`（`location.range` + **`containerName`**） | 6 条，**含类符号** |

扁平形状实测载荷（夹具两层 `@Nested`，`startLine` 为 0-based）：

```
name        kind  containerName   startLine
top()       6     AppTest         7
mid()       6     L1              12
deep()      6     L2              17
L2          5     L1              15     ← 类符号也在列表里（重建多层链的前提）
L1          5     AppTest         10
AppTest     5     AppTest.java    5      ← 顶层类的 container 是「文件名」→ 天然终止条件
```

**结论**：
1. **无需改 Rust client capability** —— 扁平载荷已足够重建**多层**嵌套链；
2. 算法必须是 **`containerName` 逐级向上走**（`deep` → `L2` → `L1` → `AppTest` → 遇
   `AppTest.java` 停止），**不是**按 `range` 包含判定 —— 扁平形状里类符号的 `location.range`
   是**名字范围**（`L1` 起始 = 声明行 10），不含类体，range 包含会全部判否；
3. `TestCaseInfo.line`（Java）是**注解行**，符号的名字行 = 注解行 + 1 → 用「名字相同且
   名字行 ≥ 注解行的最近者」定位，避免同名方法串味；
4. 仍**兼容层级形状**（防御未来补 capability）：层级输入在遍历时自行推出 `containerName`，
   归一到同一张扁平表 → 只有一条链推导路径（不给「同一谓词两套实现」留口子）。

> 实施期修正记录：本节原写「按 `range` 包含关系取最内层」，被上述扁平载荷实测**证否**并更正。

#### 7.7.3.2 修法

把「嵌套类链」作为**命令构造期**的输入叠加在 `deriveJavaFqcn` 之上 ——
`deriveJavaFqcn` 仍是顶层 FQCN 的**单一事实源**，嵌套只追加 `$Inner`：

```
selector = `${deriveJavaFqcn(relPath)}${nestedPath.map(n => '$' + n).join('')}#${method}`
```

**放在哪条链路**：**`runner/java.ts` 的 `prepareRun`**（已是 Java 的异步 IO 边界：模块根探测 + classpath 读取），
**不进 gutter 同步 marker 构建**。理由：
- gutter marker 必须保持同步纯函数（既定架构）；嵌套链是异步 LSP 结果
- 复用 `runner/java.ts` 已有的就绪/降级范式，**不新增 overlay/field**（RA 那套 `setLspRunnablesEffect` 是
  rust 专属载荷，泛化它是更大的改动）
- 恰好就在 FQCN 被消费的地方（`buildJavaRunCommand` / `buildJavaDebugCommand`）
- 语言分派仍走注册表（新增可选 hook），**不在 `launch.ts` 里加 `if lang === 'java'`**

**降级**：`lspStore` java 不就绪 / 请求失败 / 解析不到方法或容器 → **原样走现状表单**（顶层 FQCN）。
即「最坏等于今天」，无回归。

**纯函数拆分（可单测）**：
- `parseJavaSymbols(raw)` → 归一化扁平表（兼容层级/扁平两形状；畸形项丢弃，同 `parseRunnables` 的防御姿态）
- `nestedClassPath(symbols, methodName, annotationLine)` → 内层类链（外→内，**不含最外层类**；
  最外层由 `deriveJavaFqcn` 负责，避免双源）

### 7.7.4 验收

- 纯函数 `parseJavaSymbols`：畸形载荷 → `[]`；**扁平**形状（`location.range` + `containerName`）
  与**层级**形状（`range` + `children`）都归一为同一张表
- 纯函数 `nestedClassPath`：顶层方法 → `[]`；一层 `@Nested` → `['L1']`；两层 → `['L1','L2']`
  （用 §7.7.3.1 的真机夹具作断言，含同名方法串味防护）
- 命令构造：`nestedClassPath` 非空时选择器含 `$`；为空/缺省时**与现状逐字节一致**
- 集成：jdt.ls 不就绪 → **不发请求**且命令不变（降级）
- **真机回归**：用 §7.7.1 已证的 ③ 表单（`AppTest$InnerCases#testNested`）比对实施产物；
  实施后已由端到端链路测试（真实载荷夹具）+ 真机执行闭环双重验证，见 `implement.md` P3.2 实施记录

### 7.7.5 已知不做

- **不接 java-debug / java-test bundle**（§7.7.2：属新依赖供给面，需单独决策）
- **不做参数化 / `@TestFactory` / 动态测试**（bundle 才给 `test-template-invocation:` / `dynamic-test:`）
- **不做类级运行**（Zed 的 `java-test-class`）；不做 `@Nested` 的 gutter 图标（现状注解行图标已够）
- **不引入 tree-sitter**（与 §8 既定决策一致）

---

## 7.8 P4（首个消费者）：Go 静态表格子测试（GoLand 式逐行按钮，2026-09-11 设计）

> **架构与分步计划见 §7.9**（语言无关的 AST 发现契约）：本节是契约的**首个消费者**，
> 提供 Go 的实现细节、名字净化实测与验收。先读 §7.9 再看本节。

### 7.8.1 需求与现状缺口

用户要求：表格驱动测试（`[]struct{...}` + `for … range` + `t.Run(tt.name, …)`）**每行都能点运行**。

现状缺口：P3 的动态发现只把子测试放进**父用例的菜单**（且需先跑过一次），表格行上**没有按钮**。
GoLand 是**静态解析**后在表格行上给按钮（PSI + 官方三条约束）—— 本节对齐的是这个体验。

### 7.8.2 实测：名字净化规则（**静态解析的前提，不净化必然匹配不上**）

来源：本机 Go 1.26.4 源码 `src/testing/match.go`（`rewrite` / `isSpace` / `unique`），
并以真机探针交叉验证（`go test -json` 的 `Test` 字段）。

```go
rewrite(s):  逐 rune —— 空白类 → '_' ；!strconv.IsPrint(r) → 转义文本 ；其余原样
isSpace(r):  \t \n \v \f \r ' ' 0x85 0xA0 0x1680 (0x2000–0x200A) 0x2028 0x2029 0x202F 0x205F 0x3000
             （源码注释明确：与 Unicode Z 类**不同**）
unique(parent, sub): 首次出现 → `parent/sub`；第 2/3… 次 → `parent/sub#01` / `#02`
```

真机对照（`t.Run("Negative input", …)` → 运行时 `TestFib/Negative_input`）：
`-run '^TestFib$/^Negative_input$'` **命中**；带原始空格的写法**不命中**。

### 7.8.3 方案：**查询已有的 Lezer 语法树（AST）** —— 不用正则、不引 tree-sitter

**只补「检测」，命令侧零改动**：P3 的 `goTestRunPattern` 已能把 `TestFib/Negative_input`
拼成 `-run '^TestFib$/^Negative_input$'`，`goDebugBinaryRelPath` 也已消毒产物名。

#### 7.8.3.1 选型（第一性原理）—— 曾误判，此处更正

**问题本质**：从源码提取**测试结构**（表格字面量 → 字段序 → 循环绑定 → `t.Run` 名字表达式）。
这是**语法结构分析**，不是文本匹配。业界标准一致是**解析器/AST 查询**，不是正则：

| 产品 | 机制 |
|---|---|
| JetBrains（GoLand） | **PSI**（完整 Go 解析树）+ 语义分析 |
| Zed | **tree-sitter 查询**（`runnables.scm`） |
| VS Code（Go/Java） | LSP `documentSymbol` 等语义接口 + 服务端 bundle |

> **本节的早期版本写的是「行锚点正则 + 逐处 bail」——已废止。** 那是按**实现成本**选型而非按问题本质；
> 结构性提取用正则必然出错（字符串内含逗号、注释、跨行元素、字段序），且后续一定要重写，总成本更高。

**关键事实：本项目已经有一个 Go 解析器在身边，且零新增依赖。**

- `@codemirror/lang-go@6`（**直接依赖**）→ Lezer Go 语法；`shared/utils/codemirror.ts:83` 已为
  每个 `.go` 标签页挂载（`go()`），即**编辑器本来就在解析 Go**（用于高亮）。
- `@codemirror/language`（直接依赖）的 **`syntaxTree(state)`** 取**增量 AST**（Lezer 复用旧树）。
- 故正确做法 = **查询已有语法树**；既不该退回正则，也不该引 tree-sitter
  （那会成为进程内**第二套**解析器栈，与 §8「不做 tree-sitter」的初衷一致）。

#### 7.8.3.2 实测：Lezer Go 能精确表达所需结构

用 `@lezer/go@1.0.1`（`@codemirror/lang-go` 的传递依赖）解析**用户贴的 TestFib 夹具**，实际树：

```text
FunctionDecl @L5 "func TestFib(t *testing.T) {"
  DefName @L5 "TestFib"                       ← 父用例名
  Block
    VarDecl @L6 "tests := []struct {"
      DefName @L6 "tests"                     ← 表标识
      TypedLiteral
        SliceType
          StructType → StructBody
            FieldDecl @L7  FieldName "name"   ← 字段序（位置式元素按此映射）
            FieldDecl @L8  FieldName "input"
            FieldDecl @L9  FieldName "expected"
        LiteralValue @L10
          Element @L11 → LiteralValue
            Element → String  "Negative input"   ← 第 0 字段 = name
            Element → UnaryExp → Number  -5
            Element → Number  0
          Element @L12 → …（Zero input …）
          Element @L13 → …（Small number …）
    ForStatement @L16 "for _, tt := range tests {"
      RangeClause
        DefName "tt"            ← loop 变量
        VariableName "tests"    ← 绑定的表
        Block
          ExprStatement
            CallExpr
              SelectorExpr  VariableName "t"  FieldName "Run"   ← 是 t.Run
              Arguments
                SelectorExpr  VariableName "tt"  FieldName "name" ← 名字字段
                FunctionLiteral …
```

**解析器天然处理**了先前必须 bail 的全部情形：字符串内含逗号、注释、跨行元素、嵌套字面量。
只剩两处**本质限制**（非实现妥协，见 §7.8.3.3）。

#### 7.8.3.3 仍存在的本质限制（与解析机制无关）

1. **重名不可静态预测**：运行时去重后缀 `#01`/`#02` 由**碰撞顺序**决定（§7.8.2 已由
   Go 源码 `matcher.unique` + 真机证实）→ 净化后重名的组**不产按钮**（该组仍可用 P3 菜单，名字精确）。
2. **非字面量名字不可静态求值**：`t.Run(fmt.Sprintf(…))` / 变量 → 静态不可解，
   同样交给 P3 动态菜单。GoLand 也只覆盖官方文档列的三种形态。

#### 7.8.3.4 解析算法（遍历 AST，无文本猜测）

1. 遍历 `FunctionDecl`，`DefName` 以 `Test` 开头 → 父用例；
2. 该函数 `Block` 内找 `VarDecl`（`DefName` = 表标识）且值为 `TypedLiteral`；
3. `TypedLiteral → SliceType → StructType → StructBody` 的 `FieldDecl → FieldName` 序列 → **字段序**；
4. `ForStatement → RangeClause` 取 `(loop 变量, 表标识)`；
5. 该 `ForStatement` 的 `Block` 内找 `CallExpr`：callee = `SelectorExpr(VariableName t, FieldName Run)`，
   首参 = `SelectorExpr(VariableName loop 变量, FieldName f)` → **名字字段 = f**；
6. `TypedLiteral → LiteralValue` 的每个元素 `LiteralValue`：按 ③ 的字段序取第 f 字段
   （键式元素为 `KeyValueExpr`，按 key 匹配）→ 要求是 `String` 字面量 →
   `name = <父名>/<sanitizeGoSubtestName(值)>`、`line = 元素起始行`。

#### 7.8.3.5 架构影响（需明确，避免"两种机制并存"隐患）

`parseTestCases(fileName, docText)` 目前只吃文本。AST 路径需要树：
- gutter 构建处**已经有 `EditorState`**（`runContribution.ts::buildTestCodelensMarkers(state)`）→
  Go 分支改为传入 `syntaxTree(state)`；
- 纯函数形态：`collectGoTestCases(tree, docText)`（新增 `utils/goAstCases.ts`），
  内部用 `GoLanguage.parser.parse(text)` 的封装供测试/无 state 场景；
- **不回退正则**：Go 的用例检测**单一机制 = AST**（顶层的 `func TestXxx` 也从同一棵树取，
  与子测试同源，避免"顶层正则 + 子测试 AST"的双轨漂移——正是 code-reuse 模式 5 点名的隐患）。

#### 7.8.3.6 接入与重复处理

**接入点**：`utils/testCases.ts::parseGoCases` 改由 AST 实现（签名加 tree 参数）；
`parseTestCases` 在生产代码里**只有 gutter markers 一个消费方**（已核实），故改动面收敛在 gutter。

**菜单去重**：已有静态按钮的子测试，P3 菜单不再重复列出（同一目标不给两个入口）。

#### 7.8.3.7 模块形态

**新增纯函数模块 `utils/goAstCases.ts`**：
- `sanitizeGoSubtestName(literal)` —— 复刻 Go `rewrite` 的空白规则（§7.8.2）；含不可打印 rune → `null`
- `collectGoTestCases(tree: Tree, docText: string): TestCaseInfo[]` —— 一次遍历同时产出
  **顶层 `func TestXxx`** 与**表格子测试**（同源，无第二套机制）
- `parseGoTestCases(docText: string)` —— 无 `EditorState` 场景的薄封装
  （内部 `GoLanguage.parser.parse`，供单测使用；生产走 `syntaxTree(state)` 复用增量树）

**首期覆盖的形状**（用户夹具，其余按 §7.8.3.3 的本质限制处理）：
```go
func TestFib(t *testing.T) {
    tests := []struct { name string; input, expected int }{   // 匿名 struct slice
        {"Negative input", -5, 0},                            // 位置式元素
        // 或 {name: "Zero input", input: 0, expected: 0},     // 键式元素
    }
    for _, tt := range tests {                                // 绑定 loop 变量 → 表
        t.Run(tt.name, func(t *testing.T) { ... })            // 名字字段 = name
    }
}
```

### 7.8.4 与 P3 动态路线的关系（互补，不重复）

| 写法 | 静态按钮 | 菜单（跑过一次后） |
|---|---|---|
| 字符串字面量、名字唯一 | ✅ 精确 | ✅（冗余，会被抑制，见下） |
| 重名 / `Sprintf` / 变量 | ❌ 不产 | ✅ 精确（真名 + `#01` 后缀） |

**去重规则**：若某子测试已有**静态**用例（同名同文件），菜单不再重复列出该条（避免同一目标两个入口）。
判定依据放 `useRunActions` 侧（读 `parseTestCases` 结果与发现列表求差）。

**落点（已实现）** —— 关键是「静态名从哪来」：菜单只拿到被点击的 `RunTarget`，没有 `docText`，
故不能在 hook 里重新解析（会引入第二次解析，与「最多解析一次」的红线冲突）。数据流：

| 层 | 动作 |
|---|---|
| `utils/runLanguages.ts` | `staticSubtestsForFile(fileName, tests)`：把**扁平**发现结果按每一层祖先前缀归组（`T/a/b` 同时进 `T` 与 `T/a` 的桶，与 `-run` 层级锚定同构）；无子测试**不建键**（区分「无静态按钮」与「有但全被去重」）。**门控内置**：`hasHierarchicalTestNames(fileName)`（注册表能力位 `RunLanguage.hierarchicalTestNames`，仅 Go 为 true）——非层级语言直接返回空索引 |
| `gutter/runMarkers.ts` | 建 marker 时把该父用例的静态子测试名挂到 `RunTarget.staticSubtests`（同一棵树、零额外解析；门控在 `staticSubtestsForFile` 内，调用方无从忘记） |
| `hooks/useRunActions.ts` | 动态列表 **减去** `staticSubtests`（**全名精确**匹配；深层名 `T/a/b` 自身无静态按钮时保留）→ 全被剔除则整段省略，不出现空分隔条 |

**「精确同名」而非「前缀包含」**：静态只覆盖一层（表格元素），动态可能更深。若按前缀剔除，
`T/a` 有静态按钮会连带隐藏动态独有的 `T/a/b` —— 而后者恰恰是动态路线的价值所在（`Sprintf` /
变量 / 重名组），故必须精确比较。

**层级语义是「能力位」而非「文本推断」（F15 修复）** —— 本条是本节的**关键教训**，单独记：

- **问题**：初版 `staticSubtestsByParent(tests)` 对**所有**语言都用「名字里有没有 `/`」推断父子关系，
  而消费方只在 `lang === 'go'` 时读它。探针实测（TS `test('auth')` + `test('auth/login works')`）：
  父目标拿到**伪造的** `staticSubtests: ['auth/login works']`。TS 标题含 `/` 极常见
  （`test('GET /users')`），故非理论边界。
- **为何是缺陷而不只是冗余**：① 数据是错的（`auth/login works` 并非 `auth` 的子测试）；
  ② 正确性**靠消费方兜住**（不变式由读取方而非产出方保证，一旦放宽门控立即生效）；
  ③ 与 P4 立论自相矛盾 —— P4 主张「以结构取代文本猜测」，而按 `/` 前缀猜层级正是文本猜测。
- **修法**：层级是该语言的**运行时语义**（Go `t.Run` + `go test -run` 逐层锚定），故声明为注册表
  能力位 `hierarchicalTestNames`（`hasMain` / `capabilities` / `results` 的同级）；判定**内置**在
  `staticSubtestsForFile` 内，调用方结构上无法绕过。同源加固：动态侧 `collectGoSubtestNames`
  改为显式带 `Go`（它前缀匹配运行时名，同样只对 Go 成立），防止被误用于其它产物通道。
- **回归断言**：TS 标题含 `/` → 索引为空（单测）+ marker **不挂** `staticSubtests`（端到端）。

### 7.8.5 已知副作用（需记录）

- 表格元素行上出现 play 图标后，**该行的断点红点会被覆盖**（统一 gutter 的既存冲突规则：
  有用例片段的行丢弃断点片段）。断点通常打在子测试体内而非数据行，影响面有限，但属行为变化。
- 图标语义为「跑这一个子用例」，与 GoLand 一致。

### 7.8.6 验收

- `sanitizeGoSubtestName`：空格/TAB/NBSP → `_`（1:1）；`slash/x` 保留；`dot`/`+`/`(`/`#` 保留；
  不可打印 → null
- `collectGoTestCases`（AST）：用户贴的 `TestFib` 夹具 → **顶层 1 条 + 子测试 6 条**
  （名字精确、行号 = 元素起始行）；位置式与键式元素都给；
  **解析器应覆盖**字符串内含逗号 / 注释干扰 / 跨行元素 / 嵌套字面量（这些是正则方案会错的用例）
- 本质限制（§7.8.3.3）：重名组 → 不产；`fmt.Sprintf`/变量名 → 不产；非 `_test.go` → 不参与
- 命令侧（**零改动**，回归）：`buildGoRunCommand({name:'TestFib/Negative_input'})` →
  `go test -run '^TestFib$/^Negative_input$' -json <pkg>`（P3 已测）
- 真机：`^TestFib$/^Negative_input$` 匹配已验证（§7.8.2）；实施后表格行按钮应生成同一命令
- **去重（与 P3 动态菜单的边界，§7.8.4）**：父用例目标携带 `staticSubtests`（marker 层断言）；
  菜单对动态发现求差后 —— 部分重叠只留动态独有条目、全重叠则无分隔条、深层条目不被祖先按钮连带隐藏
- **层级门控（F15 回归）**：`hasHierarchicalTestNames` 仅 Go 为 true；TS 标题含 `/`（`test('auth')`
  + `test('auth/login works')`）→ 索引为空 **且** marker **不挂** `staticSubtests`（单测 + 端到端）
- **单一机制护栏**：用例/main 检测只有 AST 一条路径（不再有任何行正则实现）。守卫
  `syntax/__tests__/noRegexDiscovery.test.ts` 断言四点：`utils/languageSyntax.ts` 已退役、
  发现模块内无 `new RegExp`/`.exec(`/`.match(`、注册表无 `parseTestCases`/`parseMainEntries`
  表项、四语言均有 `discoverTests`/`discoverMains`。行正则实现本身
  （`parseGoCases` / `parseRustCases` / `parseJavaCases` / `parseTsCases` / `parse*Main`）
  已删除 —— 全仓 grep 仅剩历史性注释引用，不代表现存符号

### 7.8.7 已知不做

`fmt.Sprintf` / 变量名表达式（GoLand 的部分形态也不支持）；**命名 struct 类型的跨处字段解析**
（`StructType` 换成 `TypeName` 时字段序需解析类型定义；首期跳过）；
map 作表；嵌套表格；`t.Run` 名取自 `tt` 之外的变量；
**Rust/Java/TS 的 AST 化** —— 当时列为 follow-up（见 §7.8.8），**已在 §7.9 P4 完成**。

### 7.8.8 后续收敛（**已完成，见 §7.9**）

> **状态更新**：本节是当时（仅 Go 走通 AST 时）记录的 follow-up，**已由 §7.9 P4 实现** ——
> 四语言（TS → Rust → Java → Go）的用例与 main 检测**全部**迁移到 Lezer AST，文本正则实现
> 已删除（`utils/languageSyntax.ts` 随之删除）。保留本节仅为记录决策脉络；**当前实现以 §7.9 为准**。

Rust `#[test] fn x` / Java `@Test void x` / TS `test('x')` 当时仍是**行正则**。它们检测的是
**行锚定的声明语法**，且已有测试锁死，短期可用；但**同一方向**的正确终点是统一到 Lezer AST
（`lang-rust` / `lang-java` / `lang-javascript` 同样是直接依赖、同样已挂载）。
当时先只把 **Go** 走通（因为子测试**必须**用 AST），并记录该 follow-up，
避免"两种机制并存"被遗忘（code-reuse 模式 5）—— 该顾虑已按 §7.9 的分步计划落实。

---

## 7.9 P4 架构：语言无关的 **AST 测试发现契约**（含分步计划）

> §7.8 是本契约的**首个消费者**（Go 表格子测试）的证据与细节；本节先立契约与顺序，
> 避免「先为一种语言写模块、再重构」的返工。

### 7.9.1 问题抽象（第一性原理）

对所有语言，问题是同一个：
**给定某语言的源文件与其语法树 → 产出「可运行目标」列表（源码位置 + 运行时可达标识）。**
语言差异只在「该语言的测试构造长什么样」，不在「如何取位置/名字」。

**现有架构已经有正确的缝**：`utils/runLanguages.ts` 的 `RunLanguage` 注册表（每语言一项，
聚合「语言是什么 + 命令怎么拼 + 结果读哪条通道」）。缺的只是：它的两个**发现**入口
（`parseTestCases(docText)` / `parseMainEntries(docText)`）目前**吃文本跑正则**。

**因此正确的改动 = 把注册表的发现契约从「吃文本」改为「吃语法树」，机制唯一 = Lezer**：
- Lezer 已在依赖栈内（`@codemirror/lang-{go,rust,java,javascript}` 均为**直接依赖**），
  且 `shared/utils/codemirror.ts` 已为每类文件挂载（编辑器本就在解析，用于高亮）；
- `@codemirror/language::syntaxTree(state)` 取**增量** AST（Lezer 复用旧树，满足 gutter 的同步/性能约束）；
- 不引 tree-sitter（会成为进程内第二套解析器栈，与 §8 初衷一致）。

### 7.9.2 四语言保真度实测（契约成立性，2026-09-11）

用各语言真实夹具直接解析（脚本：`@lezer/*` 从 pnpm store 加载），结论 **四语言全部成立**：

| 语言 | 检测目标 | AST 形态（实测） |
|---|---|---|
| Go | 顶层用例 / 表格子测试 / main | `FunctionDecl→DefName`；`VarDecl→TypedLiteral→SliceType→StructType→StructBody→FieldDecl`（字段序）+ `LiteralValue→Element`；`RangeClause`（表绑定）；`CallExpr→SelectorExpr(t,Run)` 首参 `SelectorExpr(tt,name)`（名字字段）→ 见 §7.8.3.2 |
| Rust | `#[test]` 用例 / main | `AttributeItem`（内含 `Attribute→MetaItem` = `test` / `tokio::test`）**把 `FunctionItem` 作为子节点**，`BoundIdentifier` = fn 名；`main` 同为 `FunctionItem`。`async fn` 天然无差异（旧正则漂移 bug 的根因在 AST 下不存在） |
| Java | `@Test` 用例 / 嵌套类 / main | `MethodDeclaration` 的 `Modifiers→MarkerAnnotation "@Test"` + `Definition "testAdd"`；**`ClassBody→ClassDeclaration` 直接给出嵌套类链**（P3.2 的 `$` 链在 AST 上天然可得）；`main` 是 `MethodDeclaration` + `Definition "main"` |
| TS/JS | `test/it` 调用 | `ExpressionStatement→CallExpression(VariableName "describe"/"test"/"it", ArgList(String, ArrowFunction))`；**`test.each(t)(…)` 双调用也是规范子树**（现有正则明确声明不支持该形态 → AST 顺带修复） |

**推论**：契约不只覆盖现有能力，还**顺带消除两处既有声明限制**（TS `.each` 双调用；Java `@Nested` 的形状）。

#### 7.9.2.1 main 入口的 AST 形态（**与用例同契约，同级迁移**）

main 的 Run **与 Debug** 两条链路（Rust/Go 走 native debug、Java 走 attach-first）**都在本轮范围内**；
检测侧与用例共用 `discover*` 契约，`hasMain`（文件名级能力位）不变。

| 语言 | 需识别的形态 | AST 实测 | 相对现有正则的收益 |
|---|---|---|---|
| Go | `func main()` | `FunctionDecl → DefName "main"`（`mainHelper` 可区分） | 注释里的 `// func main() {}` 是 `LineComment`，**不会误命中**（正则需自行跳过注释） |
| Rust | `fn main()` / `#[tokio::main] async fn main()` | `FunctionItem → BoundIdentifier "main"`；带属性时是 `AttributeItem → FunctionItem`，**结构完全相同** | 直接消灭 `languageSyntax.ts` 存在的**原因**：旧 `RUST_MAIN_LINE` 不含 `async` 而 `RUST_FN_LINE` 含，导致 `#[tokio::main] async fn main()` **没有按钮**（2026-09-11 线上 bug） |
| Java | `public static void main(String[] args)`；`@Deprecated public static final void main(String... a)` | `MethodDeclaration` + `Definition "main"`；`Modifiers` 内 `static` 与 `MarkerAnnotation` **各归其位**；参数为 `ArrayType "String[]"` 或 `SpreadParameter "String... a"` | `JAVA_MAIN_DECL` 那个「修饰符可交错 + `String[]`/`String...`/`final`」的复杂正则退化为平凡结构判断；带注解的 main 天然覆盖 |

**已实测的语法边界（非回归）**：`@lezer/java@1.1.3` **不认 Java 21 隐式类**——
`void main() { … }`（无 `class` 声明）被解析成 `LocalVariableDeclaration` + `LambdaExpression` + 错误节点。
现有 `JAVA_MAIN_DECL` 同样不识别该形态（它要求 `static` + `String[]`），故**无回归**；
该形态记为契约边界（§7.9.5），不硬凑。

### 7.9.3 契约（语言无关）

```ts
// features/editor/syntax/contract.ts —— 契约类型（**低层持有类型**：utils/* 再导出，依赖单向）
export interface SyntaxDoc { tree: SyntaxTree; docText: string; fileName: string }

// 目标形态复用既有类型名（**不引入并行类型名**：为同一概念起两个名字正是「模式 5」的隐患）
export interface TestCaseInfo { name: string; line: number; lang: 'ts' | 'rust' | 'go' | 'java';
                                kind?: 'test' | 'benchmark'; nestedClassPath?: string[] }
export type RunLang = TestCaseInfo['lang'];
export interface MainEntry { line: number; language: 'go' | 'rust' | 'java' }

// 注意：`SyntaxTree` / `SyntaxNode` 由 `syntaxTree()` 的返回类型**派生**（见 §7.9.3 依赖说明），
// 不 import `@lezer/common`（pnpm 严格模式下是传递依赖）。
```

```ts
// features/editor/syntax/lezer.ts —— 共享工具（**参数顺序统一为 docText 在前**）
createLineLookup(docText): (pos) => number   // O(n) 建索引一次 + O(log n) 二分查询
                                             // （**取代**逐次 O(pos) 扫描 —— 那会造成聚合二次方）
childOfType(node, typeName) / childrenOfType(node, typeName)
rawText(docText, node); stringValue(docText, node)   // stringValue：剥配对引号，**刻意不反转义**
walk(root, visit)                            // 全量前序（迭代式，非递归）
walkPruned(root, cut, visit)                 // 剪枝前序（**发现路径首选**：默认下钻 + 剪无关子树）
isPunctuationNode(node)                      // 共享标点谓词（取首实参/元素值需跳过标点）

// features/editor/syntax/<lang>.ts —— 每语言一个实现模块
discoverGoTests(sd) / discoverGoMains(sd)         // 内含 collectTableSubtests + sanitizeGoSubtestName
discoverRustTests(sd) / discoverRustMains(sd)
discoverJavaTests(sd) / discoverJavaMains(sd)
discoverTsTests(sd)
```

**注册表契约**（`utils/runLanguages.ts` 是唯一 seam）：
```ts
interface RunLanguage {
  isRunnableFile / isTestCaseFile / hasMain   // 不变（纯文件名谓词）
  hierarchicalTestNames: boolean                // 用例名是否以 `/` 表达层级（仅 Go；见 §7.8.4 F15）
  discoverTests(sd: SyntaxDoc): TestCaseInfo[]  // 必填（取代 parseTestCases）
  discoverMains(sd: SyntaxDoc): MainEntry[]     // 必填（取代 parseMainEntries）；与用例**同级**
  buildRunCommand / buildMainRunCommand / capabilities / results  // 不变
}
```

**批量入口**（gutter 专用，保证**最多解析一次**）：
```ts
discoverRunTargets(fileName, docText, tree?): { tests: TestCaseInfo[]; mains: MainEntry[] }
// 先门控后解析：两路都不需要时不解析
```

**静态子测试索引**（菜单去重专用，门控内置；见 §7.8.4）：
```ts
hasHierarchicalTestNames(fileName): boolean                  // 注册表能力位查询
staticSubtestsForFile(fileName, tests): Map<string, string[]> // 非层级语言 → 空索引（不接受裸 tests，防漏门控）
```

**main 的范围与不变式（本轮明确纳入）**：
- **只迁移「检测」**（`parseMainEntries` → `discoverMains`）；`buildMainRunCommand` /
  `buildMainDebugBuildCommand` / Java attach-first（`buildMainJavaDebugCommand` + `debug_java_attach`）
  **一律不动** —— 命令侧与调试编排已就绪，改的是"在哪些行画按钮"。
- **两条链路都要验收**：每语言迁移后必须验证 **main 的 Run 与 Debug 都仍可用**
  （gutter 按钮出现 + 命令构造输出与迁移前逐字节一致）。
- `hasMain` 仍是**文件名级**能力位（决定该语言是否解析 main），不随本次改动变化。
- Rust 的 tier ①（rust-analyzer runnables）对 main 的 `--package/--bin` 消歧路径**保持不变**
  （那是命令精度覆盖层，与检测机制无关）。

**树来源（唯二入口，不新增状态）**：
- **生产（gutter）：不传 `syntaxTree(state)`** —— 实施期发现的**正确性问题**：CM6 按工作预算
  **惰性**解析，`syntaxTree(state)` 不保证覆盖全文（大文件初始可能只有视口附近有树），
  直接用它建 marker 会**静默漏掉**文件后半的用例/main。故 gutter 由 `parseTestCases`
  用该语言的 Lezer parser 解析原文：**结果确定且完整**，成本与改动前的「全文本正则扫描」同级
  （该函数本就在防抖后做一次全量重建）。`tree` 参数保留给「已确保覆盖全文」的调用方。
- 纯函数 / 单测：`parser.parse(text)`，其中 `parser` 取自**直接依赖** `@codemirror/lang-*` 导出的
  `*Language.parser`（如 `goLanguage` / `rustLanguage` / `javaLanguage` / `javascriptLanguage`）；
  **不得**直接 import `@lezer/*`（pnpm 严格 node_modules 下是传递依赖 → 解析失败）。
  另：`@codemirror/language` **不导出** `Tree`/`SyntaxNode`，故类型从 `syntaxTree` 返回类型**派生**
  （`syntax/lezer.ts`），零清单/lockfile 改动。

### 7.9.4 分步计划（**先立契约、再逐语言迁移、最后加新能力**）

| 步 | 内容 | 完成判据 |
|---|---|---|
| **P4-0** | 四语言语法探针（已做，§7.9.2） | 四语言契约成立性有实测结论 ✅ |
| **P4-1** | 立契约与共享工具：`syntax/contract.ts` + `syntax/lezer.ts`（纯类型 + 纯函数） | 共享工具单测绿（取行/子节点/字符串字面量/遍历） |
| **P4-2** | **逐语言迁移（行为保持）**，顺序 **TS → Rust → Java → Go**（由简到繁）；每语言**同时迁移用例与 main**（`discoverTests` + `discoverMains`）：新 AST 实现先复现其现有测试输出 → 切注册表 → 删该语言正则 | 每语言迁移后 `pnpm test:run` 全绿且**输出逐字节一致**；**main 的 Run 与 Debug 两链路均仍可用**（按钮行 + 命令输出一致）；`utils/testCases.ts` / `mainEntries.ts` 的行正则按语言逐个消失 |
| **P4-3** | 在已统一的 seam 上加**新能力**：Go 表格子测试（§7.8）；顺带 TS `.each` 双调用（同属 AST 增量） | §7.8.6 验收 + `.each` 用例绿 |
| **P4-4** | 收口：`languageSyntax.ts` 随最后一个使用者退役（**本轮 main 也迁移，故该文件应整体删除** —— 它存在的唯一理由就是"声明形态的唯一落点"，AST 之后不再需要）；加护栏测试断言「发现路径无文本正则残留」 | 无死代码；护栏断言绿 |

**为什么是这个顺序**：契约先立 → 迁移是**行为保持**（风险可控、现有测试即回归网）→ 新能力只是契约上的增量。
反过来（先写 Go 专用模块）必然要重构，正是用户指出的「二次返工」。**回滚粒度**：每语言一步，任一步可独立回退。

### 7.9.5 契约的已知边界（诚实记录）

- **Lezer 语法保真度**不保证覆盖全部语言特性（各家 grammar 完备度不同）。**已有实测案例**：
  `@lezer/java@1.1.3` 不认 Java 21 隐式类（`void main()` 无 `class`，见 §7.9.2.1）——
  该形态现有正则同样不识别，故**无回归**，但列为契约边界。策略：**AST 取不到就省略该目标**
  （不猜、不回退正则——回退会让机制分叉，正是要消除的隐患）；用真实工程统计遗漏率，必要时为特定语法提 issue/自建查询。
- **剪枝遍历带来的两处行为收窄（刻意，已真机证实「本就不可运行」）**：`walkPruned` 剪掉函数体 `Block`
  后，以下**罕见但合法**的嵌套不再被发现 —— 且经实测这两类目标**根本无法被执行**，故「不产按钮」
  恰是正确行为（符合「宁可没有按钮，也不给点了跑 0 个的按钮」）：
  | 形态 | 真机证据 |
  |---|---|
  | **Java：方法体内的局部类**里的 `@Test` | `-c LocalTest` → 只跑 `testTop`（局部类的 `@Test` **不被 JUnit 收集**）；显式寻址 `-m 'LocalTest$1Local#testInsideLocal'` → **0 tests found**（JUnit 只扫描顶层/成员类） |
  | **Rust：函数体内的 `mod`** 里的 `#[test]` | `cargo test -- --list` 只列出 `test_top`（fn 内 mod 的测试**不进测试收集**）；按名跑 → `0 tests` |
- **AST 要求语法结构可识别**（Java 尤甚）：旧行正则是纯文本匹配，对**语法非法**的片段仍能识别
  （如无 `class` 的裸方法 `@Test void t() {}`）；AST 会给出错误树 → **不产目标**。
  影响面：编辑中的半成品文件可能暂时失去按钮（`main` 与用例同理）。**取舍**：可运行的代码必然是
  语法有效的，而 gutter 按钮的目标是「跑得起来」；且本差异只在**结构性缺失**时出现（局部语法错误
  Lezer 多能就地恢复）。各语言迁移后需留意真实工程中的表现。
- **`main` 检测**同样迁移（`parseMainEntries` → `discoverMains`），但本轮**不改变** main 的判定语义。
- Go 的 `sanitizeGoSubtestName` 属**运行时语义**（§7.8.2），放在 Go 模块内，不进共享层。

---

## 8. 风险与不做

| 项 | 说明 |
|---|---|
| RA 首次索引窗口 | 大 workspace 首次打开时 `experimental/runnables` 可能返回空 → 由 tier ② 兜底（本设计的核心价值） |
| gopls codelens `test` 默认关 | P2 才涉及；需在 gopls 插件设置显式开 `codelenses.test` |
| jdt.ls 协议名 | `vscode.java.resolveMainMethod` 是 VS Code 扩展侧命令；服务端请求名与返回结构**待核实**（P2 前不动） |
| `RunMarker.eq` 噪音 | LSP 覆盖会改变 marker 载荷 → eq 需选定稳定比较键（label / args 序列化），实现时记录取舍 |
| 不做：LS-only 按钮 | 否决，理由见 §0 |
| 不做：tree-sitter | 本期不引入（3 套语法/查询 + 体积，收益低于先接 LS） |
| **不做：注入 java-debug / java-test bundle** | 这是**对齐 VS Code 的唯一路径**（§7.7.2 实证：核心 jdt.ls 无 runnable 端点，VS Code 的精度来自额外分发的 OSGi jar）。代价 = 新增外部 jar 供给面（下载/校验/版本/与 jdt.ls 版本兼容）+ 必须等 import 完成。**属需单独决策的新依赖**，本轮只做零依赖的 §7.7 |
| 不做：改 Debug 产物解析保护 | 现有 `binary_ambiguous` 明确报错已达标，保留为兜底 |
| 约束 | 零新增 npm 依赖；跨 feature 经门面；LSP 调用不得进同步 marker 构建 |

---

## 9. 里程碑与验收命令

| 里程碑 | 内容 | 验收 |
|---|---|---|
| P0 | 快路径补全 + 静默猜错治理 | `pnpm type-check && pnpm test:run` 绿；新增「多 target 不静默」用例 |
| P1 | RA `experimental/runnables` 覆盖 | `pnpm lint`（fmt + clippy + 护栏）/ `cargo test` / `pnpm lint:fe` / `pnpm test:run` 全绿；§6 五条验收 |
| P2 | Go benchmark（含「为什么不接 gopls」实证） | `pnpm test:run` 绿；benchmark 命令/解析/文案 + 零命中联动 |
| P3 | Go **动态子测试**（运行时发现 + 菜单单跑/单调试 + `-o` 名消毒） | `pnpm test:run` / `pnpm type-check` / `pnpm lint:fe` 绿；§7.6.2 验收 |
| **P3.2** | **Java `@Nested` 选择器修复**（核心 `documentSymbol` 嵌套链，零新增依赖） | §7.7.4 四条验收；真机 ②③ 两个选择器已证实（§7.7.1） |
| **P4** | **测试发现 AST 化（用例 + main 同级迁移）**：立语言无关契约（§7.9）→ 逐语言行为保持迁移（TS→Rust→Java→Go，每语言验 main 的 Run/Debug）→ Go 表格子测试（§7.8） | §7.9.4 逐步判据 + §7.8.6 验收 |
| P2'（后续） | Java 对齐 VS Code（注入 bundle）/ 静态子测试 gutter / 子测试级状态回填 | 另行立项（bundle 供给面需先单独决策） |

命令：
```bash
pnpm type-check && pnpm test:run && pnpm lint:fe
cargo test --manifest-path src-tauri/Cargo.toml && pnpm lint
```
