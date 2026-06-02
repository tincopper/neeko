# PRD: 简化 Add Local Project 流程

## 动机

当前 "Add Local Project" 需要两步交互：
1. 选择目录（原生文件夹对话框）
2. 弹出确认 Modal（选 Agent + IDE）

第二步是多余的——Agent 和 IDE 都可以在项目添加后通过右键 Settings 设置。多一步 Modal 打断心流，且大多数时候用户不需要立即配置这两个选项。

## 目标

选完目录后直接 `add_project`，Agent/IDE 设为默认值（None），项目立刻出现在左侧面板。

## 变更范围

### 1. `src/features/project/hooks/useLocalProjects.ts`
- `handleAddProject`: 选完目录后直接调用 `addProject(path, null, null, randomAvatarColor())` + 更新 store，删除 `setPendingPath` 逻辑
- 删除 `handleConfirmAddProject`
- 删除 `pendingPath` state
- 删除 `agents` state
- 删除 `loadAgents` callback
- 删除 `listAgents` import
- 返回对象中移除 `pendingPath`、`setPendingPath`、`agents`、`loadAgents`、`handleConfirmAddProject`

### 2. `src/app/hooks/useAppShell.ts`
- 不再从 `useLocalProjects()` 解构 `pendingPath`、`setPendingPath`、`agents`、`loadAgents`、`handleConfirmAddProject`
- `projectActionsValue` 中移除 `pendingPath`、`setPendingPath`、`agents`、`loadAgents`
- `appModalsProps` 中移除 `pendingPath`、`onConfirmAddProject`、`onCancelAddProject`

### 3. `src/app/AppModals.tsx`
- Props interface 中移除 `pendingPath`、`onConfirmAddProject`、`onCancelAddProject`、`loading`
- 移除 `<AddProjectModal>` 渲染
- 移除 `AddProjectModal` import

### 4. `src/features/project/hooks/__tests__/useLocalProjects.test.ts`
- 删除 `handleConfirmAddProject` 相关测试用例
- 更新 `handleAddProject` 测试：期望选完目录后直接调 `add_project` 而非设 `pendingPath`

### 5. `src/features/project/components/AddProjectModal.tsx`
- 保留文件不删（被 `index.ts` 导出），但不再被任何地方引用

## 不变的部分
- 去重检查保留（`projects.some`）
- `randomAvatarColor()` 保留
- `saveSession` 调用保留
- 后端零改动

## 验收标准
1. 点击 "+" → "Add Local Project" → 选目录 → 项目直接出现在左侧面板，无弹窗
2. `pnpm type-check` 通过
3. `pnpm test:run` 通过
4. 已有的 Agent/IDE 右键 Settings 功能不受影响
