# 设计令牌（Design Tokens）

> Neeko 前端的**样式唯一权威源**。本文档记录 token 的分层、可用清单与禁止写法。
>
> 配套护栏：`check_ui_style_tokens`（`tools/guards/checks/`）——
> 禁止新增硬编码色 / 暗色假设 / accent 底上的写死白字 / 无焦点环。
>
> ⚠ **护栏只能拦「新增」，拦不住「改粗」**：把一个低对比度元素换成 token 时，
> 护栏全绿，但视觉强度可能变了 —— 见「坑 4」。

---

## 分层

```
base/variables.css    不随主题变的全局值：
   │                  density / 字体阶梯 / z-index / 字体角色 /
   │                  CodeMirror 与 git-status 的**兜底值**
   ↓
themes/<theme>.css    一主题一文件（dark / light / one-dark-pro / claude / classic-dark）
   │                  **自包含**：60 个变量值 + 自己的 color-scheme
   ↓
base/tailwind.css     桥接为 Tailwind v4 utility 类（--color-* / --text-*）
   │                  @theme    → 键名与被引用变量不同名（--color-bg-primary → var(--bg-primary)）
   │                  @theme inline → 键名与被引用变量同名时必须用它（否则自引用失效）
   ↓
业务代码              只用 utility 类；禁止写裸色值
```

### 划分判据：这个值换主题时会变吗？

| 目录 | 内容 | 换主题时会变？ |
| --- | --- | --- |
| `base/variables.css` | 字阶、密度、z-index、字体角色、兜底色板 | ❌ |
| `base/reset.css` | `*` / `body` / `#root` / 滚动条 | ❌ |
| `base/tailwind.css` · `base/shadcn.css` | 桥接与别名（值是 `var()`） | ❌ |
| `themes/*.css` | 60 个颜色值 + `color-scheme` | ✅ 就是主题差异本身 |

`base/` 里同时有「变量定义」与「选择器规则」—— 它们性质不同（前者不匹配元素），
但对维护者是同一件事：**改主题时不需要看这些文件**。这条心智比「变量 vs 规则」
的区分更有用。

> **本仓没有 "design tokens"**。业界该词指平台中立的 JSON 源 + 编译管线
> （Style Dictionary → 多平台产物）。本仓 CSS 就是源、无编译步骤，用的是
> **CSS 自定义属性**（= theme variables）。曾有一个 `styles/tokens/` 目录，
> 因名不副实（混了定义/桥接/别名三种角色）已删除，**不要重新引入**。

### 为什么一主题一文件

原先 5 个主题块挤在 598 行的 `theme.css` 里：

| 问题 | 后果 |
| --- | --- |
| 改 light 主题要翻到第 513 行 | 定位慢 |
| 一次改动散落在单文件 diff 里 | 看不出「这次动了几个主题」 |
| 新增主题要在正确位置插入 90 行 | 容易插错位置 |
| `color-scheme` 单独一组声明 | 新增主题时容易漏配 |

拆开后的契约：

- **`root.css` 必须最先 import** —— 它提供兜底值。自定义主题只覆盖部分变量时，
  未覆盖的必须有值，否则 `var(--x)` 回退为继承色（颜色静默失效）。
- **每个主题文件自带 `color-scheme`** —— 一个文件 = 该主题的完整定义。
  新增主题 = 复制一个文件改值，不会漏配。
- **变量清单必须与契约一致** —— `themeContract.test.ts` 扫目录逐个校验，
  新增主题文件自动纳入，无需改测试。

> **拆文件后不能用「并排看」来对比主题**。想确认 5 个主题的
> `--bg-primary` 层级关系是否都合理，现在要开 5 个文件 ——
> 这个需求改由单测承担（`themeTokens.test.ts` 断言每个主题**文件**定义全部契约变量、
> `--switch-track` 对比度 ≥1.5）。**机器校验比人眼并排更可靠。**

**校验必须按「文件身份」而不是「内容特征」**：`themes/` 下的每个 `.css` 都是主题。

不要用 `vars.size > 10` / `accentCount >= 3` / `has('--bg-tertiary')` 这类启发式
来识别主题块 —— 2026-10-28 那样写时，往 `themes/` 放一个只写了 1 个变量
（或只有 `color-scheme`）的新主题文件，**18 个测试全绿、护栏 0 违规**。
判据现为 `themeCss.ts::inspectThemeFile()` 纯函数，`themeTokens.test.ts` 的
「判据对坏主题的识别」有 10 条坏数据用例直接驱动它（含缺闭合括号那条 ——
它是上一次「假绿」的正身）。
而「新主题还没填完就提交」恰恰是最可能发生的错误，后果是 `var(--x)` 回退为
继承色（颜色静默失效，正是这套测试要防的那个事故）。

同理：**不要为某个具体变量另写「它必须在哪些块里」的特判用例**。契约本身就是
那份清单，一条「每个主题文件定义全部契约变量」即覆盖。

### 样式层目录：`src/styles/README.md` 是唯一权威

目录与命名的完整规范（含 `components/` 的「域」判据、各层准入条件、禁止写法）
写在 **`src/styles/README.md`**，由护栏 `check_styles_layout` 强制 4 条判据。
本文件只记与 token 直接相关的部分。

`fonts/` 与 `motion/` 是并列的独立层：前者由 `app/main.tsx` 单独 import
（字体加载时机独立于样式层序），后者装跨域横切的 `@keyframes`。

### 变量名契约：唯一来源不是 CSS

