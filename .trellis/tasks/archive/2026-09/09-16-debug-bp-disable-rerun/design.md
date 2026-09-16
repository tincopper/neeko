# Design — 调试禁用断点与重新运行

## 1. 第一性原理与不变式

| # | 不变式 | 说明 |
|---|---|---|
| D1 | DAP 无 enabled 位，禁用 = 客户端过滤 | `setBreakpoints` 按文件全量替换（`session.rs:558`）；disabled 留模型、不进载荷 |
| D2 | 过滤规则单一、落点覆盖 manager 的两条下发路径 | 前端过滤会被 `set_breakpoints` 当删除持久化（`manager.rs:227-237` 先写内存再落盘）；实际有两条下发路径：实时（`set_breakpoints` → `set_breakpoints_for_file`）与启动/重跑（`launch_session` → `get_breakpoints` → `adapter_breakpoints` → `apply_breakpoints`），**都必须**按 effective 过滤。评审 P1：若只堵实时路径，mute 后 Rerun 会把全部断点经启动路径重新下发命中 —— 打穿 R10 核心语义 |
| D3 | `verified`（适配器只读）与 `enabled`（用户可写）正交 | UI 以 `enabled` 为准覆盖显示；disabled 的 verified 无意义不展示 |
| D4 | 断点身份 = `(file, line)`，enabled 是属性 | 拒绝 `lines[] + disabledSet` 双 map（双真相漂移）；单 entry `{ line, enabled }` |
| D5 | Rerun = launch 意图重放，不是协议 restart | `ControlAction` 无 restart（`dap/types.rs:263`）；后端恒停旧起新（`manager.rs:460`），前端只需记住意图 |
| D6 | 意图记忆只增不丢 | 成功启动后记录；失败/`reset`/`stop`/`terminated` 不清除（终止后重跑是主场景） |
| D7 | 通用层零语言知识 | Java attach（command/cwd/testName/classpath）与 JDTLS（target）形态各异，通用层只存不透明 thunk，语言侧登记（与 `languageHooks` 桥同构的 DIP） |
| D8 | 全局静音是叠加态，不是批量改写 | `effective = enabled && !muted`；unmute 不碰单个位，天然满足“此前禁用的保持禁用” |

## 2. 数据契约

```rust
// dap/types.rs — BreakpointSpec +=
pub struct BreakpointSpec {
    pub file_path: String,
    pub line: u32,
    pub verified: bool,                          // 不变
    #[serde(default = "bp_enabled_default")]     // 老文件缺字段 → true
    pub enabled: bool,
}
```

```ts
// runner/types.ts — BreakpointSpec +=
export interface BreakpointSpec { filePath: string; line: number; verified?: boolean; enabled: boolean; }
export interface BreakpointEntry { line: number; enabled: boolean; }  // store 内态（verified 是下发回填，不存）

// DebugSessionSlice +=
export interface DebugLaunchIntent {
  projectId: string;
  label: string;                    // toolbar title `Rerun <label>` 用
  replay: () => Promise<void>;      // 不透明重放（自带 reset + 回显）
}
lastLaunch: DebugLaunchIntent | null;
isLaunching: boolean;
setLastLaunch: (intent: DebugLaunchIntent | null) => void;
rerun: (projectId: string) => Promise<void>;
```

```ts
// breakpointSlice 内态
breakpoints: Record<projectId, Record<filePath, BreakpointEntry[]>>;  // 行号升序
setBreakpointEnabled: (projectId, filePath, line, enabled: boolean) => Promise<void>;
```

`getFileBreakpoints` 返回类型由 `readonly number[]` 变为 `readonly BreakpointEntry[]`（clean cutover，调用方全量迁移，编译器枚举）；
`listAllBreakpoints` 回 `BreakpointSpec[]`（带 enabled）；`breakpointCount(pid)` 语义 = 全部行数（pane tab 角标不断，enabled 过滤只影响下发）。
+
```ts
// mute 契约（前后端同态，按 projectId；缺席/缺字段 = false）
breakpointsMuted: Record<projectId, boolean>;
setBreakpointsMuted: (projectId: string, muted: boolean) => Promise<void>;
// 有效使能（pane / gutter / 下发统一用它）：effective = entry.enabled && !muted
```
+
```rust
// BreakpointsFile +=（并入 0.2.0，缺字段即 false）
// 口径：breakpoints.json 是 per-project 文件（breakpoints_json_path(project_path)），
// muted 是**该项目的单 bool**；manager 内存以 HashMap<projectId, bool> 聚合多项目。
// 前端 Record<projectId, boolean> ↔ 后端 per-project bool 经 dap_get/set_breakpoints_muted(project_id) 一一映射。
#[serde(default)]
pub muted: bool,
```

