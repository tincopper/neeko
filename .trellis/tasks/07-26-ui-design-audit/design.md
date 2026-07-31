# Neeko UI 设计审计与优化方案（设计文档）

> 角色：产品设计师 + React 前端专家  
> 目标：现代化、专业 IDE 级体验；**只做方案，不改代码**

---

## 1. 当前信息架构 / 布局地图

```
┌──────────────────────────────────────────────────────────────────────┐
│ TitleBar (h-8)  [logo] …… [Open IDE][Task][Debug] [窗口控件]        │
├────┬───────────────────────────────┬────┬────────────────────────────┤
│ L  │ 左 DockZone（浮岛）            │ 中 │ 中心浮岛                   │ R│
│ 工 │ projects / skills …           │ 心 │ ProjectWorkspace           │ 工│
│ 具 │                               │    │  ├ 编辑器分组 + Tabs        │ 具│
│ 栏 │                               │    │  ├ Terminal / Agent / File │ 栏│
│ +  │                               │    │  └ Guide 空态              │  │
│ ⚙  │                               │    │ 或 SettingsView / Skill    │  │
├────┴───────────────────────────────┴────┴────────────────────────────┤
│ TaskConsole / DebugPanel（底部浮层，不在 dock 体系内）                 │
├──────────────────────────────────────────────────────────────────────┤
│ StatusBar (h-4)  LSP · 冲突 · Debug/Task · 行列 · 通知               │
└──────────────────────────────────────────────────────────────────────┘

全局浮层：Settings 替换中心区、各类 Dialog、QuickOpen、SymbolNav、Toast
```

### 导航模型

| 层级 | 机制 | 说明 |
| --- | --- | --- |
| 主 chrome | `DockLayout` + `DockBar` + `DockBarButton` | IDEA Islands，主路径 |
| 遗留 | `ActivityBar` / `PanelArea` / `RightPanel` | 仍导出，主路径未使用 |
| App 视图 | `appViewStore`: `normal` \| `settings` | Settings 整页替换中心 |
| 中心双模式 | Skills 激活时隐藏 workspace，显示 SkillContent | 与 dock skills 耦合 |
| 全局 palette | QuickOpen / SymbolNav | 接近 VS Code 命令面板 |

### 左/右面板注册

- 左：`projects`, `skills`
- 右：`files`, `gitControl`, `pullRequests`, `browser`, `conversations`（UI 名 History）

### 应保留的优势

1. **Islands Dock**：`bg-primary` 作“海”，面板圆角浮岛 — 有辨识度、更现代
2. **多主题 token 骨架**：`theme.css` + `shadcn-theme.css` 方向正确
3. **Feature-based 结构**：`features/*` + `ui/*` + `layout/*` 适合规模化
4. **可停靠面板 + 尺寸持久化**：专业工具感强
5. **命令面板体系**：Quick Open / Symbol Nav 符合 IDE 心智
6. **部分空态/骨架已成型**：Conversation skeleton、ProjectGuide 可作为模板
7. **原型文化**：`docs/prototypes/git-log-panel.html` 可作密度参考（当前仅存在于主仓库，未随本 worktree 签出）

---

## 2. 设计系统盘点

### 2.1 Token

| 层 | 状态 | 问题 |
| --- | --- | --- |
| 表面色 | `--bg-primary/secondary/tertiary/hover/selected` | 层级够用，但业务仍写死 hex/rgba |
| 文本色 | `--text-primary/secondary/muted` | 缺 `disabled` / 对比度规范 |
| 强调色 | `--accent-blue/green/yellow/red` | 按色相命名；Claude 下 “blue” 实为橙棕 |
| 状态色 | `--status-idle/running/failed` | 组件大量用未定义 `status-error` |
| Diff | `--diff-*` | Git UI 仍硬编码 GitHub 绿/红/紫 |
| Apple spacing/radius | `@theme` 已定义 | **组件几乎 0 使用** |
| shadcn 变量 | `--background/--primary/--radius` | 与 Neeko token 双轨；`--accent-foreground` 写死 `#2997ff` |
| 缺失 token | `--accent-orange`、`bg-bg-surface` | 被引用但主题未定义 |

