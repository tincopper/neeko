# Dock Placement：可移动的工具栏图标与可停靠的 tab

> 状态：planning · 本任务第一阶段**只出方案**（prd/design/implement），不改动代码。

## Goal

让「视图出现在哪个槽位」成为可编辑、可持久、可逆的布局事实：

1. **需求 A（布局可编辑）**：左右两侧功能图标可互相移动、可在栏内排序，重启后保持。
2. **需求 B（tab 停靠）**：Agent 终端 tab 与 Agent Chat tab 可停靠到右侧区（zone）显示，而不是只能待在中间编辑器区。
3. **需求 C（快速打开）**：把 Agent / Agent Chat 的入口图标固定在右侧工具栏，项目启动后点图标即可打开或接回该会话。

三者不是三个功能，而是**同一个操作**的三个面：`把某个视图指派到某个槽位`。

## 背景（现状事实，均已在代码中核实）

| 事实 | 位置 | 对本需求的含义 |
| --- | --- | --- |
| 布局被存了两遍：`zones[slot].panels` 与 `barItems[]`，各自从 `defaultZone` 派生 | `src/shared/store/dockStore.ts`、`src/shared/dock/panelMeta.ts` | 「图标换边」若沿用双表示必须双写，必然出现「图标在右、面板还开在左」 |
| `merge()` 时 `barItems` 完全由 registry 重建，只保留 `visible` | `src/shared/store/dockStore.ts:326` | 用户改动 `side`/`order` 今天会被丢弃，持久化必须先解决这一点 |
| registry 是编译期静态表，缺 UI 绑定直接 `throw` | `src/app/dock/registry.ts:138` | `zone` 内**不能**出现动态 id（如 tab id） |
| 面板尺寸记忆以 `panelId` 为键持久化 | `dockStore.rightPanelSizes` | 持久化体积必须 ∝ registry 基数，不能 ∝ tab 实例数 |
| Agent tab / Agent Chat 是 `editorStore` 里的 `Tab`（无界实例，按 `tabKey` 分槽） | `src/shared/types/tab.ts`、`src/shared/store/editorStore.ts` | tab 不能被当成 panel |
| `editorStore` **不持久化**；会话恢复由 live-sessions 注册表与 `session.json` 负责 | `editorStore`（无 persist）、`src/features/live-sessions/*` | 「重启后快速打开」只能靠种类级策略持久化在 `dockStore` |
| 已有 tab 容器先例：`pinned` 组把 tab 渲染在中心区内的侧栏 | `src/shared/types/editorGroup.ts`、`EditorGroupPane.tsx` | 「在侧区跑 tab」不是新机制，复用既有渲染管线 |
| 侧栏会话点击已有三级降级（激活 / 补键 / 重建） | `src/features/live-sessions/utils/sessionActivationPlan.ts` | 「快速打开」直接复用，不新写状态机 |
| dnd 规范：每个独立排序区域一个 `DndContext`，`onDragEnd` 只提取 id 并调域 hook | `.trellis/spec/frontend/interaction-patterns.md` §4 §8 | 两条工具栏跨栏移动需要合并为一个排序区域 → 需在 design.md 显式记录偏差与理由 |
| 嵌套 `ResizablePanelGroup` 有「pin tab 后 handle 失效」历史缺陷 | `src/layout/dock-layout/DockLayout.tsx:40`、`docs/layout-architecture.html` | 右侧 tab 宿主**不得**再嵌一层 Group |

## Requirements

### R1 图标落位可编辑

- 任一工具图标的**左右归属**与**栏内顺序**可由用户改变。
- 改落位后：图标出现在目标栏、面板在目标栏的 zone 内打开；**两处不可能分叉**。
- 落位持久化（应用重启、项目切换后不变）。
- 键盘等价操作（不能只有拖拽）。

### R2 tab 可停靠

- Agent 终端 tab 与 Agent Chat tab 可被移动到左/右 zone 显示，并可移回中间区。
- 同一时刻一条 tab **只能**在一个区域渲染（禁止双挂载：`TerminalView` / agent stream 是双开即故障的副作用）。
- 停靠后 zone 内的 tab 具备既有能力：切换、关闭（含未保存/dirty 确认）、右键菜单。

### R3 种类级入口与快速打开

- Agent / Agent Chat 的图标可固定在右栏（`onBar`）。
- 点击入口图标：打开该种类的新 tab（落到该种类的目标 zone 宿主）或激活已有的对应 tab。
- 应用重启后：入口图标仍在；点击能**接回**存活会话（attach）或**续写**已结束会话（复用 live-sessions 降级链），不新造会话身份。

### R4 约束

- 落位/槽位模型必须能在 `bottom` 槽位加入时**只加代码**（OCP），不改核心引擎。
- 新增一个「可停靠的 tab 种类」只允许改声明表（meta + registry 绑定）。
- 不允许引入 docking 框架（golden-layout / dockview / rc-dock 等）替换现有骨架。
- 不允许把 `tab` 实例塞进 `zone.panels`（registry 有界性 + 尺寸记忆有界性）。
- 不允许为 tab 增加第二套持久化/恢复路径（与 live-sessions 冲突）。
- 遵守跨项目隔离：切项目后侧区不得显示别的项目的 tab。

