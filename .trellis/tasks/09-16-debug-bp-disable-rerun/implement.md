# Implement Plan — 调试禁用断点与重新运行

> 唯一基准：`prd.md`（需求 A1-A11）+ `design.md`（§2-§7）+ 原型 `prototype-bp-disable-rerun.html`。
> 状态 planning：禁止改码；`task.py start` 需文档完成 + 用户明确确认后。

## P0 类型与契约（先锁形状，TDD Red 起点）

- [ ] P0.1 Rust：`dap/types.rs BreakpointSpec += enabled: bool`（`#[serde(default=true)]`）；`config.rs` version `0.2.0` + 双版本 loader；`BreakpointLine { line, enabled }` 请求载荷类型。
  验证：`cargo test dap::config`（旧文件全 enabled；roundtrip 新版）。
- [ ] P0.2 TS：`runner/types.ts BreakpointSpec += enabled` + `BreakpointEntry`；`DebugBreakpointSlice`（`breakpoints` 内态升级 + `setBreakpointEnabled` 签名）；`DebugSessionSlice`（`lastLaunch/isLaunching/setLastLaunch/rerun`）；`DebugToolbarAction += 'rerun'`。
  验证：`tsc --noEmit` 枚举调用方（预期报错清单 = 迁移清单）。

## P1 禁用断点·后端（过滤单点 D2）

- [ ] P1.1 `manager.rs`：内存 `file → BTreeMap<line, enabled>`（`ensure_breakpoints_loaded/get_breakpoints_memory/persist` 同改）；`set_breakpoints` 全量换内存 → 落盘全量 → 下发只取 enabled；不可解析早退回传带 enabled；`adapter_breakpoints` 翻译前滤 disabled（无 note）。
- [ ] P1.2 `commands.rs dap_set_breakpoints`：`lines: Vec<u32>` → `breakpoints: Vec<BreakpointLine>`；`debugApi.dapSetBreakpoints` 同步签名。
  验证：`cargo test dap::manager`（tempdir：disabled 不进载荷；版本 roundtrip）；clippy `-D warnings`。
- [ ] P1.3 mute 后端：`BreakpointsFile.muted`（per-project 单 bool）+ manager `muted: HashMap<projectId, bool>` map（随文件读入，缺字段=false）；**effective 过滤抽成后端纯函数，`set_breakpoints`（实时）与 `adapter_breakpoints`（启动/重跑）两处都调用（评审 P1：漏启动路径 ⇒ mute 后 Rerun 断点复活命中）**；新增 `dap_set_breakpoints_muted`（落盘 + 即时下发 effective 全集，复用同一下发函数）/ `dap_get_breakpoints_muted` + `neeko_invoke_handler!` 注册 + `debugApi` 封装。
  验证：`cargo test`（set 扣留全集 / unset 恢复 enabled 子集 / while-muted 改单个位保留位值 / load 同取；**mute 下 start_session 启动载荷为空**）。
- [ ] P1.4 变异验证：删实时路径过滤行 → P1 单测红；删启动路径（`adapter_breakpoints`）过滤行 → mute 下 start_session 载荷空用例红；恢复 → 绿。

## P2 禁用断点·前端 slice + gutter

- [ ] P2.1 `breakpointSlice`：`toggleBreakpoint` 存在性不动（传全 entries，后端回 verified 按行 merge，enabled 按 UI 继承；**merge 同行冲突 = 一个 entry、enabled 优先，评审 P2**）；新增 `setBreakpointEnabled`（缺行 no-op + 乐观 + 下发 enabled 子集 + 同 merge + **失败回滚 + notify，评审 P7**）；`loadBreakpoints/getFileBreakpoints/listAllBreakpoints/breakpointCount` 迁移。
- [ ] P2.2 调用方迁移（tsc 枚举）：`useEditorBreakpoints:30`、`useBreakpointGutter` field、`DebugBreakpointsPane`、`DebugPanel:64` 角标。
- [ ] P2.3 `breakpointContribution`：payload `+ 'disabled'`，markersOf/render（灰空心 + title），无 onClick。
- [ ] P2.4 mute 内态：`breakpointsMuted + setBreakpointsMuted`（乐观 + 回滚）；`loadBreakpoints` 同取列表 + muted；effective helper（**供 pane/gutter/下发复用，评审 P16：先量 `breakpointSlice` 行数，护栏 10 ≤300 有压力则抽纯函数模块**）；pane/gutter 按 effective 渲染（Eye 点击仍改单个位）；toolbar 零断点 disabled 时 muted 残留仍显示 active 态（评审 P5）。
  验证：触域 vitest（`breakpointSlice` 缺行 no-op / remap 不丢 enabled；contribution disabled 渲染；mute 置空/恢复/while-muted 改位保留/load 同取）；`tsc` 绿。

## P3 Rerun 意图 + 工具栏 + 事件堵口

- [ ] P3.1 `sessionSlice`：`start/startWithConfig` 成功后记 `lastLaunch`（config 快照；starter 闭包透传）；`rerun`（三守卫 + `isLaunching` + thunk 重放 + finally 清位）；**`isLaunching` 覆盖 start / startWithConfig / rerun 全部启动入口（评审 P3，防 start×rerun 并发双链）**；`reset/stop/terminated` 不清 intent。
- [ ] P3.2 `javaDebugStore`：`startJavaAttach/startJavaDebug` 成功后 `setLastLaunch` 登记（通用层零语言字面量，D7）。
- [ ] P3.3 `eventsSlice`：`!cur + terminated/ended → 忽略`（死亡通知不建会话）。
- [ ] P3.4 UI：`DebugToolbar` rerun 位（`RotateCcw`，`canRerun` props 进）+ mute 位（`Ban`，props `{ muted, total, onToggleMute }`，零断点 disabled，`aria-pressed`）；`DebugPanel` 门控（`projectId === + !isLaunching`）+ `handleToolbar` 分支；`DebugBreakpointsPane` Eye 开关（`aria-pressed` + `useCallback`）+ mute 下全行 effective 置灰。
  验证：触域 vitest（失败不覆盖 intent；跨项目拒绝；并发单发；空窗 terminated 不复活；pane 开关调 action；toolbar 无 intent 禁用；title 含 label；mute 空集 disabled + 全灰不改位）+ 集成（停住→Rerun→新 sessionId→再停，mock invoke 序列）。

## P4 回归与门禁

```bash
pnpm type-check && pnpm test:run src/features/runner src/features/editor  # 触域先行
pnpm lint:fe && pnpm lint
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] `architecture.test.ts` 11 护栏零改即过（无新 slice、无通用层语言字面量、无跨 slice import）。
- [ ] 交错用例按 `frontend-testing.md §9`（deferred + flushMicrotasks）；提交前删守卫验 RED。
- [ ] 图标审计：`RotateCcw/Eye/EyeOff/CircleDot/Ban` 五符号全出自 icons barrel（grep 无其他图标源）。
- [ ] 真机验收：A1-A6、A8-A10 逐条（禁用不命中→启用恢复→重启仍在→停住/运行中/终止后 Rerun→跨项目门控→连点单会话→全禁不命中→恢复仅开此前开启→重启仍静音→零断点 Mute 禁用；**mute 下 Rerun 后仍不命中，评审 P1**）。

## 回滚点

- R-a P0.1 后：serde default 双向兼容，可整块 revert。
- R-b P1 后：后端过滤可单块 revert（前端传 enabled 会被忽略——字段未知即丢，行为退化为全启用，不断错）。
- R-c P3 后：intent 可整块 revert（无外部调用方）。
