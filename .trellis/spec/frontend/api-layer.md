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
├── library/api/libraryApi.ts    # 资源库 IPC（Prompts + Actions）
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

> **文件命令的地址是一个 `WorkspaceSession` 值对象**（`{ projectId, worktreePath }`，`worktreePath === null` = 主 checkout）：
> `readFileContent(workspace, filePath)` / `writeFileContent(workspace, filePath, content)` / `readDirTree(workspace, subPath?, maxDepth?)`
> 等 8 个包装器（`features/file/api/fileApi.ts`）首参即该地址，**必填**（漏传 = 编译失败）。取当前单元用
> `activeWorkspaceSession(projectId)`（`shared/store/workspaceStore`）。原始 `invoke('read_file_content'|…)`
> 只允许出现在 `fileApi.ts`（护栏 `check_file_io_scope`）；WSL/Remote 与 Local 走同一后端命令
> （按 `ExecTarget` 路由），`ProjectCommands` 不再有文件方法。

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
6. **能力/策略门面不住 `api/`**：带缓存、失效键、或失败口径（如「查不到就当不支持」）的
   「能不能做 X」门面属于**领域策略**，放 `features/<domain>/utils/`，自身 `import`
   对应的 api 薄封装即可。判据：**换掉传输层（IPC → 其它）它是否仍然成立** ——
   成立就不属于 `api/`。
   实例：`features/agent-chat/utils/chatResumeSupport.ts`（2026-10-30）。它一度写在
   `api/` 里，虽然能跑，但让第 4 条判据失真；移动后 `api/` 仍只有薄封装，
   `utils → api` 依赖方向单向。

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

### 在 App 协调层消费（使用 `@/` 别名）

```typescript
// src/app/components/ProjectView.tsx
import { checkAgentsInstalled } from "@/features/agent/api/agentApi";
```

> `layout/` 不得直接 import `@/features/*/api`。协调与 API 消费放在 `app/`。

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
| `features/editor/hooks/useFileView.ts` | `fileApi` |
| `features/editor/hooks/useFileTabRefresh.ts` | `fileApi` |
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
| `features/editor/components/FileViewer.tsx` | `fileApi` |
| `features/editor/components/HtmlPreview.tsx` | `fileApi` |
| `features/editor/components/EditorGroupPane.tsx` | `agentApi` |
| `features/agent/components/AgentBar.tsx` | `agentApi` |
| `features/agent/components/AgentSelector.tsx` | `agentApi`、`sessionApi` |
| `features/editor/hooks/useFileTabRefresh.ts` | `fileApi` |
| `features/task/store.ts` | `taskApi`、`terminalApi` |
| `features/skill/store.ts` | `skillApi`、`fileApi` |
| `features/library/store/libraryStore.ts` | `libraryApi` |
| `features/library/components/PromptListSection.tsx` | `libraryApi` |
| `features/library/components/PromptEditorDialog.tsx` | `libraryApi` |
| `features/terminal/components/terminalLinks.ts` | `fileApi` |

### App 协调层使用的 API

| 组件 | 使用的 API |
|---|---|
| `app/components/ProjectView.tsx` | `agentApi`、`libraryApi`（openLibrary + insertToAgentInput） |
| `app/components/OpenIdeButton.tsx` | `sessionApi` |
| `app/dock/wrappers/FilesPanelWrapper.tsx` | `fileApi` |

---

## 事件监听

对于后端推送的事件，优先走 `shared/hooks/useTauriEvent`（内部是 Tauri 的 `listen`，自动管理
listen/unlisten）。这部分不经过 API wrapper（事件是 Tauri `@tauri-apps/api/event` 的职责），
但**事件名与载荷类型必须来自单一事实源** —— 名字取 `src/shared/events.ts` 的常量，类型取
`src/shared/types/`：

