# 质量指南

> 前端开发的代码质量标准。

---

## 概述

项目当前的主要质量门禁是：

1. **ESLint**（`pnpm lint:fe` 的第一半 = `eslint src/ --cache`）—— 架构约束 + 代码风格 + 命名规范
2. **TypeScript 类型检查**（`tsc --noEmit`）—— 类型安全
3. **Vitest** 回归测试（`pnpm test:fe`）

CI 在 `frontend-check` job 跑 `pnpm lint:fe`（eslint + tsc），在 `frontend-test` job 跑 `pnpm test:fe`
—— 与本地 commit 档、push 档**同一条命令**。本地一把梭是 `pnpm check`（含 Rust 侧与 host 自检）。

### ESLint 配置要点

配置文件：`.eslintrc.cjs`（ESLint 8 格式，支持 `.eslintrc.*` 文件）

核心规则：

| 规则 | 级别 | 用途 |
|------|------|------|
| `import/no-restricted-paths` | error | 禁止跨 feature 引用，强制单向依赖流 |
| `import/no-cycle` | error | 检测循环依赖 |
| `import/order` | warn | import 语句分组排序 |
| `check-file/filename-naming-convention` | warn | `.tsx` 使用 PascalCase，`.ts` 使用 camelCase |
| `check-file/folder-naming-convention` | error | 目录使用 kebab-case（`__tests__` 除外） |
| `no-restricted-imports` | error | 禁止在 `api/` 目录外直接 `import { invoke } from "@tauri-apps/api/core"` |
| `prettier/prettier` | error | 代码格式统一 |

注意：ESLint 10+ 移除了 `.eslintrc.*` 支持，仅支持 flat config。本项目使用 ESLint 8 以兼容插件生态。


### Layout / Dock 边界规则（2026-07-24）

`layout/` 是**纯窗口骨架**，不得 import `@/features/*` 或 `@/app/*`（含 `lazy`）。

| 允许 | 禁止 |
|------|------|
| `layout` 内部互引、`@/shared/*`、`@/ui/*`、`@/lib/*` | `import ... from '@/features/...'` / `@/app/...` |
| 通过 props/slots/Context 接收业务 UI | 在 layout 内持有 feature 组件注册表实现 |
| `useDockRegistry()` 消费 app 注入的 ViewDef | `layout/dockPanels.ts` 式的 lazy 注册表（已删除） |

#### Dock 注册表分层（强制）

```
shared/dock/panelMeta.ts   ← dockStore 默认 zones / bar / toggle 补区
app/dock/registry.ts       ← title/icon + lazy(features/app) 绑定
layout/DockRegistryContext ← app 用 DockRegistryProvider 注入；DockLayout/Zone 只消费
```

新增 panel checklist：
1. `shared/dock/panelMeta.ts` 增加 meta
2. `app/dock/registry.ts` 增加 UI binding（title/icon/lazy/minPanelSize）
3. 需要 props 胶水时改 `app/dock/wrappers/<Panel>Wrapper.tsx`（每面板一文件，独立 lazy chunk；业务编排下沉到 feature hooks）
4. **不要**在 `layout/` 增加 feature/app import

ESLint：`import/no-restricted-paths` 禁止 layout→features/app；**无** dockPanels 文件级例外。

**禁止模式**：
- 禁止 `window.__neeko*` 全局函数桥接跨层通信（改用 Context，如 `TerminalInsertContext`：Provider + register/unregister + 消费方降级）
- 禁止 dock wrapper 内嵌业务编排（git 刷新、tab 创建等）——下沉 feature 域 hooks（`useRefreshGitInfo` / `useOpenDiffTab` / `useGitLogKeyboardNav`）
- **禁止跨 feature 深导入**：`@/features/<f>/components|hooks|utils|contexts/...` 一律走 feature `index.ts` 门面（白名单 `store/` `types/` `api/` 可直导，`export type` 类型直导豁免）；门面缺符号时先行补导出再改消费方。`shared/` 层反向引用 features 为 pre-existing 豁免（带 `import/no-restricted-paths` disable 注释），不得门面化（会引入循环依赖）。

#### 防火墙的**覆盖面**由护栏钉死（2026-10-30）

规则的判据集是 `.eslintrc.cjs` 里手写的 `FEATURE_DIRS` 数组，而 `import/no-restricted-paths`
只对**清单里出现过的**目录生成 zone。于是「新增 feature 目录却没加清单」不是「少一条规则」，
而是**那个域的跨域私有导入完全不受约束**，ESLint 一声不响 —— 2026-10-30 实测：
`agent-chat` 与 `search` 双双缺席（`src/app` 因此能直引 `agent-chat/hooks/*`），
另有一条陈旧条目 `debug`（`features/debug/` 已在 `570463bd` 删除）。

现在由 `check_feature_firewall_coverage` 双向校验收紧：

| 漂移方向 | 后果 | 判据 |
| --- | --- | --- |
| 磁盘有、清单无 | 该域（及别人引用它）**无任何约束** | 违规，指到 `.eslintrc.cjs` 的 `FEATURE_DIRS` 行 |
| 清单有、磁盘无 | 清单不再描述现实，zone 指向不存在路径 | 同上 |

判据只覆盖「清单 ↔ 现实」映射，**不复制规则正文**（正文单一事实源仍在 `.eslintrc.cjs`）。
`FEATURE_DIRS` 块被改名/重构时护栏报**失效**（退出码 2），不静默通过。
`shared/` 不得 import `layout/`（dockStore 只依赖 `shared/dock`）。

当前 Git 相关 dock panel 只有 **`gitControl`**（title: Git Control）。旧的 `gitCommit` / `gitLog` 已合并进其内部 Changes | History tabs，不要再注册为独立 dock panel。

Git Control 打开 Diff view 的 Tab 标题须按来源加前缀，分隔符用中点 `·`（U+00B7）：

| 来源 | 模式 | 标题 |
| --- | --- | --- |
| Changes（即将提交的变更） | 单文件 | `Commit Diff · <文件名>` |
| History（已提交历史） | 单文件 / 钉住 | `History Diff · <文件名>` |
| History（已提交历史） | 合并多文件 | `History Commit · <hash 前7> · N files` |

要点：单文件 Diff 用 `… Diff · …` 表达"来自某面板的单文件 diff"；合并模式仍保留 `History Commit` 前缀以锚定所在 commit。标题前缀是单一事实源，禁止回退为裸文件名。


