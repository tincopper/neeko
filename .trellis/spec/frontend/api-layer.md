# API 层

> 前端如何与 Tauri Rust 后端通信。

---

## 概述

本项目没有 HTTP API，所有后端通信通过 **Tauri IPC** 进行。项目采用 **Feature API Wrapper** 模式组织所有 IPC 调用：

1. **API Wrapper 模式（当前标准）**：每个 feature 域有一个 `<domain>Api.ts` 文件，集中封装 `invoke` 调用
2. **直接调用（仅限 api/ 目录内部）**：`invoke` 只在 `api/` 文件中使用

---

## Feature API Wrapper 模式

### 目录结构

```
src/features/
├── agent/api/agentApi.ts        # Agent 相关 IPC
├── browser/api/browserApi.ts    # 浏览器相关 IPC
├── connection/api/connectionApi.ts  # SSH/WSL 连接相关 IPC
├── file/api/fileApi.ts          # 文件读写相关 IPC
├── git/api/gitApi.ts            # Git 操作相关 IPC
├── project/api/projectApi.ts    # 项目管理相关 IPC
├── session/api/sessionApi.ts    # 会话持久化相关 IPC
├── settings/api/settingsApi.ts  # 设置相关 IPC
├── skill/api/skillApi.ts        # Skill 相关 IPC
├── task/api/taskApi.ts          # Task 相关 IPC
├── terminal/api/terminalApi.ts  # 终端相关 IPC
├── theme/api/themeApi.ts        # 主题相关 IPC
└── lsp/api/lspApi.ts            # LSP 代码智能 IPC（6 个命令）
```

### 标准文件结构

```typescript
// src/features/project/api/projectApi.ts
import { invoke } from '@tauri-apps/api/core';
import type { Project } from '../types';

export function addProject(path: string, agentId?: string | null, ide?: string | null, avatarColor?: string | null): Promise<Project> {
  return invoke<Project>('add_project', { path, agentId, ide, avatarColor });
}

export function listProjects(): Promise<Project[]> {
  return invoke<Project[]>('list_projects');
}

export function removeProject(projectId: string): Promise<void> {
  return invoke<void>('remove_project', { projectId });
}
```

> ⚠️ `invoke` **只允许**在 `api/` 目录内的文件导入。外部文件（hooks、components、store）必须通过 API wrapper 调用。
>
> **例外：`invoke` 再导出**。`src/features/connection/api/connectionApi.ts` 同时再导出 `invoke` 本身，供 `features/terminal/strategies/` 等非组件脚本文件（无法 import API wrapper）使用。此模式仅限确需直接调用 `invoke` 的策略/脚本层使用，且必须通过 `connectionApi` 这一已知中介再导出，不得随意新增 `invoke` 直接导入点。

### 命名约定

| 项目 | 约定 | 示例 |
|------|------|------|
| API 文件名 | `<domain>Api.ts` | `projectApi.ts`、`gitApi.ts` |
| 函数名 | camelCase，动宾结构 | `addProject`、`stageFiles` |
| 命令名 | snake_case（Rust 约定） | `list_projects`、`refresh_git_info` |
| 函数签名 | camelCase 参数，自动转 snake_case | `{ agentId, projectPath }` |
| Rust 参数 | snake_case | `agent_id`、`project_path` |

### API 函数设计原则

1. **每个函数对应一个 Tauri 命令**，函数名使用动宾结构的 camelCase
2. **函数签名使用 camelCase 参数**（Tauri 自动转换为 Rust 的 snake_case）
3. **始终提供泛型返回类型**，不使用 `any`
4. **函数仅做 invoke 封装**，不包含业务逻辑、错误处理或状态管理
5. **相同的 Rust 命令只在一个 API 文件中暴露**，不重复包装

### 跨 domain 类型依赖

某些 API 文件需要引用其他 domain 的类型：

```typescript
// src/features/git/api/gitApi.ts
import type { FileNode, FileContent } from '../../file/types';

// src/features/project/api/projectApi.ts
import type { GitInfo } from '@/features/git/types';
```

允许使用 `@/` 别名或相对路径从其他 feature domain 导入类型。

---

## 消费方式

### 在 Feature 内部消费（使用相对路径）

```typescript
// src/features/project/hooks/useLocalProjects.ts
import { addProject, removeProject, listProjects } from "../api/projectApi";
import { listAgents } from "../../agent/api/agentApi";
import { getWorktreeChangedFiles } from "../../git/api/gitApi";
```

