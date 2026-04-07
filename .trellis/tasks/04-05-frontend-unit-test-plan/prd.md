# 前端单元测试计划

## Goal

为 Neeko 前端（React + Tauri）制定分阶段测试计划，从零搭建测试基础设施，按优先级逐步覆盖 utils → hooks → components。

## 现状

- **测试基础设施**：零。无 vitest、无 @testing-library、无测试文件、无配置
- **后端测试**：已完成脚手架搭建（`src-tauri/tests/unit/`）

---

## 代码清单与优先级

### P0 — 纯工具函数（6 文件，~280 LOC）

零依赖纯函数，投入产出比最高。

| 文件 | 导出 | 要点 |
|------|------|------|
| `src/utils/platform.ts` | `IS_WINDOWS`, `IS_MACOS` | 平台检测常量 |
| `src/utils/terminal.ts` | `DEFAULT_FONT_FAMILY`, `buildFontFamily()` | 字体拼接纯函数 |
| `src/utils/agents.ts` | `getAgentIconSrc()` | 字典查找 + null 安全 |
| `src/utils/fileIcons.ts` | `getFileIcon()`, `fileIconSrc()` | 扩展名 → 图标映射 |
| `src/utils/distros.ts` | `getDistroIcon()` | WSL 发行版名 → 图标，含 regex 归一化 |
| `src/utils/idePresets.ts` | `getIdeIconSrc()`, `getIdeCommand()`, `getIdeIconByCommand()`, `IDE_PRESETS` | 平台感知的 IDE 命令选择 + 反向查找 |

### P1 — 纯 React Hooks（3 个，~160 LOC）

不依赖 Tauri，仅使用 React 原生 API。

| Hook | 要点 |
|------|------|
| `useToast` | 简单状态 + 3s 定时器自动消失 |
| `useSideTerminalResize` | DOM 拖拽 + RAF 节流 + 宽度约束（200–1200px） |
| `useWorktreeState` | 每项目的 worktree 状态管理，嵌套 Map |

### P2 — 带 Tauri 依赖的 Hooks（5 个，~783 LOC）

需要 mock `invoke` / `listen` / `emit`。

| Hook | Tauri 命令 | 复杂度 |
|------|-----------|--------|
| `useAppConfig` | `load_config`, `save_config` | 中 — 配置持久化 + CSS 变量同步 |
| `useLocalProjects` | `list_projects`, `add_project`, `remove_project` 等 ~10 个命令 | 高 — 项目 CRUD 全生命周期 |
| `useWslProjects` | 通过回调间接依赖 | 中高 — WSL entry/project 管理 + 缓存协调 |
| `useRemoteProjects` | 通过回调间接依赖 | 中高 — SSH auth 状态 + Base64 编解码 |
| `useKeyboardShortcuts` | 通过回调间接依赖 | 极高 — 7+ 快捷键，多项目类型路由 |

### P3 — 复杂组件（11+ 个，~6000+ LOC）

| 组件 | 要点 |
|------|------|
| `FileTree.tsx` | `buildTree()` 纯函数可单独测试（tree 构建 + compaction） |
| `DiffView.tsx` | diff 渲染（unified/split）+ 语法高亮 |
| `SettingsPanel.tsx` | 大量交互控件 + 配置持久化 |
| `TerminalView.tsx` | xterm 生命周期 + PTY 事件 |
| `WSLTerminalView.tsx` | 同上，WSL 变体 |
| `RemoteTerminalView.tsx` | 同上，SSH 变体 |
| `ProjectItem.tsx` | Git 操作对话框 |
| `RemoteItems.tsx` | SSH 连接管理 |
| `RemoteDialog.tsx` | 远程连接表单 |
| `WSLDialog.tsx` | WSL 发行版选择 |
| `RemoteAuthDialog.tsx` | SSH 认证对话框 |

---

## 测试目录结构

采用 `src/tests/` 独立目录方案，测试与源码同在 `src/` 下但分开存放：

