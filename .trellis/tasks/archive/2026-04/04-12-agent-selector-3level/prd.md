# Agent Bar 直接集成到 TitleBar

## Goal
去掉 AgentSelector 组件，将 Agent Bar 直接集成到 TitleBar 中显示，解决布局堆叠问题。

## Requirements

### 功能需求
- [x] 移除 AgentSelector 的三级交互设计
- [x] Agent Bar 直接显示在 TitleBar 中
- [x] 配置选项（Show Preset Bar, Compact Mode）移到 SettingsPanel
- [x] Agent 选择功能保持不变
- [x] 配置持久化到 `AppConfig`

### 交互需求
- [x] Agent Bar 直接显示在 TitleBar 右侧
- [x] 点击 Agent 按钮直接选中
- [x] 未安装的 Agent 显示禁用状态
- [x] 紧凑/标准模式通过 SettingsPanel 切换

### 样式需求
- [x] Agent Bar 适应 TitleBar 高度
- [x] 横向排列，支持滚动
- [x] 紧凑模式：仅显示图标
- [x] 标准模式：显示图标 + 名称

## Acceptance Criteria

- [x] Agent Bar 正确显示在 TitleBar 中
- [x] 点击 Agent 按钮正常选中
- [x] 未安装 Agent 显示禁用提示
- [x] SettingsPanel 可切换 Show Preset Bar
- [x] SettingsPanel 可切换 Compact Mode
- [x] 配置持久化工作
- [x] 原有 `onSelectAgent` 回调正常工作
- [x] WSL/SSH 项目的 Agent 选择功能不受影响
- [x] 无布局堆叠问题

## Definition of Done

- 所有 Acceptance Criteria 满足
- 更新相关测试
- 代码通过 TypeScript 类型检查
- 样式与现有主题一致
- 不破坏现有项目数据格式

## Out of Scope

- Chat/Browser 功能（已移除）
- 键盘快捷键
- Agent 按钮栏拖拽排序

## Technical Approach

### 架构变更

**Before:**
```
TitleBar
└── AgentSelector
    ├── Level 1: Main Display (+ button)
    ├── Level 2: Dropdown Menu
    └── Level 3: Agent Bar (inline or in menu)
```

**After:**
```
TitleBar
└── AgentBar (直接嵌入)
    └── AgentBarButton[]
SettingsPanel
└── Agent Display Settings
    ├── Show Preset Bar toggle
    └── Compact Mode toggle
```

### 文件变更

| 文件 | 变更 |
|------|------|
| `AgentSelector.tsx` | 简化为仅保留 Agent Bar 逻辑，或合并到 TitleBar |
| `TitleBar.tsx` | 直接渲染 Agent Bar |
| `SettingsPanel.tsx` | 添加 Agent 显示配置选项 |
| `styles.css` | 更新 TitleBar 和 Agent Bar 样式 |
| `types.ts` | 保留配置字段 |

### Props 变更

Agent Bar 直接接收所需 props，不再通过 AgentSelector 封装：
```typescript
interface AgentBarProps {
  agents: AgentConfig[];
  selectedAgentId: string | null;
  installedMap: Map<string, boolean>;
  compactMode: boolean;
  onSelectAgent: (agentId: string | null) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}
```

## Technical Notes

### TitleBar 布局

TitleBar 右侧区域需要容纳：
1. 项目名称
2. 分支名
3. Agent Bar（新增）
4. 窗口控制按钮

使用 flex 布局，Agent Bar 自适应剩余空间。

### 配置管理

配置选项从 AgentSelector 内部移到 SettingsPanel：
- `agentSelectorShowPresetBar` → SettingsPanel 开关
- `agentSelectorCompactMode` → SettingsPanel 开关

通过 `useAppConfig` 统一管理。

## References

- 原 Image 1-3 的设计已废弃
- 新设计：Agent Bar 直接嵌入 TitleBar
