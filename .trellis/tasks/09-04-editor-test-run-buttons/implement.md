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
- **已知未覆盖**（见 design §6.2）：`environment` 未注入（任务会话无 env 通道，唯一确证缺口）、
  ~~worktree 下 LSP 会话键待对齐~~ **已于 2026-09-11 查实为「无错配」**（三方同键，详见 design §6.2）、
  Go/Java 属 P2。

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
- **触发条件复核**：「出现第二个语言的 runnable / 跑测路径时把共性提升为 spec」——**未触发**。
  Java 本轮做的是**既有路径内的嵌套修复**，探针已证核心 jdt.ls 无 runnable 端点（§7.7.2），
  即**没有新增第二条 tier ① 路径**。触发条件仍待「注入 bundle 对齐 VS Code」或第二个真 tier ① 语言。

## P3.2 实施计划：Java `@Nested` 选择器修复（零新增依赖）

> 设计见 `design/runnable-detection.md` §7.7。**改码硬闸门**：本计划 + design §7.7 经用户确认后
> 方可动代码（用户已选「B：零依赖修 @Nested」，仍需一句「开始实现」确认）。

### 已确证的前置事实（不需要再验证）

| 事实 | 证据 |
|---|---|
| 现状对嵌套用例发出的选择器**必失败** | 真机：`AppTest#testNested` → `PreconditionViolationException: Could not find method with name [testNested] in class [com.example.AppTest]` |
| 正确形态是 `$` 嵌套类 | 真机：`AppTest$InnerCases#testNested` → 1 test passed |
| 顶层不受影响 | 真机：`AppTest#testTop` → 1 test passed |
| 检测本身正确（缺口仅在 FQCN 组合） | `@Nested` 不以 `Test` 结尾故不误命中；`@Test` → 下一个 `void <name>(` 命中 `testNested` |
| `documentSymbol` 给语义嵌套层级、**不给注解** | 探针（`research/jdtls-runnables-probe.md` §2） |
| 核心 jdt.ls 无 `vscode.java.*` | 探针（31 条命令全 `java.*`） |

复现夹具：任意含 `@Nested` 的 JUnit 5 类 + `junit-platform-console-standalone-1.14.4.jar`（Neeko 同版本），
`javac -cp <jar> -d out <src>` 后 `java -jar <jar> execute -cp out -m '<选择器>'`。临时夹具在 `/tmp` 已清理；
**持久化证据** = 提交进仓库的真实 jdt.ls 载荷 `utils/__tests__/fixtures/jdtls-document-symbol.json`。

### 改动清单（自下而上，每步 TDD Red→Green）

1. **纯函数：`utils/javaDocumentSymbol.ts`（新增）**
   - `parseDocumentSymbol(raw: unknown): JavaSymbol[]` —— 校验 + 归一化；畸形项丢弃（对齐
     `runnables/runnable.ts::parseRunnables` 的防御姿态）。需要字段：`name` / `kind` / `range` / `children`。
   - `enclosingClassChain(symbols, methodLine): string[]` —— 按 `range` 包含关系取**最内层** class 链
     （任意深度）；返回**简单名**数组，顶层类不含在内（顶层由 `deriveJavaFqcn` 负责，避免双源）。
   - `stripMethodArity(name)` 之类的归一化：documentSymbol 的 method `name` 实测量为 `"testAdd()"`（带括号）→
     需剥成 `testAdd` 才能与 `parseJavaCases` 的 `TestCaseInfo.name` 比对。
   - 测试：`utils/__tests__/javaDocumentSymbol.test.ts`
     - 畸形载荷（非数组 / 缺 range / kind 非数字）→ `[]`
     - 顶层方法 → `[]`；一层嵌套 → `['InnerCases']`；两层 → `['A','B']`
     - method `name` 带 `()` → 剥括号；行号用 0-based LSP 与 1-based 文档行的换算（**边界易错，必测**）
2. **命令构造：`utils/testCommands.ts`**
   - `buildJavaRunCommand` / `buildJavaDebugCommand` 增加可选 `nestedClassPath?: string[]`，
     选择器 = `${fqcn}${nestedClassPath.map(n => '$'+n).join('')}#${name}`。
   - **缺省/空数组时必须与现状逐字节一致**（同 Go `goTestRunPattern` 的「顶层不变」护栏思路）。
   - 测试：`utils/__tests__/testCommands.test.ts` 加「顶层不变 + 嵌套含 `$`」两例。
3. **拉取 + 接入：`runner/java.ts`**
   - **先消除谓词重复（自我应用 code-reuse `模式 5`）**：`runnables/provider.ts::isRustAnalyzerReady`
     是 `sessions[projectPath]?.['rust']?.status === 'ready'`。若为 Java 再抄一份
     `isJavaReady`，就是刚写进 spec 的「同一谓词多份副本」反模式。
     → 泛化为 **`isLspLanguageReady(projectPath, languageId)`**，`isRustAnalyzerReady` 保留为
     一行委托（调用点零改动），Java 侧用同一个函数。
   - 拉取：在 `prepareRun`（已是 Java 异步 IO 边界；`@/features/lsp/api/lspApi` 的 `lspRequest`
     属白名单门面，`runnables/provider.ts` 已有同款用法）请求 `textDocument/documentSymbol`。
     **门控**：`isLspLanguageReady(projectPath, 'java')`。
   - **纯函数与 IO 分离**：解析/包含关系全在 `utils/javaDocumentSymbol.ts`（纯，可单测）；
     `runner/java.ts` 只做「就绪判定 → 请求 → 调纯函数 → 传参」，便于 mock 测试。
   - 任何失败/不就绪 → `[]`（降级为现状表单，**不发请求**）。
   - 测试：`runner/__tests__/java.test.ts`（若不存在则新建）——就绪且命中 → 命令含 `$`；
     不就绪 → 不发请求且命令与现状一致。
4. **复核（实施后）**
   - `pnpm test:run` / `pnpm type-check` / `pnpm lint:fe` 全绿
   - 真机回归：按 `implement.md` 上方「P3.2 实施记录」的验证节执行（真实载荷夹具 + 执行闭环）
     确认实施产出的命令与真机可跑的形态一致（可写一个一次性脚本比对字符串，不必真跑）；

### 回滚点

- 单文件级：`utils/javaDocumentSymbol.ts` 为纯新增；`testCommands.ts` / `runner/java.ts` 的改动
  以「可选参数 + 失败降级」形式落地 → **删掉拉取调用即回到今天的行为**（无数据迁移、无契约变更）。

### 验收（对齐 design §7.7.4）

- [ ] 顶层方法选择器**逐字节不变**
- [ ] 一层/两层嵌套选择器含正确的 `$` 链
- [ ] jdt.ls 不就绪 / 请求失败 / 解析不到 → 命令与现状一致且**不发请求**
- [ ] 文档同步：design §7.7 / research 两份 / 本计划

### 门禁命令

```bash
pnpm test:run && pnpm type-check && pnpm lint:fe
pnpm lint   # 本轮无 Rust 改动，跑一遍确认护栏未破
```

## P3.2 实施记录：Java `@Nested` 选择器修复（2026-09-11 完成）

**改动文件（7 个，纯前端，零新增依赖）**

| 文件 | 内容 |
|---|---|
| `utils/lspReadiness.ts` **(新)** | `isLspLanguageReady(projectPath, languageId)` —— 就绪判据**唯一事实源** |
| `utils/javaDocumentSymbol.ts` **(新)** | `parseJavaSymbols`（兼容扁平/层级两形状 → 归一表）+ `nestedClassPath`（containerName 向上走，去掉最外层类） |
| `utils/testCases.ts` | `TestCaseInfo.nestedClassPath?: string[]`（Java 专用；缺省=顶层，逐字节不变） |
| `utils/testCommands.ts` | `javaMethodSelector(fqcn, testCase)` + Run/Debug 两处共用（防链漂移） |
| `runner/java.ts` | `withJavaNestedClassPath`（就绪门控 → documentSymbol → 纯函数 → 附加；失败即原样） |
| `runner/registry.ts` | `LanguageRunner.enrichTestCase?` 可选 hook；JAVA 实现 |
| `runner/launch.ts` | Run 链路调 `runner.enrichTestCase?.()`（**不加 `if lang==='java'`**，语言差异仍在注册表） |
| `runnables/provider.ts` | `isRustAnalyzerReady` 改为委托 `isLspLanguageReady`（消除谓词副本） |

