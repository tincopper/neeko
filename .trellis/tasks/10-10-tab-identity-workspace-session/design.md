# design — Tab 身份模型：按 Workspace 值对象寻址

> 配套 `prd.md`。类型设计 + 构造律 + 迁移映射。三轮方案讨论的终稿（防御纵深 M1–M5 方案已否决：
> 检测器面向「已生产的错误值」，模型错误被保留；本设计使非法状态不可表示）。

---

## 1. 设计原则（四条，顺序即优先级）

**P1 身份词汇封闭**：身份只有三种形态，不存在第四种。

| 形态 | 类型 | 铸造点（唯一） | 用途 |
| --- | --- | --- | --- |
| 项目身份 | `ProjectId`（品牌 string） | api wrapper 层（后端 UUID 到达处） | 项目粒度接口（环境探测、settings） |
| Workspace 身份·值 | `WorkspaceSession`（class） | 身份源：`activeWorkspaceSession` / 后端回显 / golden 测试 | 跨层传递、tab 地址、命令寻址（10-09 同用） |
| Workspace 身份·索引 | `WorkspaceKey`（品牌 string） | **仅** `session.key` getter | 只出现在 map/record 的键位 |

**P2 键是投影不是拼装**：`WorkspaceSession.key` 是属性（getter，构造后缓存），散件拼装函数
退役。与 Rust 对称：

```rust
// src-tauri/src/common/git/workspace_ref.rs:198（现状，不动）
pub fn key(&self) -> String { format!("{}{KEY_SEP}{}", self.project_id, ...) }
// 模块注释：「生产代码持 WorkspaceRef 本体，不从字符串逆向拼装身份」
```

**P3 键由 tab 推导**：store 键从 tab 携带的对象内部导出，`addTab` 签名取消外部键参数 ——
键与身份不一致在构造上不可能。

**P4 层级归位**：`__app__` 是 `App → Project → Workspace` 层级中 App 节点的合法空间，
用联合类型吸收，不用哨兵字符串绕过。

---

## 2. 核心类型（落点：`src/shared/utils/workspaceRef.ts` + `src/shared/types/workspace.ts`）

### 2.1 `WorkspaceSession` class（替换现 interface）

```ts
// src/shared/types/workspace.ts
/** 项目身份品牌。铸造点唯一：api wrapper（后端返回 UUID 处 cast 一次）。 */
export type ProjectId = string & { readonly __projectId: unique symbol };

export class WorkspaceSession {
  private constructor(
    readonly projectId: ProjectId,
    /** 后端回传的 canonical worktree 身份串；null = 主 checkout */
    readonly worktreePath: string | null,
  ) {}

  /** 唯一的 key 铸造点（≡ Rust WorkspaceRef::key()，golden 测试双端钉住）。 */
  get key(): WorkspaceKey {
    // 惰性缓存：构造后首次访问计算，之后返回同一引用
    return (this.#key ??= mintWorkspaceKey(this.projectId, this.worktreePath));
  }
  #key?: WorkspaceKey;

  /** 构造只发生在身份源。 */
  static of(projectId: ProjectId, worktreePath: string | null): WorkspaceSession;

  /** 反解：仅日志 / golden 测试。生产代码禁用（对齐 Rust parse_key 禁令）。 */
  static fromKey(key: string): WorkspaceSession | null;
}
```

要点：

- **class + 私有构造**：interface 挡不住手搓字面量冒充 session；私有构造把「身份源单点」
  从纪律变成编译约束。
- **getter 挂原型，不入 wire**：`JSON.stringify(session)` 只产出
  `{ projectId, worktreePath }`，发给后端的载荷与现状逐字节一致 —— 10-09 的
  「wire 契约不变」自动满足。
- **`ProjectId` 拆包即铸型**：`useProjectStore` 的 `projects[].id`、`activeProjectId`
  等来源在 api wrapper 返回处 cast；store 内部字段类型改为 `ProjectId`。

### 2.2 `mintWorkspaceKey`（模块私有）

