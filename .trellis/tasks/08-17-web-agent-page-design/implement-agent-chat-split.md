# AgentChatTabView 组件拆分 — 2046 行 → 高内聚模块

> 挂靠任务：08-17-web-agent-page-design（用户指定在当前任务内继续）。
> 背景：neeko-check UI 评审判定 Block/Major 级问题已全部关闭；本计划处理最后一项结构性债务——
> `AgentChatTabView.tsx` 约 2000 行单文件（违反红线 10「组件 ≤300 行」），也是 UI 迭代牵一发动全身的根因。
> 虚拟滚动依赖本拆分完成后的干净结构，另行规划。

## 现状结构（实测）

| 区块 | 行范围 | 行数 |
|---|---|---|
| 模块级工具（类型/id 生成/messageCache/appendDelta/mergeAdjacentToolBlocks/常量） | 1-253 | ~250 |
| 主组件（~20 useState + applyEvent 330 行 + handlers + JSX） | 254-1566 | ~1310 |
| 内嵌子组件（ModelSelector/useModelSearch/ModelSearchInput/ModelList/ModelPicker/AgentModeSelector/ThinkingLevelSelector） | 1568-2024 | ~460 |

## 拆分方案（纯移动，不改逻辑）

| 新文件 | 内容（来源） | 预估行数 |
|---|---|---|
| `types.ts` | ContentBlock / ChatMessage / RenderItem / PendingUserInput / Attachment / ToolCard 相关 re-export、nextMsgId / nextBlockId、appendDelta、mergeAdjacentToolBlocks | ~150 |
| `messageCache.ts` | messageCache Map + loadCachedMessages / saveCachedMessages / clearMessageCache（export 兼容保留） | ~40 |
| `constants.ts` | AGENT_MODES / THINKING_LEVELS / agentTag / agentColor | ~50 |
| `hooks/useAgentChatStream.ts` | 核心数据流 hook：messages / streaming / pendingApproval / pendingUserInput / proposedPlan / contextWindow 状态 + rAF 批处理 + applyEvent + handleSend / handleStop / handleApproval / handleAllowSession / handleCancelTurn / handleUserInput / openAgentFile / attachFileDiff / findToolBlock | ~600 |
| `components/ModelSelector.tsx` | ModelSelector + useModelSearch + ModelSearchInput + ModelList + ModelPicker（模型选择域整体迁移） | ~460 |
| `components/ParamSelectors.tsx` | AgentModeSelector + ThinkingLevelSelector | ~140 |
| `AgentChatTabView.tsx`（瘦身后） | 组合 useAgentChatStream + JSX 布局 + composer 交互 handlers（input/attach/keydown 等纯 UI 态） | ≤300 |

## 验收标准

- [x] S1 内嵌子组件迁出：ModelSelector 系列 → `ModelSelector.tsx`（326 行），参数选择器 → `ParamSelectors.tsx`（190 行）
- [x] S2 模块级工具归位：消息模型 → `messageModel.ts`（130 行；因 feature 根已有 types.ts，改名避免自环），缓存 → `messageCache.ts`（35 行），展示常量 → `constants.ts`（27 行）
- [x] S3 数据流抽离为 `hooks/useAgentChat.ts`（1035 行）：applyEvent 与全部后端交互 handlers 迁入，组件层零 invoke/listen 直调
- [x] S4 `AgentChatTabView.tsx` 瘦身至 **256 行**（≤300 达标），仅剩组合与布局；消息列表 → `MessageList.tsx`（137 行，React.memo），composer → `ChatComposer.tsx`（150 行）
- [x] S5 纯移动重构：不改变任何行为语义；现有测试（含 `clearMessageCache` 经 re-export 保持原导入路径兼容）全部通过
- [x] S6 遵守 Import/Export Firewall：新文件仅被 AgentChatTabView 同 feature 直导，无 barrel
- [x] 回归通过：`pnpm type-check`（0 错误）、`pnpm test:run`（261 文件 / 2112 passed）、`pnpm lint`（2026-08-21 实测）

## 拆分结果

| 文件 | 行数 | 职责 |
|---|---|---|
| `components/AgentChatTabView.tsx` | 256 | 组合层：hook 解构 + 滚动跟随 + 布局骨架 |
| `hooks/useAgentChat.ts` | 1035 | 数据流域：会话状态 / applyEvent / mock 序列 / 全部后端 handlers |
| `components/MessageList.tsx` | 137 | 消息流渲染（memo 化） |
| `components/ChatComposer.tsx` | 150 | 输入区（附件 chips / textarea / 工具栏） |
| `components/ModelSelector.tsx` | 326 | 模型选择域（5 单元） |
| `components/ParamSelectors.tsx` | 190 | AgentMode / ThinkingLevel 选择器 |
| `components/messageModel.ts` | 130 | 消息模型类型 + appendDelta / mergeAdjacentToolBlocks |
| `components/messageCache.ts` | 35 | tabId 键控消息缓存 |
| `components/constants.ts` | 27 | AGENT_MODES / THINKING_LEVELS / agentTag / agentColor |

> 后续候选：useAgentChat 内 mock 事件序列（~220 行）可再拆为独立 fixture 文件（本轮纯移动原则未追加）。

## 实施顺序（每步独立可回归）

1. S1 子组件迁出（纯剪切粘贴 + import 调整，风险最低）
2. S2 工具归位（types/cache/constants）
3. S3 hook 抽离（最大步骤：状态与 handlers 整体搬迁，签名不变）
4. S4 瘦身收尾 + 行数断言

## 关键约束

- **纯移动**：不改任何函数体逻辑、不改事件协议、不改 CSS 类名
- `clearMessageCache` 是测试引用的导出，从原路径保持可用（re-export 或测试同步更新，二选一以最小 diff 为准）
- hook 返回值用对象聚合，避免元组位置耦合
- 不引入 barrel index；跨文件直导具体路径
