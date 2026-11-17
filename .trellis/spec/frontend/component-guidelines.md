# 组件指南

> 本项目中组件的构建方式。

---

## 概述

组件使用 **React 18** + **TypeScript** 构建。大多数组件用 `React.memo` 包裹以优化性能。样式使用 **Tailwind CSS v4**（入口 `src/styles/index.css`）——通过 `@theme` 映射 CSS 变量到 Tailwind 主题色。

---

## 组件结构

### 标准组件文件布局

```tsx
// 1. 导入
import React from "react";
import { listProjects } from "@/features/project/api/projectApi";  // 通过 API wrapper
import { SomeType } from "../types";

// 注意：不在组件中直接 import { invoke } from "@tauri-apps/api/core"
// 所有 IPC 调用通过 features/<domain>/api/<domain>Api.ts 封装

// 2. Props 接口（在同一文件中）
interface MyComponentProps {
  title: string;
  onAction: (id: string) => void;
  isActive?: boolean;
}

// 3. 组件定义
const MyComponent: React.FC<MyComponentProps> = ({ title, onAction, isActive = false }) => {
  // hooks、事件处理、渲染
  return <div className="my-component">...</div>;
};

// 4. 使用 memo 包裹并默认导出
export default React.memo(MyComponent);
```

### 两种可接受的组件声明模式

**模式 A —— `React.FC` + 箭头函数**（适用于小/中型组件，首选）：

```tsx
// src/features/agent/components/AgentIcon.tsx
interface AgentIconProps {
  icon?: string | null;
  size?: number;
  fallback?: React.ReactNode;
}

const AgentIcon: React.FC<AgentIconProps> = ({ icon, size = 16, fallback = null }) => {
  // ...
};

export default React.memo(AgentIcon);
```

> **分层提示**：`AgentIcon` 的解析需要 Tauri 边界（自定义上传图标走 `convertFileSrc`），
> 所以容器住 `features/agent`；纯展示的 `<img>` + 加载失败兼底收敛在
> `shared/components/FallbackImage.tsx`。多 feature 消费的纯展示组件才住 shared。

#### agent 图标**只有一个**来源：`AgentConfig.icon`（2026-11-14）

凡是“这是哪个 agent”的地方（tab 栏 / agent 列表 / 团队花名册头像 / 选择卡），图标都来自
**数据**：`useAgentStore` 里那个 agent 的 `icon` 字段 → `features/agent` 的 `AgentIcon`
（preset 文件或上传路径由 `resolveAgentIconSrc` 解析）。

**禁止在任何 feature 里再维护一张品牌表**。反例（真实故障）：团队花名册曾手抄一张 Simple
Icons 表（只有 claude-code / codex 两项），其余一律回退首字母 —— 于是 `pi` / `codebuddy` 的
成员在花名册上是「P」「C」，而同一个 agent 在 tab 栏上有完整图标。图标资源本来就在，错的只是
“又造了一份判据”。

- 团队侧的投影点：`features/agent-team/hooks/useMemberAgentIcon.ts::useMemberAgentIcon`
  （按 `agentId` 从 store 取 `icon`；只选原始值，不返回 agent 对象 —— 否则每行一个新对象会让
  花名册在每次 store 变动时全量重画），**不**新增第二套解析。
- 回退仍然存在，但只在**真的没有图标**时：`icon === null`（自定义 agent 允许）或 `agentId`
  不在配置里（已删 / store 未加载）⇒ 首字母 + 按成员身份派生的颜色。两种情况都**不**渲染
  一块空白方框（用户分不清“加载失败”与“没有图标”）。

**模式 B —— 具名函数**（用于较大的组件）：

```tsx
// src/layout/TitleBar.tsx（真实形态：骨架组件只收 slot）
interface TitleBarProps {
  actions?: React.ReactNode;
}

function TitleBar({ actions }: TitleBarProps) {
  // ...
}

export default React.memo(TitleBar);
```

### 根组件 App（例外）

`App.tsx` 是唯一**不**用 `React.memo` 包裹的组件。它只做装配（`<AppProviders>` + `<AppShell/>`），
状态协调逻辑位于 `src/app/hooks/` 的 `useAppShell`（`useAppGlobalEffects` + `useAppShellData` + `buildAppShellValues`）。

---

## Props 约定
### 组件规模红线（≤300 行）

**开发硬指标**：组件文件严禁超过 300 行（neeko-check P10）。超线时按职责抽取子组件到独立文件（同目录），抽取不改变公开 API：

> **已升为机器门禁**：由 `check_component_size` ratchet 护栏强制 —— 未登记在 `tools/guards/ledger/component_size.json` 基线的文件越 300 行即 CI 红；已登记基线（存量 59 个）只允许缩小、不得回涨。存量还债是独立任务。

- 列表分区、行块等内嵌展示块 → 独立组件文件，如 `ChangesList` 的 `Section` 抽为 `ChangesSection.tsx`
- 纯展示子块用 `React.memo` 包裹保持引用稳定
- 抽取仅迁移 JSX 与依赖（`cn`/icons/类型），行为零漂移——用 `git diff -w` 对照抽取前后验证语义一致

### 规则

1. **始终使用 `interface`** 定义 Props（不使用 `type` 别名）
2. **Props 接口定义在组件同一文件中**，紧邻组件上方
3. **回调 Props** 使用 `onXxx` 命名：`onSelectAgent`、`onToggleAddMenu`、`onAddProject`
4. **可选 Props** 使用 `?`，通过解构赋默认值
5. **领域模型类型** 从 `@/shared/types` 导入（`Project`、`AgentConfig` 等）

### 大型组件 Props 分组约定

当 Props 数量接近两位数时，优先按职责分组，避免继续扩张扁平接口：

```tsx
interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  actions: ProjectItemActions;
  viewConfig?: ProjectItemViewConfig;
}
```

分组建议：

1. `actions`：事件回调与命令式操作
2. `state`：仅当子组件需要外部状态快照时使用
3. `viewConfig`：样式、图标、可选 UI 配置

### 示例

```tsx
interface ProjectItemProps {
  project: Project;                           // 从 types.ts 导入
  isActive: boolean;                          // 组件特有的 prop
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;            // 可选回调
  collapsed?: boolean;                        // 可选，带默认值
}

const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isActive,
  onSelect,
  onRemove,
  collapsed = false,
}) => { ... };
```

---

## 表单控件必须复用 `ui/` 原语（禁止裸写 `<input>`）

**判据**：页面里的文本输入一律走 `@/ui` 的 `Input` / `Textarea`，不裸写原生标签。

### 为什么是硬约束而不是风格偏好

`ui/Input` 内部封装了三件裸标签不会自带的**行为**：

| 保护 | 漏掉的后果 | 可观测性 |
| --- | --- | --- |
| `useImeSpaceGuard` | 中文输入法提交「拼音 候选」时把分词空格留在值里 | 用户可见，但只在特定 IME + 特定输入下出现 |
| `noAutocorrectProps` | WebKit 句首自动大写 / 自动纠错 / 拼写检查 | macOS / Linux WebKit 下才显现 |
| `disabled:` / focus ring | 禁用态与焦点态各页面不一致 | 视觉漂移，逐页面 review 才看得出 |

三条都**难以被单元测试在裸 `<input>` 上捕获**（渲染出来的都是 textbox），所以漏了通常要靠用户报告才知道。这正是必须写成源码级护栏的原因。

### 尺寸差异用 `size` 变体，不要绕开组件

密集表单/行内编辑需要紧凑输入框。**加变体，不要另起一套裸标签**：

```tsx
// 错误 —— 丢了 IME 守卫、WebKit 关断、统一 focus 样式
<input className="h-7 px-2 text-[0.82em]" value={v} onChange={...} />

// 正确
<Input size="sm" value={v} onChange={...} />
```

`size` 变体（`default` / `sm`）用 `cva` 定义，与 `Button` 同一模式。需要局部差异（如某区块换底色）时传 `className`，`cn`（tailwind-merge）会按后写覆盖前写的规则消解冲突。

### 行内编辑的 focus / 全选归组件，不归调用方（2026-11-05）

行内重命名（侧栏会话行、worktree 行、tag group 行）统一用 `InlineRenameInput`：它渲染
`ui/Input size="sm"`，并在**挂载时**做一次 `focus()` + `select()`；调用方只持有草稿状态，
不持有输入框 ref。

错误形态：调用方各写一份 `useEffect(() => { focus(); select(); }, [draft])` —— 依赖草稿会让
每敲一个字符重新全选，下一次按键覆盖整段（用户实测：「一输入就是选中状态，只能打出最后一个
字」）。正确依赖是 `[]`（编辑态的生命周期 = 挂载 / 卸载）。

两个回归钉子：`InlineRenameInput.test.tsx`（挂载即 focus + 全选、逐字符输入完整字符串）与
`SessionList.test.tsx` 的 `userEvent.type` 多字符用例。只用 `fireEvent.change` 一次改写整段
会把这类缺陷完全掩盖。

### 例外：`type="checkbox" | "radio" | "file"`

这些不需要 IME / 自动大写 / 文本 focus 样式，裸标签是正常用法。

### 可访问性：`label` 必须关联控件

```tsx
// 错误 —— 用 <label> 包自定义组件时，jsx-a11y 与读屏软件都无法关联
<label className={groupCls}>
  <span>Name</span>
  <Input value={...} />
</label>

// 正确 —— 显式 htmlFor + id
<div className={groupCls}>
  <label htmlFor="agent-form-name">Name</label>
  <Input id="agent-form-name" value={...} />
</div>
```

护栏 `jsx-a11y/label-has-associated-control` 会报错（静态分析看不到 `Input` 内部渲染的 `<input>`）。测试用 `getByLabelText(/^Name/)` 取控件 —— 关联断了就取不到。

### 护栏

`features/agent/components/__tests__/AgentForm.a11y.test.tsx`：

- 裸 `<input>` 计数必须等于 `type="checkbox"` 计数（多一个就是回潮）；
- 每个带标签的字段都能被 `getByLabelText` 取到；
- `input[id]` / `textarea[id]` 的 id 互不重复。

> 存量：全仓仍有约 90 处裸 `<input>`（分布在 20+ 文件）。逐文件迁移是独立任务，但**新增或修改的代码不得再引入新的裸文本输入**。

## 多 Tab 面板 + 内嵌现有组件模式

### 适用场景

新建统一面板需要整合多个资源域（如 Resource Library 整合 Skills / Prompts / Actions），且需要内嵌已有独立面板（如现有 `SkillsPanel`）作为其中一个 Tab 内容。

### 模式结构

```tsx
// LibraryPanel.tsx —— 壳层（v7 两栏 master-detail 布局，内部分栏走统一标准见下）
const LibraryPanel: React.FC = React.memo(() => {
  const activeKind = useLibraryStore((s) => s.activeKind);
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-bg-primary">
      <ResizablePanelGroup orientation="horizontal" id="library-split" className={`flex-1 min-h-0 ${ISLAND_SPLIT_GROUP_CLASS}`} onLayoutChanged={handleLayoutChanged}>
        <ResizablePanel id="library-nav" defaultSize={`${navSize}%`} minSize={NAV_MIN_PX} maxSize={`${NAV_MAX_PERCENT}%`} panelRef={navPanelRef} className={ISLAND_CLASS}>
          <LibraryActivityBar />   {/* 资源类型导航（Skills/Prompts/MCP） */}
          <LibraryNavTree />       {/* 按 activeKind 切换导航树 */}
        </ResizablePanel>
        <ResizableHandle id="library-nav-handle" />
        <ResizablePanel id="library-detail" minSize={DETAIL_MIN_PX} className={`min-w-0 ${ISLAND_CLASS}`}>
          <LibraryDetail />        {/* 工具栏 + 搜索 + 内容路由 */}
        </ResizablePanel>
      </ResizablePanelGroup>
      {/* 不渲染任何 store 驱动弹窗：见「store 驱动弹窗的全局宿主（强制）」 */}
    </div>
  );
});

// LibraryDetail.tsx —— 详情岛：面包屑 + 动作按钮 + 搜索 + 内容
const LibraryDetail: React.FC = React.memo(() => {
  return (
    <div className="flex flex-col h-full min-h-0">
      <LibraryToolbar />                          {/* 面包屑 + New/Import/Export */}
      <LibrarySearchBar value={searchQuery} onChange={setSearchQuery} ... />
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeKind === 'skill' && <SkillContent titleless />}
        {activeKind === 'prompt' && <PromptListSection onInsert={handleInsert} />}
        {activeKind === 'action' && <ActionsTabContent />}
        ...
      </div>
    </div>
  );
});
```

### 关键规则