### 2.2 组件采用率（量化）

| 模式 | 约数 |
| --- | --- |
| `ui/` 外 raw `<button` | **~311**（审计初值 ~325） |
| `ui/Button` 使用 | **~11 imports** |
| 内联 `style={{...}}` | **~92** |
| 硬编码字号 `text-[8–18px]` | **~266** |
| 硬编码字号 `em` / `text-[N.Nem]` | **~222**（合计 ~488） |
| raw `<input>` vs `ui/Input` | **43 vs 36** |
| Apple token 业务引用 | **~0** |
| 图标体系 | shared icons ~61 文件 + 直引 lucide ~29 + 内联 SVG/emoji |
| 暗色假设 `border-white/` / `bg-white/` | **~33** 处 |

### 2.3 视觉语言冲突

同时存在三套气质：

1. **JetBrains Islands**（DockLayout 注释明确）
2. **VS Code 密度**（细状态栏、tab、activity 逻辑）
3. **Apple spacing tokens**（定义未落地）

结论：能用、偏现代，但缺少 **统一设计语言权威源**。

---

## 3. 问题清单（按优先级）

### P0 — 破坏专业感 / 主题正确性 / 系统一致性 / IA 清晰度

#### P0-1 主题逃逸：硬编码颜色导致多主题失效

- `GitCredentialDialog.tsx`：整页 inline 写死 One Dark 色板
- `SessionChips.tsx`、`ChangesList.tsx`、PR 系列：`#3fb950` / `#f85149` / `#a371f7`
- `WSLDialog` / `RemoteDialog`：`rgba(97,175,239,…)` 写死 One Dark 蓝
- `SectionHeader` / `ContextMenu`：DOM style / hex danger
- 多处 `text-white` 叠 accent，未用 `--text-on-accent`（One Dark / OKLCH 下对比失效）

#### P0-2 设计原语未被采用（双轨 UI）

- ~311 raw button vs 11 Button（基线见 §2.2）
- Settings / StatusBar / Dock / Skill / Git 各自手写 hover/active/disabled
- Dialog 与手写 `fixed inset-0` 浮层并存（Task/Launch/部分 Settings）

#### P0-3 Token 语义破损

- 使用 `status-error` 但主题只定义 `status-failed`
- `accent-blue` 在 Claude 下是橙色 — 命名误导
- `--accent-foreground: #2997ff` 不随主题变化
- `accent-orange` / `bg-surface` 未定义却被引用

#### P0-4 导航双轨 / 死代码 / 未完成迁移

- 主路径 Dock；`ActivityBar` / `PanelArea` / `RightPanel` / `SidebarContext` 仍导出
- `DockZoneTabs` 已实现但 **DockZone 未挂载** → 多面板 zone 无法 visually 切换
- DockBar badge 恒 `hidden` 且写死 `0`

#### P0-5 Skills 信息架构冲突

- Skills 既是左侧 dock 面板，又整页替换中心 workspace
- `App.tsx` 双挂载 + CSS `hidden`：编辑器/终端从视野消失，心智模型混乱

#### P0-6 主 chrome 焦点不可见

- `DockBarButton` / ToolbarFooter 等 `focus:outline-none` 无 `focus-visible:ring`
- 键盘用户在主导航几乎无焦点反馈

#### P0-7 StatusBar 过矮

- `h-4`（16px）承载 LSP/Console/Debug 等交互，低于 VS Code/JetBrains 密度下限

---

### P1 — 专业 IDE 体验差距

#### P1-1 上下文层级不足

- TitleBar 几乎只有 logo + 动作，缺 **当前项目 / 环境(Local·WSL·SSH) / 分支**
- 用户难以持续感知“我在哪”