```
src/shared/utils/themeVariables.ts        ← 契约（60 个变量名，按语义分组）
        │
        ├──► styles/themes/*.css                  校验：每个主题块必须定义全部变量
        ├──► features/settings/customThemeVars.ts  自定义主题可覆盖清单
        └──► src/shared/utils/__tests__/themeContract.test.ts   一致性断言
```

**为什么需要它**：同一组变量名曾有三份独立清单，且已漂移 ——

| 位置 | 数量 |
| --- | --- |
| `theme.css` 的 5 个主题块 | 59 |
| `customThemeVars.ts` 的 `CUSTOM_CSS_VARS` | **31** |
| `themeTokens.test.ts` 的校验清单 | 若干 |

实际后果：用户做自定义主题后 **28 个变量无法覆盖** —— 包括全部 **19 个 `--cm-*`
语法色**、`--mono-fg`、`--switch-track`、`--border-subtle` 与 3 个 `-rgb` 变体。
编辑器语法高亮、终端前景色、Switch 轨道、弱分割线全部仍是内置主题的值，
且界面没有任何提示。

现在新增主题变量**必须**改契约，否则 `themeContract.test.ts` 报
「CSS 里多出未登记变量」。这条反向断言是关键 —— 只校验「契约里的 CSS 都有」会漏掉
「CSS 有但契约没登记」，而那正是上面那 28 个变量的成因。

### 为什么分两个文件

`theme.css` 是**语义层**（这条令牌是什么角色），`tailwind.css` 是**桥接层**
（这个角色对应哪个 utility 类）。合并成一个文件会让「改一个色值」与
「加一个新类」混在一起 —— 前者是主题维护，后者是 API 变更，评审关注点不同。

---

## 令牌清单

### 表面与文字

| Token | Tailwind 类 | 用途 |
|---|---|---|
| `--bg-primary` | `bg-bg-primary` | 海面（面板之间的底） |
| `--bg-secondary` | `bg-bg-secondary` | 浮岛表面 |
| `--bg-tertiary` | `bg-bg-tertiary` | 三级表面（浮岛内的 header / 输入框） |
| `--bg-hover` | `bg-bg-hover` | hover 海面 |
| `--bg-selected` | `bg-bg-selected` | **选中态**（与 dock 一致） |
| `--text-primary` | `text-text-primary` | 主文字 |
| `--text-secondary` | `text-text-secondary` | 次级文字 |
| `--text-muted` | `text-text-muted` | 元数据 / 占位 |
| `--text-on-accent` | `text-text-on-accent` | **accent 底上的文字色**（随主题变） |
| `--border-color` | `border-border` | 常规边框 / 分割线 |
| `--border-subtle` | `border-border-subtle` | **弱分割线**（层级更淡的一档） |
| `--code-inline-fg` | —（仅 CSS 内部使用，无桥接） | **行内代码前景色**（逐主题取色；坑 10） |

### 控件专属

| Token | Tailwind 类 | 用途 |
|---|---|---|
| `--switch-track` | `bg-switch-track` | **Switch 未勾选态轨道**（逐主题取值，vs 海面 ≥1.5） |

> 控件 token 与表面 token 是**不同的对比区间**，不能互相复用 —— 见坑 8。
> 新增任何「必须看得见」的控件轮廓时，先问：能不能复用 `border-border` 描边？
> 能就复用（Checkbox / ToggleGroup 的做法）；不能才加专用 token。

### 语义色

| Token | Tailwind 类 | 用途 |
|---|---|---|
| `--accent-blue` | `bg-accent-blue` / `text-accent-blue` | 主强调 |
| `--accent-green` | `text-accent-green` | 成功 |
| `--accent-yellow` | `text-accent-yellow` | 警告 |
| `--accent-red` | `text-accent-red` | 错误 / 删除 |
| `--accent-orange` | `text-accent-orange` | 辅助强调 |
| `--accent-brick` | `text-accent-brick` | 合并态（GitHub PR merged） |
| `--status-idle` | `text-status-idle` | 空闲 |
| `--status-running` | `text-status-running` | 运行中 |
| `--status-failed` | `text-status-failed` | 失败 |
| `--status-error` | `text-status-error` | **failed 的别名**（见下） |

### Git / Diff

| Token | Tailwind 类 | 用途 |
|---|---|---|
| `--git-status-added` | `text-git-status-added` | 新增文件 |
| `--git-status-modified` | `text-git-status-modified` | 修改 |
| `--git-status-deleted` | `text-git-status-deleted` | 删除 |
| `--git-status-untracked` | `text-git-status-untracked` | 未跟踪 |
| `--git-status-conflict` | `text-git-status-conflict` | 冲突 |
| `--diff-added` / `--diff-added-text` | `bg-diff-added` / `text-diff-added-text` | diff 新增（底 / 字） |
| `--diff-removed` / `--diff-removed-text` | `bg-diff-removed` / `text-diff-removed-text` | diff 删除（底 / 字） |

### 终端底色：**不复用专属 token，刻意跟随表面层**

`--terminal-bg: var(--bg-secondary)`（`base/variables.css`，运行时由 `buildTerminalTheme` 直读）。

本应用里终端是**浮岛里的面板**，不是独立编辑器组：

| 理由 | 说明 |
| --- | --- |
| 视觉归属 | 它必须与所在面板是同一个「面」；一块颜色不同的矩形会被看成渲染错误 |
| 单一杠杆 | 表面阶梯已全局校过，终端跟随即自动在同一条阶梯上；独立 token = 每个主题多一个必须手工对齐的值 |
| 无独立语义 | VS Code 的 `terminal.background` 独立是因为支持独立编辑器组 / 图片背景，本仓无此场景 |

**代价（需知晓）**：改一次 `--bg-secondary`，终端会静默跟着变。

