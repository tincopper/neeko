# 调试禁用断点与重新运行

## Goal

为调试补齐三个 IDE 标配能力：① 单个断点可禁用/启用（禁用后不命中、保留在列表与 gutter 中置灰）；② 调试工具栏可一键重新运行当前会话（运行中亦可，语义 = 停旧起新）；③ 工具栏一键全部禁用/恢复（静音态，恢复时仅恢复此前开启的断点，单点禁用的保持禁用）。

动因（第一性原理）：DAP `setBreakpoints` 是按文件全量替换语义、无 enabled 位，“禁用”只能是客户端过滤；“重跑”本质是记住 launch 意图并重放，后端已保证单项目单会话（起新即停旧），前端缺的只是意图记忆。

## Background

现状（实测代码）：

- 断点模型 `projectId → filePath → number[]`（`runner/store/debug/breakpointSlice.ts:8`），只有存在性，无使能态；`toggleBreakpoint` 乐观更新 + `dap_set_breakpoints` 下发 + verified 归一（`:24-50`）。
- 后端 `BreakpointSpec { filePath, line, verified }`（`dap/types.rs:122`），内存 `file → lines` + 落盘 `.neeko/breakpoints.json`（`BreakpointsFile version 0.1.0`，`dap/config.rs:25`）；启动（`manager.rs:468`）与实时（`:240`）都经 `DapManager::set_breakpoints` 下发，DAP 侧按文件替换（`session.rs:558`）。
- 会话启动三入口（`sessionSlice.ts`）：`start`（选配置现场解析）/ `startWithConfig`（合成配置 + `opts.starter`）/ Java 侧 `startJavaAttach` / `startJavaDebug`（经 `javaDebugStore` 登记后调通用落库）；启动完即忘，无意图记忆。`launch_session` 入口恒停旧（`manager.rs:460`）。
- 工具栏 `DebugToolbar` 只有 continue/pause/stop/next/stepIn/stepOut（`DebugToolbar.tsx:13`）；`ControlAction` 无 restart（`dap/types.rs:263`），加 restart 要动协议 + 全适配器，不做。
- 断点 pane（`DebugBreakpointsPane.tsx:43-74`）只有跳转 + 删除；gutter 贡献 payload 只有 `active | ghost`（`breakpointContribution.ts:22`），单击 = 存在性 toggle（`useBreakpointGutter.ts:215`）。

## Requirements

- R1 禁用模型：断点身份仍为 `(file, line)`，使能是该身份的属性位。前端 `breakpoints` 由 `Record<file, number[]>` 升级为 `Record<file, BreakpointEntry[]>`（`{ line, enabled }`）；后端 `BreakpointSpec` 加 `enabled: bool`（`#[serde(default = true)]`，老文件缺字段即全启用）；内存改 `file → map<line, enabled>`；持久化全量、**下发只取 enabled**。
- R2 禁用语义：disabled 永不进入 `set_breakpoints_for_file` 载荷（DAP 按文件替换语义天然清除适配器侧）；`toggleBreakpoint`（存在性）语义不动；`loadBreakpoints` 以磁盘为真相；adapter remap（verified 归一）不得丢 enabled。
- R3 pane 交互：每行加启用开关（lucide `Eye` / `EyeOff`，`aria-pressed`，title "Enable/Disable breakpoint"）；disabled 行置灰 + 空心图标；`X` 删除保留。**gutter 单击语义不变**（仍是存在性 toggle，启用/禁用只走 pane，避免同位置单击语义惊喜——已拍板）。
- R4 gutter 渲染：payload 加 `disabled` variant（OCP 加 variant）；`linesOf` 仍含 disabled 行；render 灰色空心（lucide `Circle` 语义对齐，CSS 画圆不引入新图标组件），title "Disabled breakpoint"。
- R5 重跑意图：`DebugSessionSlice` 新增 `lastLaunch { projectId, label, replay } | null` + `setLastLaunch`（语言侧登记，通用层零语言字面量）+ `rerun(projectId)` + `isLaunching` 互斥。仅成功启动后记录，失败不覆盖；`reset/stop/terminated` 不清除（终止后重跑是主场景）；跨项目门控（`projectId !== activeProject` 禁用，对齐 #14/I7）。**attach 会话下 Rerun = 停 attach、重放上次 launch 意图**（不重放 attach；Java attach-first 登记 intent，重放 = 重新走 attach 链）——语义已拍板写入 design §4.2（评审 P4）。
- R6 重跑语义（已拍板：运行中亦可）：`rerun` = 带着相同意图再走现有启动链（thunk 自带 reset + 回显，通用层不再二次 reset）；后端 `stop_project_sessions` 做停旧；`isLaunching` 互斥**覆盖全部启动入口**（start / startWithConfig / rerun 共用，防 start×rerun 并发双链，评审 P3）。Phase 1 不加快捷键（F5 已是 Continue）。
- R7 图标约束（用户明确）：所有调试按钮只用 lucide（经 `@/shared/components/icons`，该 barrel 全量 re-export lucide，已实证 `RotateCcw/Eye/EyeOff/CircleDot/Circle/Ban` 皆可用）。Rerun 用 `RotateCcw`；启用开关 `Eye/EyeOff`；pane 既有 `CircleDot` 保持；disabled 空心对齐 `Circle`。不引入任何非 lucide 图标/CSS 贴图。
- R8 顺手堵（评审 P6：防回归加固，非高频必现）：`eventsSlice` 状态流 `!cur + terminated/ended → 忽略`（死亡通知不许创建会话）。已核实触发路径：`!cur` 时状态流分支用 `info` 构造 terminated 会话对象 `set`（凭空建会话）；当前 `cur` 极少为 null，属加固，rerun 放大后顺手堵掉。行为变化只影响死通知，不触碰正常终止。
- R9 非功能：仅新增 `dap_set/get_breakpoints_muted` 两个薄命令（bool 进出，注册 +2 行）；其余复用（`dap_set_breakpoints` 同名变参 + 现有启动命令）；`breakpoints.json` version `0.1.0 → 0.2.0`（loader 双版本容忍，enabled + muted 缺字段即全启用/未静音）；mod.rs/index.ts 形态与防火墙约定不变；全程 TDD。
- R10 全局静音（mute）：工具栏新增开关（lucide `Ban`，`aria-pressed`，title "Mute all breakpoints" / "Unmute breakpoints"），位置 `[Stop] | [Mute][Rerun] | [Step…]`。mute 是叠加态而非批量改写：mute=true 时适配器载荷为空（全部扣留，单个 enabled 原样保留）；unmute 只恢复此前 enabled 的行（此前单点禁用的保持禁用）。**effective 过滤必须同时覆盖实时（`set_breakpoints`）与启动/重跑（`adapter_breakpoints` / `launch_session`）两条下发路径（评审 P1）**——漏启动路径 ⇒ mute 后 Rerun 把全部断点重新下发命中。mute 按 projectId 存，前后端同态（`breakpointsMuted`），持久化进 `breakpoints.json`（同 0.2.0，缺字段=false）；零断点时按钮 disabled，但 muted 残留仍须显示 active 态（评审 P5）。

