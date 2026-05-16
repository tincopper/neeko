# Nerd Font 图标 fallback 支持

## 问题

Starship / Powerlevel10k 等美化工具使用 Nerd Font 的 Private Use Area 码点渲染图标（如 `󰀵` = `U+F0035`）。Neeko 的 xterm.js 终端使用 `DEFAULT_FONT_FAMILY`（JetBrains Mono / Fira Code / Cascadia Code / monospace），这些字体不包含 Nerd Font 图标字形 → 渲染为豆腐块。

当前解决方案：用户手动在设置里选一个已安装的 Nerd Font。问题：
- 不是开箱即用
- 硬编码常见 Nerd Font 名称无法覆盖所有变体

## 方案

打包 Nerd Font 官方提供的 **Symbols-Only 字体**（`SymbolsNerdFontMono-Regular.ttf`，~1.2MB），通过 CSS `@font-face` + `unicode-range` 加载，作为终端字体 fallback 链的最后一个兜底项。

### 为什么是 Symbols-Only 字体

- 只包含图标字形，不含字母数字 → 不影响默认字体的文本渲染
- CSS `unicode-range` 让浏览器只在命中 PUA 码点时才请求该字体 → 不影响性能
- 覆盖 Nerd Font 全部图标集，不需要猜测用户装了什么 Nerd Font
- App 体积增加 ~1.2MB，桌面应用完全可接受

## 改动范围

### 前端

1. **新增字体资产** `src/assets/fonts/SymbolsNerdFontMono-Regular.ttf`
   - 从 [Nerd Fonts Releases](https://github.com/ryanoasis/nerd-fonts/releases) 下载

2. **新增 CSS** `src/styles/nerd-font.css`（或在现有入口 CSS 中追加）
   ```css
   @font-face {
     font-family: 'NerdFontSymbols';
     src: url('../assets/fonts/SymbolsNerdFontMono-Regular.ttf') format('truetype');
     font-weight: normal;
     font-style: normal;
     unicode-range: U+E000-U+F8FF, U+F0000-U+FFFFD, U+100000-U+10FFFD;
   }
   ```

3. **修改 `src/utils/terminal.ts`** — `buildFontFamily()` 末尾追加 `'NerdFontSymbols'`
   ```ts
   export function buildFontFamily(fontFamily: string): string {
     const base = fontFamily
       ? `'${fontFamily}', ${DEFAULT_FONT_FAMILY}`
       : DEFAULT_FONT_FAMILY;
     return `${base}, 'NerdFontSymbols'`;
   }
   ```

4. **确保 CSS 被入口引入** — 在 `src/main.tsx` 或全局样式文件中 `import './styles/nerd-font.css'`

### 后端

无需改动。xterm.js 在 webview Canvas 上渲染，字体由浏览器引擎处理。

### Tauri 配置

确保 `src/assets/` 目录下的 .ttf 文件被 Vite 正确打包（作为静态资源）。

## 验收标准

- [ ] 默认字体设置（fontFamily 为空）下，Starship 提示符图标正常显示
- [ ] 用户手动选择其他字体后，图标仍然正常（因为 `NerdFontSymbols` 在 fallback 链末尾）
- [ ] `pnpm type-check` 通过
- [ ] `pnpm test:run` 通过（新增 buildFontFamily 相关测试）