#### P1-2 密度体系不统一

| 区域 | 现状 | 问题 |
| --- | --- | --- |
| TitleBar | h-8 | 可接受 |
| Dock 按钮 | 外 44 / 内 32，footer 外 36 / 内 28 | 不一致 |
| Dock tabs | h-8 | |
| Editor tabs | h-6 | 偏矮；且用了 `--terminal-font-size` |
| StatusBar | h-4 | 过矮 |
| 面板头 | h-6 / h-7 / h-8 / min-h-9 | 相邻浮岛不对齐 |

#### P1-3 字体阶梯失控

- 并存：`--font-size`、`text-[8–18px]`、`0.72–1.07em`、`calc(var(--font-size)±N)`
- Appearance 调字号时大量标签不跟随

#### P1-4 Empty / Loading / Error 不专业

- Projects：`No projects added` 纯文案
- Dock Suspense：`Loading {title}...`
- Conversation 有 skeleton（好），其他面板没有统一骨架
- 错误多为 toast 或零散文案，缺 ErrorState

#### P1-5 Settings 体验割裂

- 替换整个中心岛，丢失项目上下文
- active 用大面积 `accent-blue` fill，与 dock 选中（bg-selected）语言不一致
- 搜索只过滤 nav label，不是设置项全文搜索
- 大量 raw input/button + em 字号

#### P1-6 图标与符号混乱

- Lucide / shared icons / 内联 SVG / emoji（📁 ⚡ 💻）混用
- 描边 1.8 vs 2、尺寸 10–22 漂移

#### P1-7 焦点与可达性参差

- 多处 outline 被去掉
- StatusBar LSP 下拉自研 portal + 绝对定位，键盘弱
- 手写 modal 无统一 focus trap

#### P1-8 反馈系统分裂

- AppToast：仅 info/error
- notification feature 另一套
- 无统一 success / warning / progress 规范

#### P1-9 面板头 / 工具栏无标准组件

- ~82 处 `border-b border-border` 各自拼 header
- Browser / Diff / Conversation / Debug 高度与按钮尺寸不一

#### P1-10 z-index 混乱

- 14 档魔法数：50 / 100 / 200 / 999 / 1000 / 1100 / 2000 / 9998 / 9999 / 10000
- 菜单/对话框/toast 互相打架风险高

#### P1-11 菜单系统三套皮肤

- `ui/ContextMenu`：shadcn accent 蓝洗
- project `ContextMenu`：bg-hover + hex danger
- skill 菜单：刻意避开 accent 蓝

#### P1-12 浅色主题不友好

- `border-white/[0.04]`、`hover:bg-white/5` 假设暗色海面
- Light/Claude 下分割线消失或发脏

#### P1-13 底部工具不在 Islands 体系

- TaskConsole / Debug 与侧栏浮岛语言不一致，“工具在哪”心智分裂

#### P1-14 Input 默认强制 mono

- 所有 Input 用 monospaced，名称/凭据类表单不专业

---

### P2 — 可维护性与长期品质

1. 双 `cn` 路径：`@/lib/utils` 与 `@/shared/utils/cn`
2. Badge/计数器未产品化
3. Dialog 尺寸/页脚规范不统一
4. Motion 语言缺失（面板/tab）
5. `text-secondary/40` 等半透明对比风险
6. StatusBar 职责过重（LSP 管理挤进 16px）
7. Apple token 死代码 vs 任意 spacing
8. 并行 CSS 类（`.agent-bar-btn` 等）与 Tailwind 时代混用
9. 源码编码/注释乱码痕迹（迁移残留）

---

## 4. 目标设计原则