1. **壳层不重复实现业务逻辑**：内嵌 Tab 内容仅做透传，不复制内部逻辑
2. **状态隔离**：壳层 store 与内嵌面板的 store 独立，通过 props/context 通信
3. **Tab 切换不丢失内嵌面板状态**：用 CSS `display` 控制显隐，不要 unmount
4. **双视图模式**：网格/列表切换通过 `viewMode` 状态控制
5. **面板内分栏走布局统一标准**：见「面板内分栏（统一标准）」节——禁止手写固定宽 + 自研拖拽
6. **禁止岛屿嵌套**：自带岛屿 + 海面的面板（Library 双岛）必须裸挂进中央区/zone，
> 外层只允许透明定位包装（hidden 切换、flex 尺寸），不得再套 `rounded-lg bg-bg-secondary`
> 岛屿层。DockZone 的单岛 + 扁平内容、Settings 的裸挂是参照。
7. **导航结构复用 nav primitives**：`src/shared/components/nav/`（`NavSection` 分区外壳 /
> `NavRow` 行骨架 / `CountLabel` 三态计数 / `NavEmpty` 空态）是 Skills 与 MCP 导航的唯一来源；
> 新增资源导航禁止复制现有分区结构。数据选择、CRUD、刷新 effects 保留各域 store/hook 内，
> primitives 只收敛表现层（props 组合，不持有业务状态）。

### 示例

`features/library/components/LibraryPanel.tsx`（2026-07-29）

---

## store 驱动弹窗的全局宿主（强制）

> 触发事故：状态栏 Prompts 选含 `{{var}}` 的 prompt 后「Fill Variables」不出现，用户打开 Library
> 视图时它才蹦出来（2026-10-01）。根因不是状态栏，而是**渲染点放错了层**。

### 判据

弹窗的开关来自 zustand store（`xxxOpen` / `pending` / `variableRequest` 等全局字段）⇒ 它是
**应用级 UI**，渲染点必须在应用级常驻组件里：`src/app/AppModals.tsx`（或它挂载的 feature 宿主组件）。

禁止把这类弹窗渲染进任何「按视图条件挂载」的容器：`AppCenter` 的 settings 分支（会卸载整棵
中心子树）、`DockZone` 的面板、tab 内容组件、懒挂载（`React.lazy` + 首次进入才 mount）的面板。
Library 子树虽已改为启动即常驻，但仍属于「会被 settings 分支卸载」的中心视图，不是合法渲染点。

### 常驻挂载 ≠ 可见（`VisibilityScope`）

为了消除 `React.lazy` 挂载间隙造成的空帧，子树可能被改成「启动即挂载、只切 `hidden`」。此时
**mount 副作用**（列表拉取 / 订阅）会从「用户真的打开它」提前到**应用启动**。规则：

- 「可能隐藏但常驻」的子树由**挂载方**包一层 `VisibilityScope`（`src/shared/contexts/`）；
- 子树内部用 `useVisible()` 门控 mount 拉取（每次可见刷新 or 首次可见一次，按语义选）；
- 不要用 `display`/`hidden` 反推可见性，也不要让子树去猜自己是 dock 面板还是中心视图；
- 无 Provider 时 `useVisible()` 恒为 `true`（dock 面板 / 单测行为不变）。

判例：`AppCenter` 的 Library 子树 + `LibraryPanel` / `SkillContent` 的拉取门控。

### 为什么必须（两条独立失效）

1. **静默不出现**：flag 翻起时没有渲染点，用户点了没反应、没有任何报错。
   `AppCenter.tsx` 的 settings 分支整体卸载中心子树 ⇒ 停在设置页时触发状态栏动作，挂在中心视图
   里的渲染点根本不存在（历史上 Library 面板还要等首进才挂载，问题更常发生）。
2. **Promise 永久悬挂**：若流程 `await` 弹窗结算（`openVariableDialog` / `confirmAction`），
   无渲染点 = 无结算者 ⇒ 后续动作（计次、插入、关闭 tab）整条链静默丢失。

注意：`ui/Dialog.tsx` 走 Radix portal，所以「隐藏但已挂载」（`DockZone` 的 `hidden` class）**无害**；
有害的是**真卸载**（条件渲染 / 懒挂载）。别用「它只是被藏起来了」安慰自己。

### 宿主三件套（照 `ConfirmHost` 抄）

| 件 | 做法 | 参照 |
| --- | --- | --- |
| 渲染点 | 一个 feature 内的 `XxxHost` 组件，由 `AppModals` 挂载，内部只做 store ↔ 弹窗连线 | `src/shared/components/ConfirmHost.tsx` · `src/features/library/components/PromptDialogHost.tsx` |
| 就绪标记 | 宿主 effect 挂载时 `setXHostMounted(true)`、卸载时 `false` 并结算在途请求；store 侧无宿主即 fail-closed 立即结算 | `confirmStore.ts` 的 `setConfirmHostMounted` · `libraryStore.ts` 的 `setPromptDialogHostMounted` · `closeConfirmStore.ts` 的 `setCloseConfirmHostMounted` |
| 浮层上报 | 开/关时 `useOverlayStore.setOverlayOpen(id, bool)`（id kebab-case），否则弹窗被 Browser 子 webview 遮挡（`useBrowserTab.ts` 靠 `count > 0` 隐藏） | `quickOpenStore.ts` · `closeConfirmStore.ts` |

硬约束：**resolver 不进 zustand 状态**（未决 Promise 不可序列化，放模块级 `let`）；
取消 / × / Esc / 遮罩 / 宿主卸载都必须结算（用 `null` 表达「没拿到内容」，与「用户确认的空字符串」区分开）。

### 禁止模式

❌ 面板内渲染 store 驱动弹窗 + 触发点靠「先把面板切出来」救场：那只是把「弹个表单」变成
「换掉用户的工作区」，且在面板根本没挂载的视图（settings）下依然失效。
❌ 用 `setTimeout`/轮询等宿主出现：时序补丁，掩盖的是层放置错误。
❌ 只断言 `store.xxxOpen === true` 的测试：证明不了弹窗渲染过 —— 本次事故就是这样漏网的。
必须渲染宿主并断言 DOM（`PromptDialogHost.test.tsx` 的「仅凭 store flag 即渲染」是范本）。

### 测试写法陷阱

`act(() => store.openXDialog(...))` 里若回调 **return** 了 Promise，React 的 `act` 会当成
async 作用域且永不收敛 ⇒ 后续渲染全部丢失（表现为「明明状态已写入，DOM 里什么都没有」）。
必须写块级 body：`act(() => { store.openXDialog(...); })`。

---

## 面板内分栏（统一标准）

> 布局框架层面规范：任何面板的新增/改造凡涉及左右（或上下）可调分栏，一律走本标准，
> 禁止手写固定宽（`w-60` 等）+ 自研指针拖拽。Projects 面板（dock zone 级）与 Library
> 内部分栏（面板级）共用同一套基元与状态规约，只是归属层级不同。

### 基元（唯一来源）

- `src/ui/Resizable.tsx`：`ResizablePanelGroup` + `ResizablePanel` + `ResizableHandle`
> （`react-resizable-panels` v4 薄封装，尺寸同时支持百分比字符串与 px 数字）。

### 状态规约

1. **Panel 自身不持有宽度**：`defaultSize` 绑定 owning store 的百分比值（如 dock 的
> `leftSlotSize`、Library 的 `navSize`，默认 18 与应用侧栏比例一致）。
2. **Group 级 `onLayoutChanged` 提交**：pointer-up 语义 + `meta.isUserInteraction` 过滤
> 程序性变化（挂载/imperative resize），回调内经 `panelRef.current?.getSize().asPercentage`
> 读最终值写入 store——写入天然不与拖动并发，无需去抖（见 `DockLayout.handleLayoutChanged`）。
3. **尺寸进 store 并 `persist` + `partialize`**：只持久化尺寸等布局值，不持久化 transient
> 内容态；数值约束（min/max）由 Panel props 承担，store setter 保持 plain。
4. **约束就近声明为模块常量**：内容驱动的下限用 px（如导航列 200px），上限用相对百分比
> （如 40%）；导航列不设 `collapsible`（zone 级折叠是 DockLayout 的专属语义）。

### 变体：面板**没有** owning persisted store 时（`useDefaultLayout`）

上节第 3 条的前提是「这个面板已经有一个会 persist 的域 store」。`TeamPanel` 的列表页不满足：
它的布局只有这一个数字，而团队域的 store（`teamStore`）是**不持久化**的（快照是后端的推导
产物，缓存它等于造第二个真相源）—— 为这一个数字新建一个 zustand + `persist` 是过度设计。

这种情况下用库自带的 `useDefaultLayout({ id, panelIds, onlySaveAfterUserInteractions: true })`：
它把「面板 id → 尺寸」的存储格式、版本校验与解析失败回退都做了（手写一份 localStorage 就是
第二个存储口径，而格式漂移是**静默**的 —— 读不出来只是回到默认，没人会报）。判据是**谁拥有
存储格式**：域 store 已持久化布局 ⇒ 走 store；没有 ⇒ 走 `useDefaultLayout`。两条都不允许手写
`localStorage.getItem` + `JSON.parse`。

两个必须照做的细节：

- **`onlySaveAfterUserInteractions: true` 不能省**：不传的默认是**每次布局提交都存**，包括
  首次布局与窗口 resize。省了它，注释里那句「只存用户拖动」就是假的 —— 「注释说一套、代码
  做另一套」比没有注释更糟。
- **`panelIds` 用模块级常量**，不要行内数组字面量：它进了库内若干 `useMemo` / `useCallback`
  的依赖表，行内字面量会让持久化的回调引用每帧都变（白掉 memo）。

### 分隔条必须与 Group 同轴向（`ResizableHandle` 的 `orientation`）

`ResizableHandle` 的默认几何是**横向**（`w-px` + `cursor-col-resize`）。放进
`orientation="vertical"` 的 Group 里而不传 `orientation="vertical"`，症状是：手柄塌成一根
1px 宽的竖线（拖拽命中区几乎为零）、光标还是左右箭头 —— **布局看着对，就是拖不动**。
竖向 Group 必须同时写 `<ResizablePanelGroup orientation="vertical">` 与
`<ResizableHandle orientation="vertical">`。

### 分栏的两侧各自滚动（禁止分栏外面再包一层滚动）

分栏的意义是「两块都同时在场」。如果 Group 外面再包一层 `overflow-auto`，两块又变回一整个
长文档：滚到底之后上一块的信息找不回来，而且两个滚动条叠在同一可视区里时，滚轮命中哪个取决于
光标位置 —— 用户看不出这件事。

规则：**Group 用 `min-h-0`，每个 Panel 内部自己 `min-h-0` + `overflow-auto`**（`ResizablePanel`
自带 `overflow-hidden`）。`TeamPanel` 的列表页就是这个形状（`TeamListPane`）：队长入口与
「已有团队」各滚各的，而 `TeamListSection` 内部只有**行区**滚动，标题 / 刷新 / 截断提示留在原地。

分隔线仍然需要一条可见的 `border-t`：`ResizableHandle` 默认 `bg-transparent`（只在悬停/拖拽
时点亮），`gap-px` 露出的又是同色底 —— 去掉它两层之间就没有任何可见边界。

**注意这条 `border-t` 是给分隔条做的「可见替代」，不是在 `islands.ts` 的 3px 几何上加线**。
两者是同一个 1px 槽位的两种画法：`islands.ts` 的规则管的是**岛屿之间**（窗口级 `w-px` 手柄 /
面板内 `gap-px`），而这里的目标是让用户**看得见边界在哪、能拖**。想同时满足「不越出 3px 几何」
与「边界可见」的正确画法是让手柄自己可见（`bg-border`）而不是加 border —— 那是 `ui/Resizable`
的改动，超出本次范围，故记账于此。

### 层级对照

| 层级 | Group 归属 | 尺寸存哪 | 示例 |
|---|---|---|---|
| 窗口级三分栏 | `DockLayout`（`neeko-main`） | `dockStore`（`leftSlotSize`/`viewSizes`，键=ViewKey） | Projects 所在左 zone |
| 面板内两栏 | 面板自身（如 `LibraryPanel#library-split`） | 面板域 store（如 `libraryStore.navSize`） | Library 导航列/详情列 |

### 海面几何（唯一来源 `src/layout/islands.ts`）

任意两座岛屿之间永远是 3px 海面 = 1px 面板内缩 + 1px 分隔条 + 1px 面板内缩：

- 窗口级（DockLayout）：zone 面板各留 1px 内边 + `ResizableHandle`（`w-px`）；
- 面板内部分栏：宿主 panel 承担外圈内缩，Group 只用 `ISLAND_SPLIT_GROUP_CLASS`
> （`gap-px`）分隔岛屿，禁止 Group 再加外圈 padding（会与宿主双重内缩）。

禁止各面板自定 gap/padding 数值。

### 岛屿外壳（唯一来源 `src/ui/Island.tsx`）

所有浮动面板表面都是同一套类（flex 纵填 + 圆角 + 细阴影 + 二级底），只填内容、不重写：

- 组件 `<Island className="…">`（尺寸/定位类透传，如 `flex-1`、`h-full`、`relative` + 行内高）；
- 非 div 宿主（`ResizablePanel`）用导出的 `ISLAND_CLASS` 字符串；
- 海面几何见上节（`src/layout/islands.ts`）。

### 表面层级契约（四条，缺一条就是重犯）

> 触发事故：Tasks 面板（2026-11-03）。用户反馈「太丑，没有遵循项目的 UI 规范」。
> 复盘结论不是审美，而是**表面层级整个倒过来了**：面板根节点写 `bg-bg-primary`（海面色）
> 被中心区 `<Island>`（`bg-bg-secondary`）包着 —— 岛被填成海，中心区看起来像挖了个洞；
> 看板列与卡片又各自手写 `rounded-md border border-border bg-bg-secondary`，没有一处走
> `ISLAND_CLASS`。而当时**没有任何测试或护栏会失败**（`check_ui_style_tokens` 只判硬编码色）。

