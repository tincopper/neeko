# View page UX optimization

## Goal

提升 Conversation Viewer 页面的信息密度和可读性，让用户能快速识别会话使用的模型、浏览长会话时能跳转到顶部，并减少因逐句分条展示导致的视觉碎片。

## Background

当前 ConversationViewer 每个消息独立渲染为一张卡片（ConversationMessage），Agent 输出常常由后端拆分为多条连续 `assistant` 消息（如逐句返回），导致视觉上过于割裂。

标题栏仅显示 `agentId`，未展示模型信息。没有快速回到顶部的操作。

## Confirmed Facts

- `ConversationMeta` (Rust types.rs + TS types.ts) 均无 `model` 字段
- `ParsedMeta` (adapter.rs) 无 `model` 字段
- Claude Code `.jsonl` 的 `mode` 行可能包含模型名；OpenCode DB `data` JSON 可能含模型字段
- `ConversationViewer` 使用 `useRef` + `messageRefs` 支持按 `msgIdx` 滚动到指定消息
- 消息后端按 `seq` 有序返回，role 可连续重复
- `EditorGroupPane` 已从 `useEditorContext()` 获取 `agents: AgentConfig[]`
- `ConversationItem` 已有通过 `agentId` → `AgentConfig` 查找 agent icon + name 的模式

## Requirements

### R1: 标题栏展示模型名称

- `ParsedMeta` 新增 `model: Option<String>`，适配器层在 `parse_meta` 时尝试提取
  - Claude Code: 从 `mode` 记录的 `model` 字段提取
  - OpenCode: 从 DB `data` JSON 的 `model` 字段提取
  - 其他适配器: 若无来源则返回 `None`
- `ConversationMeta` Rust 端和 TS 端各新增 `model?: string` 字段
- 标题栏展示为 `{agentName} · {model}`；模型为 `None` 时仅显示 agentId

### R2: 支持跳转到第一条消息

- 添加「回到顶部」浮空按钮，仅在滚动超过一屏高度时显示
- 点击后平滑滚动到消息列表顶部

### R3: 连续同 role 消息聚合展示

- 前端 `ConversationViewer` 对 `visibleMessages` 做运行时聚合：连续多条 `assistant` 消息合并为一张卡片
- `user` 消息保持单条独立
- 合并后卡片的 role label 以 agent 图标 + agent 名称（非 "Assistant"）展示，时间戳以首条为准
  - agent 信息从 `agentId` 映射：使用 `agents` 列表查找对应的 `AgentConfig`
  - 若查找不到，fallback 显示 `agentId` 原始字符串
- 各子消息间以分隔线区隔，保留各自的 blocks 渲染

## Acceptance Criteria

### R1
- [ ] `ParsedMeta` 和 `ConversationMeta` 新增 `model: Option<String>` 字段
- [ ] Claude Code 适配器能从 `mode` 记录提取模型名
- [ ] OpenCode 适配器能从 DB data JSON 提取模型名
- [ ] 标题栏正确展示 `agentName · model`，模型为 None 时只显示 agentId
- [ ] 前端类型定义同步更新，无 type error

### R2
- [ ] 浮空按钮在滚动超过一屏后出现
- [ ] 点击平滑滚动到消息列表顶部
- [ ] 按钮样式与现有 design system 一致

### R3
- [ ] 连续 `assistant` 消息合并为一张卡片
- [ ] 合并卡片的 role label 显示 agent icon + agent name，timestamp 为首条时间
- [ ] 子消息间以分隔线区隔，各自 blocks 正常渲染
- [ ] `user` 消息不受影响
- [ ] tool call sidebar 的 `scrollToMessage` 仍能定位到目标消息所属的组
- [ ] `hasMore` / `loadMore` 分页加载后聚合依然正确
- [ ] `agentId` 对应 agent 找不到时 fallback 正确

## Out of Scope

- 不在消息卡内做「展开/折叠」交互
- 不支持聚合后单独跳转到子消息内的具体 block
- 不修改后端消息存储结构
