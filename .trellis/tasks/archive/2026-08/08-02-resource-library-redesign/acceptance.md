# Resource Library（资源管理）交互修复 — 验收过程文档

> 阶段：设计规划（Phase 1） · 关联：`prd.md` §8（验收标准）、`design.md`（修复方案）、`prototypes/`（原型）
>
> **v2 修订**：按评审反馈，验收范围调整为「保留水平 Tab 布局 + 最小改动」，聚焦内容区显示修复。
> **v3 修订**（本轮评审反馈）：新增「列表区/内容区岛屿化拆分（FR-9）」与「Agent 分组默认折叠（FR-10）」两项验收标准（AC-11/AC-12）。
> **v4 修订**（本轮评审决策）：新增「5 类资源统一岛屿样式（FR-9 扩围）」「Library 中央全宽展示（FR-11）」「Tab 浮岛（FR-12）」「Agent 与 Projects 分组默认折叠（FR-10 扩围）」验收标准（AC-11/AC-12/AC-13/AC-14/AC-15）。
> 本阶段交付物为 **诊断 + 修复方案 + 原型图**，验收分两部分：
> **A. 设计交付验收**（本文档，本阶段执行）；**B. 实现验收预留**（供后续实现任务，本轮不执行）。

---

## 1. 验收环境与前置条件

| 项 | 要求 |
| --- | --- |
| 预览环境 | 可打开 HTML/SVG 的浏览器（Chrome / Edge / Safari 均可） |
| 待验对象 | `.trellis/tasks/08-02-resource-library-redesign/` 下全部交付物 |
| 前置条件 | 交付物齐全：`prd.md`、`design.md`、`acceptance.md`、`prototypes/wireframes/*.svg`、`prototypes/prototype.html`、`prototypes/README.md` |
| 验收人 | 产品 / 前端负责人（本任务 assignee：tincopper） |

## 2. 验收流程总览

```
Step 0  交付物完整性核对
Step 1  原型预览（对照原型图走查）
Step 2  逐条核对验收标准 AC-1 ~ AC-10（在原型中操作验证）
Step 3  设计一致性交叉检查（design.md ↔ 原型 ↔ prd.md）
Step 4  填写确认记录 → 通过 / 打回
```

> 每步完成后在对应检查清单中勾选。任何 **⭐ Block 级（AC-1~AC-6）** 未通过 ⇒ 整体打回，不进入后续步骤。

---

## 3. Step 0 — 交付物完整性核对

| # | 交付物 | 存在 | 备注 |
| --- | --- | --- | --- |
| D-1 | `prd.md`（诊断 + 用户故事 + 需求 + 验收标准） | ☐ | |
| D-2 | `design.md`（修复方案：内容区挂载 + 状态协同） | ☐ | |
| D-3 | `acceptance.md`（本文档） | ☐ | |
| D-4 | `prototypes/wireframes/01-current-vs-target.svg` | ☐ | |
| D-5 | `prototypes/wireframes/02-target-panel.svg` | ☐ | |
| D-6 | `prototypes/prototype.html`（可交互高保真原型） | ☐ | |
| D-7 | `prototypes/README.md`（预览说明） | ☐ | |

**通过标准**：D-1 ~ D-7 全部存在。

---

## 4. Step 1 — 原型预览操作路径

打开 `prototypes/prototype.html`，按以下路径走查（对应 `prototypes/README.md` 演示能力）：