1. **Content first, chrome quiet** — 内容与浮岛是主角
2. **One density scale** — 全应用共用 compact IDE 密度
3. **Semantic tokens only** — 禁止业务硬编码颜色
4. **Primitives over snowflakes** — 按钮/输入/面板头/空态走统一组件
5. **Persistent context** — 始终可见：项目、环境、分支、活动 Agent
6. **Keyboard-first** — 可点控件必有 focus-visible
7. **Honest empty states** — 空态给行动，不只给文案

**权威锚点：**

- 布局：保留 **Islands**
- 密度：向 **VS Code / Cursor compact** 靠拢（不是 Apple HIG 宽松）
- 组件：以 **shadcn + Neeko semantic tokens** 为唯一实现层
- Apple spacing：要么 remap 为 IDE density 后真正启用，要么废弃叙事

---

## 5. 目标设计系统

### 5.1 密度 Token

```text
--chrome-titlebar-h: 32px
--chrome-statusbar-h: 22px      /* 16 → 22 */
--chrome-dockbar-w: 44px
--chrome-panel-header-h: 32px
--chrome-tab-h: 28px
--chrome-toolbar-h: 32px
--row-h-sm: 24px
--row-h-md: 28px
--row-h-lg: 32px
--icon-sm: 14px
--icon-md: 16px
--icon-lg: 20px
--radius-panel: 8px
--radius-control: 6px
--radius-chip: 9999px
--gap-island: 6px
```

### 5.2 字体阶梯（绑定 --font-size）

| Token | 公式 | 用途 |
| --- | --- | --- |
| `text-micro` | max(10px, base-2) | 时间戳、快捷键 hint |
| `text-meta` | max(11px, base-1) | 次级元数据 |
| `text-ui` | base (12) | 默认 UI |
| `text-ui-md` | base+1 | 列表主标题 |
| `text-ui-lg` | base+2 | 面板标题 |
| `text-section` | base+4 | Settings section |

业务层禁止再写 `text-[11px]` / `0.86em`（xterm/CM 宿主除外）。

### 5.3 语义色（渐进 rename）

| 新语义 | 映射自 | 用途 |
| --- | --- | --- |
| `--color-accent` | accent-blue | 主强调（可非蓝） |
| `--color-success` | accent-green / status-idle | 成功 |
| `--color-warning` | accent-yellow / status-running | 警告/索引中 |
| `--color-danger` | accent-red / status-failed | 错误/删除 |
| `--status-error` | alias → status-failed | 兼容现有 class |

兼容期旧名作 alias；修掉 `--accent-foreground` 写死蓝。

### 5.4 z-index 阶梯（最多 6 层）

```text
--z-base
--z-dropdown
--z-sticky
--z-modal
--z-toast
--z-devtools
```

### 5.5 必建原语 / Pattern

| 组件 | 职责 |
| --- | --- |
| `IconButton` | 24/28/32 热区、tooltip、focus-visible、active |
| `PanelHeader` | 标题 + actions；固定高度 |
| `Toolbar` | 横向工具条 |
| `EmptyState` | icon + 标题 + 描述 + 主/次 CTA |
| `StatusDot` | idle/running/failed/unknown |
| `FormField` | label + control + hint + error |
| `ChromeChip` | 分支/环境/计数 |
| `UnderlineTabs` | 参考 GitControl 本地好模式 |

### 5.6 交互状态契约

- hover：`bg-bg-hover`，文字 → primary
- selected：`bg-bg-selected` **或** accent fill + **仅** `text-on-accent`
- danger hover：`bg-accent-red/10 text-accent-red`
- disabled：`opacity-50 pointer-events-none`
- focus-visible：统一 ring（`var(--accent-blue)` / semantic accent）

### 5.7 布局 refinement

