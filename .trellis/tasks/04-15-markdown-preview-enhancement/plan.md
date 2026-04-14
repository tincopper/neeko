# Markdown 预览增强 — 技术计划

## 1. 背景

当前 `FileViewer.tsx` 中的 Markdown 预览使用 `react-markdown` + `remark-gfm` + `rehype-highlight`，存在以下问题：
- **排版缺失**：未安装 `@tailwindcss/typography` 插件，`prose` 类未生效
- **功能缺失**：不支持 Mermaid、PlantUML、图片点击预览
- **耦合度高**：预览逻辑与 FileViewer 直接耦合

## 2. 范围

| 类别 | 内容 |
|------|------|
| **修改** | `src/components/panels/FileViewer.tsx`、`src/components/ui/index.ts` |
| **新增** | `src/components/ui/MarkdownPreview.tsx` |
| **新增依赖** | `@tailwindcss/typography`、`mermaid`、`yet-another-react-lightbox` |

## 3. 技术方案

### 3.1 选型对比

| 方案 | 特点 | 推荐 |
|------|------|------|
| `react-markdown` | 轻量、安全、插件化强、社区最大 (17.4M/周) | ✅ 推荐 |
| `@uiw/react-markdown-preview` | 开箱即用、GitHub 风格 | 备选 |
| `markdown-to-jsx` | 最小依赖 | 备选 |

### 3.2 架构决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 核心库 | `react-markdown` | 已有 v9.0.3，插件生态丰富 |
| 代码高亮 | `rehype-highlight` | 已有 highlight.js |
| GFM 支持 | `remark-gfm` | 已有 |
| Mermaid | `mermaid` npm 包 + 自定义组件 | 浏览器端渲染 |
| PlantUML | 公共服务器 (`plantuml.com`) | 简化方案，无需 JVM |
| 图片预览 | `yet-another-react-lightbox` | 功能完整 (317K/周) |

### 3.3 组件设计

```tsx
interface MarkdownPreviewProps {
  content: string;      // Markdown 内容
  theme?: 'dark' | 'light';  // 主题
  className?: string;  // 额外样式
}
```

- 通过 `remarkPlugins` 和 `rehypePlugins` 配置
- 通过 `components` prop 自定义 `img`、`code` 等元素
- 主题通过 `theme` prop 传递给 mermaid 和样式类

## 4. 实施步骤

### 4.1 安装依赖

```bash
pnpm add -D @tailwindcss/typography
pnpm add mermaid yet-another-react-lightbox
```

### 4.2 配置 Typography 插件

修改 `src/styles/index.css`：

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
@import "@xterm/xterm/css/xterm.css";
```

### 4.3 创建 MarkdownPreview 组件

文件：`src/components/ui/MarkdownPreview.tsx`

核心逻辑：
1. 使用 `ReactMarkdown` 渲染内容
2. 自定义 `img` 组件：点击打开 Lightbox
3. 自定义 `code` 组件：
   - 检测 `language-mermaid`：渲染 MermaidBlock
   - 检测 `language-plantuml`：渲染 PlantUMLBlock（通过 URL）
4. 初始化 mermaid，根据 theme 切换主题

### 4.4 导出组件

修改 `src/components/ui/index.ts`：

```ts
export { MarkdownPreview } from "./MarkdownPreview";
```

### 4.5 集成到 FileViewer

修改 `src/components/panels/FileViewer.tsx`：

```tsx
import { MarkdownPreview } from "../ui";

// 替换现有 ReactMarkdown
<MarkdownPreview
  content={currentContent}
  theme={isDarkTheme ? "dark" : "light"}
  className="prose prose-sm dark:prose-invert max-w-none"
/>
```

## 5. 验收标准

- [ ] Markdown 基础排版正常（标题、引用、超链接、列表、表格）
- [ ] GFM 语法支持（任务列表、删除线、脚注）
- [ ] 代码块语法高亮正常
- [ ] Mermaid 代码块正确渲染为图表
- [ ] PlantUML 代码块正确渲染为图表
- [ ] 图片点击可放大预览（Lightbox）
- [ ] 深色/浅色主题样式正确跟随

## 6. 风险与限制

| 风险 | 影响 | 缓解 |
|------|------|------|
| PlantUML 依赖公共服务器 | 网络不稳定时图表无法加载 | 考虑后续支持自建服务器 |
| Mermaid 渲染性能 | 大文档可能有延迟 | mermaid 懒加载 |
| 图片跨域 | 某些图片可能无法预览 | 依赖浏览器安全策略 |

## 7. 依赖关系

```
@tailwindcss/typography
    ↓
mermaid (直接)
    ↓
yet-another-react-lightbox
```