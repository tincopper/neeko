# 设计：应用级 Prompt 弹窗宿主

> 需求与验收见 `prd.md`；执行顺序见 `implement.md`。参照物是本仓库既有机制，不引入新框架。

## 1. 边界

| 单元 | 职责（唯一改变理由） | 本任务后**不再**承担 |
| --- | --- | --- |
| `library/components/PromptDialogHost.tsx`（新） | 三个 prompt 弹窗的唯一渲染点 + 宿主就绪标记的生命周期 | 任何业务判断 |
| `library/store/libraryStore.ts` | prompt 弹窗的状态与结算契约（含 overlay 上报） | 把 resolver 塞进可序列化状态 |
| `library/hooks/useInsertPromptToWorkspace.ts`（新） | 把「已成形的 prompt」投递到工作区（terminal → agent → clipboard） | 变量解析（属 `usePromptInsert`） |
| `library/hooks/usePromptInsert.ts` | 插入流程编排：检测变量 → 等宿主结算 → 计次数 → 交给调用方 | — |
| `library/components/LibraryPanel.tsx` | 布局（双岛 + 分栏持久化） | 渲染任何 store 驱动弹窗 |
| `app/AppModals.tsx` | 应用级浮层组合层：挂载宿主 | — |
| `app/dock/wrappers/LibraryPanelWrapper.tsx` | dock/中心视图适配：把 context 交给 `LibraryPanel` 与投递 hook | 自己实现投递逻辑 |

MCP 弹窗（`McpTabContent.tsx:71-72`）保持在 Library 子树内：`mcpStore` 的两个 flag 只由同一子树翻起，无外部触发点（prd C4）。

## 2. 契约

### 2.1 变量弹窗（改）

```ts
// state（删除 variableDialogOpen / variableDialogContent / variableDialogResolve 三个字段）
variableRequest: string | null;              // null = 关闭；非 null = 待填变量的原始内容

// actions
openVariableDialog: (content: string) => Promise<string | null>;
settleVariableDialog: (rendered: string | null) => void;   // 唯一的关闭 + 结算入口

// 模块级导出（不进 state）
export function setPromptDialogHostMounted(mounted: boolean): void;
```

语义（与 `confirmStore.ts:45-53,64-82` 同构）：

| 事件 | 结果 | 调用方（`usePromptInsert`）动作 |
| --- | --- | --- |
| 用户确认 | `resolve(rendered)` | `recordUsage` + `onInsertPrompt(prompt with rendered)` |
| 取消 / × / Esc / 遮罩 | `resolve(null)` | 什么都不做 |
| 宿主未挂载时请求 | 立即 `resolve(null)` | 什么都不做（**fail-closed**：绝不把未替换的 `{{var}}` 灌进终端） |
| 并发第二个请求 | 旧请求 `resolve(null)`，新的接管 | 同上 |
| 宿主卸载 | 在途请求 `resolve(null)` + 清 flag | 同上 |

`resolver` 与 `hostMounted` 放模块作用域：未决 Promise 不可序列化，不进 zustand 状态（`confirmStore.ts:52` 同一理由）。

### 2.2 overlay 上报（新）

在 store 的开/关动作里上报，id 常量与 `close-confirm` 同风格：`'prompt-editor'` / `'prompt-insert'` / `'prompt-variables'`。
必须在 **R3 之后**才成立 —— 弹窗此前只能从 Library 视图触发，那里看不到 Browser tab；一旦能盖在主工作区上，
`useBrowserTab.ts:83-87` 的 `visible = isActive && !anyOverlayOpen && tabExists` 就是唯一防线。

### 2.3 投递 hook

```ts
export function useInsertPromptToWorkspace(): (prompt: PromptResource, target?: PromptInsertTarget) => void;
```