**测试 +21**：`lspReadiness` 3 · `javaDocumentSymbol` 8 + e2e 2 · `javaNested` 6 · `testCommands` 2

### 实施期被证据纠正的三处（重要）

1. **设计写的「按 `range` 包含关系取最内层」被实测证否**。扁平 `SymbolInformation[]` 里类符号的
   `location.range` 是**名字范围**（`L1` 起始 = 声明行），不含类体 → range 包含全部判否。
   改为 **`containerName` 逐级向上走**，终止条件 = 顶层类的 container 是**文件名**（`AppTest.java`）。
   → design §7.7.3.1 已更正并留痕。
2. **原担心的 Rust capability 改动不需要**。Neeko 的 `build_client_capabilities()` 未声明
   `documentSymbol`，实测 jdt.ls 返回扁平形状，但该形状**自带 `containerName` + 类符号** → 多层
   嵌套链可完整重建。真机对照跑了两遍（声明 vs 不声明）才敢下此结论。
3. **`context.ts` 与 `testCommands.ts` 对 `filePath` 的注释互相矛盾**（前者「相对」、后者「恒为
   canonical 绝对」）。核实：`FileEditor` 另用 `canonicalFsPath(projectPath, tab.filePath)` 推
   `absFilePath`，说明 **两者都可能** → URI 统一走 `fileRefFromTabPath` + `lspUriOf`（canonicalize
   助手，两种形态都接），避免再添一处手写 `file://`（正是审查 ③ advisory 点名的模式）。

### 验证

- **端到端链路测试**（真实载荷夹具 `utils/__tests__/fixtures/jdtls-document-symbol.json`，
  由本地 jdt.ls 在 Neeko 现状能力下返回）→ `nestedClassPath` + 完整命令选择器断言
- **真机执行闭环**：实施产物选择器 `com.example.AppTest$InnerCases#testNested`
  → Console Launcher **1 tests found / 1 successful**；旧形态仍报 `resolution failed`
- **变异检验**：去掉 `nestedClassPath` 的「去最外层类」步骤 → 4 个断言立刻失败 → 测试非空转
- **诚实标注**：`lspReadiness.test.ts` 与实现同时创建，**未观察到 Red**（其余步骤均先跑测试见红）

### 已知不做（沿用 design §7.7.5）

注入 java-debug / java-test bundle（对齐 VS Code 的唯一路径，属新依赖供给面）；参数化 / `@TestFactory` /
动态测试（需 bundle 的 `test-template-invocation:` / `dynamic-test:`）；类级运行；`@Nested` 的 gutter 图标；
tree-sitter。**另**：文件内含多个顶层类时，`deriveJavaFqcn` 仍按**文件名**推 FQCN，对非文件同名类的用例
会错 —— 同一数据源（package kind 4 + 最外层类名）可修，但属既有缺口，本轮不动，记录在此。
## P4 实施计划：测试发现 **AST 化**（通用契约 → 逐语言迁移 → Go 表格子测试）

> 设计见 `design/runnable-detection.md` **§7.9（架构与分步）** + §7.8（Go 首个消费者）。
> **§7.9.1 / §7.8.3.1 记录了选型更正**：早期版本按成本选「行正则 + bail」，已废止。
> **改码硬闸门**：本计划 + §7.9 经用户确认后方可动代码。

**范围明确包含 main**：`discoverMains` 与 `discoverTests` **同级迁移**；main 的 **Run 与 Debug 两条链路**
都要在每语言迁移后验证仍可用（只换"在哪些行画按钮"，不动命令构造与调试编排）。

### P4-0 语法探针 —— **已完成**（§7.9.2 + §7.9.2.1）

**用例侧**：四语言契约全部成立（Go `FunctionDecl`/`TypedLiteral` 字段序/`RangeClause`/`CallExpr`；
Rust `AttributeItem→Attribute/MetaItem "test"` 内含 `FunctionItem`；Java `MethodDeclaration→Modifiers→MarkerAnnotation`；
TS `CallExpression(VariableName test/it, ArgList(String, ArrowFunction))`）。

**main 侧**：三语言均成立，且**天然解决现有正则的难点** ——
Go `FunctionDecl→DefName "main"`（注释里的 `// func main() {}` 是 `LineComment`，不误命中）；
Rust `FunctionItem→BoundIdentifier "main"`（`#[tokio::main] async fn main()` 与普通 main **结构相同** ——
直接消灭 `languageSyntax.ts` 存在的**原因**）；Java `MethodDeclaration`+`Definition "main"`，
`Modifiers` 内 `static` 与 `MarkerAnnotation` 各归其位（`JAVA_MAIN_DECL` 那个"修饰符可交错"的复杂正则退化为平凡判断）。

**已实测的语法边界（非回归）**：`@lezer/java@1.1.3` 不认 **Java 21 隐式类**（`void main()` 无 `class` →
被解析成 `LocalVariableDeclaration`+`LambdaExpression`+错误节点）。现有 `JAVA_MAIN_DECL` 同样不识别 → 无回归，
记为契约边界（§7.9.5），**不硬凑**。

### 已确证的前置事实

| 事实 | 证据 |
|---|---|
| 编辑器已在解析四种语言（Lezer，均**直接依赖**、均已挂载） | `@codemirror/lang-{go,rust,java,javascript}` 在 dependencies；`shared/utils/codemirror.ts` |
| `syntaxTree(state)` 可同步取增量 AST | `@codemirror/language` 直接依赖；gutter 构建处已有 `state` |
| main 的 Run **与** Debug 已就绪（Rust/Go native、Java attach-first） | `runLanguages` 的 `buildMainRunCommand`/`buildMainDebugBuildCommand`；`runner/native.ts`、`java.ts::debugJava` |
| Go 子测试名净化规则（空白类 → `_`，1:1） | Go 源码 `testing/match.go::rewrite`/`isSpace` + 真机探针 |
| 重名去重后缀 `#01`/`#02` 由运行时碰撞顺序决定 | Go 源码 `matcher.unique` + 真机 |
| 命令侧**已就绪**，零改动（Go 子测试） | P3 的 `goTestRunPattern` / `goDebugBinaryRelPath` 已吃 `TestFib/Negative_input` |
| `parseTestCases` / `parseMainEntries` 生产消费方**只有 gutter markers** | 全仓 grep 核实 |

### 分步实施（每步独立可回退；先立契约再迁移，杜绝返工）

**P4-1 立契约 + 共享工具（纯类型/纯函数，先写测试）**
- `features/editor/syntax/contract.ts`：`SyntaxDoc` / `TestTarget` / `MainTarget`（§7.9.3）
- `features/editor/syntax/lezer.ts`：`nodeLine` / `childOfType` / `childrenOfType` / `findDescendant` /
  `rawText` / `stringValue` / `walk`（迭代式，避免深递归）
- 护栏：**禁止**直接 import `@lezer/*`（pnpm 严格 node_modules 下是传递依赖 → 解析失败）；
  parser 一律经 `@codemirror/lang-*.Language.parser`

**P4-2 逐语言迁移（行为保持，用例与 main 同步）**，顺序 **TS → Rust → Java → Go**（简→繁）：
- 每语言：`syntax/<lang>.ts` 实现 `discover<Lang>Tests` + `discover<Lang>Mains`
  → **先复现该语言现有测试的全部输出**（现有测试即回归网）
  → 切 `runLanguages.ts` 注册表 → 删该语言的旧正则 → 门禁全绿