```typescript
import { GIT_CHANGED_EVENT } from "@/shared/events";
import { useTauriEvent } from "@/shared/hooks/useTauriEvent";
import type { GitChangedEvent } from "@/shared/types";

useTauriEvent<GitChangedEvent>(GIT_CHANGED_EVENT, (payload) => {
  console.log("[Git] Changed:", payload.workspace_key);
});
```

> 需要 `unlisten` 精确控制时用 `listen<T>(常量, handler)` 并在 cleanup 里调用返回的 `unlisten`；
> 事件名与类型仍必须来自单一事实源（见下）。

> ⚠️ **禁止手写事件名与载荷类型**（红线 5）。`listen<string>("git-changed")` 这类裸写法不仅绕过了
> 常量源，还会在载荷形状演进时**静默死亡**：`git-changed` 已从裸 `project_id` 字符串改为
> `GitChangedEvent{workspace_key, project_id}`，仍按 `payload !== projectId` 比较的消费点「对象 ≠ 字符串」
> 恒早返回，通道不再触发且不报错。推荐经 `shared/hooks/useTauriEvent` 统一挂载/卸载。

### 项目中使用的事件

| 事件名 | 用途 | 负载类型 |
|--------|------|----------|
| `terminal-input-{id}` | 终端输入（前端 emit） | `number[]` (UTF-8 bytes) |
| `terminal-output-{id}` | 终端输出 | `number[]` |
| `terminal-closed-{id}` | 终端关闭通知 | `null` |
| `git-changed` | Git 状态变更（HEAD 外部变化等主动刷新 fallback） | `GitChangedEvent`（`workspace_key` + `project_id`） |
| `git-status-snapshot` | 单元 status 权威全量快照（按 `workspace_key` 覆盖对应槽） | `GitStatusSnapshot` |
| `file-changed` | 文件内容变更批次（已去抖） | `FileChangedEvent`（`workspace_key` + `project_id` + `paths`） |
| `file-tree-changed` | 文件树结构变更（Create/Remove/Rename） | `FileTreeChangedEvent`（`workspace_key` + `project_id` + `dirs?`） |
| `lsp-diagnostics-{project_path}` | LSP 诊断推送 | `LspDiagnosticsEvent` (uri + diagnostics[]) |

**带 `workspace_key` 的事件，路径基准是「该单元的工作树根」，不是 project 根**：`file-changed` 的
`paths` 与 `file-tree-changed` 的 `dirs` 都由后端 `strip_prefix(repo.work_dir_pathbuf())` 得到
（strip 失败才回退绝对路径）。消费侧归一基准必须同源 —— 用 `workspaceRootOf(workspace_key, projectRoot)`
（主仓单元回落项目登记路径，linked worktree 用后端回传的 canonical 路径），**不能**用 `project.path`：
worktree 视图下把单元相对路径拼到主仓根，同文件判定恒不命中，HTML 预览 / 浏览器 auto-refresh
就不再刷新。详见 `state-management.md` 场景「Workspace分槽 + 激活态单源」第 9 条。

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
| 2026-10-30 | 补原则 6：能力/策略门面放 `features/<domain>/utils/`，不住 `api/`（实例 `chatResumeSupport`） |
| 2026-07-29 | 新增 `libraryApi.ts`（Prompts + Actions IPC） |
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

> 路径已按当前目录更新（该契约写于 2026-04-17，此后 `components/` → `features/`、`types.ts` → `shared/types/`）。
> `RemoteProjectView.tsx` 已不存在（远程项目视图并入统一工作区）。

- `src/features/terminal/components/TerminalView.tsx`
- `src/features/terminal/components/WSLTerminalView.tsx`
- `src/features/terminal/components/RemoteTerminalView.tsx`
- `src/app/components/ProjectView.tsx`
- `src/shared/types/`

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

- Good：`src/features/editor/hooks/__tests__/useSplitLayout.test.ts::splitPane 创建新 pane 并设置为 active`
- Base：`src/features/editor/hooks/__tests__/useSplitLayout.test.ts::layoutId 变化会重置布局`
- Bad：`src/features/editor/hooks/__tests__/useSplitLayout.test.ts::达到上限后 canSplit=false`