函数体自 `LibraryPanelWrapper.tsx:17-38` 原样搬出（terminal 成功即 toast；无终端降级 agent 输入；再降级 clipboard），
宿主与 wrapper 共用 → 「插入语义」只有一个产出点（`src/AGENTS.md` 状态管理原则 4）。
wrapper 继续把它包成 `onInsertPrompt` 传给 `LibraryPanel`，面板内既有 props 通路不动（改它属另一关注点）。

## 3. 数据流（修复后的状态栏路径）

```
状态栏 chip 点击行
  → usePromptInsert(prompt, 'terminal')
  → detectVariables > 0 → libraryStore.openVariableDialog(content)   ← 只翻 state
  → PromptDialogHost（AppModals 常驻，与中心视图无关）渲染 VariableDialog
  → 用户确认 → settleVariableDialog(rendered) → Promise resolve
  → recordUsage + PromptsStatusSection 的 handleInsertPrompt
  → api.insertToTerminal(rendered) → revealTerminalTab(activeProjectId)
```

命令面板路径同构，终点是宿主里的 `PromptInsertDialog` / `PromptEditorDialog`，不再经过 `openLibraryAt`。

## 4. 取舍

| 方案 | 结论 |
| --- | --- |
| **全局宿主（选）** | 满足 I1/I2/I3；与 `ConfirmHost` / `CloseConfirmDialog` 一致（本仓库第 3 次同一模式）；settings 视图下也可用；未来新增触发点零成本 |
| 触发时强制挂载 Library（`openLibraryAt` 式，否） | 违反单一职责：填个变量不该换掉用户工作区；把「弹窗可用性」耦合到懒挂载调度；`appView === 'settings'` 分支根本不渲染 Library → 该路径永远不可能工作 |
| 只搬 `VariableDialog`（否） | 同一功能域的弹窗一半在宿主一半在面板，是新的分裂事实源；下一个外部触发（面板/编辑弹窗）会再次静默失效 |
| 顺带搬 MCP 弹窗（否） | 无外部触发点、无已知缺陷 —— 为「将来可能」预留即违反 YAGNI |

**宿主用静态 import 而非 `React.lazy`**：`libraryStore` 与 `libraryApi` 今天已在主 chunk
（`AppCenter.tsx:4` 静态引 store；`AppShell.tsx:3` → `PromptsStatusSection.tsx:5` → `libraryApi`），
新增体积只有三个弹窗组件；`AppModals` 本就静态挂载 connection/editor/project 的对话框。
`frontend-build` 门只验能否打包，无体积预算（`quality-guidelines.md:353`）。

**Radix 嵌套**：宿主内三弹窗共用 open flag，无同 flag 双渲染（已 grep 确认渲染点唯一）。
`PromptInsertDialog` 现在「先 insert 再 close」（`:51-58`、`:142-152`），会使选择器与变量框在同一 commit 内重叠、
焦点陷阱互抢 → 改为**先 `closeInsert()` 再 `onInsert(...)`**。

**持久化**：`libraryStore` 的 `partialize`（`:231-236`）只留 `activeKind/viewMode/sortMode/navSize`，
新 flag 是瞬态，不存在重启后弹窗自己弹出来的风险。

**兼容性**：`variableDialogOpen` / `variableDialogResolve` 无跨 feature 消费者（仅 `LibraryPanel` 与两个测试文件），
`OpenLibraryOptions.insert` 仅一个调用方（`ProjectWorkspace.tsx:248`）→ 直接删除，不留垫片（prd C3）。
**审核追加**：`openEditorWithContent` + `initialContent`（「Save as Prompt」的前置填充通道）生产者早已不存在
（全库零调用方），一并删除而非留「将来可能用到」的字段 —— 与系统约束「确定无用即整段删除」一致。

## 5. 回滚形状

Steps 2-6（store 契约 + 宿主 + 面板摘除 + hook 抽取）互为前提，必须作为一个提交回滚；
命令面板（Step 7）与 `closeConfirmStore` 守卫（Step 8）各自独立提交、可单独回滚。
