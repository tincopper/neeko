# Markdown 预览增强 — 技术计划

## 1. 背景

当前 `FileViewer.tsx` 中的 Markdown 预览使用 `react-markdown` + `remark-gfm` + `rehype-highlight`，存在以下问题：
- **排版缺失**：未安装 `@tailwindcss/typography` 插件，`prose` 类未生效
- **功能缺失**：不支持 Mermaid、PlantUML、图片点击预览
- **耦合度高**：预览逻辑与 FileViewer 直接耦合
- **代码高亮无样式**：`index.css` 中的 `.hljs-*` 样式全部限定在 `.diff-line .line-content` 选择器下（DiffView 专用），Markdown 预览中裸露的 `.hljs-*` 类没有任何 CSS 命中
- **主题不跟随**：无论哪个主题，Markdown 预览的排版和高亮都缺乏样式

## 2. 范围

| 类别 | 内容 |
|------|------|
| **修改** | `src/components/panels/FileViewer.tsx`、`src/components/ui/index.ts`、`src/styles/index.css`、`src/styles/theme.css`、`vite.config.ts` |
| **新增** | `src/components/ui/MarkdownPreview.tsx`、`src/components/ui/__tests__/MarkdownPreview.test.tsx` |
| **新增依赖** | `mermaid`、`plantuml-encoder`、`rehype-raw` |

## 3. 技术选型

### 3.1 Markdown 渲染核心库

| 方案 | 周下载量 | 特点 | 适合场景 |
|------|---------|------|---------|
| `react-markdown` v9 | 17.4M | 轻量、插件化、remark/rehype 生态完整 | ✅ **已有，本方案选用** |
| `@uiw/react-markdown-preview` | 150K | 开箱即用、内置 GitHub 风格、内置代码高亮 | 重量级，内部样式与应用主题强耦合，自定义困难 |
| `markdown-to-jsx` | 3.2M | 最小依赖，JSX 级别定制 | 缺乏 remark/rehype 生态，扩展 Mermaid/PlantUML 需自行解析 AST |

**结论：** 继续使用已有的 `react-markdown`，通过 `remarkPlugins` / `rehypePlugins` / `components` 三层扩展实现全部功能。零迁移成本，生态最丰富。

### 3.2 代码高亮方案

| 方案 | 特点 | 与项目匹配度 |
|------|------|------------|
| `rehype-highlight`（基于 highlight.js） | 已有，输出 `.hljs-*` CSS 类 | ✅ 已安装，需新增一套 Markdown 专用的 `.hljs-*` 样式 |
| `rehype-prism-plus`（基于 Prism） | 行号支持好，类名不同 | 需引入 Prism 依赖并全部重写高亮 CSS |
| `rehype-shiki`（基于 Shiki） | 零运行时，颜色内联到 HTML | 无需 CSS，但主题切换需完整重渲染，配置复杂 |

**结论：** 保留 `rehype-highlight`。

> ⚠️ **关键纠正**：当前 `index.css` 中的 `.hljs-*` 样式全部限定在 `.diff-line .line-content .hljs-*` 选择器下，是 DiffView 专用的，**不会作用于 MarkdownPreview**。必须为 Markdown 预览新增一套独立的 `.hljs-*` 样式（在 `.markdown-preview` 作用域下），并在 `theme.css` 中为每个主题配置对应的高亮颜色。

### 3.3 Mermaid 渲染方案

| 方案 | Bundle 影响 | 离线支持 | 实现复杂度 |
|------|------------|---------|----------|
| `mermaid` npm 包（浏览器渲染） | ~2.5MB，**必须独立 chunk** | ✅ | 中 |
| `kroki.io` 公共服务（与 PlantUML 统一） | 0 | ❌ 网络依赖 | 低 |
| `mermaid` + `@mermaid-js/mermaid-zenuml` | 更大 | ✅ | 高 |

