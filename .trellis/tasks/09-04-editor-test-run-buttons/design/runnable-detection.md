# Runnable 检测升级设计：快路径 + LSP 结构化覆盖

> 任务：`09-04-editor-test-run-buttons`。日期：2026-09-11。
> 调研依据：`research/runnable-detection-matrix.md`（四家实现 + LSP 扩展 spec + 正则边界实证）。
> 状态：设计已定；P0/P1 代码改动待确认后开工（本文档为唯一基准）。

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
- **worktree 下 LSP 会话键**：就绪门控读 `sessions[projectPath]`；若实际会话键是 worktree 根则门控不通过 → 静默回退快路径（安全降级，后续对齐）。
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

## 8. 风险与不做

| 项 | 说明 |
|---|---|
| RA 首次索引窗口 | 大 workspace 首次打开时 `experimental/runnables` 可能返回空 → 由 tier ② 兜底（本设计的核心价值） |
| gopls codelens `test` 默认关 | P2 才涉及；需在 gopls 插件设置显式开 `codelenses.test` |
| jdt.ls 协议名 | `vscode.java.resolveMainMethod` 是 VS Code 扩展侧命令；服务端请求名与返回结构**待核实**（P2 前不动） |
| `RunMarker.eq` 噪音 | LSP 覆盖会改变 marker 载荷 → eq 需选定稳定比较键（label / args 序列化），实现时记录取舍 |
| 不做：LS-only 按钮 | 否决，理由见 §0 |
| 不做：tree-sitter | 本期不引入（3 套语法/查询 + 体积，收益低于先接 LS） |
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
| P2'（后续） | Java（jdt.ls 核实后）/ 静态子测试 gutter / 子测试级状态回填 | 另行立项 |

命令：
```bash
pnpm type-check && pnpm test:run && pnpm lint:fe
cargo test --manifest-path src-tauri/Cargo.toml && pnpm lint
```
