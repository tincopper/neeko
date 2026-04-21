# 巨型组件拆分优化

## Goal

将6个巨型组件（RemoteItems / SettingsPanel / App / TerminalView / DiffView / ProjectItem）拆分为职责单一的小组件，同时深度拆分 Context 粒度，消除 prop 穿透和跨域 ref 反模式。

## Requirements

### Phase 1: SettingsPanel 拆分（最低风险，最高可见收益）

**现状**：768行，6个面板零拆分，22处hook，所有面板内联在单个 return 中。

**方案**：
```
components/settings/
├── SettingsPanel.tsx          # 壳：导航 + 动态面板切换（~80行）
├── AppearancePanel.tsx        # 外观设置
├── EditorPanel.tsx            # 编辑器设置
├── TerminalPanel.tsx          # 终端设置
├── AgentsPanel.tsx            # Agent 管理
├── IdePanel.tsx               # IDE 管理
├── GitPanel.tsx               # Git 设置
├── constants.ts               # BUILTIN_FONTS, PRESET_SHELLS, NAV_ITEMS
└── index.ts                   # barrel export
```

**拆分规则**：
- 每个面板独立管理自己的 local state
- 共享状态（config / onConfigChange）通过 props 传入
- 常量提取到 constants.ts

---

### Phase 2: RemoteItems 拆分（已有内部层次，抽到独立文件）

**现状**：1017行，已有5个内部子组件（ProjectBody、ProjectItemCard、WSLProjectCard、RemoteProjectCard），结构清晰但全塞一个文件。

**方案**：
```
components/connections/
├── RemoteItems.tsx            # 保留：export WSLItem + RemoteItem（~200行）
├── ProjectBody.tsx            # 分支/worktree 列表 + 删除确认
├── ProjectItemCard.tsx        # 通用项目卡片（可折叠 + 右键菜单）
├── WSLProjectCard.tsx         # WSL 特化包装
├── RemoteProjectCard.tsx      # SSH 特化包装
├── types.ts                   # ActiveWslKey, ActiveRemoteKey, Props 接口
├── utils.ts                   # getAvatarStyle
└── index.ts                   # barrel export
```

**拆分规则**：
- 直接按现有内部组件边界提取文件，行为不变
- `ActiveWslKey` 类型统一到此处（消除重复定义）

---

### Phase 3: DiffView 拆分（算法与渲染分离）

**现状**：550行，语言注册、diff算法、渲染逻辑混在一起。

**方案**：
```
components/diff/
├── DiffView.tsx               # 壳：loadDiff + 模式切换 + 委托渲染（~150行）
├── UnifiedDiffTable.tsx       # unified 模式渲染
├── SplitDiffTable.tsx         # split 模式渲染
├── useDiffData.ts             # loadDiff 逻辑抽为 hook
├── diffAlgorithm.ts           # tokenizeForDiff, computeLCS, computeWordDiff, buildSplitRows
├── highlight.ts               # LANGUAGE_MAP, ensureLanguageRegistered, detectLanguage, highlightLine, escapeHtml
├── types.ts                   # DiffLine, DiffHunk, DiffSource, SplitRow
└── index.ts
```

**拆分规则**：
- 纯算法函数无 React 依赖 → 独立模块，方便单元测试
- 渲染拆为 Unified / Split 两个无状态组件
- `useDiffData` hook 封装异步加载逻辑

---

### Phase 4: TerminalView 拆分（命令式API与React组件分离）

**现状**：680行，8个模块级导出（缓存Map + 命令式函数）+ 1个React组件混在一起。

**方案**：
```
components/terminal/
├── TerminalView.tsx           # 纯 React 组件（~180行）
├── terminalCache.ts           # terminalCache Map + destroy/prefix 函数
├── terminalFactory.ts         # createTerminalForProject（核心创建逻辑）
├── terminalCommands.ts        # sendToTerminal, launchAgentInTerminal, switchAgentInTerminal
├── terminalTypes.ts           # 相关类型（如果需要）
└── index.ts                   # 统一 re-export 所有公共 API
```

**拆分规则**：
- 模块级状态（Map/Set）归 terminalCache.ts
- 创建逻辑（xterm + PTY 连接）归 terminalFactory.ts
- 命令式 API 归 terminalCommands.ts
- React 组件只负责挂载/resize/字体响应

