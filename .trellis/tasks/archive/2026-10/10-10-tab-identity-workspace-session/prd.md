# PRD — Tab 身份模型：按 Workspace 值对象寻址（session 持有 key 投影）

> 状态：planning · 优先级 P2 · 负责人 tincopper
> 挂靠：`.trellis/tasks/10-08-workspace-naming`（领域模型公理）· `.trellis/tasks/10-09-git-command-workspace-session`（`WorkspaceSession` 类型复用条款）
> 设计详情：`design.md` · 分步执行：`implement.md`

---

## 1. 背景与事故证据链

### 1.1 事故现场

打开项目后点击 Agent 报错：

```
[Frontend Error] Not found: Project not found: 3122d984-3c86-4ba4-b67c-105ed5b69853
```

对 `~/.neeko/neeko.log` 错误行做字节级分析（hexdump）：前端传给
`check_agents_installed` 的 `project_id` 实际为 **37 字节** —— 真 ID（36 字节）末尾多一个
NUL（`\0`）。后端 `project_manager` 中该 ID 存在（`sessions.json` 可查、同会话
`set_active_workspace` 用同一 ID 成功挂载 watcher），排除加载/迁移问题。

### 1.2 污染路径

`WorkspaceKey` 形态为 `projectId + '\0' + worktreePath`（主仓 path 段为空），主仓单元的
key 恰为 `projectId + '\0'` —— 与污染 ID 逐字节吻合。链路：

```
useAgentClickHandler（tabKey 误当 projectId 传入）
  → useTerminalTabs.addTab(storeKey, tab.projectId = storeKey)   ← 键被写进身份字段
  → tab 激活 → usePaneAgents 用 activeTab.projectId 调 check_agents_installed
  → IPC 传 "id\0" → Rust get_project 精确匹配失败 → Project not found
```

### 1.3 复发证据（证明点状修复失败）

`useSingletonDiff.test.ts` 注释原文：「worktree 激活时 diff tab 的 projectId 是真实
project id 而非复合 tab key（**回归：Project not found**）」—— diff tab 修过同类 bug，
修法为点修 + 点测；agent/terminal tab 路径原样复发。

---

## 2. 根因（第一性原理）

领域公理（10-08 design.md 术语表，权威）：

> **Workspace** 是 Project 下的独立工作空间，**承载 IDE/Agent/editor/debug/LSP/terminal
> 状态；是这些功能状态的隔离与寻址单位**。若某子系统的状态键仍是 project，它尚未达到
> 「按 Workspace 隔离」—— 属待补缺口。

现状对公理的违反是**结构性的**：

| 维度 | 现状 | 判定 |
| --- | --- | --- |
| tab 状态键（`tabs` record key） | 已是 `WorkspaceKey` | ✅ 符合公理 |
| tab 携带身份（`Tab.projectId: string`） | Project 粒度 + 裸 string | ❌ 粒度错误 + 类型未定义 |
| tab 内嵌地址（`data.workspace`） | 仅 `FileTabData` 有 | ❌ 同一 tab 两种身份表示并存 |
| 键的派生（`workspaceKeyOf(散件)`） | 自由函数，49 处调用/38 文件 | ❌ 任何人可拿散件拼键 |
| `addTab(spaceKey, tab)` | 键由调用方指定 | ❌ 键与 tab 身份可不一致，无机制防止 |

**两个身份槽位 + 一个未类型化字段 + 键可被外部指定** —— 事故是该模型的必然产出，
不是意外。因此修复必须是模型替换，不是下游检测。

---

## 3. 目标与非目标

### 目标

1. **身份词汇封闭类型化**：`ProjectId`（品牌）、`WorkspaceKey`（品牌，已存在）、
   `WorkspaceSession`（值对象，持有 key 投影）三种形态之外不存在第四种身份表示；
   品牌 → 裸 string 槽位的赋值在编译期不可行。
2. **`WorkspaceSession` 升级为完整值对象**：key 是对象的属性（getter），不是自由函数
   拼装 —— 与 Rust `WorkspaceRef::key()` 逐字对称。
3. **Tab 携带完整领域地址**：公共 `Tab` 上统一 `scope`（Workspace 或 App 设置空间），
   删除 `Tab.projectId` 与 `FileTabData.workspace` 双表示。
4. **store 键由 tab 自身推导**：`addTab(tab)` 内部取 `tab.scope` 的键，调用方无权指定 ——
   「键 A、tab 身份 B」的 bug 类别在构造上不存在。
5. **`__app__` 吸收进层级模型**（`App → Project → Workspace` 的 App 节点），不再是绕过
   模型的字符串哨兵。