1. **TitleBar**：logo | 项目名 + 环境 badge + 分支 | 分组 actions
2. **StatusBar**：22px；左 LSP/Git 摘要；中任务；右行列/通知；详细管理进菜单
3. **Settings**：v1 保持中心岛替换；选中态与 dock 一致（selected surface）；全文搜索为 P1（见 §11 Decision Log）
4. **Skills IA**：v1 推荐 **master-detail**（左列表 + 中心详情）；禁止 `hidden` 双挂载（见 §11）
5. **DockZoneTabs**：v1 **禁止 zone 多面板**；组件保留但主路径不挂载（见 §11）
6. **删除/冻结** ActivityBar 等遗留导航（`ui-nav-cleanup`）
7. **Apple spacing token**：废弃业务叙事；density token 成为唯一间距权威（见 §11）

---

## 6. 关键界面优化建议

### Projects

- 空态：图标 + Add Local / WSL / SSH 三 CTA
- Git +/- 走 diff tokens；环境用统一色点/图标

### Workspace / Tabs

- Tab 高度与关闭热区对齐 density
- Dirty / Running / Failed 统一 StatusDot
- Tab 文案用 UI 字号，不用 terminal font size
- Guide 升级为带快捷键提示的 Onboarding

### Conversation

- 已有 skeleton — 作列表面板参考
- 收敛 `text-[10/11px]` 到 type scale
- Agent filter 抽 `ChromeChip`

### Git / PR / 连接

- 全面去 hex；`GitCredentialDialog` → Dialog + FormField + Input + Button
- WSL/Remote 去写死蓝与 emoji 图标
- Diff toolbar → Toolbar 原语

### Skill

- emoji → Lucide/自定义 SVG
- 卡片密度与 Projects 对齐

### Terminal / Editor

- 宿主主题桥接独立；chrome 与宿主分离

---

## 7. React 架构建议（实现阶段）

1. ESLint/脚本：禁止 feature 内 `text-[#`、颜色字面量 style
2. 新代码强制原语；旧代码按 P0 文件优先扫
3. 统一 `cn` 入口
4. 不要大爆炸重写：token → 原语 → chrome → feature
5. Skills 中心切换改为单树路由/条件渲染，避免双挂载

---

## 8. 成功指标

| 指标 | 基线 | 目标 |
| --- | --- | --- |
| raw button（ui 外） | ~311 | <80 |
| Button 采用 | ~11 | 覆盖对话框主操作与工具栏 |
| feature 硬编码色 | 多 | 交互 chrome 归零 |
| 硬编码 px 字号 | ~266 | chrome/feature UI 归零（宿主除外） |
| 暗色假设 white/alpha | ~33 | Light/Claude 路径归零 |
| StatusBar 高 | 16px | 22px |
| 未定义 status-error | 有 | 消除 |
| 导航双轨 | 有 | 仅 Dock |
| Projects 空态 | 纯文案 | 多 CTA EmptyState |
| Skills 双挂载 | 有 | 单一 IA |
| z-index 魔法数 | 14 档 | ≤6 token 层 |

### 8.1 复测命令（实现阶段每 PR 可跑）

```bash
# raw buttons outside src/ui
rg -n '<button\b' src --glob '!**/*test*' -g '!src/ui/**' | wc -l

# Button imports
rg -n "from ['\"]@/ui/button['\"]" src --glob '!**/*test*' | wc -l

# hardcoded px / em type sizes
rg -n 'text-\[(8|9|10|11|12|13|14|15|16|17|18)px\]' src --glob '!**/*test*' | wc -l
rg -n 'text-\[[0-9.]+em\]|0\.[0-9]+em' src --glob '!**/*test*' | wc -l

# theme escape candidates
rg -n 'text-\[#|bg-\[#|border-\[#' src --glob '!**/*test*' | wc -l
rg -n 'border-white/|bg-white/|hover:bg-white/' src --glob '!**/*test*' | wc -l

# broken / legacy tokens
rg -n 'status-error|accent-orange|bg-surface' src --glob '!**/*test*'
```

---

## 9. 风险与取舍

