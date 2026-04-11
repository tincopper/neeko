# sideTerminal 支持多个终端窗口的田字形布局

## Goal
为 sideTerminal 功能添加多终端窗口支持，最多 4 个终端，按照特定布局排列：
- 1 个终端：占满整个侧边区域
- 2 个终端：上下各 50% 高度（垂直排列）
- 3 个终端：左上是前两个（上下各 50%），右边占满高度
- 4 个终端：田字形（2x2 网格）

## Requirements

### 1. 状态管理
- 用 `Record<string, Set<string>>` 替换原有的 `boolean`，每个项目独立记录已打开的终端窗口索引 Set
- 支持最多 4 个终端窗口（超出时忽略）
- 每个终端使用独立 cache key：`{projectId}:side:{index}`（如 `xxx:side:0`、`xxx:side:1`）

### 2. 布局实现
- 根据终端数量动态计算布局
- 使用 CSS Grid 实现 2x2 网格布局
- 父容器设置固定宽度，子元素平均分配

### 3. 交互逻辑
- `Ctrl+Alt+T`：打开一个新的终端窗口（递增索引，最大 4 个）
- `Ctrl+W`：关闭终端（优先关闭聚焦的终端，其次关闭最近打开的终端）
- 按钮点击也可以打开新终端

### 4. 聚焦管理
- 追踪当前聚焦的 side terminal 索引
- 点击终端内部时自动聚焦
- Ctrl+W 关闭时优先关闭聚焦的终端

### 5. 拖拽调整大小
- 分隔线可以拖拽调整 side terminal 区域宽度
- 主终端能及时响应尺寸变化（使用 ResizeObserver）
- Side terminal 使用 ResizeObserver 监听容器变化并调整 PTY 尺寸

### 6. 关闭行为
- 关闭单个终端：销毁对应 cache key 的 PTY 会话
- 切换项目时：不清理 side terminal 会话（保留 PTY 连接）

## Acceptance Criteria
- [x] 按 Ctrl+Alt+T 可打开第 1 个 side terminal
- [x] 再次按 Ctrl+Alt+T 可在第一个下方创建第 2 个终端（上下各 50%）
- [x] 第三次按 Ctrl+Alt+T 可在右侧创建第 3 个终端
- [x] 第四次按 Ctrl+Alt+T 可在第三个下方创建第 4 个终端（田字形）
- [x] 按 Ctrl+W 关闭聚焦的终端（如果有聚焦）
- [x] 按 Ctrl+W 关闭最近打开的终端（如果没有聚焦）
- [x] 关闭终端后正确销毁 PTY 会话
- [x] 拖动分隔线可以调整 side terminal 宽度
- [x] 拖动时主终端大小能及时响应
- [x] 点击按钮可以打开多个终端

## Technical Notes

### 文件修改
- `src/components/terminal/SideTerminalView.tsx`：支持 index 属性，使用 ResizeObserver 响应尺寸变化，添加 isFocused/onFocus 属性
- `src/components/MainContent.tsx`：使用 `Set<string>` 渲染多个 SideTerminalView，传递 focusedSideTerminalIndex 和 onFocusSideTerminal
- `src/App.tsx`：状态管理改为 `Record<string, Set<string>>`，添加 focusedSideTerminalIndex 状态
- `src/hooks/useKeyboardShortcuts.ts`：Ctrl+Alt+T 逻辑改为添加到 Set，Ctrl+W 优先关闭聚焦终端
- `src/hooks/useSideTerminalResize.ts`：移除 suppressResizeRef，让主终端能及时响应
- `src/styles.css`：添加多终端布局的 CSS 样式

### 布局计算
```
1 个终端：  [        T0        ]
2 个终端：  [  T0  ]          （上下）
           [  T1  ]
3 个终端：  [ T0 T2 ]         （左边上下，右边占满）
           [ T1   ]
4 个终端：  [ T0 T2 ]          （2x2 网格）
           [ T1 T3 ]
```

### Cache Key 格式
- 第 N 个终端：`{projectId}:side:{N}`（N 从 0 开始）
- 关闭时销毁对应的 cache key 和 PTY session

### 聚焦状态管理
- `focusedSideTerminalIndex: string | null` - 当前聚焦的终端索引
- SideTerminalView 通过 terminal.focus() 事件触发 onFocus 回调
- 关闭终端后清除聚焦状态

### Out of Scope
- 终端之间的通信（各自独立 PTY 会话）
- 分隔线拖拽调整单个终端大小