- **输出逐字节一致**（含现有测试锁定的边界用例）；
- **main 两条链路各验一次**：按钮行 + `buildMainRunCommand` / `buildMainDebugBuildCommand`
  （Java 为 attach-first 命令）输出与迁移前一致；
- TS 无 main（`hasMain: false`）→ 只迁用例；
- 每语言一步提交级粒度，任一步可独立回退。

**P4-3 新能力（在已统一的 seam 上）**
- Go 表格子测试（§7.8.4 六步算法 + `sanitizeGoSubtestName`）；顺带 TS `.each` 双调用
- 真机验证：`/tmp/fibprobe` 上 `-run '^TestFib$/^Negative_input$'` 应 1 pass

**P4-4 收口**
- `utils/languageSyntax.ts` **整体删除**（它存在的唯一理由是"声明形态的唯一落点"；用例与 main 都迁移后无消费者）
- `utils/mainEntries.ts` 的正则实现删除，仅保留类型/re-export 或整体并入 `syntax/<lang>.ts`
- 护栏测试：断言发现路径**无文本正则实现残留**（单一机制）
- 菜单去重：动态发现的子测试若已是静态用例，`useRunActions` 菜单不再重复列出

### 回滚点

- P4-1/P4-2 的每语言迁移都是**行为保持**替换 → 单语言可回退；
- 若某语言 AST 保真度不足（§7.9.5 已有 Java 隐式类的实测案例）：**该语言暂不迁移**（保留其正则），
  契约不变、其余语言照迁 —— 这是"部分迁移"而非"机制分叉"，因为契约只有一份；
- Go 静态接入若暴露问题：移除静态接入点，退回「只保留 P3 动态菜单」（**回到行正则不是选项**）。

### 验收

- [ ] P4-1：共享工具单测绿；无 `@lezer/*` 直接 import
- [ ] P4-2：每语言迁移后 `pnpm test:run` 全绿且输出**逐字节一致**；对应旧正则已删除
- [ ] P4-2：**每语言 main 的 Run 与 Debug 均仍可用**（按钮行不变 + 命令输出一致）
- [ ] P4-3：§7.8.6 全部验收（`TestFib` → 顶层 1 + 子测试 6；正则会错的用例正确；本质限制不产按钮）
- [ ] P4-4：`languageSyntax.ts` 已删除、无正则残留护栏绿；菜单无重复入口
- [ ] 门禁：`pnpm test:run` / `pnpm type-check` / `pnpm lint:fe` / `pnpm lint`

### 门禁命令

```bash
pnpm test:run && pnpm type-check && pnpm lint:fe
pnpm lint   # 本轮无 Rust 改动，跑一遍确认护栏未破
```

### P4 实施记录（进行中）

#### P4-1 完成：契约 + 共享工具

- `syntax/contract.ts`：`SyntaxDoc` + `TestDiscoverer` / `MainDiscoverer`。
  **不引入并行类型名** —— 目标形态直接复用既有 `TestCaseInfo` / `MainEntry`（为同一概念起两个名字
  正是 code-reuse 模式 5）。
- `syntax/lezer.ts`：`rawText` / `nodeLine`(1-based) / `childOfType` / `childrenOfType` /
  `findDescendant`(不含自身) / `walk`(**迭代式，显式栈**) / `stringValue`(剥配对引号、**不反转义**)。
- **依赖处理（实施期决策）**：`@lezer/common` 不在根 node_modules（pnpm 严格），`@codemirror/language`
  又不 re-export `Tree`/`SyntaxNode` → 类型从 `syntaxTree` 返回类型**派生**，**零清单/lockfile 改动**。
  护栏测试断言 `lezer.ts` 无 `@lezer/*` 直接 import。
- 验证：11 用例绿；`tsc` 绿；**变异检验**（去掉「自身不算后代」→ 1 红）确认断言有效。

#### P4-2 TS 迁移完成

- 新增 `syntax/parsers.ts`（`RunLang → @codemirror/lang-*.parser` 唯一映射）+ `syntax/ts.ts`
  （`discoverTsTests`）。
- 注册表改**双字段过渡**：已迁移语言提供 `discoverTests`/`discoverMains`（AST，优先），
  未迁移保留 `parseTestCases`/`parseMainEntries`（正则）→ **每语言可独立迁移，不一次改坏 4 个语言**。
  `parseTestCases(fileName, docText, tree?)`：`tree` 可选，缺省用该语言 parser 现场解析（**非回退正则**）。
- 删除 TS 正则：`testCases.ts` 的 `TS_TEST_LINE` + `parseTsCases` 已删（死代码）。
- **显式记录的一处行为改进**（非静默）：旧正则要求调用在**行首**，故 `const runIt = it('x')` 不被识别
  —— 那是正则无法区分「真调用/注释/字符串」的妥协。AST 能区分，且该行运行时**确实注册测试** → 现在识别。
  测试已改名并注明理由（`should_detect_test_calls_not_at_line_start`）。
- **测试夹具修正**：`should_ignore_comment_lines` 旧夹具第 3 行 ` * it(...)` 因上一行 `*/` 已闭合而是
  **非法 JS**（旧正则靠「trim 后以 `*` 开头」启发式跳过）；改用**真实多行块注释**形态。
- 验证：`testCases.test.ts` 43 用例绿（+3 新增：嵌套 describe、字符串内假调用、行首限制改进）；
  编辑器全量 **72 文件 / 765 用例**绿；`tsc` 绿。

#### 实施期发现：`syntaxTree(state)` 不可用于 gutter（设计已更正）

原设计写「生产走 `syntaxTree(state)` 复用增量树」。**实测/分析后证否**：CM6 按工作预算**惰性**解析，
`syntaxTree(state)` **不保证覆盖全文**（大文件初始可能只有视口附近有树）→ 用它建 marker 会**静默漏掉**
文件后半的用例/main（测试中更因未挂载语言而拿到空树，导致 14 个 gutter 用例失败并暴露此问题）。
**处置**：gutter **不传** state 树，由 `parseTestCases` 用语言 parser 解析原文 —— 结果确定且完整，
成本与改动前的全文本正则扫描同级。design §7.9.3 已更正。

#### P4-2 Rust 迁移完成

新增 `syntax/rust.ts`：`discoverRustTests` + `discoverRustMains`（**用例与 main 同批迁移**）。

**实测 AST 形态（`@lezer/rust@1.0.2`）与三个必须注意的点**：
1. `AttributeItem → Attribute(→ MetaItem) + FunctionItem` —— 属性与其修饰的 item 是**父子**关系；
2. **多属性是多个 `Attribute` 兄弟**（`#[test] #[ignore]` 同行、或分行叠加）→ 必须遍历**全部**
   `Attribute` 子节点，不能只看首个（**已加变异检验用例**：`#[ignore] #[test]` 若只看首个即漏）；
3. 带参属性取 **`MetaItem` 的首个 `Identifier`/`ScopedIdentifier`**（`ScopedIdentifier` 文本即
   `tokio::test`，不含参数）→ `#[tokio::test(flavor = "multi_thread")]` 正确识别；
   `#[cfg(test)]` 的属性名是 `cfg`（其子 `Identifier "test"` 不是属性名）→ 天然不误判。

**两处显式记录的正确性改进**：
- 旧实现 `startsWith('#[tokio::test')` 会**过度匹配** `#[tokio::testing]`；新实现精确匹配属性名
  （已加测试 `should_not_over_match_tokio_prefixed_attributes`）。
- `#[tokio::main] async fn main()` 与 `fn main` 在 AST 下**结构相同** —— 旧实现需两个正则且曾因
  `RUST_MAIN_LINE` 不含 `async` 而漏识别；这类漂移在 AST 下从根上不再可能。

