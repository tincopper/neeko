# Implement — Layout Architecture Cleanup

## Execution Order

依赖关系：Step 1-2 独立 → Step 3-4 串联 → Step 5-7 串联。

### Step 1: MainContent → ProjectWorkspace

1. `cp src/layout/MainContent.tsx src/app/components/ProjectWorkspace.tsx`
2. 函数重命名：`function MainContent()` → `function ProjectWorkspace()`
3. export 重命名：`export default React.memo(MainContent)` → `export default React.memo(ProjectWorkspace)`
4. 删除原文件 `src/layout/MainContent.tsx`

**验证点**：TypeScript 编译通过（ProjectWorkspace 内部 import 不变，只是搬家）。

### Step 2: DockPanelWrappers 迁移

1. `mkdir -p src/app/dock`
2. `cp src/layout/dock-layout/DockPanelWrappers.tsx src/app/dock/DockPanelWrappers.tsx`
3. 更新 `src/layout/dockPanels.ts` 中 5 处 lazy import 路径：
   - `import('./dock-layout/DockPanelWrappers')` → `import('@/app/dock/DockPanelWrappers')`
4. 更新 `src/layout/dock-layout/index.ts` 的 re-export：
   - `from "./DockPanelWrappers"` → `from "@/app/dock/DockPanelWrappers"`
5. 删除原文件 `src/layout/dock-layout/DockPanelWrappers.tsx`

**验证点**：TypeScript 编译通过，`dockPanels.ts` 无类型错误。

### Step 3: AppLayout 纯骨架化

修改 `src/layout/AppLayout.tsx`：

1. 删除 imports：
   - `import SettingsView from '@/features/settings/components/SettingsView'`
   - `import SkillContent from '@/features/skill/components/SkillContent'`
   - `import { useAppViewStore } from '@/shared/store/appViewStore'`
   - `import { useDockStore } from '@/shared/store/dockStore'`
   - `import MainContent from './MainContent'`

2. 接口增加 `children` prop：
   ```tsx
   interface AppLayoutProps {
     onAddProject: () => void;
     onAddWsl: () => void;
     onAddRemote: () => void;
     onOpenSettings: () => void;
     children?: React.ReactNode;  // ← 新增
   }
   ```

3. 函数签名增加 `children`：
   ```tsx
   function AppLayout({ ..., children }: AppLayoutProps)
   ```

4. 删除 `centerContent` 计算块（appView/useDockStore 订阅 + 条件渲染 60 行）

5. `isSettingsOpen` 改为 `false`（ToolbarFooter prop，高亮功能暂时关闭，后续可恢复）

6. 渲染改为 `{children}`：
   ```tsx
   <DockLayout toolbarFooterLeft={...}>
     {children}
   </DockLayout>
   ```

7. 更新注释：删除 "Settings full-page / Skills two-column / 避免 mount/unmount" 相关描述

**验证点**：TypeScript 编译通过，AppLayout 不再 import features。

### Step 4: App.tsx 接管路由

修改 `src/app/App.tsx`：

1. 新增 imports：
   ```tsx
   import SettingsView from '@/features/settings/components/SettingsView';
   import SkillContent from '@/features/skill/components/SkillContent';
   import ProjectWorkspace from '@/app/components/ProjectWorkspace';
   import { useAppViewStore } from '@/shared/store/appViewStore';
   import { useDockStore } from '@/shared/store/dockStore';
   import { cn } from '@/lib/utils';
   ```

2. 在 `<AppLayout>` 处构建 centerContent：
   ```tsx
   const appView = useAppViewStore((s) => s.appView);
   const skillsActive = useDockStore((s) => s.zones.left?.activePanelId === 'skills');

   const centerContent = appView === 'settings'
     ? <SettingsView />
     : (
       <>
         <div className={cn('...', skillsActive && 'hidden')}>
           <ProjectWorkspace />
         </div>
         <div className={cn('...', !skillsActive && 'hidden')}>
           <SkillContent />
         </div>
       </>
     );

   return <AppLayout {...appLayoutProps}>{centerContent}</AppLayout>;
   ```

