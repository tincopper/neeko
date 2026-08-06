# 浏览器按项目隔离 - 执行计划

## 阶段 1：后端事件 payload 增加 label

**目标**：让前端能区分事件来自哪个项目的 webview

### 1.1 修改 `on_navigation` 事件 payload

文件：`src-tauri/src/browser/commands.rs`

```rust
// 原：
.on_navigation(move |nav_url| {
    let url_str = nav_url.to_string();
    let _ = app_nav.emit("browser://url-changed", url_str);
    true
})

// 新：
.on_navigation(move |nav_url| {
    let url_str = nav_url.to_string();
    let payload = serde_json::json!({ "label": BROWSER_LABEL, "url": &url_str });
    let _ = app_nav.emit("browser://url-changed", payload);
    true
})
```

### 1.2 修改 `on_page_load` 事件 payload

```rust
// 原：
PageLoadEvent::Finished => {
    let url_str = payload.url().to_string();
    let _ = app_load.emit("browser://page-loaded", url_str);
}

// 新：
PageLoadEvent::Finished => {
    let url_str = payload.url().to_string();
    let payload = serde_json::json!({ "label": BROWSER_LABEL, "url": &url_str });
    let _ = app_load.emit("browser://page-loaded", payload);
}
```

### 1.3 修改 `on_new_window` 事件 payload

```rust
// 原：
let _ = app.emit("browser://open-url", url_str);

// 新：
let payload = serde_json::json!({ "label": BROWSER_LABEL, "url": &url_str });
let _ = app.emit("browser://open-url", payload);
```

### 1.4 修改 `on_navigation` 中的 loading 事件

```rust
PageLoadEvent::Started => {
    let payload = serde_json::json!({ "label": BROWSER_LABEL, "loading": true });
    let _ = app_load.emit("browser://loading", payload);
}
```

**验证**：`cargo check --manifest-path src-tauri/Cargo.toml`

---

## 阶段 2：前端 store 重构为项目级

### 2.1 扩展 `BrowserState` 为项目级 store

文件：`src/shared/store/browserStore.ts`

```typescript
export interface BrowserPanelState {
  label: string;
  url: string;
  isCreated: boolean;
  isLoading: boolean;
}

interface ProjectBrowserStore {
  states: Record<string, BrowserPanelState>;
  getState: (projectId: string) => BrowserPanelState;
  setState: (projectId: string, patch: Partial<BrowserPanelState>) => void;
  removeState: (projectId: string) => void;
  navigateTo: (projectId: string, url: string) => void;
  reset: () => void;
}

const defaultPanelState = (label: string): BrowserPanelState => ({
  label,
  url: '',
  isCreated: false,
  isLoading: false,
});

export const useProjectBrowserStore = create<ProjectBrowserStore>()((set, get) => ({
  states: {},

  getState: (projectId) => {
    const state = get().states[projectId];
    if (state) return state;
    const label = `neeko-browser-${projectId}`;
    const newstate = defaultPanelState(label);
    set((s) => ({ states: { ...s.states, [projectId]: newstate } }));
    return newstate;
  },

  setState: (projectId, patch) => set((s) => ({
    states: {
      ...s.states,
      [projectId]: { ...s.states[projectId], ...patch },
    },
  })),

  removeState: (projectId) => set((s) => {
    const { [projectId]: _, ...rest } = s.states;
    return { states: rest };
  }),

  navigateTo: (projectId, url) => {
    const state = get().getState(projectId);
    get().setState(projectId, { url, isLoading: true, isCreated: state.isCreated || false });
  },

  reset: () => set({ states: {} }),
}));

// 保留旧 store 向后兼容
export const useBrowserStore = useProjectBrowserStore;
```

### 2.2 添加 label 派生工具函数

文件：`src/features/browser/hooks/useBrowserConstants.ts`

```typescript
export const getProjectBrowserLabel = (projectId: string): string =>
  `neeko-browser-${projectId}`;
```

---

## 阶段 3：前端 API 层改造