### 在 Layout 层消费（使用 `@/` 别名）

```typescript
// src/layout/MainContent.tsx
import { checkAgentsInstalled } from "@/features/agent/api/agentApi";
```

### 错误处理

所有 API 函数的错误由调用方（hooks / components）通过 try/catch 处理：

```typescript
try {
  const project = await addProject("/path/to/project", agentId);
} catch (e) {
  console.error("[AddProject] Failed:", e);
  showToast("Failed to add project: " + e, "error");
}
```

日志前缀格式统一为 `[模块名]`。

---

## ESLint 约束

`.eslintrc.cjs` 中配置了 `no-restricted-imports` 规则，禁止在 `api/` 目录之外直接导入 `@tauri-apps/api/core`：

```javascript
'no-restricted-imports': [
  'error',
  {
    paths: [
      {
        name: '@tauri-apps/api/core',
        importNames: ['invoke'],
        message: 'Use the feature-specific API wrapper (e.g. projectApi.openIde) instead of invoke directly.',
      },
    ],
    patterns: [
      {
        group: ['@tauri-apps/api/core'],
        message: 'Use the feature-specific API wrapper instead of importing from @tauri-apps/api/core directly.',
      },
    ],
  },
],
```

违反规则会触发 ESLint error，提示使用对应的 API wrapper。

> **注**：ESLint config 中的 `no-restricted-imports` 已同时为 `.tsx` 和 `.ts` override 块配置为 `'error'`。`api/` 目录（`src/features/*/api/*.ts` 及 `src/app/*/api/*.ts`）通过 override 豁免此约束。

---

## 多 transport 命令模式

部分 Rust 命令（尤其是 Git 和文件操作）需要根据 context（local / WSL / SSH）传入不同的 transport 信息。API 文件中需要同时定义 Transport 类型：

```typescript
// src/features/git/api/gitApi.ts
export interface LocalTransport {
  Local: { project_path: string };
}
export interface WslTransport {
  Wsl: { distro: string; project_path: string };
}
export interface RemoteTransport {
  Remote: {
    host: string; port: number; username: string;
    auth: { Password: string } | { KeyFile: string } | { KeyFileWithPassphrase: { ... } };
    project_path: string;
  };
}

export type GitTransportKind = LocalTransport | WslTransport | RemoteTransport;
export type FileTransportKind = FileTransportLocal | FileTransportWsl | FileTransportRemote;

export function getGitInfo(transport: GitTransportKind): Promise<GitInfo> {
  return invoke<GitInfo>('get_git_info', { transport });
}
```

`FileTransportKind` 定义在 `src/features/git/api/gitApi.ts` 中，与 `file/` domain 共享。

---

## 调用分布（当前状态）

> 以下列出各 layer 使用的 API wrapper，而非直接调用的 Rust 命令名。

### Feature hooks 使用的 API

| Hook 文件 | 使用的 API |
|---|---|
| `features/project/hooks/useLocalProjects.ts` | `projectApi`、`agentApi`、`sessionApi`、`gitApi` |
| `features/settings/hooks/useAppConfig.ts` | `settingsApi` |
| `features/session/hooks/useSessionBootstrap.ts` | `sessionApi`、`projectApi`、`gitApi` |
| `features/session/hooks/useSessionPersistence.ts` | `sessionApi` |
| `features/connection/hooks/useWslActions.ts` | `projectApi`、`gitApi` |
| `features/connection/hooks/useRemoteActions.ts` | `projectApi` |
| `app/editor/hooks/useFileView.ts` | `fileApi` |
| `app/editor/hooks/useFileTabRefresh.ts` | `fileApi` |
| `features/agent/hooks/useAgentActions.ts` | `projectApi` |
| `features/agent/hooks/useAgentClickHandler.ts` | `agentApi` |
| `features/browser/hooks/useBrowserPicker.ts` | `browserApi` |
| `features/browser/hooks/useBrowserPanel.ts` | `browserApi` |
| `features/skill/hooks/useMarketplace.ts` | `skillApi` |
| `features/project/hooks/useWorktreeActions.ts` | `projectApi` |
| `features/project/hooks/useProjectSelection.ts` | `projectApi` |

### Feature components 使用的 API

