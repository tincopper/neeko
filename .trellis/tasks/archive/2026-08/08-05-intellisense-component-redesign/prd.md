# IntelliSense 自动补全组件重构 · PRD

> 基于 UI/UX Audit Report 与 design-taste-frontend 审美标准。

## 目标

将 Neeko 代码编辑器的自动补全（IntelliSense）悬浮窗重构为现代专业 IDE 级体验：解决函数签名截断、缺乏文档上下文、样式与主题脱节三大核心问题。

## 产品定位（约束）

- 产品：跨平台桌面 **专业 IDE 工具**，统一管理多 AI CLI Agent
- 参考体验：JetBrains IDEA / VS Code / Zed 的补全体验
- 技术现状：React 18 + CodeMirror 6 + `@codemirror/lsp-client` + Tailwind v4 + OKLCH 多主题
- 硬约束：**CM6 列表由编辑器自身渲染，不可用 React 直接替换**；需通过 `addToOptions` / `info` / `optionClass` / CSS 定制

## 核心需求

### P0 — 功能缺失（已修复）

1. **选中函数后自动补充参数**：服务器 `snippetSupport: false` → `true`；前端对无 snippet 的函数补全兜底构造 `foo(${1:param1}, ${2:param2})` 模板
2. **info 面板展示完整上下文**：签名头 + 文档正文 + 参数表 + 返回值 + 代码示例

### P1 — 信息架构重构（已修复）

3. **双栏 master-detail 布局**：左栏 = 图标 + 函数名 + 模块路径（两行）；右栏 = 签名 + 文档 + 参数表 + 示例
4. **函数签名解析**：支持 Go (`name type`)、Rust (`name: type`)、箭头返回 (`-> T`) 三种风格

### P2 — 视觉与主题统一（已修复）

5. **列表样式融入应用主题**：使用 OKLCH 阴影 + Apple spacing/radius token + `--bg-secondary` 抬升表面
6. **选中态高亮**：左侧 2px accent 边框 + `--bg-hover` 背景
7. **info 面板子块样式**：签名头 / 文档 / 参数表 / 返回值 / 代码示例 — 完整视觉层级

## 设计方案

### 方案 A：双栏联动（采用）

- 左栏（列表项）：`type` 控制图标 + `detail` 显示签名 + `addToOptions` 注入模块路径
- 右栏（info 面板）：`info` 字段返回完整 DOM，`positionInfo` 控制跟随选中项

### 方案 B：响应式悬浮扩展（未采用）

- 理由：CM6 不支持单行动态展开，需完全替换渲染引擎，成本过高

## 不在范围内

- 不替换 CodeMirror 的列表渲染引擎
- 不修改 LSP 协议层（后端 snippetSupport 已启用）
- 不引入 framer-motion（项目未安装，用 CSS transition）

## 验收标准

- [x] 后端 `completionItem.snippetSupport: true`
- [x] 函数补全选中后自动填充参数（Tab 跳转）
- [x] info 面板展示签名 + 文档 + 参数表 + 返回值 + 示例
- [x] 列表项两行布局（函数名 + 模块路径）
- [x] 选中态左侧 accent 边框
- [x] 所有补全相关容器使用 OKLCH 阴影 + Apple tokens
- [x] 单元测试 72 通过（renderer 19 + hook 24 + 其他 29）
- [x] type-check / lint 全绿
- [x] 用户 review 确认视觉一致性（2026-08-05：多轮修复后确认）

## 原型索引

- `prototype-intellisense-master-detail.html` — 双栏 master-detail 布局原型
- `prototype-intellisense-theme-comparison.html` — 主题样式修改前/后对比