### 3.1 修改 `browserApi.ts`

文件：`src/features/browser/api/browserApi.ts`

为 `createBrowserWebview`、`browserNavigate`、`browserSetBounds`、`browserOpenDevtools`、`browserClose`、`browserSetVisible`、`browserGoBack`、`browserGoForward`、`browserStartPicker`、`browserStopPicker` 增加 `projectId` 参数，内部派生 label。

```typescript
import { getProjectBrowserLabel } from '../hooks/useBrowserConstants';

export function createBrowserWebview(
  projectId: string,
  url: string,
  x: number, y: number, width: number, height: number,
): Promise<string> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<string>('create_browser_webview', { url, x, y, width, height, label });
}

export function browserNavigate(projectId: string, url: string): Promise<void> {
  const label = getProjectBrowserLabel(projectId);
  return invoke<void>('browser_navigate', { label, url });
}

// ... 其他函数类似改造
```

---

## 阶段 4：Hook 改造

### 4.1 重写 `useBrowserPanel`

文件：`src/features/browser/hooks/useBrowserPanel.ts`

核心改动：
1. 从 `useProjectStore` 订阅 `activeProjectId`
2. 从 `useProjectBrowserStore` 获取当前项目的浏览器状态
3. 所有操作基于 `activeProjectId` 和派生 label
4. 监听 `activeProjectId` 变化，自动 hide 旧项目、show 新项目

```typescript
export function useBrowserPanel({ showToast }: UseBrowserPanelOptions) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const browserState = useProjectBrowserStore((s) => 
    activeProjectId ? s.getState(activeProjectId) : null
  );
  const setState = useProjectBrowserStore((s) => s.setState);
  const removeState = useProjectBrowserStore((s) => s.removeState);

  const label = activeProjectId ? getProjectBrowserLabel(activeProjectId) : null;

  // ... 所有回调使用 activeProjectId + label

  // 监听项目切换
  useEffect(() => {
    if (!activeProjectId) return;
    const prevProjectId = /* 保存上一个 activeProjectId */;
    
    // 隐藏旧项目
    if (prevProjectId && prevProjectId !== activeProjectId) {
      browserSetVisible(getProjectBrowserLabel(prevProjectId), false);
    }
    
    // 显示新项目
    if (browserState?.isCreated) {
      browserSetVisible(getProjectBrowserLabel(activeProjectId), true);
    }
  }, [activeProjectId]);
}
```

### 4.2 更新事件监听

```typescript
listen<{label: string, url: string}>('browser://url-changed', (event) => {
  const { label, url } = event.payload;
  if (label !== currentLabel) return; // 过滤非当前项目事件
  // ... 更新状态
});
```

---

## 阶段 5：组件适配

### 5.1 检查 `BrowserPanel.tsx`

确保组件使用新 hook API，如有旧 store 引用，替换为 `useProjectBrowserStore`。

### 5.2 检查 `BrowserToolbar.tsx`

同上。

---

## 阶段 6：清理

### 6.1 移除旧 store 引用

搜索所有 `import { useBrowserStore }` 并替换为 `useProjectBrowserStore`。

### 6.2 移除旧 `BROWSER_WEBVIEW_LABEL` 引用

搜索 `BROWSER_WEBVIEW_LABEL`，替换为 `getProjectBrowserLabel(projectId)`。

---

## 验收检查

1. `pnpm type-check` 通过
2. `pnpm lint` 通过
3. `cargo check` 通过
4. `pnpm test:run` 通过（如有相关测试）
5. 手动验证：
   - 打开项目 A，浏览器访问 URL_X
   - 切换到项目 B，浏览器访问 URL_Y
   - 切回项目 A，确认仍在 URL_X
   - 确认项目 B 的 webview 被隐藏而非销毁

---

## 回滚计划

若出现问题，可恢复：
1. 事件 payload 改回 string 格式
2. 前端 store 改回全局单 store
3. API 层移除 projectId 参数
4. Hook 恢复硬编码 label

所有改动在同一 PR，可整体 revert。