| 组件 | 使用的 API |
|---|---|
| `features/settings/components/SettingsView.tsx` | `agentApi` |
| `features/settings/components/SettingsPanel.tsx` | `agentApi` |
| `features/settings/components/ProjectPanel.tsx` | `projectApi`、`agentApi` |
| `features/settings/components/useSettingsPanelState.ts` | `agentApi`、`settingsApi` |
| `features/terminal/components/terminalCache.ts` | `agentApi`、`terminalApi` |
| `features/terminal/components/terminalFactory.ts` | `terminalApi`、`agentApi` |
| `features/terminal/components/terminalCommands.ts` | `terminalApi`、`agentApi` |
| `features/terminal/strategies/local.ts` | `terminalApi` |
| `features/terminal/strategies/wsl.ts` | `terminalApi` |
| `features/terminal/strategies/remote.ts` | `terminalApi` |
| `features/git/components/GitDialog.tsx` | `gitApi`、`connectionApi` |
| `features/git/components/CommitDialog.tsx` | `gitApi` |
| `features/git/components/PullRequestsPanel.tsx` | `gitApi`、`sessionApi` |
| `features/git/components/diff/useDiffData.ts` | `gitApi` |
| `features/connection/components/WSLDialog.tsx` | `connectionApi` |
| `features/connection/components/RemoteDialog.tsx` | `connectionApi` |
| `features/connection/components/RemoteAuthDialog.tsx` | `connectionApi` |
| `features/connection/components/ConnectionProjectCard.tsx` | `gitApi` |
| `features/project/components/ProjectsPanel.tsx` | `gitApi` |
| `features/project/components/ProjectSettingsDialog.tsx` | `projectApi`、`agentApi` |
| `features/project/components/ProjectItem.tsx` | `projectApi` |
| `features/project/components/WorktreeList.tsx` | `gitApi`、`terminalApi` |
| `app/editor/components/FileViewer.tsx` | `fileApi` |
| `app/editor/components/HtmlPreview.tsx` | `fileApi` |
| `app/editor/components/EditorGroupPane.tsx` | `agentApi` |
| `features/agent/components/AgentBar.tsx` | `agentApi` |
| `features/agent/components/AgentSelector.tsx` | `agentApi`、`sessionApi` |
| `app/editor/hooks/useFileTabRefresh.ts` | `fileApi` |
| `features/task/store.ts` | `taskApi`、`terminalApi` |
| `features/skill/store.ts` | `skillApi`、`fileApi` |
| `features/terminal/components/terminalLinks.ts` | `fileApi` |

### Layout 层使用的 API

| 组件 | 使用的 API |
|---|---|
| `layout/MainContent.tsx` | `agentApi` |
| `layout/OpenIdeButton.tsx` | `sessionApi` |
| `layout/DockLayout/DockPanelWrappers.tsx` | `fileApi` |

---

## 事件监听

对于后端推送的事件，使用 Tauri 的 `listen`。这部分不经过 API wrapper（事件是 Tauri `@tauri-apps/api/event` 的职责）：

```typescript
import { listen } from "@tauri-apps/api/event";

useEffect(() => {
  const unlisten = listen<string>("git-changed", (event) => {
    console.log("[Git] Changed:", event.payload);
  });

  return () => { unlisten.then(fn => fn()); };
}, []);
```

### 项目中使用的事件

| 事件名 | 用途 | 负载类型 |
|--------|------|----------|
| `terminal-input-{id}` | 终端输入（前端 emit） | `number[]` (UTF-8 bytes) |
| `terminal-output-{id}` | 终端输出 | `number[]` |
| `terminal-closed-{id}` | 终端关闭通知 | `null` |
| `git-changed` | Git 状态变更 | `string` (projectId) |
| `lsp-diagnostics-{project_path}` | LSP 诊断推送 | `LspDiagnosticsEvent` (uri + diagnostics[]) |

---

## 场景：终端 IME 输入单一状态机契约（xterm.js owning composition）

### 1. Scope / Trigger
- Trigger: 终端输入链路属于跨层契约（xterm.js DOM 输入层 -> 前端 IPC 层 -> Rust PTY 写入层），且本次修复涉及输入行为与事件负载约束。
- Scope: `terminalFactory.ts`、`WSLTerminalView.tsx`、`RemoteTerminalView.tsx` 的输入转发路径统一到 `terminalInput.ts`。

### 2. Signatures
- Frontend helper signature:

```typescript
export function setupTerminalInput({
  term,
  sendInput,
}: {
  term: Terminal;
  sendInput: (text: string) => void;
}): { dispose: () => void }
```

