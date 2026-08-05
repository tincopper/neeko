# IntelliSense 自动补全组件重构 · 设计文档

> 角色：前端工程专家 + 产品设计  
> 目标：现代化、专业 IDE 级补全体验；融入 Neeko 设计系统

---

## 1. 技术约束分析

### 1.1 CodeMirror 6 定制边界

CM6 的补全下拉列表由编辑器自身渲染（非 React），提供以下定制点：

| 定制点 | 能力 | 本方案使用 |
| --- | --- | --- |
| `Completion.type` | 控制图标（CSS 类 `cm-completionIcon-{type}`） | ✅ 函数/方法/变量等 |
| `Completion.detail` | 右侧灰色小字 | ✅ 显示签名 |
| `Completion.info` | **右侧详情面板**（返回 DOM，支持 async） | ✅ 核心：master-detail 右栏 |
| `addToOptions` | 向每项注入自定义 DOM 节点 | ✅ 注入模块路径 |
| `optionClass` | 为每项添加 CSS 类 | ✅ 两行布局 |
| `Completion.section` | 分组支持 | ❌ 暂不需要 |
| CSS `.cm-tooltip.cm-autocomplete` | 下拉容器样式 | ✅ 玻璃质感 |

### 1.2 不可行方案

- ❌ 完全用 React 替换 CM6 列表渲染（破坏 LSP 集成，成本极高）
- ❌ 单行动态展开（CM6 不支持）

---

## 2. 信息架构

### 2.1 双栏 Master-Detail

```
┌─────────────────────────────────────────────────────────────────────┐
│  左栏 List Item（选中态）              │  右栏 Info Panel           │
│  ┌─────────────────────────────────┐  │  ┌─────────────────────┐  │
│  │ ▌ƒ funcName   (string, error)   │  │  │ funcName(name string)│  │
│  │   github.com/org/pkg            │  │  │ ─────────────────── │  │
│  └─────────────────────────────────┘  │  │ Creates a new…      │  │
│                                       │  │                     │  │
│  ┌─────────────────────────────────┐  │  │ Parameters          │  │
│  │   anotherFunc  (int)            │  │  │ • name string - …   │  │
│  │   net/http                      │  │  │ • id   int    - …   │  │
│  └─────────────────────────────────┘  │  │                     │  │
│                                       │  │ Returns: error      │  │
│                                       │  │                     │  │
│                                       │  │ Example             │  │
│                                       │  │ │ cli := Fn("n", 42) │  │
│                                       │  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 左栏 List Item 结构

```
[icon] functionName        ← type 控制 icon, label 显示名称
       (string, error)     ← detail 显示清理后的签名
       github.com/org/pkg  ← addToOptions 注入的模块路径（muted, 11px）
```

- 选中态：`border-l-2 border-accent-blue` + `bg-hover` 背景
- 间距：`var(--spacing-apple-xs) var(--spacing-apple-sm)`

### 2.3 右栏 Info Panel 结构

```
div.cm-lsp-completion-info
  ├── div.cm-lsp-info-signature     ← 函数签名头（mono, muted, 底边框）
  ├── div.cm-lsp-info-docs          ← 文档正文（markdown 渲染）
  ├── table.cm-lsp-info-params      ← 参数表（可选）
  │     th: Parameter | Type | Description
  │     td: name | type | doc
  ├── div.cm-lsp-info-returns       ← 返回值（可选）
  └── pre.cm-lsp-info-example       ← 代码示例（可选）
        └── code
```

---

## 3. 数据流

### 3.1 签名解析

```
LSP detail: "func(name string, id int) error"
    ↓ parseSignatureDetail()
{
  params: [
    { name: "name", type: "string", doc: "" },
    { name: "id",   type: "int",    doc: "" }
  ],
  returns: "error"
}
    ↓ buildExampleSnippet()
"funcName("name", 42)"
```

支持的签名风格：
- Go: `func(name string, id int) error`
- Rust: `fn clone(&self, path: &str) -> Result<()>`
- 箭头返回: `fn foo() -> Option<T>`

### 3.2 Snippet 兜底

当服务器未返回 snippet 时（`insertTextFormat !== 2`），对函数类补全（kind 2/3/4）构造参数模板：

```
label: "parse(string) error"
    ↓ buildFunctionSnippet()
"parse(${1:string})"
```

---

## 4. 设计 Token

### 4.1 色彩（OKLCH）

| 用途 | 变量 | 说明 |
| --- | --- | --- |
| 下拉背景 | `--bg-secondary` | 抬升表面 |
| 选中背景 | `--bg-hover` | 柔和选中 |
| 选中边框 | `--accent-blue` | 左侧 2px 指示线 |
| 签名文本 | `--text-secondary` | 次要信息 |
| 参数名 | `--cm-function` | 复用语法高亮 |
| 参数类型 | `--cm-typeName` | 复用语法高亮 |
| 代码块背景 | `--bg-secondary` | 示例区 |

### 4.2 间距（Apple tokens）

| 用途 | 变量 | 回退 |
| --- | --- | --- |
| 列表项内边距 | `--spacing-apple-xs` / `--spacing-apple-sm` | 8px / 12px |
| 模块路径字号 | `11px` | 固定小字 |
| 签名头底边距 | `--spacing-apple-xs` | 8px |

### 4.3 圆角与阴影

| 元素 | 圆角 | 阴影 |
| --- | --- | --- |
| 下拉容器 | `--radius-apple-md` (11px) | `oklch` 双层阴影 |
| info 面板 | `--radius-apple-md` (11px) | 同上 |
| 代码示例 | `--radius-apple-xs` (5px) | 无 |

---

## 5. 文件结构

```
src/features/lsp/
├── components/
│   └── completionRenderer.ts   ← 纯函数：DOM 构建 + 签名解析（可单测）
├── hooks/
│   ├── completionRenderer.ts   ← 导出：buildListItem / buildInfoPanel / parseSignatureDetail / buildExampleSnippet
│   ├── lspCompletionInfoRenderer.ts ← CM6 接入层：createThemedServerCompletion / flipPositionInfo
│   └── __tests__/
│       ├── completionRenderer.test.ts      ← 19 测试
│       └── lspCompletionInfoRenderer.test.ts ← 24 测试
```

---

## 6. 动效规范

| 元素 | 动效 | 时长 |
| --- | --- | --- |
| 下拉出现 | `translateY(-4px) → 0` + `opacity 0→1` | 150ms ease-out |
| 列表项选中 | `background-color` + `border-color` | 150ms ease-out |

---

## 7. 测试策略

### 7.1 单元测试（纯函数）

- `parseSignatureDetail`: Go / Rust / 箭头返回 / 空参 / 空字符串
- `buildExampleSnippet`: 命名参数 / 无参 / 可变参数
- `buildListItem`: type 映射 / detail 清理 / 模块路径节点
- `buildInfoPanel`: 完整面板 / 缺参数 / 缺返回值 / 缺示例

### 7.2 回归测试

- `cargo test --manifest-path src-tauri/Cargo.toml --lib lsp` — 后端 LSP 72 测试
- `pnpm vitest run src/features/lsp` — 前端 LSP 72 测试
- `pnpm type-check` — 类型检查
- `pnpm lint:fe` — ESLint + Prettier

---

## 8. 验收清单

- [x] 后端 `snippetSupport: true`
- [x] 函数补全参数自动填充
- [x] info 面板 5 段式结构
- [x] 列表项两行布局
- [x] 主题样式统一（OKLCH + Apple tokens）
- [x] 72 测试通过
- [x] type-check / lint 全绿
- [ ] 用户 review 视觉一致性