## 3. 后端改动（dap 域内，仅 +2 个薄命令）

1. `types.rs`：`enabled` + `default=true`；`#[serde(default)]` 保持旧 payload 可反序列化。
2. `config.rs`：`BreakpointsFile.version` → `"0.2.0"`；loader 接受 `0.1.0/0.2.0`（缺 enabled 即 true）；saver 写新版。
3. `manager.rs`：
   - 内存 `HashMap<file, Vec<u32>>` → `HashMap<file, BTreeMap<u32, bool>>`（`ensure_breakpoints_loaded:175`、`get_breakpoints_memory:197` 同步改）。
   - `set_breakpoints(state, project_id, file_path, breakpoints: Vec<BreakpointLine { line, enabled }>)`：全量替换内存（含 disabled）→ 持久化全量 → 下发只取 `enabled` 行。不可解析身份的早退分支（`:257-266`）回传带 enabled。
   - `adapter_breakpoints` 翻译前先滤 disabled（避免给 disabled 发"不可解析"note 噪音）。
   - **effective 过滤抽成后端纯函数**（如 `effective_breakpoints(map, muted) -> Vec<BreakpointLine>`），`set_breakpoints`（实时）与 `adapter_breakpoints`（启动/重跑）**两处都调用**（评审 P1：漏启动路径 ⇒ mute 后 Rerun 断点复活命中；`adapter_breakpoints` 输入是 `get_breakpoints` 全量，不能只滤 disabled 不滤 muted）。
   - `commands.rs:105 dap_set_breakpoints` 参数 `lines: Vec<u32>` 同改为 `breakpoints: Vec<BreakpointLine>`；**同命令名、无需注册变更**；前端 `debugApi.dapSetBreakpoints` 同步签名（bundle 同发，无兼容问题）。
   - mute：内存加 `muted: HashMap<projectId, bool>`（per-project 单 bool，`ensure_breakpoints_loaded` 随文件读入，缺字段=false；`breakpoints.json` 本身即 per-project 文件，见 §2 口径）；新增 `dap_set_breakpoints_muted(project_id, muted)`（落盘 + 即时下发 effective 全集，复用同一下发函数）与 `dap_get_breakpoints_muted(project_id)`（`loadBreakpoints` 时与列表同取）；enabled + muted 同属 0.2.0，一次收敛。
4. `session.rs:382 apply_breakpoints`：零改（输入已滤）。

## 4. 前端改动（runner/editor 域内）

### 4.1 breakpointSlice（仍 ≤300 行，护栏 10）

- `toggleBreakpoint`：存在性语义不动；下发时传全文件 entries（含 enabled），后端回 verified 后按行 merge（复用既有归一逻辑，enabled 按 UI 行继承）。**merge 冲突策略（评审 P2）**：adapter remap 可能把 enabled 行移到相邻行（42→43），若 43 恰有另一条 disabled entry → 同行两个 entry。按行 merge 时**同行为一 entry，enabled 优先**，保证 pane/gutter 的 key 唯一。
- `setBreakpointEnabled`：缺行 no-op；乐观更新该行 enabled → 调 `dapSetBreakpoints` 下发 enabled 子集 → 回填 verified（同 merge）。**失败回滚（评审 P7）**：与 mute 同策略（乐观 + 失败回滚 + notify），与 `toggleBreakpoint` 既有「不回滚」模式区分开——两者在同一 slice 内必须口径一致，此处明确为**可写位（enabled/muted）都回滚，存在性 toggle 维持不回滚**。
- `loadBreakpoints`：磁盘为真相，归一 `BreakpointEntry[]` 升序。

### 4.2 会话意图（sessionSlice + javaDebugStore）

