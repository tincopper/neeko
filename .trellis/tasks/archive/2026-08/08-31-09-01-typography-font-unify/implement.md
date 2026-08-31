# 字体系统收敛与归一 — 实施计划

## Phase 0 — SSOT 收敛（零视觉变化）
- [x] 新建 `src/shared/utils/typography.ts`（MONO_DEFAULT / SANS_DEFAULT / buildMonoStack / buildSansStack / syncTypographyTokens）
- [x] theme.css：合并 mono 真相 + 加 `--font-ui`/`--font-code`/`--line-height-*`；删 `--terminal-font-family`
- [x] tailwind.css：`@theme inline { --font-sans: var(--font-ui); --font-mono: var(--font-code) }`
- [x] base.css body → `var(--font-ui)`
- [x] lsp.css ×2 硬编码 sans → `var(--font-ui)`
- [x] agent.css `.cmd-card` `var(--terminal-font-family)` → `var(--font-mono)`
- [x] 迁移 JS 消费方：useAppConfig（syncTypographyTokens）、terminalFactory、TerminalViewBase、createCmTheme、TaskConsolePanel、TaskConsoleOutput、DebugPanel
- [x] 测试：新增 typography.test.ts；更新 terminal.test.ts / codemirror 相关
- [x] 验证：`pnpm test:run` + `pnpm type-check` + `pnpm lint` 全绿；`grep "font-family:"` 裸定义 ≤1

## Phase 1 — 字号与行高和谐
- [x] 字号模型：`terminalFontSize` 默认 = ui+2、`editorFontSize` 默认 = terminal；滑杆旁「恢复和谐默认」
- [x] `--line-height-mono` token + xterm `lineHeight` 对齐 CodeMirror
- [x] TerminalPanel 预览改进（真实等宽渲染 + Nerd 符号行 + 标注无连字）
- [x] 测试：字号派生纯函数 + Settings 交互

## Phase 2 — 家族拆分（角色配置）
- [x] `monoFontFamily` 字段 + 旧 `fontFamily` 单向迁移（读旧写新）
- [x] TerminalPanel / FileViewer / MarkdownEditor / 终端 strategies 改绑 `monoFontFamily`
- [x] `uiFontFamily` 预留字段（本期不暴露 UI）
- [x] 测试：迁移逻辑（旧→新→写回兼容）

## Phase 3 — 前景色角色统一
- [x] 各主题加 `--mono-fg`/`--mono-fg-dim`
- [x] buildTerminalTheme + createCmTheme 统一读 `--mono-fg`
- [x] 扩展 themeTokens.test.ts 断言 token 齐全
- [x] ⚠️ 视觉变化，需人工确认

## Phase 4 — 扩展性护栏与文档
- [x] lint 守卫：禁止新增裸 `font-family:`（非 nerd-font.css） — `.trellis/scripts/check_font_family_guard.py` 已接入 `pnpm lint`
- [x] docs/best-practices 补字体角色约定 — `.trellis/spec/frontend/quality-guidelines.md` 新增 Typography SSOT 章节
- [x] 收尾：质量门 + add_session

## 验证命令
```
pnpm test:run
pnpm type-check
pnpm lint
cargo test --manifest-path src-tauri/Cargo.toml
```