**结论：** 选用 `mermaid` npm 包。理由：
1. 应用本身是桌面工具，离线能力重要
2. 通过 `vite.config.ts` 的 `manualChunks` 独立分割，不影响首屏
3. `MermaidBlock` 组件内部动态 `import('mermaid')` 实现懒加载

### 3.4 PlantUML 渲染方案

PlantUML 使用公共服务器 (`plantuml.com`) 渲染，无需 JVM。

> ⚠️ **编码细节**：PlantUML URL 使用**自定义编码**（deflate 压缩 + 自定义 base64 变体），不是标准 base64。需要引入 `plantuml-encoder` npm 包来处理编码。
>
> ```bash
> pnpm add plantuml-encoder
> ```
>
> 使用方式：
> ```tsx
> import plantumlEncoder from "plantuml-encoder";
> const encoded = plantumlEncoder.encode(plantumlCode);
> const url = `https://www.plantuml.com/plantuml/svg/${encoded}`;
> ```

### 3.5 排版样式方案（`@tailwindcss/typography`）

| 方案 | 适配情况 | 风险 |
|------|---------|------|
| `@tailwindcss/typography@0.5.x` + `@plugin` 指令 | Tailwind v4 新语法 | 🟡 v4 兼容性需验证 |
| 手写 prose 样式（CSS 变量驱动） | 完全自主可控 | 工作量较大，但零外部依赖风险 |

**策略：优先尝试方案 1，实施时先验证兼容性。**

**如果 `@tailwindcss/typography` 与 Tailwind v4 不兼容**，fallback 方案是**在 `index.css` 的 `@layer components` 中手写 `.markdown-preview` 排版样式**（基于 CSS 变量），不应降级到 Tailwind v3（会影响整个项目）。手写 fallback 示例：

```css
@layer components {
  .markdown-preview h1 { font-size: 2em; font-weight: 700; margin-top: 0; margin-bottom: 0.5em; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
  .markdown-preview h2 { font-size: 1.5em; font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; color: var(--text-primary); }
  .markdown-preview p { margin-bottom: 1em; color: var(--text-primary); line-height: 1.7; }
  .markdown-preview a { color: var(--accent-blue); text-decoration: underline; }
  .markdown-preview blockquote { border-left: 4px solid var(--accent-blue); padding-left: 1em; color: var(--text-secondary); margin: 1em 0; }
  .markdown-preview pre { background: var(--bg-secondary); border-radius: 6px; padding: 1em; overflow-x: auto; }
  .markdown-preview code { font-size: 0.875em; }
  .markdown-preview table { width: 100%; border-collapse: collapse; }
  .markdown-preview th, .markdown-preview td { border: 1px solid var(--border-color); padding: 0.5em 0.75em; }
  .markdown-preview th { background: var(--bg-secondary); font-weight: 600; }
  /* ... 其余元素 */
}
```

### 3.6 主题跟随方案（关键设计）

#### 3.6.1 Typography 主题桥接

**如果使用 `@tailwindcss/typography`**，需在 `src/styles/theme.css` 每个主题 block 中覆盖 `--tw-prose-*` 变量：

```css
/* 示例：dark 主题 */
:root[data-theme="dark"], :root:not([data-theme]) {
  /* 已有变量 ... */

  /* prose 主题桥接 */
  --tw-prose-body:          var(--text-primary);
  --tw-prose-headings:      var(--text-primary);
  --tw-prose-lead:          var(--text-secondary);
  --tw-prose-links:         var(--accent-blue);
  --tw-prose-bold:          var(--text-primary);
  --tw-prose-counters:      var(--text-secondary);
  --tw-prose-bullets:       var(--text-secondary);
  --tw-prose-hr:            var(--border-color);
  --tw-prose-quotes:        var(--text-secondary);
  --tw-prose-quote-borders: var(--accent-blue);
  --tw-prose-captions:      var(--text-muted);
  --tw-prose-code:          var(--accent-green);
  --tw-prose-pre-code:      var(--text-primary);
  --tw-prose-pre-bg:        var(--bg-secondary);
  --tw-prose-th-borders:    var(--border-color);
  --tw-prose-td-borders:    var(--border-color);
}
```

同样的桥接需在 `one-dark-pro`、`claude`、`light` 主题中各自配置。

> 如果走手写 fallback 方案，排版样式直接用 CSS 变量（`var(--text-primary)` 等），天然跟随主题，无需桥接。

#### 3.6.2 代码高亮主题联动

为 Markdown 预览新增独立的 `.hljs-*` 样式，使用 `.markdown-preview` 作用域隔离，不影响 DiffView：

```css
/* Dark 主题高亮（dark + one-dark-pro）*/
.markdown-preview .hljs-keyword { color: #c678dd; }
.markdown-preview .hljs-string  { color: #98c379; }
.markdown-preview .hljs-comment { color: #5c6370; font-style: italic; }
/* ... 完整 token 列表 */

/* Light 主题高亮（light + claude）需要单独配色 */
:root[data-theme="light"] .markdown-preview .hljs-keyword { color: #a626a4; }
:root[data-theme="light"] .markdown-preview .hljs-string  { color: #50a14f; }
:root[data-theme="light"] .markdown-preview .hljs-comment { color: #a0a1a7; font-style: italic; }
/* ... */

:root[data-theme="claude"] .markdown-preview .hljs-keyword { color: #8b5cf6; }
:root[data-theme="claude"] .markdown-preview .hljs-string  { color: #5a8a5e; }
:root[data-theme="claude"] .markdown-preview .hljs-comment { color: #a89282; font-style: italic; }
/* ... */
```

## 4. 架构设计

### 4.1 组件接口

```tsx
interface MarkdownPreviewProps {
  content: string;          // Markdown 原始内容
  theme: AppTheme;          // 应用主题（驱动 mermaid 主题 + CSS 变量选择）
  className?: string;       // 外部样式扩展
}

export function MarkdownPreview({ content, theme, className }: MarkdownPreviewProps): JSX.Element
```

**符合项目规范**（参考 `component-guidelines.md`）：
- Props 用 `interface` 定义
- `AppTheme` 从 `types.ts` 导入
- 组件导出时用 `React.memo` 包裹

### 4.2 组件内部结构

```
MarkdownPreview (.markdown-preview 作用域)
├── ReactMarkdown (core)
│   ├── remarkPlugins: [remarkGfm]
│   ├── rehypePlugins: [rehypeRaw, rehypeHighlight]
│   └── components:
│       ├── img  → ImageBlock (带 overlay 点击预览)
│       ├── a    → LinkBlock (target="_blank" + rel="noopener")
│       └── code → CodeBlock
│           ├── language-mermaid  → MermaidBlock (动态 import mermaid)
│           ├── language-plantuml → PlantUMLBlock (plantuml-encoder + URL)
│           ├── language-svg/html → SVG 渲染 (extractCodeText + dangerouslySetInnerHTML)
│           └── default           → <code> (rehype-highlight 已处理 CSS 类)
```

### 4.3 MermaidBlock 懒加载设计

```tsx
// 组件内部，不在模块顶层 import
function MermaidBlock({ code, theme }: { code: string; theme: AppTheme }) {
  const [svg, setSvg] = useState<string>("");
  const id = useRef(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;
      const isDark = theme === "dark" || theme === "one-dark-pro";
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
      });
      mermaid.render(id.current, code).then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      });
    });
    return () => { cancelled = true; };
  }, [code, theme]);

  if (!svg) return <div className="animate-pulse bg-bg-tertiary rounded h-32" />;
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

### 4.4 PlantUMLBlock 设计

```tsx
import plantumlEncoder from "plantuml-encoder";

function PlantUMLBlock({ code }: { code: string }) {
  const url = useMemo(() => {
    const encoded = plantumlEncoder.encode(code);
    return `https://www.plantuml.com/plantuml/svg/${encoded}`;
  }, [code]);

  return (
    <div className="my-4">
      <img src={url} alt="PlantUML diagram" className="max-w-full"
        onError={(e) => { (e.target as HTMLImageElement).alt = "PlantUML 图表加载失败"; }} />
    </div>
  );
}
```

### 4.5 vite.config.ts 分包

```ts
manualChunks: {
  xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-unicode11"],
  highlight: ["highlight.js/lib/core"],
  lucide: ["lucide-react"],
  mermaid: ["mermaid"],  // 新增：独立分割，约 2.5MB
},
```

## 5. 实施步骤

### Step 1：安装依赖

```bash
pnpm add mermaid plantuml-encoder
pnpm add -D @tailwindcss/typography
```

### Step 2：验证 Typography v4 兼容性（⚠️ 关键卡点）

在 `src/styles/index.css` 中添加 `@plugin "@tailwindcss/typography"`，启动 `pnpm tauri dev`，检查是否报错。

- ✅ 如果兼容：继续使用 `prose` 类 + `--tw-prose-*` 变量桥接
- ❌ 如果不兼容：**移除 `@tailwindcss/typography`**，改用手写 `.markdown-preview` 排版样式（见 3.5 节 fallback）

**实际执行**：选择了手写 `.markdown-preview` 排版样式方案（见 3.5 节 fallback）。`.markdown-preview` 排版样式直接使用 CSS 变量，天然跟随主题。未安装 `@tailwindcss/typography`。

### Step 3：在 theme.css 中添加主题样式

1. **prose 桥接**（如果使用 typography）：在 4 个主题 block 中添加 `--tw-prose-*` 覆盖
2. **hljs 高亮**（必须）：新增 `.markdown-preview .hljs-*` 样式，dark 主题使用 One Dark Pro 配色，light/claude 使用匹配的浅色配色
3. 所有颜色基于 CSS 变量，无需 JS 运行时切换

### Step 4：创建 MarkdownPreview 组件

文件：`src/components/ui/MarkdownPreview.tsx`

1. `ReactMarkdown` + `remark-gfm` + `rehype-raw` + `rehype-highlight` 渲染基础内容
2. 外层 `<div className="markdown-preview">` 提供 CSS 作用域
3. 自定义 `code` 组件：检测 `language-mermaid` → `MermaidBlock`，检测 `language-plantuml` → `PlantUMLBlock`
4. 自定义 `img` 组件：`ImageBlock`（点击时显示 overlay 全屏预览）
5. 自定义 `a` 组件：外部链接添加 `target="_blank"` + `rel="noopener noreferrer"`
6. `MermaidBlock`：`useEffect` + 动态 `import('mermaid')` 懒加载，加载中显示骨架屏
7. `PlantUMLBlock`：`plantuml-encoder` encode + `<img>` 渲染，带错误占位
8. 添加 `extractCodeText` 辅助函数：递归从 rehype-highlight AST 树中提取纯文本，解决 `String(children)` 返回 `[object Object]` 的问题
9. SVG 支持：ImageBlock 检测 `.svg` 后缀和 `data:image/svg` 前缀，添加 `width: 100%`；SvgCodeBlock 检测 ` ```svg ` / ` ```html ` 代码块内容含 `<svg` 时渲染为图形

### Step 5：编写测试

文件：`src/components/ui/__tests__/MarkdownPreview.test.tsx`

测试用例（TDD 优先）：
- 基础渲染：标题、段落、列表、引用、超链接
- GFM：表格、任务列表、删除线
- 代码块渲染：确认 `.hljs` 类名存在
- Mermaid 代码块：验证 MermaidBlock 渲染（mock `import('mermaid')`）
- PlantUML 代码块：验证 img src 包含 plantuml.com URL
- 图片点击预览：验证 overlay 行为
- 主题 prop 变化：验证 `.markdown-preview` 上的 className 正确

### Step 6：更新 vite.config.ts

添加 `mermaid: ["mermaid"]` 到 `manualChunks`。

### Step 7：更新 ui/index.ts 导出

```ts
export { MarkdownPreview } from "./MarkdownPreview";
```

### Step 8：集成到 FileViewer

```tsx
import { MarkdownPreview } from "../ui";

// 替换现有 ReactMarkdown 段落（FileViewer.tsx line 269-274）
{showPreview ? (
  <div className="h-full overflow-y-auto px-6 py-4">
    <MarkdownPreview
      content={currentContent}
      theme={theme}
      className="prose prose-sm max-w-none"
    />
  </div>
) : ( ... )}
```

同时从 FileViewer 中**移除**不再需要的 import：
```diff
- import ReactMarkdown from "react-markdown";
- import remarkGfm from "remark-gfm";
- import rehypeHighlight from "rehype-highlight";
```

## 6. 验收标准

- [ ] Markdown 基础排版正常（标题、引用、超链接、列表、表格），在所有 4 个主题下样式正确跟随
- [ ] GFM 语法支持（任务列表、删除线、表格）
- [ ] 代码块语法高亮正常，dark/one-dark-pro/light/claude 主题下对比度均可读
- [ ] Mermaid 代码块正确渲染为 SVG 图表（支持主题切换）
- [ ] PlantUML 代码块正确渲染为 SVG 图表（公共服务器 + plantuml-encoder）
- [ ] 图片点击可放大预览（overlay 方式）
- [ ] MarkdownPreview 组件独立，不直接引用 FileViewer
- [ ] FileViewer 清理：移除原有 react-markdown/remark-gfm/rehype-highlight 直接 import
- [ ] 首屏不加载 mermaid chunk，仅在含 mermaid 代码块时按需加载
- [ ] MarkdownPreview 测试通过 `pnpm test`
- [ ] `pnpm tsc --noEmit` 类型检查通过

## 7. 风险与限制

| 风险 | 影响 | 缓解 |
|------|------|------|
| `@tailwindcss/typography` v4 兼容性 | 🔴 高 | **Step 2 先验证**，不兼容则走手写 `.markdown-preview` 排版 fallback（已设计完整，见 3.5 节） |
| prose 颜色变量未正确桥接 | 🔴 高（仅使用 typography 时） | 在 `theme.css` 四个主题 block 中完整覆盖 `--tw-prose-*` |
| hljs 样式缺失（⚠️ 已确认的现状） | 🔴 高 | 新增 `.markdown-preview .hljs-*` 完整样式，4 个主题各一套配色 |
| PlantUML 编码格式特殊 | 🟡 中 | 使用 `plantuml-encoder` 包处理自定义 deflate+base64 编码 |
| PlantUML 依赖公共服务器 | 🟡 中 | 显示加载状态和错误占位；后续可支持自建服务器 |
| Mermaid 渲染性能 | 🟡 中 | MermaidBlock 独立懒加载 + 骨架屏 + vite manualChunks 隔离 |
| 图片跨域 | 🟢 低 | overlay 检测加载失败时降级 |

## 8. 依赖关系

```
Step 1: 安装依赖 (mermaid, plantuml-encoder, @tailwindcss/typography)
  ↓
Step 2: ⚠️ 验证 typography v4 兼容性（决定走 prose 还是手写 fallback）
  ↓
Step 3: theme.css 添加主题样式（prose 桥接 / 手写排版 + hljs 高亮）
  ↓
Step 4: 创建 MarkdownPreview 组件
Step 5: 编写测试（TDD，可与 Step 4 交替）
Step 6: vite.config.ts 分包（并行）
  ↓
Step 7: ui/index.ts 导出
  ↓
Step 8: FileViewer 集成 + 清理旧 import
```