#### 多 Tab Dock Panel：保留子面板挂载状态

**问题**：内部 tab 用条件渲染（`activeTab === 'x' ? <A/> : <B/>`）会卸载非活动面板，导致草稿 commit message、文件勾选、对话框状态丢失。

**正确做法**：两个子面板都始终挂载，用 `hidden` 切换可见性；键盘快捷键在 wrapper 层按 `activeTab` 门控。

```tsx
// Good — 状态在 tab 切换后仍在
<div className={cn('h-full', activeTab !== 'changes' && 'hidden')}>
  <GitCommitPanel ... />
</div>
<div className={cn('h-full', activeTab !== 'history' && 'hidden')}>
  <GitLogPanel ... />
</div>

// Bad — 切到 History 会丢掉 Changes 草稿
{activeTab === 'changes' ? <GitCommitPanel /> : <GitLogPanel />}
```

跨 tab 数据一致性：Changes 提交成功后的 `onRefreshGit` 应同时刷新 History 的 log（`useGitLog().refresh()`）。


---

## 禁止模式

### 1. 无理由使用 `any`

避免 `any` —— 使用正确的类型或 `unknown` 配合类型收窄。代码库中现有的 `any` 用法（如 `terminal.agent: any`）属于技术债务，不是应该效仿的示例。

```tsx
// 错误
const data = await invoke<any>("load_session");

// 正确
const data = await invoke<SessionData>("load_session");
```

### 2. 直接操作 DOM（特殊情况除外）

使用 React 状态驱动 UI。直接 DOM 操作仅在以下情况可接受：
- CSS 自定义属性更新（`document.documentElement.style.setProperty`）
- xterm.js 终端集成（设计上需要 DOM 访问）

### 3. 静态值使用内联样式

静态样式使用 CSS 类。仅在真正的动态值时使用内联 `style`：

```tsx
// 错误 —— 静态样式用了内联
<div style={{ padding: "8px", color: "#abb2bf" }}>

// 正确 —— 使用 CSS 类
<div className="my-section">

// 可以 —— 动态值
<div style={{ width: `${calculatedWidth}px` }}>
```

### 4. 从组件内部文件导入

始终通过桶文件 `index.ts` 导入：

```tsx
// 错误
import TitleBar from "@/layout/TitleBar";

// 正确
import { TitleBar } from "@/layout";
```

### 5. 在 API wrapper 目录外直接使用 `invoke`

`invoke` 调用必须封装在 `src/features/<domain>/api/<domain>Api.ts` 中，禁止在其他文件中直接导入 `@tauri-apps/api/core`：

```typescript
// 错误 —— 在 hook 中直接调用 invoke
import { invoke } from "@tauri-apps/api/core";
const projects = await invoke<Project[]>("list_projects");

// 正确 —— 通过 API wrapper
import { listProjects } from "../api/projectApi";
const projects = await listProjects();
```

ESLint 的 `no-restricted-imports` 规则会检测并报 error 拦截违反此约定的导入。

### 6. 异步竞态测试依赖微任务顺序（假 GREEN）

依赖「`A` 的 setState 排在 `B` 之后」这种微任务 FIFO 顺序来断言竞态保护，**不构成有效 RED 测试**。

**陷阱**：`await Promise.all([...]).catch(...)` 或 `Promise.allSettled` 链中，`.catch()` / `.finally()` 为每个 promise 引入额外微任务跳，使未修复代码的 setState 顺序在 V8/Node 下碰巧与有修复时一致——测试在 unfixed 代码上**也通过**，无法暴露 bug。

**正确做法**：让**先 `setState` 的回调主动 `resolve` 后入队的 promise**，把后者的 setState 强制排进下一轮微任务，确定性暴露顺序差异。

**回归验证**：提交前临时删除被测守卫（generation 计数器 / 锁 / AbortController），测试必须 RED；恢复后 GREEN。

### 7. 无设计记录的 vendor 补丁（`patchedDependencies`）

`patches/*.patch`（尤其 minified 单行 bundle，如 xterm 系 `lib/*.mjs`）随任何上游小版本即失效，且管线级改动（如 shader 精度 `lowp→highp`）有功耗/性能含义。禁止为"试试是否变好"直接落补丁。

**正确做法**：fork 级改动必须先在任务 `design.md` 立决策条目（含 A/B 对照证据与副作用评估），补丁收窄到最小 diff（如 shader 字符串级而非整文件行替换）；否则回退，另起任务。

**反例**：2026-09-03 终端任务工作树 `lowp→highp` 补丁（433KB、无记录、与"不再做 fork 级改动"终局冲突）→ review B2 回退，stock 恢复。

### 8. CodeMirror 多实例（facet 静默失效）

`@codemirror/view` 的 facet（如 `EditorView.mouseSelectionStyle`）按**模块实例**区分身份。Vite 预打包若产出两份 view——`@uiw/react-codemirror` 链经 `@codemirror/lint` 拉起 nested 旧版，源码走顶层新版——传给 live `EditorView` 的扩展**全部静默失效，无任何报错**。

**反例**：2026-09-09 编辑器滚动后点击错位。`@uiw_react-codemirror.js` 的 `EditorView2` 来自 `chunk-XI6XTRT3.js`（view 6.43.9，经 `@codemirror/lint@6.9.5` 的 nested 依赖），源码 `import` 落在 `chunk-PFGFVYCY.js`（顶层 6.43.11）；`mouseClickGuard()` 注册在 6.43.11 的 facet 上从未被执行；顶层升级（`f4b725dc`）没到达运行时。

**正确做法**（三件套，缺一不可）：
1. `vite.config.ts` → `resolve.dedupe: ['@codemirror/view', '@codemirror/state']`（dev + build 同生效）。
2. `pnpm-workspace.yaml` → `overrides: '@codemirror/view': <单版本>` 消灭 nested 旧版。注意 pnpm v11 **不读** `package.json` 顶层 `overrides` / `pnpm` 字段，必须放 `pnpm-workspace.yaml`。
3. `tools/guards/checks/check_codemirror_singleton.py`（`pnpm lint` 与 CI 都跑）断言 lockfile 单版本。