**什么时候才该拆**：出现「终端必须与所在面板刻意不同」的真实需求（浮窗式终端、图片背景）。判据是**存在独立渲染需求**，而不是「希望它再暗一点」—— 后者调的是表面阶梯，不是终端。

---

## 九个必须知道的坑

### 坑 1：`--status-error` 是别名，不是新颜色

业务层历史上写 `status-error`，但主题只定义了 `status-failed`。
2026-10-27 之前 **tailwind.css 里没有 `--color-status-error` 映射** ——
Tailwind 根本不生成 `text-status-error` 类，于是 4 处错误提示
（`LspPanel` / `LspCustomServersSection` ×2 / `HtmlPreview`）**没有红色**。

现在：主题 5 个块各有 `--status-error: var(--status-failed)`，
`tailwind.css` 有 `--color-status-error` 映射。

> **加新别名时的检查清单**：① 主题每个块都要有；② `tailwind.css` 要有映射；
> ③ 至少一个消费点。缺 ② 就是「类不生成」的断链 —— 表现是**样式静默失效**，
> 不报错。护栏只查「不新增反模式」，**查不出断链**（断链是「少了一个定义」，
> 不是「多了一个错写」）。

### 坑 2：`@theme` 与 `@theme inline` 的自引用

`tailwind.css` 里：

```css
@theme {
  --color-bg-primary: var(--bg-primary);   /* ✅ 键名与被引用变量不同名 */
}

@theme inline {
  --text-micro: var(--text-micro);          /* ⚠️ 同名 → 必须 inline */
}
```

`@theme`（非 inline）会把值**编译期解析**。同名时 `var(--text-micro)` 指向
`@theme` 块自身 → 自引用 → 无效。`@theme inline` 保留运行时引用 → 正常。

**判据**：键名与被引用变量**同名** → 必须 `@theme inline`。

### 坑 3：语义色的「一个定义适配 5 个主题」怎么做到

`--border-subtle` 要在 5 个主题下都对，就得随主题变。两条路：

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| A. `color-mix` 混一次 | `:root` 定义一次，混 `--text-primary` 与百分比 | ❌ 降级回退值取第一个分量（坑 6），且百分比一刀切导致暗色主题变粗（坑 5） |
| B. 逐主题显式 rgba | 每个主题块各写一个 `rgb(... / α)` | ✅ **当前采用** —— 值显式、行为可预测、无降级路径 |

```css
/* theme.css */
--border-subtle: rgb(255 255 255 / 0.04);   /* dark / classic-dark / one-dark-pro */
--border-subtle: rgb(0 0 0 / 0.08);         /* claude */
--border-subtle: rgb(0 0 0 / 0.09);         /* light */

/* tailwind.css —— @utility 运行时解析 */
@utility border-border-subtle { border-color: var(--border-subtle); }
```

> 逐主题手写的代价是「加主题要改 N 处」—— 但这个代价**低于**「值被编译期
> 静默改写」的代价（后者源码对、产物错，无任何报错）。

### 坑 4：**「加一条分割线」与「把一条分割线变明显」是两回事**

这是 2026-10-27 真实的用户反馈，两轮：

> 第一轮：「projects 优化后还没有优化前好看，每个项目之间都加了一个横杠，很丑」
> 第二轮：「直接去掉不要横杠，横杠的意义是什么呢」

**第一轮的错**：把 `border-white/[0.04]`（4% 白，几乎不可见）换成
`color-mix(text-primary 8%)`（8% 近白）—— 不是「加了横杠」，是**把横杠变明显了**。
token 化只保证「跟随主题」，不保证「强度不变」。

**第二轮的定案**：项目之间**根本不该有分割线**。理由：

- 项目头本身已是视觉单元（avatar + 粗体名称 + 计数）
- hover 时整行有 `bg-bg-hover` 背景块 —— **背景块已承担分组职责**
- 再加一条线 = 三重分隔

**判据：加分割线前先问「这个元素的信息边界在哪」。**
若边界已由**背景块 / 缩进 / 头像 / 字重**表达，再加线就是冗余。

> **落地方式**：不只是删 class —— `isLast` 这条数据链
> （`groupProjects` → `ProjectsPanel` → `ProjectItem` → `ConnectionProjectCard` →
> `ProjectGroup`）唯一的消费者就是那条线，故**整条链一并删除**，
> 避免留下无人消费的 prop（TS `noUnusedParameters` 也会报）。
> `groupProjects` 原本注释称 `lastGroup` 是「DnD 排序落点用」——
> **那是错的**：DnD 用的是 `over.id`（拖放目标的项目 id），与该字段无关。

### 坑 5：**换掉一个「几乎看不见」的元素时，不要把它变明显**

这是 2026-10-27 真实的用户反馈：「projects 优化后还没优化前好看，
每个项目之间都加了一个横杠，很丑」。

根因不是「加了横杠」，而是**横杠的强度变了**：

| | 原值 | 首次实现 | 结果 |
| --- | --- | --- | --- |
| 暗色主题 | `border-white/[0.04]`（4% 白，几乎不可见） | `color-mix(text-primary 8%)`（8% 近白） | **明显可见** |

`--text-primary` 在暗色主题下是 `#ffffff` / `oklch(0.985)` —— **近白**。
8% 近白叠在深底上是一条清晰的横线；4% 白则几乎看不见。

**判据：替换一个低对比度元素时，「视觉强度」是必须保持的量，
不是「用了 token」就等于等价。** token 化只保证**跟随主题**，
不保证**强度不变**。

### 坑 6：**前景色要按「它压在什么底上」选，不是按「它是文字还是图形」选**