3. `DockBarButton.tsx` 注释中引用 "MainContent" 的地方改为 "ProjectWorkspace"（仅注释）

**验证点**：TypeScript 编译通过，App.tsx import features（允许的 app→features 方向）。

### Step 5: TitleBar slot 化

修改 `src/layout/TitleBar.tsx`：

1. 删除 imports：
   - `import TaskRunButton from "@/features/task/components/TaskRunButton"`
   - `import { DebugRunButton } from "@/features/debug"`

2. 接口增加 `actions` prop：
   ```tsx
   interface TitleBarProps {
     actions?: React.ReactNode;
   }
   ```

3. 渲染区域改为 `{actions}`：
   ```tsx
   <div className="flex items-center gap-2 shrink-0 px-2">
     <OpenIdeButton />
     {actions}
     {!IS_MACOS && <WindowControls />}
   </div>
   ```

修改 `src/app/App.tsx`：

1. 新增 imports：
   ```tsx
   import TaskRunButton from "@/features/task/components/TaskRunButton";
   import { DebugRunButton } from "@/features/debug";
   ```

2. 注入 actions：
   ```tsx
   <TitleBar actions={<><TaskRunButton /><DebugRunButton /></>} />
   ```

**验证点**：TypeScript 编译通过，TitleBar 不再 import features。

### Step 6: DockBarButton 和 OpenIdeButton 下沉

**6a: DockBarButton 迁移**

1. `cp src/layout/dock-layout/DockBarButton.tsx src/app/components/DockBarButton.tsx`
2. 更新其 `dockPanelRegistry` 等 import 路径（从 `../dockPanels` 改为实际路径）
3. 修改 `DockBar.tsx`：接受 `buttons: React.ReactNode[]` prop
4. 修改 `DockLayout.tsx`：透传 buttons 或让调用方直接传入
5. 修改 `App.tsx`：构建 DockBarButton 数组传入 DockLayout
6. 删除 `src/layout/dock-layout/DockBarButton.tsx`

**6b: OpenIdeButton 迁移**

1. `cp src/layout/OpenIdeButton.tsx src/app/components/OpenIdeButton.tsx`
2. 更新 import 路径（`useFullscreen`、`WindowControls` 等相对路径改为 alias）
3. `TitleBar.tsx` 删除 `import OpenIdeButton from './OpenIdeButton'`
4. `App.tsx` 将 `<OpenIdeButton />` 注入 TitleBar actions slot
5. 删除 `src/layout/OpenIdeButton.tsx`

**验证点**：TypeScript 编译通过，两个文件都在 app/ 下正常工作。

### Step 7: ESLint 边界规则修复

修改 `.eslintrc.cjs`，在两个 override block（`**/*.tsx` 和 `**/*.ts`）的 `import/no-restricted-paths` zones 中：

1. 确认 layout zone 存在且方向正确：
   ```js
   {
     target: './src/layout',
     from: ['./src/features', './src/app'],
     message: 'layout/ must not import from features/ or app/. Move coordination logic to src/app/.',
   }
   ```

2. 为 `dockPanels.ts` 添加例外（放在该 zone 的 `except` 中）：
   ```js
   except: ['./dockPanels.ts'],
   ```

**验证点**：
```bash
pnpm lint                          # 全量 lint 通过
npx eslint src/layout/ --quiet     # layout 目录零报错
pnpm type-check                    # 类型检查通过
pnpm test:run                      # 现有测试通过
```

---

## Full Verification Checklist

```bash
# 质量门
pnpm lint
pnpm type-check
pnpm test:run

# 运行时门（手动）
pnpm tauri dev
# → 应用正常启动
# → Project 切换正常
# → Settings 页面正常
# → Skills panel 切换正常
# → Dock panel（files, git commit, browser 等）正常
# → TitleBar 按钮（task, debug, open IDE）正常
# → Add Project 菜单正常
```
