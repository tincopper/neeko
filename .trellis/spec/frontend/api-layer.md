# API 层

> 前端如何与 Tauri Rust 后端通信。

---

## 概述

本项目没有 HTTP API，所有后端通信通过 **Tauri IPC** 进行。调用方式有两种：
1. **直接调用**：在 hooks/components 中直接使用 `invoke`
2. **适配器模式**：通过 Adapter 类封装（用于统一项目类型）

---

## 直接调用模式

### 基本用法

```typescript
import { invoke } from "@tauri-apps/api/core";

// 调用 Rust 命令
const projects = await invoke<Project[]>("list_projects");
const agents = await invoke<AgentConfig[]>("list_agents");
const gitInfo = await invoke<GitInfo>("refresh_git_info", { projectId });
```

### 类型安全

Tauri 会自动将 camelCase 的 JS 参数转换为 snake_case 的 Rust 参数：

```typescript
// 前端调用
await invoke<Project>("add_project", {
  path: "/path/to/project",
  agentId: null,    // 自动转换为 snake_case: agent_id
  ide: "vscode"    // 自动转换为 snake_case: ide
});

// 等价 Rust 调用
#[tauri::command]
fn add_project(path: String, agent_id: Option<String>, ide: Option<String>) { ... }
```

### 错误处理

所有命令返回 `Result<T, String>`，前端需要处理错误：

```typescript
try {
  const project = await invoke<Project>("add_project", { path, agentId, ide });
} catch (e) {
  console.error("[AddProject] Failed:", e);
  showToast("Failed to add project: " + e, "error");
}
```

---

## 调用分布

### Hooks 层调用

| Hook | 调用的命令 |
|------|-----------|
| `useLocalProjects.ts` | `list_projects`, `add_project`, `remove_project` |
| `useAppConfig.ts` | `load_config`, `save_config` |
| `useSessionBootstrap.ts` | `load_session` |
| `useWslActions.ts` | `refresh_wsl_git_info` |
| `useRemoteActions.ts` | `refresh_remote_git_info` |

### Components 层调用

| 组件 | 调用的命令 |
|------|-----------|
| `TerminalView.tsx` | `create_terminal_session`, `get_agent` |
| `WSLTerminalView.tsx` | `create_wsl_terminal_session`, `get_agent` |
| `RemoteTerminalView.tsx` | `create_remote_terminal_session`, `get_agent` |
| `DiffView.tsx` | `get_file_diff_command`, `get_wsl_file_diff_command`, `get_remote_file_diff_command` |
| `WSLDialog.tsx` | `get_wsl_distros`, `get_wsl_directories`, `get_wsl_home_dir` |
| `RemoteDialog.tsx` | `list_remote_directories` |
| `SettingsPanel.tsx` | `get_system_fonts` |
| `AgentSelector.tsx` | `list_agents` |

---

## 适配器模式

对于需要统一处理 local/wsl/remote 三种项目类型的场景，使用 Adapter 模式：

```
src/adapters/
├── ProjectAdapter.ts      # 基类接口
├── LocalProjectAdapter.ts # 本地项目适配器
├── WslProjectAdapter.ts   # WSL 项目适配器
└── RemoteProjectAdapter.ts # SSH 项目适配器
```

### 适配器接口

```typescript
// src/adapters/ProjectAdapter.ts
export interface ProjectAdapter {
  type: 'local' | 'wsl' | 'remote';
  getProjects(): UnifiedProject[];
  selectProject(projectId: string): void;
  refreshGit(projectId: string): Promise<void>;
  openIde(projectId: string, ide: string): Promise<void>;
  // ...
}
```

### 使用方式

```typescript
// 在 useUnifiedProjects hook 中
const localAdapter = new LocalProjectAdapter(localProjects, ...);
const wslAdapter = new WslProjectAdapter(wslEntries, ...);
const remoteAdapter = new RemoteProjectAdapter(remoteEntries, ...);

// 统一接口
const allProjects = [
  ...localAdapter.getProjects(),
  ...wslAdapter.getProjects(),
  ...remoteAdapter.getProjects()
];
```

---

## 事件监听

对于后端推送的事件，使用 Tauri 的 `listen`：

```typescript
import { listen } from "@tauri-apps/api/event";

useEffect(() => {
  const unlisten = listen<string>("git-changed", (event) => {
    console.log("[Git] Changed:", event.payload);
    // 触发 Git 信息刷新
  });

  return () => {
    unlisten.then(fn => fn());
  };
}, []);
```

### 项目中使用的事件

| 事件名 | 用途 | 负载类型 |
|--------|------|----------|
| `terminal-output-{id}` | 终端输出 | `string` |
| `git-changed` | Git 状态变更 | `string` (projectId) |

---

## 命名约定

| 项目 | 约定 | 示例 |
|------|------|------|
| 命令名 | snake_case | `list_projects`, `add_project` |
| 事件名 | kebab-case 带 ID 后缀 | `terminal-output-{id}` |
| 前端调用 | camelCase 参数 | `{ agentId, projectPath }` |
| Rust 参数 | snake_case | `agent_id`, `project_path` |

---

## 常见错误

### 1. 忘记类型参数

```typescript
// 错误 —— any 类型
const projects = await invoke("list_projects");

// 正确 —— 明确返回类型
const projects = await invoke<Project[]>("list_projects");
```

### 2. 参数命名不匹配

```typescript
// 前端
await invoke("add_project", { projectPath: "/path" });  // 错误

// 正确 —— 转换后的 snake_case
await invoke("add_project", { path: "/path" });
```

### 3. 没有处理错误

```typescript
// 错误 —— 假设调用一定成功
const result = await invoke("some_command");

// 正确 —— try/catch
try {
  const result = await invoke("some_command");
} catch (e) {
  console.error("[Command] Failed:", e);
}
```

### 4. 事件监听未清理

```typescript
// 错误 —— 内存泄漏
useEffect(() => {
  listen("event", handler);  // 没有返回清理函数
}, []);

// 正确
useEffect(() => {
  const unlisten = listen("event", handler);
  return () => { unlisten.then(fn => fn()); };
}, []);
```

---

## 可选：Services 层模式

> 以下是 Tauri 社区推荐模式，本项目当前未采用，仅供参考。

一些项目会创建 `services/` 目录集中封装 `invoke` 调用：

```
src/services/
├── project.ts    # 项目相关命令
├── terminal.ts   # 终端相关命令
├── git.ts        # Git 相关命令
└── index.ts      # 导出
```

```typescript
// services/project.ts
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../types";

export const projectService = {
  list: () => invoke<Project[]>("list_projects"),
  add: (path: string, agentId?: string, ide?: string) =>
    invoke<Project>("add_project", { path, agentId, ide }),
  remove: (id: string) => invoke("remove_project", { id }),
};
```

**本项目选择直接调用**的原因：
- 命令数量适中（~50 个）
- 调用集中在 hooks 中，组件层调用较少
- 直接调用更直观，减少额外抽象层

如果项目规模增长，可考虑重构为 services 模式。

---

## 相关文档

- [Hook 指南](../frontend/hook-guidelines.md)
- [Tauri v2 invoke API](https://tauri.app/v2/api/js/core/#invoke)
- [Tauri v2 listen API](https://tauri.app/v2/api/js/event/#listen)