**验证**：`npx vite optimize --force` 后 `@uiw_react-codemirror.js` 与 `@codemirror_view.js` 必须 import 同一 chunk；`chunk-*.js` 中 `EditorView` 定义仅一处。改 overrides 后删 `node_modules/.vite` 重启 dev。

### 9. WebKit focus 滚动漂移（点击后光标落错/视图被拖回）

**症状**：拖垂直滚动条（编辑器 blur）→ 点击代码区深处，光标落在旧 caret 附近而非鼠标处，视图被「拖回」。`posAtCoords`/`caretRangeFromPoint` 映射本身正确——漂移发生在 **mousedown → mouseup 之间**。

**机制**（`codemirrorMouseClickGuard.ts` + CM 源码实证）：CM mousedown 顺序是 `startMouseSelection` → `focusPreventScroll`（同步 focus）→ `mouseSel.start()`（dispatch 新 selection）。WebKit（WKWebView）下 `focusPreventScroll` **失效**：focus 把视图滚到「旧 caret」所在位置，scrollTop 漂移（无任何 JS 赋值——浏览器原生行为，抓不到 setter 栈）。随后 `start()` 基于漂移后 scrollTop 映射，光标落错。

**判别特征**（排障探针实测）：scrollTop 在 mapped（mousedown）→ event（mouseup）之间变（如 1289→0/235）；`view.dom.isConnected` 恒 true（**view 未重建**，排除快照恢复）；`Element.prototype.scrollTop` setter 追踪零调用（**非 JS 赋值**，排除 scrollIntoView/reconfigure）。

**修复**（已落地 `src/shared/utils/codemirrorMouseClickGuard.ts`，双保险）：
1. **焦点锚定**：`makeMouseClickGuardStyle` 创建时（CM focus 之前）把 `selection` dispatch 到点击处——caret 锚定在视口内的新位置，focus 滚动目标正确。
2. **静止点击恢复 scrollTop**：`get()` 中 `moved < 10px` 且 `scrollTop` 与 mousedown 时偏差 > 2px 时恢复为 mousedown 值再映射。mousedown 的 `start()` 首次调 `get()` 同步完成恢复，视觉无闪。
   **注意**：只在静止点击分支恢复；真实拖拽（moved ≥ 阈值）期间 scrollTop 变化可能是用户拖出视口的 auto-scroll，属意图，不得恢复。

**映射走 CM 原生 `posAndSideAtCoords`**（与 `basicMouseSelection` 同一路径）。不要引入 `caretRangeFromPoint` 自建命中测试层：其针对的「posAtCoords 滚动失准」假设已被证伪（Chromium 探针 `posAtCoords` 与 DOM 真值全一致；双实例期间 guard 完全失效、CM 原生 `basicMouseSelection` 一直工作正常，bug 纯为 scrollTop 漂移）。该层是 2026-09-09 简化移除的误诊设计。

**回归测试**：`codemirrorMouseClickGuard.test.ts` 含 `should_restore_scroll_top_before_mapping_when_focus_scroll_drifted` / `should_not_restore_scroll_top_on_real_drag` / `should_use_native_posandsideatcoords_for_mapping`。

### 10. CodeMirror 扩展身份不稳定（惰性安装的扩展被静默丢弃）

`@uiw/react-codemirror` 在 `extensions` **prop 身份**变化时 dispatch `StateEffect.reconfigure`（无内容相等判断，`useCodeMirror.js` 的 effect 依赖数组含 `extensions`）。`@codemirror/state` 的 reconfigure 会**整体替换 base 配置**，把此前经 `StateEffect.appendConfig` 追加的扩展一并丢弃（state 源码 `applyTransaction`：`reconfigure` 走 `base = effect.value`，`appendConfig` 走 `base = base.concat(...)`）。

**症状**：`@codemirror/lint` 的波浪线（诊断由 `setDiagnostics` 经 `maybeEnableLint` → `appendConfig` 惰性安装）出现后消失——输入时闪烁、保存后消失且不再恢复；**同一份数据的其他呈现（Problems 面板 / lspStore）完全正常**，于是表现为「列表有、波浪线没有」。诊断本身没丢，丢的是**配置里的渲染能力**。

**机制**：任何把**活状态**接进 extensions 依赖的写法都会让宿主每次渲染都 reconfigure：

```ts
// Wrong：内容/脏标记/tab 对象进依赖 → 每次按键重建整个扩展世界
const saveKeymap = useMemo(() => keymap.of([...]), [saveCmKey, tab.isDirty, handleSave]); // handleSave 捕获 currentContent
const lspKeymap = useMemo(() => ..., [projectPath, tab, ...]);                          // tab 每次渲染新建
```

**判别特征**（实证）：
- `Transaction.reconfigured` **不能**用来判「base 被替换」——它只是 `startState.config != state.config`，对 `appendConfig` 同样为 true，会让惰性安装/重放自己触发自己；只认 `tr.effects.some(e => e.is(StateEffect.reconfigure))`。
- `diagnosticCount` 是 lint **合并后**的 range 数，不能与诊断数组长度直接比对。

**正确做法**（三件套）：
1. **配置纯净（I3）**：extensions 的身份只由**配置输入**决定（字体、语言扩展、稳定引用）；活文档内容、`isDirty`、每次渲染新建的对象一律走 ref 或在事件回调内读 store，**禁止**进入依赖数组（`useEditorSave` / `useLspNavigation` / `useCmdClickGoToDefinition` 为参照实现）。
2. **需要跨 reconfigure 存活的字段必须位于 base 且模块级单例**：`StateField.define` 每次调用分配新 id，`slot.reconfigure` 仅在「旧配置里存在同 id 字段」时保留值——写成函数内定义会让字段静默归零。
3. **投影可重建（I2）**：从外部推送一次性安装的装饰（诊断、装饰类扩展）必须在配置重建后能自愈——参照 `src/features/lsp/hooks/lspDiagnosticsProjection.ts`（镜像 StateField 在 base + reconciler 在微任务重放 `setDiagnostics`；CM 更新周期内禁止 dispatch，见 `navigation-goal.md` §4）。

**回归测试**：`lspDiagnosticsProjection.test.ts`（reconfigure 后波浪线自愈 / 推送本身不触发重放 / 镜像位置映射与塌缩丢弃 / 连续重配置合并 / 销毁后不抛）；身份稳定用例在 `UseEditorSave.test.tsx` 与 `useLspNavigation.test.ts`。