现 `workspaceKeyOf` 的实现体降级为**模块内私有函数** `mintWorkspaceKey`，仅被
`session.key` getter 调用。公开导出删除。

### 2.3 `TabScope`（落点：`src/shared/types/tab.ts`）

```ts
/** Tab 的领域归属：App 节点（设置/全局面板）或某个 Workspace。 */
export type TabScope =
  | { kind: 'workspace'; session: WorkspaceSession }
  | { kind: 'app' };

export interface Tab {
  id: string;
  scope: TabScope;          // ← 唯一身份字段（替代顶层 projectId）
  title: string;
  order: number;
  data: TabData;            // FileTabData.workspace 删除（上提到 scope）
}

/** 键推导唯一实现：'workspace' → session.key；'app' → '__app__'。 */
export function tabSpaceKeyOf(scope: TabScope): string;
```

兼容读取（迁移期 helper，M3 结束后评估退役）：

```ts
/** 消费方只需项目粒度时的投影读取。 */
export function tabProjectId(tab: Tab): ProjectId | null;
```

---

## 3. 构造律（落点：`src/shared/store/editorStore.ts`）

```ts
// 旧：addTab: (spaceKey: string, tab: Tab, targetGroup?) => void
// 新：
addTab: (tab: Tab, targetGroup?: EditorGroupId | 'pinned') => void;
// 实现：const key = tabSpaceKeyOf(tab.scope);
```

连带收敛（同 store）：

- `closeTab` / `activateTab` / `updateTab` / `clearProjectTabs` 等带键方法：保留键参数
  （读取路径，无构造风险）。
- **落地口径（实现期决策）**：键形参最终为 `string`（形参名仍沿用 `projectId`，已加注释说明
  「名 `projectId` 实为 tab 空间键 `WorkspaceKey | '__app__'`」），**未引入 `TabSpaceKey` 品牌**——
  `tabSpaceKeyOf` 返回 `string`，铸造品牌会级联到全部读取调用点却无构造收益（读取路径无「键/身份
  不一致」风险，该风险只在 `addTab` 构造律，已由 `addTab(tab)` 消除）。`ensureLayout` /
  `editorLayout` record 键同为 `string`。若日后需要品牌，属独立批次（读路径收敛）。

**为什么不保留 `(key, tab)` 重载**：保留即允许不一致，构造律失效。30+ 调用点一次迁清
（编译器枚举），不留渐进口径。

---

## 4. `__app__` 空间

现状：`ProjectView.tsx` / `useTabManagement.ts` 用 `'__app__'` 哨兵。迁移后：
`{ kind: 'app' }` scope → `tabSpaceKeyOf` 产出 `'__app__'`（字面量保留在**唯一实现处**
`tabSpaceKeyOf` 内部，其余代码不得出现该字面量 —— 护栏判据）。

设置页/全局面板的 tab 以 `{ kind: 'app' }` 构造，其余路径零感知。

---

## 5. 迁移映射（Tier）

### Tier 1：身份词汇（M1）

| 现 | 目标 |
| --- | --- |
| `workspaceKeyOf(projectId, path)` 公开函数 | `WorkspaceSession#key` getter（内部 `mintWorkspaceKey`） |
| `parseWorkspaceKey(key)` 生产消费 | `WorkspaceSession.fromKey`（仅日志/测试） |
| `workspaceKeyLabel(key)` | 保留，内部改走 `parseWorkspaceKey` 逻辑（展示形态不变） |
| 裸 string 的 project id 槽位 | `ProjectId` 品牌（api wrapper 铸造） |

### Tier 2：Tab 模型（M2）

| 现 | 目标 |
| --- | --- |
| `Tab.projectId: string` | `Tab.scope: TabScope` |
| `FileTabData.workspace` | 删除（上提：`tab.scope.kind === 'workspace'` 即有 session） |
| `addTab(spaceKey, tab, ...)`（33 调用点） | `addTab(tab, ...)`（键内部推导） |
| `createUntitledFileTab(tabKey, projectId, ...)` 等 helper | 收 `scope` 单参 |
| `useTerminalTabs.addTab/addTab(projectId, agentId...)` | 收 `scope`；`tab.scope` 携带 session |
| `ConversationsPanelWrapper` `projectId: currentProjectId ?? tabKey ?? 'conversation'` | `{ kind: 'workspace', session }`（该隐患点顺带根除） |

