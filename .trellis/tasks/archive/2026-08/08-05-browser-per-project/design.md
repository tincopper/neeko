# 浏览器按项目隔离 - 技术设计

## Context

浏览器当前所有项目共用一个 webview + 全局 zustand store。后端 Rust 已按 `label` 参数化，但前端硬编码了单一 label `neeko-browser-panel`。

## Goal

每个项目独立 webview（完整页面状态保留），切换项目时 hide 旧 webview、show 新 webview。

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│                                                         │
│  useProjectStore         projectBrowserStore            │
│  ┌──────────────┐       ┌──────────────────────┐       │
│  │ activeId: A  │       │ projA: {url, label,  │       │
│  │ projects: [] │       │   isCreated, loading} │       │
│  └──────────────┘       │ projB: {url, label,  │       │
│         │               │   isCreated, loading} │       │
│         │ selectProject │ ...                   │       │
│         ▼               └──────────────────────┘       │
│  ┌──────────────────────┐            ▲                  │
│  │   useBrowserPanel    │────────────┘                  │
│  │   (project-aware)    │ subscribes to active          │
│  └──────────────────────┙ project's browser state       │
│         │                                               │
│         │ derive label = `neeko-browser-{projectId}`    │
│         ▼                                               │
│  ┌──────────────────────┐                               │
│  │     browserApi       │  → invoke Rust commands       │
│  │  (projectId-based)   │    with per-project label     │
│  └──────────────────────┘                               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   Backend (Rust)                         │
│                                                         │
│  create_browser_webview(label: "neeko-browser-projA")   │
│  browser_navigate(label, url)                           │
│  browser_set_bounds(label, x, y, w, h)                  │
│  browser_set_visible(label, visible)                    │
│  browser_close(label)                                   │
│                                                         │
│  Events: browser://url-changed                          │
│          browser://page-loaded                          │
│          browser://open-url                             │
│          browser://loading                              │
│          → payload 包含 {label, url}                     │
└─────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Label 格式

```
neeko-browser-{projectId}
```

例如：`neeko-browser-proj-abc123`

- 唯一性：projectId 全局唯一
- 可读性：包含 `neeko-browser` 前缀，便于调试
- 派生规则：纯函数，前端可独立计算，无需后端分配

### 2. 前端 Store 重构

从全局单 store 改为 **项目级 store**：

```typescript
// 新 store 形状
interface ProjectBrowserStore {
  // projectId → 浏览器状态
  states: Record<string, BrowserPanelState>;
  // Actions
  getState: (projectId: string) => BrowserPanelState;
  setState: (projectId: string, patch: Partial<BrowserPanelState>) => void;
  removeState: (projectId: string) => void;
  navigateTo: (projectId: string, url: string) => void;
  reset: () => void;
}
```

每个 `BrowserPanelState` 包含：
```typescript
{
  label: string;        // neeko-browser-{projectId}
  url: string;
  isCreated: boolean;
  isLoading: boolean;
}
```

### 3. Hook 改造

`useBrowserPanel` 从全局 store 订阅改为**订阅当前项目的浏览器状态**：

```typescript
export function useBrowserPanel({ showToast }: UseBrowserPanelOptions) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const browserState = projectBrowserStore.getState(activeProjectId);

  // 派生 label
  const label = activeProjectId ? `neeko-browser-${activeProjectId}` : null;

  // ... 所有操作基于 activeProjectId 和对应 label
}
```

### 4. 项目切换生命周期

当 `activeProjectId` 从 A → B：

1. **离开项目 A**：调用 `browser_set_visible(labelA, false)` 隐藏 webview
2. **进入项目 B**：
   - 若 B 已有 webview（`isCreated`）→ `browser_set_visible(labelB, true)` 显示
   - 若 B 无 webview → 等用户主动操作触发创建

在 `useBrowserPanel` 中通过 `useProjectStore.subscribe` 监听 `activeProjectId` 变化，自动执行上述逻辑。

### 5. 事件过滤

后端事件当前无 label 信息，多个 webview 会互相干扰。

**Rust 端改动**：在事件 payload 中包含 source label。