2026-10-27 第三次同类回归：`Switch` 滑块。

```diff
- 'bg-white'                                  // 原值：只在暗色主题成立
+ 'bg-text-primary'                           // 首版：跟着「页面文字色」走
+ 'bg-text-primary data-[state=checked]:bg-text-on-accent'   // 修复
```

**用户反馈**：「开关样式优化之后更加丑了」（附 Claude 主题截图：赭红轨道上一个深棕滑块）。

**为什么首版是错的**：滑块压在 **accent 底**上，它要的是「accent 底上的前景色」
= `--text-on-accent`，**不是**「页面文字色」= `--text-primary`。

Claude 主题下这两个值差得极远：

| token | 值 | 角色 |
| --- | --- | --- |
| `--accent-blue` | `#c96442`（赭红） | 轨道底色 |
| `--text-primary` | `#2d1e14`（深棕） | 页面文字色 ← **首版误用** |
| `--text-on-accent` | `#f5f0e8`（浅米白） | accent 底上的前景色 ← **正确** |

深棕滑块压在赭红轨道上 → 对比度不足，糊成一团。

**全仓审计的结果**（2026-10-27 扫描全部 599 个 tsx + 8 个 css）：

| 位置 | 元素 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| `ui/Switch.tsx` | 滑块（accent 实底） | `bg-text-primary` | `bg-text-primary` + `checked:bg-text-on-accent` |
| `app/components/WelcomeScreen.tsx:65` | 「Add Your First Project」按钮 | `text-text-primary` | `text-text-on-accent` |
| `shared/components/GitDialog.tsx` | 自制 switch 滑块 | `bg-text-secondary` | `bg-text-primary` + `checked:bg-text-on-accent` |
| `styles/components/agent.css:71` | `.agent-bar-btn.selected` | `color: var(--text-primary)` | `color: var(--text-on-accent)` |
| `styles/base/base.css:51` | `.wc-close:hover` | `color: #fff` | `color: var(--text-on-accent)` |

**扫描方法**（可复用）：找**实底** accent 容器（`bg-accent-*` / `bg-destructive`，
**后面不跟 `/数字`** —— 半透明底不算，半透明底上用普通文字色是**对的**），
再看其前景色是不是 `text-on-accent` 系。

> **⚠ 扫描时的两个陷阱**：
> ① 正则用 `\b` 边界会把 `bg-accent-blue/15` 也算成实底 → 误报 16 处；
> ② `text-xs` / `text-sm` 是**字号**不是颜色，正则不排除会误报 5 处。
> 两轮误报后才收敛到真正的 5 处。

**仓库已有的正确范式**（首版没查就自己发明）：

```tsx
// ui/Checkbox.tsx —— 对勾在 accent 底上
'data-[state=checked]:bg-accent-blue data-[state=checked]:border-accent-blue'
'<svg className="text-text-on-accent">'

// ui/ToggleGroup.tsx —— 选中态文字在 accent 底上
'data-[state=on]:bg-accent-blue data-[state=on]:text-text-on-accent'
```

> **判据：选颜色前先问「它压在什么底上」，而不是「它是什么元素」。**
> 压在 accent 底 → `--text-on-accent`；压在 `--bg-tertiary` 等普通底 → `--text-primary`。
> 同一个元素在两种底上（如 Switch 滑块）**需要两个颜色**，靠 `data-[state=...]` 切换。

#### 机器判据：护栏判据 5（CSS 侧）+ `optionSecondary()`（TSX 侧）

这一节记录 2026-10-28 的一次**大幅简化**：原本有一条 488 行的本地 ESLint 规则
（AST 判定 JSX 里的 accent 实底 + 错前景色），已删除。删除理由不是「不需要」，
而是**它的防护面与正确写法互斥**：

| 写法 | ESLint 规则能否看到 |
| --- | --- |
| `className="text-text-muted"` 字面量 | ✅ |
| `className={optionSecondary(selected)}` | ❌ 函数返回值不在 AST 静态范围 |
| 模板字符串 / 变量 / 常量对象 | ❌ |
| **CSS 文件里的 `color:`** | ❌ 规则只扫 `.tsx?` |

那 7 处真实 bug 修完后**全部改用 `optionSecondary()`** —— 规则恰好对它们失明。
而 7 处里有 2 处在 CSS（`agent.css` / `base.css`），规则从来就看不到。
**它最该防的地方它防不住，能看到的地方又已经没人那样写。**

现在的分工：

| 位置 | 机制 | 说明 |
| --- | --- | --- |
| **TSX** | `shared/utils` 的 `optionSecondary(selected)` | 唯一入口；用对了就天然正确，无需判据 |
| **CSS** | 护栏判据 5（`check_ui_style_tokens`） | 此前**零覆盖**，是真盲区 |

**判据 5 的边界**（决定误报率，改动前必读）：

- 只认「**值就是** `var(--accent-*)`」的实底。
  `background: color-mix(in srgb, var(--accent-blue) 32%, transparent)` 与
  `rgba(var(--accent-blue-rgb), .28)` 都是**半透明底**，上面用普通文字色是**对的**
  （`editor.css` 有 5 处这种写法）。
- `background-color:` 里的 `color` 不是前景色声明，用 `(?<!background-)` 排除。
- 规则块包在 `@layer` 里也要检查（真实文件都是这个形状）。

**判据 5 抓到的两个历史 bug 正身**：

