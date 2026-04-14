# Agent 按钮显隐管理

## Goal

在 Agent Bar 左侧新增齿轮按钮（Manage Presets），点击弹出下拉面板，用户可快捷切换每个 Agent 在 Bar 上的显示/隐藏。所有项目类型（本地、WSL、SSH）均可使用。

**动机**: 当前所有 `enabled` Agent 全部显示在 Bar 上，用户无法隐藏不常用的 Agent，导致 Bar 拥挤。需要一个轻量的 UI 入口来管理可见性，而不是每次都进 Settings 操作。

## Requirements

### R1: 新增 `hiddenAgentIds` 配置字段

- 在 `AppConfig` 中新增 `hiddenAgentIds: string[]`，记录被用户隐藏的 Agent ID
- 默认值 `[]`（所有 enabled agent 默认可见）
- 持久化到 `config.json`
- Agent 可见性 = `enabled && !hiddenAgentIds.includes(id)`

### R2: 齿轮按钮

- 位置：Agent Bar 最左侧（在第一个 Agent 按钮之前）
- 外观：齿轮图标，与 Agent 按钮同高（h-6），风格融入 Bar
- Tooltip：`Manage Presets`
- 点击行为：toggle 下拉面板
- 所有 Agent 被隐藏时，齿轮按钮仍然显示（作为唯一恢复入口）

### R3: Manage Presets 下拉面板

- 定位：齿轮按钮下方，向右展开
- 列出所有 `enabled` Agent（preset + custom），按名称字母排序
- 每行布局：`[Agent Icon] [Agent Name] [Pin/Unpin 图标按钮]`
- 已固定（visible）Agent：显示钉子图标（表示"已固定在 Bar"）
- 未固定（hidden）Agent：显示 `(+)` 圆形按钮（表示"点击添加到 Bar"）
- 点击钉子/加号：toggle 该 Agent 的可见性，立即更新 Bar 和持久化
- 点击面板外区域关闭
- 面板最大高度限制，超出时可滚动

### R4: Agent Bar 过滤逻辑更新

- `MainContent.tsx` 中的 `enabledAgents` 过滤条件改为：`agents.filter(a => a.enabled && !hiddenAgentIds.includes(a.id))`
- `AgentSelector.tsx` 中的 inline AgentBar 同步使用相同过滤逻辑
- 可见 Agent 的顺序：保持原有顺序（后端返回顺序），不因固定/取消固定改变

### R5: 配置同步

- `useAppConfig` hook 增加 `hiddenAgentIds` 的加载/保存逻辑
- 通过 `AppContext` 下发给 `MainContent` 和 `AgentSelector`
- 齿轮面板的 toggle 操作直接调用 `saveConfig` 持久化

### R6: 全场景覆盖

- 齿轮按钮 + 下拉面板在本地项目、WSL 项目、SSH 项目视图中均可使用
- `hiddenAgentIds` 是全局配置，所有项目类型共享同一份可见性设置

## Acceptance Criteria

- [ ] Agent Bar 左侧出现齿轮按钮，hover 显示 "Manage Presets"
- [ ] 点击齿轮弹出下拉面板，列出所有 enabled Agent
- [ ] 面板中点击钉子/加号可 toggle Agent 的 Bar 可见性
- [ ] toggle 后 Agent Bar 立即更新（无需刷新）
- [ ] 可见性配置持久化，重启应用后保持
- [ ] 面板点击外部区域关闭
- [ ] compact mode 下齿轮按钮和 Bar 行为正常
- [ ] 自定义 Agent 也能被管理显隐
- [ ] 所有 Agent 被隐藏时，仅显示齿轮按钮，Bar 行不消失
- [ ] WSL/SSH 项目视图中齿轮面板可用

## Definition of Done

- 前端测试覆盖：齿轮按钮渲染、面板 toggle、可见性过滤逻辑
- `npx tsc --noEmit` 通过
- `pnpm test` 通过
- 手动测试：齿轮面板交互、持久化

## Out of Scope

- Agent 快捷键绑定（不做键盘快捷切换）
- Agent 排序/拖拽重排（保持后端返回顺序）
- Agent 的 enabled/disabled 管理（仍在 Settings 中）
- 齿轮面板中编辑 Agent command/args
- 分组/分类管理

## Technical Notes

### 影响文件

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `AppConfig` 新增 `hiddenAgentIds: string[]` |
| `src/hooks/useAppConfig.ts` | 加载/保存/默认值 |
| `src/components/MainContent.tsx` | Agent Bar 过滤逻辑 + 齿轮按钮 + 下拉面板 |
| `src/components/layout/AgentSelector.tsx` | inline AgentBar 同步过滤 |
| `src/styles.css` | 齿轮按钮 + 下拉面板样式 |
| `src-tauri/src/storage.rs` | `hiddenAgentIds` 字段序列化兼容（旧配置无此字段时默认 `[]`） |

### 设计决策

**`hiddenAgentIds`（记录隐藏的）而非 `visibleAgentIds`（记录可见的）**：
- 新增 Agent 时默认可见，无需手动 pin
- 空数组 `[]` 即为"全部可见"，零配置即可工作
- 删除 Agent 后其 ID 残留在数组中无副作用

**齿轮按钮位于 MainContent 的 Agent Bar 行内**：
- 与 Agent 按钮同级渲染，不单独占行
- 所有 Agent 被隐藏时 Bar 行仅显示齿轮按钮，不消失

**下拉面板组件抽取为 `AgentBarManager`**：
- 可作为 `MainContent.tsx` 的局部组件，或抽取到 `src/components/layout/AgentBarManager.tsx`
- 面板使用绝对定位，与 AgentSelector 的下拉面板风格一致

## Open Questions

（已全部确认，无待解决问题）
