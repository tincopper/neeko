# Typography 字体系统收敛与归一 (Phase 0-4)

## Goal

统一终端/编辑器/UI 字体栈（消除 4 处 mono 栈分裂 + 3 处 sans 硬编码）；字号/行高和谐；fontFamily 角色化拆分；前景色角色 token；lint 护栏。

## Background（已核查事实）

- mono 栈分裂 4 处：`--terminal-font-family` / `--font-mono` / `terminal.ts DEFAULT_FONT_FAMILY` / Tailwind `font-mono` 默认栈（**125 处组件类不跟随用户设置**）。
- sans 硬编码 3 处：`base.css body` + `lsp.css ×2`。
- 字号 3 个独立真相（`--font-size` 12 / `--terminal-font-size` 14 / `editorFontSize` 14），无派生关系。
- 行高 3 个真相（body 1.4 / xterm 默认 1.0 / CodeMirror 另设）。
- 前景色 2 个真相（终端 ANSI #abb2bf / 编辑器 `var(--text-primary)` 纯白）。
- 设置页生效性已验证：终端/编辑器字号完全生效（含已存在会话）；终端字体族不作用于 125 处 `font-mono` 类与 `--font-mono` 消费方；外观字号只作用于 var/em 写法（约 60%）。

## Requirements

### R0 — SSOT 收敛（Phase 0，零视觉变化）
- R0.1 mono 角色单一定义：`--font-mono`（含 NerdFontSymbols），删除 `--terminal-font-family`。
- R0.2 sans 角色单一定义：`--font-ui`，替代 base.css / lsp.css 硬编码。
- R0.3 Tailwind 桥接：`font-sans`/`font-mono` 工具类解析到角色 token（`@theme inline`，避开自引用）。
- R0.4 JS 单一构造器 `buildMonoStack` + 单一写入口 `syncTypographyTokens`（useAppConfig 唯一调用）。
- R0.5 迁移全部 JS 消费方（xterm×2、createCmTheme、TaskConsole×2、DebugPanel）。

### R1 — 字号与行高和谐（Phase 1）
- R1.1 字号派生模型：`terminalFontSize` 默认 = ui+2、`editorFontSize` 默认 = terminal；滑杆旁「恢复和谐默认」。
- R1.2 `--line-height-mono` token；xterm `lineHeight` 与 CodeMirror 对齐（改动会变 xterm rows，需回归）。
- R1.3 TerminalPanel 预览改进：真实等宽渲染 + Nerd 符号行 + 标注无连字。

### R2 — 家族拆分（Phase 2，角色配置）
- R2.1 `monoFontFamily` 新字段；旧 `fontFamily` 单向迁移（读旧写新，幂等）。
- R2.2 终端 strategies / TerminalPanel / FileViewer / MarkdownEditor 改绑 `monoFontFamily`。
- R2.3 `uiFontFamily` 预留字段（本期不暴露 UI）。

### R3 — 前景色角色统一（Phase 3）
- R3.1 各主题加 `--mono-fg`/`--mono-fg-dim`。
- R3.2 `buildTerminalTheme` + `createCmTheme` 统一读 `--mono-fg`。

### R4 — 扩展性护栏与文档（Phase 4）
- R4.1 lint 守卫：禁止新增裸 `font-family:`（非 nerd-font.css）。
- R4.2 docs/best-practices 补字体角色约定。

## Constraints

- 不改字体文件、不引入新依赖、不改 xterm 渲染器选型。
- 每阶段可独立合入；Phase 0 零视觉变化（只统一栈，不动字号颜色）。
- 配置迁移幂等：旧字段存在即读，新字段变化即写回。

## Acceptance Criteria

- [ ] **P0** `grep "font-family:" src/styles` 裸定义 ≤1（仅 nerd-font.css）；`--font-mono` 单一定义
- [ ] **P0** 125 处 `font-mono` 类与终端/编辑器同栈；改终端字体族，markdown/lsp/agent-chat 消费方同步跟随
- [ ] **P0** `pnpm test:run` + `pnpm type-check` + `pnpm lint` 全绿
- [ ] **P1** 字号派生纯函数 + Settings 交互测试通过；xterm rows 回归正常
- [ ] **P2** 迁移逻辑测试（旧 `fontFamily` → 新 `monoFontFamily` → 写回兼容）通过
- [ ] **P3** 各主题 `--mono-fg` token 齐全（themeTokens 测试）；终端与编辑器前景统一（视觉确认）
- [ ] **P4** lint 守卫生效（构造新裸 `font-family:` 使 `pnpm lint` 失败）；best-practices 文档已更新

## Notes

- 详细设计见 `design.md`；执行计划见 `implement.md`。
- Phase 3 有视觉变化（编辑器前景随 `--mono-fg`），合入前需人工确认。
