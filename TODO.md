以下是对 `src/` 前端代码的系统评估，按严重程度排序：

---

## 一、关键问题 (Critical)

### 1. 巨型组件 (God Components)

| 文件                | 行数  | 问题                                                   |
| ------------------- | ----- | ------------------------------------------------------ |
| `RemoteItems.tsx`   | 1,017 | 混合了列表渲染、右键菜单、分支/Worktree 管理、Git 操作 |
| `SettingsPanel.tsx` | 768   | 6 个设置类别全在一个组件里，各自独立的表单状态         |
| `App.tsx`           | 628   | 编排 25+ 个 hook，200+ 解构依赖，构造巨大 context 对象 |
| `TerminalView.tsx`  | 680   | 组件逻辑和模块级缓存/工具函数混杂                      |
| `DiffView.tsx`      | 550   | 语法高亮、diff 解析、分栏渲染全部耦合                  |
| `ProjectItem.tsx`   | 507   | 接收 15+ props，含 8+ 回调处理器                       |

### 2. 跨域 Ref 反模式

`useCrossDomainRefs.ts` 用 ref 做跨域状态传递（`setRemoteDiffStateRef.current = ...`），本质上是手工事件总线，说明状态架构需要重新设计。

---

## 二、高严重度 (High)

### 3. Prop 穿透严重

- `MainContent.tsx` 接收 30+ context 值再向下传递
- `RemoteDialog.tsx` 多层嵌套透传 Agent/IDE 选择器的 props
- 建议：拆分 Context 粒度，或引入 compound component 模式

### 4. Hook 复杂度过高

- `useAppCallbacks.ts` (267 行)：单文件 28 个回调函数，应按域拆分
- `useRemoteActions.ts` (190 行)：接收 30+ 依赖参数，依赖数组过长
- `useWslActions.ts` 与 `useRemoteActions.ts` 结构高度重复，存在代码复用机会

### 5. Context 膨胀

- `ProjectContextValue`：20+ 属性，混合状态和回调
- `ConnectionContextValue`：30+ 属性，WSL 和 Remote 混在一起
- 应拆分：`ProjectState` / `ProjectCallbacks`、`WSLContext` / `RemoteContext`

---

## 三、中等严重度 (Medium)

### 6. 缺少 Barrel Export

以下目录没有 `index.ts`：
- `hooks/` (32 个 hook 无集中导出)
- `utils/`
- `adapters/`
- `components/panels/`

### 7. 类型组织

`types.ts` (311 行) 混合了 UI 类型、API 类型、适配器类型，应按域拆分为 `domain-types.ts`、`ui-types.ts`、`api-types.ts`。

### 8. 类型重复定义

`ActiveWslKey` 在 `useWslProjects.ts` 和 `RemoteItems.tsx` 中重复定义。

### 9. 目录组织不清晰

- Skills 组件分散在 `components/skills/` 和 `components/panels/SkillsPanel.tsx`
- Panel 组件没有统一目录
- FileViewer 在 panels 目录，FileTree 在 project 目录

---

## 四、低严重度 (Low)

### 10. 命名不一致

- 回调前缀混用：`onSelectProject` vs `handleSelectProject` 在同一组件内共存
- Hook 命名模式不统一：`useSessionBootstrap` vs `useKeyboardShortcuts`

---

## 建议优先级

1. **拆分 RemoteItems.tsx 和 SettingsPanel.tsx** — 降低单文件复杂度
2. **拆分 Context 粒度** — 消除 prop 穿透，解决跨域 ref 反模式
3. **按域拆分 useAppCallbacks** — 降低 hook 认知负担
4. **补齐 barrel export** — 统一导入路径
5. **统一命名规范** — on* 用于 props，handle* 用于内部处理