## 关键产品决策（**已定 2026-11-03，按「建议」列执行**）

> 决议方式：用户「直接开工」= 采纳建议值。实施中若发现某项不成立，回到本表改判并同步 design.md。

| # | 决策点 | 选项 | 决议 | 影响面 |
| --- | --- | --- | --- | --- |
| D1 | 右区 tab 宿主（`tabHost:right`）图标默认是否可见 | ① 默认可见 ② 只在有停靠 tab 时出现 ③ 默认隐藏，用户手动钉住 | **①**（可发现性优先；② 需要第二条派生规则，违背单一派生点） | `panelMeta.defaultOnBar` |
| D2 | 把图标移到另一侧后，目标 zone 是否自动展开 | ① 展开 ② 保持原状 | **①**（移动意图 = 想看到它） | `placement.applyMove` |
| D3 | tab 停靠后重启，「实例级停靠」如何收敛 | ① 回到中间区 ② 按种类策略回到右侧 | **②**（否则 R3 的「重启后从右侧打开」不成立）；实例级 override 仅运行时有效 | `tabSurface` 派生规则 |
| D4 | 左区是否也允许停靠 tab | ① 允许 ② 只允许右区 | **①**（同一套机制，不做非对称特例；默认入口只在右侧） | `tabHost:left` |
| D5 | 图标换边后，原 zone 若已空是否自动收起 | ① 收起 ② 保持空展开 | **②**（避免「拖一个图标连带关掉别的面板」的连带感）；空 zone 由 `DockZone` 渲染 null | `applyMove` |

补充决议（2026-11-03，真机验收后追加）：

| # | 决策点 | 决议 | 理由 |
| --- | --- | --- | --- |
| D6 | 种类级图标「再点一次」的语义 | **收起宿主槽**（`toggleView(tabHost)`），**不关 tab** | 图标背后是长跑会话（chat / PTY），第二下的意图是「先藏起来」而非结束会话；与 `toggleZone` 的既有 toggle 契约同形 |
| D7 | 关掉槽内最后一条停靠 tab 之后 | **自动收起该槽**（仅当该宿主是该槽前台时） | 否则留下一座空岛（用户看到「空的页面」）；而「本来就空」不得收起 —— 那是首次点图标的引导态 |


补充决议（2026-11-03，补齐 C 组缺口时追加）：

| # | 决策点 | 决议 | 理由 |
| --- | --- | --- | --- |
| D8 | 点种类图标时「接回哪条会话」 | 该 workspace 里**最近一条 `isListedSession` 的同类会话**（`startedAt` 最大）；命中就交给 `useActivateSession`（与侧栏点会话行**同一条**链），无命中才新建 | 判据只能与侧栏一致（`isListedSession` = 用户真的发过输入），否则会出现「侧栏有、图标点不到」；恢复链已有三级降级（activate / bind / recreate+attach / resume），重写一遍必然漂移 |
| D11 | `tabKind:terminal` 入口的语义 | 文案 **Terminal**；点击 = **纯 shell**（`agentId: null`），不因项目选了 agent 就拉 agent 会话；会话恢复也只认 `agentId === null` 的会话 | 用户直判「不要默认打开 Agent」；「开 agent 终端」已有 Agent Bar / Action Menu 两个入口，工具栏不该再重复一个隐式拉 agent 的入口 |
| D10 | 槽位宿主（Docked Tabs）要不要有工具栏图标 | **不要**（覆盖 D1 的「右槽默认可见」）。工具栏那一列是**功能入口**，宿主只是「被移进侧区的 tab 住的地方」；`sanitize` 强制 `onBar=false`，`setViewOnBar` 对它是 no-op。代价是要堵住「无入口种类停进去就点不到」：只有 `canDockTabKind` 为真的种类（agent-chat / terminal）才允许停靠 | 用户直接判定「这一列都是功能菜单」；可达性由种类图标 + 宿主自动展开承担（空→非空揭示） |
| D9 | 新建 tab 是否默认进 dock | 只有 `DOCK_VIEW_META[*].docksNewTabs === true` 的种类（当前仅 `agent-chat`），且槽位取**图标当前所在槽**；显式 `targetGroup` 优先 | 普通 shell / 任务终端不该被搬进右区；「图标在哪栏」是唯一的落点事实（禁止第二条 kind→slot 策略） |

## Non-goals（本阶段与整体不做）

- 不引入第三方 docking / layout 框架。
- 不做任意嵌套分区、浮动窗口、多窗口拆出。
- 不做 tab 实例级持久化（不新增第二套 tab restore）。
- **不做**「把 tab 拖到工具栏图标上」的跨容器拖拽：P3 评估后取消（收益由右键菜单覆盖，代价是两个 id 空间合并 + tab 列表二次派生，理由见 implement.md「P3b 取消理由」）。
- 不重构 `pinned`（语义独立，已有护栏，收编属独立议题）。
- 不改岛屿视觉与窗口骨架。