1. 打开即默认 Skills tab：验证「左侧导航（列表岛）+ 右侧技能内容（内容岛）」**立即完整显示**，无空白区（AC-1）。
2. 点击 Skills 导航项（Library / Marketplace / Tag / Agent / 项目）：验证内容区随之切换且正确（AC-2）。
3. 依次点击 Prompts / Actions / MCP / Commands 水平 Tab：验证每个 tab 内容区均正常显示（AC-3）。
4. 确认水平 Tab 布局与修复前一致（顶部横排 5 个 tab），未变成垂直导航（AC-5）。
5. 在 Prompts tab 操作 Filters 岛与搜索：验证主链路（AC-7）。
6. 切换「内容状态」下拉：验证 空态 / 加载骨架 / 错误态（AC-9 附属）。
7. 点击「窄窗口模拟（~900px）」：验证次要按钮收纳进 `⋯` 菜单。
8. 点击任一「插入」：验证 toast 反馈（插入主链路反馈）。
9. 验证 5 类资源内容区**统一岛屿样式**（各自圆角边框阴影、间隙露出海面），非连体（AC-11）。
10. 验证 Skills 导航 **Agent 与 Projects 分组默认折叠**，点击标题展开/收起（AC-12）。
11. 验证 Library **中央全宽展示**：打开时占据中央区、编辑区隐藏、内容完整无截断（AC-13）。
12. 验证关闭（再次点击图标 / 打开其他 dock 面板）恢复编辑区；Library 不残留 Dock 左栏（AC-14）。
13. 验证顶部 **Tab 切换栏为浮岛样式**（圆角 + 边框 + 阴影，海面间隙环绕），与内容岛视觉融合（AC-15）。
14. 验证 **Dock 左栏收起**：打开 Library 时 projects 面板不显示（Library 独占中央），关闭后左栏恢复（AC-16）。
15. 验证 5 类资源**交互骨架一致**（搜索 + 主操作 + 列表 + 状态四要素），Skills 专属操作不破坏统一观感（AC-18）。

---

## 5. Step 2 — 验收标准核对（对应 prd.md §8）

| ID | 验收标准 | 验证方式 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| ⭐ AC-1 | 打开资源管理，默认 Skills tab 立即显示「导航栏 + 技能内容列表」，无空白区 | 原型 Step 1.1 | ☐ | |
| ⭐ AC-2 | Skills 内点击导航项（Library/Marketplace/Agent/项目/Tag），内容区随之切换且正确 | 原型 Step 1.2 | ☐ | |
| ⭐ AC-3 | 依次切换 Prompts/Actions/MCP/Commands Tab，内容区均正常显示，无空白、无报错 | 原型 Step 1.3 | ☐ | |
| ⭐ AC-4 | Skills 内容显隐只由 Library 内部状态驱动；Dock `skills` 面板激活与否不影响 Library 内 Skills 显示 | 对照 design.md §2.2 + 代码证据 | ☐ | |
| ⭐ AC-5 | 水平 Tab 布局保持不变（与修复前一致），改动不引入布局重构 | 原型 Step 1.4 | ☐ | |
| ⭐ AC-6 | Dock `skills` 独立面板（App.tsx 中央区 SkillContent）行为无回归 | design.md §2.1 约束核对 | ☐ | |
| AC-7 | Prompts 搜索/筛选/插入到 Agent 主链路可用（含变量对话框） | 原型 Step 1.5 | ☐ | |
| AC-8 | Actions / MCP / Commands 的列表与操作（运行/测试/编辑/新建）可用 | 原型 Step 1.3 | ☐ | |
| AC-9 | 键盘可达：仅键盘可完成「打开 → 选 Tab → 选导航项 → 查看内容」 | 原型 tab/Enter 走查 | ☐ | |
| AC-10 | 原型与设计方案通过用户/评审确认 | 本文档 §7 确认记录 | ☐ | |
| AC-11 | 5 类资源内容区统一岛屿样式（视觉分离、间隙明显），非连体 | 原型 Step 1.9 | ☐ | |
| AC-12 | Skills 导航 Agent 与 Projects 分组默认折叠，点击标题展开/收起；展开后跳转对应视图正常 | 原型 Step 1.10 | ☐ | |
| ⭐ AC-13 | Library 中央全宽展示（Dock 图标 / Ctrl+Shift+L 打开），中央编辑区隐藏，内容完整展示无截断 | 原型 Step 1.11 | ☐ | |
| ⭐ AC-14 | 关闭资源管理（再次点击图标 / 打开其他 dock 面板）恢复编辑区；Library 不残留 Dock 左栏（无双渲染） | 原型 Step 1.12 | ☐ | |
| AC-15 | 顶部 Tab 切换栏为浮岛样式（圆角+边框+阴影，海面间隙环绕），与内容岛视觉融合，无实底横条贴顶割裂感 | 原型 Step 1.13 | ☐ | |
| ⭐ AC-16 | 打开 Library 时 Dock 左栏收起（projects 面板不显示，Library 独占中央）；关闭/打开其他面板后左栏恢复 | 原型 Step 1.14 | ☐ | |
| AC-17 | Library 内部样式对齐主题（岛屿无描边、间隙 2px、搜索框/工具栏/按钮与 Skills 一致） | 对照 ui-alignment-analysis.md A 部分 | ☐ | |
| AC-18 | 5 类资源交互骨架一致（搜索+主操作+列表+状态四要素），Skills 专属操作不破坏统一观感 | 原型 Step 1.15 | ☐ | |

