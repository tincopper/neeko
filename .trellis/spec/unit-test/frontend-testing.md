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
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/vite-env.d.ts', 'src/main.tsx'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
```

### 全局测试配置

创建 `src/testing/setup.ts`：

```typescript
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';

import { installTimerTracking } from './timers';

// 文件结束时取消本文件所有挂起的定时器 / RAF —— 见「环境边界：定时器与 RAF 的文件级收口」。
const timerTracking = installTimerTracking();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

afterAll(() => {
  vi.useRealTimers();
  timerTracking.releaseAll();
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
    "test": "pnpm test:fe && pnpm test:rust && pnpm test:host",
    "test:fe": "vitest run",
    "test:fe:watch": "vitest",
    "test:fe:coverage": "vitest run --coverage"
  }
}
```

---

## 测试工具函数（纯函数）

`src/shared/utils/`（以及 `src/features/*/utils/`）中的工具函数最容易测试——不涉及 React 和 Tauri。测试放在同层 `__tests__/` 目录（如 `src/shared/utils/__tests__/`）。

### 示例：`src/shared/utils/__tests__/platform.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { IS_WINDOWS, IS_MACOS } from '../../utils/platform';

describe('platform detection', () => {
  it('exports boolean constants', () => {
    expect(typeof IS_WINDOWS).toBe('boolean');
    expect(typeof IS_MACOS).toBe('boolean');
  });

  // 注意：实际值取决于测试运行器的操作系统
  // jsdom 的 navigator.platform 默认为空
});
```

### 示例：`src/shared/utils/__tests__/terminal.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildFontFamily } from '../../utils/terminal';

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

像 `useToast` 和 `useWorkspaceState` 这样仅使用 React 原生 API 的 Hooks——直接测试：

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

### 测试环境：node vs jsdom（2026-09-17 起）

全量套件的 environment 开销曾是最大瓶颈（jsdom 29 每文件独立构造，440 文件累计 ~111s）。
**163 个纯逻辑测试文件已通过文件级 docblock 切到 node 环境**（environment 累计 ~62s，
配合 `maxWorkers: 6`，全量 wall time 107s → 41-50s）。

**新增测试文件时**：

```typescript
// @vitest-environment node   ← 不碰 DOM 的纯逻辑测试（utils/store reducer/纯函数）加在首行
import { describe, expect, it } from 'vitest';
```

- 默认（不写 docblock）= jsdom —— 组件 / Hook（renderHook）/ 任何触碰 `document`、
  `HTMLElement`、testing-library 的测试**必须**保持默认，宁慢勿错
- 不确定时先用默认 jsdom 写，跑通后再试 node：在 node 环境 crash（`HTMLElement is not
  defined` 等）= 有传递性 DOM 依赖，删掉 docblock 即回 jsdom，无需改代码
- `src/testing/setup.ts` 的 DOM 垫片全部带 `typeof` 守卫，node 环境安全；给垫片加新
  分支时必须延续该模式
- vitest 4 已移除 `environmentMatchGlobs`，**docblock 是唯一的逐文件机制**——不要往
  config 里加回已删除的选项

**变异验证先例**：误标文件（传递性 DOM 依赖）在 node 环境必红——10 个误标已实证回退；
分类标记集见 `.trellis/spec/unit-test/frontend-testing.md` 本节所用 grep 模式。

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

## 环境边界：定时器与 RAF 的文件级收口

**症状**：所有用例都通过，整轮 vitest 却判红 —— `Unhandled Errors` 里是
`TypeError: Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'`
（或 `document is not defined` 一类），且**一轮红一轮绿**，报错来源只指向某个「当时正在跑」的文件
（2026-09-30 实测：来源指向 `McpTagGroupDialog.test.tsx`，同一份代码约 1/6 轮红）。

**机制**（必须跨文件看才成立）：组件卸载与绘制调度里的副作用都排在**宏任务**上 —— Radix 的
FocusScope（Dialog / DropdownMenu / ContextMenu / Select 等所有弹层共用）在 mount effect 的 cleanup
里 `setTimeout(0)` 派发 `focusScope.autoFocusOnUnmount` 并归还焦点；终端与布局用
`requestAnimationFrame` 做测量与折叠。而全局 `afterEach` 的 `cleanup()` 正是触发卸载的地方。
vitest 在**文件结束**时销毁 jsdom 环境：全局 `Event` 还原成 Node 原生实现、`document` 失效 ——
那一刻仍挂起的回调一旦触发就抛错：**没有任何用例失败，整轮却红**。

**为什么不能只修那一个文件**：全仓 32 个弹层测试文件与所有 RAF 调用点都带着同一颗雷；同理，
打开 `dangerouslyIgnoreUnhandledErrors` 等于把真问题一起静音。

**约定**：`src/testing/timers.ts` 在 setup 期包装 `setTimeout` / `setInterval` /
`requestAnimationFrame`（以及对应的 clear），登记挂起项；`afterAll` 调 `releaseAll()` **一次性取消**。
不变式是 **「文件结束前排下的调度，不可能在文件结束之后跑」**。机制单测在
`src/testing/__tests__/timers.test.ts`（注入假 scope，不依赖真实时钟）。

**为什么是取消，而不是「等一个宏任务」**：等待只覆盖 0ms 那一类（Radix 的卸载事件），RAF
（jsdom 下 ~16ms）与更长延时都漏网，而且仍是竞态；取消对所有延时都成立，也不付出真实等待。文件
结束时已无任何用例在跑，因此「取消」与「让它跑」在语义上等价。

**边界**（新增异步机制时照此判断）：

| 情况 | 是否覆盖 |
|------|---------|
| `setTimeout` / `setInterval` / `requestAnimationFrame`（含库内部：Radix / CodeMirror / xterm） | ✅ 文件结束时统一取消 |
| 微任务（`await`、已 mock 的 `invoke`） | ✅ teardown 前排空 |
| 伪时钟（`vi.useFakeTimers`）排下的任务 | ✅ 全局 `afterEach` 的 `vi.useRealTimers()` 直接丢弃时钟 |
| 文件结束后（teardown 期间）新排的调度 | ❌ 刻意不接管 —— 那是 harness 自己的事，接管会把 vitest 的收尾调度一起掐死 |
| 非定时器的外部异步（真实 I/O 完成回调） | ❌ 理论上仍可跨边界；测试里应 mock 掉这类来源 |

**新增调度机制时**：先量一次「文件结束时取消了多少个」——临时在 `afterAll` 打印 `releaseAll()` 的
返回值，跑一个含该机制的测试文件：**>0 才算被纳管**（弹层文件实测 3，纯逻辑文件 0）。若某类调度不在
上表覆盖内，扩展 `timers.ts` 的包装集并补一条机制单测，**不要**在业务用例里加 `sleep` 或改用例顺序。

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

### 5. `vi.stubGlobal` 被全局 `afterEach` 撤销

全局 setup（`src/testing/setup.ts`）的 `afterEach` 会执行 `vi.unstubAllGlobals()`，因此**在模块顶层一次性 `vi.stubGlobal` 只会对第一个测试生效**，后续测试访问该全局变量会直接 `ReferenceError`。

```typescript
// 错误 —— 顶层 stub 在第一个测试后就被撤销
vi.stubGlobal('IntersectionObserver', MockIO);

describe('...', () => { ... });

// 正确 —— stub 必须放 beforeEach（每次测试前重新注入）
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', MockIO);
  vi.stubGlobal('ResizeObserver', MockRO);
});
```

### 6. RO/IO stub 测试要点（jsdom 无真实布局）

- jsdom 中 `clientHeight`/`getBoundingClientRect` 恒为 0，`isIntersecting` 恒为 false → **回调必须手动调用**，`scrollIntoView` 需在 stub 中置空实现（jsdom 未实现，直接调用会抛错）。
- `renderHook` 无 DOM：mount 时 `containerRef.current` 为 null → 观察者**不会**被创建，观察者创建/断开的断言必须放到真实渲染的集成测试（`render` + `@testing-library/react`）里。
- 始终断言清理：`expect(io.disconnect).toHaveBeenCalled()`，防泄漏回归。

```typescript
// MockIO/MockRO 需在类中提供 disconnect/observe/unobserve 的 vi.fn() 实现，
// 回调由测试手动触发：
(io as MockIO).trigger([{ isIntersecting: true } as IntersectionObserverEntry]);
```

### 7. 文本断言陷阱：拆分渲染与子串匹配

- 组件把信息拆成多个文本节点渲染时（如 `splitFilePath` 拆出文件名与目录、type badge 与 subject 分开），`getByText('src/foo.ts')` 找不到——精确匹配拆分后的节点（`getByText('foo.ts')`）。
- `getByText` 默认是精确子串匹配：`'item 13'` **不包含** `'item 3'`（是 `'item 1'` + `'3'`），搜索断言前先确认目标子串真实存在于匹配集中。

### 8. detached 节点事件不冒泡

测试中手动创建并触发事件的 DOM 节点若未挂载到 `document`，事件不会冒泡到 `document` 监听器（如外部点击关闭菜单的逻辑）——先 `document.body.appendChild(el)`，结束再移除。

### 9. 竞态用例的假绿：只 `await` 主链，迟到链还没落地

**问题**：交错 / 竞态用例（「旧请求迟到不得覆盖新请求」这类）最常见的失效方式不是断言写错，而是**断言跑在迟到链执行之前**。`await mainRun`（主链 promise 已 resolve）只让出**一个**微任务，而迟到链在自己的 `await` 链上还有若干层（例：`loadStopSourceContent` → `openStopTab` 各有一层 `await`），于是断言抢先执行 → **缺陷代码上也「通过」**。实例：issue #13 的 `T3-tab` 首版就是这样在旧机制上直接绿的（2026-09-16），补一次微任务冲刷后才在旧机制上稳定红。

**正确模式**：用 `deferred()` 显式兑现迟到方，兑现后**必须**再 `await flushMicrotasks()` 才断言（两者都在 `src/testing/async.ts`）：

```ts
const slowRead = deferred<FileContent>();
readFileContentMock.mockImplementation((_p, path) => (path === A ? slowRead.promise : Promise.resolve(content(path))));

const firstRun = refresh();                 // 旧停点，挂在内容读取上
await flushMicrotasks();                    // 让它推进到「内容还在路上」
await refresh();                            // 新停点先完成
slowRead.resolve(content(A));               // 旧内容此刻才到
await firstRun;
await flushMicrotasks();                    // ★ 少了这一行就是假绿
expect(activeTabId()).toBe(B_TAB);
```

**判定准则**：写完交错用例后，**在缺陷代码（或临时移除守卫 / 让守卫恒真）上跑一次**——必须是红的。不红就先怀疑时序（断言早于迟到链）或断言面选错了，而不是宣布「bug 不存在」。

**禁止**：用 `await` 顺序或调用次序模仿交错（那只是顺序执行，测不出竞态）；用 `sleep` 凑时序（不稳定且掩盖问题根源）。

### 10. 用例全绿但整轮判红：卸载副作用跑到了环境销毁之后

`Unhandled Errors` 里出现 `dispatchEvent ... parameter 1 is not of type 'Event'` / `document is not
defined`，且**一轮红一轮绿**：组件卸载排下的宏任务（Radix 弹层的 `autoFocusOnUnmount`、终端的 RAF
测量）在 jsdom 环境销毁之后才触发。收口机制与排查手法见
[「环境边界：定时器与 RAF 的文件级收口」](#环境边界定时器与-raf-的文件级收口) —— 不要用
`dangerouslyIgnoreUnhandledErrors` 掩盖，也不要给业务用例加 `sleep`。