- IPC event signatures:
  - Input: `emit("terminal-input-{sessionId}", bytes: number[])`
  - Output: `listen<number[]>("terminal-output-{sessionId}", ...)`
  - Closed: `listen<null>("terminal-closed-{sessionId}", ...)`

- Backend command signatures（调用面不变）:
  - `create_terminal_session(projectId, cols, rows, shell?, workingDir?)`
  - `create_wsl_terminal_session(distro, projectPath, cols, rows)`
  - `create_remote_terminal_session(host, port, username, auth, projectPath, cols, rows)`

### 3. Contracts
- Request fields:
  - `terminal-input-{sessionId}` payload 必须为 UTF-8 编码后的 `number[]`（`TextEncoder` 结果）。
  - `sendInput(text)` 只接收原始终端文本，不做应用层 composition 拆分。
- Response fields:
  - `terminal-output-{sessionId}` payload 为 `number[]`（原始字节流）；由视图层写入 xterm。
  - `terminal-closed-{sessionId}` payload 为 `null`，用于销毁缓存与触发重建。
- Environment keys:
  - 前端无新增 env key。
- Ownership contract:
  - IME `compositionstart/update/end` 生命周期只由 xterm.js 内部 `CompositionHelper` 管理。
  - 应用层禁止维护第二套 `isComposing/compositionPendingText` 状态机。

### 4. Validation & Error Matrix
| Condition | Expected Behavior | Error / Risk |
|---|---|---|
| `term.onData` 触发普通字符 | 立即 `sendInput(data)` | 无 |
| 用户使用中文 IME 输入并上屏 | 由 xterm.js 统一提交一次 | 应用层再做去重可能导致重复上屏 |
| 用户切换中英文（Shift） | 不出现额外延迟，不重复提交上一段中文 | 双状态机会导致重复输入/卡顿 |
| `dispose()` 后收到旧事件 | 不再转发输入 | 未释放会造成内存泄漏/重复写入 |

### 5. Good/Base/Bad Cases
- Good: 使用 `setupTerminalInput` 仅转发 `onData`，不监听 `composition*`。
- Base: 英文输入、退格、回车在 local/WSL/remote 三类终端行为一致。
- Bad: 在组件层加 `isComposing`、`compositionPendingText`、fake `compositionend`、超时补丁。

### 6. Tests Required (with assertion points)
- Unit（前端 helper）:
  - 断言 `term.onData("abc")` 时调用一次 `sendInput("abc")`。
  - 断言 `dispose()` 后不再调用 `sendInput`。
- Integration（TerminalView/WSL/Remote）:
  - 断言三类终端都通过 `setupTerminalInput` 建立输入链路。
  - 断言 payload 使用 `TextEncoder` 转为 `number[]` 后发送到 `terminal-input-{sessionId}`。
- Manual regression（macOS + 微信输入法）:
  - Case A: 输入 `啊啊啊啊啊` -> Shift 切英文 -> 输入 `aa`，断言无重复中文、无 1-2 秒卡顿。
  - Case B: 中文连续上屏 + 回车，断言仅提交一次。

### 7. Wrong vs Correct
#### Wrong
```typescript
// 组件层自行维护 composition 状态机（禁止）
let isComposing = false;
let compositionPendingText = "";
textarea.addEventListener("compositionstart", ...);
textarea.addEventListener("compositionend", ...);
term.onData((data) => {
  if (isComposing) return;
  if (compositionPendingText === data) return;
  sendInput(data);
});
```

#### Correct
```typescript
export function setupTerminalInput({ term, sendInput }: {
  term: Terminal;
  sendInput: (text: string) => void;
}) {
  const disposable = term.onData((data) => {
    sendInput(data);
  });

  return { dispose: () => disposable.dispose() };
}
```

---

## 命名约定（汇总）

| 项目 | 约定 | 示例 |
|------|------|------|
| 命令名 | snake_case | `list_projects`, `add_project` |
| 事件名 | kebab-case 带 ID 后缀 | `terminal-output-{id}` |
| API 函数名 | camelCase | `addProject`、`listProjects` |
| API 文件名 | `<domain>Api.ts` | `projectApi.ts`、`gitApi.ts` |
| 前端参数 | camelCase | `{ agentId, projectPath }` |
| Rust 参数 | snake_case | `agent_id`, `project_path` |

---