```
src/
├── tests/                              # 前端测试独立目录
│   ├── setup.ts                        # 全局测试配置（Tauri API mock、cleanup）
│   ├── factories.ts                    # 共享测试数据工厂（Phase 3 引入）
│   ├── utils/
│   │   ├── platform.test.ts
│   │   ├── terminal.test.ts
│   │   ├── agents.test.ts
│   │   ├── fileIcons.test.ts
│   │   ├── distros.test.ts
│   │   └── idePresets.test.ts
│   ├── hooks/
│   │   ├── useToast.test.ts
│   │   ├── useSideTerminalResize.test.ts
│   │   ├── useWorktreeState.test.ts
│   │   ├── useAppConfig.test.ts
│   │   ├── useLocalProjects.test.ts
│   │   ├── useWslProjects.test.ts
│   │   ├── useRemoteProjects.test.ts
│   │   └── useKeyboardShortcuts.test.ts
│   └── components/
│       ├── FileTree.test.tsx
│       ├── DiffView.test.tsx
│       ├── SettingsPanel.test.tsx
│       └── ...
├── utils/
├── hooks/
└── components/
```

### vitest.config.ts 对应调整

```typescript
export default defineConfig({
  // ...
  test: {
    include: ['src/tests/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/tests/setup.ts'],
  },
});
```

### 导入约定

测试文件通过相对路径导入源码：

```typescript
// src/tests/utils/platform.test.ts
import { IS_WINDOWS, IS_MACOS } from '../../utils/platform';

// src/tests/hooks/useToast.test.ts
import { useToast } from '../../hooks/useToast';
```

---

## 实施阶段

### Phase 1：基础设施搭建 + P0 Utils

**目标**：从零搭建完整测试环境，覆盖全部纯工具函数

1. 安装依赖：`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`
2. 创建 `vitest.config.ts`（`include: ['src/tests/**/*.test.*']`）
3. 创建 `src/tests/setup.ts`（全局 Tauri mock）
4. 添加 `package.json` 测试脚本
5. 编写 P0 测试（`src/tests/utils/` 下 6 个文件）
6. 验证 `pnpm test:run` 全部通过

### Phase 2：P1 纯 React Hooks

**目标**：覆盖不依赖 Tauri 的 Hooks

1. `src/tests/hooks/useToast.test.ts` — fake timers + 状态断言
2. `src/tests/hooks/useSideTerminalResize.test.ts` — DOM 事件模拟 + RAF mock
3. `src/tests/hooks/useWorktreeState.test.ts` — 嵌套状态隔离

### Phase 3：P2 Tauri Hooks

**目标**：覆盖核心业务逻辑 Hooks

1. 创建 `src/tests/factories.ts`（测试数据工厂）
2. `src/tests/hooks/useAppConfig.test.ts` — invoke mock + CSS 变量验证
3. `src/tests/hooks/useLocalProjects.test.ts` — 完整 CRUD 流程
4. `src/tests/hooks/useWslProjects.test.ts` — entry/project 生命周期
5. `src/tests/hooks/useRemoteProjects.test.ts` — auth 流程 + Base64
6. `src/tests/hooks/useKeyboardShortcuts.test.ts` — 键盘事件模拟

### Phase 4：P3 组件（按需）

**目标**：覆盖高价值组件逻辑

1. `src/tests/components/FileTree.test.tsx` — `buildTree()` 纯函数优先
2. `src/tests/components/DiffView.test.tsx` — 后端 mock + 渲染验证
3. `src/tests/components/SettingsPanel.test.tsx` — 交互测试
4. Terminal 组件 — xterm mock

---

## Tauri 命令 Mock 清单

| 类别 | 命令 |
|------|------|
| Config | `save_config`, `load_config` |
| Projects | `list_projects`, `add_project`, `remove_project`, `set_active_project`, `set_view_terminal`, `set_view_diff`, `refresh_git_info`, `open_ide` |
| Git | `checkout_branch`, `create_branch`, `create_worktree`, `remove_worktree`, `rename_branch`, `rename_worktree` |
| Agents | `list_agents`, `add_agent`, `remove_agent`, `set_project_agent` |
| Terminal | `create_terminal_session`, `close_terminal_session`, `resize_terminal`, `save_session` |
| WSL | 以上对应 `wsl_` 前缀变体 |
| Remote | `test_remote_connection`, `create_remote_terminal_session`, `close_remote_terminal_session`, `open_remote_ide` |

## Acceptance Criteria

- [ ] 测试基础设施搭建完成（vitest + setup + scripts）
- [ ] P0 Utils 100% 覆盖
- [ ] P1 Hooks 核心路径覆盖
- [ ] P2 Hooks 核心 CRUD + 错误路径覆盖
- [ ] `pnpm test:run` 全部通过
- [ ] `pnpm test:coverage` 可正常生成报告
