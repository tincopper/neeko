# Design — Dock Registry Architecture

## Problem

```
shared/store/dockStore ──import──► layout/dockPanels ──lazy──► features/* + app/dock/*
       ▲                                    │
       └──────── layout/dock-layout ────────┘
```

1. **层级倒置**：shared 依赖 layout  
2. **环**：layout 的 dock 组件又依赖 shared store  
3. **例外依赖**：layout 通过 lazy 引用 features/app，只能 ESLint 特赦  

## Confirmed Facts（代码）

| 消费者 | 使用字段 |
|--------|----------|
| `dockStore` `buildDefaultPanels/BarItems` | `defaultZone`, `defaultOrder`, `openAs` |
| `dockStore` `togglePanel` 补区 | `defaultZone`（及 registry 是否存在） |
| `DockLayout.getRightPanelSize` | `defaultZoneSize` |
| `DockZone` / `DockZoneTabs` 渲染 | `title`, `component`, `minPanelSize` |
| `DockBarButton` | `title`, `icon` + `dockPanelIcons` |

→ store **不需要** React 组件；layout **不需要**自己拥有 binding 源文件。

## Options Considered

### A. Meta in shared + UI Registry in app + Context 注入 layout（推荐）

```
shared/dock/
  types.ts          # DockPanelMeta
  panelMeta.ts      # 纯数据 DOCK_PANEL_META

shared/store/dockStore.ts  → import DOCK_PANEL_META only

app/dock/
  registry.ts       # dockPanelRegistry + icons + lazy bindings
  DockPanelWrappers.tsx (已有)
  DockRegistryProvider.tsx  # 向 layout 注入

layout/
  DockRegistryContext.tsx   # Context + useDockRegistry（无默认实现/无 lazy）
  dock-layout/*             # useDockRegistry() 替代 import dockPanels
  ❌ dockPanels.ts 删除
```

**优点**：单向依赖干净；store 可单例/persist 不改 API；layout 零 features/app import；ESLint 例外可删。  
**缺点**：新增 panel 需改 meta + app binding 两处（可用 checklist / 组合函数降低遗漏）。

### B. 整表只放 app，dockStore 工厂/init 注入

`createDockStore(meta)` 或 `initDockPanelMeta(meta)` 在 app 启动时调用。

**优点**：单一注册源。  
**缺点**：Zustand 单例 + persist 与「先 import store 再 init」时序脆弱；features 里已有 `useDockStore.getState()` 直接调用，init 顺序难保证。

### C. 注册表放 shared，component 字段用字符串 id，layout 查 app 映射表

**缺点**：间接层多，shared 仍不该知道 panel 业务 id 集合的「展示绑定」细节；收益不如 A 清晰。

## Decision

采用 **方案 A**。

### 依赖方向（目标）

```
shared/dock/panelMeta  ←  dockStore
shared/dock/types      ←  layout DockRegistryContext 类型（可 re-export 或 layout 自有 UI 类型）
app/dock/registry      ←  features/* + app/dock wrappers（lazy）
app/dock/registry      ←  DOCK_PANEL_META（展开/合并）
app  Provider          →  layout context value
layout dock-*          ←  useDockRegistry() + useDockStore()
```

### 类型拆分

```ts
// shared/dock/types.ts
export interface DockPanelMeta {
  id: string;
  defaultZone: 'left' | 'right';
  defaultOrder: number;
  openAs?: 'tab' | 'panel';
  defaultZoneSize?: number; // store 当前未读，但属于布局默认策略数据；放 meta 便于单一数据源
}

// layout 或 app 使用的 UI 定义（可放 layout context 类型文件，避免 layout import app）
export interface DockPanelViewDef extends DockPanelMeta {
  title: string;
  icon: string;
  component?: React.LazyExoticComponent<React.ComponentType<Record<string, unknown>>>;
  minPanelSize?: number;
}
```

说明：`defaultZoneSize` 现由 layout 读取；若只放 UI registry，store 不需要它。为减少双源，**meta 含 defaultZoneSize**，UI registry spread meta 后附加 title/icon/component/minPanelSize。layout 从 context 读完整 ViewDef 即可。

### Context 契约

```tsx
// layout/DockRegistryContext.tsx
const DockRegistryContext = createContext<Record<string, DockPanelViewDef> | null>(null);

export function useDockRegistry(): Record<string, DockPanelViewDef> {
  const value = useContext(DockRegistryContext);
  if (!value) throw new Error('DockRegistryProvider missing');
  return value;
}

// app：Provider 包在 AppProviders 或 AppLayout 外层，保证 DockLayout 树内可用
```

### 组合 UI Registry（app）

```ts
// app/dock/registry.ts
import { DOCK_PANEL_META } from '@/shared/dock/panelMeta';

const bindings = {
  projects: { title: 'Projects', icon: 'FolderOpen', component: lazy(...), minPanelSize: 200 },
  // ...
} satisfies Record<keyof typeof DOCK_PANEL_META, Omit<DockPanelViewDef, keyof DockPanelMeta>>;

export const dockPanelRegistry = mapValues(DOCK_PANEL_META, (meta, id) => ({
  ...meta,
  ...bindings[id],
}));
```

`git`（openAs: 'tab'）无 component：binding 可省略 component。

### dockStore 变更

- `import { DOCK_PANEL_META } from '../dock/panelMeta'`
- `buildDefaultPanels/BarItems/togglePanel` 改读 meta
- **对外 API 不变**（`useDockStore`、persist key、partialize）

### Provider 挂载点

优先：`AppProviders` 内层或 `App.tsx` 中 `AppProviders` 包住 `AppLayout` 的同一层，确保：

```
TitleBar
AppProviders
  DockRegistryProvider(registry)
    AppLayout → DockLayout → Zone/Tabs
```

`DockBarButton` 在 app 内可直接 `import { dockPanelRegistry, dockPanelIcons } from '@/app/dock/registry'`，不必走 context（同层）。

### ESLint

删除：

```js
{ files: ['src/layout/dockPanels.ts'], rules: { 'import/no-restricted-paths': 'off', 'import/no-cycle': 'off' } }
```

可选加固（非必须）：禁止 `shared/**` from `layout/**` 的 zone（若尚未被其它规则覆盖）。当前 shared 未在 zones 的 target 列表里禁止 layout，但删掉 import 后 `import/no-cycle` 即可兜住环。

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| Provider 未挂导致 runtime throw | App 根组装一次；必要时 dev-only assert |
| Meta 与 bindings 键不一致 | `satisfies` / 构建时 `Object.keys` 对齐断言；type-check |
| persist 旧数据 | 不改 persist shape，无迁移 |
| 测试未包 Provider | layout 单测若渲染 DockZone 需 Provider；现有测试覆盖面再扫一遍 |

## Spec 更新点

- `directory-structure.md`：去掉 layout/dockPanels；增加 `shared/dock/*`、`app/dock/registry.ts`、layout context
- `quality-guidelines.md`：删除 layout lazy 例外与「环单独跟踪」；写入正式分层与新增 panel checklist
