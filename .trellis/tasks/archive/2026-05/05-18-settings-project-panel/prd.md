# Settings: Project Panel

## Goal

在 Settings 视图左侧导航新增 "Projects" 分类，列出所有项目（local/WSL/remote）。点击项目后右侧展示该项目的设置面板，支持编辑名称、路径、覆盖 Agent/IDE 默认值、管理 Tasks、以及移除项目。

布局选定 **Variant B**：Tab 分页分离 project/app scope 任务，Agent/IDE 双列并排显示。

## Requirements

### 导航层
- Settings 左侧导航在现有 7 个设置项下方增加分隔线 + "Projects" 分组标题
- 动态列出所有项目（local + WSL + remote），显示名称 + 类型标识色点
- 点击项目切换右侧面板到该项目设置
- 项目列表为空时显示空状态引导提示

### 项目设置面板（ProjectPanel.tsx）
- **Name**：文本输入，blur/enter 保存，调用后端 `rename_project`
- **Path**：只读显示当前路径 + "Change..." 按钮
  - 仅 local 项目可用（WSL/Remote 禁用按钮 + 提示）
  - 调用 Tauri `dialog.open` 选择新目录
  - 更换后调用 `refresh_git_info` 刷新 git 信息
- **Project Overrides**（双列布局）：
  - Agent 下拉选择：Use global default / 各预置+自定义 agent
  - IDE 下拉选择：Use global default / 各预置+自定义 IDE
  - 调用现有 `set_selected_agent` / `set_selected_ide`
- **Tasks**（Tab 分页）：
  - "Project" tab：展示 scope=project 的任务
  - "App (global)" tab：展示 scope=app 的任务 + "全局可见"提示
  - 每项显示 name + command + Edit/Delete 按钮
  - "+ Add Task" 按钮打开 TaskDialog（复用现有组件）
  - 新增任务默认 scope=project
- **Remove project**：底部 danger zone
  - 确认对话框
  - 移除后关闭该项目的终端会话
  - 自动切换到列表中下一个项目，或回退到 Appearance 面板

### 后端新增
- `rename_project(project_id: String, new_name: String)` — 更新 Project.name 并持久化
- `change_project_path(project_id: String, new_path: String)` — 更新 Project.path + 重新加载 git_info

### 组件重构
- 将 `TaskDialog` 从 `TaskRunButton.tsx` 提取为独立组件 `TaskDialog.tsx`
- ProjectPanel 和 TaskRunButton 共同复用

## Acceptance Criteria

- [ ] Settings 左侧导航显示 "Projects" 分组 + 动态项目列表
- [ ] 项目列表为空时展示空状态引导
- [ ] 点击项目显示对应设置面板
- [ ] 可编辑项目名称，blur/enter 保存并同步到侧边栏
- [ ] Local 项目可通过 "Change..." 更换路径，更换后刷新 git info
- [ ] WSL/Remote 项目的 "Change..." 按钮禁用
- [ ] 可选择/清除项目级 Agent override
- [ ] 可选择/清除项目级 IDE override
- [ ] Tasks "Project" tab 展示 project scope 任务列表
- [ ] Tasks "App" tab 展示 app scope 任务
- [ ] 可在项目设置中添加/编辑/删除任务
- [ ] 移除项目后关闭其终端会话
- [ ] 移除项目后自动切换到其他项目或回退到默认面板
- [ ] `npx tsc --noEmit` 通过
- [ ] `cargo check` 通过

## Definition of Done

- 前端类型检查通过
- Rust 编译通过
- UI 在 `pnpm tauri dev` 中可交互验证全部 AC
- 原型 HTML 文件删除

## Decision (ADR-lite)

**Context**: Settings 需要项目级配置入口，参考了 Cursor 的 Project Settings 布局。

**Decision**: 采用 Variant B — 在 Settings 侧边栏新增 Projects 分组列出所有项目，项目设置面板中 Agent/IDE 双列排布，Tasks 用 Tab 分页区分 project/app scope。

**Consequences**:
- 需要扩展 `NavCategory` 类型系统以支持动态项目条目
- TaskDialog 需要从 TaskRunButton 中提取复用
- 后端需新增 2 个 Tauri 命令（rename_project, change_project_path）

## Out of Scope

- 项目自定义图标（Appearance）
- auto-run 字段持久化（TaskConfig 暂不扩展）
- 从 Settings 中直接运行 Task（保持 TitleBar 为唯一 Run 入口）
- 项目排序/分组/搜索
- 项目级环境变量配置
- orphan task 文件清理

## Technical Notes

- 导航: `NAV_ITEMS` 当前为静态数组，项目列表需要动态渲染，可能需要将 nav 渲染逻辑分为"静态设置区"和"动态项目区"
- 项目数据源: `useAppStore` 的 `projects` 或通过 `useAppContext` 获取
- Change Path: 使用 `@tauri-apps/plugin-dialog` 的 `open()` API
- TaskDialog 提取: 保持 Props 接口不变，仅移动文件位置
- Remove + cleanup: 调用 `remove_project` 后还需关闭相关 terminal session（`close_terminal_session`）
