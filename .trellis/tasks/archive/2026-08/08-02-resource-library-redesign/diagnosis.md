# Layout Framework Diagnosis

> 诊断日期：2026-08-02  
> 范围：前端布局框架（App.tsx / useAppShell / layout/ / dockStore / registry）  
> 方法：静态代码阅读 + neeko-check Pillar 1/10/13 对照

---

## 1. 当前布局分层图

```
App.tsx (组合根 — 47行导入, 142行)
├── TitleBar                      ← 全局 chrome
├── AppProviders                  ← context providers (app/project/file/connection/editor)
├── DockRegistryProvider          ← dock panel 注册表
├── bg-bg-primary container
│   ├── flex flex-col min-h-0
│   │   ├── AppLayout             ← toolbar footer + center content 插槽
│   │   │   ├── DockLayout        ← 3-zone resizable group
│   │   │   │   ├── left DockBar
│   │   │   │   ├── ResizablePanelGroup (left/center/right)
│   │   │   │   └── right DockBar
│   │   │   └── centerContent     ← children 插槽
│   │   ├── TaskConsolePanel      ← bottom panel (固定)
│   │   └── DebugPanel            ← bottom panel (固定)
│   ├── AppModals                 ← WSL/Remote/RemoteAuth 对话框
│   ├── QuickOpenPalette          ← 全局 overlay
│   └── SymbolNavPalette          ← 全局 overlay
└── StatusBar                     ← 全局 chrome
```

**分层结构本身是合理的**（TitleBar / Sidebar / Center / Bottom / Overlay 五层），问题出在每一层的组合方式和扩展机制上。

---

## 2. 六个核心问题

### P1: App.tsx 同时承担 layout chrome 与 view router 两责

`App.tsx` 的 `centerContent` 三元分支：

```tsx
const centerContent =
  appView === 'settings' ? <SettingsView /> :
  appView === 'library' ? <LibraryPanel /> :
  <ProjectWorkspace />;
```

**后果**：每新增一个 center 路由页面，必须修改 App.tsx。settings / library 作为"全局视图"跟 dock panel 走的是完全不同的路径，但被硬编码在同一处。

### P2: appView 与 dockStore 存在语义冲突

`library` 在 `panelMeta.ts` 里定义了 `defaultZone: 'left'` 和 `openAs: 'tab'`。dockStore 的 `togglePanel()` 默认逻辑是"展开 zone + 设置 activePanelId"，但 tab mode 面板不走 zone — dockStore 必须对 tab mode 做特殊分支。

`DockBarButton` 也有一段隐式分支：

```ts
const isTabMode = def?.openAs === 'tab';
const isActive = isTabMode ? appView === panelId : isDockActive;
```

**后果**：toggle 路径跟 panel mode / tab mode 强耦合，每次新增 tab mode 面板都需手动保证 toggle 正确，无编译期保证。

### P3: 新增模块要横跨 5+ 文件

以最简 "新增 dock panel" 为例：

| 文件 | 改动 |
|---|---|
| `panelMeta.ts` | 加 `DOCK_PANEL_META` 条目 |
| `registry.ts` | 加 `UI_BINDINGS` (icon + lazy component) |
| `dockStore.ts` | 如有 zone/behavior 定制则需改动 |
| `App.tsx` | 如有 center content 联动则需改动 |
| `appViewStore.ts` | 如有 appView 路由则需改动 |

这还是最简情况。如果像 SettingsView 那样要接管 center content，改动面更大。

### P4: 配置散落多处，没有统一的面板注册中心

"配置驱动"的理想：加面板 = 加一条配置。  
实际：4 个文件各管一段配置。

```
panelMeta.ts  → 结构配置 (zone, order, openAs)
registry.ts   → UI 配置 (title, icon, component)
appViewStore  → 路由配置 (appView 三元)
dockStore     → 行为配置 (toggle, expand, collapse)
```

没有任何一个地方能回答"这个面板到底是怎么集成到应用里的？"这一问题。

### P5: centerContent 三元是"隐式 view 路由"

`appView: 'normal' | 'skills' | 'settings' | 'library'`

- `skills` 实际上在 dock zone 里，不是 center view
- `settings` 和 `library` 是 center view
- `normal` 不是面板，是默认回退