| 风险 | 缓解 |
| --- | --- |
| 大范围 class 替换易回归 | 分 feature PR；先 alias |
| 密度调整影响肌肉记忆 | StatusBar/Tab 分两步或可配置 |
| Islands 间距减少内容区 | gap 4–6px |
| 语义色重命名成本 | 双写 1–2 个版本 |
| Skills IA 改动影响工作流 | 默认 master-detail；双挂载改单树前先做状态清点 |
| 与 unified-task-hub 争 Settings/TitleBar | 见 §13 跨任务边界 |

---

## 10. 建议后续实现子任务

### 10.1 子任务清单

| ID | 范围 | 依赖 | v1? |
| --- | --- | --- | --- |
| `ui-tokens-density` | density/type/z-index tokens；`status-error` alias；语义色 alias；修 `accent-foreground`；补/删 `accent-orange` `bg-surface` | — | **Yes** |
| `ui-primitives-chrome` | IconButton / PanelHeader / Toolbar / EmptyState / StatusDot / FormField；迁移 Dock/TitleBar/StatusBar | tokens | **Yes** |
| `ui-theme-escape-fix` | GitCredential / SessionChips / ChangesList / PR / WSL / Remote 去硬编码 | tokens（原语优先） | **Yes** |
| `ui-empty-loading` | Projects 等空态 + 统一骨架 | primitives | **Yes**（至少 Projects） |
| `ui-settings-ia` | Settings 选中态/密度/表单收敛；搜索保持 label-only | tokens + primitives | **Yes**（视觉）；全文搜索 P1 |
| `ui-skills-ia` | 取消双挂载；master-detail | 产品决策已定；可与 chrome 并行后段 | **Yes** |
| `ui-nav-cleanup` | 冻结/删除 ActivityBar 等；DockZoneTabs 不挂载写进约定 | chrome 后 | **Yes**（小） |
| `ui-quality-gate` | lint 脚本、a11y/主题抽检清单 | 贯穿全程 | **Yes**（雏形随 tokens） |

### 10.2 阶段映射（A–F ↔ 子任务）

```text
A 地基        → ui-tokens-density + ui-quality-gate(雏形)
B 原语        → ui-primitives-chrome（组件新建）
C Chrome      → ui-primitives-chrome（TitleBar/StatusBar/Dock 迁移）
                 + ui-nav-cleanup
D 主题逃逸    → ui-theme-escape-fix
E 关键面      → ui-empty-loading + ui-settings-ia + ui-skills-ia
                 + Conversation type scale（可并入 tokens 后续 PR）
F 质量闸门    → ui-quality-gate（收口）
```

### 10.3 依赖图

```text
ui-tokens-density
  ├─► ui-primitives-chrome
  │     ├─► ui-empty-loading
  │     ├─► ui-settings-ia
  │     └─► ui-nav-cleanup
  ├─► ui-theme-escape-fix
  └─► ui-skills-ia（不依赖 chrome 完成，但共享 token）

ui-quality-gate ──贯穿以上全部──
```

### 10.4 v1 cut line

**v1 必做：** A–D + Projects EmptyState + Skills 去双挂载 + nav cleanup + quality 雏形。  
**v1 可延后：** Settings 全文搜索、全局面板骨架铺齐、Conversation 全量 type scale、Motion 语言、Badge 产品化。

实现前每个子任务再写独立 prd/design；本文件是父任务权威方案。

---

## 11. Decision Log（默认推荐，实现前可推翻）

> 状态：`proposed-default`。用户若反对某条，改 status 为 `overridden` 并写新选择即可。  
> 日期：2026-07-26

### D1 · Skills 信息架构

- **决策（推荐）：** master-detail — 左 dock `skills` 列表保留；中心区仅在选中 skill 时显示详情；**禁止** workspace + SkillContent 同时 mount 后靠 `hidden` 切换。
- **理由：** 保留“从项目上下文进 skill”的路径，同时消除双挂载带来的状态/焦点/性能副作用（见 `src/app/App.tsx`）。
- **备选否决：**
  - 仅 rail：详情空间不足，复杂 skill 编辑吃亏
  - 仅中心模式：与 dock 项目工作流割裂
