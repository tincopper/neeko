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
