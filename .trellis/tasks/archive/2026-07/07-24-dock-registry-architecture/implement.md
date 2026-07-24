# Implement — Dock Registry Architecture

## Preconditions

- 前序 `layout-architecture-cleanup` 已合并（layout 协调逻辑已在 app）
- 本任务在 planning 评审通过后 `task.py start`

## Steps

### 1. shared：纯 meta

1. 新增 `src/shared/dock/types.ts` — `DockPanelMeta`
2. 新增 `src/shared/dock/panelMeta.ts` — `DOCK_PANEL_META`（从现 `dockPanels.ts` 抽 defaultZone/defaultOrder/openAs/defaultZoneSize/id）
3. 新增 `src/shared/dock/index.ts` 桶导出（可选）
4. 改 `src/shared/store/dockStore.ts`：只依赖 `DOCK_PANEL_META`，删除对 `layout/dockPanels` 的 import

### 2. layout：Context 骨架

1. 新增 `src/layout/DockRegistryContext.tsx`（`DockPanelViewDef` 类型 + Provider 可选导出 + `useDockRegistry`）
   - ViewDef 可定义在 layout 或从 shared meta extend（layout 内 extend 避免 layout→app）
2. `DockLayout.tsx` / `DockZone.tsx` / `DockZoneTabs.tsx`：`import { dockPanelRegistry }` → `useDockRegistry()`
3. 从 `layout/index.ts` 导出 context 符号（若 app 需要 Provider 组件放 layout）
4. **删除** `src/layout/dockPanels.ts`

### 3. app：UI Registry + Provider

1. 新增 `src/app/dock/registry.ts`：icons + lazy bindings + `dockPanelRegistry`（合并 `DOCK_PANEL_META`）
2. 新增 `src/app/dock/DockRegistryProvider.tsx`（薄包装 layout context，value=registry）**或** 直接在 App 使用 layout 的 Provider
3. 改 `DockBarButton.tsx` import 到 `@/app/dock/registry`
4. 在 `App.tsx` 或 `AppProviders.tsx` 挂载 Provider，覆盖 `AppLayout`/`DockLayout` 子树

### 4. ESLint + Spec

1. 删除 `.eslintrc.cjs` dockPanels 例外块
2. 更新 `.trellis/spec/frontend/directory-structure.md`
3. 更新 `.trellis/spec/frontend/quality-guidelines.md`（Layout 边界规则章节）

### 5. 验证

```bash
# 架构
rg -n "from ['\"]@/features|from ['\"]@/app" src/layout --glob '!**/node_modules/**'
# 应无匹配

rg -n "from ['\"].*layout" src/shared
# 应无 layout import

pnpm exec eslint src/layout src/shared/store src/shared/dock src/app/dock src/app/components/DockBarButton.tsx --quiet
pnpm type-check
pnpm test:run
```

冒烟：toggle 左右 panel、skills 视图、browser 默认宽度、快捷键 projects/skills。

### 6. 收尾

- 验收勾选 PRD
- `trellis-update-spec` 确认
- commit → finish-work

## 新增 Panel Checklist（写入 spec）

1. 在 `shared/dock/panelMeta.ts` 增加 meta  
2. 在 `app/dock/registry.ts` 增加 title/icon/lazy component（及 minPanelSize）  
3. 如需 bar 按钮，确认 `defaultZone` 会进入 `buildDefaultBarItems`  
4. 如需 wrapper，放 `app/dock/DockPanelWrappers.tsx`  
5. 不在 `layout/` 增加 feature import  

## File Touch List（预期）

| 路径 | 动作 |
|------|------|
| `src/shared/dock/types.ts` | add |
| `src/shared/dock/panelMeta.ts` | add |
| `src/shared/dock/index.ts` | add |
| `src/shared/store/dockStore.ts` | edit |
| `src/layout/DockRegistryContext.tsx` | add |
| `src/layout/dock-layout/DockLayout.tsx` | edit |
| `src/layout/dock-layout/DockZone.tsx` | edit |
| `src/layout/dock-layout/DockZoneTabs.tsx` | edit |
| `src/layout/dockPanels.ts` | delete |
| `src/layout/index.ts` | edit |
| `src/app/dock/registry.ts` | add |
| `src/app/components/DockBarButton.tsx` | edit |
| `src/app/App.tsx` 或 `AppProviders.tsx` | edit |
| `.eslintrc.cjs` | edit |
| `.trellis/spec/frontend/directory-structure.md` | edit |
| `.trellis/spec/frontend/quality-guidelines.md` | edit |

## Rollback

单 commit 或短分支；行为与 persist 不变，回滚即恢复旧文件布局。