- **迁移要点：** 单树条件渲染；离开 skill 时恢复 workspace 焦点；不要用 CSS `hidden` 保活整棵编辑器树
- **Status：** proposed-default

### D2 · Settings 形态

- **决策（推荐）：** v1 继续 **中心岛整页替换**（`appView === 'settings'`）；视觉上 nav 选中改 `bg-bg-selected`，去掉大面积 accent fill；搜索仍过滤 nav label。
- **P1：** 命令式/全文设置搜索；是否改为中心岛内嵌页（不杀 workspace）另开任务评估。
- **理由：** 改 IA 成本高且与 `unified-task-hub` Integrations 并行；v1 先统一视觉语言。
- **Status：** proposed-default

### D3 · DockZoneTabs / zone 多面板

- **决策（推荐）：** v1 **禁止** 同一 zone 多面板可视化切换；`DockZoneTabs` 保留实现但不挂载；文档与类型层面对 multi-panel zone 标为 unsupported。
- **理由：** 组件已实现但主路径未接线；半吊子多面板比没有更伤专业感。需要时另开 `dock-multi-panel` 任务。
- **Status：** proposed-default

### D4 · Apple spacing tokens

- **决策（推荐）：** **废弃业务叙事**；不在 feature 中推广 Apple spacing 名。间距/高度以 §5.1 density token 为唯一权威。现有 `@theme` Apple 变量可暂留以免破坏未知引用，但不写进 frontend 规范正文化。
- **理由：** 与 compact IDE 密度冲突；组件采用率 ~0。
- **Status：** proposed-default

### D5 · 语义色命名策略

- **决策（推荐）：** 兼容期 **双写**：新增 `--color-accent/success/warning/danger`，旧 `accent-blue/green/...` 与 `status-*` 作 alias；`--status-error` → `--status-failed`。
- **理由：** 降低大爆炸 rename 风险，先修正确性再收旧名。
- **Status：** proposed-default

---

## 12. 原型索引

| 原型文件 | 覆盖问题 | 对应阶段 / 子任务 | 验收看点 |
| --- | --- | --- | --- |
| [`prototype-optimized-shell.html`](./prototype-optimized-shell.html) | TitleBar 上下文、密度、EmptyState、选中态、focus-visible | C / `ui-primitives-chrome` | 壳层一屏：项目上下文 + 22px StatusBar + selected surface |
| [`prototype-statusbar-compare.html`](./prototype-statusbar-compare.html) | StatusBar 16→22 | C / `ui-primitives-chrome` | 热区可点；与 TitleBar 32 不再头重脚轻 |
| [`prototype-settings-hifi.html`](./prototype-settings-hifi.html) | Settings 选中态/表单密度 | E / `ui-settings-ia` | nav 非大蓝块；FormField 对齐 |
| [`prototype-projects-panel.html`](./prototype-projects-panel.html) | Projects 空态与多环境列表 | E / `ui-empty-loading` | EmptyState 三 CTA；环境色点 |
| [`prototype-git-credential-compare.html`](./prototype-git-credential-compare.html) | Git 凭据主题逃逸 | D / `ui-theme-escape-fix` | Light/Dark/Claude 下 Dialog 跟 token |
| `docs/prototypes/git-log-panel.html`（主仓库既有，本 worktree 未签出） | Git 列表密度参考 | D/E 参考 | 行高/meta 字号对齐 density |

实现 PR 描述应链接对应原型；视觉争议以原型 + Decision Log 为准。

---

## 13. 跨任务边界（vs `unified-task-hub`）