**退役的正则与测试**：`testCases.ts::parseRustCases`、`mainEntries.ts::parseRustMain`、
`languageSyntax.ts::RUST_FN_DECL`（含 `RUST_FN_MODIFIERS`）全部删除；
其专属测试（`languageSyntax.test.ts` 的 3 条 Rust 用例）一并退役（修饰符组合已由
`mainEntries.test.ts` 覆盖；属性→fn / main 由 Rust 的 AST 用例覆盖）。`languageSyntax.test.ts`
头注已更新为「Rust 已迁 AST，本文件待 Go/Java 迁完后整体删除」。

**验证**：Rust 相关 46 + main 用例绿；编辑器全量 **72 文件 / 765 用例**绿；`tsc` 绿；
**变异检验**（只看首个 `Attribute` → 仅「测试属性非首位」用例红）确认断言有效。

#### P4-2 Java 迁移完成

新增 `syntax/java.ts`：`discoverJavaTests` + `discoverJavaMains`（用例与 main 同批）。

**实测 AST 形态（`@lezer/java@1.1.3`）与两个关键点**：
1. **`void` 是字面 token**（`MethodDeclaration → void`），非 void 方法为具体类型节点
   （`PrimitiveType "int"`）→ 「必须 `void`」从正则约束变成**结构判断**（变异检验：去掉该检查 →
   仅 `should_ignore_non_void_and_non_line_start_methods` 变红）。
2. **varargs 与数组的包装层级不同**（实施期发现、会静默丢掉 varargs main）：
   - `String[] args` → `FormalParameters → FormalParameter → ArrayType → TypeName "String"`
   - `String... a`   → `FormalParameters → **SpreadParameter**`（**直接子节点，无 `FormalParameter` 包装**）
   若只数 `FormalParameter`，varargs main 会被判空。已修正并加用例（`String...` 变体在
   `mainEntries.test.ts` 覆盖）。

其它形态：注解分 `MarkerAnnotation`（无参）/`Annotation`（带参）；`@Test` 挂在**字段**上是
`FieldDeclaration` → 天然跳过；`Modifiers` 内 `MarkerAnnotation` 与 `static` 各归其位（
`JAVA_MAIN_DECL` 那个「修饰符可交错 + `String[]`/`String...`/`final`」的复杂正则退化为平凡判断）。

**显式记录的正确性改进**：旧 `^@([\w$]*Test)\b` 锚定行首且不含 `.` → **FQN 注解
`@org.junit.jupiter.api.Test` 不命中**；新实现按名字后缀判定 → **命中**（已加测试）。

**退役的正则**：`testCases.ts::parseJavaCases`、`mainEntries.ts::parseJavaMain`、
`languageSyntax.ts` 的全部 Java 常量（`JAVA_MODIFIERS` / `JAVA_MODIFIERS_NO_STATIC` /
`JAVA_VOID_METHOD_DECL` / `JAVA_MAIN_DECL`）删除；`languageSyntax.ts` 现**仅剩 Go**。
其专属测试（`languageSyntax.test.ts` 的 Java 用例）退役，覆盖改由 AST 测试承接并**补齐**：
`main()` 无参 / `main(int)` 不识别、多修饰符组合识别、带注解与 FQN 注解的 void 方法识别。

**验证**：`utils/__tests__/` 271 用例绿；编辑器全量 **72 文件 / 765 用例**绿；`tsc` 绿；
变异检验确认「必须 void」为有效断言。

#### 实施期发现：AST 要求语法结构可识别（Java 尤甚）

`runLanguages.test.ts` 原有两个**没有 `class` 的裸方法**夹具（`'@Test\nvoid t() {}'`、
`'public static void main(String[] args) {}'`）—— 那是**非法 Java**，旧行正则仍能识别（纯文本匹配），
而 AST 给出错误树 → 不产目标。**处置**：夹具改为合法类体（其意图是验「按扩展名分发」，不是验裸方法），
并把该差异记入 design §7.9.5 的契约边界。


#### P4-2 Go 迁移完成 —— **四语言迁移全部完成**

新增 `syntax/go.ts`：`discoverGoTests` + `discoverGoMains`（用例与 main 同批）。

**实测 AST 形态（`@lezer/go@1.0.1`）的关键点**：
- **接收者方法是另一种节点**：`func (s *Suite) TestMethod(t *testing.T)` 是 `MethodDecl`（且**无直接
  `DefName`**），而普通函数是 `FunctionDecl` → 「排除接收者方法」从正则约束（旧实现靠
  `^func\s+[A-Za-z_]` 间接排掉 `func (`）变成**结构事实**；
- 注释 / 字符串内的 `func TestX` 不是 `FunctionDecl` → 天然不误报；
- `Test*` → 用例、`Benchmark*` → `kind: 'benchmark'`、其余（`Example*`/`Fuzz*`/helper）不检测
  —— 与旧实现一致；**不做签名校验**（与旧实现一致，误报由零命中告警兜住）。

**退役（此时四语言全部迁完，收口提前完成一半）**：
- `testCases.ts::parseGoCases`、`mainEntries.ts::parseGoMain` 删除；
- **`utils/languageSyntax.ts` 整体删除**（其存在的唯一理由是「声明形态的唯一落点」，
  四语言 AST 化后无任何消费者）；其专属测试 `languageSyntax.test.ts` 一并删除
  （Go 接收者排除 / 注释免疫在 Go 的 AST 用例中已覆盖）。
- `utils/mainEntries.ts` 收敛为**纯类型模块**（`MainLang` / `MainEntry`）+ 历史说明；
- `utils/testCases.ts` 头注重写（原头注描述已迁走的行正则并引用了已删除的 `languageSyntax.ts`）。

**验证**：`utils/__tests__/` 270 用例绿（新增 Go AST 用例：字符串内 `func TestFake` 与
接收者方法均不产用例）；编辑器全量 **71 文件 / 765 用例**绿（71 因删除 `languageSyntax.test.ts`）；
`tsc` 绿；eslint 0 error。

#### P4-3 完成：Go 表格驱动子测试（逐行按钮）—— 原始需求落地

新增 `syntax/goTable.ts`，并在 `discoverGoTests` 末尾 `push(...discoverGoTableSubtests(sd))`
（gutter 按行号排序，混排无需额外处理）。

**实现的算法（全部结构推导，无文本猜测）**：
`FunctionDecl(Test*)` → 其 `Block` 内 `VarDecl`（值为 `TypedLiteral`）→
`SliceType → StructType → StructBody → FieldDecl → FieldName` 得**字段序** →
`LiteralValue → Element → LiteralValue` 得**每行** →
`ForStatement → RangeClause`（末个 `DefName` = 循环变量；`VariableName` = 表名）→
该循环体内 `CallExpr`（callee = `SelectorExpr(VariableName, FieldName "Run")`）
首参 `SelectorExpr(loopVar, field)` 得**名字字段** → 逐行取该字段值（位置式按字段序、键式按 `Key`），
要求 `String` 字面量 → 复刻净化 → `name = '<父>/<净化后>'`、`line` = **元素行**。

**净化复刻（P4 的核心正确性点）**：`sanitizeGoSubtestName` 逐字按 Go 源码 `testing.isSpace`
的集合实现空白 → `_`（1:1），**刻意不用 JS `\s`**（含 `\uFEFF` 等 Go 不认的字符）；
含不可打印 rune → `null`（放弃）。**变异检验**：把净化改成不做事 → **3 个用例红**（含用户夹具），
证明它是承重断言。

**真实端到端验证（真机）**：用 `/tmp/fibprobe`（用户贴的 `TestFib` 夹具）逐个执行实施产出的选择器：

```
-run '^TestFib$/Negative_input$'   → 执行子测试数 1
-run '^TestFib$/Zero_input$'       → 1
-run '^TestFib$/Base_case_1$'      → 1
-run '^TestFib$/Base_case_2$'      → 1
-run '^TestFib$/Small_number$'     → 1
-run '^TestFib$/Medium_number$'    → 1
```

即**每一行的按钮都精确只跑那一个子测试**（不是跑整表）—— 这正是最初的需求。