| 层 | 谁负责 | 类名 | 禁止 |
| --- | --- | --- | --- |
| 海面 | 中心框架（`CenterViewFrame`） | `bg-bg-primary` | 视图自己再画一层海面 |
| 岛屿 | 每块**独立可滚动/可聚焦**的内容块 | `ISLAND_CLASS` | 手写 `rounded-* border border-border bg-bg-secondary` 冒充岛屿 |
| 岛内分区 | 主岛内的列 / 列表 / 空态容器 | `bg-bg-tertiary` | 分区套 `ISLAND_CLASS`（一排浮岛） |
| 分区内控件面 | 分区里的卡片 / 行 / 输入框 | `bg-bg-primary` 或 `bg-bg-secondary`（**必须与所在分区不同色**） | 与所在分区同色（对比恒 1.00，只剩一个方框） |
| 岛内 header / footer | 岛内的横条 | **不自刷背景**，只写 `border-b` / `border-t` | 满宽横条刷 `bg-bg-tertiary`（与下面的分区连成一片） |
| 岛间距 | 分栏宿主 | 分栏：`ISLAND_SPLIT_GROUP_CLASS`；并列/堆叠：`ISLAND_GAP_CLASS` | 各面板自定 `gap-2` / `p-2` |

判据：

1. **一座岛 = 一块面板，不是一块滚动区**（2026-11-03 修正）。
   看板每列、列表**不是**岛 —— 它们是主岛内部的分区（`bg-bg-tertiary`，圆角见下节「圆角块」）；
   列内的卡片同理。只有**可以独立开/关的另一块内容**（如详情面板）才是第二座岛。

   > 这条曾经写反了（「看板每列、列表、详情各是一座岛」），后果是看板变成「一排浮岛漂在
   > 海面上」，而 Library 的正确形态是**一座主岛 + 岛内 toolbar/content**。用户反馈原话：
   > 「中间应该像这样有一层岛屿作为内容的承载，而不是直接内容在海里面」。
   > 判据不是「它自己滚不滚」，而是「它是不是一块独立的 UI 单元」。
2. **岛屿外壳只有一处**（`ISLAND_CLASS` / `<Island>`）。任何自写的 `rounded-* border border-border bg-bg-secondary`
   都是第二套外壳，必须删。
3. **岛间距只有一处**：分栏位置用 `ISLAND_SPLIT_GROUP_CLASS`（`gap-px`，两侧各贴一条
   `ResizableHandle`，三者相加才是 3px）；非分栏位置用 `ISLAND_GAP_CLASS`（6px，对应
   `--gap-island`）。两个常量**不能互换**：只写 `gap-px` 而没有手柄时岛屿的 `rounded-lg`
   在 1px 缝里读起来像表格线。
4. **自己带岛屿的视图必须裸挂进中心区**（判据是「这个视图内部有没有岛」）：
   `ProjectView` 是裸内容 → 被 `<Island>` 包；`Library` / `Tasks` 自带岛 → 裸挂，
   外层只给透明定位包装（`flex-1` + `hidden` 切换）。套一层岛会让视图内部的海面色把外层岛
   填成洞。机器判据：`src/app/components/__tests__/AppCenter.test.tsx` 的
   「中心视图的包装形状」三条。

#### 中心视图框架：几何的**唯一所有者**（`src/app/components/CenterViewFrame.tsx`）

> 触发事故：Tasks 面板「高度和宽度没有和其他中间内容区域对齐」。用户的原话指出了真正的
> 判据：「中间这块应该是应用的一个统一组件，而不是每创建一个功能其中间的大小需要重新实现，
> 内容只是在这个框架里实现」。
>
> 实测当时四个中心视图各自写外壳，几何**三种**：
>
> | 视图 | 自己的外壳 | 结果 |
> | --- | --- | --- |
> | ProjectView | `<Island className="flex-1 h-full">` | 满格 |
> | Library | 根 `bg-bg-primary`（无内缩） | 满格 |
> | Tasks | 根 `rounded-lg bg-bg-primary p-1.5` | **四周多缩 6px + 双层圆角** |
> | Settings | `<Island className="flex-1">` | 满格 |
>
> 根因不是审美：**外圈内缩有两个所有者**。布局框架里这件事本是唯一的 —— `DockLayout` 的
> `center-area` 面板给 `py-0.5 px-px`。功能面板再各缩一次，就必然对不齐。

**框架与内容的边界**（新增中心视图时照此填，不要自己写外壳）：

| 归 `CenterViewFrame` | 归功能视图 |
| --- | --- |
| 海面（`bg-bg-primary`） | 岛（`<Island>` / `ResizablePanel` + `ISLAND_CLASS`） |
| 尺寸链（`flex-1 min-h-0 flex-col`） | 岛内的分栏、列表、空态、表格 |
| 裁切（`overflow-hidden`） | — |
| 显隐（`hidden` 类，**不卸载**） | — |

**框架绝不加 padding / 圆角 / margin**：内缩归 `DockLayout` 的 `center-area`，
圆角归岛本身。框架再给一层 = 双重内缩（对不齐的直接来源）+ 双层描边。

硬约束（违反即 Block）：

1. **一个视图只用 `CENTER_VIEW_FRAME_CLASS` 这一份几何**，禁止再写 `p-*` / `rounded-*` /
   `bg-bg-primary` / `h-full`。视图只负责「我这一格里放什么岛」。
2. **AppCenter 里恰好一层框架**。给每个视图各套一个 `CenterViewFrame` 也会破坏不变量
   （N 个几何所有者）—— 视图是框架的**子节点**。
3. **显隐用 `hidden` 类，不用原生 `hidden` 属性**：后者被 `.flex`（author 样式）覆盖，不生效。
4. 机器判据：`CenterViewAlignment.test.tsx`（四视图框架类串集合相等 + 恰好一层）+
   `CenterViewFrame.test.tsx`（框架不含 `p-*`/`m-*`/`rounded-*`）+ 各视图自己的
   「本面板不自写几何」用例。

#### 表面用法：**同一面板内相邻两层不能同色**（2026-11-03）

> 触发事故：用户反馈「当前的 UI 和整个应用主题不适配」。查下来不是配色选错，而是
> **表面层级被压平了** —— 上一轮修「看得出岛」时，把卡片也写成了 `bg-bg-tertiary`：
>
> ```
> 主岛        bg-bg-secondary
> └ 看板列    bg-bg-tertiary   ← 分区
>   └ 卡片    bg-bg-tertiary   ← 与列同一个 token
> ```
>
> 卡片与列在**每一个主题**里对比度恒为 **1.00**：边框之内与边框之外完全同色，
> 卡片不是「浮在列里」，而是「列被画了一个方框」。
>
> **教训**：上一轮我只检查了「列 vs 岛」（1.19 之类，确实不同），却没检查
> 「卡片 vs 列」。逐层检查必须**沿整条阶梯走到最内层**，在中间停一层就等于没查。

**全仓惯例**（同一件事只有一个答案）：

| 层 | 类名 | 谁在用 |
| --- | --- | --- |
| 岛 | `bg-bg-secondary` | `<Island>` / `ISLAND_CLASS` |
| 岛内分区 | `bg-bg-tertiary` | 看板列、列表容器、空态容器 |
| **分区内卡片 / 行 / 输入框** | **`bg-bg-secondary`**（看板卡片 / 列表行）或 **`bg-bg-primary`**（`ui/Card` / `ui/Input` 等通用控件） | `WorkItemCard`、`ListView` 的行、`ui/Card`、`PromptCard`、`McpAgentServerList`、`TaskCardRow`、`MemberApprovalQueue` 的行 |
| 岛内 header / footer | **不自刷背景**，只写 `border-b` / `border-t` | `LibraryToolbar`、`GitControlPanel`、`PaneTabBar`、`McpProjectContent`、`TasksPanelHeader`、`WorkItemDetail` |

> **为什么卡片有两种合法 token**：判据不是「等于某个具体 token」，而是
> **「与它所在的分区不同色」**（对比 ≥ 1.05，见 `surfaceContrast.test.ts`）。
> 看板卡片与列表行取 `bg-bg-secondary`（实测在每个主题里都比 `bg-bg-tertiary` 亮）；
> `ui/Card` 等通用控件沿用 `bg-bg-primary`。两者都成立 —— 写死 token 名会让
> 「换一套表面阶梯」这种正当改动变成改测试。

两条容易被写反的地方：

1. **`bg-bg-primary` 在分区内不是「海面」**。它只在「岛 ↔ 海」的边界上代表海；
   一旦已经进了岛内的分区，它就是「分区之上再一层控件面」。判断某个 `bg-bg-primary`
   违不违规，看它的**父节点**是什么：父节点是岛/分区 ⇒ 合法；父节点是中心框架 ⇒ 违规（挖穿岛）。
2. **满宽横条不自刷 `bg-bg-tertiary`**。全仓 `<header>` 自带 `bg-bg-*` 的只有 0 处
   （修完后）；`bg-bg-tertiary` 的正确位置是**分区**与**控件**（按钮、输入框），
   不是「横条」。一条满宽 tertiary 横条会与它下面的分区（也是 tertiary）连成一片，
   分隔线形同虚设。

**机器判据**（三层，缺一层就会像上一轮那样「绿着却错」）：

| 层 | 文件 | 断言 |
| --- | --- | --- |
| 数值（跨主题） | `features/work-items/components/__tests__/surfaceContrast.test.ts` | 相邻两层对比 ≥ 1.05（五个主题逐个过）；含「同色 = 1.00」反证 |
| DOM（token 不同） | `BoardView.test.tsx`「卡片与所在列是**不同表面**」 | 卡片与列**不共享**表面 token（不是断言等于某个具体 token） |
| DOM（不自刷表面） | `TasksPanel.test.tsx`「岛内 header 只靠 border 划界」、`UndoBar.test.tsx`、`WorkItemDetail.test.tsx` | header / footer / 底条不含任何 `bg-bg-*` |

**为什么数值层不能省**：`toHaveClass('bg-bg-primary')` 只能证明某一行文本没被改掉，
证明不了它在别的主题下看得见。而把 token 名写进测试又会让「换一套表面阶梯」这种
正当改动变成改测试。所以数值判据写成**对比度阈值**，DOM 判据写成**「两者不同」**。

#### 看板 / 列表：**圆角块**（2026-11-03 二次裁决）

> 触发：用户看过参考图后确认「列要变回圆角块」，同时明确「**底层 token 不变，卡片自己适配**」。

上一版把列判成「没有圆角/阴影的分区」——那是在否决「列套 `ISLAND_CLASS`」
（`rounded-lg shadow-sm bg-bg-secondary`，看板会变成「一排浮岛漂在海面上」）。
但参考图的列是**中间态**，spec 当时没考虑过。三条特征必须**分开判**：

| 特征 | 取值 | 为什么 |
| --- | --- | --- |
| 圆角 | `rounded-lg` | 列是一块有边界的块，不是紧贴的分区条 |
| 阴影 | **无** | 有阴影就是「浮岛」，即当初被否决的形态 |
| 底色 | `bg-bg-tertiary` | **底层不变**（用户明确要求）；换 token 会连带影响全仓表面阶梯 |
| 间距 | `ISLAND_GAP_CLASS`（6px） | 圆角在 1px 缝里读成表格线（见 `islands.ts`） |

**判据是「无阴影」，不是「无圆角」** —— 这条必须写进测试注释，否则下一个人会照着
「列不该有圆角」的旧结论把它改回去。

#### 卡片与行：**自己适配底层，不是改底层**

底层 token 不动，所以「卡片要浮在列上」只能靠**换卡片自己的底色**：

| 层 | 底色 | 五主题实测对比（对列 `bg-bg-tertiary`） |
| --- | --- | --- |
| 列 | `bg-bg-tertiary` | — |
| 卡片 / 行 | **`bg-bg-secondary`** | dark 1.19 / light 1.09 / claude 1.24 / one-dark-pro 1.10 / classic-dark 1.39 |

上一版卡片用 `bg-bg-primary`，在 **dark 下比列还暗**（对比 1.25 是「列更亮」）——
观感是「列在发光、卡片是洞」，与参考图相反。`bg-bg-secondary` 在每个主题里都比列亮。

行与卡片的差别只有一档：

| | 圆角 | 底色 | 阴影 | 内距 |
| --- | --- | --- | --- | --- |
| 卡片（看板列里） | `rounded-lg` | `bg-bg-secondary` | `shadow-sm`（轻） | `p-3`（12px） |
| 行（列表里） | `rounded-lg` | `bg-bg-secondary` | **无** | `px-3 py-2.5` |

**行不加阴影**：一屏 20 行的阴影会让列表看起来在抖。
**行之间靠 6px 空隙分开，不再画 `border-b`**：块之间画线就退回「表格行」，
与看板的圆角块并列时两个视图读起来像两个产品。

#### 卡片标题：**主信息要占 2-3 行**

参考图里标题占 2–3 行、字重最重。上一版是 `text-meta font-medium` + `truncate`：
长标题被压成一行省略号，扫视时读不到「这件事是什么」。