| 事件 | 原 payload | 新 payload |
|------|-----------|-----------|
| `browser://url-changed` | `url: string` | `{ label: string, url: string }` |
| `browser://page-loaded` | `url: string` | `{ label: string, url: string }` |
| `browser://loading` | `bool` | `{ label: string, loading: bool }` |
| `browser://open-url` | `url: string` | `{ label: string, url: string }` |

前端在事件处理中检查 `payload.label === currentProjectLabel`，仅处理匹配的事件。

### 6. API 层改造

`browserApi.ts` 中的函数需要接受 `projectId` 参数，内部派生 label：

```typescript
function getLabel(projectId: string): string {
  return `neeko-browser-${projectId}`;
}

export function createBrowserWebview(
  projectId: string,  // 新增参数
  url: string,
  x: number, y: number, width: number, height: number,
): Promise<string> {
  return invoke('create_browser_webview', {
    url, x, y, width, height,
    label: getLabel(projectId),  // 派生 label
  });
}
```

对于不关心 projectId 的命令（如 `openInDefault_browser`），保持不变。

## Affected Files

### 前端改动

| 文件 | 改动 |
|------|------|
| `src/shared/store/browserStore.ts` | 扩展为项目级 store（states map） |
| `src/features/browser/hooks/useBrowserPanel.ts` | 改为项目感知，订阅 activeProjectId |
| `src/features/browser/api/browserApi.ts` | 函数签名增加 projectId 参数 |
| `src/features/browser/hooks/useBrowserConstants.ts` | 导出 `getProjectBrowserLabel(projectId)` |
| `src/features/browser/components/BrowserPanel.tsx` | 适配新 hook API（如有变化） |

### 后端改动

| 文件 | 改动 |
|------|------|
| `src-tauri/src/browser/commands.rs` | 事件 payload 增加 label 字段 |

具体事件改动：
- `on_navigation` 闭包捕获 `BROWSER_LABEL`，emit 时包含 label
- `on_page_load` 闭包捕获 `BROWSER_LABEL`，emit 时包含 label
- `on_new_window` 同理

### 不变的部分

- `validate_url_scheme` 校验逻辑
- `browser_navigate`、`browser_set_bounds`、`browser_set_visible`、`browser_close`、`browser_go_back`、`browser_go_forward` 核心逻辑
- 元素 picker 功能（`browser_start_picker`、`browser_stop_picker`）
- URI scheme 处理（`uri_scheme.rs`）

## Data Flow

### 用户在项目 A 中导航

```
用户在 address bar 输入 URL
  → navigate(url)
  → browserApi.browserNavigate(projectId_A, url)
  → invoke('browser_navigate', { label: 'neeko-browser-A', url })
  → Rust: webview_A.navigate(url)
  → on_navigation 触发
  → Rust emit('browser://url-changed', { label: 'neeko-browser-A', url })
  → 前端监听: payload.label === currentLabel → 匹配，更新 store
```

### 切换项目 A → B

```
selectProject(B) [useProjectStore]
  → useProjectStore 订阅者检测到 activeProjectId 变化
  → useBrowserPanel effect:
    1. browser_set_visible(labelA, false)  // 隐藏 A
    2. 检查 projectBrowserStore[B].isCreated:
       - true → browser_set_visible(labelB, true)
       - false → 不操作，等用户触发
  → UI 重新渲染，订阅到 B 的浏览器状态
```

### 事件过滤场景

```
webview_A 正在加载页面
  → Rust emit('browser://page-loaded', { label: 'neeko-browser-A', url })
  → 前端监听:
    payload.label ('neeko-browser-A') === currentLabel ('neeko-browser-B')
    → 不匹配，忽略
  → 正确：B 的浏览器状态不受 A 的影响
```

## Migration / Compatibility

- **向后兼容**：现有单项目场景完全适用，只是 label 从固定值变为派生值
- **无破坏性改动**：Rust 命令签名不变，仅事件 payload 从 string 变为 object
- **渐进式**：可先改前端感知 label，再改事件 payload

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|------|------|------|
| 事件 payload 格式变更导致旧前端不兼容 | 前端必须同步更新 | 同一 PR 交付 |
| 多个 webview 内存占用高 | 低 | 仅当前会话，项目关闭后可考虑销毁 |
| 项目切换时 webview 闪烁 | 中 | hide/show 而非 destroy/create，保持原生窗口稳定 |
