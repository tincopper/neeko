# Implement Plan — 编辑器单测运行/调试按钮

> 状态：M1/M3/M4 已实现并通过 trellis-check；M2 于 2026-09-04 按用户反馈二次迭代为「gutter 图标 + 下拉菜单」交互（原 block widget 方案已废弃）并已实现（菜单组件实为 `@/shared/components/ContextMenu`）。

> 2026-09-05 三次迭代：gutter 单列合并 + provider 注册表重构（P1-P4，见 research/recommendation.md）+ 同行冲突规则。当前形态：
>
> - **注册表架构**：`editor/gutter/contribution.ts`（`GutterContribution/GutterHit/GutterLineContext` 类型 + `gutterContributions` facet，combine=flat）+ `editor/gutter/registry.ts`（`ComposedMarker` 合并器 + `createUnifiedGutterExtension`）+ `editor/gutter/testRunContribution.ts`（test-run 贡献，检测核心自 `testCodelens.ts` 迁入并删除旧文件）+ `debug/gutter/breakpointContribution.ts`（断点贡献，自备 field 快照 bundle，经 `@/features/debug` 门面导出）。合并器只依赖注册表接口，editor 零 `breakpointField/hoverLineField` 直读（G2 解耦）；`ComposedMarker.eq` 只比行号+parts 值（G4 修复，回调交换不重建 DOM）；`closest('[data-gutter-contribution]')` 显式命中路由（G3）。接口偏离 recommendation §2 处（`markersOf/linesOf` 收 EditorState、新增 `linesOf` 保持 O(marked)、砍 tooltip/elementClass）已记录在 contribution.ts。
> - **同行冲突规则**（registry.ts `CONFLICT_WINNER/LOSER`）：有用例片段的行丢弃断点片段（红点/ghost 同理），用例行空白区点击吞掉不冒泡 toggle——Rust 属性行只显示 play、不再出现断点红点拥挤；fn 体行断点正常。最小硬规则 + 扩展点注释，后续 coverage 等互斥关系走同一规则表。
> - **取舍记录**：不设 `lineMarkerChange`/`initialSpacer`（hover ghost 依赖 markers() 全量重算；spacer 会改变 gutterElement 数量语义），见 registry.ts 头注释。
> - 验证基线：`pnpm type-check` 绿；`pnpm vitest run src/features/editor src/features/debug` 58 文件 416 用例全绿（gutter 域 42 用例）；eslint（含防火墙规则）clean。
> - **2026-09-05 点击无响应修复（两叠加 bug，breadcrumb 定位）**：① CM 层命中判定 `instanceof HTMLElement` 对 SVGElement 失效（图标内联 `<svg>/<polygon>` 继承 Element 非 HTMLElement）→ 改 `instanceof Element`（测试 `should_route_click_when_target_is_svg_child_of_icon`）；② 菜单树内渲染被 dock 面板祖先 transform/overflow-hidden 裁剪不可见，且其 document 级 outside-click 监听把下一次开启菜单的 mousedown 判为外部点击立即 closeMenu（开↔关竞态）→ ContextMenu 改 `createPortal(document.body)`（与 app 浮层惯例一致）+ 合并器对已处理点击 `stopPropagation`（测试 `should_stop_propagation_when_contribution_handles_click`）。验证链：DEV breadcrumb 定位到 openMenu 已执行而菜单不可见 + 真实 Chromium harness（esbuild 打包真实模块）证明 CM 路由正常，排除层逐步收窄至 React 渲染层。

## V2 现行实现（唯一基准：`design/test-run-debug.md`）

> 历史 M1-M4/P1 为已落地基线，直接复用、零改动：parser（`parseTestBinaryPath`）、命令构造（`testCommands`）、run 链路（`launchRun` / testResults / P1 状态流）、gutter 交互（图标/浮层/冲突规则）。V2 只动 debug 载体。

- 后端新增 `debug_build_test_binary`（exec 管道执行，stdout 2MB 截断，注册 `neeko_invoke_handler!`）；`dap_start_session_config` 不动。
- 前端新增 `debug/api/debugBuildApi.ts` 门面；`buildTestBinary` 改无头构建（删 `runTask` / observer / 会话耦合）；`launchDebug`：pending 开面板 → 构建 → 解析 → 成功 `startWithConfig` / 失败 console tab + notification。
- 面板路由退化为静态（删 outcome 矩阵，调用点收敛）；回滚指纹补丁（`summarizeBuildOutput` 实现+测试+调用点全删）；parser 加输入清洗用例。
- 历史设计文档已删除，树上唯一设计即 `test-run-debug.md`；本文件 M1-M4/P1 章节保留为基线记录。