### Tier 3：消费面（M3）

`tab.projectId` 全部消费点改投影读取（编译器枚举）：

| 消费点（类别） | 迁移 |
| --- | --- |
| `usePaneAgents` / `usePaneTabs`（事故路径） | `projectIdForCheck = tabProjectId(tab)`（环境探测按 P1 收 `ProjectId`） |
| `PaneContent` 各 kind 分发 | `projectId={tabProjectId(activeTab)}` / git 类命令改 `activeTab.scope.session` |
| `FileViewer` / `FileEditor` / `BrowserTabView` / `HtmlPreview` | 同上 |
| `useBinaryImagePreview` / `trackActivity` / `recentFilesStore` | `tabProjectId(tab)` |
| `useEditorViewSnapshot`（断点键） | 键改 `tab.scope` 派生（断点状态按 Workspace 隔离 —— 10-08 公理的兑现） |
| `navigationHistoryStore`（`loc.projectId`） | `loc` 改持 `TabScope` |

### Tier 4：退役与纵深（M4）

| 项 | 落点 |
| --- | --- |
| `workspaceKeyOf` 入 `RETIRED_FRONTEND` 台账 | `tools/guards/checks/check_workspace_identity.py` |
| 护栏新判据：`projectId:` 槽位赋值标识符含 `Key` 尾缀（`projectId: tabKey` 形态）命中即违规 | 同上，判据 8 |
| 护栏新判据：`'__app__'` 字面量只允许出现在 `tabSpaceKeyOf` 实现文件 | 同上 |
| Rust `project_context` NUL 校验 → `Invalid project id` + `#[test]` | `src-tauri/src/app_state.rs` |

---

## 6. 测试策略

| 层 | 测试 |
| --- | --- |
| 类型 | 负向类型测试（`@ts-expect-error`）：`ProjectId` ↔ `WorkspaceKey` 互斥赋值、裸 string 不可赋 `ProjectId` |
| 单元 | `session.key` golden ↔ Rust `WorkspaceRef::key()`（改造既有 `matches the backend key contract`）；`JSON.stringify(session)` 字段白名单；`fromKey` 往返；`tabSpaceKeyOf` 两分支 |
| 回归 | 原事故路径：agent tab 创建 → 身份无 NUL；键-身份一致性（9 kind 抽测：构造后 `tabs[session.key]` 命中该 tab） |
| 既有 | `pnpm check` 全绿；`check_workspace_identity` 护栏扩展判据自测 |

---

## 7. 风险与开放问题

| # | 风险/问题 | 处置 |
| --- | --- | --- |
| 1 | 迁移面大（33 addTab 调用点 + `tab.projectId` 消费点遍布 editor 域） | M1 先行 → 编译器枚举清单；M2/M3 分期合入；每期 `pnpm check` 全绿 |
| 2 | 10-09 并行期出现第二 `WorkspaceSession` 定义 | 本任务持有定义；开工顺序上 M1 优先合入，10-09 rebase 复用（两任务 PRD 互相声明） |
| 3 | class 序列化（zustand persist / 结构共享）行为差异 | editorStore 无 persist；`activeWorkspaceSession` 派生点返回新实例 —— golden 单测钉 `JSON.stringify` 形态 |
| 4 | `readFileContent(ws: WorkspaceSession)` 等既有消费接口 | 兼容：class 实例满足结构（readonly 字段同名），仅来源受限 —— TS 结构类型下无需改这些签名 |
| 5 | open：`useEditorViewSnapshot` 断点键从 `projectId` 改 Workspace 派生是否改变用户可见行为 | 按公理应改（断点按 Workspace 隔离）；实现期若发现跨 worktree 断点共享有依赖场景，回退为 `tabProjectId` 并在 spec 记录例外理由 |