```tsx
// 对：三行上限（卡片高度仍然有界）
className="… font-semibold break-words line-clamp-3"

// 错：单行截断
className="… font-medium truncate"
```

#### 卡片时间：**取 `updatedAt`，且是纯函数**

看板列是「它现在处于哪个阶段」，用户扫视时问的是「这条多久没动过了」——
那是 `updatedAt`。`createdAt` 对一条 3 个月前建、昨天刚流转的卡片会显示"3 个月前"，
读起来像「这件事烂了三个月」，与实际相反。

`features/work-items/utils/relativeTime.ts::relativeUpdatedAt(updatedAt, now)`：
**`now` 必传**（不给默认值）。函数内读 `Date.now()` 的后果是 `React.memo` 全灭
（每次父级渲染都重算），且测试只能靠 mock 全局时钟。

未来时间戳（时钟不同源）返回**空串**（不显示）——「-2 分钟前」比不显示更糟。

#### 表面层叠判据：**自动发现，不要手写配对列表**

> 同一个缺陷（表面层级没走到最内层）出现了**三次**：
>
> | # | 形态 | 当时为什么没被发现 |
> | --- | --- | --- |
> | ① | 海面 vs 岛 | 面板根写了海面色，被外层岛包着 → 岛被填成海 |
> | ② | 卡片 vs 列 | 卡片也写 `bg-bg-tertiary` → 与列同色，恒 1.00 |
> | ③ | 行 vs 主岛 | 列表容器没底色，行（`secondary`）直接叠在主岛（也是 `secondary`）→ 恒 1.00 |
>
> 每次的修法都是「人肉列一张我关心的 token 配对」，而缺陷恰好落在**没列到**的那一对上。
> 手写列表只能覆盖「我已经想到的层」—— 这是**结构性的盲区，不是疏忽**。

**现在的判据形态**（`features/work-items/utils/surfaceLayers.ts` +
`components/__tests__/SurfaceContrast.test.tsx`）：

1. **渲染真实组件**（Board / List / 空态），不是手写 `<div>`；
2. `collectSurfacePairs(root)` 自动抽出每对「内层表面 / **最近的外层表面**」；
3. 对每一对，在**每个主题**下验算对比度 ≥ 1.05。

新增一层表面时它自动进入判据，**不需要有人记得去登记**。

三条硬约束（每条都是踩出来的）：

| # | 约束 | 违反后果 |
| --- | --- | --- |
| 1 | 视图必须**包在真实宿主里**渲染（如主岛外壳） | 独立渲染时外层没有表面 ⇒ 不产生配对 ⇒ 「缺一层」的缺陷**完全隐身**（变异验证抓到的） |
| 2 | 「外层」是**最近画表面的祖先**，不是直接父节点 | 真实代码中间夹着透明容器（`<ul>` / `flex` wrapper），按父节点判会漏 |
| 3 | 收集器**不判断可见性**，只如实报告配对 | 若它只收集「不同 token」的对，同色缺陷永远进不了判据集合 |

**必须做变异验证**（判据的价值全在「坏掉时会红」）。两条已固化在用例里：

- 删掉列表分区层 → `bg-bg-secondary > bg-bg-secondary` 在五个主题全红；
- 卡片改成 `bg-bg-tertiary` → `bg-bg-tertiary > bg-bg-tertiary` 全红。

**辅助判据**：`findMultipleSurfaces(root)` 抓「同一元素写了两个表面类」——
两个 `bg-bg-*` 并存时实际生效取决于 CSS 产出顺序而非书写顺序，**不可预测**，一律禁止。
这条与「内外层可分辨」是两件事，分开判。

#### 面板可见文案：**一个界面只有一种语言**

> 触发：用户反馈「页面内容显示使用英文，保持一致性，不要部分应用部分中文，都采用英文」。

半中半英不是「某处写错了」，而是**同一界面里两种语言并存**：工具栏是英文
（`Board` / `List` / `GitHub PRs`）、空态是中文（「还没有工作项」）、列头又是中文
（「共 N 条」）。

**这类混排最难自查**：加一条文案时你只看自己那一行，而「一致性」是**全局**属性 ——
只能整体断言。所以护栏是**扫源码文本**，不是渲染树：

```ts
// features/work-items/__tests__/visibleCopyEnglish.test.ts
visibleTextOf(line, state)  // 逐字符：剥注释与 console 参数，剩下「可能渲染到界面」的文本
```

为什么扫源码而不是渲染：渲染一棵树只覆盖当前分支（board vs list、有数据 vs 空态、
详情开 vs 关），而语言一致性要对**全部**分支成立。

**判据的例外（刻意的，不是漏的）**：

| 查 | 不查 |
| --- | --- |
| JSX 文本节点（含**独占一行的裸文本**）、`aria-label` / `placeholder` / `title` / `alt` 属性值、单/双引号与模板字符串里的文案 | JSDoc / 行内注释 / `{/* … *​/}`（项目惯例是中文） |
| 中文（含**全角标点** `：` `，` `（`） | `console.*(…)` 的**参数**（日志不进界面） |
| — | 英文文案里的 `…`（`Loading work items…`）与 `·`（`Commit Diff · foo.ts`） |

> **判据必须是逐字符扫描，不能是几条正则**（2026-11-03 实测）。首版按行跑正则
> （`/>([^<>{}]*[\u4e00-\u9fff]…)</`）看似合理，但它**绿着漏掉了 21 条真实中文文案**：
>
> | 形态 | 源码长相 | 为什么正则抓不到 |
> | --- | --- | --- |
> | 独占一行的裸 JSX 文本 | `            还没有工作项` | 没有 `>` `<` 包着 |
> | 多行元素的子文本 | `<Button>\n  创建第一条工作项\n</Button>` | 同上 |
> | 中文全角标点 | `` `${label} PR：${err}` `` | 判据只查 CJK 表意文字 |
>
> 同时它**过宽地**放行了「整行含 `console.`」的写法 —— 于是
> `console.error('…'); showToast('中文')` 也被跳过，而 toast 是渲染到界面上的。
> 现在 `console.*` 的例外只覆盖**它自己的参数**（按括号深度计，可跨行）。
>
> **变异验证是这条护栏的准入条件**：把任一条英文文案改回中文，护栏必须红；
> 把 `console.*` 的例外改回「整行跳过」，反证用例必须红。

**新面板接入时**：把 `visibleCopyEnglish.test.ts` 的 `FEATURE_DIR` 指向该域，
或直接复制一份。它是**域级**护栏，不是全局护栏 —— 逐域接入才能按域推进。

#### 面板工具栏：**三分区 + 图标而非字符**

> 触发：用户反馈「tasks 的工具栏可以再优化一下」。三处偏离全仓惯例：

| # | 偏离 | 全仓惯例 | 后果 |
| --- | --- | --- | --- |
| 1 | 字符 `↻` 当刷新图标 | lucide `RefreshCw`（`BrowserToolbar` / `BranchInfo` / `LibraryToolbar` 的 `Plus`） | 字符图标不跟字号、部分字体下渲染成方块；全仓 `↻` 只在 work-items 出现 |
| 2 | 搜索框裸 `input` | `LibrarySearchBar`：前置 `Search` + 有内容才出现的 `X` 清空 | 没有清空按钮时用户只能全选删除 |
| 3 | 数据源开关夹在搜索与动作之间 | **独立分组** | `flex-1` 的搜索框被两侧各挤一次；窄窗口下先换行的是开关，把主动作推到第二行 |

**四分顺序是契约**：`[视图切换] [搜索（flex-1）] [数据源开关] [动作：主→次]`。

判据写法（三条都要）：

```tsx
// ① 图标是 SVG 而不是字符 —— lucide 默认 aria-hidden，按元素类型/标识查
//    （`data-testid` 是**必要不充分**：字符节点也能带同一个 testid，所以必须加 `textContent` 反证）
expect(within(refresh).getByTestId('icon-refresh')).toBeInTheDocument();
expect(refresh.textContent?.trim()).toBe('');   // 反证：不能靠一个字符当图标

// ② 分区用 role=group + aria-label，按名字取（不靠 closest 爬 DOM）
const dataSourceGroup = screen.getByRole('group', { name: 'Sources' });
const actionGroup = screen.getByRole('group', { name: 'Actions' });
expect(within(actionGroup).queryByRole('checkbox')).toBeNull();  // 开关不许住动作组

// ③ 顺序用 compareDocumentPosition 判，不用 snapshot（snapshot 会锁死整个 DOM 结构）
//    ⚠️ 数组必须**包含全部四个分区**：只写「View → 搜索 → 刷新按钮」时，
//    把 Sources 与 Actions 两组整块对调仍然全绿（实测 10/10）—— 而契约问的正是中间那两组的次序。
const order = [viewGroup, searchInput, sourcesGroup, actionsGroup];
const relation = order[i - 1].compareDocumentPosition(order[i]);
expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

**图标按钮的命名**：图标按钮没有可见文字，`aria-label` 是唯一的可读来源；
`aria-hidden` 的图标**不进**可访问名 —— 所以 `+ New` 变成 `Plus`（图标）+「New」文本后，
按钮名是 `New`，调用点的 `getByRole('button', { name: '+ New' })` 必须同步改。
（本域文案已于 2026-11-03 全部英文化，`新建` → `New`、`撤销` → `Undo`、`删除` → `Delete`。）

#### 列头：**圆点 + 名字 + 数字 pill**

参考图是「● 待开始 10」。三元素分工：圆点=扫视锚点（列头是一行小字，纯文字扫得很慢）、
名字=主信息、pill=数字与名字**视觉分离**（同字号同行会读成名字的一部分）。

**圆点用中性色 `bg-text-muted`，不用语义色**：阶段不是严重度，红黄绿会让用户以为
「红的列有问题」。靠形状区分，不靠颜色。

#### 列里**没有**创建入口（2026-11-03 三次）

列底曾有一个 `+ Add` 按钮（用该 stage 预填创建对话框）。用户明确要求去掉，三条理由：

1. 工具栏已有 `New`，两处入口做同一件事，而列底那个还多带一个隐式 stage 参数；
2. 它固定在列的最底部，列内一滚动就跟着滚走 —— 是个**会消失**的按钮；
3. 每列一个，5 列就是 5 个同样的横条，把列底切成「内容 + 一条按钮」两段。

**判据不能写成「按某个名字查不到」**。首版是
`queryByRole('button', { name: /新建工作项/ })` —— 那**恒真**：一个叫 `Add task` /
`+` / 任意其它写法的按钮都能通过。实测把按钮加回去，17 条全绿（零判别力）。

正确判据是**结构**的：列内除了卡片（带 `data-work-item-id` 的 button）不允许有任何其它
button，不管它叫什么。

#### 内容卡片：**岛同源几何 + 呼吸感**（2026-11-03）

> 用户反馈：「内容卡片可以采用岛屿的方式进行展示，带一点呼吸感，当前看起来比前面好一点
> 但是还是不够美观」。

**「像岛」不是「套 `ISLAND_CLASS`」**。卡片是**分区内的控件面**，套岛壳就是岛中岛中岛
（层级：海 → 岛 → 分区 → 卡片）。它要的是与岛**同源的几何语汇**：

| 特征 | 岛（`ISLAND_CLASS`） | 卡片 |
| --- | --- | --- |
| 圆角 | `rounded-lg`（8px） | `rounded-lg`（**同源**） |
| 阴影 | `shadow-sm` | `shadow-sm`（**同源**） |
| 描边 | 无（靠底色 + 阴影分层） | `border border-border`（卡片小，需硬边界） |
| 底色 | `bg-bg-secondary` | `bg-bg-primary` |

为什么卡片要**额外**有描边而岛不需要：岛的面积大、阴影足够被感知；卡片只有几十像素高，
`shadow-sm` 在浅色主题下几乎不可见（light 的岛/海对比只有 1.18）。描边是卡片唯一可靠的边界。

**呼吸感 = 三处一起给**（只改一处等于没改）：

| 位置 | 紧贴档（旧） | 呼吸档 | 全仓参照 |
| --- | --- | --- | --- |
| 卡片内距 | `px-2 py-1.5`（8/6px） | `px-2.5 py-2`（10/8px） | `PromptCard` 的 `p-3`（12px） |
| 卡片之间 | `gap-1`（4px） | `gap-1.5`（6px） | `TeamTaskBoard` 列内 `gap-1.5` |
| 标题 ↔ 元数据 | `mt-1`（4px） | `mt-1.5`（6px） | — |

**列头 / 列底**同步：`py-1`（4px）→ `py-1.5`（6px），`text-micro`（10px，hint 档）→ `text-meta`。
一条列如果是「两条薄横条夹着卡片」，读起来是表格；加上松紧对比才是一叠卡片。

**列表行走同一套语汇**（2026-11-03 二次裁决后修订）：行也是**圆角块**（`rounded-lg` + `bg-bg-secondary` + `px-3 py-2.5`），**只是不加阴影** —— 一屏 20 行的阴影会让列表看起来在抖。行与列一样是**块**，靠 6px 空隙分开，**不画 `border-b`**。

> 本节曾被写成「行式布局不走这一套：行靠行高 + 分隔线分层，不加圆角/阴影」。
> 那是「行 = 表格行」时代的结论，已被看板列变圆角块的裁决推翻 —— 两个视图并排时
> 一个块、一个表，读起来像两个产品。现行规则见「看板 / 列表：圆角块」与「卡片与行」两节。

**列表侧必须补中间层**（否则行与岛同色）：

```
主岛（bg-secondary）
└ 列表分区（bg-tertiary）   ← 这一层不能省！
  └ 行（bg-secondary）