- `start` 成功后：`set({ lastLaunch: { projectId, label: config.name, replay: () => get().startWithConfig(projectId, configSnapshot) } })`（快照 config，避免引用漂移）。
- `startWithConfig` 成功后：记 `{ label: config.name, replay: () => get().startWithConfig(projectId, config, { starter, reset: true }) }`（starter 闭包透传，Java attach 重放一致）。
- `javaDebugStore.startJavaAttach/startJavaDebug` 成功后：调 `useDebugStore.getState().setLastLaunch({ projectId, label, replay: () => get().startJavaXxx(...) })`（通用层零 java 字面量，D7）。
- `rerun(projectId)`：守卫（`lastLaunch && lastLaunch.projectId === projectId && !isLaunching`）→ `set({ isLaunching: true })` → `await lastLaunch.replay()` → finally `set({ isLaunching: false })`。thunk 自带 reset + 回显，通用层不再二次 reset（避免双清吃掉 `$ command` 回显）。
- **`isLaunching` 覆盖全部启动入口（评审 P3）**：`start` / `startWithConfig` / `rerun` 共用同一互斥位（同一时刻至多一条启动链）。否则 config 区与 toolbar 两个按钮可并发启动，各自 `resetSession()` + 各自 `set({session})`，前端拿到错乱窗口；后端单会话假设只兜底后端，不兜前端状态竞争。
- **attach 会话的 rerun 语义（评审 P4）**：`lastLaunch` 只记 launch 意图；attach（`attachSession` / Java attach-first）之后点 Rerun = **停掉 attach 会话、重放上次 launch 意图**（不重放 attach）。Java attach-first 在 `startJavaAttach` 成功后登记 intent（重放 = 重新走 attach 链），与 launch 一致。此语义写入 design，不做「attach 禁用 rerun」分支。
- `stop/stopSilent/resetSession/terminated`：不碰 `lastLaunch`（D6）。

### 4.3 eventsSlice 顺手堵（评审 P6：防回归加固，非高频必现）

`DAP_SESSION_STATUS_EVENT` 分支：`if ((terminated|ended) && !cur) return;`（死亡通知不许创建会话）。原 `else if (!cur)` 建会话只保留 running/stopped 系状态。

**触发路径（已核实）**：`endedSessionPatch` 在 `session=null` 时返回 `session: null`，但状态流分支用 `endedSessionPatch(cur?.sessionId === info.sessionId ? {...cur,...info} : info)` —— `!cur` 时传 `info` 构造一个 terminated 会话对象并 `set`。即「从未成功启动 / 会话已被清空」时，迟到的 terminated 通知会凭空创建会话。当前代码 `cur` 极少为 null（启动失败也保留 terminated 对象），故为**加固而非高频竞态**；rerun 场景把它放大了，顺手堵掉。行为变化：`!cur + terminated` 从「建会话」变「忽略」，只影响死通知，不触碰正常终止。

### 4.4 UI

- `DebugToolbar`：`DebugToolbarAction += 'rerun'`；按钮位 `[Continue][Pause][Stop] | [Rerun:RerderCcw] | [Step…]`；`disabled = !canRerun`（canRerun 经 props 进，toolbar 保持纯展示）；title `Rerun <label>`；无快捷键（Phase 1）。
- `DebugPanel`：`canRerun = lastLaunch?.projectId === activeProjectId && !isLaunching`，`handleToolbar` 加 `rerun` 分支 `void rerun(projectId)`。
- `DebugBreakpointsPane`：每行加 `Eye/EyeOff` 开关（`aria-pressed={enabled}`，`useCallback` 包裹，`React.memo` 已有）；disabled 行 `opacity-50` + `CircleDot` 置灰；`X` 不动。
- `breakpointContribution`：payload `+ 'disabled'`；`markersOf` 命中 disabled 行回 `{ state: 'disabled' }`；render 空心圆（对齐 lucide `Circle` 的 `cx12 cy12 r10`，CSS 画，不新增图标组件）；title "Disabled breakpoint"；**无 onClick**（单击语义不变，冒泡走既有 toggle）。
- `useBreakpointGutter/useEditorBreakpoints`：`bpLines: number[]` → entries 迁移（field 存 enabled 行的全集，含 disabled——gutter 要画灰）。
+
### 4.5 全局静音（mute）
+
- slice：`breakpointsMuted + setBreakpointsMuted`（乐观更新 → 调新命令 → 失败回滚 + notify；成功后 entries 不动——单个位原样保留，D8）；`loadBreakpoints` 同取列表 + muted（`Promise.all`）；`toggleBreakpoint/setBreakpointEnabled` 在 mute 下照常改单个位（后端按 effective 下发，仍为空）。
- toolbar：**`DebugToolbarAction` 不加 'mute'**（架构审查偏离记录：原稿「与 rerun 同批进 union」未落地——mute 按钮需 `muted`/`total` props 决定 disabled 与 active 态，走 `onToggleMute` 专属回调，与 `canRerun` 同构；若声明了 union 成员却永不分发，未来经 `onAction('mute')` 路由会落入 `control('mute')` 后端报错，故不声明）*；位 `[Stop] | [Mute:Ban][Rerun:RotateCcw] | [Step…]`；props `{ muted, total, onToggleMute }`；`disabled = total === 0`；`aria-pressed={muted}`；title "Mute all breakpoints" / "Unmute breakpoints"；active 态高亮（panel 传 muted）。**muted 残留可见性（评审 P5）**：mute 后删光断点（`total === 0`）时按钮 disabled，但 `muted=true` 残留且**不可见** —— 用户再新增断点会发现不命中且无从察觉。disabled 时仍须显示 active 高亮（`aria-pressed` / 视觉 active 态不随 disabled 消失）。
- pane/gutter：统一按 effective 渲染（mute 时全行置灰 + 空心，Eye 全呈 EyeOff 态但**不改单个位**——点击 Eye 仍改单个位，视觉在 unmute 后体现）。**muted 行 gutter 单击（评审 P12）**：gutter 单击恒为存在性 toggle（= 删除），muted 行同 disabled 行 —— 灰空心但单击删除，与 A4 语义一致；原型标注一句，避免用户误以为单击是启用。

