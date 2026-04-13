# 任务：04-14-files-panel

## 概述

在左侧活动栏（Projects 图标下方）新增 **Files 面板**。面板以文件树形式展示当前激活项目的完整目录结构。点击文件后在主区域以 **CodeMirror 6** 编辑器打开，支持语法高亮、括号匹配、基础自动补全；内容可直接编辑并保存回磁盘。Markdown 文件支持渲染预览。

---

## 需求

### R1 — 活动栏入口
- 在 `ActivityBar.tsx` 的 Projects 图标下方添加 `ListTree` 图标（来自 `lucide-react`）
- 图标标签：**"Files"**
- 遵循与现有面板相同的 `togglePanel("files")` 模式
- 在 `sidebar-context.tsx` 的 `ActivityPanel` 联合类型中扩展 `"files"`

### R2 — Files 面板（左侧边栏）
- 当 `activePanel === "files"` 时，在 `PanelArea` 内渲染 `<FilesPanel>`
- 面板顶部显示：**当前激活项目名称**，下方展示完整目录树
- 若无激活项目，显示空状态：_"请选择一个项目以浏览文件"_
- 通过新增 Tauri 命令 `read_dir_tree(projectId, subPath?, maxDepth?)` 加载目录树
- 默认 `maxDepth = 4`，防止大型仓库性能问题
- 点击目录可折叠/展开
- 排除常见无关目录：`.git`、`node_modules`、`target`、`.trellis`、`dist`、`build`、`.next`
- 文件条目显示对应图标（复用 `utils/fileIcons.ts` 中的 `getFileIconSrc`）
- 目录显示 `ChevronRight` / `ChevronDown` 折叠切换图标

### R3 — 文件查看与编辑（主内容区域）
- 在 Files 面板中点击文件，在主内容区打开 `FileViewer`
- 文件内容通过新增 Tauri 命令 `read_file_content(projectId, filePath)` 加载
- 编辑器使用 **`@uiw/react-codemirror`**（CodeMirror 6 的 React 封装），统一承担查看和编辑两种模式
- **查看模式**（默认）：`editable={false}` + `readOnly={true}`，禁止输入但保留语法高亮与滚动
- **编辑模式**：`editable={true}` + `readOnly={false}`，支持输入、括号匹配、Ctrl+S 保存
- 顶部栏显示：文件路径（面包屑）+ **"编辑 / 查看"** 切换按钮 + "关闭" 按钮（返回终端视图）

**CodeMirror 配置：**
- 语言扩展：根据文件扩展名动态加载对应语言包（懒加载）

  | 扩展名 | 语言包 |
  |--------|--------|
  | `.ts` `.tsx` `.js` `.jsx` | `@codemirror/lang-javascript` |
  | `.rs` | `@codemirror/lang-rust` |
  | `.py` | `@codemirror/lang-python` |
  | `.json` `.jsonc` | `@codemirror/lang-json` |
  | `.md` `.mdx` | `@codemirror/lang-markdown` |
  | `.css` `.scss` `.less` | `@codemirror/lang-css` |
  | `.html` `.htm` `.vue` `.svelte` | `@codemirror/lang-html` |
  | 其他 | 无语言扩展（纯文本） |

- 自动补全：启用 `@codemirror/autocomplete` 的 `autocompletion()` 扩展，提供括号/引号自动配对与基础词语补全
- 主题：
  - `dark` / `one-dark-pro` 主题 → `@codemirror/theme-one-dark`（`oneDark`）
  - `light` / `claude` 主题 → CodeMirror 默认浅色主题
- 字体：复用 `buildFontFamily(config.fontFamily)` 与 `config.fontSize`，与终端字体保持一致
- 行号显示：启用（`lineNumbers()` 扩展）

**编辑行为：**
- 编辑模式下有未保存改动时，顶部栏文件名旁显示 `●` 脏标记
- `Ctrl+S` 快捷键触发保存，调用 `write_file_content`，成功后清除脏标记
- "取消"：丢弃改动，重置为原始内容，切回查看模式
- 切换文件或关闭时若有未保存改动，弹出确认对话框："有未保存的改动，确定要离开吗？"
- 二进制文件（`is_binary: true`）：仅查看模式，隐藏"编辑"按钮，显示 _"二进制文件 — 无法显示"_
- 超大文件（> 500 KB）：仅查看模式，隐藏"编辑"按钮，显示 _"文件过大，无法编辑（> 500 KB）"_

### R4 — Markdown 预览
- Markdown 文件（`.md`、`.mdx`）在顶部栏额外显示 **"预览 / 源码"** 切换按钮
- **预览模式**（默认）：使用 `react-markdown` + `remark-gfm` 渲染，代码块通过 `rehype-highlight` 高亮
- **源码模式**：与 R3 相同的 CodeMirror 编辑器（可编辑）
- 预览模式下隐藏"编辑"按钮；切换到源码模式后恢复编辑功能
- 预览样式：适配当前主题的 prose 排版（标题、列表、表格、引用块、代码块）

### R5 — 状态与导航
- 新增 hook `useFileView`，存储 `activeFileView: { projectId: string; filePath: string } | null`
- 切换到其他项目时，自动清除文件视图（回到终端）
- Files 面板与终端面板**相互独立**——打开文件不影响终端状态
- 文件查看器替换 `MainContent` 中的终端视图（同一插槽，条件渲染）
- 文件查看器中的"返回终端"/ 关闭按钮可回到终端视图

---

## 新增 Tauri 命令

### `read_dir_tree`

```rust
// 请求参数
projectId: String,
subPath: Option<String>,   // 项目内的相对路径，None 表示根目录
maxDepth: Option<u32>,     // 默认 4

// 返回类型：Vec<FileNode>
struct FileNode {
    name: String,
    path: String,       // 相对于项目根目录的路径
    is_dir: bool,
    children: Vec<FileNode>,
}
```