## 分期（每期可独立验收、可独立回滚）

| 期 | 交付 | 可独立验收 |
| --- | --- | --- |
| **P0** | placement 单一真源 + dockStore v6 + 图标跨栏/排序拖拽 + 键盘等价 + 持久化 | 是（需求 A 全闭环，零 tab 相关风险） |
| **P1** | 槽位 tab 宿主（`tabHost:left/right`）+ `editorLayout.docked` 组 + `moveTabToSlot`（菜单/命令入口） | 是（需求 B，先不接拖拽） |
| **P2** | 种类级入口（`tabKind:agent-chat` / `tabKind:terminal`）+ 快速打开（复用 live-sessions） | 是（需求 C） |
| **P3** | 拖拽贯通（tab ↔ 工具栏）+ 完整 a11y | 是（体验收尾） |

## Acceptance Criteria

> 每条都必须能在验收时用「操作 + 观察」或自动化测试证伪。
>
> **状态标记**：`[x]` = 已有自动化用例覆盖；`[x·机]` = 真机确认过；`[ ]` = 待真机确认（自动测不了）。

**A. 布局可编辑（P0）**

- [x·机] 把 `files` 图标从左栏拖到右栏：右栏出现该图标、左栏消失；点击后文件面板在**右侧** zone 打开。
- [x] 把右栏某图标拖到左栏：同样成立（双向）。
- [ ] 栏内拖动改变顺序，重启应用后顺序保持。（`order` 归一化 + persist 有单测；重启需真机）
- [x] 用手改坏 `localStorage`（未知 key / `order: NaN` / `slot: 'top'`）后启动：应用正常、只丢弃非法项，不 panic、不空白。（`sanitize` 用例）
- [x] 键盘：`Alt+←/→` 可把焦点所在图标移到另一侧，菜单/命令面板亦可完成同样操作。（含换边后焦点跟随）
- [x] 拖拽落位后不再存在「图标在 A 侧、面板在 B 侧」的可能（不可表示，不是靠 UI 约束）。

**B. tab 停靠（P1）**

- [x·机] 把一条 agent-chat tab 移到右区：右区宿主显示它，中间区该 tab 消失。
- [ ] 同一 tab 只有一个渲染实例：PTY / agent stream 不会双开（移动前后进程数不变）。（G1 用例保证单组归属；进程数需真机）
- [x] docked tab 可关闭；dirty 文件 tab 关闭走既有确认流程（若该 kind 允许停靠）。（关闭有单测；dirty 确认沿用中心那条链，未真机）
- [x] 停在 `pinned` 的 tab 不会被拖入 dock 导致 pinned 状态残留（或明确拒绝并提示）。（`dockTab` 拒绝 + toast）
- [x] 切到另一个项目：右区不显示上一个项目的 tab（显示空态，不是空白死区）。

**C. 快速打开（P2）**

- [ ] Agent Chat 图标固定到右栏后：重启应用 → 图标仍在 → 点击在右区打开 chat tab。（`onBar` 持久化有单测；重启需真机）
- [x] 会话仍存活（关 tab 时选后台运行）：点击接回同一 PTY（不新建会话）。（委派 `useActivateSession`，有单测；真机接回待验）
- [x] 会话已结束：点击走续写/新建降级（复用 `planSessionActivation`，行为与侧栏一致）。（同上一条链路）
- [x] 新开的 agent-chat tab 默认落到右区宿主（D3 选项②）。（`docksNewTabs` 策略覆盖 4 个入口，含槽位跟随图标）

**D. 质量门**

- [x] `pnpm check:quick` 通过（收尾跑一次）。
- [x] 纯函数（placement reducer / 迁移函数）单测覆盖 100%。
- [x] 不变量护栏测试存在且能红：① 一条 tab 只在一个组；② 仲裁顺序覆盖全部 tab 且无重复；③ 落位表与 bar/zone 派生一致。
- [x] `docs/layout-architecture.html` 的「状态源 / 扩展指南」章节与实现同步。

## 术语（避免造第二个名字）

- **落位（placement）**：视图 → 槽位的指派，含 `slot` / `order` / `onBar`。唯一真源。
- **槽位（slot）**：`left` / `right`（未来 `bottom`）。与现有 `ZoneId` 同义，本任务统一叫 slot，代码保留 `DockSlot`。
- **视图（view）**：可被指派的对象，分三族 —— `panel`（单例工具）、`tabHost`（槽位 tab 宿主）、`tabKind`（种类级入口）。
- **停靠（dock）**：tab 实例被移动进某个槽位的宿主。实例级、运行时、不持久化。
- 与既有术语不冲突：不新增「面板区」「抽屉」「side rail」等同义词。

## Notes

- 本任务先用 `planning` 状态出方案；`task.py start` 前需要 D1–D5 拍板。
- 若 P0 单独发布，P1–P3 的 meta 行可以先不落地（`DOCK_VIEW_META` 只含既有 8 个 panel + library 入口），避免无用配置先行。
