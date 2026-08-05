# IntelliSense 自动补全组件重构 · 实施文档

> 从 design.md 拆解的具体实现步骤与文件变更清单。

---

## 实施阶段

### 阶段 1：后端启用 snippetSupport（已完成）

**目标**：让语言服务器返回 snippet 格式 insertText。

| 文件 | 变更 |
| --- | --- |
| `src-tauri/src/lsp/session/instance.rs` | `snippetSupport: false` → `true`；提取 `build_client_capabilities()` |
| 测试 | `client_capabilities_advertise_snippet_support` |

### 阶段 2：前端参数 snippet 兜底（已完成）

**目标**：服务器未返回 snippet 时，前端自动构造参数模板。

| 文件 | 变更 |
| --- | --- |
| `src/features/lsp/hooks/lspCompletionInfoRenderer.ts` | 新增 `maybeAttachSnippetFallback()` + `buildFunctionSnippet()` |
| 测试 | `createThemedCompletionSource snippet fallback` 3 测试 |

### 阶段 3：双栏 master-detail + 主题统一（已完成）

**目标**：重构 info 面板为 5 段式结构；列表样式融入应用主题。

| 文件 | 变更 |
| --- | --- |
| `src/features/lsp/hooks/completionRenderer.ts` | **新建**：纯函数模块 |
| `src/features/lsp/hooks/lspCompletionInfoRenderer.ts` | 接入 renderer；`addToOptions` 注入模块路径 |
| `src/styles/index.css` | 列表项 / info 面板 / 下拉容器 / hover / signature 样式 |
| 测试 | `completionRenderer.test.ts` 19 测试 |

---

## 文件变更清单

### 新建文件

```
src/features/lsp/hooks/completionRenderer.ts          ← 纯函数：DOM 构建 + 签名解析
src/features/lsp/hooks/__tests__/completionRenderer.test.ts  ← 19 单元测试
.trellis/tasks/08-05-intellisense-component-redesign/ ← 任务跟踪
  ├── task.json
  ├── prd.md
  ├── design.md
  ├── implement.md
  ├── prototype-intellisense-master-detail.html
  └── prototype-intellisense-theme-comparison.html
```

### 修改文件

```
src-tauri/src/lsp/session/instance.rs                ← snippetSupport + 测试
src/features/lsp/hooks/lspCompletionInfoRenderer.ts  ← 接入 renderer
src/features/lsp/hooks/__tests__/lspCompletionInfoRenderer.test.ts  ← 更新断言
src/styles/index.css                                 ← 主题样式统一
```

---

## 关键实现细节

### 签名解析 `parseSignatureDetail()`

```
输入: "func(name string, id int) error"
1. 检测箭头返回 "-> T"（Rust）
2. 检测尾部返回 ") error"（Go）
3. 提取括号内参数列表
4. 按顶层逗号分割（保留嵌套泛型）
5. 每个参数按 "name type" 或 "name: type" 解析
输出: { params: [{name, type, doc}], returns }
```

### Snippet 兜底 `maybeAttachSnippetFallback()`

```
条件: insertTextFormat !== 2 && kind ∈ {2,3,4}
1. 获取插入文本（textEdit > textEditText > insertText > label）
2. 提取函数名（纯名或 name() 形式）
3. 从 label 解析参数
4. 构造 snippet: funcName(${1:param1}, ${2:param2})
5. 设置 item.apply = snippet(template)
```

### 主题统一 CSS

```css
/* 核心变更 */
.cm-tooltip.cm-autocomplete {
  background: var(--bg-secondary);      /* 抬升表面 */
  border-radius: var(--radius-apple-md); /* Apple token */
  box-shadow: oklch(...) 双层阴影;       /* OKLCH 色彩 */
}
.cm-completion-item-enhanced {
  padding: var(--spacing-apple-xs) var(--spacing-apple-sm);
}
```

---

## 验证命令

```bash
# 后端
cargo test --manifest-path src-tauri/Cargo.toml --lib lsp

# 前端
pnpm vitest run src/features/lsp
pnpm type-check
pnpm lint:fe

# 视觉验证
pnpm tauri dev  # 打开 Go/Rust 项目，触发补全
```

---

## 验收状态

- [x] 后端 snippetSupport 启用
- [x] 参数 snippet 兜底
- [x] 双栏 info 面板
- [x] 主题样式统一
- [x] 72 测试通过
- [x] type-check / lint 全绿
- [x] 用户 review 确认（2026-08-05：遮挡/文档缺失/示例行/图标/换行等修复后确认）