```

上一版的列表容器是裸 `flex-1`（无底色），于是行直接叠在主岛上：`secondary` 对
`secondary` 在五个主题里对比度恒为 **1.00**，行只剩一个 `border` 方框。
看板侧天然是对的（列自带 `bg-tertiary`），列表侧缺的正是这一层。

**这层缺失在数值判据上曾经完全隐身**：`surfaceContrast.test.ts` 首版只钉
`['--bg-primary', '--bg-tertiary']` 这一对 —— 而本域的卡片/行已改用 `--bg-secondary`，
于是它断言的是一个**本域不再使用的组合**（数值全绿），真实的那一对没人钉。现在两对都钉
（`CARD_ON_REGION_PAIRS`），另加一条「行与岛同色必须被判为不可分辨」的反证。

**判据的分层方式**（照抄上节的教训：单层判据必漏）：

| 层 | 断言 |
| --- | --- |
| 几何同源 | 卡片 `rounded-lg` + `shadow-sm` + `border` 都在 |
| 不套岛壳 | 卡片不含 `ISLAND_CLASS` 的 `flex-col` / `overflow-hidden` / `min-h-0` |
| **与所在分区不同色** | 行/卡片表面 token ≠ 它**最近的自带表面祖先**的 token（`ListView.test.tsx`） |
| 呼吸感 | **按完整 token** 判定：`tokens` 集合不含 `px-2`/`py-1.5`，含 `px-2.5`/`py-2` |

> ⚠️ **不要用正则判 token**：`/\bpx-2\b/` 会匹配到 `px-2.5` 的前缀（`\b` 在 `.` 前成立），
> 于是「呼吸档」反而被自己的判据判违规。一律 `new Set(className.split(/\s+/))` 后精确比对。

> ⚠️ **多列 / 多行必须逐条验**：`getAllByRole(...)` 然后 `for` 循环断言。
> 只验第一列时，「只改了一列」也会绿。

#### 空态：**居中 + 正文级字阶**

> 同一轮事故的另一面：Tasks 的空态是 `px-2 py-3 text-micro`（贴左上角 + 10px）。

`text-micro` 在字阶表里的用途是「时间戳、快捷键 hint」—— 拿它当空态正文，
等于把面板的主要信息写成脚注。全仓面板内空态的统一形态：

```tsx
<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
  <p className="text-meta text-text-secondary">…</p>
</div>
```

参照实现：`PromptListSection`（`items-center justify-center h-full` +
`text-[var(--font-size)] text-text-secondary text-center`）、
`PullRequestsPanelWrapper` / `GitControlPanelWrapper`（`items-center justify-center`）。

例外：**列内 / 行内的局部占位**（「暂无工作项」这类）贴左对齐是对的 —— 它占的是
「这一格里的空位」，不是「整个面板没有内容」。但字号仍是 `text-meta`，不是 `text-micro`。

#### 判据：**三个表面 token 必须互不相同**（这是「看得出岛」的唯一判据）

> 触发事故：Tasks 面板连续两轮「改了但看不出岛」。两轮都**有** `Island` 元素，
> 两轮都看不出 —— 因为判据一直写错：
>
> | 轮次 | 写法 | 为什么看不出 |
> | --- | --- | --- |
> | ① | 面板根 `bg-bg-primary` 被外层 `<Island>`（`bg-secondary`）包住 | 岛被填成海 |
> | ② | 根**无海面**（中心区 `center-area` 只有 `py-0.5 px-px`，无底色）+ 空态容器也是 `bg-secondary` | 岛与窗口渐变无对比、岛与岛内分区同色 |
>
> 断言「有 Island 元素」永远抓不到这类问题。它能抓的只有：

```
海面   bg-bg-primary    ← 面板根（`overflow-hidden rounded-lg` + 内缩 padding）
岛屿   bg-bg-secondary  ← <Island>（圆角 + 细阴影）
岛内分区 bg-bg-tertiary  ← 列 / 列表 / 空态容器
```

**三条硬约束**：

1. **没有海就没有岛**（海面归中心框架，**不归面板**）。全仓只有一个地方画海面：
   `CenterViewFrame`（`CENTER_VIEW_FRAME_CLASS` 含 `bg-bg-primary`）。视图与面板
   **不许**再自写 `bg-bg-primary` —— 上一轮就是因为「面板根自写海面 + 宿主也给一层」
   得到**两层海**，四周多缩 6px，对不齐。历史参照（现在仍合法的两处）：
   `LibraryPanel` 与 `EditorGroupLayout` 的根自画海面 —— 它们**不在 `AppCenter` 的
   `CenterViewFrame` 里**（前者是 dock 面板，后者是编辑器组）。
2. **岛与分区不能同色**。空态 / 加载中 / 无匹配这些「没有行可渲染」的容器曾经套 `<Island>`
   （`bg-secondary`）—— 而它们就住在主岛里（也是 `bg-secondary`）：同色叠同色，视觉上仍是一片白，
   只是多了一层看不见的圆角。它们该是 `bg-tertiary` 分区。
3. **机器判据**：`TasksPanel.test.tsx` 的「岛 / 岛内分区是两个不同表面」——
   同时断言 `island.bg-secondary` / `column.bg-tertiary`；海面那一条归
   `CenterViewFrame.test.tsx`（因为海面已经不由面板画了）。
   只断言其中一个、或只断言「有 Island 元素」，等于没断言。

#### 面板层级总表（Tasks 作为参照实现）

```
海面（bg-primary，由 `CenterViewFrame` 提供）
└ 主岛（<Island data-testid="tasks-main-island">：头部 + 内容都在岛内）
  ├ 岛内 header（**不自刷表面** + border-b，**不**套 <Island>）
  └ 分栏（gap-px）
    ├ 主格：看板列 / 列表（**分区**：bg-tertiary，圆角块无阴影）
    │  └ 卡片 / 行（bg-secondary：分区之上更亮一层）
    └ 详情岛（**第二座岛**：可独立开/关的另一块内容）