### 11. 大 hook 拆分的接缝必须用「改一处只影响一类事件」判定

`useAgentChat` 曾 819 行、36 个 hook 调用、31 个返回值、19 个事件分支。按**行数**
拆会把同一条事件的归约切到两个文件；按**职责内聚**拆才对。

判据：**加一个新工具类别只动一个文件，加一个新配置项只动另一个文件**。

2026-08-24 的实例（`08-24-agent-config-unify` 阶段 6）：
- `useTurnStream`（292 行）= 话轮流（`turn_start` → 工具三件套 → `turn_end`）
- `user_input` / `proposed_plan` / `meta` **留在** `useAgentChat` —— 它们是会话级
  状态（换一轮不清零），不属话轮账本
- 结果：819 → 484，ratchet 基线同批下调 698 → 484

**拆分后必须验证的两种失败模式**：

1. **事件被吞**：子 hook 的 `handle(ev): boolean` 若对未识别事件也返回 `true`，
   调用方的 `if (sub.handle(ev)) return;` 会静默丢掉它不负责的事件 —— 表现是
   「某个卡片再也不出现」，且无报错。护栏：`it.each` 列出所有**不该**认领的
   事件类型，断言返回 `false`。
2. **行为漂移**：抽出的行是否真的一字未改。可行做法是从 `HEAD` 与新文件逐 case
   提取归一化文本比对（忽略缩进与 `break`/`return` 差异），差异必须逐条人工确认。

### 12. 正交状态字段应收成一个 union，不要暴露笛卡尔积

同一状态若由两个**可自由组合**的字段表达，消费方就得各自 `switch` 两个维度 ——
N 个消费点 = N 份必然漂移的实现。

2026-08-24 的实例（`08-24-agent-config-unify`）：会话配置项的可用性曾写成
`{ phase: 'unsupported' | 'loading' | 'ready', capability: 'none' | 'per_turn' | 'session_config' }`。

真实可达的状态只有 **4 个**：

| 状态 | 传输 | 会话就绪 | 可写性 |
| --- | --- | --- | --- |
| `no-config` | `none` | — | 永久否 |
| `per-turn` | `per_turn` | — | 是（每轮请求参数） |
| `pending` | `session_config` | 否 | 暂时否 |
| `ready` | `session_config` | 是 | 是（`set_config_option`） |

9 种输入组合里有 5 种不可达（如 `{phase:'ready', capability:'none'}`），而类型层
允许它们存在。后果是**四份判据各自推导**：`ChatComposer` 用
`phase === 'ready'`、`useModelSelection` 用 `options.length > 0`、渲染层用
`capability !== 'none'` —— 曾经出现「渲染说能点、写入拿不到目标」的矛盾。

**正确做法**：

1. **一个合成入口**（`modelAvailabilityOf`）把后端能力位 + 就绪度映射成 4 态 union；
2. 每个判据都是该 union 上的**全函数**（`switch` 穷举、编译器强制处理新状态，无 `default` 兜底）；
3. 「不可写」不是某个变体，而是**拿不到写回目标**（`modelWriteOf` 返回 `null`）——
   于是「拿到 write 却写不了」在类型上无法表达。

**判据**：新增状态时，如果 `switch` 需要 `default` 分支才能通过编译，说明 union 没穷举完；
如果某个消费点还在 `switch` 两个字段，说明合成点放错了位置。

**同一条规则的推论：派生点也必须是唯一。** union 收好了，但如果还有消费点自己
「再判断一次」，漂移会以另一种形式回来。2026-08-24 第二轮实证：
`useModelsForPicker` 自己数 `options.length > 0` 决定「列表来自会话内还是目录」，
而 `modelWriteOf` 用 `availability` 决定「写回是裸名还是复合串」——
10 种组合里只有 2 种一致。表现是「列表显示 A，写回发的却是 B 的格式」。

修法：让 `useModelsForPicker` 也吃 `availability`，并把「`ready` 只返回会话内列表」
写死 —— 没有列表时返回**空数组**而不是退回目录。退回目录会让用户看到一串
`provider/model` 复合串、而写回通道要裸名 = 「能点但切不动」（R3 禁止）。
**空列表 + 空态文案比一串点不动的模型诚实。**

### 13. 占位值不得是「一个真实存在的实体」

「还没有数据」必须表达成**未知/空**，不能填一个看起来合法的真实值。

2026-08-24 实测（`useChatAgents`）：`agentId` 未落定时 fallback 到
`AGENT_IDS.mockAgent`，于是新建 Chat tab 的首帧永远显示「mockAgent」的名字与图标 ——
与用户实际会用的 agent 无关，且会让用户以为选中了它。

正确顺序：**命中真实数据 → 列表首项 → 空壳（占位图标）**。
硬编码一个真实存在的 agent 比显示「未知」更糟。

同类推论：空列表文案也要按**原因**分开（`loading` / `read-only` / `writable`）。
共用一句 `Models appear once the session is ready` 对不提供模型选择的 agent
（`no-config`）是误导 —— 它永远不会出现。

**判据**：任何 `?? SOME_REAL_ID` 形态的 fallback 都要问「这个 id 是否代表用户的
真实选择」。不是 → 改 `?? undefined` 并在渲染层给占位。

### 14. 「落定值」与「原始值」是两个东西，派生 hook 必须收落定值

当 UI 显示用了 fallback（列表首项 / 占位），而**行为**（建会话、拉数据）用了原始
入参，两者会分叉：界面看起来有 agent，实际什么都没发生。

2026-08-24 实测（`08-24-agent-config-unify`）：新建 Chat tab 时
`AgentChatTabData.agentId` 是 `undefined`。`useChatAgents` 正确地 fallback 到
列表首项（UI 显示正常），但 `useAgentSessionLifecycle` 与 `useAgentModels`
收到的仍是 `undefined`：

- `openSilentSession` 直接 `return` → **会话永不建立**
- `SessionStart.config_options` 永不到达 → `availability` 卡在 `pending`
- `useAgentModels(undefined)` 也直接 `return` → 目录不拉
- **表现：模型列表完全空白**

修法：在组合层算出**落定值**（`const settled = selectedAgent.id`），所有派生
hook 一律收它。落定值为空串（列表还没到）时那些 hook 同样 `return`，不会白建会话。

