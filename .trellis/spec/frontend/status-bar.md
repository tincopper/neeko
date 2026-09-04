# StatusBar 开发规范

> 状态栏（`src/features/status-bar/`）的 registry 机制、item 开发契约与互斥语义。
> 2026-09 由硬编码 JSX 重构为静态 registry，本规范记录实际约定。

---

## 概述

StatusBar 是常驻底栏（`h-4`），分左右两簇：

- **左簇**：项目状态区（分支、LSP 槽位、扩展冲突）
- **右簇**：动作/指示区（Console、Debug、光标、Prompts、通知）

核心文件：

| 文件 | 职责 |
|------|------|
| `StatusBar.tsx` | 壳层：常驻 bridges + 两簇 map 渲染（≤30 行，不加业务） |
| `types.ts` | `StatusBarItemDef`（id/side/order/component） |
| `registry.ts` | `STATUS_BAR_ITEMS` 静态清单 + `itemsForSide`（排序） |
| `StatusBarCluster.tsx` | 簇渲染器：按 order 排序、全渲染 |
| `items/*.tsx` | 每项一个自包含组件（自订阅 + 自守卫） |
| `bridges/*.tsx` | 常驻数据桥（render null）：全局事件监听与订阅 |
| `LspStatusSection.tsx` | LSP chip 下拉（被 `LspSlotItem` 引用；UI 骨架范本） |

---

## 核心不变量（Invariants）

### 1. 加 item 只动 registry

**规则**：新增状态栏项 = 在 `registry.ts` 加一条 entry + 新建 `items/` 组件文件。
禁止改 `StatusBar.tsx`（它是渲染器，不是清单）。

```ts
// registry.ts —— 唯一需要改的地方
{ id: 'my-feature', side: 'right', order: 35, component: MyFeatureItem },
```

**原因**：与 dock 的 `panelMeta + registry` 同构（`app/dock/registry.ts`）；
`StatusBar.tsx` 保持无业务，review 时只看 registry diff 即可知道底栏变了什么。

### 2. 可见性自守卫，不进 registry

**规则**：条件显示（如无 `activeProjectId` 隐藏）由 item 组件内部
`return null` 表达；registry 只管位置（side/order），不管显隐。

**原因**：registry 若持有可见性谓词就得订阅 store，重渲染面扩大且
hooks 规则复杂化。自守卫让每个 item 独立可测。

**约束**：hooks 必须全部无条件调用在前，`return null` 在后
（`BranchItem.tsx`、`LspSlotItem.tsx` 是范本）。

### 3. `return null` 不占位

flex `gap-3` 布局下，`return null` 的组件不渲染 DOM、不产生 gap。
多个 item 依赖此语义并存（如无项目时左簇只剩空壳）。
禁止用空字符串/空 div 占位。

### 4. 数据监听必须住 bridge，禁止进 item

**规则**：Tauri 全局事件 `listen` 与需要跨 item 生命周期的订阅，
一律放 `bridges/`（常驻 render null），并保证 `unlisten` 成对清理
（`safeUnlisten` + `cancelled` 守卫）。

**原因**：item 可能因自守卫或未来互斥被 unmount——监听跟着 unmount
就丢了（如 `lsp-install-progress` 在 install 完成后 item 消失，
下一次 install 将永远无 UI）。这是重构时踩过的真实坑。

```tsx
// bridges/InstallProgressBridge.tsx 范本
useEffect(() => {
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  const setup = async () => {
    const fn = await listen<T>(LSP_INSTALL_PROGRESS_EVENT, (event) => {
      if (cancelled) return;
      // 写 store，不 setState
    });
    if (!cancelled) unlisten = safeUnlisten(fn);
  };
  setup();
  return () => { cancelled = true; unlisten?.(); };
}, []);
```

### 5. 互斥 = 单组件内优先级直写

**规则**：同槽位互斥（如 LSP 的 install-progress > sessions > profile）
在**一个组件内**用 if 链直写（`items/LspSlotItem.tsx`），不设跨组件认领
机制（exclusiveGroup/context claim 已评估并否决）。

**原因**：render 期跨组件可变认领表被 `react-hooks/refs` 与
`react-hooks/immutability` 双禁；且当前仅一组互斥，通用基建属
speculative generality（YAGNI）。若未来出现第二组互斥，先重审此决策。

### 6. 事件名走常量，双端同步

**规则**：item/bridge 消费的 Tauri 事件名一律从 `@/shared/events`
导入常量，Rust 侧对应常量注释互指（如 `LSP_INSTALL_PROGRESS_EVENT` ↔
`src-tauri/src/lsp/types.rs`）。禁止双端各自硬编码字符串（红线 5）。

---

## Item 开发契约

### 标准结构

```tsx
// items/MyFeatureItem.tsx
import { cn } from '@/lib/utils';
import { MyIcon } from '@/shared/components/icons';   // 图标唯一入口，12px 系
import { useMyStore } from '@/shared/store/myStore';  // store 直导（不走 feature 门面）

/** 右簇：xxx（一句话职责 + 隐藏条件）。 */
export function MyFeatureItem() {
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const myState = useMyStore((s) => s.myState);

  if (!activeProjectId) return null;   // 自守卫：hooks 之后

  return (
    <button type="button" className={cn('relative flex items-center gap-1.5 hover:text-text-primary cursor-pointer', /* active 态 */)}
      title="..." onClick={...}>
      <MyIcon size={12} className="shrink-0" />
      <span>Label</span>
    </button>
  );
}
```

### 硬性规则

1. **无 props**：item 一律自订阅（`useXxxStore(selector)`），不靠 StatusBar 传参
   ——这是它能否进 registry 的前提（`LspStatusSection` 曾因 props 传参无法独立，
   后改为自订阅才拆入 `LspSlotItem`）。