```

“岛内不再套岛” 的两条具体禁令：

- **岛内 header 不套 `<Island>`**：岛壳归主岛，它**也不自刷表面**（只写 `border-b`）。
  刷一层 `bg-tertiary` 会与它下面的分区（也是 tertiary）连成一片，分隔线形同虚设。
  套 `<Island>` 则是两层圆角阴影，看起来像「头部是另一个面板」。
- **分区不套 `ISLAND_CLASS`**：看板列 / 列表是 `bg-tertiary` 分区（可以带圆角，见「圆角块」节，
  **但不带阴影**）。写成岛（含 `shadow-sm`）就是「一排浮岛漂在海面上」。

#### 空态 / 加载中 / 无匹配：**也要住在内容岛里**

> 触发事故：Tasks 面板的空态（2026-11-03）。截图里看得很清楚 —— 看板区域空的时候，
> 「还没有工作项」是一段裸 `<p>`，**直接画在面板根的海面上**。它不像「面板的内容」，
> 而像「面板没渲染完，漏出一段文字」。

判据：**状态不改变表面层级**。空态也是「一块内容」，不是「没有内容所以不需要容器」。

```
┌ 头部岛 ────────────────────────┐
└────────────────────────────────┘
┌ 内容岛（一切状态都在这块里）────┐   ← 空态 / 加载中 / 无匹配 / 有数据
│ 还没有工作项                    │
│ [创建第一条工作项]              │
└────────────────────────────────┘
```

两条落地规则：

1. **四种「无行」状态统一包进同一座岛**（`<Island data-testid="…-content-island">`），
   与有数据时的列岛 / 列表岛**同一层** —— 切状态时几何不跳（高度始终由这块岛填满）。
2. **有数据时不包**：看板 / 列表自带分栏与岛屿（列岛、列表岛、详情岛），再包一层就是岛中岛
   （看板会变成「岛里的海」）。所以岛壳只给「没有行可渲染」的那几档。

**唯一例外：读失败且从未成功** —— 那一档返回 `null`。顶部错误横幅已经解释了原因，
再摆一座空岛等于让用户以为「加载成功了，只是没数据」。

#### 详情面板：**第二座岛**，不是覆盖层

「点一条 → 看详情」有两种画法，选第二座岛：

| 画法 | 代价 | 裁决 |
| --- | --- | --- |
| `absolute inset-0` 覆盖层 | 把整座中心岛换掉：用户丢掉看板与滚动位置，关掉后列全重建 | ❌ 已废 |
| 分栏里的第二座岛 | 主内容被压窄，但**始终可见** | ✅ 唯一写法 |

参考实现：`features/work-items/components/WorkItemsSplitView.tsx`（Board 与 List 共用一条分栏契约），
尺寸走 `useDefaultLayout`（理由见上节「变体：面板没有 owning persisted store 时」——
`workItemsStore` 会随 `reset()` 清空，把布局比例塞进去会让「切项目后回到默认宽度」变成无解释行为）。

两个必须照做的细节：

- **`detail === null` 时才不渲染第二块**：若子组件在内部 `return null`，父层传进去的仍然是一个
  非 null 的 React 元素，分栏照样画面板与分隔条 —— 用户看到一条能拖的缝，右边什么都没有。
- **`Island` 的 `data-testid` 与 `ResizablePanel` 的 `id` 不能同名**：`react-resizable-panels`
  会给 Panel 自己一个 `data-testid={id}`，两处同名会让「取详情岛」变成一次歧义查询。

#### 测试写法陷阱：分栏会让 `user.click()` 抢走焦点

`react-resizable-panels` 在 document 上挂 `pointerdown`（capture），按**指针到分隔条的距离**
判定命中。jsdom 里所有 rect 都是 0×0、`clientX/Y` 都是 0 ⇒ 距离恒为 0 ⇒ **任何点击都会把焦点
抢给分隔条**（真实浏览器里算得出来，只有贴着分隔条点才会命中）。所以「点击输入框 → 断言焦点在
输入框」这类用例在有分栏的树里必须改用确定性的 `element.focus()`，并在按下按键前**先断言**
`toHaveFocus()` —— 否则用例失败的原因会看起来像「快捷键判据坏了」。

#### 中心视图与左栏：进入即收起、退出即恢复

任何中心视图（`activation.kind === 'appView'`）打开时都收起左栏 —— 它要的是**中间区整幅宽**，
左栏 Projects 与它是互斥的落位关系，不是可调偏好：

- 进入：`dockStore.enterCenterView()` 先记下当前展开态（`leftZoneExpandedBeforeLibrary`），
  再收起左栏；
- 退出：`exitCenterView()` 用那份记忆值恢复。

**不要给视图加「本视图是否收起左栏」的属性**（曾在另一条分支上做过 `collapseLeftZone`）：
一旦它成为每视图属性，`Tasks` 这类只需要中间区的视图就会停在「左栏还开着」的中间态，
而两个 owner（布局框架 vs 视图声明）会对同一件事给出不同答案 —— 与本仓「几何只有一个所有者」
同一条原则。

> `leftZoneExpandedBeforeLibrary` 这个名字保留了历史（它最初只服务 Library）。**语义是
> 「进入任一中心视图之前」**，不是 Library 专属 —— 新增中心视图不需要第二个字段。

#### 项目级入口：先切项目，再进视图

左侧 Projects 的「打开本项目 Tasks」（悬停图标 + 右键菜单项）语义是**先选中这个项目，
再进 Tasks**，不是「进 Tasks 然后自己找项目」：工作项按项目分槽，反过来的顺序会让面板
在切换那一帧渲染**上一个项目**的数据。

两条纪律：

1. **顺序不可交换**（`src/app/hooks/useOpenProjectTasks.ts`，单测钉住 `select` 先于 `view`）；
2. **入口不是开关**：不复用 `togglePanel('tasks')`（那边再点一次是关）。项目入口永远是
   「看这个项目」，从项目 A 切到项目 B 的入口时只换项目，不关面板。

---

## 样式模式

### Tailwind CSS v4 + CSS 自定义属性

样式使用 **Tailwind CSS v4**，入口为 `src/styles/index.css`（只聚合：`base/` → `themes/` → `motion/` → `components/`）。CSS 自定义属性在 `src/styles/base/variables.css` + `src/styles/themes/*.css` 定义，由 `src/styles/base/tailwind.css` 的 `@theme` 块映射到 Tailwind 主题色：

```css
@theme {
  --color-primary: var(--bg-primary);
  --color-accent: var(--accent);
  --color-text: var(--text-primary);
}
```

### 实用类优先

组件内直接使用 Tailwind 实用类，不写自定义 CSS：

```tsx
<div className="flex items-center gap-2 px-3 py-1">
  <span className="text-sm text-accent">{name}</span>
  <button className="p-1 hover:bg-white/10 rounded">
    <Icon />
  </button>
</div>
```

### 滚动条占位：逐元素实测补偿（`useScrollbarCompensation`）

`reset.css` 的全局 `scrollbar-width: thin` 让滚动条静止时透明不可见，但它仍是
**经典滚动条**：占布局宽度、且只占**右侧**。于是同一容器天然是「左 padding ↔ 右 padding
+ 滚动条」，内容看着没铺满（markdown 预览 `px-6` 看着像 `px-6 / px-9`）。

**判据**：内容滚动容器一律用 `useScrollbarCompensation(ref, mode)`，不自写 padding 算术、
不用 `scrollbar-gutter` 属性：

| mode | 行为 | 适用 |
| --- | --- | --- |
| `widen`（默认） | 右内边减掉实测占位 → 内容变宽、左边界不动 | 有右内边的容器：markdown 预览 / 图片 / agent-chat |
| `center` | 左内边加上实测占位 | 右内边为 0 的容器：PDF 滚动区 / 会话列表（经 `VirtualList` 的 `scrollbarCompensation` prop） |
| `none` | 不补偿 | 既有消费方保持原行为 |

三条硬约束（第一性原理）：

1. **占位属于元素，不属于应用**：只有真正溢出的容器才有滚动条，所以补偿量必须
   `offsetWidth - clientWidth` 逐元素实测。全局常量会把「内容不足一屏」的容器补反
   （右窄左宽），把 bug 换个方向复现。
2. **样式基线仍在 Tailwind 类里**（`px-6` / `p-4`）：hook 只写**调整量**（inline style），
   每次先清自己的 inline 值再读基线 —— 幂等，不会越减越多，也不把数值搬进 JS。
3. **JS 里要可用宽度用 `contentBoxWidthOf(el)`**，不要直接拿 `clientWidth`（它含两侧内边，
   PDF fit-width 曾因此溢出补偿量）。

落点：`shared/utils/scrollbarCompensation.ts`（实测 / 补偿 / ResizeObserver 订阅）
+ `shared/hooks/useScrollbarCompensation.ts`（`useLayoutEffect`，保证首帧前落地，
避免内容横向跳一下）。

护栏：`scrollbarCompensation.test.ts`（10 条：占位钳零、幂等、无滚动条回基线、负内边保底
`max(0, …)`、center 补左侧、dispose 清 inline）；每个消费容器各一条「补偿已接线 / 无滚动条
回基线」断言（`MarkdownScrollContainer` / `ImageFileView` / `AgentChatTabView` /
`ProjectsPanel` / `VirtualList`）—— 只接 hook 不写断言 = 接线断了没人知道；
PDF 另有一条 `Fit width` 按内容盒宽度计算的用例。

**例外：终端不要套这套补偿**。xterm 的滚动条是它**自绘的 overlay 元素**（贴在 xterm
元素右边缘、**不占布局宽度**），`offsetWidth - clientWidth` 对它恒为 0 —— 交给 hook 是
无害空转，所以 `TerminalViewBase` 壳层只需保持 `p-0 pl-2`：禁止加右内边（试过 `px-2`，
会把滚动条一起从右边缘推进 8px），也禁止调 `useScrollbarCompensation`。

**另一种合法选择：把滚动条整条隐藏**（`@utility scrollbar-hidden`，标准属性 + 旧 WebKit
伪元素两条通道）。适用于「内缩已由行自己表达、又不想为对称再付一次补偿代价」的列表
（消费方：侧栏项目列表 —— 补偿会把整个列表右移一个占位；富文本 composer 也是同类的
「不需要滚动条」容器，原先在 `agent-chat.css` 里自写了一套同款声明，已收敛）。二者**互斥**：
隐藏后占位恒为 0，再接 hook 就是空转 + 白改内边。判据：要留滚动条 → 补偿；
不要滚动条视觉 → 隐藏，且断言改为「容器仍 `overflow-y-auto` 且带 `scrollbar-hidden`」。

### 终端右侧的 14px 幻影（`@xterm/addon-fit` 补丁）

终端「右边留白比左边宽」的真正来源不是滚动条，而是 `addon-fit` 的
`proposeDimensions()`：

```js
const overviewRulerWidth = scrollback === 0 ? 0 : (options.overviewRuler?.width || 14);
```

xterm 6 已移除 `overviewRuler` 选项（见 `shared/utils/terminal.ts` 注释），于是这里
**恒取 14**，可用宽度被无条件减掉 14px —— 网格右边缘比左内边（`pl-2` = 8px）多出约
14～22px 空白。

落点：`patches/@xterm__addon-fit@0.11.0.patch`（`pnpm-workspace.yaml` 的
`patchedDependencies`）把默认值改成 `0`。**升级 addon 版本时必须同步重打补丁**
（否则 pnpm 直接报 patch 不匹配，不会静默回退）。改完 `node_modules` 记得
`rm -rf node_modules/.vite`，否则 Vite 预打包还在用旧代码。

### 终端滚动条：半透明 + 自动隐藏

网格铺到右边缘后，6px 滑块**压在最后一列上**（overlay），因此必须是半透明的：
基础 `opacity: 0.45` / `:hover` 0.75 / 拖拽中 0.95。

显隐：xterm 的 VisibilityController 只在指针**移出滚动区**时才隐藏
（`_mouseIsOver` 守卫）—— 而终端的滚动区就是整个面板，指针停在里面时滚动条永远可见。
所以由 `createScrollIdleTag()`（`shared/utils/scrollAutoHide.ts`）订阅 `term.onScroll`，
停止滚动 3s 后给壳层挂 `.scroll-idle`，`components/xterm.css` 在该状态下把滑块
`opacity: 0` 并把滚动条容器 `pointer-events: none`（否则透明 6px 会吃掉最右列的点击
与选区）。极性刻意是**「无类 = 可见」**：接线缺失时退回 xterm 原行为。两个 xterm 宿主
（`TerminalViewBase` / `TaskConsoleOutput`）都必须接。

护栏：`scrollbarGutter.test.ts`（测量 / 安装 / 读取纯函数）+ 四个内容容器各一条
`toHaveClass` 断言 + `TerminalViewBase.fitScheduler.test.tsx` 里一条「壳层只许 `pl-2`、
不许 `pr-2`/`px-2`」断言。

### 动态类合并：`cn()`（唯一来源 `@/lib/utils`）

需要条件组合类名时使用 `cn()`（`clsx` + `tailwind-merge`），禁止另起 `cn` 实现
（`src/shared/utils/cn.ts` 重复件已删除）：

```tsx
import { cn } from '@/lib/utils';

<div className={cn(
  "flex items-center gap-1 px-2 py-0.5 rounded",
  isActive && "bg-accent/10",
  isDragging && "opacity-50 ring-2 ring-accent",
)} />
```

### 动态样式

仅在运行时需要计算的值仍使用内联 `style` 属性：

```tsx
<div style={{ display: isVisible ? "block" : "none" }}>
<img width={size} height={size} style={{ display: "inline-block", verticalAlign: "middle" }} />
```

### 复杂 CSS

无法用实用类表达的样式（`:has()` 选择器、伪元素 `::after`、动画、滚动条样式、xterm 终端覆盖等）按组件域拆到 `src/styles/components/*.css` 的 `@layer components` 中（每文件一个组件域）。

### Tauri 拖拽区域

可拖拽窗口的区域使用 `data-tauri-drag-region`：

```tsx
<div className="titlebar" data-tauri-drag-region>
```

---

## 拖拽排序模式（@dnd-kit）

项目列表拖拽排序使用 `@dnd-kit` 库实现。每个独立排序区域使用一个 `DndContext` + `SortableContext`，卡片组件内部使用 `useSortable` hook。

```tsx
// 父级容器（ProjectsPanel / WSLItem / RemoteItem）
<DndContext
  collisionDetection={closestCenter}
  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
  onDragEnd={(event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onDragEnd(String(active.id), String(over.id));
    }
  }}
>
  <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
    {items.map(item => <SortableCard key={item.id} item={item} />)}
  </SortableContext>
</DndContext>
```

```tsx
// 可排序卡片（ProjectItem / ConnectionProjectCard）
const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
  useSortable({ id: item.id });

const style = {
  transform: CSS.Transform.toString(transform),
  transition: transition ?? undefined,
};

return (
  <div ref={setNodeRef} style={style} {...attributes} {...listeners}
    className={cn(
      "relative mb-0.5 rounded-md overflow-visible",
      isDragging && "opacity-50 scale-[1.02] shadow-lg shadow-black/20 z-50",
      !isDragging && "cursor-grab",
    )}
  >
    {children}
  </div>
);
```

**设计原则**：
1. **DndContext 按独立列表分布**：每个可排序区域独立，不支持跨区域拖拽
2. **Modifier 约束**：`restrictToVerticalAxis` 锁定垂直、`restrictToParentElement` 限定范围
3. **业务逻辑在域 hook**：DndContext.onDragEnd 只提取 id 并调用域 hook handler
4. **视觉反馈通过 isDragging**：使用 Tailwind class 切换 opacity/scale/shadow

详见 [交互模式指南](./interaction-patterns.md)。

---

## 展示组件 + 数据 adapter 跨域复用模式

当多个领域（local / WSL / SSH）需要同款视觉，但底层数据形态与 IPC 命令不同时，把视觉抽成纯展示组件，由各域调用方做 adapter（数据 normalize + 回调注入）。

**实例**：`SessionChips`（真正共用，落 `src/shared/components/SessionChips.tsx`）被三端复用；adapter 侧
`ProjectItem`（local，`src/features/project/components/ProjectItem.tsx`）与 `ConnectionProjectCard`
（wsl/remote，`src/features/connection/components/ConnectionProjectCard.tsx`）各自把领域模型映射成展示
组件期望的 props（`SessionRow` / `ProjectGroup` 在 `src/features/project/components/`）。

> 约定：被**多个 feature** 消费的展示组件放 `src/shared/components/`；feature 内出现同名文件且内容只有
> `export { default } from '@/shared/components/<X>'` 时，那是门面转发，不是第二实现。

**纯展示组件契约**：
1. 不直接 `invoke` Tauri 命令、不读写 store
2. 接收的 props 只有数据（值）+ 回调（函数）
3. 回调按语义命名（`onAddWorktree` 而非 `onPlusClick`）
4. `React.memo` 包装

**adapter 调用方契约**：
1. 数据 normalize：把领域模型映射成展示组件期望的 props（如把 `git_info.worktrees` 映射成 `SessionRow` 数组）
2. 回调注入：把领域 IPC 包装成展示组件期望的回调（如 `onAddWorktree = () => onOpenDialog("new-worktree", ...)`）
3. store 读写在 adapter 层完成（如 `aheadBehind` 用**Workspace键** `WorkspaceSession.of(projectId, unitPath ?? null).key` 查表；`unitPath` 取自 `selectActiveWorkspaceKey` / `selectActiveCheckoutPath`，不各自猜）

**反模式**：让纯展示组件 import `invoke` 或 `useGitStore`——会立刻丧失三端复用能力，把 wsl/remote 路径推回写另一份并行实现。

**好坏对照**：

```tsx
// Wrong —— 展示组件直接读 store，且把裸 projectId 当键
const SessionRow = ({ project }) => {
  const ahead = useGitStore((s) => s.aheadBehind[project.id]?.ahead);
  // 键空间里只有Workspace键 ⇒ 恒为 undefined（既存 bug 形态：徽标永远不显示）
};
```

```tsx
// Correct —— 展示组件只接收数据
interface SessionRowProps {
  ahead?: number;
  changes?: { add: number; del: number };
}

// adapter（local / wsl / remote 同形）：键 = 本项目**当前单元**的身份
const unitKey = useWorkspaceStore((s) => selectActiveWorkspaceKey(s, project.id));
const ahead = useGitStore((s) => (unitKey ? s.aheadBehind[unitKey]?.ahead : undefined));
<SessionRow ahead={ahead} />;
```

---

## 视觉层级：Section header vs Project header

侧边栏中两类容器有显著的语义差异，对应不同的视觉强度。

| 角色 | 强度 | 实例 | 关键样式 |
|------|------|------|----------|
| **Project header** | 强 | 单个项目卡（含 avatar + 名 + count + hover IDE/Git/Trash 槽） | `text-[var(--font-size)] font-semibold`、28×28 头像、行高 ≈ 40px |
| **Section header** | 弱 | WSL/SSH 外层 distro/server 分组 | `text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted`、无头像、行高 ≈ 22px、hover 才显示 +/Trash |

**取舍准则**：
- 该层只是"分类容器、无独立操作"——用 section header
- 该层是"用户主要交互目标，含独立 CRUD"——用 project header
- 同屏避免出现两层强 header（视觉抢中心、识别成本高）

**实例参考**：
- Section header：`src/features/project/components/SectionHeader.tsx`（WSL/SSH 分组标题 + hover 才显示的 +/Trash 动作槽），消费方 `ProjectsPanel.tsx`
- Project header：`src/features/project/components/ProjectGroup.tsx`

---

## 大文本输出统一容器模式（OutputScroll）

**问题**：agent 工具输出（bash 命令输出、文件 diff 等）可能达数千行。直接 `<pre>` 渲染 + `white-space: pre-wrap` 会在长文本上产生严重卡顿（布局、换行、滚动全量）。

**解决方案**：统一封装 `OutputScroll`（`src/features/agent-chat/components/OutputScroll.tsx`），按行数分级：

| 行数 | 策略 |
|------|------|
| < `OUTPUT_VIRTUALIZE_THRESHOLD`(500) | 直接渲染（小文本零开销） |
| ≥ 500 | `@tanstack/react-virtual` 按行虚拟化（固定 `OUTPUT_LINE_HEIGHT`=20px、视口 `OUTPUT_VIEWPORT_HEIGHT`=320） |
| ≥ `OUTPUT_COLLAPSE_THRESHOLD`(1000) | 默认折叠 + 展开按钮（用户主动才渲染） |

**关键约定**：
1. 阈值/行高/视口导出为**模块级常量**（`OUTPUT_*`），测试按常量断言，禁止硬编码魔法数。
2. 虚拟化按固定行高计算（`rowVirtualizer` + `estimateSize: () => OUTPUT_LINE_HEIGHT`），jsdom 无 `getBoundingClientRect` 结果时用 `initialRect` 兜底，避免测试环境崩溃。
3. 大文本所有 `<pre>` 输出消费方（命令卡、文件卡、通用行）统一走 `OutputScroll`，不各自写 `<pre>` —— DRY。

> **测试要点**：边界行数必须精确覆盖（499 直渲 / 500 虚拟化、999 不折叠 / 1000 折叠）；断言语义而非字节（`toHaveTextContent`）。

## 分组渲染禁止二次分组（递归陷阱）

**问题**：工具行列表按「连续同类工具」分组折叠（如 `chunkToolGroups`）。若分组**展开**时递归渲染 `<WorkRows tools={group.tools} />`，组内 ≥2 个连续同类工具会再次被分组 → 无限递归，最终栈溢出崩溃。原有单组测试不覆盖「连续同类」场景，缺陷潜伏。

**正确做法**：分组内直接渲染**原始工具行**，绝不二次分组。抽离单行组件 `ToolRow`，分组展开与单工具路径共用：

```tsx
// Correct —— 单行组件 + 直接渲染原始行，不二次 chunk
function ToolRow({ tool, onOpenFile }) {
  if (tool.name === 'run_command' || tool.name === 'bash') return <CommandCard tool={tool} />;
  if (tool.name === 'read_file' || tool.name === 'edit_file' || tool.name === 'write_file')
    return <FileCard tool={tool} onOpenFile={onOpenFile} />;
  // ...
}
// 分组展开
<ToolGroupSummaryRow summary={group.summary} defaultOpen={group.hasRunning}>
  {group.tools.map((t) => <ToolRow key={t.callId} tool={t} onOpenFile={onOpenFile} />)}
</ToolGroupSummaryRow>
```

**检查清单**：
- [ ] 分组展开路径是否可能再次进入分组逻辑？
- [ ] 测试是否覆盖「≥2 连续同类工具」的分组场景？
- [ ] 分组内的回调（`onOpenFile` 等）是否透传？

## 回调透传链完整性

**问题**：容器给子组件注入回调（如 `onOpenFile`）时，若某一层子组件内部又渲染了同一消费组件（如 `WorkedCard` 内部渲染 `WorkRows`），遗漏透传会导致**同一类卡片在不同上下文表现不一致**（消息级可点、话轮摘要不可点），用户需求未完全打通。

**规则**：
1. 容器层回调下发给**所有**渲染该消费组件的路径（`WorkRows` 与 `WorkedCard` 内嵌的 `WorkRows` 都要传 `onOpenFile`）。
2. 中间层组件把回调列为**可选 props**（`onOpenFile?:`）并透传，消费方组件做**无回调回退**（如路径退化为不可点击 span），保持向后兼容。
3. 测试同时覆盖「消息级链路」与「内嵌上下文链路」两条透传路径。

---

## 即时保存 vs 显式 Save：两种"项目设置"语义

本仓库有两种"项目设置"入口，**语义截然不同**，新增字段时要选对位置或两者同步实现。

| 入口 | 文件 | 语义 | UX |
|------|------|------|-----|
| **全局 Settings → Project 子面板** | `src/features/settings/components/ProjectPanel.tsx` | **即时保存**：每个控件 onChange 立即 `invoke` + `patchProject` 更新 store；无 Save / Cancel 按钮 | 用户改一个字段→实时落盘+实时反映；适合"调试式探索" |
| **项目右键菜单 → Settings dialog** | `src/shared/components/ProjectSettingsDialog.tsx`（`features/project/components/` 同名文件只是门面转发） | **显式 Save / Cancel**：受控 state 暂存改动，Save 按钮一次性 invoke 多个 setter；Cancel 丢弃 | 用户可以试错；适合"提交式确认" |

### 选择规则

- **新增字段属于"反复调整、马上看效果"类型**（如颜色、Agent、IDE 选择）→ 优先放 ProjectPanel.tsx，即时保存
- **新增字段属于"批量决策、确认提交"类型**（如同时改名 + 切 IDE + 切 Agent）→ 优先放 dialog，受控 + Save
- **两类都需要** → 抽出共享子组件：纯展示内核放 `src/shared/components/`（不碰 store），两种入口各自决定何时提交

### 即时保存模式落地（ProjectPanel）

```tsx
// src/features/settings/components/ProjectPanel.tsx
import { setProjectColor } from "@/features/project/api/projectApi";

const handleAvatarColorChange = useCallback(
  (color: string | null) => {
    setProjectColor(projectId, color);  // 通过 API wrapper
    patchProject({ avatar_color: color }); // store 同步，避免等下一次 listen
  },
  [projectId, patchProject],
);
```

要点：
1. **没有受控 state**：直接读 `project.avatar_color`，写入即更新 store
2. **`patchProject` 立即同步 store**：避免依赖后端事件回流造成的 UI 滞后
3. **invoke 不 await**：与现有 `handleAgentChange` / `handleIdeChange` 风格一致；如果失败由 toast 在 store 同步层处理

### 显式 Save 模式落地（Dialog）

```tsx
// src/shared/components/ProjectSettingsDialog.tsx
const [selectedAgentId, setSelectedAgentId] = useState<string | null>(currentAgent);
const [selectedIdeId, setSelectedIdeId] = useState<string | null>(null);

const handleSave = useCallback(async () => {
  // 保存动作由调用方注入（shared 组件不直调 feature API）
  await onSaveAgents(projectId, selectedAgentId ? [selectedAgentId] : []);
  await onSaveIde(projectId, ideCommand);
  onSave(selectedAgentId, ideCommand);
  onClose();
}, [...]);
```

要点：
1. **受控 state 暂存所有字段**，不实时同步
2. **Save 按钮一次性提交**多个 invoke
3. **Cancel 直接 onClose** 即丢弃

### 反模式

❌ **在 ProjectPanel 里加 Save 按钮**：与既有 Agent / IDE / Tasks 即时保存模式冲突，用户体验割裂

❌ **在 Dialog 里某个字段即时保存、其他字段需要 Save**：用户认知负担极高，"为什么这个字段我点了就生效，那个字段非要 Save"

❌ **新增字段时同时 patch 两边但语义不一致**：参考 `avatar_color` 任务的修正——上轮把 Appearance 加到了 Dialog（错），用户期望在 Settings 子面板（对），最终 Dialog 完全还原、Appearance 只在 ProjectPanel

### 检查清单

- [ ] 该字段属于即时调整还是批量提交？
- [ ] 与该入口已有字段的保存语义一致？
- [ ] 如两边都要支持，是否抽出了共享子组件？

---

## Props 塌缩约定：优先从 Context/Store 获取数据

### 核心原则

当组件需要的数据已在 Context 或 Store 中可用时，**不应通过 Props 传递**。按以下优先级获取：

1. **领域 Context**：`useEditorContext()`、`useWslContext()`、`useRemoteContext()` 等
2. **全局 Context**：`useAppContext()` — 配置、toast
3. **Store 快照**：对应域 store 的 selector（`useProjectStore(s => s.field)` / `useEditorStore(s => s.tabs[tabKey])` / `useWorkspaceStore(s => …)` / `useFileStore(s => …)` …）— 带 memo 的响应式
4. **Store 门面**：对应 store 的 `getState()`（`useProjectStore.getState()` 等）— 一次性读取，用于事件回调；按需取那一个域，不是一个"全量快照"
5. **领域 Hook**：`useEditorGroupLayout(tabKey)` 等

### Props 塌缩步骤

```tsx
// Before（Prop 缠绕）
<EditorGroupLayout
  agents={agents}
  config={config}
  showToast={showToast}
  ...
/>
  └─ <EditorGroupPane
        agents={agents}
        config={config}
        showToast={showToast}
        onActivateTab={handleActivateTab}
        ...
      />

// After（直接读取 Context/Store）
// ProjectView 不再传递 agents/config/showToast
<EditorGroupLayout ... />
  └─ <EditorGroupPane ... />  // 内部调用 useEditorContext() / useAppContext()

// Pane 内部
const { agents } = useEditorContext();
const { config, showToast } = useAppContext();
useEditorStore.getState().activateTab(tabKey, tabId);  // 代替 onActivateTab prop（命令式一次读取）
```

### 保留哪些 Props

塌缩后保留的 Props 通常属于：
- **实例差异**：`groupId`、`layoutId`、`wslProject`、`remoteProject`
- **布局级回调**：`onSplitRight`、`onMoveToRight`、`onMoveToLeft`、`onFocusGroup`
- **扩展点**：`contextMenuExtras`

### 示例：EditorGroupPane 塌缩

| Props 原数量 | 塌缩后 | 移除了什么 |
|-------------|--------|-----------|
| 30+ | ~13 | `tabKey`, `tabs`, `activeTabId`, `pinnedTabId`, `isFocused`, `onActivateTab`, `onCloseTab`, `agents`, `compactMode`, `showAgentBar`, `hiddenAgentIds`, `onToggleHiddenAgent`, `onAgentClick`, `config`, `showToast` |

删除路径：`EditorGroupPaneProps` → `EditorGroupLayoutProps` → `sharedPaneProps` → `ProjectView` JSX。每一层都同步删除。



**错误做法** —— `TitleBar.tsx` 局部重新声明自己的 `Project` 和 `AgentConfig` 接口：

```tsx
// 不要这样做：重新声明 types.ts 中已有的类型
interface Project {
  id: string;
  name: string;
  // ... 真实类型的部分拷贝
}
```

**正确做法** —— 从 `@/shared/types` 导入：

```tsx
import type { Project, AgentConfig } from "@/shared/types";
```

### 2. 忘记使用 `React.memo`

除 `App.tsx` 外的所有组件都应使用 `React.memo` 导出，以避免在 Props 与 Context 混合分发架构中的不必要重渲染。

### 3. 在 JSX 中内联 SVG 图标

项目中将小型 SVG 图标直接嵌入 JSX（参见 `TitleBar.tsx`）。对于简单图标这是可接受的。对于可复用的图标，考虑提取为独立组件或资源文件。

### 4. 字体大小使用硬编码 Tailwind 类

**错误做法** —— 在侧边栏、文件树、Tab 等 UI 元素中使用 `text-xs`、`text-sm` 等固定类：

```tsx
// 不要这样做：硬编码字体大小，无法响应用户设置
<span className="text-sm font-semibold">{project.name}</span>
<div className="text-xs cursor-pointer">{fileName}</div>
```

**正确做法** —— 使用 CSS 变量，确保元素跟随用户在 Settings 中的字体大小设置：

```tsx
// UI 元素（侧边栏、文件树、Tab 标签等）→ --font-size（由 appearanceFontSize 驱动）
<span className="text-[var(--font-size)] font-semibold">{project.name}</span>

// 终端区域元素（终端 Tab、Agent 按钮等）→ --terminal-font-size（由 terminalFontSize 驱动）
<span style={{ fontSize: "var(--terminal-font-size)" }}>{tabTitle}</span>
```

---

## CSS 字体大小变量规范

项目使用三套独立的字体大小配置，均由用户在 Settings → Appearance/Editor/Terminal 中调整：

| CSS 变量 | 默认值 | 驱动字段 | 适用范围 |
|----------|--------|---------|---------|
| `--font-size` | `12px` | `config.appearanceFontSize` | 侧边栏项目名、文件树、Tab 标签、TitleBar 等所有 UI 文本 |
| `--terminal-font-size` | `14px` | `config.terminalFontSize` | 终端 Tab、Agent 按钮列表、终端相关 UI |
| （直接传 prop）| `14px` | `config.editorFontSize` | CodeMirror 编辑器，通过 `editorFontSize` prop 传入 `FileViewer` |

**使用原则**：
- Tailwind 类语法（推荐用于静态文本）：`className="text-[var(--font-size)]"`
- 内联 style（用于动态或按钮元素）：`style={{ fontSize: "var(--terminal-font-size)" }}`
- 新增任何侧边栏/文件树/Tab 组件时，**禁止**使用 `text-xs`、`text-sm`、`text-base` 等固定 Tailwind 字体类


---

## 确认弹窗规范：两层的 `DeleteConfirmDialog` / `ConfirmDialog`

### 第一性原理：先问「确认对象是谁」

危险操作二次确认**只有一层业务记账**，选哪一层由确认对象的**性质**决定，不是由文案决定：

| 确认对象 | 用什么 | 例 |
| --- | --- | --- |
| **某个待定条目**（可数、有名字/路径） | `DeleteConfirmDialog<T>` | 删文件/文件夹、移除 project、移除 worktree、移除 skill（单条/批量）、删 tag group、删 prompt / MCP server |
| **UI 状态或未来动作**（无条目） | 底层 `ConfirmDialog` | 退出 App、关闭未保存文件、丢弃未保存变更 |
| 非 React 模块（debug runner / store action）发起确认 | `await confirmAction()`（`ConfirmHost`） | 命令式 store 通道 |

**禁止**为每种危险操作新建 `XxxConfirmDialog`。差异（标题、文案、按钮名）都是**数据**，
通过 props 注入即可 —— 见下方 `DeleteConfirmDialog`。

#### 确认按钮只调 `onConfirm()`，**不得**先 `onOpenChange(false)`（2026-10-30 实测缺陷）

`ConfirmDialog` 的确认按钮曾写 `onClick={() => { onOpenChange(false); onConfirm(); }}`。在
store 驱动通道（`ConfirmHost`）里，`onOpenChange(false)` 的语义是「用户把弹窗关了」⇒
`confirmStore.resolve(false)`：在途请求按**取消**结算、`resolver` 被清空，紧接着的
`onConfirm()` → `resolve(true)` 变成**空操作**。

后果是 **`await confirmAction(...)` 恒为 `false`** —— 所有靠它门控的动作静默不执行
（历史会话删除表现为「点了删除没反应、也没有 toast」，LSP 导入确认同理）。而且它不会报错：
四次既有用例都是直接 `resolve(false)` 结算的，**从没点过那个按钮**。

判据与修法：

| 责任 | 归属 |
| --- | --- |
| 确认按钮 | 只调 `onConfirm()` |
| 关闭弹窗 | 调用方自己：store 通道清 `pending` 即关闭；`Exit` / `BulkClose` / `DeleteConfirmDialog` 各自的 `onConfirm` 关闭自己的状态 |

护栏：`ConfirmHost.test.tsx` 的「点确认时把请求结算为 true（不是取消）」——把
`onOpenChange(false)` 加回确认按钮，该用例立即红。**任何 store 驱动的弹窗都要有这条
「真的点了按钮」的用例**，只测 `resolve(false)` 等于没测。

---

### `DeleteConfirmDialog<T>` —— 待定条目类确认（首选）

位置：`src/shared/components/DeleteConfirmDialog.tsx`。它把 `ConfirmDialog` 的
`open` / `onOpenChange`→cancel / `danger` 记账固定下来，消费方只注入文案与动作。

```ts
interface DeleteConfirmDialogProps<T> {
  pending: T | null;                              // null = 不渲染
  onCancel: () => void;
  onConfirm: (item: T) => void;                   // 收到条目，无需调用方再判空
  title: string | ((item: T) => string);          // 随条目变化时传函数
  describe: (item: T) => React.ReactNode;
  confirmLabel?: string | ((item: T) => string);  // 默认 "Delete"
}
```

```tsx
import DeleteConfirmDialog from '@/shared/components/DeleteConfirmDialog';

const [confirmRemove, setConfirmRemove] = useState(false);

<DeleteConfirmDialog
  pending={confirmRemove ? project : null}
  onCancel={() => setConfirmRemove(false)}
  onConfirm={(p) => onRemoveProject(p.id)}
  title="Remove Project"
  confirmLabel="Remove"
  describe={(p) => (
    <>
      <p>Are you sure you want to remove <strong>{p.name}</strong>?</p>
      <div>{p.path}</div>
    </>
  )}
/>;
```

要点：

- `T` **无结构约束**（组件从不读字段，只回传）。不要加 `extends { id: string }` ——
  worktree 的条目是 `{ path, branch, isDirty }`，那个约束会逼出第二个组件。
- `pending` 可为**集合**（skill 批量移除传 `T = 条目[]`）。
- `confirmLabel` 随**条目**变化传 `(item) => string`；随**外部进行态**变化传无参闭包
  （`() => (removing ? 'Removing…' : 'Remove')`）。
- 列表项删除配 [`useDeleteConfirm`](state-management.md) 状态机（`pending` / `request` /
  `confirm` / `cancel`）一起用。

### 底层 `ConfirmDialog` —— 非条目类确认

位置：`src/shared/components/ConfirmDialog.tsx`。基于 Radix UI `Dialog` + `Button` 原语，
自动处理遮罩层、ESC 关闭、键盘焦点管理、dark theme 样式。

```ts
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  danger?: boolean;
}
```

```tsx
import ConfirmDialog from '@/shared/components/ConfirmDialog';

<ConfirmDialog
  open={confirmExitOpen}
  onOpenChange={onCancelExit}
  title="Exit Neeko?"
  description={<>Any running terminals will be stopped. Quit anyway?</>}
  confirmLabel="Quit"
  onConfirm={onConfirmExit}
  danger
/>;
```

- `description` 接受 `ReactNode`，可传条件内容
- `danger` 为 `true` 时确认按钮 `variant="destructive"`
- 已有同样的记账需求（待定条目）时，**不要**在这里手写 `open` / `onOpenChange` /
  `danger` —— 用 `DeleteConfirmDialog`

### 反模式

❌ **使用裸 `<div className="modal-overlay">` 模拟弹窗**：

```tsx
// 禁止：这些 class 在项目 CSS 中没有定义，无任何样式
{confirmDelete && (
  <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      ...
    </div>
  </div>
)}
```

❌ **为每种危险操作新建 `XxxConfirmDialog`，或手写 `ConfirmDialog` 记账**：

```tsx
// 禁止：project / skill / worktree / file 四处曾各写一遍这三行套话
<ConfirmDialog
  open={confirmRemove}
  onOpenChange={setConfirmRemove}
  danger
  /* ... */