**本质限制**（不产按钮，非妥协；已逐条测试）：净化后重名（运行时 `#01` 后缀由碰撞顺序决定）、
名字非字符串字面量（变量 / `Sprintf`）、命名 struct 类型、含转义的字面量、无 `t.Run` 绑定。
另：**内联 `[]string` 表**（`for _, n := range []string{"x","y"}`）首期未覆盖（另一种惯用法，见 design §7.8.7）。

**顺带收益（零额外成本）**：表格行现在也是「源码侧用例」，故 `testStatusContribution` 按
`TestFib/<sub>` 查状态 → **每行独立显示通过/失败状态**。

**未做（明确推迟，非遗漏）**：菜单去重（动态发现的子测试若已是静态用例则不重复列出）。
计划本身约束「不引入新全局状态」，而静态用例名在 `useRunActions` 层不可得（文档文本只存在于
CodeMirror view）→ 需要把静态用例名经 `FileEditor` 传下来。当前重复仅是**冗余展示**（非错误行为），
故按约束留作后续小项。

#### P4-4 完成：收口

- **过渡期字段全部删除**：`RunLanguage` 的 `parseTestCases?` / `parseMainEntries?` 与分发中的
  回退分支移除；`discoverTests` / `discoverMains` 变为**必填** → 「新增语言必须提供 AST 实现」
  由**编译器强制**，不可能再退回逐行正则机制。
- **新增收口护栏** `syntax/__tests__/noRegexDiscovery.test.ts`（4 条）：
  1. `languageSyntax.ts` 已不存在；
  2. 发现模块不含 `new RegExp` / `.exec(` / `.match(`（`ts.ts` 的 `String.replace(/…/)` 是**值反转义**
     而非结构匹配，明确不在禁止之列）；
  3. 注册表无任何语言实现文本发现入口；
  4. 四个语言表项各有 `discoverTests` / `discoverMains`。
  **变异检验**：往发现模块加回一处 `new RegExp` → 仅第 2 条红，证明护栏有效。


#### 性能专项：AST 发现的成本（用户提问驱动，含实测与修复）

**起因**：用户问「在前端进行语法解析会有什么性能问题」。不凭感觉，做了基准测量（vitest，生成 N 个
`func TestXxx` 的 Go 文件，对比迁移前的行扫描基线、裸解析、以及发现总耗时）。

**测量暴露了三个问题（比预期严重）**：

| 尺寸 | 旧行扫描 | 裸解析 | **修复前发现总耗时** | 修复后 |
|---|---|---|---|---|
| 5 KB | 0.0ms | 1.3ms | 3.2ms | **1.8ms** |
| 44 KB | 0.1ms | 11.9ms | 46.7ms | **13.5ms** |
| 179 KB | 0.5ms | 48.0ms | **426.5ms** | **52.4ms** |
| 448 KB | 0.9ms | 123.3ms | （推算 ~2.5s） | **134.5ms** |

1. **`nodeLine(docText, pos)` 是 O(pos) → 聚合二次方**（主因）。它不是「扫一遍」，而是**按位置从 0 数
   `\n`**；发现过程要为**每个**目标求行号 → O(文件大小 × 目标数)。
   实测固定 2000 次查询：5 KB → 4.8ms；44 KB → 49ms；179 KB → **193ms**（占 426ms 的近一半）。
2. **同一文档被解析两遍**：`gutter` 分别调 `parseTestCases` 与 `parseMainEntries`，各自整篇解析。
3. **同一棵树被遍历两遍**：`discoverGoTests` 与子测试发现各起一次全树 `walk`。

**修复**：
- `lezer.ts` 用 **`createLineLookup(docText)`**（O(n) 建索引一次 + O(log n) 二分查询）**取代** `nodeLine`；
  **刻意不保留逐次扫描版本** —— 让「误用成二次方」在 API 层不可能发生。护栏测试钉住该形态。
- 新增 **`discoverRunTargets(fileName, docText, tree?)`**（gutter 专用批量入口）：**最多解析一次**，
  两个发现共用同一棵树。
- gutter 改为 **`ensureSyntaxTree(state, doc.length, 50ms)`** 复用编辑器**增量树**（必须保证覆盖全文 ——
  直接 `syntaxTree(state)` 不可靠：CM 按工作预算惰性解析，大文件可能只有视口附近有树 → 会静默漏目标）；
  拿不到则回落到 `discoverRunTargets` 内部的一次整篇解析。
- `discoverGoTests` 改为**单次遍历**同时产出顶层用例与表格子测试（`goTable` 导出 `collectTableSubtests`
  按函数收集，不再自带全树 walk）。

**结论（诚实陈述）**：
- 二次方已消除，**179 KB 从 426.5ms 降到 52.4ms（8.1×）**，且 179→448 KB（体积 2.5×）耗时涨 2.5× → **线性**。
- 但 AST 发现相对旧行扫描**仍是约 100× 的量级**（179 KB：0.5ms → 52ms），其中 **92% 是解析本身**；
  这是「结构化分析 vs 文本扫描」的固有代价，也是换取正确性的代价。
- 可接受性：marker 重建发生在挂载时 + 编辑防抖（~300ms）之后，**不是每键**；典型测试文件
  （5–44 KB）为 1.8–13.5ms，可接受；数百 KB 的异常大文件会有一次可感知的一次性停顿。
- **`ensureSyntaxTree` 复用增量树带来的节省本次未能量化**（基准里没有「语言已挂载且树已完整」的
  CodeMirror state）—— 生产上它能把解析成本降到接近 0，但**未经实测，不作断言**。

##### 补充验证：增量树复用的收益（接上节「未量化」项）

**方法**：先 `ensureSyntaxTree(state, doc.length, 10s)` 把挂载了 `go()` 的 `EditorState` 的树解析完整
（等价于「CM 已解析完」），再对比冷路径 / 热路径。临时基准，测量后删除（时间断言不适合作常驻测试）。

| 尺寸 | 冷（含解析） | **热（复用）** | `ensureSyntaxTree` 命中 | 纯发现（遍历） | 提速 |
|---|---|---|---|---|---|
| 5 KB | 2.7ms | **0.3ms** | 0.0ms | 0.2ms | 9× |
| 44 KB | 14.3ms | **1.2ms** | 0.0ms | 1.1ms | 12× |
| 179 KB | 55.0ms | **4.4ms** | 0.0ms | 4.3ms | 12.5× |
| 448 KB | 138.8ms | **11.3ms** | 0.0ms | 11.4ms | 12.3× |

**结论**：
1. 树完整时 `ensureSyntaxTree` **命中开销 0.0ms**（取现成的树）；复用收益 **≈12×**，且**随文件增大而扩大**；
2. 即便树**未**完整也不重复解析 —— `ensureSyntaxTree` 延续的是 CM 同一棵增量树的解析（同一 `ParseContext`），
   不是另起一次独立全量解析。这是本方案相对「第二套解析器（如 tree-sitter）」的关键差别；
3. 复用生效后，**瓶颈从解析转为我们自己的遍历**（448 KB：11.4ms），且线性。若将来要再压，
   杠杆在遍历的**访问节点数**（Lezer 无索引，只能走树；Go 的顶层函数与表格/循环多为**直接子节点**，
   可改成「按层定向访问」而非全树 `walk`，量级上能省一个常数）—— 本轮不做。

**未能验证**：生产上「发现运行时树是否已完整」在 jsdom 里测不出（无真实 idle 回调，
`syntaxTreeAvailable` 等待空转后仍为 false）。按 CM 调度模型推断为「持续编辑时通常已完整；
刚打开时可能仍在解析中 → `ensureSyntaxTree` 最多花 50ms 或返回 null 回落整篇解析」，但**未经实测**。

#### 性能专项 2：遍历成本 —— 从 O(文件) 降到 O(声明)（本轮实现）

