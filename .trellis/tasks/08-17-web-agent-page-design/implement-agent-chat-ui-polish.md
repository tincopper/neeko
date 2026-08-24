# Agent Chat UI 打磨 — Composer 减法与信息降噪

> 挂靠任务：08-17-web-agent-page-design（用户指定在当前任务内继续，不新建任务）。
> 背景：neeko-check UI 对照评审（2026-08-21）判定 Block 级问题已修（debug 残留/reasoning 折叠/emoji 统一），
> 本轮处理 Major 级「别扭」来源。纯前端改动，不动 Rust 命令层。

## 验收标准

- [x] P1a 删除 composer 4 个死按钮（Add image / Add folder / Mention / Voice note，均无 onClick 绑定）
- [x] P1b 删除 composer-meta 假数据：硬编码 `$0.024` 成本、静态 `ctx-ring` 圆环；上下文用量仅保留 footer 的 ContextWindowMeter 一处（去重；连带删除无消费方的 `.ctx-ring`/`.ctx-cost` 死样式与 `ctxTokens`/`ctxPct` 估算逻辑）
- [x] P1c 快捷键提示与实际行为一致：当前为 Enter 发送 / Shift+Enter 换行，提示文案同步修正；未实现的 ⌘⇧M 提示删除
- [x] P1d `ctxPct` 使用真实 `contextWindow.total` 计算，移除硬编码 `200_000`（contextWindow 缺失时不显示百分比）——随 meta 区假计量一并删除，footer ContextWindowMeter 本就以真实 total 计算
- [x] P2a 消息时间戳默认隐藏，hover 消息行时显示（CSS 实现，不改 DOM 结构语义）
- [x] P2b `wa-sys` 会话横幅弱化：字号/内边距收敛，视觉退为背景层（不删除——上下文注入信息有存在价值）
- [x] P3 消息内相邻 tool blocks 合并后传给 WorkRows，使既有 `chunkToolGroups` 分组折叠对跨 block 连续工具生效（≥2 连续同类工具折叠为摘要行；running 组挂载默认展开、完成后保持，用户可手动收起）
- [x] 全程 TDD：先写失败测试（红）→ 最小实现（绿）→ 重构（蓝）
- [x] 回归通过：`pnpm type-check`、`pnpm test:run`（261 文件 / 2111 passed）、`pnpm lint`（2026-08-21 实测）

## 实施顺序

1. P1a → P1b → P1c → P1d（composer/meta 减法，低风险高观感收益）
2. P2a → P2b（CSS 弱化降噪）
3. P3 渲染层 tool blocks 合并分组（逻辑改动最大，放最后）

## 关键约束

- 不新增 Tauri 命令、不改 Event 名、不动后端
- 分组复用既有 `utils/toolCallGroup.ts` 的 `chunkToolGroups`，不重写分组算法
- ContextWindowMeter 组件保持现状（footer 单点展示），不在 meta 区重复
- 死按钮直接删除而非隐藏——YAGNI，未来需要时随功能一起加回
- 保持 React.memo / useCallback 既有性能模式

## 明确不做（本轮范围外）

- 虚拟滚动（@tanstack/react-virtual 集成，独立任务评估）
- AgentChatTabView.tsx 2046 行拆分（独立重构任务）
- ~~字号档位全面归并~~ → 已在后续批次完成（见下）
- ~~审批面板固定 composer 上方~~ → 已在后续批次完成（见下）

## 后续批次（2026-08-21 第二轮，用户确认轻量批）

- [x] B1 审批/澄清/计划面板移出滚动区，固定于 composer 上方（长会话始终可见可决策）；新增测试断言面板不在 `.wa-chat` 内
- [x] B2 面板宽度对齐 720px 会话列（`max-width:720px; margin:8px auto`）；补 `.ap-pre` mono 样式
- [x] B3 CSS 去重：删除无消费方的 `uinput-*` 死样式块与重复的 `.user-input-panel` 定义
- [x] B4 字号档位收敛：10 档碎片（9/10/10.5/11/11.5/12/12.5/13/14/16px）归并为 4 档体系（10 徽标 / 11 辅助 / 12.5 次级·代码 / 14 正文）
- [x] 回归：`pnpm test:run` 261 文件 / 2112 passed、`pnpm type-check`、`pnpm lint` 全绿