### 必测断言点

- pane 数量上限为 4，`canSplit=false` 时按钮禁用
- pane 关闭后 active pane 正确回退
- 缓存前缀清理会删除同项目同 tab 的所有 pane 会话
- `save_session` 不再发送 `side_terminal_width`

### fit / resize 去重的两条正交不变量（2026-09 根因修复）

终端 resize 的唯一入口是 `features/terminal/utils/fitScheduler.ts::createFitScheduler`，
判定状态**必须按终端实例归属**（调度器实例随 cacheKey 新建/销毁），**不得挂在 React
组件的 `useRef` 上跨 tab 存活**。完整契约与事故复盘见该文件顶部 JSDoc，这里只留判据：

| # | 不变量 | 违反后果 |
|---|--------|----------|
| 1 | 新调度器基线为空 → 首次 `fit()` 必同步 PTY | 切回已 fit 过的 tab 时不发 `resize_terminal`，PTY 停在旧网格，agent/vim 按旧宽度重绘 = 「格式混乱，拖一下 panel 才恢复」 |
| 2 | 尺寸命中「已回执 (`lastCols`/`lastRows`)」**或「在途 (`inFlightCols`/`inFlightRows`)」→ 不得重发 | `scheduleFit` 的 RAF 与 120ms trailing 两个 `doFit` 会重复投递同一 resize（慢 IPC 下高频），即 `e9af28e4` 修掉又复发的格式混乱 |

**两条正交，只满足其一都会出 bug。** 特别提醒：不要把「`fit()` 是否改变了本地网格」
（`converged`）当作去重判据 —— 它同时错在两处：作为「无需同步 PTY」的理由是
语义错误（不变量 1），而直接删除又会丢掉它在途去重的作用（不变量 2）。

回归锁定：`features/terminal/utils/__tests__/fitScheduler.test.ts`（"在途 resize 未回执" /
"去重状态按终端归属" 两个用例）与
`features/terminal/components/__tests__/TerminalViewBase.fitScheduler.test.tsx`
（必须用 `rerender` 同一组件实例，两次 `render()` 是两个实例、反而绕开该 bug）。

---

## 场景：本地资产 / 二进制预览的通道契约 2026-10-29

### 1. Scope / Trigger

- Trigger：markdown 图片在 chat / 会话 / PR 渲染点全部 404（未接管 `img`、basePath 时传时不传、
  `data:` URI 被旧正则误拼），远程项目图片与 PDF 完全不可用（asset 协议够不着远程磁盘）。
- Scope：`src/shared/api/fileBytes.ts`（字节通道唯一入口）、`src/shared/utils/localAsset.ts`
  （src 解析唯一入口）、`src/shared/hooks/useAssetUrl.ts`（异步字节通道）、
  `src/shared/hooks/useAssetBasePath.ts`（基准回落）、`src/features/editor/components/pdf/*`、
  `vite.config.ts`（pdf.js 运行时资源直出）。

### 2. Signatures

```typescript
// 同步：src 判定与 URL 派生（唯一入口，渲染点禁止自写路径归一）
export function resolveAssetUrl(src: string, basePath?: string): string
export function normalizeAssetPath(src: string): string   // URL 派生与 IPC 传参共用同一套归一
export function isRemoteAssetSrc(src: string): boolean
export function resolveMarkdownBasePath(explicit, projectRoot): string | undefined

// 异步：字节通道（唯一入口在 shared/api —— 依赖方向 features → shared）
export function readFileBytes(workspace, filePath, o?: { base?, offset?, length? }): Promise<ArrayBuffer>
export function readFileRange(workspace, filePath, r: { base?, begin, end }): Promise<Uint8Array>  // 续读补齐
export function readFileBytesAll(workspace, filePath, o?: { base?, maxBytes? }): Promise<ArrayBuffer>
export function readFileSize(workspace, filePath, o?: { base? }): Promise<number>
export const MAX_ASSET_BYTES: number   // 整读（预览资产）上限，默认 64MB

export function useAssetUrl(src?, basePath?, projectId?): { url, loading, error }
export function useAssetBasePath(explicit?: string): string | undefined
```