```css
/* agent.css —— 曾用 --text-primary 压在 --accent-blue 上 */
.agent-bar-btn.selected { background: var(--accent-blue); color: var(--text-on-accent); }

/* base.css —— 曾用 #fff（在 light 主题下没问题，但 dark 只有 1.40 对比） */
.wc-close:hover { background-color: var(--accent-red) !important; color: var(--text-on-accent) !important; }
```

**7 处真实 bug 的形态**（6 个文件，全是下拉项选中态）：

父元素 `selectedAgentId === agent.id && 'bg-accent-blue text-text-on-accent'` 变蓝底后，
子元素的 `<span className="text-text-muted">{agent.command}</span>` 自带颜色类**覆盖了继承**的
on-accent，暗色主题下灰字压蓝底几乎不可见。修法是收敛到共享函数：

```tsx
<span className={optionSecondary(selected)}>{agent.command}</span>
```

位置：`RemoteDialog.tsx` ×2、`WSLDialog.tsx` ×2、`ProjectSettingsDialog.tsx` ×3。

> **为什么当初用 AST 而不用正则**：正则版实测误报 22 处
> （`bg-accent-blue/15` 16 处、`text-xs` 5 处、`hover:border-accent-blue`、
> `data-[state=on]:` 变体、三元互斥分支 10 处）。AST 能区分「实底 vs 半透明底」
> 「底色 vs 边框色」「字号 vs 颜色」「同一状态 vs 互斥分支」。
>
> 这个结论**对 CSS 判据 5 不适用** —— CSS 里的 `background: var(--x)` 是字面量，
> 正则足够，不存在 JSX 那种「三元分支合并」的问题。

**验证方式**：不能只看类名，要算**对比度**。实测 5 主题的滑块/轨道对比：

| 主题 | 修复前（text-primary） | 修复后（text-on-accent） |
| --- | --- | --- |
| dark | 1.37 ❌ | 2.94 ✅ |
| one-dark-pro | 1.11 ❌ | 7.99 ✅ |
| claude | 4.12（但视觉糊） | 3.44 ✅ |
| classic-dark | 3.02 | 3.02 ✅ |
| light | 3.93 | 4.25 ✅ |

### 坑 7：`color-mix` 在本仓库会被降级，回退值取第一个分量

用 `color-mix` 实现 `--border-subtle` 时，产物里出现：

```css
:root{--border-subtle:var(--text-primary)}          /* 回退 */
@supports (color:color-mix(in lab,red,red)){
  :root{--border-subtle:color-mix(...)}}            /* 支持时覆盖 */
}
```

回退值是 color-mix 的**第一个分量** —— 不支持 color-mix 的浏览器里，
分割线变成**近白实色**（比原来粗得多）。

同理，Tailwind 的 `@theme` 会在**编译期**求值变量，遇到 color-mix 里的 `var()`
无法求值就退化成第一个分量。

**结论**：`--border-subtle` 用**显式 rgba**（逐主题给值），
且桥接用 `@utility` 而非 `@theme`：

```css
/* theme.css —— 逐主题显式值 */
--border-subtle: rgb(255 255 255 / 0.04);   /* dark / classic-dark / one-dark-pro */
--border-subtle: rgb(0 0 0 / 0.08);         /* claude */
--border-subtle: rgb(0 0 0 / 0.09);         /* light */

/* tailwind.css —— @utility 运行时解析 */
@utility border-border-subtle {
  border-color: var(--border-subtle);
}
```

> **验收方式**：看**构建产物**里的最终值，不是看源码。
> `pnpm build` 后检查 `dist/assets/*.css` 里的 `--border-subtle:` 声明 ——
> 源码写得对、产物被降级，是静默的。

### 坑 8：**表面层级 token 不能拿来当控件轨道**

2026-10-27 用户反馈：「按钮在不同主题下看着很别扭，特别在 claude、light 主题下面
特别明显的不协调」（附 Switch 截图）。

排查结论不是滑块颜色错，而是 **未勾选态的轨道几乎看不见**：

| 主题 | `bg-tertiary` 轨道 vs 海面 | 观感 |
| --- | --- | --- |
| light | **1.08** | 轨道消失，只剩一颗深色圆球漂着 |
| claude | **1.11** | 同上 |
| classic-dark | 1.16 | 同上 |
| dark | 1.25 | 勉强 |
| one-dark-pro | 1.31 | 勉强 |

**根因**：`--bg-tertiary` 是**表面层级**色（面板、卡片、下拉项），它与海面的对比
按设计就该很淡 —— 层级差异靠「很淡的色差 + 圆角 + 阴影」共同表达。

而**控件轨道**的需求完全不同：

| 用途 | 对比区间 | 理由 |
| --- | --- | --- |
| 表面层级（`bg-tertiary`） | 1.0 ~ 1.3 | 只要「隐约分层」，不能抢内容 |
| 控件轨道（`switch-track`） | **1.5 ~ 2.0** | 要**成形**（否则看不见控件），但不能抢眼 |
| 文字对比（`text-primary`） | ≥ 4.5 | 可读性底线 |

三个区间不重叠，所以**不能复用**。这就是 `--switch-track` 是独立 token
而不是某个 surface 别名的原因。

#### 为什么只有 Switch 出问题

同类控件 `Checkbox` / `ToggleGroup` 都有 `border border-border` 描边，
所以从没这个问题 —— 描边把轮廓画出来了，填充色淡不淡无所谓。

Switch 是唯一**只靠填充色**表达轮廓的控件。修法是双管：

```tsx
// 填充：专用 token（逐主题，对比 ≥1.5）
'bg-switch-track'
// 描边：与 Checkbox / ToggleGroup 对齐
'data-[state=unchecked]:bg-switch-track data-[state=unchecked]:border-border'
// 勾选态 accent 实底自己就是轮廓，去掉描边
'data-[state=checked]:bg-accent-blue data-[state=checked]:border-transparent'
```

