# 前端测试

> Vitest 配置、Hook 测试、组件测试和 Tauri API mock。

---

## 环境搭建

### 安装依赖

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

### Vitest 配置

在项目根目录创建 `vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/vite-env.d.ts', 'src/main.tsx'],
    },
  },
});
```

### 全局测试配置

创建 `src/test/setup.ts`：

```typescript
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// 全局 mock：@tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// 全局 mock：@tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

// 全局 mock：@tauri-apps/api/window
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// 全局 mock：@tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));
```

### package.json 脚本

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## 测试工具函数（纯函数）

`src/utils/` 中的工具函数最容易测试——不涉及 React 和 Tauri。

### 示例：`src/utils/platform.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { IS_WINDOWS, IS_MACOS } from './platform';

describe('platform detection', () => {
  it('exports boolean constants', () => {
    expect(typeof IS_WINDOWS).toBe('boolean');
    expect(typeof IS_MACOS).toBe('boolean');
  });

  // 注意：实际值取决于测试运行器的操作系统
  // jsdom 的 navigator.platform 默认为空
});
```

### 示例：`src/utils/terminal.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildFontFamily } from './terminal';

describe('buildFontFamily', () => {
  it('没有自定义字体时返回默认 monospace', () => {
    const result = buildFontFamily('');
    expect(result).toContain('monospace');
  });

  it('在前面添加自定义字体', () => {
    const result = buildFontFamily('Fira Code');
    expect(result).toMatch(/^"Fira Code"/);
    expect(result).toContain('monospace');
  });
});
```

---

## 测试自定义 Hooks

### 模式：无 Tauri 依赖的 Hooks

像 `useToast` 和 `useWorktreeState` 这样仅使用 React 原生 API 的 Hooks——直接测试：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from './useToast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态没有 toast', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it('显示带消息和类型的 toast', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('Hello', 'info');
    });

    expect(result.current.toast).toEqual({ message: 'Hello', type: 'info' });
  });

  it('3 秒后自动消失', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('临时消息');
    });

    expect(result.current.toast).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.toast).toBeNull();
  });

  it('替换现有 toast 并重置计时器', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('第一条');
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      result.current.showToast('第二条');
    });

    expect(result.current.toast?.message).toBe('第二条');

    // 原始的 3 秒计时器应该已被清除
    act(() => {
      vi.advanceTimersByTime(1500); // 从第一条 toast 起 2000 + 1500 = 3500ms
    });
    // 第二条 toast 应该仍然可见（显示后仅 1500ms）
    expect(result.current.toast).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500); // 从第二条 toast 起已过 3000ms
    });
    expect(result.current.toast).toBeNull();
  });
});
```

### 模式：依赖 Tauri `invoke` 的 Hooks

对于像 `useAppConfig` 这样调用 `invoke` 的 Hooks，在模块级进行 mock：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useAppConfig } from './useAppConfig';

const mockInvoke = vi.mocked(invoke);

describe('useAppConfig', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('挂载时加载配置', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') {
        return { fontSize: 16, diffMode: 'split', shell: '/bin/zsh' };
      }
      return undefined;
    });

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(result.current.config.fontSize).toBe(16);
      expect(result.current.config.diffMode).toBe('split');
    });

    expect(mockInvoke).toHaveBeenCalledWith('load_config');
  });

  it('load_config 返回空对象时使用默认值', async () => {
    mockInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(result.current.config.fontSize).toBe(14); // 默认值
      expect(result.current.config.diffMode).toBe('unified'); // 默认值
    });
  });

  it('通过 invoke 保存配置', async () => {
    mockInvoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAppConfig());

    const newConfig = {
      ...result.current.config,
      fontSize: 18,
    };

    await act(async () => {
      await result.current.saveConfig(newConfig);
    });

    expect(mockInvoke).toHaveBeenCalledWith('save_config', { config: newConfig });
  });
});
```

---

## 测试组件

### 模式：简单组件测试

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentIcon from './AgentIcon';

describe('AgentIcon', () => {
  it('没有提供图标时渲染默认 fallback', () => {
    render(<AgentIcon />);
    expect(screen.getByText('🤖')).toBeInTheDocument();
  });

  it('渲染自定义 fallback 文本', () => {
    render(<AgentIcon fallback="AI" />);
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('图标没有匹配图片时渲染图标文本', () => {
    render(<AgentIcon icon="unknown-agent" />);
    expect(screen.getByText('unknown-agent')).toBeInTheDocument();
  });
});
```

### 模式：带回调的组件

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WindowControls from './WindowControls';

describe('WindowControls', () => {
  it('渲染最小化、最大化和关闭按钮', () => {
    render(<WindowControls />);
    expect(screen.getByTitle('Minimize')).toBeInTheDocument();
    expect(screen.getByTitle('Maximize')).toBeInTheDocument();
    expect(screen.getByTitle('Close')).toBeInTheDocument();
  });
});
```

---

## 关键约定

### 测试结构

遵循 **Arrange-Act-Assert** 模式：

```typescript
it('描述期望的行为', () => {
  // Arrange（准备）
  const { result } = renderHook(() => useToast());

  // Act（执行）
  act(() => {
    result.current.showToast('msg');
  });

  // Assert（断言）
  expect(result.current.toast?.message).toBe('msg');
});
```

### 测试命名

- `describe` 块 = 模块/函数名
- `it` 块 = 行为描述，以动词开头

```typescript
describe('useToast', () => {
  it('初始状态没有 toast', () => { ... });
  it('显示带消息和类型的 toast', () => { ... });
  it('3 秒后自动消失', () => { ... });
});
```

### 异步测试

对异步操作（如 `invoke`）触发的状态变更使用 `waitFor`：

```typescript
await waitFor(() => {
  expect(result.current.config.fontSize).toBe(16);
});
```

对同步状态更新使用 `act`：

```typescript
act(() => {
  result.current.showToast('msg');
});
```

---

## 常见错误

### 1. 忘记在测试间重置 mock

```typescript
// 始终在 beforeEach 中重置
beforeEach(() => {
  mockInvoke.mockReset();
});
```

### 2. 状态更新没有包裹在 `act` 中

```typescript
// 错误 —— React 会发出未包裹状态更新的警告
result.current.showToast('msg');

// 正确
act(() => {
  result.current.showToast('msg');
});
```

### 3. 测试实现细节而非行为

```typescript
// 错误 —— 测试内部状态结构
expect(result.current.__internalRef.current).toBe(42);

// 正确 —— 测试可观察的行为
expect(result.current.value).toBe(42);
```

### 4. mock 层次过深

```typescript
// 错误 —— mock React 内部
vi.mock('react', () => ({ useState: vi.fn() }));

// 正确 —— 在边界处 mock（Tauri API）
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
```