后端契约见 `backend/command-guidelines.md`「二进制字节读取的 range 契约」。

### 3. Contracts

1. **通道由消费者类型决定，不由偏好决定**：
   - `<img>`（本地项目）→ asset 协议（`convertFileSrc`，零 IPC）；
   - SSH / WSL 的一切字节 → `shared/api/fileBytes` 二进制流 → `blob:` URL；
   - pdf.js → `PDFDataRangeTransport` + `readFileRange`（续读补齐）。
2. **判定顺序是契约**（`resolveAssetUrl`）：空 → Windows 盘符（`C:/`，**必须先于** scheme 判定，
   因为 `C:` 形似 scheme）→ 协议相对（`//host/…`，与 `<a>` 侧同一规则）→ 通用 scheme
   （`/^[a-z][a-z0-9+.-]+:/i`）→ POSIX 绝对 → 相对拼 basePath → 无 basePath 原样返回。
3. **短读是契约，不是错误**：后端单次只「至多返回」一段字节。需要完整区间时一律用
   `readFileRange` / `readFileBytesAll`（它们按返回长度推进 offset），
   **禁止在消费侧复制后端上界常量**做「够不够 / 要不要报错」判断 —— 抄大了 pdf.js 拿不到
   完整块会永久挂起，抄小了直接误报失败（两种情况都已在真实事故里出现过）。
4. **跨 IPC 传「相对路径 + 基准目录」，前端不拍平绝对路径**：远端（WSL/SSH）的路径语义是
   POSIX，由后端按目标环境语义拼接；前端拼绝对路径会让 Windows 宿主上的远端寻址失效。
5. **blob URL 生命周期归 `useAssetUrl`**：卸载 / 换文件必须 `revokeObjectURL`，否则字节常驻 webview。
6. **`loading` / `error` 一律派生**（请求 key 与当前入参不一致 ⇒ 在飞），不在 effect 体内同步
   `setState`（级联渲染，且切文件会出现一帧旧图）。组件级的「加载失败」同理：记
   「哪个 src/filePath 失败了」再比较，而不是布尔 + 复位 effect。
7. **basePath 缺省回落当前 Workspace 根**（`useActiveWorkspaceRoot`，worktree 感知）：chat 消息 /
   PR 描述没有 md 文件语境，不靠调用方自觉传参。
   **编辑器内的基准同样必须是单元工作树根**，不是 `project.path`：
   图片预览用 `workspaceRootOf(tab.workspace.key, projectPath)`，md/html 预览用
   `editorBasePathOf(workspace.key, projectPath, filePath)`。worktree 里同一相对路径指向
   工作树内的文件，拼主仓根会解析到**另一个文件**（图片 404 / 显示错图）。
8. **字节通道放在 `shared/api/`**，`features/file/api` 不再承载它：`shared/` 消费字节通道不得
   反向依赖 `features/*`（此前用 `import/no-restricted-paths` disable 顶着的写法已废止）。
9. **pdf.js 用 legacy 构建 + 显式资源路径**：现代构建不带 `Map.prototype.getOrInsertComputed` /
   `Promise.withResolvers` 之类新内建的 polyfill，WKWebView / WebKitGTK 上会运行期 `TypeError`
   （打开任何 PDF 都失败）；`cMapUrl` / `standardFontDataUrl` / `wasmUrl` 不配则 CJK 文本缺字、
   标准字体取不到、JPX 图像解不出。资源由 `vite.config.ts` 的 `pdfjsAssets()` 从 node_modules
   直出（dev 中间件 + build emit），挂载点 `/pdfjs/` 与 `usePdfDocument.ts` 的
   `PDFJS_ASSET_BASE` **必须一致**。

### 4. Validation & Error Matrix