**问题**：复用增量树后瓶颈转到**我们自己的遍历**（448 KB：11.4ms）。全树 `walk` 的访问量与
「整个文件的节点数」同阶，而目标（声明 / 表格 / 循环）都挂在更外层 —— 函数体占了节点量的大头，
却完全不需要进入。

**设计决策：默认下钻 + 剪枝（`cut`），不用「容器白名单」**。
曾考虑「只穿过容器类型」的白名单形式，**否决**：白名单漏写一个容器类型 = **静默漏掉**该分支下
全部目标，而漏目标正是本项目最不愿接受的失效方式（design「宁可没有按钮，也不给错按钮」）。
剪枝形式下，漏写只是**少省一点**，不会漏目标。

新增共享原语 `lezer.ts::walkPruned(root, cut(node, parent), visit)`（迭代式、双并行栈避免每节点对象分配）；
`walk` 保留但标注「会访问全部节点，发现路径优先用 `walkPruned`」。

**各语言的 `cut`（均经实测确认不会丢目标）**：

| 语言 | 剪掉的子树 | 关键实测依据 |
|---|---|---|
| Go | 全部 `Block`（函数体） | 表格识别**不走**该遍历：`collectTableSubtests` 从 `FunctionDecl` **定向导航**（→ `Block` → `VarDecl`/`ForStatement`）并在循环体内做**有界**遍历 |
| Rust | 全部 `Block`（函数体） | **`mod tests { … }` 的体是 `DeclarationList` 而非 `Block`** → 剪 `Block` 不会丢 `mod` 内测试（该行为有既有测试断言） |
| Java | 全部 `Block`（方法体） | 嵌套类挂在 `ClassBody`（非 `Block`）下 → 剪 `Block` 不影响 `@Nested` 里的方法（P3.2 场景） |
| TS | **已匹配 test/it 调用的 `ArgList`**（含回调体） | 名字已取到，测试体与用例发现无关；`describe` 的 `ArgList` **不剪**（其回调体内有嵌套用例）。`isTestCall` 抽成函数供「命中判定」与「剪枝判定」**共用**，避免两处判定漂移（模式 5） |

**实测（贴近真实的夹具：函数体含 20 条语句；仅测量，测后删除基准）**：

| 尺寸 | 全部节点 | 剪枝后 | 占比 | 纯发现 | 同树遍历 A/B（全量 vs 剪枝） |
|---|---|---|---|---|---|
| 66 KB | 34,049 | 771 | **2.3%** | 0.4ms | 0.5ms vs 0.0ms（15.8×） |
| 657 KB | 339,779 | 7,521 | **2.2%** | 3.2ms | 4.6ms vs 0.2ms（**29.7×**） |
| 2.6 MB | 1,359,029 | 30,021 | **2.2%** | 13.5ms | 20.6ms vs 0.6ms（**32.2×**） |

**结论**：
1. **访问节点量降到 2.2%（≈45× 减少）**，遍历本身**快约 30×**，且随文件增大**趋于稳定**（不再随文件线性）。
2. **发现耗时不再由遍历主导**：2.6 MB 的 13.5ms 里遍历仅 0.6ms，其余是**每目标的固定工作**
   （≈4.4µs/目标：`createLineLookup` 一次 O(n) 建索引、子节点查询、表格导航、名字切片与净化）。
   这是当前的下限，且与**声明数**而非文件大小同阶 —— 符合第一性原理：**成本应正比于我们关心的构造数量**。
3. **行为未变**：既有 300 用例（含 Go 表格子测试、Rust `mod` 内嵌、Java 嵌套类、TS 嵌套 describe /
   注释免疫 / 字符串免疫）**全绿** —— 剪枝的正确性由既有测试作为安全网验证。

**三层成本模型的终态**（本轮把三层都做对了）：
```
发现总成本 = 解析（可复用编辑器增量树 → 通常 ≈0）
           + 遍历（剪枝后 O(声明数)，≈30× 更快）
           + 每目标固定工作（≈4.4µs/目标，与声明数同阶）
```

##### 生产实测：增量树复用**已确认成立**（临时埋点，验证后已删除）

**方法**：在 `runContribution.ts::buildTestCodelensMarkers`（真实生产路径）临时埋点，记录
`ensureSyntaxTree` 耗时（关键读数）、`discoverRunTargets` 耗时、`treeHit`、文档大小与目标数，
经既有前端→Rust 日志通道（`logFrontendError`，`shared/utils/errorReporting.ts` 是唯一 invoke 事实源）
落到 `~/.neeko/neeko.log`。用户真实使用后读日志；**埋点与调用点已整体删除**（无残留）。

**样本**：23 条 / 4 个真实文件（2–18 KB），覆盖 Go / Rust / TS / Java 四种语言。

| 分组 | n | `ensureMs` 中位 | 最大 | `ensureMs == 0` 占比 |
|---|---|---|---|---|
| **首次**（刚打开，树未就绪） | 4 | 4.0ms | 6ms | 0/4 |
| **后续**（持续编辑） | 19 | **0ms** | **0ms** | **19/19** |

**结论**：
1. **`treeHit` = 23/23（100%）** —— 每次都从编辑器取到树，**从未回落整篇解析**；
2. **持续编辑时 `ensureMs` = 0ms（19/19）** —— `ensureSyntaxTree` 是「取现成的树」，
   发现路径的**解析成本为 0**。**这就是此前唯一未闭合的一环，现已在生产确认**；
3. **首次打开仅 2–6ms**（远低于整篇解析代价）→ 即便树未就绪，搭的也是编辑器**同一棵树**的解析，
   **不重复解析**（API 契约 + 实测一致）；
4. `discoverMs` 中位 **1ms**；四语言在真实项目均产出目标（Go 8 / Rust 10 / TS 11 / Java 5）
   —— 顺带证明发现逻辑在真实工程可用，不只在测试里通过。

**边界（不夸大）**：样本为**小文件**（2–18 KB）、单次会话、23 条；**数百 KB 的大文件未做生产实测**
（该区间只有基准数据：复用收益 ≈12×）。「首次 4ms vs 后续 0ms」的分野清晰，且 `ensureMs=0`
只能是「树本已完整」（符合库契约），故该推断可靠。

**三层成本模型 —— 三层均有实测支撑**：
```
解析     树完整时 ≈0ms      ← 生产实测（19/19 零成本）
遍历     剪枝后 O(声明数)    ← 基准实测（节点量 2.2%，遍历快 ≈30×）
每目标   ≈4.4µs/目标        ← 基准实测；生产 discoverMs 中位 1ms
```

## neeko-check 审查修复（2026-09-11，三轮）—— 高内聚 / 低耦合 / 可扩展性

**范围声明**：本轮变更集**零 Rust 改动**，故 13 支柱中 Rust 侧各条（覆盖率、`#[cfg]` 三端、
Tokio 阻塞隔离、路径 canonicalize、Skinny Command、if-let 嵌套、mod.rs 瘦身）**无对象可审**。

### 审查发现的 4 条（均已修复）

| # | 问题 | 性质 | 修复 |
|---|---|---|---|
| **F1** | `findDescendant` 为死代码（生产零使用，仅测试在用 = 虚假覆盖率） | YAGNI | 删除函数 + 其测试块 |
| **F4** | `ts.ts` 与 `goTable.ts` 各定义一份标点集合，**已轻微漂移**（一方多 `.`） | 自我违反 spec「模式 5」 | 上提为 `lezer.ts::isPunctuationNode` + `PUNCTUATION_NODES`（取并集），两处改引用 |
| **F2** | `parseTestCases` / `parseMainEntries` **生产已死**（唯一生产入口是 `discoverRunTargets`），且与它**三处重复门控** | 高内聚 / 漂移风险 | 删除两导出；测试改走真实生产入口 `discoverRunTargets(...).tests/.mains`（门控语义逐条核对等价） |
| **F3** | `utils/ ↔ syntax/` **双向依赖**（`syntax/*` 反向取 `utils/*` 的类型） | 低耦合 / 分层颠倒 | 三类型下沉到 `syntax/contract.ts`，`utils/*` 改为 **type 再导出**，`syntax/*` 改指 `./contract` → 依赖**彻底单向** `utils → syntax` |