## 5. 图标清单（全 lucide，R7）

| 位置 | 图标 | 来源 |
|---|---|---|
| Rerun | `RotateCcw` | `lucide-react`（经 icons barrel，已实证可用） |
| 启用/禁用 | `Eye` / `EyeOff` | 同上 |
| pane 断点 | `CircleDot` | 既有不变 |
| gutter disabled 空心 | CSS 圆（`Circle` 语义 `r10` 对齐） | 不新增组件，样式见原型 |
| 全局静音 | `Ban` | 同上（与 Eye/EyeOff 区分：斜杠圆 = 全部扣留） |

## 6. 测试矩阵（TDD，先 Red）

| 层 | 用例 |
|---|---|
| Rust `manager`（tempdir） | disabled 不进 adapter 载荷；`0.1.0` 文件读入全 enabled；roundtrip 写 `0.2.0`；翻译前过滤无 note |
| Rust `config` | 双版本 loader；缺 enabled 默认 true |
| `breakpointSlice` | `setBreakpointEnabled` 不删行/缺行 no-op/下发只含 enabled；remap 不丢 enabled；失败启动不覆盖（N/A，前端） |
| `sessionSlice` | 成功记 intent；失败不覆盖；跨项目拒绝；并发单发（`isLaunching`）；`reset/stop` 不清 intent |
| `eventsSlice` | 空窗 terminated 不复活会话 |
| 组件 | pane 开关调 action + `aria-pressed`；gutter disabled 渲染；toolbar 无 intent 禁用；title 含 label |
| 集成 | 停住→Rerun→新 sessionId→同断点再停（mock invoke 序列断言） |
| mute | set 扣留全集/unset 恢复 enabled 子集；while-muted 改单个位保留；load 同取；toolbar 空集 disabled；pane 全灰不改位；**mute 下 rerun：启动路径载荷为空（P1，删启动路径过滤 ⇒ 红）** |

交错用例沿 `frontend-testing.md §9`：deferred + flushMicrotasks，禁伪同步；提交前删守卫验 RED。

## 7. 风险与回滚

- `getFileBreakpoints` 变参是 broke-change（域内 4 调用方 + gutter），以 `tsc` 枚举，漏一处即编译失败，无静默风险。
- `breakpoints.json` 双版本：loader 宽容、saver 前进；回滚 = saver 版本号改回（已写新文件仍可读，enabled 字段被旧版忽略——serde 默认）。
- `lastLaunch.replay` 闭包持有旧 config 快照：配置删除后重放走现场 `startWithConfig` 直接发包，不依赖 store 内 configs 列表，无悬空。
- mute 可见性：静音是全局态，active 高亮必须醒目 + 零断点 disabled；否则“开着静音却以为断点坏了”会成为新的报障源。
- 回滚点：后端 `enabled` 字段可整块 revert（serde default 使新旧双向兼容）；前端 intent 可整块 revert（`rerun` 未被其他调用方依赖）。