| Condition | Expected Behavior | Error / Risk |
|---|---|---|
| `data:` URI + basePath | 原样直通，不改写 | 旧实现会拼进 `convertFileSrc`（已修） |
| 协议相对 `//host/x.png` | 原样直通 | 判成本地路径会让远程项目去读不存在的文件 |
| 本地项目绝对/相对图片 | asset URL 直连，不发 IPC | — |
| SSH/WSL 图片 | `readFileBytesAll` → blob URL | asset 协议物理不可达 |
| 图片 > 单次上界（1MB） | 续读补齐后正常显示 | 逐次请求 + 大小探测，不受单次上界影响 |
| 资产 > `MAX_ASSET_BYTES` | 传输前报错（明确文案） | 静默拉满会把 webview 打爆 |
| 读取中途文件被截断 | `Unexpected end of file at byte N` | 静默返回半截数据更危险 |
| 远程读取越界 / 损坏 | `AppError::File`，UI 显示错误文案 | 静默空数据会被误当空文件 |
| PDF 空文件 / 结构损坏 | 明确错误文案，不崩溃、不无限加载 | 空内容会让 pdf.js 永久等待 |
| 未选中项目 | 渲染期派生错误分支（不在 effect 里 `setState`） | — |

### 5. Good/Base/Bad Cases

- Good：`<MarkdownImage src="img/a.webp" />` —— 本地项目走 asset URL，远程项目自动走 blob。
- Base：`<MarkdownPreview basePath={skillDir} />` —— 显式 basePath 优先于 Workspace 根。
- Bad：在渲染点里写 `convertFileSrc(basePath + '/' + src)`、自定义正则判定 `data:`、
  或把 `basePath + src` 拼成绝对路径再交给 IPC。

### 6. Tests Required

- `shared/api/__tests__/fileBytes.test.ts`：传参形态（相对路径 + base，缺省 null）、
  **短读续读重组区间**、空区间不发请求、EOF 报错、整读的大小探测 + 上限前置失败。
- `shared/utils/__tests__/localAsset.test.ts`：scheme 直通、`data:` 不改写、协议相对、盘符路径
  不被当协议、相对拼 basePath、无 basePath 原样返回、`normalizeAssetPath` 归一。
- `shared/hooks/__tests__/useAssetUrl.test.ts`：本地不触 IPC、远程取字节生成 blob（断言相对路径 +
  base）、反斜杠归一、卸载 revoke、读取失败落 error、空 src 不触发。
- `features/editor/components/pdf/__tests__/pdfRangeTransport.test.ts`：乱序响应不串数据、abort 后不回填、
  `normalizeRange` 边界。
- `features/editor/components/__tests__/PdfFileView.test.tsx`：`disableAutoFetch`、range → `readFileRange`
  `{begin,end}`、只渲染可视页、翻页/缩放/键盘、pdf.js 资源路径、损坏与空文件错误态。

### 7. Wrong vs Correct

#### Wrong
```typescript
// ① 每个渲染点各自拼通道：漏传 basePath ⇒ 404；正则漏掉 data: ⇒ 内联图被改写
function resolveImageSrc(src: string, basePath?: string) {
  if (/^(https?:|data:|blob:|asset:)\/?\//i.test(src)) return src;   // data: 不匹配
  if (!basePath) return src;
  return convertFileSrc(`${basePath}/${src}`);
}

// ② 整读 + 消费侧复制后端上界：>1MB 的图片直接失败
const bytes = await invoke('read_file_bytes', { workspace, filePath });   // 短读未续读

// ③ range 请求静默截断：pdf.js 判该段未满足 ⇒ 永久挂起（既不重试也不报错）
const chunk = await readFileBytes(w, f, begin, Math.min(end - begin, CHUNK));
```

#### Correct
```typescript
const url = resolveAssetUrl(src, basePath);                       // 同步可渲染
const bytes = await readFileBytesAll(w, normalizeAssetPath(src), { base: basePath });
const chunk = await readFileRange(w, filePath, { begin, end });    // 续读补齐，无常量耦合
```