**通过标准**：⭐ 项全部「通过」；AC-7~AC-10 允许在评审意见中提出修订建议但不阻断验收（修订项登记到 §8 遗留问题）。

---

## 6. Step 3 — 设计一致性交叉检查

| # | 检查项 | 结论 |
| --- | --- | --- |
| C-1 | design.md §2.1 核心修复（SkillsTabContent 并列渲染 SkillsPanel + SkillContent）↔ 原型 Skills 视图一致 | ☐ |
| C-2 | design.md §3 布局（中央全宽 + 水平 Tab 保留 + 海面岛屿 + Filters 岛）↔ 原型布局一致 | ☐ |
| C-3 | design.md §4 交互（tab 常驻挂载 + hidden；skillStore 驱动子视图）↔ 原型行为一致 | ☐ |
| C-4 | prd.md 根因 R1/R2（SkillContent 未挂载、激活条件错误）↔ `01-current-vs-target.svg` 现状侧一致 | ☐ |
| C-5 | prd.md 需求 FR-1~FR-8 在 design.md 中均有落点（追踪表见下方） | ☐ |

**FR 追踪表**（验证 C-5）：

| FR | design.md 落点 | FR | design.md 落点 |
| --- | --- | --- | --- |
| FR-1 | §2.1 核心修复（F1/F2） | FR-5 | §2.3 Prompts 行 |
| FR-2 | §2.2 状态协同 | FR-6 | §2.3 Actions/MCP/Commands 行 |
| FR-3 | §2.3 各 tab 清单 | FR-7 | §2.1 关键约束 |
| FR-4 | §2.2 状态协同 | FR-8 | §2.4 不做改动清单 |
| FR-9 | §2.1 F1/F2 + §3.1 海面岛屿 | FR-10 | §2.5 Agent + Projects 默认折叠 |
| FR-11 | §2.1 F3-F7（中央全宽机制）+ §3.1 | FR-12 | §2.1 F2 + §3.1 Tab 岛 |
| FR-13 | §3.4 左栏收起（dockStore） | FR-14 | §3.5 + §5 视觉规范 |
| FR-15 | §3.5 交互统一 + ui-alignment-analysis.md B | | |

---

## 7. Step 4 — 确认记录（评审签字）

| 日期 | 评审人 | 结论（通过 / 打回） | Block 项 | 意见摘要 |
| --- | --- | --- | --- | --- |
|  |  | ☐ 通过 ☐ 打回 |  |  |

**通过标准**：结论为「通过」且无未解决 Block 项。

---

## 8. 遗留问题与修订通道

验收中发现的非阻断问题登记于此，实现任务前必须闭环：

| # | 问题 | 涉及交付物 | 负责人 | 状态 |
| --- | --- | --- | --- | --- |
| O-1 | 开放问题：Skills 导航栏宽度 `w-44` 是否合适、是否可折叠（prd.md §9 Q1） | design.md §3.1 | 产品/前端 | ☐ |
| O-2 | 开放问题：R5（Header 窄面板溢出）是否随实现任务处理还是单独任务（prd.md §9 Q2，默认单独任务） | design.md §2.4 | 产品 | ☐ |

---

## 9. 实现验收预留（后续任务使用，本轮不执行）

> 当本设计进入实现任务时，将以下条目复制到实现任务的 `implement.md` 验收节：

- [ ] I-1 实现后运行 `pnpm type-check` 与 `pnpm lint` 通过。
- [ ] I-2 在 `pnpm tauri dev` 中打开资源管理（`Ctrl+Shift+L`），默认 Skills tab 显示导航 + 内容，无控制台错误。
- [ ] I-3 逐项复验 AC-1~AC-9（将「原型」替换为「实现界面」执行）。
- [ ] I-4 回归：Dock `skills` 独立面板（App.tsx 中央区）行为不回归。
- [ ] I-5 回归：Prompts 主链路（搜索/筛选/插入/变量对话框）、Actions/MCP/Commands 操作不回归。
- [ ] I-6 窄窗口 640px 宽度下复验内容区显示与 Header 溢出情况（记录 R5 状态）。
