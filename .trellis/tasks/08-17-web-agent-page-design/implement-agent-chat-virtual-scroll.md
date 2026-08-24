# Agent Chat 消息流虚拟滚动 — 长会话性能优化

> 挂靠任务：08-17-web-agent-page-design（用户指定在当前任务内继续）。
> 前置：组件拆分已完成（AgentChatTabView 256 行，MessageList 独立 memo 组件）——本计划在其干净结构上实施。
> 依赖 `@tanstack/react-virtual` 已在 package.json（conversation P0 引入），无需新增依赖。

## 背景

`MessageList` 当前全量渲染所有消息（`messages.map`）。长会话（数百条消息 × 工具卡片）下
DOM 节点数线性膨胀，滚动与流式重渲染卡顿。neeko-check UI 评审记录的最后一项 Major 级问题。

## 技术方案

- 在 `MessageList.tsx` 内直接使用 `useVirtualizer`（不复用 shared/VirtualList——其结构绑定
  「滚动容器 = 列表父级」，而 Agent Chat 的滚动容器 `.wa-chat` 混合承载 banner/pinned/indicator
  等非虚拟化内容）。
- 动态高度：`estimateSize(() => 120)` 粗估 + `measureElement`（ResizeObserver 驱动，
  流式内容增长自动重测）。
- jsdom 兼容：`initialRect: { width: 720, height: 800 }` 兜底视口（setup.ts 已有
  ResizeObserver no-op stub，conversation P0 同款方案已验证）。
- 自动跟随：保留现有 `chatEndRef.scrollIntoView` 机制（end 锚点在虚拟池之后的文档流中，
  scrollIntoView 驱动 `.wa-chat` 滚动，virtualizer 监听 scroll 更新渲染窗口）。
- pinned 区 / 系统横幅 / working indicator 保持非虚拟化（数量少、需常驻）。

## 验收标准

- [x] V1 MessageList 接入 useVirtualizer：仅可见消息（+overscan 8）挂载 DOM，池外消息不渲染
- [x] V2 动态高度正确：`estimateSize(120)` + `measureElement`（ResizeObserver 驱动）；**人工验收点**：工具卡片展开/折叠、流式文本增长后行高重测无重叠/空洞（jsdom 无法断言布局精度）
- [x] V3 自动跟随保持：新消息到达仍经 `chatEndRef.scrollIntoView` 滚到底部；jsdom 下消息照常可见——根因是 v3 `observeElementRect` 同步首调 `getRect()` 读 `offsetHeight/offsetWidth`（jsdom 恒 0）覆盖 initialRect，测试中以 HTMLElement prototype stub（720×800）解决
- [x] V4 现有 34 个 AgentChatTabView 测试全部通过（行为等价性证明）
- [x] 回归通过：`pnpm type-check`（0 错误）、`pnpm test:run`（261 文件 / 2112 passed）、`pnpm lint`（2026-08-21 实测）

## 实施记录

- `MessageList.tsx`：接入 useVirtualizer（scrollRef 由 AgentChatTabView 的 `.wa-chat` ref 传入），虚拟池绝对定位 + translateY，pinned 区/横幅保持非虚拟化
- `AgentChatTabView.tsx`：新增 `chatScrollRef` 挂 `.wa-chat`
- 测试：beforeAll stub offsetWidth/offsetHeight（jsdom 布局缺失兜底），afterAll 清理

## 实施步骤

1. V1 虚拟化改造（scrollRef 由 AgentChatTabView 传入或 MessageList 内部向上查询）
2. V3 jsdom 兜底 + 自动跟随验证（先跑现有测试，红则修）
3. V2 手动验证路径记录（展开卡片/流式场景无法 jsdom 断言，标注人工验收点）

## 关键约束

- 不改事件协议、不改 CSS 类名体系（`.wa-chat` 仍为滚动容器）
- overscan 默认 8；estimateSize 仅影响首帧，测量后以实际为准
- 不引入 barrel；useVirtualizer 从 @tanstack/react-virtual 直导
