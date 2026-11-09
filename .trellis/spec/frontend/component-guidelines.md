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
