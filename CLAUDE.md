# Neeko — CLAUDE.md

> Claude Code 入口。**项目规范的唯一事实源是 `AGENTS.md` 三件套**：根 `AGENTS.md`（跨栈）+
> `src/AGENTS.md`（前端）+ `src-tauri/AGENTS.md`（后端）。
>
> 本文件**不复制任何规范内容** —— 复制即漂移。历史上这里的版本 / Node / pnpm / 终端缓存 key /
> Agent 启动延迟五项均已与代码不符，2026-09-25 随 AGENTS.md 分层优化一并清理。

@AGENTS.md

## Claude Code 加载行为备忘（勿删本文件的原因）

- 默认模式（`claude-md-or-agents-md`）下，工作目录存在 `CLAUDE.md` 时 Claude Code **只读
  CLAUDE.md、忽略根 `AGENTS.md`** —— 上面那行 `@AGENTS.md` 引入是必需的，删掉等于对
  Claude Code 关闭全部项目规范。
- 嵌套 `src/AGENTS.md` / `src-tauri/AGENTS.md` 仅在用 **Read 工具**打开该子树文件时注入；
  `@` 提及、IDE 打开的文件均不触发。因此：**改 `src/**` 或 `src-tauri/**` 前，先 Read
  对应子目录的 `AGENTS.md`**（与根文件的硬指令一致）。
- 常用命令、快捷键、架构要点、已知问题一律见根 `AGENTS.md` 与
  `docs/keyboard-shortcuts.md`，此处不再复述。

## 会话收尾

遵循根 `AGENTS.md`「AI Assistant Workflow Notes」：跑质量命令确认通过 → 同步 spec →
`add_session.py` 记录会话 → **不要主动提交代码**。