| 面 | `ui-design-audit` 负责 | `unified-task-hub` 负责 | 协作约定 |
| --- | --- | --- | --- |
| Settings 视觉 | token、nav 选中态、FormField/密度、raw input 收敛 | Integrations 信息架构、Provider 卡片内容与连接流 | task-hub 新 UI **必须**用 Neeko semantic token / 原语，不引进新色板 |
| Settings 路由 | 保持 `appView=settings` 直到另开 IA 任务 | 可新增 Integrations section/item | 不并行改 Settings 路由模型 |
| TitleBar | 项目名 / 环境 / 分支上下文；actions 分组与 IconButton | Launch 文案（原 Task Runner）与入口语义 | UI 任务不改 Launch 业务；文案任务不改 chrome 密度 |
| 空态 | `EmptyState` 原语与 Projects 模板 | Work Items / Integrations 空态文案与 CTA 目标 | 文案可不同，布局骨架共用 EmptyState |
| StatusBar | 高度、分区、可点热区 | Launch/Debug 状态内容 | 内容接入走现有 slot，不新造 16px 控件 |

若两任务同时改同一文件：先合 token/原语，再合业务面板。

---

## 14. Frontend Spec 大纲（实现时写入 `.trellis/spec/frontend/`）

建议新增或扩写（名称可调）：

1. **`design-tokens.md`**
   - density / type scale / z-index / 语义色 alias 表
   - 禁止业务 hex、`text-[Npx]`（列宿主例外：xterm、CodeMirror、第三方 diff）
   - Light 主题禁止 `*-white/N` 当分割线或 hover 海面
2. **`ui-primitives.md`**
   - IconButton / PanelHeader / Toolbar / EmptyState / StatusDot / FormField 的 props 与尺寸
   - 何时允许 raw `<button>`（极少数性能/虚拟列表 cell 需注释理由）
3. **`chrome-layout.md`**
   - TitleBar / DockBar / StatusBar / 面板头高度契约
   - 导航权威仅 Dock；ActivityBar 等为 legacy frozen
4. **质量钩子**
   - ESLint 或 `pnpm` script：`text-[#` / 颜色字面量 style / 可选 `status-error` 已定义检查
   - PR 自检：Dark + Light 主路径；Tab 焦点走 Dock + 一 Dialog

阶段 A（tokens）合并前应至少落盘 `design-tokens.md` 草案。

---

## 15. 关键文件清单（父任务 related surface）

| 区域 | 路径 |
| --- | --- |
| App 壳 / Skills 双挂载 | `src/app/App.tsx` |
| Dock chrome | `src/layout/dock-layout/*`、`src/app/components/DockBarButton.tsx` |
| 遗留导航 | `src/layout/ActivityBar.tsx`、`RightPanel.tsx`、`PanelArea`（若仍导出） |
| Title / Status | `src/layout/TitleBar.tsx`、`src/features/status-bar/StatusBar.tsx` |
| Tokens | `src/styles/theme.css`、`src/styles/index.css`、`src/styles/shadcn-theme.css` |
| 主题逃逸 P0 | `src/features/git/components/GitCredentialDialog.tsx`、`ChangesList.tsx`、`PullRequestsPanel.tsx`、`pr-detail/*`、`src/features/project/components/SessionChips.tsx`、`ContextMenu.tsx` |
| 连接对话框 | WSL/Remote 相关 dialog 组件 |
| Settings | `src/features/settings/components/SettingsView.tsx`、`SettingsPanel.tsx` |
| 原语层 | `src/ui/*`、`src/lib/utils.ts`、`src/shared/utils/cn.ts` |
| 本任务原型 | `.trellis/tasks/07-26-ui-design-audit/prototype-*.html` |

---

## 16. 附录：仍可加深的审计维度（非 v1 阻塞）

1. Skills 双挂载的性能/订阅副作用测量
2. 最小窗口与窄宽断点
3. macOS / Windows 窗口控件与 TitleBar 拖拽区
4. 对比度与 `prefers-reduced-motion`
5. 现有 `ui/*` 可复用清单，避免重复造原语
6. 组件测试 vs 纯人工视觉清单的自动化边界
