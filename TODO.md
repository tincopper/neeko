以下是对 `src/` 前端代码的系统评估，按严重程度排序：

---

## ~~一、关键问题 (Critical)~~ 已完成

### ~~1. 巨型组件 (God Components)~~ 已完成

> 所有巨型组件已拆分完毕（总行数 4,150 → 767）

| 文件                | 原行数 | 当前行数 | 状态       |
| ------------------- | ------ | -------- | ---------- |
| `RemoteItems.tsx`   | 1,017  | 235      | 已拆分     |
| `SettingsPanel.tsx` | 768    | 5        | 已拆分     |
| `App.tsx`           | 628    | 41       | 已拆分     |
| `TerminalView.tsx`  | 680    | 295      | 大幅缩减   |
| `DiffView.tsx`      | 550    | 12       | 已拆分     |
| `ProjectItem.tsx`   | 507    | 179      | 大幅缩减   |

### ~~2. 跨域 Ref 反模式~~ 已完成

> `useCrossDomainRefs.ts` 已移除，跨域状态传递已替换为 zustand snapshots。

---

## 二、高严重度 (High)

### ~~3. Prop 穿透严重~~ 已完成

- ~~`MainContent.tsx` 接收 30+ context 值再向下传递~~
- ~~`RemoteDialog.tsx` 多层嵌套透传 Agent/IDE 选择器的 props~~
- ~~建议：拆分 Context 粒度，或引入 compound component 模式~~

### ~~4. Hook 复杂度过高~~ 已完成

> 已完成按域拆分与共享逻辑提取：`useAppCallbacks.ts` 已移除，新增 `useAgentActions`、`useWorktreeActions`、`useRemoteAuthActions`，并抽取 `useConnectionWorktreeState` 与 `utils/entryUpdates.ts`。

### ~~5. Context 膨胀~~ 已完成

- ~~`ProjectContextValue`：20+ 属性，混合状态和回调~~
- ~~`ConnectionContextValue`：30+ 属性，WSL 和 Remote 混在一起~~
- ~~应拆分：`ProjectState` / `ProjectCallbacks`、`WSLContext` / `RemoteContext`~~

---

## 三、中等严重度 (Medium)

### ~~6. 缺少 Barrel Export 持续存在~~ 已完成

`2026-04-21` 19:40 核查：问题已修复。

已补齐 `index.ts`：
- `hooks/`
- `utils/`
- `adapters/`
- `components/panels/`

### ~~7. 类型组织 持续存在~~ 已完成

`2026-04-21` 19:40 核查：问题已修复。

已移除 `src/types.ts`，按域拆分为 `src/types/` 目录，并通过 `src/types/index.ts` 聚合导出。

### ~~8. 类型重复定义~~ 已完成

`2026-04-21` 核查：`ActiveWslKey` 已集中定义在 `components/connections/types.ts`，`RemoteItems.tsx` 中无重复定义。

### ~~9. 目录组织不清晰 持续存在~~ 已完成

`2026-04-21` 20:05 核查：问题已收敛并完成。

- Skills 入口已统一到 `components/skills/`，`components/panels/` 不再承载 `SkillsPanel`
- `FileViewer` 与 `FileTree` 已统一迁移到 `components/files/`
- `components/panels/` 仅保留侧栏面板组件（`ProjectsPanel`、`FilesPanel`）

### ~~10. 命名不一致 持续存在~~ 已完成

`2026-04-21` 19:40 核查：主要冲突已消除。

- `ProjectActionsContextValue` 已统一对外回调为 `on*`，移除 `handleSelectProject`、`handleAddProject`
- 容器与消费层已同步改名并通过类型检查

---

## 建议优先级

1. **拆分 RemoteItems.tsx 和 SettingsPanel.tsx** — 降低单文件复杂度
2. **拆分 Context 粒度** — 消除 prop 穿透，解决跨域 ref 反模式
3. **按域拆分 useAppCallbacks** — 降低 hook 认知负担
4. **补齐 barrel export** — 统一导入路径
5. **统一命名规范** — on* 用于 props，handle* 用于内部处理