**F3 的精确性（不夸大）**：原状全部是 `import type`，**运行时无环** —— 问题在分层语义，不是运行时故障。

### runContribution.ts 优化：442 行 → 219 行（按变更原因拆 4 模块，依赖无环）

| 模块 | 行数 | 职责（单一变更原因） |
|---|---|---|
| `runTarget.ts` (L0) | 60 | 输入契约与目标身份（`RunTarget` / facet / 行号与语言派生）—— 外部消费方（`runner/*`、`hooks/*`）直接导入处 |
| `runLspOverlay.ts` (L0) | 31 | tier ① LSP 覆盖的**状态定义**。**必须为叶子层**：被读方（markers 构建 payload）与写方（异步 loader）同时使用，放进任一方都会形成 `markers ↔ contribution` 循环 |
| `runMarkers.ts` (L1) | 168 | 文档 → markers 的同步重建 + 图标外观（性能红线所在） |
| `runContribution.ts` (L2) | 219 | 异步 tier ① 拉取、扩展装配、贡献与公开查询 API |

**顺带修掉的文档缺陷**：原 `buildTestCodelensMarkers` 上方残留**两段互相矛盾**的注释（一段描述已被
否决的 `parseTestCases` 方案，另一段是现行 `ensureSyntaxTree` 方案）→ 重写为单一自洽说明。

**新增 2 条分层护栏**（均做变异检验确认有效）：
- `syntax/__tests__/layering.test.ts`：`syntax/` 不得 `import '../utils/'`；契约类型定义在 `contract.ts`；`utils/` 以再导出保持路径。
- `gutter/__tests__/layering.test.ts`：四模块依赖单向（L0 不依赖上层 / L1 不依赖 L2 / API 仍在 L2）；`RunTarget` 由 L0 持有。

### 验证

| 项 | 结果 |
|---|---|
| 迁移后测试 | `runContribution.test.ts` 等 16 个 gutter 用例改为按新模块导入；编辑器全量 **74 文件 / 785 用例**绿 |
| 变异检验 | gutter 分层护栏（L0 反向依赖 → 仅该条红）✅ |
| 门禁 | `pnpm lint:fe` 全绿 · `tsc` 无错 · eslint 0 error |

## neeko-check 第二轮（审查修复本身）—— 3 项已修

第一轮修复（F1–F4）本身正确，但**拆分动作引入了 2 处新问题**；第二轮同时覆盖了上轮未查的面。

| # | 问题 | 性质 | 修复 |
|---|---|---|---|
| **F5** | `discoverRunTargets` **先解析、后门控** —— 两路门控都不需要时仍白解析全文。这是 F2 合并两个入口时引入的（旧入口都是「先门控、后解析」） | 潜在陷阱（当前无影响） | 改为**先门控后解析**：两路都不需要时直接返回空，不进解析 |
| **F6** | `DEFAULT_DEBOUNCE_MS` 定义在 `gutter/runTarget.ts`（「目标身份」），唯一消费者却是装配层的 `createRunCodelensCore` | 内聚瑕疵（**上轮拆分我引入**） | 移到 `runContribution.ts` 并**降为模块局部常量**（不进公开面） |
| **F7** | `utils/mainEntries.ts` 退化为「零逻辑、只 re-export」的**兼容垫片** | 违反工程准则「禁止为保持路径而 re-export 类型」 | **删除该文件**；6 个导入方直导 `syntax/contract`；测试文件更名 `mainDiscovery.test.ts`；分层护栏断言同步为「垫片不得存在」 |

**F5 的诚实补充**：当前四语言在 gutter 调用点**必有一路命中**（TS 的 `isRunnableFile ≡ isTestCaseFile`；Rust/Go/Java 的 `hasMain ≡ true`）→ 现状**无实际性能影响**；但这是**语言集合的巧合**，不该固化成契约，故仍按潜在陷阱修掉并在注释中写明。

**F9（未修，需决策）**：`debug/api/debugBuildApi.ts` 手写 `DebugBuildSpec` / `DebugBuildResult` 两个 IPC 类型，与支柱 13（要求 tauri-specta `bindings.ts`）不符。**但这属项目级既有冲突**（`Cargo.toml` 无 specta 依赖、全仓库手写 `invoke<{…}>`），本次仅新增 1 例。**不作擅自修改**：要么项目引入 specta 全局改造，要么修订支柱 13 措辞 —— 需产品/架构决策。

**第二轮通过项（附证据）**：无新增超限 React 组件（>300 行者全为测试 + 2 个存量源文件）；新增代码零跨 feature 门面导入；无硬编码路径分隔符（扫描的 2 处命中经核实为误报：Go 转义检测、TS 字符串反转义）；未新增 `listen()` / Tauri 事件名。

**验证**：编辑器 **75 文件 / 789 用例**绿（74/785 + gutter 分层护栏 1 文件 4 用例 ✓ 数目自洽）；`tsc` 无错；eslint 0 error。

## neeko-check 第三轮 —— 3 项已修（引入**系统性死导出扫描**）

第二轮靠抽查，第三轮改为**对全部新模块导出符号统计外部引用**（方法论升级：F1/F10 表明
「为将来预留的 API」是我的**重复模式**，抽查抓不全）。

| # | 问题 | 性质 | 修复 |
|---|---|---|---|
| **F10** | `TestDiscoverer` / `MainDiscoverer`（`syntax/contract.ts`）零引用、**不在任何导出签名里** → 纯死代码。**与 F1 同类，删 F1 时漏了同文件的这两个** | 死代码（YAGNI） | 删除两个类型别名 |
| **F11** | **设计文档的契约块与实现有 5 处不符**：`TestTarget`/`MainTarget`（**从未创建**，实际复用 `TestCaseInfo`/`MainEntry`）、`nodeLine`（已被 `createLineLookup` 取代）、`findDescendant`（F1 已删）、`Tree`（实际是派生的 `SyntaxTree`）、`stringValue` 声称"反转义"（实则**刻意不反转义**）；另有**参数顺序**漂移（文档 `(node, doc)` vs 实现 `(docText, node)`） | 文档漂移 | 重写契约块，逐条对齐实现（含参数顺序、`walkPruned`、`discoverRunTargets` 的"先门控后解析"） |
| **F12** | `PUNCTUATION_NODES` 属不必要的公开面（仅经同文件的 `isPunctuationNode` 使用） | 面收敛 | 降为模块局部常量 |

### 扫描的局限（如实说明，2 个"零引用"是**设计内误报**）

`RunContributionOptions`（`runContribution.ts`）与 `JavaSymbol`（`javaDocumentSymbol.ts`）也被标为 0 引用，
但**它们是导出函数签名的一部分**（`createRunContribution(options: RunContributionOptions)`、
`parseJavaSymbols(): JavaSymbol[]`），调用方可命名 → 属**正当公开面**。扫描按"文本引用次数"判定，
无法区分「签名成员」与「死代码」。

### 日志 vs spec 的界线（本轮澄清并执行）

`implement.md` 里 P4-1 记录仍写着交付过 `findDescendant` / `TestDiscoverer` —— 那是**历史日志**，
记录「当时交付了什么」，其后 F1/F10 行已记录删除，**自洽**，故**不改历史**。
但 `design/` 是**规格文档**（后续工作的依据）→ 必须反映**当前实现** → 故 F11 只重写了 design，未动 implement 的历史段。

### 第三轮通过项

`isTestFile` 唯一生产调用**传了 docText**（不会绕过 Java/Rust 的内容判定）✓；F5/F7 的连带影响
经 `tsc` 全绿与护栏同步验证 ✓；组件行数 / Firewall / 路径分隔符 / 事件注销同前两轮 ✓；
Rust 侧各支柱**无对象可审**（零 Rust 改动）。