### 非目标

- 不改 git 语义与 wire 契约（`workspace_key` 载荷不变；Rust 侧不改，仅可选加一条
  诊断性 id 校验）。
- 不动 10-09 范围（git 命令散参收口），但共用本任务产出的 `WorkspaceSession` class。
- 不改 `sessions.json` 持久化格式（editorStore 本不入盘，无存量数据包袱）。
- 不做 10-08 遗留的 Tier 3 命名迁移（与身份模型正交）。

---

## 4. 验收标准

### 4.1 类型与构造律（must）

- [x] `ProjectId` 品牌化（`Project.id: ProjectId`）；`WorkspaceKey` 品牌化（已有）；两者互斥赋值在
      `pnpm type-check` 下报错（`identity.test-d.ts` 负向类型测试钉住）。
- [x] `WorkspaceSession` 为 class：私有构造 + `static of(...)` 工厂 + `get key()` +
      `static fromKey()`（仅日志/测试用，对齐 Rust `parse_key` 地位）。
- [x] `workspaceKeyOf` 全仓归零（生产代码），进入 `check_workspace_identity`
      的 `RETIRED_FRONTEND` 台账；`parseWorkspaceKey` 生产代码归零（wire 边界消费
      `WorkspaceSession.fromKey`，日志 label 消费 `workspaceKeyLabel`）。
- [x] `Tab` 无顶层 `projectId`；所有 tab kind 统一经 `tab.scope` 取身份；
      `FileTabData.workspace` 删除（上提）。
- [x] `editorStore.addTab(tab)`：键内部推导；任何「外部传键」重载不存在。

### 4.2 行为回归（must）

- [x] 新增回归测试：点击 agent 创建的 terminal tab，其身份不含 NUL，
      `check_agents_installed` 收到裸 `ProjectId`（复现原事故路径，断言修复）。
- [x] 新增回归测试：worktree 激活时新建 tab 的 store 键 = `session.key`，与 tab 携带
      身份一致（键-身份一致性不变量，`tabIdentity.test.ts` 覆盖 8 个 TabData kind + worktree + app 空间）。
- [x] 既有全部测试通过：`pnpm check`（lint + test_fe + test_rust + test_host）。

### 4.3 双端契约（must）

- [ ] golden 契约测试更新为钉 `session.key` ↔ Rust `WorkspaceRef::key()`
      （既有 `matches the backend key contract` 改造，输入输出不变）。
- [ ] `JSON.stringify(session)` 只产出 `{ projectId, worktreePath }`（getter 不入
      wire）—— 一条单测钉住。

### 4.4 纵深（should）

- [x] Rust `project_context` 对含 NUL 的 project_id 返回 `Invalid project id` 而非
      `NotFound` + `#[test]`（`project_context_rejects_nul_in_project_id`）。
- [x] `check_workspace_identity` 增补判据 8：`projectId:` 槽位赋值标识符含 `Key` 尾缀
      （如 `projectId: tabKey`）命中即违规；判据 9：`'__app__'` 字面量单点。

---

## 5. 里程碑（每期独立可验证，见 implement.md）

| 期 | 内容 | 验证 |
| --- | --- | --- |
| M1 | 身份词汇（`ProjectId` 品牌 + `WorkspaceSession` class） | 负向类型测试 + golden 契约测试 |
| M2 | Tab 携带 `scope` + `addTab` 构造律 + 9 kind 迁移 | 键-身份一致性测试 + 全量测试 |
| M3 | 消费面迁移（`tab.projectId` 全部消费点 → `tab.scope`） | `pnpm check` + 冒烟 |
| M4 | 退役收口（`workspaceKeyOf`/`parseWorkspaceKey` 入护栏台账）+ 可选纵深 | `pnpm guards list` + 护栏测试 |

依赖关系：M1 → M2 → M3 → M4 串行（每期结束可合入）。

---

## 6. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 迁移面大（30+ addTab 调用点、9 kind、tab.projectId 全部消费点） | M1 先行让编译器枚举迁移清单，不靠人肉盘点；每期独立合入 |
| `__app__` 空间无 Workspace 可构造 | `TabScope` 联合类型的 `'app'` 分支吸收（设计见 design.md §4） |
| 与 10-09 并行产生第二 `WorkspaceSession` 定义 | 本任务持有类型定义；10-09 PRD 已声明复用本任务产出（开工顺序协调） |
| 品牌 cast 散落 | 铸造点唯一：api wrapper 层一处（design.md §3.1） |
| 运行时残留（第三方/序列化路径漏网） | M4 后端诊断校验兜底 + 护栏判据防回退 |
