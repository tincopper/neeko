# Mock 策略

> 前后端测试中如何 mock 外部依赖。

---

## 概述

Mock 边界原则：**在系统边界处 mock，而非内部逻辑**。

| 层 | 要 mock 的边界 | 工具 |
|----|---------------|------|
| 前端 | Tauri IPC（`invoke`、`listen`、`emit`） | `vi.mock` |
| 前端 | 浏览器 API（window、xterm.js canvas） | `vi.mock` / jsdom |
| 后端 | 文件系统 | `tempfile`（真实临时目录，不是 mock） |
| 后端 | Git | 真实临时仓库（不是 mock） |
| 后端 | Tauri 运行时 | 直接测试 Manager（绕过命令） |

---

## 前端 Mock

### 1. Tauri `invoke` —— 基于命令名的 mock

最常见的 mock。使用 switch 按命令名分发：

```typescript
import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(invoke);

// 每个测试：按命令名配置返回值
mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case 'load_config':
      return { fontSize: 14, diffMode: 'unified', shell: '' };
    case 'save_config':
      return undefined;
    case 'load_session':
      return { projects: [], wsl_entries: [], remote_entries: [] };
    case 'save_session':
      return undefined;
    case 'list_agents':
      return [
        { id: 'claude-code', name: 'Claude Code', command: 'claude', args: [], icon: null, enabled: true },
      ];
    case 'add_project':
      return {
        id: 'new-id',
        name: 'project',
        path: (args as any)?.path ?? '/tmp/test',
        git_info: null,
        terminal: { id: 't1', pid: null, status: 'Idle', history: [], agent: null },
        selected_agent: null,
        selected_ide: null,
        active_view: 'Terminal',
        collapsed: true,
      };
    default:
      console.warn(`未 mock 的 invoke: ${cmd}`);
      return undefined;
  }
});
```

### 2. Tauri `listen` —— 捕获事件回调

```typescript
import { listen } from '@tauri-apps/api/event';

const mockListen = vi.mocked(listen);

// 捕获处理函数以便后续调用
let gitChangedHandler: ((event: any) => void) | null = null;

mockListen.mockImplementation(async (event: string, handler: any) => {
  if (event === 'git-changed') {
    gitChangedHandler = handler;
  }
  return () => {}; // unlisten 函数
});

// 在测试中稍后：模拟一个事件
gitChangedHandler?.({
  payload: 'project-id-123',
  id: 0,
  event: 'git-changed',
});
```

### 3. Tauri `getCurrentWindow` —— 窗口控制

已在 `src/test/setup.ts` 中配置（参见[前端测试](./frontend-testing.md)）：

```typescript
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
  })),
}));
```

### 4. xterm.js —— 终端模拟器

对于使用 xterm.js 的组件（需要真实 DOM canvas）：

```typescript
vi.mock('xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
    rows: 24,
    cols: 80,
  })),
}));

vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('xterm-addon-unicode11', () => ({
  Unicode11Addon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));
```

### 5. 静态资源导入

Vite 将资源导入转换为 URL 字符串。在 jsdom 测试中，如需要可以 mock：

```typescript
// vitest 通过 Vite 管道自动处理。
// 如果出现问题，可在 setup.ts 中添加：
vi.mock('*.svg', () => ({ default: 'mock-svg-url' }));
```

---

## 后端策略

### 1. 文件系统 —— 使用 `tempfile`，不使用 mock

```rust
use tempfile::TempDir;

#[test]
fn test_with_temp_dir() {
    let tmp = TempDir::new().unwrap();
    // tmp.path() 是真实目录，drop 时自动清理

    std::fs::write(tmp.path().join("test.txt"), "content").unwrap();
    // ... 测试逻辑 ...
}
// TempDir 在此处 drop，目录被清理
```

### 2. Git —— 使用真实临时仓库

```rust
fn create_test_repo() -> (TempDir, git2::Repository) {
    let tmp = TempDir::new().unwrap();
    let repo = git2::Repository::init(tmp.path()).unwrap();

    // 创建初始提交以确保 HEAD 存在
    let sig = git2::Signature::now("Test", "test@test.com").unwrap();
    std::fs::write(tmp.path().join("README.md"), "# Test").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(std::path::Path::new("README.md")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[]).unwrap();

    (tmp, repo)
}
```

### 3. Tauri State —— 直接测试 Manager

不要尝试构造 `State<AppStateWrapper>` —— 它需要 Tauri 运行时。改为：

```rust
// 直接测试 Manager
let mut pm = ProjectManager::new();
let project = pm.add_project(path, None, None).unwrap();
assert_eq!(project.name, "test");
```

### 4. 我们不 mock 的东西

| 依赖 | 不 mock 的原因 |
|------|---------------|
| `git2` | 真实临时仓库更快更准确 |
| `serde_json` | 纯序列化，没有副作用 |
| `std::fs` | 使用 `tempfile` 进行真实（隔离的）文件系统操作 |
| `Mutex` / `Arc` | 使用真实并发原语测试 |
| `portable-pty` | 与 OS 强耦合——跳过单元测试，使用 E2E |
| `russh` | 需要真实 SSH 服务器——跳过单元测试 |

---

## Mock 维护

### Mock 失效时

如果 Tauri API 发生变化（如 `invoke` 签名），需更新：
1. `src/test/setup.ts` —— 全局 mock
2. 覆盖了全局 mock 的各个测试文件

### 测试数据工厂

对于跨多个测试使用的复杂类型，创建工厂函数：

```typescript
// src/test/factories.ts
import type { Project, AgentConfig, GitInfo } from '../types';

export function createProject(overrides?: Partial<Project>): Project {
  return {
    id: 'test-id',
    name: 'test-project',
    path: '/tmp/test',
    git_info: null,
    terminal: { id: 't1', pid: null, status: 'Idle', history: [], agent: null },
    selected_agent: null,
    selected_ide: null,
    active_view: 'Terminal',
    collapsed: true,
    ...overrides,
  };
}

export function createGitInfo(overrides?: Partial<GitInfo>): GitInfo {
  return {
    current_branch: 'main',
    branches: ['main'],
    worktrees: [],
    changed_files: [],
    is_clean: true,
    ...overrides,
  };
}
```

```rust
// Rust 测试中——类似的工厂模式
fn make_project_session(name: &str) -> ProjectSession {
    ProjectSession {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        path: format!("/tmp/{}", name),
        selected_agent: None,
        selected_ide: None,
        terminal_history: vec![],
        last_status: "Idle".into(),
        collapsed: true,
    }
}
```

---

## 常见错误

### 1. 过度 mock：mock 内部模块

```typescript
// 错误 —— mock 你自己的代码
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toast: null, showToast: vi.fn() }),
}));

// 正确 —— 只 mock 外部边界（Tauri API）
// 让 useToast 运行其真实逻辑
```

### 2. 忘记在测试间清理

```typescript
// 始终重置 mock
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});
```

### 3. 对 mock 调用顺序做脆弱的断言

```typescript
// 错误 —— 内部调用顺序变化就会失败
expect(mockInvoke.mock.calls[0][0]).toBe('load_config');
expect(mockInvoke.mock.calls[1][0]).toBe('load_session');

// 正确 —— 验证调用发生过，而非顺序
expect(mockInvoke).toHaveBeenCalledWith('load_config');
expect(mockInvoke).toHaveBeenCalledWith('load_session');
```
