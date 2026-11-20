# Design — 看板 tab 的视图是 tab 的事

## 1. 病灶：导航态放错了宿主

`board / flow` 是**导航态**（同一份快照怎么画），不是数据（`teamStore` 的事）。它今天放在
`TeamBoardCenterView` 的 `useState` 里 —— 而那个组件的生命周期是「当前激活的 tab」：

```
切走 → PaneContent 不再渲染该 tab → 组件卸载 → state 丢
切回 → 重新挂载 → useState(activeTab.data.view) → 回到建 tab 时的那个值
```

`activeTab.data.view` 只在 `useTeamBoardTab` 建 tab 那一刻写过一次（`useTeamBoardTab.ts:62`），
之后没有任何写入点。所以「上次我在哪」没有任何地方记着 —— 不是记错了，是**没记**。

第二个放大器在第 49-51 行：重复打开时把 `view` 覆盖成调用方给的。于是即使修好了持久化，
「面板里点一次『在中间打开』」也会把它抹掉。用户描述的是切 tab，但同一个症状有两个触发器
（切 tab / 再打开），只修一个会让他再报一次。

## 2. 选定形状：tab 数据是唯一真相

```
activeTab.data.view  ←── 唯一真相（导航态跟着 tab 走，与 tab 的地址/标题同一层）
   │
   ├─ 渲染：PaneContent 传 view={activeTab.data.view}
   └─ 写入：用户在 tab 内切换 ⇒ PaneContent 注入的 onViewChange ⇒ editorStore.updateTab
```

组件不再持有 `view` 的副本（红线 17：一份事实一份真相）。删除 `useState(initialView)` 与
那个「prop 变了就同步 state」的 `useEffect` —— 它们存在的唯一理由就是维护那份副本。

**为什么由 `PaneContent` 注入写入函数**而不是组件自己调 `updateTab`：
`TeamBoardCenterView` 属 `features/agent-team`，`editorStore` 是编辑器域的。让团队组件直接写
编辑器 store 就是跨域直改内部实现；`PaneContent` 本来就是「tab 数据 → 视图 props」的适配层
（`component-guidelines.md` 的「展示组件 + 数据 adapter」）。同时它已经握着 `tabSpaceKey` 与
`activeTab.id`。

## 3. 重复打开：只激活，不改视图（R4）

```diff
- if (existing.data.kind === 'team-board' && existing.data.view !== spec.view) {
-   state.updateTab(key, existing.id, { kind: 'team-board', view: spec.view });
- }
  state.activateTab(key, existing.id);
```

这是本任务唯一一处**改语义**的地方，理由要写在代码里：旧注释说「从看板切到分配图再点一次
打开，切换结果要保留」，即把「打开」当成「推送一个视图过去」。但用户对同一个 tab 的心智是
**「那是我上次待的地方」**（这正是 fenêtre/tab 的通用预期：切回来不重置）。两者冲突时选后者，
因为：

- 「带我去那儿」= 激活。「重置我上次的选择」= 任何人都不该在**打开**这个动作里做；
- 面板自己的 `board / flow` 切换仍然只影响面板（`TeamTaskSection` 的局部 state 不变），
  用户在中央 tab 里怎么选只影响那个 tab。

代价（必须写下来）：面板切到 flow 后点「在中间打开」，若该 tab 已存在，中央仍是他上次选的
那个视图。这是有意的——要换视图，用中央 tab 自己的头部按钮（那里一直是唯一入口）。

## 4. 现象 2（一打开就是 flow）怎么被这次改动覆盖

首次打开取调用方传入的视图。今天的长相：

| 入口 | 传什么 |
| --- | --- |
| 面板「在中间打开」 | 面板自己的 `taskView`（默认 `board`）|
| 侧栏团队行（本次删除） | `board` |

用户看到 flow，只可能是**面板当时停在 flow**（`TeamTaskSection` 的默认是 `board`，所以这是
他先切过）。本次不改这条（「打开 = 打开我正在看的东西」是对的），但用户可以预期的是：
**只要 tab 存在，任何入口都只会把它带回来，不会换它的脸**。首次打开若从面板的 flow 态发起，
得到的仍是 flow —— 若这仍不符合预期，下一个最小动作是把面板那个「在中间打开」固定传
`board`，一行改动，本次不做（R5 只保证内部/侧栏入口是 `board`）。

## 5. 测试策略

| 层 | 用例 |
| --- | --- |
| `useTeamBoardTab` | 已存在 ⇒ `activateTab` + **`updateTab` 零调用**（AC4）；新建 ⇒ `view` 取入参（AC5）|
| `TeamBoardCenterView` | 点「分配图」⇒ 调 `onViewChange('flow')`（不再断言内部 state）；渲染按 prop 走 |
| `PaneContent`（或 tab 数据层）| 写入走 `editorStore.updateTab` ⇒ `data.view` 变（AC2）|
| 卸载重挂 | 换 `view` prop 重渲染 ⇒ 显示该视图（AC3，等价于「切 tab 回来」）|
| `UnitTeamEntries` | 行内只剩一个按钮；`Board` 文案消失（AC1）|