## 常见错误

### 1. 在 api/ 目录外直接使用 `invoke`

```typescript
// 错误 —— 在 hook 中直接 import invoke
import { invoke } from "@tauri-apps/api/core";
const projects = await invoke<Project[]>("list_projects");

// 正确 —— 通过 API wrapper
import { listProjects } from "../api/projectApi";
const projects = await listProjects();
```

### 2. 忘记类型参数

```typescript
// 错误 —— any 类型
export function listProjects() {
  return invoke("list_projects");  // 返回 Promise<any>
}

// 正确 —— 明确返回类型
export function listProjects(): Promise<Project[]> {
  return invoke<Project[]>("list_projects");
}
```

### 3. 参数命名不匹配（在 API 文件内）

```typescript
// 错误 —— 前端参数名不匹配 Rust 期望的 snake_case 转换
export function addProject(projectPath: string) {
  return invoke("add_project", { projectPath });  // 应为 path
}

// 正确
export function addProject(path: string) {
  return invoke("add_project", { path });
}
```

### 4. 在纯展示组件中 import invoke

纯展示组件（如 `SessionRow`）不应 import 任何 Tauri API，包括 API wrapper。数据通过 Props 传入，动作通过回调 Props 传入。

### 5. 事件监听未清理

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

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-05-30 | 重写为 Feature API Wrapper 模式文档（从直接调用迁移） |
| 2026-05-06 | `src/adapters/` 移除记录 |
| 2026-04-17 | 终端分屏 IPC 契约添加 |
| 2026-04-14 | 初始文档 |

---

## 相关文档

- [目录结构](../frontend/directory-structure.md)
- [质量指南](../frontend/quality-guidelines.md)
- [Hook 指南](../frontend/hook-guidelines.md)
- [类型安全](../frontend/type-safety.md)
- [Tauri v2 invoke API](https://tauri.app/v2/api/js/core/#invoke)
- [Tauri v2 listen API](https://tauri.app/v2/api/js/event/#listen)

---

## 终端分屏 IPC 契约 2026-04-17

### 变更文件

- `src/components/terminal/TerminalView.tsx`
- `src/components/terminal/WSLTerminalView.tsx`
- `src/components/terminal/RemoteTerminalView.tsx`
- `src/components/MainContent.tsx`
- `src/components/RemoteProjectView.tsx`
- `src/types.ts`

### 会话键契约

分屏后每个 pane 对应独立会话键：

| 终端类型 | 键格式 |
|------|------|
| Local | `${projectId}:${tabId}:${paneId}` |
| WSL | `wsl:${distro}:${projectId}${cacheKeySuffix}:${paneId}` |
| Remote | `remote:${entryId}:${projectId}${cacheKeySuffix}:${paneId}` |

### 命令调用契约

- Local 新建会话：`create_terminal_session`
  - 参数：`projectId`、`cols`、`rows`、`shell`、`workingDir`
- WSL 新建会话：`create_wsl_terminal_session`
  - 参数：`distro`、`projectPath`、`cols`、`rows`
- Remote 新建会话：`create_remote_terminal_session`
  - 参数：`host`、`port`、`username`、`auth`、`projectPath`、`cols`、`rows`

### 校验与错误矩阵

| 场景 | 输入 | 期望行为 | 错误处理 |
|------|------|----------|----------|
| Good | pane 初次创建 | 显示 `Connecting...`，会话建立后挂载 xterm | 无 |
| Base | 切换 tab 或重新挂载 | 复用缓存并重新 `fit + resize` | 无 |
| Bad | `invoke` 创建会话失败 | 保持 pane 可见并显示失败消息 | 终端输出 `Failed to connect` |
| Bad | 分屏超上限 4 | split 按钮禁用 | 前端阻断操作 |

### Good/Base/Bad 用例

- Good：`src/hooks/__tests__/useSplitLayout.test.ts::splitPane 创建新 pane 并设置为 active`
- Base：`src/hooks/__tests__/useSplitLayout.test.ts::layoutId 变化会重置布局`
- Bad：`src/hooks/__tests__/useSplitLayout.test.ts::达到上限后 canSplit=false`

### 必测断言点

- pane 数量上限为 4，`canSplit=false` 时按钮禁用
- pane 关闭后 active pane 正确回退
- 缓存前缀清理会删除同项目同 tab 的所有 pane 会话
- `save_session` 不再发送 `side_terminal_width`
