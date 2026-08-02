# 原型图（Prototypes）

> 本目录仅包含**设计预览**产物，非应用代码。请勿将其中任何文件合入 `src/`。
>
> **v2/v3 修订**：保留水平 Tab 布局，Skills 视图岛屿化，Agent 分组默认折叠。
> **v4 修订**：Library **中央全宽展示**（打开时隐藏编辑区）+ **5 类资源统一岛屿样式** + Tab 浮岛。
> **v5 修订**：Projects 分组默认折叠；**打开 Library 收起 Dock 左栏**（projects 不显示）；**样式对齐主题**（岛屿无描边、间隙 2px、搜索框/工具栏/按钮对齐 Skills 面板）。
> **v6 修订**：① **Tab 条从浮岛改为扁平轻量设计**（无阴影、无圆角，低存在感导航 chrome）；② **SkillsPanel 内重复标题行去除**；③ **命名修正**（「Library」→「Installed」）；④ **岛屿间隙微调**至 4px；⑤ **岛屿内部去硬分割线**（LibraryHeader / Filters 岛头 `border-b` 去除）。

## 文件清单

| 文件 | 内容 | 打开方式 |
| --- | --- | --- |
| `wireframes/01-current-vs-target.svg` | 现状（Skills tab 只渲染导航栏、内容区空白）vs 目标（导航 + SkillContent 并列）对比线框 | 浏览器 / 图片查看器 |
| `prototype.html` | **可交互高保真原型**：水平 Tab 切换 5 类资源、Skills 导航与内容并列、Filters 岛、Agent 折叠、窄窗口模拟、状态切换、插入 toast · **v6 新增：扁平 Tab / 去硬线 / Installed 命名** | 浏览器直接打开 |

## 快速预览

```bash
# 打开可交互高保真原型
open .trellis/tasks/08-02-resource-library-redesign/prototypes/prototype.html
```

## prototype.html 演示能力（对应验收标准）

1. **中央全宽展示**：Library 面板占据中央区（无编辑区占位），内容完整展示（验证 AC-13/AC-14）。
2. **Dock 左栏收起**：打开 Library 时 projects 面板不显示（Library 独占中央），关闭后左栏恢复（验证 AC-16）。
3. **水平 Tab 切换**：顶部 Skills / Prompts / Actions / MCP / Commands 横排（布局不变），点击切换内容岛（验证 AC-3、AC-5）。
4. **Skills 核心修复**：列表岛（SkillsPanel 导航）+ 内容岛（SkillContent）并列；点击导航项内容随之切换（验证 AC-1、AC-2）。
5. **v6 扁平 Tab**：Tab 条为低存在感导航 chrome（无阴影、无浮岛感），与内容岛明确分层。
6. **样式对齐主题**：岛屿间隙 4px（v6 微调，层次更清晰）、搜索框/工具栏/按钮与 Skills 面板一致（验证 AC-17）。
7. **v6 命名修正**：SkillsPanel 中「Library」→「Installed」，避免与面板名重复。
8. **v6 去硬线**：岛屿内部 toolbar 无 `border-b` 硬分割线，自然间距分隔。
9. **Prompts 主链路**：Filters 岛 + 搜索 + 插入（验证 AC-7）。
10. **Actions/MCP/Commands**：各自内容岛与操作按钮（验证 AC-8）。
11. **Agent / Projects 分组折叠**：默认折叠，点击标题展开/收起（验证 AC-12）。
12. **状态切换**：下拉切换 正常 / 空态 / 加载骨架 / 错误态。
13. **窄窗口模拟（~900px）**：次要按钮收纳进 `⋯` 溢出菜单。

- 修复方案（代码级改动点）→ `../design.md` §2、§3
- 需求与验收标准 → `../prd.md` §8
- 验收执行步骤 → `../acceptance.md`
