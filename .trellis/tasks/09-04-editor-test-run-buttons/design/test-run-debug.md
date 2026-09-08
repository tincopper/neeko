# 编辑器单测运行 / 调试（Run/Debug）设计

> 状态：唯一设计基准（待确认后实现）。任务：`09-04-editor-test-run-buttons`。
> 本文档是 run/debug 能力的完整设计，不依赖任何历史文档；输入只有三份业界调研
> （`research/debug-vscode.md`、`debug-idea.md`、`debug-zed.md`）与生产故障实证。

## 1. 背景与目标

编辑器 gutter 为测试用例提供 Run / Debug 内联按钮（Rust + TS/JS 运行走 Task Console；
Rust 调试走 lldb DAP + DebugPanel）。已验证的生产故障：点 Debug 后停在 Task Console，
通知"找不到唯一测试二进制"，永远到不了 DebugPanel——而全部单测是绿的。

根因（实证，非推测）：调试的前置构建复用了**用户可见的 Task Console 会话**
（点即开 console 面板），产物解析吃的是 **PTY 合流输出**（stdout+stderr 合并、
`\r\n`、转义序列）；单测喂的却是干净字符串。测试与生产输入形状不同，覆盖率是虚的：
对照实验（`src-tauri` 真实工作区，管道直跑）产出 531 个 test 产物，真机解析为零。

目标：按业界形状重建——**描述统一、载体分离**，让"点 Debug 落 DebugPanel"在构造上成立，
而不是靠事后路由纠正。

## 2. 业界共识（设计依据，三家一致）

| # | 共识 | VSCode | IDEA 系 | Zed |
|---|------|--------|---------|-----|
| C1 | 描述统一、载体分离：用例定位/构建/参数只有一份定义；run 走终端载体，debug 构建走无头后台进程 + DAP 会话 | 同一 `runHandler(shouldDebug)`；rust-analyzer Debug 不建 `TestRun`，直接 `startDebugging` | 同一 Configuration，executor 分支 Run/Debug | debug 配置 `build` 字段引用同一 task 定义 |
| C2 | 构建与运行分离，构建失败短路，不进运行阶段 | 拿不到 executable 不启动会话（`Cargo invocation has failed`） | `--no-run` 非 0 即停；产物 0/多个弹错停 | program 解析不出不启动 |
| C3 | 面板归属由启动模式**静态**决定，不按输出动态路由 | `TestRun` 与 debug session 两套 UI 归宿 | executor 决定目标窗口 + per-launch Activate/Focus | task→终端，debug→DebugPanel，启动瞬间即定 |
| C4 | 产物定位走结构化协议，吃干净管道输出 | `--message-format=json` 解析 `compiler-artifact.executable`（0/多即错） | 同左（`--no-run` + artifact） | 从 build 命令推断 / locator 两阶段 |

来源（精简）：rust-analyzer `editors/code/src/{debug,toolchain,run,test_explorer}.ts`、
CodeLLDB MANUAL（Launch Sequence/Cargo Support）、JetBrains `run-debug-configuration` /
`starting-the-debugger-session` / `debug-tool-window` 帮助、intellij-rust
`RsExecutableRunner.kt` / `CargoTestCommandRunner.kt`、Zed `debugger` / `tasks` 文档与
`debugger_ui` 源码。详见三份 research brief。

## 3. 总体架构

```
gutter Run/Debug 点击
  │  TestLaunchSpec（共享描述）：{ testCase, buildCmd, runArgs, debugArgs, cwd, env }
  ├─ mode=run ──► 载体 A：Task Console 会话 + testResults 状态流（输出本身就是产品；现状不变）
  └─ mode=debug ─► 载体 B：
        ① 点击瞬间打开 DebugPanel（pending 态"正在构建测试二进制…"）——面板静态决定（C3）
        ② 无头构建：后端 debug_build_test_binary（管道执行，2MB 截断）→ { exit_code, stdout }
        ③ 解析产物（compiler-artifact 协议，干净管道输入）（C4）
        ④ 0/多产物或构建失败 → 错误渲染进 DebugPanel console tab + notification（C2；Task Console 永不参与）
        ⑤ 唯一产物 → dap_start_session_config({ program, args:[用例名子串过滤], cwd, env }) → 会话驱动面板
```

三条铁律（C1-C3 的直接推论）：

1. **debug 点击永不打开 Task Console**——没有"先开错再纠正"的中间态，"落错面板"构造上不可能。
2. **解析器只吃管道 stdout**——单测输入与生产输入同形；行尾做 `\r\n`/转义清洗，洗不出的进失败分类，永不静默。
3. **构建是一次性后台调用**——无会话、无复用、无 observer 分支；二次点击=第二次独立构建。