**判据**：任何「显示用的 id」与「行为用的 id」来自不同表达式的地方，都是分叉点。
护栏要断言**两个消费点都收了落定值**（`composerWiring.test.ts`），只测 hook 自身
行为测不到 —— hook 收到 `undefined` 时「正确地什么都不做」也是全绿的。

### 15. effect 依赖里禁止出现「每次渲染新建的对象」

`useEffect` / `useCallback` 的依赖数组只允许出现：原始值、ref、
`useCallback`/`useMemo` 的产物、模块级常量。**禁止**出现 hook 返回的对象字面量
容器 —— 即使它内部装的都是稳定值。

2026-08-24 事故（`08-24-agent-config-unify`，Pi 与 opencode 同时中招）：

```
useTurnStream 返回对象字面量（每次渲染新建）
  → useAgentChat 的 applyEvent 依赖它 → useCallback 身份每渲染变
  → listen 的 useEffect 依赖 applyEvent → 每次渲染 unlisten + listen
  → session_start（最早到达的事件）落进这个窗口 → 前端永远收不到握手
  → handshaken 恒 false → 模型列表永久停在
    "Models appear once the session is ready"
```

实测：旧代码上 `listen` 注册了 **3 次**，修好后 **1 次**。

讽刺的是那段代码原本有一句注释自称「`refs` 每次渲染都是新对象字面量 —— 这是
**有意的**」。那个理由只对 `refs` 成立（消费方只用其中的 ref），对整个返回值是错的。

`react-hooks/exhaustive-deps` **抓不到**这类问题 —— 依赖数组是「完整」的，只是
不稳定。护栏要断言**注册次数**（`expect(mockListen).toHaveBeenCalledTimes(1)`），
而不是断言源码里出现了某个标识符。

### 16. JSDoc 举例没有实现支撑的语义（声明了却没人实现 = 静默功能缺失的文档版）

类型/注册表的 docstring 写「handler 自行判断是否接收（例如流式进行中不许改写输入框）」，但全仓唯一生产 handler 恒 `return true` —— 声明的能力没有消费点，与红线 14 同型（2026-10-13 实证：`agentInputRegistry.ts`，修法是删掉该举例并写明「今日 false 的唯一原因是未登记」）。

**判据**：docstring 里的每个「例如」必须能在生产代码里 grep 到对应分支；找不到 = 删例或补实现，二选一。不接受「以后可能用到」的举例 —— 那是 YAGNI 在文档层的形态。

### 17. `mergeTabData` 是**穷举白名单** —— 新增 tab data 字段必须同步登记

`editorStore.mergeTabData` 对每个 kind **逐字段重建**（`'x' in p ? p.x : d.x`），
不是浅合并。它的存在有理由（阻止跨 kind 污染、自动去除非本 kind 字段），但代价是：
**给 `XxxTabData` 加一个字段而忘了在 switch 里登记，那个字段就永远写不进去且不报错**。

2026-10-22 事故（`08-24-agent-config-unify`）：

```
AgentChatTabData 新增 modelId
useSelectedModel 的 effect 每次渲染都 updateTab({ modelId })
mergeTabData 的 agent-chat 分支只回填 agentId / sessionId  → modelId 被丢弃
切 tab 回来 initialModelId 为空 → 落到 models[0] → 「切个 tab 我的模型自己变了」
```

功能完全没生效，而那条行为测试是绿的：它 `vi.mock` 掉了整个
`@/shared/store/editorStore` —— **保护的是 mock，不是行为**。

**判据**：新增 tab data 字段时，同一 diff 内必须给
`editorStore.test.ts` 加一条**跑真 store** 的「写入后能读回」用例（不得 mock
store）。`resumeConversationId` / `resumeNativeSessionId` 曾是同一个 bug 的受害者。

> 注：显式写 `undefined` 是**清除**语义（切 agent 丢模型、恢复标记一次性消费），
> 所以判据必须是 `'x' in p`，**不能**是 `p.x !== undefined`。

### 18. 护栏必须跑**真依赖**，并且断言身份/行为而不是字面量

§15 已说明「依赖数组里禁止每次渲染新建的对象」，本批又出现三个同型变形，
统一判据：

**(a) 一个返回值混了两种稳定性 → 必须在类型层拆开。**
`useSessionLevelEvents` 曾把稳定的 `handle` 与每次状态变化都换的 state 快照	
装进同一个 `useMemo`，并把 state 写进依赖数组 —— 身份仍随每个 `meta` 事件变化。
正确做法是返回 `{ handle, state }`，调用方只能把 `handle` 放进依赖。

**(b) 注释里的已删符号会让静态断言**假绿**。**
`expect(SELECTION).toContain('modelSourceOf')` 命中的是源码里一条过时注释，
函数早就不存在。凡是对源码做字符串断言的护栏，必须先剥注释（参照后端
`agent_model_dispatch_test.rs::code_only`）。

**(c) 判据要钉在「不变量」上，不是「某个标识符出现了」。**

| 弱判据（会被绕过） | 强判据（钉住语义） |
| --- | --- |
| 源码里有 `useMemo` | 状态变化后 `handle` 身份**不变** |
| 源码里有 `closeRunningTools(` | 已 `failed` 的工具不被改写成 `done` |
| 组件有 `disabled` prop | 上半真的会传 `read-only`（且逐项 `toBeDisabled`）|
| `updateTab` 被调用过（mock） | 写入后**从真 store 读回**得该值 |

**(d) 间接使用 ≠ 被测。** `closeRunningTools` 被 `useTurnStream` 的 `turn_end`
用例间接走到，但那条用例里的唯一工具就是 `running` 的 —— 删掉
`status === 'running'` 判据它仍然绿。纯 reducer 要直测，且必须包含**反例**
（不应被改的那一类）。

---

## 必需模式

### 1. TypeScript 严格模式合规

