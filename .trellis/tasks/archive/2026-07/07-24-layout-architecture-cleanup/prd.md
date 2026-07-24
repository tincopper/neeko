# 清理布局架构违规：layout/→features/ 依赖迁移

## Goal

将 layout/ 中对 @/features/ 的违规依赖迁移到 app/ 层，包括 MainContent→ProjectWorkspace、DockPanelWrappers 迁移、TitleBar slot 化、修复 ESLint 边界规则

## Requirements

- 将 `MainContent.tsx` 迁移到 `src/app/components/ProjectWorkspace.tsx`
- 将 `DockPanelWrappers.tsx` 迁移到 `src/app/dock/DockPanelWrappers.tsx`
- `TitleBar` 中 `<TaskRunButton />` 和 `<DebugRunButton />` 通过 `actions` slot 注入
- `DockBarButton` 和 `OpenIdeButton` 中对 feature store 的依赖下沉到 `app/` 层
- `AppLayout` 中心内容改为 `children` prop，由 `App.tsx` 传入 `<ProjectWorkspace />`
- 修复 `.eslintrc.cjs` 中 `import/no-restricted-paths` 的 `layout/` 边界规则
- `layout/` 目录最终不再 import 任何 `@/features/`

## Acceptance Criteria

- [x] `src/layout/` 下所有文件不再 import `@/features/`（`dockPanels.ts` 的 lazy import 除外，因其为声明式注册表）
- [x] `pnpm lint` 对 `src/layout/` 零报错
- [x] `pnpm type-check` 零报错
- [x] `pnpm test:run` 已有测试全部通过
- [x] 应用可正常启动（`pnpm tauri dev`），所有 panel 切换、project 路由、skill 视图正常工作

## Notes

**迁移后的依赖方向**

```
ui/          ← layout/     (纯骨架：DockLayout, TitleBar slot, ActivityBar)
shared/      ← features/   (各自独立)
features/    ← app/        (协调层：ProjectWorkspace, DockPanelWrappers, slot 填充)
layout/      ← app/        (app 组装骨架并填充 slot)
```

**技术约束**
- `dockPanels.ts` 中的 `lazy(() => import('@/features/...'))` 属于声明式注册，保留在 `layout/` 中
- `shared/store/dockStore.ts` 引用 `dockPanels` 的 `shared/ → layout/` 依赖属已存在问题，暂不处理