排除目录：`.git`、`node_modules`、`target`、`.trellis`、`dist`、`build`、`.next`、`.idea`、`.vscode`

### `read_file_content`

```rust
// 请求参数
projectId: String,
filePath: String,    // 相对于项目根目录的路径

// 返回类型：FileContent
struct FileContent {
    path: String,
    content: String,   // 二进制文件时为空字符串
    size: u64,         // 字节数
    is_binary: bool,
}
```

二进制检测：检查前 8 KB 中是否含有空字节（null byte）。
超大文件处理（> 512 KB）：返回空 content，通过错误或标志位通知前端。

### `write_file_content`

```rust
// 请求参数
projectId: String,
filePath: String,    // 相对于项目根目录的路径
content: String,     // 完整文件内容（UTF-8）

// 返回类型：Result<(), String>
// 成功返回 Ok(()), 失败返回错误信息
```

写入前校验：
- 文件路径必须在项目根目录范围内（防止路径穿越攻击）
- 使用 `std::fs::write` 原子覆盖写入

---

## 新增前端文件

| 文件 | 用途 |
|------|------|
| `src/components/panels/FilesPanel.tsx` | 左侧面板：文件树 UI |
| `src/components/panels/FileViewer.tsx` | 主区域：CodeMirror 编辑器 + Markdown 预览 |
| `src/hooks/useFileView.ts` | 状态管理：当前激活文件、编辑模式、脏标记、打开/关闭/保存操作 |
| `src/utils/codemirror.ts` | CodeMirror 工具函数：语言扩展懒加载、主题映射、扩展集构建 |

---

## 需修改的文件

| 文件 | 改动内容 |
|------|---------|
| `src/context/sidebar-context.tsx` | 在 `ActivityPanel` 联合类型中添加 `"files"` |
| `src/components/layout/ActivityBar.tsx` | 在 `navItems` 中添加 Files 条目 |
| `src/components/layout/AppLayout.tsx` | 当 `activePanel === "files"` 时渲染 `<FilesPanel>`，传递 `activeFileView` 状态，并在主内容中条件渲染 `<FileViewer>` |
| `src/types.ts` | 添加 `FileNode`、`FileContent` TypeScript 接口 |
| `package.json` | 已添加：`@uiw/react-codemirror`、全部 `@codemirror/*` 包、`react-markdown`、`remark-gfm`、`rehype-highlight` |
| `src-tauri/src/state/mod.rs` | 添加 `FileNode`、`FileContent` Rust 结构体 |
| `src-tauri/src/lib.rs` | 注册 `read_dir_tree`、`read_file_content`、`write_file_content` 命令 |

---

## 验收标准

- [ ] `ListTree` 图标出现在活动栏 Projects 图标下方
- [ ] 点击图标可切换 Files 面板的展开/收起
- [ ] Files 面板显示当前激活本地项目的完整目录树
- [ ] 点击目录可折叠/展开
- [ ] 已排除目录（`.git`、`node_modules` 等）不显示
- [ ] 点击文件可在主内容区打开 `FileViewer`
- [ ] CodeMirror 编辑器加载，文件内容按语言自动语法高亮（`.ts`、`.rs`、`.py`、`.json` 等）
- [ ] 顶部栏显示"编辑"按钮，点击后 CodeMirror 切换为可编辑模式
- [ ] 括号/引号自动配对，`autocompletion()` 基础词语补全生效
- [ ] 编辑模式下有未保存改动时显示 `●` 脏标记
- [ ] Ctrl+S 触发保存，保存成功后退回查看模式
- [ ] 取消按钮丢弃改动并退回查看模式
- [ ] 离开有未保存改动的文件时弹出确认对话框
- [ ] 二进制文件不显示编辑按钮，显示"二进制文件 — 无法显示"提示
- [ ] `.md` / `.mdx` 文件显示预览/源码切换按钮
- [ ] Markdown 预览正确渲染标题、列表、代码块、表格
- [ ] FileViewer 中的关闭按钮可返回终端视图
- [ ] 切换项目后文件视图自动清除

## 依赖清单（已安装）

| 包 | 用途 |
|----|------|
| `@uiw/react-codemirror` | CodeMirror 6 React 封装，简化接入 |
| `@codemirror/state` | 编辑器状态核心 |
| `@codemirror/view` | 编辑器视图核心 |
| `@codemirror/commands` | 键盘命令（Ctrl+S 等） |
| `@codemirror/language` | 语言支持基础层 |
| `@codemirror/autocomplete` | 自动补全 + 括号配对 |
| `@codemirror/lang-javascript` | JS / TS / JSX / TSX |
| `@codemirror/lang-rust` | Rust |
| `@codemirror/lang-python` | Python |
| `@codemirror/lang-json` | JSON |
| `@codemirror/lang-markdown` | Markdown |
| `@codemirror/lang-css` | CSS / SCSS / Less |
| `@codemirror/lang-html` | HTML / Vue / Svelte |
| `@codemirror/theme-one-dark` | One Dark Pro 主题 |
| `react-markdown` | Markdown HTML 渲染 |
| `remark-gfm` | GFM 表格/任务列表/删除线 |
| `rehype-highlight` | Markdown 代码块语法高亮 |

## 不在本次范围内

- WSL / SSH 远程文件浏览（本期仅支持本地项目）
- 文件树内搜索
- 文件树刷新按钮（重新打开面板即可刷新）
- 文件树条目上的 Git 状态装饰
- 多文件同时编辑（Tab 式多文件编辑器）
- LSP 集成（代码跳转、类型提示等高级 IDE 功能）