---

### Phase 5: ProjectItem 精简（减少 props，提取子逻辑）

**现状**：507行，17个props，已委托 WorktreeList/FileTree 等子组件，但内部 handler 较多。

**方案**：
```
components/project/
├── ProjectItem.tsx            # 精简后 ~250行
├── ProjectItemHeader.tsx      # 项目头部行（avatar + name + badge + 操作按钮）
├── ProjectGitSection.tsx      # 折叠区的 git 信息（分支下拉 + changes tree）
├── useProjectItemDrag.ts      # 拖拽逻辑 hook（5个事件处理器）
├── useProjectItemMenu.ts      # 右键菜单 + context menu items 构建
└── index.ts
```

**拆分规则**：
- 拖拽 5 个事件处理器 → 自定义 hook
- 右键菜单构建 → 自定义 hook
- 头部行视觉渲染 → 独立子组件
- props 数量目标：主组件 ≤ 10 个

---

### Phase 6: Context 深度拆分 + App.tsx 瘦身

**现状**：App.tsx 628行，手动组装 3 个大 context 对象（ProjectContextValue 20+ 属性、ConnectionContextValue 30+ 属性）。

**方案**：

#### 6a. Context 拆分

```
contexts/
├── ProjectStateContext.tsx     # 项目列表、选中项、排序
├── ProjectActionsContext.tsx   # add/remove/select/reorder 回调
├── WslContext.tsx              # WSL 连接 + 项目状态 + 操作
├── RemoteContext.tsx           # SSH 连接 + 项目状态 + 操作
├── EditorContext.tsx           # diff/fileView 状态
├── AppConfigContext.tsx        # 已存在，保持
├── TerminalTabsContext.tsx     # terminalTabs 相关状态
└── index.ts
```

#### 6b. App.tsx 瘦身

```
App.tsx                         # ~150行：hook 调用 + <AppProviders> + 模态层
AppProviders.tsx                # Provider 嵌套树（compose pattern）
AppModals.tsx                   # 所有模态弹窗的条件渲染
```

**拆分规则**：
- 每个 Context 只包含一个领域的状态 + 相关操作
- WSL 和 Remote 彻底分离（不再混在 ConnectionContext）
- State 和 Actions 分离 → 消费者可以只订阅需要的部分，减少无效重渲染
- 消除 `useCrossDomainRefs` 反模式：用细粒度 Context 取代 ref 传递

---

## Implementation Order (推荐)

| 顺序 | 目标 | 原因 |
|------|------|------|
| 1 | SettingsPanel | 最独立，零外部依赖，拆分后可立即验证 |
| 2 | RemoteItems | 已有清晰边界，提取即可 |
| 3 | DiffView | 算法分离利于测试覆盖 |
| 4 | TerminalView | 命令式API独立后其他终端组件可复用 |
| 5 | Context 拆分 | 影响面最大，需在前4个稳定后进行 |
| 6 | ProjectItem | 依赖新 Context 结构，放最后 |

## Acceptance Criteria

- [ ] 每个拆分后的组件文件 ≤ 300行
- [ ] 所有现有功能不变（行为等价）
- [ ] TypeScript 编译零错误
- [ ] 消除 `useCrossDomainRefs` 反模式
- [ ] Context 消费者不再需要解构 20+ 属性
- [ ] 无 prop 超过 10 个的组件
- [ ] barrel export 完整，导入路径统一

## Definition of Done

- TypeScript / ESLint 通过
- `pnpm tauri dev` 功能验证通过
- 现有测试（如有）通过
- 每个 Phase 可独立 commit

## Out of Scope

- 新功能添加
- 性能优化（React.memo 策略调整等）
- CSS/样式重构
- 后端改动
- 新增单元测试（除非拆分引入新的可测试纯函数）

## Technical Notes

- RemoteItems 中 `ActiveWslKey` 在 useWslProjects.ts 也有定义 → 统一到 connections/types.ts
- TerminalView 的模块级 Map 是全局单例，拆文件后导入路径不变即可
- Context 拆分会导致大量 import 路径变化，建议用 barrel export 保持兼容
- App.tsx 的 `useEffect` ref 同步逻辑在 Context 拆分后应能消除