四个 value 语义不同，共享一个 type。appView 路由跟 dock 路由是两套独立体系，共享 DockBarButton 一个 toggle 入口。

### P6: Toolbar 与 AppLayout 职责纠缠

ToolbarFooter（Add Project + Settings）通过 `toolbarFooterLeft` prop 传给 DockLayout。但 Settings 按钮的行为链路：

```
Settings 按钮 → AppLayout.onOpenSettings → useAppLayoutProps.handleToggleSettings 
→ useAppViewStore.setAppView('settings') → App.tsx centerContent 三元
```

5 层间接调用，中间每一层都在传递 props。Settings 按钮的激活态又由 AppLayout 的 `isSettingsOpen` prop 从 `appView === 'settings'` 计算得出，通过 props 传给 ToolbarFooter 计算 className。

---

## 3. neeko-check 维度对照

| 维度 | 违反 | 证据 |
|---|---|---|
| **Pillar 1 (FDD 内聚)** | App.tsx 承载了 view routing（跨 feature 协调层职责），不属于任何 feature | `src/app/App.tsx:54-91` centerContent 三元 |
| **Pillar 10 (React Idiomatic)** | 业务逻辑在 `App.tsx` 渲染层裸写三元路由 + useMemo 构建 buttons，应下沉到 hook 或 registry | `src/app/App.tsx:37-52` useMemo + `src/app/App.tsx:54-91` centerContent |
| **Pillar 13 (Single Source)** | 面板配置散在 4 文件，事件名无常量，tab mode 判断在 DockBarButton 硬编码 | `panelMeta.ts` / `registry.ts` / `appViewStore.ts` / `dockStore.ts` 各管一段 |
| **SRP (架构原则)** | `App.tsx` 同时是 chrome container + view router + 三方按钮组装 + overlay host | 142 行但承担了 3+ 个改变理由 |
| **OCP (开闭原则)** | 新增 center view 必须修改 App.tsx（对修改开放） | `centerContent` 三元需扩展分支 |

---

## 4. 目标框架：Slot-based Layout + Unified Registry

### 4.1 核心原则

1. **Layout 不感知内容** — Layout skeleton 只定义命名 slot 和几何约束（位置、尺寸、层级），slot 填什么是注册表的事
2. **Registry as Single Source** — 一个 panel/view 的注册包含所有集成信息（placement + icon + component + context + route），一处声明，多处消费
3. **Toggle 路径统一** — panel mode 和 center view mode 通过同一个 registry 分发，DockBarButton 不需要知道 placement 细节
4. **App.tsx 纯 chrome** — 不含 view routing 三元，center 内容由 ViewRouter 从 registry 自动生成

### 4.2 目标分层

```
AppChrome (纯几何骨架 — 0 业务逻辑)
├── TitleBar
├── ActivityBar (left)       ← slot
├── ActivityBar (right)      ← slot
├── PanelZone (left)         ← slot
├── CenterArea               ← slot
│   ├── EditorStack
│   └── ViewRouter           ← 从 registry 生成 center view 路由
├── PanelZone (right)        ← slot
├── BottomPanel              ← slot
├── StatusBar                ← slot
└── OverlayLayer             ← slot (modals + palettes)
```

### 4.3 统一注册表接口

```ts
interface PanelRegistration {
  id: string;
  title: string;
  icon: string;

  // 放置策略 — 声明式，取代 openAs + defaultZone 的分散配置
  placement:
    | { kind: 'dock'; zone: 'left' | 'right'; order: number; defaultZoneSize?: number }
    | { kind: 'center'; viewId: string }      // 接管 center content
    | { kind: 'bottom'; order: number }
    | { kind: 'overlay' };

  // 渲染
  component: LazyExoticComponent;

  // 行为约束
  canCollapse?: boolean;
  minPanelSize?: number;

  // 上下文依赖声明
  requiredContexts?: ContextKey[];
}
```

### 4.4 新增模块的改动面（目标）

| 场景 | 当前改动面 | 目标改动面 |
|---|---|---|
| 新增 dock panel | 5+ 文件 | 1 条 registration |
| 新增 center view (如 settings) | 改 App.tsx + appViewStore + registry + panelMeta | 1 条 `placement: center` registration |
| 新增 bottom panel | 改 App.tsx + 手动加组件 | 1 条 `placement: bottom` registration |
| 新增 overlay/palette | 改 App.tsx + 手动加组件 | 1 条 `placement: overlay` registration |
| 新增 activity bar 按钮 | 改 DockBarButton + registry + store | registry 自动生成 |