## 4. 后端

新增命令 `debug_build_test_binary(project_id: String, command: String, cwd: String)`
→ `{ exit_code: i32, stdout: String }`：

- 走 `crate::core::exec` async 变体管道执行（禁裸 `Command`，禁同步桥）；stdout 累积 2MB 截断；
  `cwd` 进门先 `canonicalize()` 路径校验；返回 `Result<_, AppError>`；注册进
  `neeko_invoke_handler!`。命令层只做参数校验 + 调度，不解析 cargo 语义（解析留前端纯函数）。
- 复用点：`dap_start_session_config`（已注册）保持不动；DAP 会话生命周期逻辑不动。

## 5. 前端

- 新增 `features/debug/api/debugBuildApi.ts` 门面（`invoke('debug_build_test_binary')`，
  前端不直导 tauri api）：`buildTestBinaryRemote(spec) -> { exitCode, output }`。
- `useTestRunActions.ts`：`buildTestBinary` 改调无头构建（删 `runTask` 耦合、observer、
  `TestBinaryBuild` 会话形态）；`launchDebug` 流程：pending 开面板 → 无头构建 →
  `parseTestBinaryPath` → 失败进 DebugPanel console（附构建日志尾部 ≤50 行）+ notification
  → 成功 `startWithConfig`。
- `parseTestBinaryPath` 保留（语义不变：只消费 `compiler-artifact` + `profile.test` +
  非空 `executable`；0 → `binary_not_found`；多且 hint 消歧失败 → `binary_ambiguous`），
  另加输入清洗（`\r` 行尾、ANSI 转义前缀）——清洗是防御性兜底，主路径输入已干净。
- 面板路由：debug 点击即 `debugStore.openPanel`（pending），成功切 session tab，
  失败切 console tab；删除按 outcome 动态选面板的矩阵路由（静态路由取代它，
  调用点收敛到 launch 流程内）。
- 回滚项（脏输入时代的临时补丁，不留 dead code）：`summarizeBuildOutput` 及其测试与调用点。
- `launchRun`、testResults store、P1 状态流、gutter 贡献/冲突规则：**零改动**。

失败分类（C2，全部显式、无静默）：

| 失败 | 位置 | 用户可见 |
|------|------|---------|
| 构建退出码非 0 | DebugPanel console tab | 构建日志尾部 + notification（构建失败，未启动调试） |
| 0 产物 | 同上 | notification（构建输出中没有测试产物）+ 日志 |
| 多产物且消歧失败 | 同上 | notification（多个测试二进制，无法确定目标）+ 候选列表 |
| DAP 启动失败 | DebugPanel console tab（既有错误路径） | 既有报错，不重复通知 |
| 无头构建命令 spawn 失败 | 同上 | notification（含命令与 cwd） |

## 6. 测试计划（TDD）

1. 后端：`debug_build_test_binary` 反序列化/截断单测（`#[test]` 纯逻辑部分）；
   真 serve 联调标 `#[ignore]`（既有惯例）。
2. 前端纯函数：`parseTestBinaryPath` 现有用例全保留 + 新增清洗用例
   （`\r\n` 行尾、ANSI 前缀行、截断 JSON 行）；构建命令构造用例保留。
3. 流程：`launchDebug` 分支单测（成功→session 面板；三类失败→console 面板+通知文案；
   断言**未调用**任务会话创建）。
4. 回归：`editor/debug/task` 全量 + `cargo test` 相关用例。

## 7. 验收

- [ ] Debug 点击瞬间 DebugPanel 以 pending 态打开，Task Console 无新增会话、不抢焦点。
- [ ] 同一用例连点两次 Debug：两次独立构建，无复用、无挂起。
- [ ] 构建失败 / 0 产物 / 多产物：错误在 DebugPanel console 可见 + notification。
- [ ] 成功路径真机：lldb 会话启动，断点命中（用例 `session_create_url_carries_project_directory`）。
- [ ] Run 路径零回归（既有 518 用例 + P1 ✓/✗ 状态流）。
- [ ] `pnpm type-check` / `pnpm test:run` / `pnpm lint:fe` / `cargo test` 全绿。

## 8. 不做

TS debug（node DAP，后续里程碑；`TestLaunchSpec` 已预留 mode 分叉位）、per-launch
Activate/Focus 开关、断点持久化/mute/日志断点、构建产物缓存、后端解析 cargo JSON。