#### 取值方法（可复用到任何新控件）

以该主题 `--bg-primary` 的 oklch 明度为基准，**暗底 +0.15 / 亮底 −0.15**，
彩度压到 `0.008`（几乎无彩，不抢 accent 的戏），色相跟随主题。

| 主题 | `--bg-primary` | `--switch-track` | 对比 |
| --- | --- | --- | --- |
| dark | `#111111` | `#363636` | 1.56 |
| one-dark-pro | `#21252b` | `#3f4349` | 1.55 |
| classic-dark | `#26292f` | `#43464d` | 1.54 |
| light | `#ebecf0` | `#bebfc3` | 1.56 |
| claude | `#f0ebe2` | `#c3bfb7` | 1.54 |

#### 附带发现：滑块**不能**统一用白色

排查时容易顺手把滑块改成 `bg-white`（「亮色主题下白滑块最自然」）。
实测否定 —— 新轨道色下的滑块对比：

| 主题 | `text-primary` 滑块 | 白色滑块 |
| --- | --- | --- |
| dark | 11.58 | 12.08 |
| one-dark-pro | 4.67 | 9.95 |
| classic-dark | 9.45 | 9.45 |
| light | **9.07** | **1.84** ❌ |
| claude | **8.76** | **1.62** ❌ |

亮色主题下白色滑块与浅色轨道几乎同色。所以滑块必须**跟着底色走**：
未勾选（`switch-track` 底）用 `text-primary`，勾选（accent 底）用 `text-on-accent`。

#### 机器判据

| 文件 | 作用 |
| --- | --- |
| `src/ui/Switch.tsx` | `SWITCH_TRACK_CLASS` / `SWITCH_THUMB_CLASS` 导出（class 契约常量化） |
| `src/ui/__tests__/Switch.test.tsx` | 13 用例（含 2 变异验证：改回 `bg-bg-tertiary` / 删描边） |
| `src/styles/__tests__/themeTokens.test.ts` | **真算对比度**：每个主题的 `switch-track` vs `bg-primary` 必须 ≥1.5 |

> 对比度测试是这组里最值钱的一条 —— 它会在**任何人调主题底色时自动把关**：
> 改了 `--bg-primary` 就必须重算 `--switch-track`，否则测试红。
> 这比「记住有个坑」可靠。

### 坑 9：**`text-accent` 不是强调文字色，它是 12% 透明的底色 token**

2026-10-28 用户报「文件选择时的显示需要优化…选中后字体都看不清楚了」（附截图：
one-dark-pro 与 claude 两个主题下，选中行的文件名像水印）。

**根因不在主题配色，在 token 撞名**：

```
src/styles/base/shadcn.css
  --accent: rgba(var(--accent-blue-rgb), 0.12);   ← shadcn 的“accent 悬停底色”
  @theme inline { --color-accent: var(--accent); } ← Tailwind 的 text-accent 就取这个

dist/assets/*.css  实测产物
  .text-accent{color:var(--accent)}                ← 12% 透明的字
```

于是 `statusToNameColorClass` 返回的「激活态色」把文件名画成了
`rgba(蓝, 0.12)`：5 个主题下对比度 **1.10 ~ 1.21**（就是“看不见”）。

实测数字（文件名色 vs `--bg-selected`）：

| 主题 | `text-accent`（12%） | 换成 `--accent-blue` | `--text-primary` |
| --- | --- | --- | --- |
| dark | **1.21** | 4.28 | 10.90 |
| classic-dark | **1.14** | 3.21 | 9.67 |
| one-dark-pro | **1.16** | 3.13 | 3.47 |
| light | **1.13** | 2.86 | 11.24 |
| claude | **1.10** | 2.45 | 10.10 |

**两层结论，缺一不可**：

1. **`text-accent` 禁止当文字色** —— 文字强调用 `text-accent-blue` /
   `text-accent-<色名>`；半透明 accent 底上的文字用 `text-accent-foreground`。
   已收进 `check_ui_style_tokens`（判据 6）。
2. 就算换成真 accent 色，light / claude 仍然只有 2.86 / 2.45 —— 因为
   **`--bg-selected` 是不透明的浅一档表面**，会把中等亮度的彩色文字吃掉一截。
   同样的账在 git 状态色上也成立（light added 2.26、claude deleted 2.45、
   one-dark-pro untracked 2.05）。所以：

> **高亮行（选中/激活）的文件名一徥用 `--text-primary`，状态交给行尾徽标。**

这就是 VS Code 的做法：它的文件名永远是中性色，状态由行尾 `M` / `U` 字母表达；
JetBrains 式的「名字着色」只在**未高亮**时生效。
（`FileTreeRow` 因此补上了行尾徽标 —— 之前它只有名字色一条通道，一旦中性化
就等于状态消失。目录行同样带徽标：目录也携带聚合状态，否则选中目录后状态无出口。）

#### 徽标只有一个渲染口径：`shared/components/GitStatusBadge`

修这个 bug 时顺手暴露了另一个问题：同一个语义元素曾有**三套 DOM、三种长相**
（`ChangeFileTree` 的 `<Badge>` 药丸带描边、`FileTreeRow` 的 `text-[10px]` 方块、
`FileDiffSection` 的 `calc(var(--font-size)-3px)` 圆角）。现状全部收敛到
`GitStatusBadge`，它**不包 `ui/Badge`**：`Badge` 是通用 chip（`text-xs` 固定字阶），
而 git 徽标是行装饰，必须跟随「外观字号」缩放 —— 套在一起必有一方是错的。

