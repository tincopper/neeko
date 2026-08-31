# 字体系统收敛与归一 — 设计

## 问题（已核查事实）

| 角色 | 分裂定义 | 数量 |
|---|---|---|
| mono | `theme.css --terminal-font-family` / `--font-mono` / `terminal.ts DEFAULT_FONT_FAMILY` / Tailwind `font-mono` 默认栈 | 4 处 |
| sans | `base.css body` + `lsp.css ×2` 硬编码 | 3 处 |
| 字号 | `--font-size`(12) / `--terminal-font-size`(14) / `editorFontSize`(14)，无派生 | 3 真相 |
| 行高 | body 1.4 / xterm 默认 1.0 / CodeMirror 另设 | 3 真相 |
| 前景 | 终端 ANSI #abb2bf / 编辑器 `var(--text-primary)` 纯白 | 2 真相 |

已核实行为（设置页生效性）：
- 终端字号/编辑器字号：完全生效（含已存在 xterm 会话）。
- 终端字体族 `fontFamily`：生效于 xterm/编辑器/Console/命令卡片，但 **125 处 Tailwind `font-mono` 类不跟随**、`--font-mono` 消费方（markdown/lsp/agent-chat）不跟随。
- 外观字号：`--font-size` var + em 相对（~430 处）跟随；Tailwind 固定 `text-sm/xs/base`（~278 处）不跟随。

## 原则

1. **SSOT**：每角色单一定义，其余全为消费者。
2. **角色驱动**：消费方声明「UI sans / mono」角色，不声明字体文件。
3. **正交独立**：族/号/高/色各自 token，互不混写。

## 目标架构

### Tokens（theme.css）
```
--font-ui: <sans stack>                       # UI 角色（替代 base.css/lsp.css 硬编码）
--font-mono: <mono stack 含 NerdFontSymbols>  # mono 唯一真相
--font-code: var(--font-mono)                 # 桥接别名（避开 @theme 键自引用）
--line-height-ui: 1.4
--line-height-mono: 1.5
--mono-fg / --mono-fg-dim                     # mono 前景角色（终端+编辑器共用）
```
删除 `--terminal-font-family`。

### Tailwind 桥接（tailwind.css）
```css
@theme inline {
  --font-sans: var(--font-ui);
  --font-mono: var(--font-code);
}
```
> 陷阱：不能 `--font-mono: var(--font-mono)`（@theme 键自引用）。沿用仓库 shadcn.css 既有 `@theme inline` 模式。

### JS 桥（新 shared/utils/typography.ts）
- `MONO_DEFAULT` / `SANS_DEFAULT` 常量
- `buildMonoStack(userOverride)` / `buildSansStack(userOverride)`
- `syncTypographyTokens(cfg)`：useAppConfig 单一写入口（写 `--font-mono`/`--font-size-*`/`--line-height-*`/`--mono-fg`）
- `buildFontFamily`（terminal.ts）保留为兼容 re-export 或迁移全部调用方

### 配置模型（AppConfig，Phase 2）
- `fontFamily` 保留（deprecated 别名）
- `monoFontFamily` 新字段（终端+编辑器+全部 font-mono）
- `uiFontFamily` 预留（本期不暴露 UI）
- 迁移：读旧 `fontFamily` → `monoFontFamily`；保存时写回兼容

## 兼容 / 回滚
- Phase 0 零视觉变化（只统一栈，不动字号颜色）→ 可独立合入回滚。
- Phase 3 有视觉变化（编辑器前景随 `--mono-fg`），需人工确认。
- 配置迁移幂等：旧字段存在即读，新字段变化即写回。

## 边界
- 不改字体文件、不引入新依赖、不改 xterm 渲染器选型。
- 行高改动会改变 xterm 格子高度→rows，Phase 1 需回归终端布局。