## M1 用例检测纯函数（已实现）

- `src/features/editor/utils/testCases.ts`：
  ```ts
  export interface TestCaseInfo { name: string; line: number; lang: 'ts' | 'rust'; }
  export function isTestFile(fileName: string, docText?: string): boolean;
  export function parseTestCases(fileName: string, docText: string): TestCaseInfo[];
  ```
- TS/JS（`*.test.*`/`*.spec.*`）：`test('/`it(' 调用行；忽略注释行与字符串内部误匹配（行首匹配 + trim，不引入 AST 依赖）。
- Rust（文件含 `#[test]`/`#[tokio::test]`）：属性行的**下一个** `fn <name>` 行；`name` 取 fn 名。
- 测试：`src/features/editor/utils/__tests__/testCases.test.ts`。

## M2 行号旁 gutter play 图标 + 下拉菜单（二次迭代，当前方案）

- `src/features/editor/testCodelens.ts` 重构：移除 block widget（TestLensWidget / Decoration.widget / 相关 CSS），改为 **gutter marker**：
  - `gutter({ ... })`（side 定位参照 `useEditorExtensions.ts` 既有顺序注释：breakpoint gutter → line numbers → 其余；本 gutter 紧邻 line numbers 内侧）+ `GutterMarker`（play 图标 DOM，复用 RUN_ICON_SVG）；
  - StateField 映射用例行 → marker 集合（检测纯函数与防抖重解析复用）；
  - marker mousedown → `onMenuRequest(testCase, rect)` 回调（rect 用于菜单定位），facet 注入不变。
- 菜单（React 层）：`useTestRunActions` 增加 menu state（`{ testCase, x, y } | null`）；`FileEditor` 条件渲染 `ui/ContextMenu`（`position={x,y}`、items、onClose——参照 `EditorGroupPane.tsx:249` 既有用法）：
  - Rust：`Run` + `Debug` 两项（debug 走既有 handleDebugTest）；
  - TS/JS：**不弹菜单**，marker 点击直接 `handleRunTest`（单项菜单无意义，符合 IDEA 单配置直跑语义）。
- 测试更新：gutter marker 断言（用例行有 marker、非用例行无、点击回调参数）、菜单项构成（Rust 两项/TS 直跑）、既有防抖/门控测试语义保持。

## M3 Run 接入 Task Console（已实现）

- `src/features/editor/utils/testCommands.ts`（纯函数）：vitest `pnpm vitest run <relPath> -t <caseName>`；rust `cargo test <caseName>`（libtest 子串过滤，`--exact` 已移除——见 prd.md R3 修正记录）；名称 POSIX 单引号转义。
- `taskStore.runTask` 扩展 options（cwd 覆盖 + onOutput/onExit 观察者 + 返回 runId），向后兼容；Run 点击 → taskRunner → Task Console 会话；worktree 根 cwd 优先。
- 测试：命令构造纯函数 + startTaskProcess 参数断言（mock 模式同 `TaskRunButton.test.tsx`）。

## M4 Rust Debug 闭环（已实现）

- 后端：`dap_start_session_config(project_id, config: LaunchConfig)` 新命令（复用 manager，跳过 launch.json），注册 `neeko_invoke_handler!`；serde 反序列化单测对齐前端 payload。
- 前端：`cargo test <name> --no-run`（Task Console）→ `parseTestBinaryPath` 解析二进制（新旧 cargo 行、多二进制 sourceHint、2MB 捕获上限）→ `debugStore.startWithConfig`（lldb launch：program=二进制、args=[name]）→ 既有 DebugPanel；构建失败不启动会话。

## M5 回归

```bash
pnpm type-check && pnpm test:run && pnpm lint:fe
cargo test --manifest-path src-tauri/Cargo.toml
```

## 关键约束（AGENTS.md 红线）

- 跨 feature 经门面：editor → task 走 `@/features/task` index.ts 公开导出；editor 内部组件直导。
- 新后端命令：域内 commands.rs + `neeko_invoke_handler!` 注册 + `Result<T, AppError>`。
- 命令执行走统一执行门面（`crate::core::exec`）；前端侧经任务会话。
- 性能：检测防抖、decoration/marker 惰性（RangeSetBuilder），不每键重解析全文件。

- 不引入新 npm 依赖；不新增 barrel。

## P1 结构化结果流 → 用例级 ✓/✗ gutter 状态（2026-09-05 实现）

- **纯函数解析器** `editor/utils/testResultParsers.ts`：`parseLibtestJsonLines`（逐行 JSON.parse，非 JSON 行丢弃 = rust-analyzer 降级策略；只消费 `type:"test"` 终态 ok/failed/ignored，started/suite 忽略；`exec_time` 秒→ms，failed 事件 `stdout` 作失败摘要）、`parseVitestJsonReport`（jest 兼容 `testResults[].assertionResults[]`；todo/pending 归 skipped；2MB 上限防大报告）、`matchCaseName`（全等或 `::`/空格边界后缀对齐；拒绝 `my_parse_simple` 无边界误配与参数化运行时名）。
- **用例状态 store** `editor/store/testResults.ts`（zustand，就近 editor 域）：`{projectId, filePath} → {running, cases: caseName → {status, duration?, message?}}`；`beginRun` 清旧+标记进行中、`applyResults` 落库并结束 running（空结果 = 编译失败等无状态可落，不猜）、`invalidateFile` 编辑失效；per-file 单调 `version` 作 gutter 刷新信号；`statusForCase` 在 running 期间给半透明占位。
  - **偏离任务说明记录**：任务写 `statusForLine(projectId, filePath, line)`——实际拆成两半：store 只按 caseName 存（行号是文档态，与 CM StateField 双份维护必然漂移），line → caseName 映射由 gutter 贡献复用 testCodelensField 的 `caseAtLine` 完成（本域直导，防火墙不涉及）。
- **命令构造** `testCommands.ts`：Rust run = `RUSTC_BOOTSTRAP=1 cargo test 'name'[ --manifest-path 'd/Cargo.toml'] -- -Z unstable-options --format=json --show-output`（`--` 后才是 libtest 参数，manifest 在前）；TS run 追加 `--reporter=default --reporter=json --outputFile.json='<runRoot>/node_modules/.neeko/vitest-report.json'`（default 保 Task Console 可读；**禁止 stdout JSON 模式**——官方 WARNING 混流）。`buildVitestReportPath(runRoot)` 纯函数 + `VITEST_REPORT_REL_PATH` 常量（命令侧绝对路径 / 读取侧 run 根+相对路径，Local join 与 WSL/SSH shell 拼接两通道均成立）。
  - **env 注入决策**：taskRunner/startTaskProcessSession → terminal manager spawn 均无 env 参数（已核）→ POSIX shell 前缀 `RUSTC_BOOTSTRAP=1 cargo …`；**Windows 本地限制**：cmd.exe 不支持 `VAR=x cmd` 前缀，Windows 本地 Run 的 libtest JSON 不可用（解析空结果、状态回落），WSL/SSH 目标 POSIX 不受影响。
  - **冒烟实证**（throwaway 项目）：stable 工具链下 RUSTC_BOOTSTRAP=1 + `-Z unstable-options --format=json --show-output` 产出 libtest JSON 行，failed 事件携带 stdout；vitest reporter 组合写报告（含不存在的 `.neeko/` 目录自建），`-t` 过滤下命中用例真实状态、未命中以 skipped 出现（matchCaseName 对齐时排除）。
- **Run 链路** `useTestRunActions.ts`：beginRun → onOutput 累积（上限 2MB）→ onExit 后 Rust 解析输出 / TS 经 `@/features/file/api/fileApi.readFileContent(projectId, relPath, runRoot)` 读报告（失败静默跳过）→ parse → matchCaseName 对齐 → applyResults；`runId` 为 null（无活动项目）时 invalidate 收尾。Debug 链路不做状态流（DAP 会话，超出 P1）。
- **gutter 贡献** `editor/gutter/testStatusContribution.ts`：id `test-status`、priority 30（play 左、状态右同行并排，cell flex gap 既有）；`when` 与 test-run 同门控；markersOf = caseAtLine → statusForCase；render 片段带 `data-gutter-contribution='test-status'`，✓ 绿/✗ 红/running+skipped 半透明灰，failed title = message 首行 160 字符摘要；onClick 吞掉无动作（该行断点已被 test-run 冲突规则压制，状态图标点击不设断点）。不新增冲突规则。
  - **响应式机制**（CM 实证依据 `SingleGutterView.update` 每次 view update 重调 `markers()` 并以 `ComposedMarker.eq` 值比较）：`createTestStatusCore`（ViewPlugin）订阅 store version → 变更排微任务 dispatch `refreshTestStatusEffect` 触发一次 update → markers 重读 store；plugin.update 中 docChanged → `invalidateFile`（文件编辑失效，最小侵入选型）。destroy 注销订阅。
  - 装配点 `useUnifiedGutter`：contributions 数组断点(10) → play(20) → 状态(30)；test-status core 与 testCodelens core 同生命周期（仅 withTests 注册）。
- **验证基线**：`pnpm type-check` 绿；`vitest run src/features/editor src/features/debug src/features/task` 67 文件 499 用例全绿（新增：testResultParsers 14、testResults 7、testStatusContribution 9）；eslint touched files clean；零新增依赖。

## Runnable 检测升级（P0 / P1，2026-09-11 设计）

> 起因：`RUST_MAIN_LINE` 漏识别 `async fn main`（`#[tokio::main] async fn main() -> anyhow::Result<()>`
> 无 Run/Debug 按钮），引出「正则是否适合做 runnable 检测」的调研与方案。
> **唯一基准：`design/runnable-detection.md`**；调研证据见 `research/runnable-detection-matrix.md`。

- **决策**：按钮**常在** + 按「参数确定性」三级分流（① LSP 权威参数 → ② 快路径唯一可判 →
  ③ 判定不了则选/报错，**绝不静默猜错**）。否决「LS 就绪才显示按钮」（LS-only）：
  执行只依赖工具链，不装 jdtls/gopls/RA 也能 Run/Debug。
- **P0（无 LSP 依赖）**：
  - P0.0 新建 `utils/languageSyntax.ts`，把「函数/方法声明」收敛成单一事实源，消除 Rust 正则
    漂移（`testCases.ts` 的测试名模式有 `async`、`mainEntries.ts` 的 main 模式没有 = 本次 bug
    根因）；三个模式统一契约 `g1` = 名称。
  - P0.1 补全快路径：`pub(crate)` / `pub(super)` / `pub(in path)` 修饰符；顺带修 Java
    `static void main(final String[] args)`（注释早已声称支持，正则其实不支持）。
  - P0.2 **零命中显式化**（实施期修正，替代原「target 判别联合 + 歧义选择器」）：
    Run 链路本就**不锁 target**，Debug 锁错由产物解析明确报错 → 真实缺陷是「命令 exit 0
    但 0 个用例命中」的静默（用例在 `examples/`、自定义 `[[test]] path`、`test = false`
    目标、名称未对齐）。新增 `runner/results.ts::RunOutcome` + `shouldReportNoMatch`
    （排除编译失败与 Windows 本地 Rust 已知限制），`launch.ts` 透传 exitCode 与命令 →
    通知（`Test Run`，附命令）+ `console.warn`。
- **P1（Rust 接 LSP）**：`build_client_capabilities()`（`lsp/session/instance.rs:528`）补
  `experimental.runnables.kinds`（当前缺口）→ 前端按注册表加 `discoverRunnables?` → 调
  `experimental/runnables` 拿 `cargoArgs/executableArgs/cwd/environment`，按行号覆盖
  `RunTarget.lsp`，`testCommands` 优先用 LS 参数（`resolveCargoManifestDirForFile` /
  `resolveTestTargetFlag` / `hasLibTarget` 退化为兜底）。刷新走既有 `refreshRunCodelensEffect`
  + 300ms debounce（不进 CM6 同步 marker 构建）；LS 未 ready 静默回退快路径。
- **P2（后续）**：Go 走 gopls codelens `test`（默认关，需显式开）；Java 需先核实 jdt.ls
  侧请求名（`vscode.java.resolveMainMethod` 是 VS Code 扩展侧命令）。
- **不做**：LS-only 按钮、tree-sitter 本地 AST、改 Debug 产物解析保护；零新增 npm 依赖。

## Runnable 检测升级 P1：Rust 接 rust-analyzer `experimental/runnables`（2026-09-11 实现）

> 唯一基准：`design/runnable-detection.md` §6（含真机载荷与实施期修正）；调研见
> `research/runnable-detection-matrix.md` §2.1。

- **P1.1 能力声明（插件级）**：`lsp/plugin/types.rs` 新增 `client_capabilities` 字段 + builder；
  `lsp/session/instance.rs` 新增 `merge_client_capabilities` 并在 initialize 组装时合并
  （`None` → 载荷逐字节不变，**gopls/jdtls 零影响**）；`builtins/rust_lang.rs` 声明
  `experimental.runnables.kinds = ["cargo","shell"]`（实测 1.97.1：不声明则无结果）。
  测试：`merge_client_capabilities` 三例（identity / 合并 / 非对象兜底）+ rust 插件护栏一例。
- **P1.2 前端纯核心**：`features/editor/runnables/runnable.ts` —— `LspRunnable` 类型（对齐实测字段）、
  `parseRunnables`（畸形项丢弃，版本漂移防御）、`selectRunnable`（**同一位置会返回多种粒度**，
  按「子命令必须是 test/run」+ 具体用例优先显式选择）。
- **P1.3 拉取与覆盖**：`runnables/provider.ts` 按 **position 逐目标行**请求（实测**载荷不含
  `location`**，整文件请求无法按行映射）、就绪门控（`lspStore` 的 `ready`）、缓存键 =
  项目+文件+目标行集合、失败/未就绪静默回退；`gutter/runContribution.ts` 新增
  `RunTarget.lsp` + `lspRunnablesField` + `setLspRunnablesEffect` + 异步 loader
  （复用既有 300ms debounce，不阻塞同步 markers 构建）。
- **P1.4 命令构造（tier ①）**：`utils/testCommands.ts` 新增 `shellToken`（shlex 风格按需引用）
  + `buildRustRunnableRunCommand` / `buildRustRunnableBuildCommand`；测试 Run **保留本项目
  结构化结果流参数**并沿用 LS 的完整测试路径 + `--exact`，**丢弃** `--nocapture`（污染 JSON）
  与 `--include-ignored`（语义不一致）；Debug 构建用 LS 的 target + `--no-run --message-format=json`；
  main Debug 把 LS 的 `run` 换成 `build`。`launch.ts` / `native.ts` 透传 `target.lsp`。
- **测试捕获的真实缺陷**：注入 overlay 后 markers 未重建（`runCodelensField.update` 只认
  `refreshRunCodelensEffect`）→ 覆盖「注入成功但没人消费」的静默失效；新增 4 个 marker 层用例
  后修复（`setLspRunnablesEffect` 同样触发重建）。
- **验证**：`pnpm test:run` 389 文件 3309 用例全绿（新增 runnables 16 + tier ① 命令 6 +
  marker 覆盖 4）；`pnpm lint`（fmt + clippy -D warnings + 4 护栏）绿；`cargo test` 1104 lib +
  100 集成（新增 4）；`pnpm type-check` / `eslint src/` 绿（仅既存 VirtualList warning）。
- **已知未覆盖**（见 design §6.2）：`environment` 未注入（任务会话无 env 通道）、worktree 下
  LSP 会话键待对齐（不就绪即安全回退快路径）、Go/Java 属 P2。

## Runnable 检测升级 P2：Go benchmark（2026-09-11 实现）

- **实证先行**：gopls v0.23.0 的 `textDocument/codeLens`（`codelenses.test` 开启）返回带行号的
  `gopls.run_tests` 载荷（`{URI, Tests, Benchmarks}`），但实测对比后确认：**顶层测试名/行/包/
  锚定与快路径完全相同**，**子测试不提供**（含 `t.Run` 的表格测试只回顶层名），**唯一增量是 benchmark**
  → 因此只做 benchmark 能力，**不启用 gopls codelens**（避免为等价结果付往返成本）。详见 design §7.5。
- **实现（纯前端，零 Rust 改动 / 零新增依赖）**：
  - `utils/testCases.ts`：`TestCaseInfo.kind?: 'test' | 'benchmark'`（缺省=用例）；`parseGoCases`
    识别 `Benchmark*`（文本级不校验签名，误报由零命中告警兜住）。
  - `utils/testCommands.ts`：Run = `go test -run '^$' -bench '^Name$' -count=1 -json <pkg>`
    （`-count=1` 禁缓存，否则缓存命中时无 benchmark 输出 → 会被零命中告警误判）；Debug = 构建命令不变，
    launch args 传显式 `-test.run`/`-test.bench`（首参带 `-` → GoAdapter 原样透传，**adapter 零改动**）。
  - `utils/testResultParsers.ts`：benchmark 的 test2json 无 per-benchmark 终态（只有 `run` + 包级
    `pass`/`fail`）→ pending 集合法，包级终态收口；`ns/op` 测量行与 panic 文本作 `stdout`。
  - `hooks/useRunActions.ts`：基准菜单文案 `Benchmark '<name>'` / `Debug 'Benchmark <name>'`。
- **验证**：`pnpm test:run` 389 文件 **3319** 用例全绿（+10：发现 1、命令 4、解析 3、文案 1、端到端联动 1）；
  `pnpm type-check` / `eslint src/` 绿（仅既存 VirtualList warning）；本轮无 Rust 改动，未跑 cargo 门禁。
- **夹具教训（已记）**：测试夹具用 `JSON.stringify` 构造 test2json 行 —— 手写字符串转义会把裸
  TAB/换行塞进 JSON 字符串使 `JSON.parse` 抛错、行被静默丢弃（本次一度如此）。

## Runnable 检测升级 P3：Go 动态子测试（2026-09-11 实现）

- **选型（a vs b）**：GoLand 支持子测试单跑（PSI 语义级，受官方三条约束：数据须为
  slice/array/map、须在 `t.Run` 同函数定义、名字须是字符串字段/拼接/`Sprintf`）。**采用 (a)
  动态发现**：名字取自上次真实运行的 test2json 事件流 → 100% 真实（变量名/helper 生成/嵌套
  任意层全覆盖）、零静态猜测、零 LSP 依赖；代价是需先跑过一次父用例。**(b) 静态子测试 gutter
  不做**（受三条约束，收益低于成本）。详见 design §7.6。
- **实证先行（Go 1.26.4 真机 scratch module）**：
  1. 发现来源 = `-json` 的 `Test` 字段（`TestTable/positive`、嵌套 `TestNested/outer/inner`），
     子测试**有**独立终态事件，父级终态在其后；
  2. 单跑 = `-run '^TestTable$/^\Qwith.dot\E$'` 精确命中；Debug 路径 `-test.run` 三层嵌套同样成立；
  3. **必须 `\Q…\E`**：`-run` 逐层走**正则**，未引用时 `^a+b$` **匹配不到**字面量 `a+b`（实测
     只有父级 PASS）→ 与 GoLand 的 `^\QTestAdd\E$/^\Qsub\E$` 同款。顶层名是 Go 标识符（无
     元字符）故保持 `^Name$` 不变。
- **实现（纯前端，零 Rust 改动 / 零新增依赖）**：
  - `utils/testCommands.ts`：`goTestRunPattern`（按 `/` 分段锚定，含元字符段加 `\Q…\E`）；
    `buildGoRunCommand` / `buildDebugLaunchConfig` **共用**它（防两条链路各自拼 `-run`/`-test.run`
    漂移 —— 同 `languageSyntax` 单一事实源教训）。
  - `utils/testResultParsers.ts`：`collectSubtestNames`（`<父>/` 严格边界、去重、字典序、上限
    200）。终态事件天生**子先于父** → 排序还原层级序（`outer` 先于 `outer/inner`）。
  - `store/testResults.ts`：新增 `FileResults.subtests` + `recordSubtests`（**跨运行归并**：
    单跑一个子测试只发现它自己，归并避免兄弟项从菜单消失；无新增则不 bump 版本）+ `subtestsForCase`
    选择器。仅 `invalidateFile`（文件编辑）丢弃。与 `cases` 生命周期不同 → 独立存放（非派生值）。
  - `runner/results.ts`：读取器返回 `{ results, subtests? }`（只有 test2json 通道产出；benchmark
    不发现）；`finalizeRunResults` 先 `recordSubtests` 再 `applyResults`。
  - `hooks/useRunActions.ts`：Go 用例菜单 = Run/Debug + **分隔条** + 每个已发现子测试一条
    `Test '<父>/<层级>'`（Run，走层级锚定）；未发现则整段省略。
  - `shared/components/ContextMenu.tsx`：子测试可达 200 条 → 容器 `max-height: calc(100vh - 8px)`
    + `overflow-y: auto`，定位下界夹到 4px（否则 `top` 变负、整个菜单被推出视口；此前无长菜单场景未暴露）。
- **测试期自我纠错（两处，均由新增测试暴露）**：① 我最初的发现实现按事件流顺序保序，测试显示
  嵌套场景产出 `[inner, outer]` —— 因 `parseTest2JsonLines` 只产**终态**事件，天然子先于父 →
  改为字典序排序；② 上限用例夹具误用 `Action:'run'`（不产终态事件 → 空集）→ 改 `pass`。
- **验证**：`pnpm test:run` 389 文件 **3342 passed / 1 skipped**（+23：模式 4、发现 6、store 6、
  菜单 5、贯通 2）；`pnpm type-check` 绿；`eslint`（含防火墙规则）绿。本轮无 Rust 改动。
- **已知不做**：静态子测试 gutter（路线 b）；`Fuzz*` 合成子测试；子测试级状态回填（gutter 一行只
  对应源码里的父用例，具体哪个子测试过/挂看 Task Console）。

### P3.1 子测试 Debug（同日补齐）

- **选型**：子测试 Debug 与 Run 只差「无头构建 → dlv `mode:exec`」，机制完全复用 → 唯一真实缺口是
  `go test -c -o` 的**产物文件名**。
- **实证先行（Go 1.26.4 + dlv 1.27.0 真机 scratch module）**：
  1. `go test -c -o '.neeko/test-bin/TestTable/with.dot' -gcflags 'all=-N -l'` **成功** —— go 自建
     父目录（含 `/` 不报错，但把 `.neeko/test-bin` 撑成树）；
  2. `:` 在 macOS/Linux 合法（实测 `-o '.../a:b'` 成功），Windows 保留字符 `: * ? " < > |` 会让
     `-o` 失败 —— 本地开发不暴露、**跨平台才炸**（该约束为推理结论，未在 Windows 真机验证）；
  3. **端到端 dlv 实证**：预编译二进制 + `dlv exec <bin> --continue --accept-multiclient --headless
     -- -test.run '^TestTable$/^\Qwith.dot\E$'`，子测试内写 marker → **只有 `with.dot` 落盘**
     （`positive`/`zero` 未执行），目标输出仅 `=== RUN TestTable/with.dot`；
  4. **GoAdapter 零改动**：`dap/adapter/go.rs:79-88` 的 `mode:exec` 分支在首 arg 不以 `-` 开头时
     拼 `-test.run`，与前端的裸模式天然契合。
- **实现**：`goDebugBinaryRelPath` 把 `[^A-Za-z0-9._-]` → `_`；**仅当发生过替换**时追加原名 FNV-1a
  哈希后缀 —— `TestTable/zero` 与 `TestTable_zero` 清洗后同形，共用产物文件会让后一次构建覆盖前者 →
  调试挂错 target。顶层名是 Go 标识符（无替换）→ 产物名逐字节不变。菜单每个子测试由 1 条（Run）改为
  **Run + Debug 两条**（与父用例同构）。
- **验证**：`pnpm lint:fe`（eslint + `tsc --noEmit` + `vitest --typecheck`）389 文件
  **3349 passed / 1 skipped**、Type Errors none（+7：产物名消毒 5、菜单 2）；`pnpm lint` 复跑绿
  （无 Rust 改动，`dap/adapter/go.rs` 未动）。

## neeko-check 审查修复（2026-09-11）

对全量改动跑 `/neeko-check`（13 维 + AGENTS.md Review Gates）。NUL/文本完整性扫描 clean；命令注册、
执行门面、跨平台 shell、阻塞隔离、路径校验、事件常量、firewall、英文文案全部合规。修复两项：

- **① `dap/manager.rs` 新增 public 方法零测试（MEDIUM）**：本次搬进领域层的 7 个方法
  （`require_session` / `control` / `stack_trace` / `variables` / `variables_by_reference` /
  `evaluate` / `check_adapter`）违反「没有测试的新代码不允许合入」。补 `#[cfg(test)] mod tests`
  （该文件此前无测试模块）：5 个会话级操作对缺失 id 统一映射 `NotFound`（含错误类型断言）、
  `check_adapter` 未知项目 → `NotFound` 上抛、已注册项目 + 未知 adapter 类型 → 确定性 `Ok(false)`
  （未知 kind 不触文件系统，故不受本机是否装 dlv/lldb 影响）。隔离 `AppStateWrapper` 复用
  `browser/url_validator` 测试同款 `StorageManager::with_dir(tmp)` + `LibraryStore::open_in_memory`，
  严禁默认 `~/.neeko`。Rust：**1107 passed**（+3）。
- **② `runnables/provider.ts` 缓存无上限（LOW，P6 常驻内存）**：`clearRunnableCache` 此前**零生产
  调用点**（docstring 谎称「关闭项目清理」）；键含目标行集合 → 每次增删用例都换 key、旧条目永久滞留。
  改为 **LRU 上限 `MAX_CACHE_ENTRIES = 20`**（命中刷新位置、溢出淘汰最旧），并把 docstring 改为
  如实说明「仅测试隔离用」。前端：**3351 passed / 1 skipped**（+2）。
- **③④ 按 advisory 保留（2026-09-11 用户确认：不改代码）** —— 二者都是「读法/一致性」问题而非缺陷，
  修它们的收益低于引入的改动面；记录在此供将来真正触及时参考：
  - **③ `runnables/provider.ts` 手写 `file://`**（`file://${absFilePath}`）绕过 `fileRef.lspUriOf`
    （后者被文档声明为路径↔URI 形态换算的单一所有权）。**当前输出与 `lspUriOf` 的 fs 分支逐字节相同**，
    故非功能缺陷；风险仅为漂移——若日后 `lspUriOf` 补上百分号编码/UNC 处理，本处会静默分叉。同类手写已
    存在于 `lsp/api/languageMap.ts:136`、`fileRef.ts:191`（存量、非本次引入）。**触发条件**：一旦要统一
    处理含空格/非 ASCII 的路径，需连同这三处一起收编到 `lspUriOf`。
  - **④ `dap/build.rs` 2MB 预算按原始字节计**（`DEBUG_BUILD_STREAM_LIMIT = 1MB` × 2 流），而
    AGENTS.md Review Gate #4 的原文是「单次 Command 返回的 **JSON** 不超过 2MB」。构建日志含换行
    （`\n` → `\\n` 翻倍）或控制字符（`\uXXXX` 六倍）时，序列化后可能越界。属把单流 2MB **收紧**为
    双流各 1MB 之后的遗留读法问题、**非本次回归**。**触发条件**：若将来 logs 类回传出现极端体积
    （或要严格对齐 Gate #4 字面），按序列化后大小设限、或把预算再减半。
- **未修（已判定为误报/存量，记录在案）**：`MarkdownPreview.tsx` 382 行 > 300 行为**存量**、
  本次仅改 1 行文案；P13 tauri-specta 在 `Cargo.toml` 无依赖、全仓库手写 `invoke<{…}>`，
  属规范文档与项目约定的冲突而非本次违规。
- **门禁**：`pnpm lint`（fmt + clippy `-D warnings` + 4 护栏）/ `cargo test`（1107 lib + 100 集成）/
  `pnpm lint:fe`（389 文件、Type Errors none）全绿；改动文件 NUL 扫描 clean。

## Phase 3.3 spec 更新判断（2026-09-11）

**结论：写入 1 项，明确否决 2 项。**

- **写入** `guides/code-reuse-thinking-guide.md` 新增「模式 5：同一派生规则/谓词抄成多份副本」
  （+ 提交前检查清单加 1 条）。判定依据：现有 spec 只有 `模式 3 重复的常量` 与
  `模式 4 整文件并行实现`，**均不覆盖"几行规则级副本漂移"**——而本轮两个线上级 bug
  （`async fn main` 无按钮、语言谓词漏 `.go`）同属此类，且比重复常量隐蔽（抄错不报错、
  只是少匹配）。全 spec 检索 `languageSyntax`/`runLanguages`/`goTestRunPattern` 均无命中 →
  确认缺口真实、无重复。三个实例均取自本轮真实改动，可回溯。
- **否决 1：不为 Go 领域事实新建 spec 文件**（`-run`/`-test.run` 逐层正则 + `\Q…\E` 必需、
  子测试有独立终态事件、benchmark 无 per-benchmark 终态、`go test -c -o` 自建父目录、
  `t.Run` 名字不可直接当文件名）。理由：属**特性域**知识，已完整落在本任务
  `design/runnable-detection.md` §7.6/§7.6.3；为一个特性新开 spec 目录层级过早。
  **提升触发条件**：出现第二个语言的 runnable / 跑测路径（如 Java jdt.ls）时，把两套共性
  提升为 spec。
- **否决 2：③④ 不写 spec**。③ 是纯一致性 nit（与既有 lint 规则重叠度低，不值得单列）；
  ④ 的根治点是 **AGENTS.md Review Gate #4 的措辞**（原始字节 vs 序列化 JSON 未言明），
  改项目根规则超出本任务范围 —— 记为后续建议，不在本任务动手。