稳定性靠 `data-git-status` 属性，**不靠 class**（拿样式 class 当契约正是 `text-accent`
事故的同型错误）。

#### 机器判据

| 文件 | 锁住什么 |
| --- | --- |
| `shared/utils/gitFileDecoration.ts` | `HIGHLIGHTED_NAME_CLASS` 单一来源；三个派生函数的 `highlighted` 分支 |
| `shared/components/GitStatusBadge.tsx` | 徽标唯一渲染口径（字母 / 色板 / 字号跟随 / `data-git-status`） |
| `shared/utils/__tests__/gitFileDecoration.test.ts` | 「高亮行颜色与状态/ignored 均无关」—— 6 状态 × ignored 的穷举 |
| `styles/__tests__/themeTokens.test.ts` | 每主题 `HIGHLIGHTED_NAME_CLASS` 对应的 token vs `--bg-selected` ≥ 3.0（token 名从常量反推，不写死） |
| `tools/guards/checks/check_ui_style_tokens.py` | 禁止 `text-accent` 当文字色（判据 6，**`.tsx` 与 `.ts` 都扫** —— 事故源头就在 `.ts`） |

> 阀值用 3.0（WCAG 1.4.11 非文本级）而不是 4.5：条目标签不是正文段落，
> 且 one-dark-pro 的选中底（`#4d5666`，原主题的 scrollbarSlider 亮档）实测 3.47
> 是五主题下限。要提高到 4.5 得重调该主题的选中档位 —— 那是另一个决定。

### 坑 10：**行内代码的底块不是对比度保证，删它等于把责任交还给表面栈**

2026-11 需求：「markdown 里的 `` `code` `` 不要背景色，长文里很丑，给文字一个颜色即可」。

**误区**：以为底块（`background: var(--bg-tertiary)` + padding + 圆角 chip）在保证可读性，
所以「删掉它就不能再用 accent 色」。实测相反 —— 底块从未保证过对比度：

| 主题 | `--accent-green` vs `--bg-primary` | vs `--bg-tertiary`（chip 底） |
| --- | --- | --- |
| dark | 7.51 | 6.01 |
| **light** | **2.84** | **3.08** |
| **claude** | **3.38** | **3.04** |
| classic-dark | 7.21 | 6.22 |
| one-dark-pro | 6.94 | 5.33 |

chip 在 light / claude 下**反而把对比度压得更低**（2.84 → 3.08），两个浅色主题
一直是 < 4.5 的正文级失败，只是 chip 的视觉重量把它盖住了。

**结构结论**：正文里的行内代码不用 accent、也不用中性前景，而是**专属的逐主题 token`--code-inline-fg`**。
两个方向都实测过并都被否掉：

| 候选 | 失败面 | 数字 |
| --- | --- | --- |
| `--accent-green` | 对比度（浅色主题） | light 2.84 / claude 3.04 |
| `--mono-fg` | 可辨识度（与正文分不开） | one-dark-pro ΔE **0.000**（它与 `--text-primary` 同值 `#abb2bf`）、dark 0.090、classic-dark 0.086 |

> 第二条是用户实际报出来的：「字体颜色没有了，应该加个字体颜色，不然区分不了」。
> **可读 ≠ 可辨**：对比度只衡量亮度差，一个「与正文同色」的等宽字体对比度可能很高，
> 却完全看不出是代码。所以本 token 有**双判据**。

**取色规则：槽位逐主题自选，但必须取自本主题调色板，只许调明度。**

第一版把规则钉在 `--cm-string`，结果五个主题**全是绿** —— 因为 One Dark / Atom One Light /
Apple 这三套调色板的 strings 本来就都是绿。用户反馈「还是绿色的，每个主题都是绿色的」。
规则应该约束的是「**取自哪套调色板**」，不是「哪个固定槽位」：

| 主题 | 取色槽位 | `--code-inline-fg` | 对比度下限 | ΔE vs 正文 | ΔE vs 链接（防撞车） |
| --- | --- | --- | --- | --- | --- |
| dark | `--cm-number`（琥珀） | `#dea052` | 6.66 | 0.26 / 0.16 | 0.23 |
| light | `--cm-keyword`（Atom 紫） | `#a626a4` | 5.18 | 0.36 / 0.21 | 0.23 |
| claude | `--accent-brick`（暖砖红） | `#8b382f` | 5.90 | 0.22 / 0.11 | 0.17 |
| classic-dark | `--accent-green`（Apple 绿） | `#30d158` | 6.22 | 0.32 / 0.23 | 0.32 |
| one-dark-pro | `--cm-keyword`（One Dark 紫） | `#e091f8` | 4.90 | 0.15 / 0.16 | 0.18 |

槽位自选的取舍依据：**语义安全的色才配正文** —— 红 / 黄 / 橙在别处承载错误与警告，
所以优先绿、紫、以及 claude 自己的暖砖红；`--accent-blue` 也不能选，它是 markdown 链接色
（`.markdown-preview a`），码字与链接同色会被误读。同理暗色主题里已有 accent 绿的
保留绿，中性底（dark）用琥珀更像编辑器惯例（VS Code Dark+ 的 `textPreformat` 就是暖色）。

> 反面教材（前两版）：① 钉死 `--cm-string` → 五主题全绿；
> ② 手挑「看起来像」的颜色（light `#17703a` 偏青 8°、classic-dark 用了它的 success 绿 14°）
> → 不属于该主题配色。结论：**「适配主题」只能靠「同色相 + 只改明度」这条可验证关系，
> 不能靠人眼觉得像。**

