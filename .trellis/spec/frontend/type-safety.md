# 类型安全

> 本项目中的类型安全模式。

---

## 概述

项目使用 **TypeScript 5.3+**，启用**严格模式**。类型集中在 `src/types.ts` 中。类型与 Rust 后端结构体保持镜像——手动同步（没有自动生成）。

---

## 类型组织

### `src/types.ts` 中的集中共享类型

| 类型 | 领域 |
|------|------|
| `AppConfig`、`DiffMode` | 应用配置 |
| `Project` | 本地项目模型 |
| `AgentConfig` | Agent 定义 |
| `FileChange`、`GitInfo`、`Worktree` | Git 领域 |
| `WSLProject`、`WSLEntrySession` | WSL 领域 |
| `RemoteProject`、`RemoteEntrySession`、`AuthMethod` | SSH 领域 |
| `TerminalEntry` | 终端类型的可辨识联合 |

### 组件本地类型

Props 接口定义在**组件同一文件中**，不放在 `types.ts`：

```tsx
// 在 MyComponent.tsx 中
interface MyComponentProps {
  project: Project;     // 领域类型——从 types.ts 导入
  isActive: boolean;    // 组件特有的 prop
  onSelect: () => void; // 回调 prop
}
```

### Hook 本地类型

仅在 Hook 内部使用的类型定义在 Hook 文件中：

```tsx
// 在 useWorktreeState.ts 中
export interface WorktreeItem {
  path: string;
  branch: string;
}

interface WorktreeState {
  activePath: string | null;
  activeBranch: string;
  opened: WorktreeItem[];
}
```

仅在外部消费者需要时导出类型（如 `WorktreeItem` 被导出，`WorktreeState` 不导出）。

---

## 校验

### 没有运行时校验库

不使用 Zod、Yup 等。从后端加载持久化数据时进行手动运行时校验：

```tsx
// src/hooks/useAppConfig.ts —— 逐字段手动校验
const saved = await invoke<Record<string, any>>("load_config");
if (saved && typeof saved === "object") {
  setConfig({
    fontSize: typeof saved.fontSize === "number" ? saved.fontSize : DEFAULT_CONFIG.fontSize,
    diffMode: saved.diffMode === "split" ? "split" : "unified",
    shell: typeof saved.shell === "string" ? saved.shell : DEFAULT_CONFIG.shell,
    // ... 每个字段与默认值对比校验
  });
}
```

这种模式确保在添加新配置字段时的向后兼容性。

---

## 常见模式

### 可辨识联合

用于行为取决于类型标签的多态类型：

```tsx
// src/types.ts
export type TerminalEntry =
  | { type: 'local'; project: Project }
  | { type: 'wsl'; distro: string; project: WSLProject }
  | { type: 'remote'; host: string; project: RemoteProject };

// 使用 —— 穷举 switch
function getProjectName(entry: TerminalEntry): string {
  switch (entry.type) {
    case 'local': return entry.project.name;
    case 'wsl': return entry.project.name;
    case 'remote': return entry.project.name;
  }
}
```

### 标签枚举类型（字符串字面量）

```tsx
export type DiffMode = "unified" | "split";

// 在接口中
status: "Idle" | "Running" | "Failed";
status: "Modified" | "Added" | "Deleted" | "Renamed" | "Untracked";
```

### 带类型的 Tauri invoke

始终为 `invoke` 提供泛型类型参数：

```tsx
const gitInfo = await invoke<GitInfo>("get_git_info", { path: projectPath });
const config = await invoke<AppConfig>("load_config");
```

### Record 类型用于映射型数据

```tsx
// 在 AppConfig 中
ideCommandOverrides: Record<string, string>;
agentCommandOverrides: Record<string, string>;

// 在 Hooks 中
type WorktreeStateMap = Record<string, WorktreeState>;
```

---

## Tauri 前后端类型同步

`src/types.ts` 中的类型必须手动匹配 `src-tauri/` 中的 Rust `serde` 结构体。没有自动类型生成工具。

**修改 Tauri 命令返回类型时：**
1. 更新 `src-tauri/` 中的 Rust 结构体
2. 更新 `src/types.ts` 中对应的接口
3. 用 `pnpm tsc --noEmit` 和 `cargo check` 验证

### 层间命名约定

| Rust（snake_case） | TypeScript（snake_case） | 说明 |
|-------------------|------------------------|------|
| `current_branch: String` | `current_branch: string` | TS 通过 serde 镜像 Rust 命名 |
| `is_clean: bool` | `is_clean: boolean` | |
| `changed_files: Vec<FileChange>` | `changed_files: FileChange[]` | |

注意：TypeScript 接口使用 **snake_case** 字段名（匹配 Rust serde 输出），而非 camelCase。

---

## 禁止模式

### 1. 无理由使用 `any`

```tsx
// 错误
const data: any = await invoke("load_session");

// 正确
const data = await invoke<SessionData>("load_session");

// 可接受（仅当后端数据结构确实是动态的）
const saved = await invoke<Record<string, any>>("load_config");
// 后接手动字段校验
```

### 2. 本地重复声明共享类型

```tsx
// 错误 —— TitleBar.tsx 重新声明了自己的 Project 接口
interface Project {
  id: string;
  name: string;
  path: string;
  // ... 不完整的拷贝
}

// 正确 —— 从 types.ts 导入
import { Project } from "../../types";
```

### 3. 用类型断言（`as`）绕过类型错误

```tsx
// 错误
const project = data as Project;

// 正确 —— 使用类型守卫或正确的类型标注
if (isProject(data)) {
  const project = data;
}
```

### 4. 无明确理由使用非空断言（`!`）

```tsx
// 错误
const name = project!.name;

// 正确 —— 处理 null 情况
const name = project?.name ?? "Unknown";
```
