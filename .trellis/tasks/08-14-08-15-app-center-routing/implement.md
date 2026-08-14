# App.tsx 组合根重构 — 执行记录

## 审查结论（先行）

- App.tsx 作为组合根放置 Settings/Skill 视图本身合理；真正问题：
  1. **双路由源**：settings/library 走 appViewStore，skills 中心视图走 dockStore（skillsActive）
  2. **死变体**：`AppView['skills']` 无人 set、无分支
  3. **SkillContent 常驻挂载 + 启动即取数**（refreshSkills/refreshTagGroups on mount）
  4. **组合根职责过载**：centerContent switch + dock 按钮装配 + 全局副作用内联

## 执行顺序（每步测试绿）

### Phase A：dockStore ↔ appView 同步（TDD）
- [x] A1. `DOCK_PANEL_TO_APP_VIEW = { skills: 'skills' }` 中心耦合面板映射
- [x] A2. `togglePanel`：激活 skills → appView='skills'；打开其他 dock 面板退出 skills → 'normal'（对齐 library 退出语义）
- [x] A3. `activatePanel` / `closePanel` / `movePanel` 同步
- [x] A4. `dockStore.test.ts` +6（激活/折叠保持/退出/activate/close/library 独立）
- [x] A5. `appViewStore` 注释：'skills' 写入方说明

### Phase B：AppCenter 中心视图路由（TDD）
- [x] B1. `src/app/components/AppCenter.tsx`：只读 appView；settings/library 条件渲染；
       skills 时 SkillContent 激活挂载 + ProjectWorkspace hidden 保持挂载；normal 渲染 workspace
- [x] B2. `AppCenter.test.tsx` +5（四视图 + 响应式切换 + skills 激活挂载断言）

### Phase C：dock 按钮装配下沉（TDD）
- [x] C1. `src/app/hooks/UseDockBarButtons.tsx`（PascalCase 文件名满足 .tsx 规则，hook camelCase 导出）
- [x] C2. `UseDockBarButtons.test.tsx` +3（左右/排序/隐藏项/响应更新）
- [x] C3. 布局层已有 `DockBar(buttons: ReactNode[])` 容器保持不动，App 注入按钮列表

### Phase D：全局副作用下沉
- [x] D1. `useAppShell` 吸收 `useMenuPaste()` + `startQuickOpenActivityTracking` effect
- [x] D2. 启动同步 effect：dockStore 持久化 skills 激活态 → setAppView('skills')

### Phase E：App.tsx 瘦身
- [x] E1. 移除 SettingsView/SkillContent/ProjectWorkspace/cn/lazy/useMemo 等直接业务导入
- [x] E2. 只保留 `useAppShell` + `appView(isSettingsOpen)` + `useDockBarButtons` + 壳层组装

### Phase F：质量门禁
- [x] F1. `pnpm type-check` 全绿
- [x] F2. `npx eslint src/` 全绿
- [x] F3. `pnpm test:run` 1648 passed（+14 本任务，另含并发进程新增测试）
- [x] F4. `pnpm vitest run --typecheck` 无类型错误

### Phase G：spec 同步
- [x] G1. `frontend/directory-structure.md`：AppCenter/UseDockBarButtons 目录与依赖更新
- [x] G2. `frontend/state-management.md`：新增「中心视图路由（单一数据源 appViewStore）」章节

## 验证命令（全部通过）

```bash
pnpm type-check
npx eslint src/
pnpm test:run
pnpm vitest run --typecheck
```

## 审查门禁

- 组合根保持「hooks + JSX 编排」，业务视图路由收敛到 AppCenter
- 共享/公共组件无业务逻辑；dockStore 仅做路由源同步（非 UI）
- 行为保持：除「激活其他 dock 面板退出 skills 中心视图」（对齐 library 既有语义）外，
  skills 路由交互不变；SkillContent 从「常驻挂载」改为「激活挂载」
- 工作树中检测到并发进程的其他未提交改动（events.ts 常量、useFileTreeSync、useGitHistory*
  测试），与本次无文件重叠，未触碰

## Phase H：neeko-check 低风险合规优化

- [x] H1. feature 门面补导出：`git`（GitControlPanel / PullRequestsPanel / useRefreshGitInfo）、
       `conversation`（conversationTabTitle）、`file`（useFileTreeSync）
- [x] H2. 7 个 dock wrapper 深导入 → 门面（git/project/editor/skill/library/conversation/search）；
       `api/`、`store/` 保持防火墙白名单直导；深导入清零
- [x] H3. AppCenter 去重/可读性：单一外层容器 `CENTER_WRAPPER_CLASS` + 模块级面板常量
       `CENTER_PANEL_CLASS`；保持 ProjectWorkspace keep-mounted（稳定 DOM 位置）
- [x] H4. 复验：eslint / type-check / test:run（1648）/ vitest --typecheck 全绿