项目使用严格 TypeScript（`strict: true`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`）。所有代码必须通过 `tsc --noEmit`。

### 2. 所有非根组件使用 `React.memo`

在 Props 与 Context 混合分发架构中，用 `React.memo` 包裹组件导出以防止不必要的重渲染：

```tsx
export default React.memo(MyComponent);
```

> **豁免（2026-08-29）**：纯装配组件可不包 memo —— 其 props 为每次渲染恒新的对象/数组字面量（如 `app/utils/ComposeProviders.tsx` 接收 providers 数组），memo 比较永不命中，属死重。判定标准：**props 引用有可能稳定时才包 memo**；新增此类豁免组件时在此处登记。

### 3. 所有回调 Props 使用 `useCallback`

任何作为 prop 传递的函数都必须用 `useCallback` 包裹：

```tsx
const handleSelect = useCallback((id: string) => {
  setActiveProjectId(id);
}, []);
```

### 4. Tauri 调用的错误处理

所有 `invoke` 调用都用 try/catch 包裹，并使用 `console.error`：

```tsx
import { saveConfig } from "@/features/settings/api/settingsApi";

try {
  await saveConfig(config);
} catch (e) {
  console.error("[App] Failed to save config:", e);
}
```

日志前缀格式为 `[模块名]`（如 `[App]`、`[Terminal]`）。

---

## 测试要求

使用 **Vitest** + **React Testing Library**。详见[单元测试指南](../unit-test/index.md)。

- 测试文件：`*.test.ts` / `*.test.tsx`，与源文件放在一起
- Hook 测试：`renderHook` + `act` / `waitFor`
- 组件测试：`render` + `screen` 查询
- 在 `src/testing/setup.ts` 中全局 mock Tauri API（`vitest.config.ts` 的 `setupFiles` 指向它）

---

## 代码审查清单

提交代码前，验证以下项目：

- [ ] `pnpm check:quick` 通过（它的 lint 档就是 eslint + `tsc --noEmit`，**不要**再单独跑 `pnpm lint:fe`）
- [ ] 没有引入新的无理由 `any` 类型
- [ ] 新组件使用 `React.memo` 导出
- [ ] 作为 Props 传递的回调使用了 `useCallback`
- [ ] Tauri `invoke` 调用有错误处理
- [ ] 领域模型类型从 `@/shared/types` 导入（没有本地重复声明）
- [ ] 新的组件子目录有桶文件 `index.ts`
- [ ] 没有在 `api/` 目录外直接 import `invoke`（使用对应域的 API wrapper 或 `connectionApi` 再导出）
- [ ] Tauri 事件监听器在 `useEffect` 返回函数中清理
- [ ] 所有 `.tsx` 文件使用 PascalCase，`.ts` 文件使用 camelCase（`check-file/filename-naming-convention`）
- [ ] 目录名使用 kebab-case，`__tests__` 除外（`check-file/folder-naming-convention`）
- [ ] 没有未使用的导入或变量（`noUnusedLocals` 强制执行）

---

## 构建与 CI

### 本地开发

```bash
pnpm dev          # 启动 Vite 开发服务器（端口 1420）
pnpm tauri dev    # 启动完整的 Tauri 开发环境
```

### 质量门禁

```bash
pnpm lint           # 全部静态检查：lint:fe（eslint + tsc）+ lint:rust:all-targets（cargo fmt + clippy 全目标）+ 护栏
pnpm lint:fe        # 仅前端静态检查（pre-commit 与 CI 跑的就是这条）
pnpm type-check     # 仅 TypeScript 类型检查
pnpm lint:fix       # 写回修复：cargo fmt（Rust）+ eslint --fix（前端）
pnpm test:fe        # 跑一次前端测试（push 档用它）
pnpm test:fe:coverage  # 带覆盖率跑同一套（CI 用它；地板见 vitest.config.ts）
pnpm test           # 三套串接：test:fe + test:rust + test:host
pnpm check          # 本地全量：lint + 两套单元测试 + host 自检（--jobs auto，按机器并发）
pnpm check:quick    # 开发循环的默认检查（纯业务改动 ~12s，见下表）；覆盖面窄于 check，全量留给 push（见下）
```

> 命令的**定义单点在 `package.json`**（本文件只引用脚本名）。hook 与 CI 调用的名字必须与它一致 ——
> 这是必需的：改名时漏改一处，门就会静默失效。
>
> **`pnpm check` 走并发（`--jobs auto`）**：命令门禁之间由框架用线程池调度，并发度取
> `min(cpu_count, 4)` —— 上限 4 是因为长杆 `test_fe` 自带 vitest 的 6 worker，再高的门禁并发
> 只放大竞争衰减（实测 `lint_fe` 在 `--jobs 4` 下已从 9.5s 劣化到 34.5s）而长杆不会变快；
> CPU < 4 时退回串行。`auto` 是**显式选择的取值**，`--jobs` 的默认值仍是 1（串行）——
> 「默认 = 无过滤 + 串行」是框架契约（`tools/guards/tests/test_cli.py` 有意钉住），
> `commit` 档（增量快反馈）不应继承本地全量的并发选择。派生的唯一定义在
> `tools/guards/core/platform.py::default_jobs`，`package.json` / `lefthook.yml` 的 pre-push /
> CI 都写 `--jobs auto` 复用它；**调用点不得把上限抄成字面量 `--jobs <整数>`**
> （护栏 `check_gate_topology` 的 A5 判据强制 —— 否则调上限只改到框架侧，push 档与本地档
> 会真的跑出不同并发度）。要一次性覆盖才在命令行显式传正整数（`--jobs 3`）。
>
> **`pnpm check:quick` 是开发循环的默认检查** —— 开发期一律跑它，不要本地跑 `pnpm check`。
> 它的覆盖面窄于全量（见下表），全量由 `pre-push` hook 与 CI 承担。
>
> **频次：收尾跑一次，不是每改一个文件跑一遍。** 它已含全部静态检查，所以开发中也不要
> 单独补 `pnpm lint` / `pnpm test` / `pnpm type-check` —— 那些不是更细的检查，只是重做
> 同一批工作（额外付出进程启动与冷缓存代价）。把一轮改动攒完再确认绿。唯一例外是 TDD 的
> 红绿反馈：跑**单个**测试文件（`vitest related <file>` / `cargo test <name>`）是观察，不是门禁。
>
> 定位（第一性原理）：**阶段边界按延迟预算划，不按语言划** —— 这条原则本仓库早已写在
> `lefthook.yml` 文件头（commit = 快静态检查 / push = 全套分钟级门禁 / CI = 三平台终审）。
> `check:quick` 就是其中的「开发循环档」：**不该让人等的不在这，分钟级的留在 push**。
> 它的边界不是「改动文件」—— 改动集只是「单元测试」这一项需要的机制。
>
> | 轻量（本命令，~12s 暖缓存） | 重量（`pnpm check` / push） |
> | --- | --- |
> | 静态检查：eslint + tsc + fmt + clippy | 集成测试 |
> | 仓库护栏（进程内判据，清单即 `checks/` 目录） | 全量单元测试（`test_fe` 74–132s / `test_rust` 26–48s） |
> | 改动文件的单元测试（`vitest related`） | 覆盖率地板、生产打包 |
>
> **耗时构成与三个前提**（2026-10 实测，10 核机器）。这三条任一不成立就会退到 60–140s，
> 所以遇到「变慢了」先按顺序排除它们，而不是去查代码：
>
> | 项 | 耗时 | 失效时的代价 |
> | --- | --- | --- |
> | `eslint --cache` | 2s | **缓存冷跑 72s**（`rm .eslintcache` / 新 clone / 换分支） |
> | `tsc --incremental` | 1.6s | 无 tsbuildinfo 时 20s（旧实现每跑一次都全量） |
> | `vitest related` | 5–8s | 改动命中 `shared/store` 这类共享节点时退化到 30s（反推上百个测试） |
> | 护栏自测（653 用例） | 0s（跳过） | 改动触及 `tools/guards/**` 时才跑，5s |
>
> 前两项的缓存**不是优化而是命令的一部分**：`lint:fe` 的 eslint 带 `--cache-strategy content`，
> `type-check` 带 `--incremental --tsBuildInfoFile node_modules/.cache/…`。用内容哈希而不是
> mtime 是关键 —— `checkout` / `git clean` / `touch` 都会改 mtime 但不改内容，用默认的 metadata
> 策略会让 CI 和刚切完分支的本地都白冷跑一遍（实测：内容不变只改 mtime ⇒ metadata 策略 72s，
> content 策略 1.8s）。
>
> **静态检查不在这里自造清单**：它直接复用框架的「lint 档」（`runner.execute(stage="local",
> suite="lint")`）。框架的 `kind=lint` 就是「静态检查」这个概念的**唯一定义点** ——
> 新增一条 lint 门禁会自动纳入本命令，这里一行都不用改。早先的实现把 `eslint` / `tsc` /
> `lint:rust:all-targets` 抄在这里，那是一份与 `gates.json` 重复、必然漂移的清单。
>
> **只有单元测试需要「改动集」**：前端用 `vitest related <改动文件>`（vitest 原生按 import
> 图反推）。两处**不做而是声明缺口**（都不静默跳过，否则「绿」会被读成「都查过了」）：
> - `.rs`：Rust 无 import 图，`cargo test` 的粒度是整个 crate，推不出该跑哪些测试。
> - `tools/java-host/**`：它的**唯一**门禁就是重量级的 `test:host`（本命令不含）。
>   —— 该目录不受任何 lint 门禁覆盖，所以这条声明尤其重要。
>
> **`vitest related` 的盲区**（这是它覆盖面窄于 `check` 的根本原因）：动态 `import()`、
> `vi.mock` 隔离掉真实依赖、模块级单例（store）造成的跨文件影响都可能**漏判**。
> 因此「没有相关测试」被显式报告为**失败**而不是通过（`vitest related` 在该情形下退出码
> 仍是 0，当成通过就是本仓库反复踩的静默绿失效模式）。
>
> **退出码三档与门禁同构**：`0` 通过 / `1` 有代码问题 / `2` 是**工具/环境问题**
> （工具链缺失、单步超时）—— 2 必须与 1 可区分，否则「跑不起来」会被当成「代码有问题」，
> 把人引向不该改的地方。
>
> **护栏自测按改动集分层**：`selftest` 挡在所有护栏前面，但它只回答「护栏的判据本身是否
> 可信」，而这个问题只在 `tools/guards/**` 变动时才可能改变。判据与框架的
> `_apply_framework_rule` 同源（`core/runner.py::_selftest_is_due`）：改动触及框架才跑，
> 否则跳过并**在输出里声明跳过**（不静默）；改动集为空时（全量档 / 拿不到改动集）一律跑 ——
> 「无从判断」不能读成「不用跑」。
>
> 执行本身复用 `tools/guards/core/proc.py`（「怎么跑外部命令」的唯一实现：cwd / 超时 /
> 进程组清场）—— 与门禁共用同一份，不抄第二份平台相关逻辑（Windows 只能杀直接子进程）。
> 实现：`tools/guards/core/quick.py`（薄启动器 `tools/guards/quick.py`）。
>
> **覆盖率是 CI 门禁，不进本地 hook**（延迟预算）：`vitest.config.ts` 的全局地板与 per-file pin
> 只在 `pnpm test:fe:coverage` 下判定 —— 该命令此前没有任何调用方，于是 pin 漂了也没人知道
> （`useFileEditorLsp.ts` 的 100% 就是这么失效的）。**动了带 pin 的文件，本地就跑一次它。**

### CI 流水线（`.github/workflows/ci.yml`）

在 push/PR 到 `main` 时运行：

- `frontend-check`：`pnpm lint:fe`（eslint + tsc，无平台差异 ⇒ 单平台）
- `frontend-test`：`pnpm test:fe:coverage`（测试 + 覆盖率地板）
- `frontend-build`：`pnpm build`（生产打包门 —— bundle 期问题不再延迟到发版 tag 才暴露）
- `backend-check`：`cargo check`（三平台矩阵）+ `pnpm lint:rust:all-targets` + `pnpm guards run --stage ci`
- `backend-test`：`pnpm test:rust`（三平台矩阵）
- `backend-coverage`：`pnpm test:rust:coverage`（仅 ubuntu，按路径过滤；见后端 spec 的覆盖率要求）
- `java-host-check`：`pnpm build:host`（内含 `pnpm test:host` 的同一份自检）

### 发布构建（`.github/workflows/build.yml`）

在版本标签（`v*`）触发：
- 构建 `.exe`、`.msi`（Windows）、`.dmg`（macOS）、`.AppImage`、`.deb`（Linux）
- 创建 GitHub Release 并附带构建产物

---

## 架构原则（前端）

### 组件设计

1. **单一职责**：一个组件只负责一个 UI 概念。如果组件超过 200 行，考虑拆分。
2. **逻辑下沉**：业务逻辑放在 hook 中，组件只负责渲染。禁止在组件中直接调用 `invoke`。
3. **Props 最小化**：只传递组件实际需要的数据，禁止透传大量不相关 props。
4. **组合优于继承**：使用 `children` 和 render props 模式，而非通过 props 控制渲染分支。

### 状态管理

1. **就近原则**：局部 UI 状态用 `useState`，跨组件共享用 feature store，全局用 `shared/store`。
2. **禁止冗余**：能从 props/store 派生的数据不用 `useState` 存储，用 `useMemo` 计算。
3. **单向数据流**：子组件通过回调通知父组件，禁止直接修改父级状态。

### 依赖方向

1. **单向依赖**：`features/` 之间禁止互相引用，跨域通信通过 `shared/` 或 `useAppShell`。
2. **API 封装**：所有 `invoke` 调用封装在 `api/` 目录，禁止在组件/hook 中直接 import `@tauri-apps/api/core`。
3. **类型共享**：跨域类型定义在 `shared/types/`，禁止在组件内重复定义接口类型。

---

## TDD 要求（前端）

### 开发流程

1. **定义接口**：先写 props 类型 / hook 签名。
2. **编写测试**：覆盖正常渲染、用户交互、边界情况、错误状态。
3. **确认失败**：运行测试，确认红色（测试失败）。
4. **实现功能**：写最少代码让测试通过。
5. **重构优化**：消除重复，提升可读性，保持测试绿色。

### 测试规范

- 测试文件：`*.test.ts` / `*.test.tsx`，与源文件同目录
- Hook 测试：`renderHook` + `act` / `waitFor`
- 组件测试：`render` + `screen` 查询
- 每个测试只验证一个行为
- 测试描述使用 `it('should <预期行为> when <条件>')` 格式

### 覆盖率要求

| 类型 | 最低要求 |
|------|---------|
| 纯函数 / utils | 100% |
| 自定义 Hooks | 关键行为 100% |
| 业务组件 | 关键交互路径 |

---

## 字体角色约定（Typography SSOT）

> 统一终端/编辑器/UI 字体栈，消除 4 处 mono 分裂 + 3 处 sans 硬编码。详见 `src/shared/utils/typography.ts` 与 `src/styles/base/variables.css`。

### Token 角色

| Token | 角色 | 消费方 |
|-------|------|--------|
| `--font-ui` | UI sans（系统栈） | `body`, LSP hover/signature doc, 面板标题等非等宽文本 |
| `--font-mono` / `--font-code` | mono 等宽（JetBrains/Cascadia + Nerd） | xterm, CodeMirror, markdown 代码, LSP 单行, agent-chat `font-mono` 类 |
| `--line-height-mono` | mono 行高 1.5 | xterm `lineHeight`, `.cm-content` |
| `--mono-fg` / `--mono-fg-dim` | mono 前景（终端+编辑器共用） | `buildTerminalTheme`, `createCmTheme` |

- `--font-code = var(--font-mono)` 为 Tailwind `@theme inline` 桥接别名（避开 `@theme` 键自引用）。`font-mono` / `font-sans` 工具类分别解析到 `--font-code` / `--font-ui`，随用户设置自动跟随。

### JS 单一真相

- 默认栈：`SANS_DEFAULT` / `MONO_DEFAULT`（与 theme.css 静态默认保持一致）。
- 构造器：`buildMonoStack(userOverride)` / `buildSansStack(userOverride)` — 唯一构造，含 Nerd fallback。
- 单一写入口：`syncTypographyTokens({ monoFamily, uiFontSize, monoFontSize, monoLineHeight })` — 仅 `useAppConfig` 调用，写入 `--font-mono` / `--font-size` / `--terminal-font-size` / `--line-height-mono`。
- 字号和谐：`resolveTerminalFontSize(ui, terminal?)`（默认 ui+2） / `resolveEditorFontSize(terminal, editor?)`（默认 = terminal） / `resolveEffectiveSizes(ui, terminal?, editor?)`。非法值回退到和谐值，范围 10–24。
- 配置字段：`monoFontFamily`（新，mono 角色）+ `uiFontFamily`（预留），旧 `fontFamily` 仅兼容读取，写入时同步回填。

### 使用约定

- CSS 消费：`font-family: var(--font-mono)` / `var(--font-ui)`；前景 `color: var(--mono-fg)`（编辑器）或 `foreground: var(--mono-fg)`（终端主题）。禁止新增裸 `font-family: "...", monospace` 硬编码（仅 `nerd-font.css` 例外）。
- Tailwind 消费：`class="font-mono"` / `font-sans`（已桥接到角色 token）。
- xterm：`new Terminal({ fontFamily: buildMonoStack(...), lineHeight: MONO_LINE_HEIGHT })` + `options.lineHeight` 同步。
- CodeMirror：`createCmTheme(monoFamily, size)` 内部 `buildMonoStack`，前景 `var(--mono-fg, var(--text-primary))`。
- 校验：护栏 `check_font_family_guard`（`pnpm guards run --only check_font_family_guard`，扫描 `src/styles/**/*.css` 裸 `font-family:`）；`themeTokens.test.ts` 守卫各主题 `--mono-fg` 齐全。

## 依赖补丁与 Vite 预打包缓存（改 `node_modules` 必守）

> 原根 `AGENTS.md`「已知问题」条目，2026-09-25 迁入本文件。

改了 `node_modules`（`pnpm patch` / `patches/*.patch`）后，Vite 依赖预打包（`node_modules/.vite/deps`）
按 **lockfile 哈希**缓存，不失效就会继续跑旧代码，表现为「改了包却没生效」。

**正确流程**：`pnpm patch <pkg>@<ver>` → 编辑 `.pnpm_patches/` 下的文件 → `pnpm patch-commit <dir>` →
`pnpm install`。补丁文件**必须纳入 git**，否则新克隆 `pnpm install` 会因缺补丁文件而失败。

**只"重启 dev server"不够**（2026-09-19 实测）：缓存键是 lockfile 哈希，而 patch 改动不进 lockfile
哈希，因此仍命中旧 bundle。必须 `rm -rf node_modules/.vite`（或 `npx vite optimize --force`）后再重启。

失效症状是「列表正常但补丁里的新逻辑完全没跑」（无任何新请求发出），极易误判为业务逻辑错误 —— 排查
`patches/*.patch` 相关行为前先确认缓存已清。与「### 8. CodeMirror 多实例」是同一缓存层的两种症状。