**验证**：编辑器 **75 文件 / 789 用例**绿；`tsc` 无错；eslint 0 error。

## neeko-check 第四轮 —— 无 Block 级问题，2 项诚实性记录

前三轮已清空全部 Block 级问题（F1–F12）。第四轮只剩「可追溯 / 诚实记录」类收尾：

| # | 内容 | 落点 |
|---|---|---|
| **F13** | 剪枝遍历（`walkPruned` 剪函数体 `Block`）带来的两处行为收窄**刻意记录**并附**真机证据** | `design/runnable-detection.md` §7.9.5 |
| **F14** | TS 统一用基础 JS 方言（`@codemirror/lang-javascript` 未开 `typescript/jsx`）是**刻意**选择，注释说明理由与实测结论 | `syntax/parsers.ts` 文件头注释 |

### 第四轮的实质发现：两处「漏检」不是回归（真机证实本就不可运行）

跑临时探针（已删除）发现两类嵌套目标不再产按钮，随后真机验证它们**根本无法被执行** ——
故「不产按钮」恰是正确行为（契约原则：宁可没有按钮，也不给点了跑 0 个的按钮）：

| 形态 | 真机证据 |
|---|---|
| **Java：方法体内的局部类**里的 `@Test` | `-c LocalTest` 只跑 `testTop`；显式寻址 `LocalTest$1Local#testInsideLocal` → **0 tests found**（JUnit 只扫描顶层/成员类） |
| **Rust：函数体内的 `mod`** 里的 `#[test]` | `cargo test -- --list` 只列 `test_top`；按名跑 → `0 tests` |

这不只是性能优化 —— 剪枝顺带**结构性**排除了不可能运行的目标（机制上不可能再给错按钮）。

## P4-3 收尾：菜单去重（此前推迟项的落地）

**原推迟理由**（见上方 P4-3 段）：静态用例名在 `useRunActions` 层不可得（文档文本只存在于
CodeMirror view）。本轮的解法**不需要新全局状态、也不需要把文档向下传** —— 让**拥有源码事实的
marker 层**把结果挂到已有的 `RunTarget` 载荷上：

| 层 | 动作 | 为什么在这层 |
|---|---|---|
| `utils/runLanguages.ts` | `staticSubtestsByParent(tests)`：扁平发现结果按**每一层祖先前缀**归组（`T/a/b` 同时进 `T` 与 `T/a`；与 Go `-run` 层级锚定同构）。无子测试**不建键** | 纯函数，与 `discoverRunTargets` 同域，可脱离 EditorState 单测 |
| `gutter/runMarkers.ts` | 建 marker 时把该父用例的静态子测试名挂到 `RunTarget.staticSubtests` | 这里**已有全量静态发现结果**，零额外解析（不破坏「最多解析一次」红线） |
| `hooks/useRunActions.ts` | 动态列表**减去** `staticSubtests`（**全名精确**匹配）→ 全被剔除则整段省略，不出现空分隔条 | 动态发现的读取点；静态名随目标天然到达，无需文档 |

**关键取舍：精确同名，而非前缀包含。** 静态只覆盖一层（表格元素），动态可能更深。
若按前缀剔除，`T/a` 有静态按钮会连带隐藏动态独有的 `T/a/b` —— 而后者正是动态路线的价值
（`Sprintf` / 变量 / 净化后重名组），两条路线必须**互补**而非互相吞并。

**验证**：编辑器 **75 文件 / 797 用例**绿（789 + 8 新增）；`tsc` 无错；`pnpm lint:fe` 0 error。
新增 8 例：`staticSubtestsByParent` 4（扁平 / 嵌套 / 空 / 非 Go 命名）、marker 载荷 1、
菜单去重 3（部分重叠 / 全重叠无分隔条 / 深层条目不被祖先按钮连带隐藏）。
**变异验证**：把祖先遍历改为「只取第一个 `/`」→ 嵌套用例立即变红（断言确有效力）。

## neeko-check 第五轮 —— F15 已修（层级语义入注册表能力位）+ 同源加固

### F15：生产者按 `/` **推测**层级，消费者只认 Go（探针证实，非推理）

初版 `staticSubtestsByParent(tests)` 对**所有**语言用「名字里有没有 `/`」推断父子关系。探针实测：

```
TS：test('auth') + test('auth/login works')
产出：{ testCase: {name:'auth', lang:'ts'}, staticSubtests: ['auth/login works'] }   ← 伪造的父子关系
```

TS 标题含 `/` 极常见（`test('GET /users')`），故非理论边界。**为什么算缺陷**：① 数据是错的；
② 正确性**靠消费方兜住**（不变式由读取方而非产出方保证）；③ 与 P4 立论矛盾 —— P4 主张「以
结构取代文本猜测」，按 `/` 前缀猜层级正是文本猜测。

### 修法（方案 A：注册表能力位）

| 改动 | 内容 |
|---|---|
| `RunLanguage.hierarchicalTestNames` | 新能力位（与 `hasMain` / `capabilities` / `results` 同级）；**仅 Go 为 true** —— Go 的 `t.Run` 由 `go test -run` / delve `-test.run` 逐层锚定，`/` 即层级 |
| `staticSubtestsByParent(tests)` → `staticSubtestsForFile(fileName, tests)` | **签名带上 fileName 并内置门控**，分组逻辑不再可从外部绕过。F15 的根因是「产出方猜、消费方兜」，故让调用方**结构上无法**忘记门控（而非只在注释里提醒） |
| `runMarkers.ts` | 去掉自行拼装的门控，直接用 `staticSubtestsForFile`（少一处可漂移的判定） |
| **同源加固**：`collectSubtestNames` → `collectGoSubtestNames` | 该函数在**共享**解析层里做前缀匹配，同样只对 Go 成立；名字显式带 `Go` 防止被误用于其它产物通道（vitest 标题也可能含 `/`） |

### 全面审计（本轮刻意一次查完，不再「一轮一个」）

| 面 | 结论 |
|---|---|
| 全仓 `/` 推断点 | 逐一分类：`breadcrumb` / `cargoManifest` / `testCommands` 文件路径段 / `PaneContent` 取 basename → **文件路径**（非用例名，`/` 是项目内部规范分隔符）；`collectGoSubtestNames`（已加固，Go 专用）；`goTestRunPattern`（Go 专用函数，逐层锚定 + `\Q…\E`，真机已验）→ **无其余同类推断** |
| `goTestRunPattern` 嵌套/元字符 | 已覆盖：`name.split('/')` 逐层锚定、含元字符段 `\Q…\E`；Run 与 Debug 共用同一函数（防两条链路漂移） |
| 动态侧前缀边界 | `${parentName}/` **严格边界** → `TestFib` 不吞 `TestFibExtra/x` ✓ |
| 门控一致性 | 产出方（`hierarchicalTestNames`）与消费方（`lang === 'go'`）现在**恰好重合**：动态发现只来自 test2json 通道（Go），静态层级只 Go 声明 |
| 死导出 / 属性泄漏 | 3 个新符号各 1 个生产消费者；全仓无 `JSON.stringify(RunTarget)`；gutter signature 仅 `line:kind` |

### 验证

- **Red 证据**：修前 marker 端到端用例报 `expected {kind:'test',…(2)} to not have property "staticSubtests"`
  —— **直接证明伪造载荷真实存在**（不是推理）
- 新增断言：TS 标题含 `/` → 索引为空（单测）+ marker 不挂 `staticSubtests`（端到端）；`hasHierarchicalTestNames` 五语言表
- 变异验证：祖先遍历改「只取首个 `/`」→ 嵌套用例红（新增断言亦确有效力）
- 文档同步：design §7.8.4（F15 教训单列）、§7.8.6（回归断言）、§7.9.3 注册表契约块（加能力位与索引函数；
  避免重演 F11 的「文档与实现漂移」）
- 门禁：`pnpm test:run` / `tsc` / `pnpm lint:fe` 全绿