**机器判据**（判据本体 `styles/__tests__/inlineCodeCss.ts`，由 `themeTokens.test.ts`「行内代码」驱动，五条）：
读 `components/markdown.css` / `components/agent-chat.css` / `components/lsp.css` 里**每一条**行内代码规则，断言
① 无 `background`；② 两处 token 相同；③ 该 token 在 `--bg-primary` / `--bg-secondary` /
`--bg-tertiary` 上逐主题 ≥ 4.5（**读得清**），且与 `--text-primary` / `--text-secondary`
的 OKLab ΔE ≥ 0.10（**看得出**）；④ 色相与彩度等于本主题**某个调色板槽位**
（10 个 `--accent-*` / `--cm-*` 中最近的一个，色相差 ≤ 6°、彩度 ≥ 60%，**属于本主题配色**）；
⑤ 与链接色 `--accent-blue` 的 ΔE ≥ 0.12（**不长得像链接**）。
**token 名从实现反推** —— 谁把颜色改成 `--mono-fg` 或自编色值，测试自动去测它并变红，
不存在「测试绿、实现错」。

> 阈值分工：对比度用 4.5（正文级，不是坑 9 的 3.0 非文本级 —— 行内代码是句子的一部分）；
> ΔE 用 0.10（≈ 明显不同色；实测最紧的组合是 claude 对 secondary 的 0.111）。
> ΔE 与色相辅助函数在 `styles/__tests__/themeCss.ts` 的 `deltaE()` / `toOklch()` / `hueDelta()`。

---

## 字体阶梯

| Token | Tailwind 类 | 公式 | 用途 |
|---|---|---|---|
| `--text-micro` | `text-text-micro` | `max(10px, base-2)` | 时间戳、快捷键 hint |
| `--text-meta` | `text-text-meta` | `max(11px, base-1)` | 次级元数据 |
| `--text-ui` | `text-text-ui` | `base` | 默认 UI |
| `--text-ui-md` | `text-text-ui-md` | `base+1` | 列表主标题 |
| `--text-ui-lg` | `text-text-ui-lg` | `base+2` | 面板标题 |
| `--text-section` | `text-text-section` | `base+4` | Settings section |

**业务层禁止再写 `text-[11px]` / `text-[0.86em]`** ——
那些写法不跟随用户设置的字号（`--font-size` 由 Appearance 面板驱动）。

**例外白名单**（宿主渲染，不属 UI 层级）：
xterm 终端、CodeMirror、第三方 diff 渲染器。

---

## 密度 token

定义在 `:root`，**当前只定义不套用**（2026-10-27 的 UI 精致化任务明确
「不改动当前布局」—— 套用即改变容器几何）。

```text
--chrome-titlebar-h: 32px      --row-h-sm: 24px        --icon-sm: 14px
--chrome-statusbar-h: 22px     --row-h-md: 28px        --icon-md: 16px
--chrome-dockbar-w: 44px       --row-h-lg: 32px        --icon-lg: 20px
--chrome-panel-header-h: 32px  --radius-panel: 8px     --radius-control: 6px
--chrome-tab-h: 28px           --radius-chip: 9999px   --gap-island: 6px
--chrome-toolbar-h: 32px
```

---

## z-index 阶梯

```text
--z-base: 0      --z-dropdown: 100    --z-sticky: 200
--z-modal: 1000  --z-toast: 1100      --z-devtools: 9999
```

同样**当前只定义不套用**（改层级 = 改行为）。

---

## 禁止写法

护栏 `check_ui_style_tokens` 强制以下五条：

| # | 禁止 | 替代 | 后果 |
|---|---|---|---|
| 1 | `text-[#3fb950]` / `bg-[#a371f7]` | `text-git-status-added` / `text-accent-brick` | 主题切换后不跟着变 |
| 2 | `border-white/[0.04]` / `bg-white` | `border-border-subtle` / `bg-bg-hover` | 亮色主题下**直接消失** |
| 3 | `bg-accent-blue text-white` | `bg-accent-blue text-text-on-accent` | 某些主题下对比失效 |
| 4 | `focus:outline-none`（无 `focus-visible:` 替代） | `focus-visible:ring-2 focus-visible:ring-accent-blue` | 键盘用户看不到焦点 |
| 5 | `text-accent`（= `rgba(accent-blue, .12)`） | `text-accent-blue` / `text-accent-<色名>` | 12% 透明的字，对比度 1.1（见坑 9） |

### 判据 3 的两个变体

| 底色 | 用什么 |
|---|---|
| **实心** accent 底（`bg-accent-blue` / `bg-accent-red` / `bg-destructive`） | `text-text-on-accent` |
| **半透明** accent 底（`bg-accent` = 12% 蓝） | `text-accent-foreground`（= `--accent-blue`） |

半透明底上用 `text-on-accent` 会是「深底深字」—— 选错比不选更糟。

---

## 交互状态契约

| 状态 | 写法 |
|---|---|
| hover | `hover:bg-bg-hover` + `hover:text-text-primary` |
| selected | `bg-bg-selected` + `text-text-primary`（**不用** accent 大色块） |
| danger hover | `hover:bg-accent-red/15` + `text-accent-red` |
| disabled | `opacity-50 pointer-events-none` |
| focus-visible | `focus-visible:ring-2 focus-visible:ring-accent-blue` |

> **焦点环用 `focus-visible:` 而不是 `focus:`** —— 后者在鼠标点击时也会出环，
> 视觉噪声。`ui/Dialog.tsx` / `ui/Badge.tsx` / `LspCustomServersSection.tsx`
> 2026-10-27 前用的就是 `focus:ring-2`，已改。