### 4.5 Toggle 路径统一

当前：DockBarButton 里 `isTabMode ? appView === panelId : isDockActive` 隐式分支。

目标：registry 返回一个 `usePanelActivator(panelId)` hook，内部根据 placement 决定调用 `dockStore.togglePanel` 还是 `setAppView`。DockBarButton 只调用 `activator.isActive` / `activator.toggle`，不知道 placement 细节。

### 4.6 插件化边界

对于外部插件（将来可能通过 Tauri 插件或远程注册表接入）：

```ts
interface LayoutPlugin {
  id: string;
  panels: PanelRegistration[];
  // 可选：声明依赖的其他 panel id
  dependencies?: string[];
}

// 插件注册
useLayoutPlugins([aiReviewPlugin, ciPanelPlugin]);
```

插件只需导出 `LayoutPlugin` 对象，注入到 registry，不需要改 App.tsx / dockStore / appViewStore。

---

## 5. 分阶段落地建议（不动现有 dock 实现）

### Phase 1: 统一注册表（不改 App.tsx）

- 新建 `src/app/shell/registry.ts`，聚合 panelMeta + UI_BINDINGS + appView routing
- 导出 `usePanelActivator(panelId)` 隐藏 tab mode 判断
- `DockBarButton` 改为消费 registry 而非直接读 `openAs === 'tab'`

**收益**：DockBarButton 的 `isTabMode` 分支消除；panel 配置首次集中。

### Phase 2: App.tsx 纯 chrome 化

- 抽出 `ViewRouter` 组件，从 registry 自动生成 center view 路由
- App.tsx 删除 `centerContent` 三元
- `useAppShell` 不再构建 `appModalsProps` / `appProvidersProps` 给 App，而是 registry 消费

**收益**：App.tsx 从 142 行缩减到 ~80 行；新增 center view 不再改 App.tsx。

### Phase 3: Slot-based Layout 骨架

- `AppLayout` 重构为 `<ChromeLayout>`，通过 slot props（titlebar / activityLeft / activityRight / zoneLeft / zoneRight / bottom / statusbar / overlays）组合
- 现有 DockLayout / DockBar / DockZone 保留为 slot 的默认实现，但不再被硬编码引用

**收益**：布局骨架可替换；支持主题/模式切换时换布局实现（如紧凑模式用不同 ActivityBar）。

### Phase 4: 插件化接入

- 定义 `LayoutPlugin` interface
- `useLayoutPlugins(hooks)` 注入外部 registry
- 第三方 feature 包可通过 `LayoutPlugin` 自注册 panel

**收益**：外部 feature 包不需要改宿主 App，自注册即可接入。

---

## 6. 应保留的优势

1. **DockRegistryProvider + React Context 解耦** — layout 层通过 context 消费 registry，不 import feature 模块。这个模式很好，保留。
2. **persist(zustand) 管理 dock 状态** — 用户自定义布局偏好持久化，保留。
3. **react-resizable-panels 实现 zone resize** — 成熟方案，保留。
4. **lazy loading (React.lazy + Suspense)** — 每个 panel 独立 chunk，保留。
5. **"Islands" 视觉设计（bg-secondary + rounded + shadow）** — 与 panel 内容无关的纯 CSS，保留。

---

## 7. 与活跃任务的关系

| 任务 | 与本诊断的关系 |
|---|---|
| `08-02-resource-library-redesign` (in_progress) | LibraryPanel 的 placement: center 是 registry 的第一个用户；当前 redesign 里的 LibraryPanel 实现可迁移到 registry 驱动 |
| `07-26-ui-design-audit` (planning) | IA 地图里 skills/settings 的 routing 分支可被 ViewRouter 取代 |
| `07-26-unified-task-hub` (planning) | TaskHub panel 是第一个 plugin 候选，可用 `LayoutPlugin` 自注册 |

---

## 8. 下一步

- [ ] 用户确认是否需要开新任务 `layout-shell-refactor` 实施上述方案
- [ ] 或作为 `08-02-resource-library-redesign` 的子任务 Phase 1-2 先落地
- [ ] Phase 3-4 视 plugin 实际需求再排期
