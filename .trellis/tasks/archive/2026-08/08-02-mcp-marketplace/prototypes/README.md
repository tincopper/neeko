# 原型图（Prototypes）

> 本目录仅包含**设计预览**产物，非应用代码。请勿将其中任何文件合入 `src/`。

> **v2 修订**：原型外壳对齐归档 `08-02-resource-library-redesign/prototypes/prototype.html` 的完整 Resource Library v7 布局（Dock 图标栏 + act-tabs 活动栏 + 导航树 + toolbar + search + content）。不再使用早期孤立的「空态侧栏 + 独立内容区」外壳。
>
> **v3 修订**：MCP 的 **Installed / Marketplace 视图切换改为由左侧导航树 `tree-grp` 驱动**（与 skills 完全一致，非内容区 header 的 segmented tabs）。toolbar 面包屑随视图切换（count 徽标仅市场视图显示），外层搜索行保留（placeholder 按视图切换），`＋ 新建` 按钮仅 Installed 视图显示。

## 文件清单

| 文件 | 内容 | 打开方式 |
| --- | --- | --- |
| `wireframes/01-current-vs-target.svg` | 现状（仅本地列表、无市场）vs 目标（MCP 侧栏 tree-grp 切换 Installed/Marketplace + 市场卡片网格 + 分页 + 安装流）对比线框，完整 Library 外壳 | 浏览器 / 图片查看器 |
| `prototype.html` | **可交互高保真原型**：完整 Library 外壳、MCP act-tab 激活、侧栏导航树 Installed/Marketplace 切换、市场卡片网格/分页/安全警示、Install → 预填编辑对话框（secret env 占位）、已安装标记、状态切换（正常/空态/加载/错误） | 浏览器直接打开 |

## 快速预览

```bash
open .trellis/tasks/08-02-mcp-marketplace/prototypes/prototype.html
open .trellis/tasks/08-02-mcp-marketplace/prototypes/wireframes/01-current-vs-target.svg
```

## prototype.html 演示能力（对应 prd 验收标准）

1. **完整 Library 外壳**：Dock 图标栏 + act-tabs 活动栏（Skills/Prompts/Actions/MCP/Commands）+ 导航树 + toolbar + search + content —— 与归档 Resource Library v7 原型结构一致。
2. **MCP 侧栏导航树**：act-tab 切到 MCP 时，导航树显示 `tree-grp`（`📦 Installed [n]` / `⬇ Marketplace` 两个 `tree-item`），与 skills 完全一致；**视图切换由侧栏 tree-item 点击驱动**（`setView(v)`），非内容区 header。
3. **toolbar 面包屑**：`MCP / Installed | Marketplace`（count 徽标仅市场视图显示，对齐 skill 的 marketplace 徽标逻辑）。
4. **外层搜索行**：常驻渲染，placeholder 按视图切换（Installed → 「搜索已安装的 MCP…」，Marketplace → 「搜索 MCP Registry…」）。
5. **＋ 新建按钮**：位于 toolbar-actions，**仅 Installed 视图显示**，Marketplace 视图隐藏。
6. **Installed 视图**：本地 MCP 列表（对齐 `.card` 行样式），hover 显示测试/编辑/删除；手动添加项显示 `manual` 标记。
7. **Marketplace 视图**：安全警示条 + 卡片网格（title / desc / transport 徽章 / version / runtime）+ 已安装标记（`✓ 已安装` + Install 禁用）+ 分页。
8. **安装流**：点 Install → 打开预填的编辑对话框（从 server.json 映射 name/command/args/env/transport/scope；secret env 显示 `【必填 secret】` 占位，值留空需手动填写；remote 显示 URL 输入）；保存后标记已安装并携带 source 字段。
9. **状态切换**：demo-bar 下拉切换 正常 / 空态 / 加载骨架 / 错误态（对齐归档原型）。

- 设计方案（后端/前端/迁移 v8）→ `../design.md`
- 需求与验收标准 → `../prd.md`
- 执行计划 → `../implement.md`
