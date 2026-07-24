# 彻底消除 dock 注册表与 shared/layout 循环依赖

## Goal

从根本上消除 `layout/dockPanels.ts` 对 `features/`/`app/` 的声明式 lazy 例外，以及 `shared/store/dockStore ↔ layout/dockPanels` 循环依赖，使 dock 体系完全符合单向依赖规范：

```
ui/       ← layout/     (纯骨架，只通过 Context/props 拿注册表)
shared/   ← features/   (shared 只持有纯数据 meta，不依赖 layout/features/app)
features/ ← app/        (app 持有 UI 注册表 + lazy 组件绑定，并注入 layout)
layout/   ← app/
```

## Background（现状）

| 问题 | 位置 | 影响 |
|------|------|------|
| layout 直接 lazy import features/app | `layout/dockPanels.ts` | 只能靠 ESLint 文件级例外压住 |
| shared → layout | `dockStore` import `dockPanelRegistry` | 违反 shared 不得依赖 layout；与 layout→shared 构成环 |
| 注册表职责混杂 | 同一文件含 meta / icons / lazy components | store 只需要 meta，却被拖进 React 组件图 |

`dockStore` 实际只用到：`defaultZone`、`defaultOrder`、`openAs`、（补区时）`defaultZone`。  
layout 渲染需要：`title`、`component`、`minPanelSize`、`defaultZoneSize`。  
app 按钮需要：`title`、`icon` + `dockPanelIcons`。

## Requirements

1. **拆分注册表职责**
   - **Panel Meta（纯数据）** 放在 `shared/`，无 React、无 lazy、无 features/app 引用；供 `dockStore` 构建默认 zones/barItems 与 `togglePanel` 补区。
   - **UI Registry（展示 + 组件绑定）** 放在 `app/dock/`，含 title/icon/component/minPanelSize 等，并对 features/app 做 lazy import。
2. **layout 不再持有注册表实现**
   - 删除 `layout/dockPanels.ts`。
   - `DockLayout` / `DockZone` / `DockZoneTabs` 通过 **DockRegistry Context**（由 app 注入）读取 UI 定义；layout 源码不 import `@/features` 或 `@/app`。
3. **去掉 ESLint 例外**
   - 移除 `.eslintrc.cjs` 中针对 `src/layout/dockPanels.ts` 的 `import/no-restricted-paths` / `import/no-cycle` 关闭块。
4. **消费者迁移**
   - `dockStore` → 只依赖 shared meta。
   - `DockBarButton`（已在 app）→ 直接 import `app/dock` 注册表/icons。
   - layout dock 组件 → `useDockRegistry()`。
5. **同步 spec**
   - 更新 `directory-structure.md` / `quality-guidelines.md`：删除「dockPanels 例外」「shared↔layout 环单独跟踪」表述，改为本任务落地后的正式约定。
6. **行为不变**
   - 默认 panel 布局、bar 按钮、toggle/activate/move/close、lazy 加载、defaultZoneSize / minPanelSize 行为与现网一致。

## Non-Goals

- 不重做 dock 拖拽、持久化 schema、panel 业务逻辑。
- 不把 `dockStore` 迁出 shared（仍为跨 feature 全局状态）。
- 不改为运行时动态插件式注册（保持静态编译期注册表）。
- 不处理其它无关架构债。

## Acceptance Criteria

- [x] `src/layout/` 下**任意文件**均不再 import `@/features/*` 或 `@/app/*`（含 lazy）
- [x] `src/shared/**` 不再 import `src/layout/**`
- [x] 不存在 `layout/dockPanels.ts`；ESLint 无 dockPanels 专用例外
- [x] `pnpm exec eslint src/layout src/shared/store src/app/dock --quiet` 零 error
- [x] `pnpm type-check` 通过
- [x] `pnpm test:run` 已有测试通过
- [x] 手动冒烟：左右 dock 开关、panel 切换、skills/files/browser 懒加载、快捷键 toggle 正常
- [x] frontend specs 已更新且不再描述上述例外/遗留

## Notes

- 前序任务 `layout-architecture-cleanup` 已把协调逻辑迁到 app；本任务清掉其明确遗留项。
- Meta 与 UI Registry 字段需保持 panel id 集合一致；新增 panel 时两边同步（implement 中写清 checklist）。