/>
```

✅ **统一走 `DeleteConfirmDialog`**：见上方使用方式。新增确认场景 = 传 props。

---

## 浮层面板背景色：使用 `bg-popover` 而非 `bg-surface`

### 规则

所有浮层面板（dropdown、popover、portal、toast）必须使用 `bg-popover` 作为背景色，由 shadcn 主题映射到 `var(--bg-secondary)`。

`bg-surface` **不存在于 Tailwind CSS v4 主题中**，使用它会导致背景完全透明。

### 正确

```tsx
<div className="bg-popover border border-border rounded-md shadow-lg">
```

### 错误

```tsx
<div className="bg-surface border border-border rounded-md shadow-lg">
```

---

## Tabbed Shell Component 模式（合并 Dock 面板）

### 背景

当多个紧密关联的 Dock 面板（如 gitCommit + gitLog）需要合并为一个面板以节省 Dock 插槽时，使用 Shell 组件 + 内部 Tab 切换模式。

### 架构

```
GitControlPanelWrapper（app/dock/wrappers/，薄适配层）
├── useActiveProject() / useDockStore(isActive)   ← dock/上下文适配
├── useRefreshGitInfo()                            ← git info 刷新编排（feature hook）
└── GitControlPanel (feature 容器，owns 数据 hooks)
    ├── tab state ('changes' | 'history' | 'stash')
    ├── useGitLog(commands, active && tab==='history')   ← 激活门控
    ├── useStashList(commands, active)                   ← 徽章计数
    ├── useSingletonDiff / useCommitDetail / useOpenStashDiff / useOpenDiffTab
    ├── useGitLogKeyboardNav({ enabled: tab==='history' })
    ├── TabBar (Changes | History | Stash) + badge
    ├── GitCommitPanel       ← hidden={tab !== 'changes'} 保持挂载
    ├── GitLogPanel          ← hidden={tab !== 'history'}
    └── StashPanel           ← hidden={tab !== 'stash'}