2. **图标**：只经 `@/shared/components/icons` 引入，`size={12}`（bar 高 16px，
   12px 图标 + `gap-1.5` 是基准）。
3. **徽标**：状态点 `w-1.5 h-1.5 rounded-full absolute -top-0.5 -right-0.5`，
   色值用 `bg-accent-green/red/yellow`，运行中加 `animate-pulse`
   （`ConsoleItem`/`DebugItem` 范本）。
4. **激活态**：面板展开时按钮 `text-text-primary`，hover 同色。
5. **弹窗**：必须 portal 到 `document.body`（bar 高 `h-4`，z-index 层级
   复杂，非 portal 必被裁剪/遮挡）；定位用
   `getBoundingClientRect()` 上弹公式 `bottom = innerHeight - rect.top + 4`
   （`PromptsStatusSection`/`LspStatusSection` 范本）。
6. **组件声明**：函数式具名导出（不 memo——item 数量个位数，memo 无收益；
   与 `LspStatusSection` 现状一致）。
7. **文件行数**：item ≤300 行（P10 红线）；UI 骨架大的（如下拉面板）
   拆成 `items/XxxItem.tsx`（薄）+ 同 feature 内面板组件（如 `LspStatusSection`）。

### 命名与归属

- item 组件：`items/<语义>Item.tsx`，导出名同文件名。
- bridge：`bridges/<数据域>Bridge.tsx`。
- 跨 feature 依赖走公开面：公开组件/hooks 经 feature `index.ts` 门面
  （`@/features/git`），store 经 `store/` 目录直导（`@/features/debug/store/debugStore`），
  与 Import/Export Firewall 一致。

---

## Registry 约定

### 排序

- `order` 稀疏递增（10/20/30…），中间插入不改既有值。
- 同 order 冲突按 id 兜底（`itemsForSide` 保证确定性），快照测试锁死
  （`__tests__/StatusBarRegistry.test.tsx`）。

### side 归属

- `left`：项目状态（被动展示），依赖项目上下文的放这里。
- `right`：动作开关与全局指示。
- 拿不准时看现有语义：开关类（toggle panel）在右，状态类在左。

---

## 测试约定

| 层 | 文件 | 覆盖 |
|---|---|---|
| registry | `StatusBarRegistry.test.tsx` | 快照（side/order 稳定）+ 清单断言 + 排序确定性 + 渲染器全渲染语义 |
| 槽位互斥 | `StatusBarLspGroup.test.tsx` | 优先级切换（install > sessions > profile > 空） |
| bridges | `StatusBarBridges.test.tsx` | 事件写入 store、timer 清除语义、订阅/卸载 |
| 单 item | 各 item 或引用组件测试 | 自守卫隐藏/显示、点击行为 |

- store 一律 mock（`vi.mock('@/shared/store/...')`），不依赖真实 zustand 实例。
- 桥的 async setup 用微任务 tick 循环冲刷，不用 `act` 包空函数
  （`testing-library/no-unnecessary-act`）。

---

## 禁止模式

| ❌ 禁止 | ✅ 正确 | 原因 |
|---|---|---|
| 改 `StatusBar.tsx` 加 item | registry 加 entry | 壳层必须无业务 |
| 可见性谓词写进 registry | item 自守卫 `return null` | registry 订阅 store 会扩大重渲染面 |
| `listen` 写在 item 组件 | 放 `bridges/` | item unmount 丢 listener（踩过） |
| `return null` 前提前 return（跳过 hooks） | hooks 全在前 | hooks 规则 |
| 跨组件互斥认领/context claim | 单组件 if 链直写 | react-hooks/immutability 禁 render 期可变表；且 YAGNI |
| 硬编码事件名字符串 | `@/shared/events` 常量 | 双端同步（红线 5） |
| 非 portal 弹窗 | `createPortal(…, document.body)` | `h-4` bar 下必被裁剪 |
| item 用 memo 包裹 | 具名函数导出 | 个位数 item，memo 无收益白增复杂度 |

---

## 常见坑

1. **自订阅改造漏收窄**：item 自订阅后 `activeProjectPath` 变 `string | undefined`，
   handler 内直接传参会 tsc 报错——每个 handler 开头补 `if (!activeProjectPath) return;`
   （`LspStatusSection.handleRestart` 等 5 处踩过）。
2. **先订阅后拉取**：订阅是异步的，先 `await subscribe` 再 `lspListSessions()`
   拉初始态，否则订阅就绪前的事件丢失（`LspSubscriptionBridge` 注释保留此语义）。
3. **done/error 的延时清除**：install 完成提示 2000ms / 失败 5000ms 后自动消失，
   timer 必须写 store（`setInstallProgress(null)`），不能 setState 到 bridge——
   bridge 不重渲染，读方是 item。
4. **测试文件名 PascalCase**：`__tests__/` 下受 `check-file/filename-naming-convention`
   约束，新增测试文件用 `StatusBarXxx.test.tsx` 形式。

---

## 范本索引

| 需求 | 看这里 |
|---|---|
| 新增动作按钮（toggle 类） | `items/ConsoleItem.tsx` |
| 新增被动指示（文本/徽标） | `items/ConflictsItem.tsx`、`items/CursorItem.tsx` |
| 新增带下拉面板的 item | `PromptsStatusSection.tsx`（搜索+portal 上弹）、`LspStatusSection.tsx`（子菜单） |
| 新增数据桥 | `bridges/InstallProgressBridge.tsx`（listen+timer+store） |
| 互斥槽位 | `items/LspSlotItem.tsx` |
