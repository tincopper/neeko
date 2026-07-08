# 智能体历史会话管理 — Design

> 完整设计见 `/Users/tomgs/.claude/plans/purring-churning-sparkle.md`

## 架构核心

**Neeko 是 Agent 会话的浏览器，不是存储引擎。**

```
Agent 原生文件（~/.claude/, ~/.codex/, etc.）
        │
        ▼
AgentSessionAdapter（per-agent 解析器）
        │
        ▼
ConversationManager（内存 HashMap 缓存）
        │
        ▼
Tauri Commands（7 个命令）
        │
        ▼
前端 ConversationPanel + Viewer
```

## 关键设计决策

1. **无持久化**：元数据只存内存，进项目扫描
2. **parse_meta / parse_messages 分离**：扫描快（只读头部），查看时按需解析全部消息
3. **恢复双路径**：原生 CLI resume（Codex/CodeBuddy）| 上下文注入（其他 Agent）
4. **View 为编辑器 Tab**：不复用 Panel 内展开，利用现有分屏系统

## 子任务依赖

```
backend ──→ adapters ──→ frontend ──→ integration
```

适配器依赖 backend 的 trait 定义，前端依赖后端命令。集成在所有完成后执行。