```

### 关键约定

1. **两个面板同时挂载**：使用 `hidden` 而非条件渲染，避免切换 Tab 时丢失提交表单等草稿状态
2. **数据 hooks 内聚在 Shell 组件（feature 容器）**：wrapper 只做 dock/上下文适配（isActive 门控、project 视图转换），不持有业务编排
3. **激活门控**：`useGitLog` / `useStashList` 带 `enabled` 参数，面板/tab 不可见时不发起 IPC；数据在切换间保留
4. **Tab 默认值为 `'changes'`**（操作频率更高的面板在前）
5. **刷新联动**：GitControlPanel 组合 `onRefreshGit`（wrapper）+ log `refresh()`，commit 后切换 History 能看到新 commit

### 完成示例

```tsx
// src/app/dock/wrappers/GitControlPanelWrapper.tsx（薄适配层）
const GitControlPanelWrapper: React.FC = React.memo(() => {
  const { project, commands, capabilities, connectionContext } = useActiveProject();
  const isPanelActive = useDockStore(/* gitControl 激活且展开 */);
  const refreshGit = useRefreshGitInfo(project, commands, connectionContext);

  return (
    <GitControlPanel
      project={effectiveProject}
      commands={commands}
      capabilities={capabilities}
      connectionContext={connectionContext}
      active={isPanelActive}
      onRefreshGit={handleRefreshGit}
      ...
    />
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (tab !== 'history') return;
    const target = e.target as HTMLElement;
    if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    // J/K/j/k/c shortcuts...
  }, [tab]);

  return <GitControlPanel tab={tab} onTabChange={setTab} ... />;
};
```

```tsx
// src/features/git/components/GitControlPanel.tsx
const GitControlPanel: React.FC<Props> = ({ tab, onTabChange, ... }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border">
        <button onClick={() => onTabChange('changes')}>Changes</button>
        <button onClick={() => onTabChange('history')}>History</button>
      </div>
      <div hidden={tab !== 'changes'} className="flex-1 overflow-auto">
        <GitCommitPanel ... />
      </div>
      <div hidden={tab !== 'history'} className="flex-1 overflow-auto">
        <GitLogPanel ... />
      </div>
    </div>
  );
};
```

### 反模式

❌ 条件渲染（非挂载）：

```tsx
// 切换 Tab → 组件 unmount → 草稿全部丢失
{tab === 'changes' && <GitCommitPanel />}
{tab === 'history' && <GitLogPanel />}
```

❌ 每个面板各自调用 `useActiveProject()`：造成两次重复的 IPC 订阅和状态同步

---

## Zustand + `useSyncExternalStore`：`useShallow` 用于派生数组

### 规则

zustand v5 底层使用 `useSyncExternalStore`，store selector 返回的引用必须稳定。调用 `.slice()`、`.filter()`、`.map()` 等方法时每次都返回新引用，会导致无限重渲染。

使用 `zustand/shallow` 的 `useShallow` 做浅比较：

### 错误

```tsx
// .slice() 每次返回新数组 → 无限重渲染
const items = useStore((s) => s.list.slice(0, 10));
```

### 正确

```tsx
import { useShallow } from 'zustand/shallow';

const items = useStore(
  useShallow((s) => s.list.slice(0, 10)),
);
```
## Worktree-Aware 展示组件模式

### 背景

当用户在 worktree 终端中工作时，多个 UI 组件需要感知当前激活的 worktree 并调整其展示与交互行为。核心原则：**worktree 是只读上下文**——展示 worktree 自身的分支名，但禁止分支切换操作。

### 状态读取

使用 `useWorkspaceStore` 读取当前激活的 worktree 状态：

```tsx
import { useWorkspaceStore } from '@/shared/store/workspaceStore';

const activeCheckoutPath = useActiveCheckoutPath();
const activeCheckoutBranch = useActiveCheckoutBranch();
const isWorktreeActive = activeCheckoutPath !== null;
```

### 展示覆盖模式

当 worktree 激活时，展示组件应显示 worktree 的分支名而非主项目的分支名：

```tsx
// 正确：根据 worktree 状态决定展示内容
const displayBranch = isWorktreeActive ? activeCheckoutBranch : currentBranch;
```

### 交互禁用模式

当 worktree 激活时，分支切换功能必须完全禁用：

```tsx
// 正确：worktree 状态下禁用面板切换
const handleTogglePanel = useCallback(() => {
  if (isWorktreeActive) return;
  setPanelOpen((v) => !v);
}, [isWorktreeActive]);
```

### 视觉反馈

worktree 激活时，组件应提供明确的视觉反馈表明当前处于只读状态：

```tsx
<button
  className={cn(
    'flex items-center gap-1 hover:text-text-primary cursor-pointer transition-colors',
    isWorktreeActive && 'opacity-70 cursor-default',
  )}
  title={
    isWorktreeActive
      ? `Worktree branch: ${displayBranch} (read-only)`
      : `Current branch: ${displayBranch}`
  }
>
```

要点：
1. **opacity-70**：降低透明度表明非主上下文
2. **cursor-default**：移除可点击手势
3. **title 提示**：明确告知用户当前是 worktree 分支且只读

### 实例参考

| 组件 | 文件 | 行为 |
|------|------|------|
| BranchStatusBarWidget | `src/features/git/components/BranchStatusBarWidget.tsx` | 展示 worktree 分支名，禁用分支切换面板 |

### 反模式

❌ 组件直接读取 `gitInfo.current_branch` 而不检查 worktree 状态：

```tsx
// 错误：始终显示主项目分支，忽略 worktree
const branch = gitInfo?.current_branch ?? '';
```

❌ worktree 激活时仍允许分支切换：

```tsx
// 错误：未在 worktree 状态下禁用交互
const handleTogglePanel = useCallback(() => {
  setPanelOpen((v) => !v);
}, []);
```

❌ 为 worktree 新建独立组件而非复用现有组件：

```tsx
// 错误：复制一份 worktree 专用组件
const WorktreeBranchStatusBarWidget = () => { ... };
```