## Acceptance Criteria

- [ ] A1 禁用后启动不断在该行停：后端收到的 `set_breakpoints_for_file` 载荷不含 disabled 行；pane 置灰与 gutter 空心一致。
- [ ] A2 持久化：重启 app 后 disabled 仍在（磁盘 roundtrip，`0.2.0` 写、`0.1.0` 读默认全启用）。
- [ ] A3 启用后恢复命中；verified 重映射不丢 enabled。
- [ ] A4 gutter 单击仍是存在性 toggle（disabled 行单击 = 删除该断点，不切换使能）。
- [ ] A5 停住时点 Rerun → 新 sessionId、同配置重起、同断点再停；终止后 Rerun 可用；运行中 Rerun 可用（先停旧再起新）。
- [ ] A6 切项目后 Rerun 按项目门控禁用；连点不产生双会话；失败启动不覆盖 `lastLaunch`。
- [ ] A7 全图标来自 lucide（`RotateCcw/Eye/EyeOff/CircleDot/Circle/Ban`），无其他图标源。
- [ ] A8 全部禁用：点 Ban → 适配器载荷为空（不断在任何行停），pane 全行置灰 + gutter 全空心，toolbar 开关呈 active 态；单个 enabled 位不变。**mute 下 Rerun：新会话启动载荷仍为空（评审 P1）**。
- [ ] A9 恢复：再点 Ban → 仅此前开启的行恢复下发与命中，此前单点禁用的保持禁用与置灰。
- [ ] A10 静音持久化：重启 app 后 muted 仍在；零断点时 Mute 按钮 disabled。
- [ ] A11 `pnpm type-check` / 触域 vitest / `cargo test` / clippy 全绿；`architecture.test.ts` 11 条护栏零改即过。

## Out of Scope

- 条件断点 / logpoint（`SourceBreakpoint.condition` 新属性位，正交可叠加，另起任务）。
- 批量改写单个使能位（mute 已覆盖“全停/恢复”场景；逐行改写 enabled 的批量操作另议）、断点导入导出。
- Rerun 快捷键、非调试 `runEntry` 的终端重跑。
- Alt+点击 gutter 快捷切换使能（后续交互增强）。

## Notes

- 拍板①：gutter 单击保持存在性 toggle，启用只走 pane（无异议）。
- 拍板②：rerun 运行中亦可（IDE restart 语义）。
- 图标约束来自用户本轮明确要求；原型见 `prototype-bp-disable-rerun.html`。
- DAP 无 enabled 位是协议事实（`session.rs:558` 全量替换），不是本项目缺失——过滤点必须在后端 manager（前端过滤会被当删除持久化）。
- 拍板③：工具栏加全局静音开关（mute 叠加态，unmute 仅恢复此前开启的；图标 lucide `Ban`，位 `[Stop] | [Mute][Rerun] | [Step…]`）。
