# `src/styles/` 目录规范

> 样式层**唯一**的目录与命名权威。新增 CSS 文件前先读本文。
> 可机器判定的部分由护栏 `check_styles_layout` 强制（3 + 1 条判据）。

---

## 为什么需要这份规范

`styles/` 曾有五个同型问题，都不是「代码写错」而是「没有约定」：

| 问题 | 后果 |
| --- | --- |
| 根级游离 CSS（`jetbrains-mono.css`、`nerd-font.css`） | 看不出归属层；新文件效仿后根级堆积 |
| `base/` 混入组件样式（`.titlebar` / `.wc-btn`） | 「base 只含元素级规则」这条分层失效 |
| 动效（`animations.css`）放在 `components/` | 它服务 5 个域，不属任何单一组件 |
| `components/form.css` 只有 14 行 1 个类 | 不构成一个「域」，却占一个文件位 |
| 11 个零引用的死类名 | 永不生效的 CSS，没人发现 |

---

## 术语：本仓没有 "design tokens"

**业界的 design tokens** 指**平台中立的数据源**（JSON/YAML），经 Style Dictionary
之类工具**编译**成 CSS/JS/Swift/Android 产物。核心特征是「单一数据 + 多平台产物 + 构建步骤」。

**本仓库没有这些**：

```
find . -name "*.tokens.json" -o -name "style-dictionary*"   → 无
package.json 里无 token 编译脚本
```

CSS 文件**本身就是源**。本仓用的是「**CSS 自定义属性**」= 业界说的
theme variables / CSS variables。

对照业界主流做法：

| 做法 | 目录约定 | 代表 |
| --- | --- | --- |
| 真 tokens 管线（JSON 源 + 编译步骤） | `tokens/*.json` | Salesforce Lightning、Adobe Spectrum |
| CSS 变量（CSS 是源，无编译） | `styles/themes/`、`styles/base/variables.css` | **shadcn/ui**、Radix Themes |
| 原子化 CSS 配置 | `styles/` 根级 `@theme` | Tailwind v4 默认 |

本仓属于第二类。

> **历史记录（2026-10-27）**：本仓曾有一个 `styles/tokens/` 目录，装着
> `theme.css` / `tailwind.css` / `shadcn.css`。**已删除** —— 它名不副实：
>
> - 目录里混了**三种不同角色**：变量定义、桥接（`tailwind.css`）、别名（`shadcn.css`）
> - 「与主题无关」的全局变量被迫与主题同住，语义错位
> - 用了一个业界指代「可编译数据源」的词，但本仓没有编译步骤
>
> 现在这些内容各归其位，见下方分层。**不要重新引入 `tokens/` 目录** ——
> 除非真的引入 tokens 编译管线（那时它才名实相符，装的是 JSON 源）。

---

## 分层（顺序即依赖方向，不可逆）

```
index.css          入口：只聚合，不写规则
  │
  ├── base/        不定义主题差异的「基础」（常量或 var() 指向 themes/）
  │     ├── variables.css   全局变量：尺寸轴 / 字阶 / 密度 / z-index /
  │     │                   字体角色 / CodeMirror 与 git-status 兜底色板
  │     ├── reset.css       元素级规则：* / body / #root / 滚动条
  │     ├── tailwind.css    桥接：变量 → Tailwind utility（值是 var(--x)）
  │     └── shadcn.css      别名：shadcn 变量 → Neeko 变量（值是 var(--x)）
  ├── themes/      ★ 主题（一主题一文件，自包含 color-scheme）
  ├── motion/      跨域横切的 @keyframes（不属任何单一组件）
  ├── components/  组件域样式（每文件一个功能域）
  └── fonts/       打包字体 @font-face（由 main.tsx 单独 import）
```

依赖方向**只能向下**：`components/` 可以 `var(--x)` 引用 `base/` / `themes/`，反之不行。

### 为什么变量放 `base/`，而主题单独一层

**判据：这个文件是「定义主题差异」，还是「使用主题差异」？**

- `themes/*.css` —— **定义**。60 个颜色值 + `color-scheme`，就是主题差异本身。
- `base/*` —— **不定义**任何主题差异。它要么是常量（字阶 / z-index / 密度），
  要么是 `var()` 指向别处（`reset.css` 的 `body { color: var(--text-primary) }`、
  `tailwind.css` 的 `--color-bg-primary: var(--bg-primary)`）。

| 文件 | 内容 | 定义主题差异？ | 渲染结果随主题变？ |
| --- | --- | --- | --- |
| `base/variables.css` | 字阶、密度、z-index、字体角色、兜底色板 | ❌ | ❌ |
| `base/reset.css` | `*` / `body` / 滚动条 | ❌ | ✅ **是**（消费 `--text-primary` 等） |
| `base/tailwind.css` / `shadcn.css` | 桥接与别名（值全是 `var()`） | ❌ | ✅ **是**（转发主题色） |
| `themes/*.css` | 60 个颜色值 + `color-scheme` | ✅ | ✅（来源） |

> ⚠ **不要说「base/ 不随主题变」** —— `reset.css` 的 `body` 前景/背景、滚动条颜色
> 都取自主题变量，会随主题变。准确表述是「base/ 不**定义**主题差异」：
> 改一个主题的颜色，不需要动 `base/` 下任何文件。

`base/` 里同时有「变量定义」（`variables.css`）和「选择器规则」（`reset.css`）——
它们性质不同（前者不匹配元素，后者匹配），但对**维护者**是同一件事：
「改主题时不需要看这些文件」。这条心智比「变量 vs 规则」的区分更有用。

### 主题文件

```
themes/
├── dark.css            dark（★ 同时是 :root:not([data-theme]) 兜底）
├── light.css           light
├── one-dark-pro.css    one-dark-pro
├── claude.css          claude
└── classic-dark.css    classic-dark
```

**每个主题文件自包含**：60 个变量值 + 自己的 `color-scheme`。

| 好处 | 说明 |
| --- | --- |
| 新增主题 = 复制一个文件改值 | 不会漏配 `color-scheme`（它就在同一文件里） |
| diff 直观 | `git diff --stat` 直接显示动了哪几个主题 |
| 定位快 | 改 light 主题只需打开 `light.css`（60 个变量一个屏幕内） |

**校验按「文件身份」而不是「内容特征」**（`styles/__tests__/themeTokens.test.ts`）：

> `themes/` 下的每个 `.css` **都是主题**，都必须覆盖契约全部变量。

不要用「变量数够多」「有 accent 色」这类内容特征来识别主题块 —— 2026-10-28
那样写时，往里放一个只写了 1 个变量的主题文件会**全部测试通过**，
把「新主题还没填完就提交」这个最可能的错误放过去。

判据现在抽成 `themeCss.ts` 的 `inspectThemeFile()` 纯函数，
`themeTokens.test.ts` 的「判据对坏主题的识别」一组织有 10 条坏数据用例
（空文件 / 只 1 个变量 / 缺一个 / 拼错 / 多出未登记 / 缺 color-scheme /
选择器写错 / 缺闭合括号 …），**与真实文件断言走同一个函数**。

> **不要用临时脚本验证判据。** 曾经在对话里临时写 bash/python 注入坏数据，
> 脚本不进仓库、无法 review，其中一次把 `s[:-2]`（删尾部空行）当成
> 「删闭合括号」，得出「语法错误也能容忍」的错误结论。任何判据的坏数据用例
> 都写进测试文件 —— 可复现、可 review、改了判据会立刻知道。

同一个理由：**不要为某个具体变量另写「它必须在哪些块里」的特判用例** ——
契约（`shared/utils/themeVariables.ts`）本身就是那份清单，
`每个主题文件定义契约里的全部变量` 一条就覆盖了。

`base/variables.css` 提供兜底值，必须在 `index.css` 里**最先** import ——
自定义主题只覆盖部分变量时，未覆盖的必须有值，否则 `var(--x)` 回退为继承色。
主题之间无选择器重叠，顺序无关。

> **拆成独立文件 ≠ 可以横向对比**。想比较 5 个主题的 `--bg-primary` 时，
> 现在要开 5 个文件。用单测代替人工比对 —— `themeTokens.test.ts` 已经断言
> 「每个主题块必须定义全部契约变量」，不必靠肉眼对齐。

### 各层的准入判据

| 目录 | 只放什么 | 反例（会被护栏拦） |
| --- | --- | --- |
| `base/` | 与主题无关的变量（`variables.css`）+ 元素规则（`reset.css`）+ 桥接/别名 | 主题颜色值（那属 `themes/`）；组件类（那属 `components/`） |
| `themes/` | 一主题一文件，自包含 `color-scheme` | 全局标量（那属 `base/variables.css`） |
| `motion/` | `@keyframes` + 动画工具类 | 单个组件的 hover 过渡（那属 `components/`） |
| `components/` | 一个**功能域**的样式 | 单控件样式（如 `.custom-radio`）、跨域横切 |
| `fonts/` | `@font-face` + 字体授权说明 | 其它任何规则 |

## `components/` 的「域」判据

**一个文件 = 一个可命名的功能域。** 判据（护栏强制）：

> 非注释代码行 > 20，**且** 顶层类 ≥ 2。

理由：不足这个规模的东西通常只服务**一个控件**，它的样式应该
① 用 Tailwind utility 写在组件里，或 ② 合并进相邻的相关域。

**实例**：`form.css` 只有 14 行 / 1 个顶层类（`.custom-radio`），
不构成域 —— 已迁到 `src/ui/Radio.tsx` 用 Tailwind 表达，原文件删除。

> 反例不是「写得不好」，而是**放错层**：一个 14 行的单控件样式表占了
> `components/` 一个文件位，会让「这个目录里的每个文件都是一个域」这条
> 心智失效 —— 之后所有小样式都会效仿它进来。

**动效放哪**：`@keyframes` 若服务多个域（如 `animations.css` 服务
worktree / LSP / toast / agents / CodeMirror 五处），放 `motion/`；
若只服务单个组件（如某个 card 的 hover 过渡），留在 `components/` 里。

---

## 命名

| 对象 | 规则 | 例 |
| --- | --- | --- |
| 目录 | kebab-case，且必须在上面五层之内 | `motion/`、`components/` |
| CSS 文件 | kebab-case | `agent-chat.css`（不是 `agentChat.css`） |
| 根级文件 | **只允许** `index.css` 与 `README.md` | — |

`components/` 的文件名用**域**名（`agent.css`），不是组件名（`AgentSelector.css`）——
一个域可以有多个组件。

---

## 主题与变量的关系

**变量名的唯一来源**是 `src/shared/utils/themeVariables.ts`，不是 CSS。

```
shared/utils/themeVariables.ts   ← 契约（60 个变量名，按语义分组）
        │
        ├──► styles/themes/*.css                  校验：每个主题块必须定义全部变量
        ├──► features/settings/customThemeVars.ts  自定义主题可覆盖清单
        └──► shared/utils/__tests__/themeContract.test.ts   一致性断言
```

新增主题变量时**必须**改契约，否则 `themeContract.test.ts` 会报
「CSS 里多出未登记变量」。这条约束存在的理由：曾有 28 个变量（含全部 19 个
CodeMirror 语法色）无法被自定义主题覆盖，而三份清单各自维护时没人发现。

**`-rgb` 变体的已知重复**：`--accent-blue` 与 `--accent-blue-rgb` 是两份数据，
必须手工同步。它服务 `rgba(var(--accent-blue-rgb), α)` 这类用法
（CodeMirror 选区、动画、编辑器高亮）。改主色时**必须同时改 `-rgb`**，
否则半透明场景会用旧颜色。这是已知技术债，暂不消除（`color-mix` 在本仓
会被 lightningcss 降级，见 `design-tokens.md` 坑 7）。

---

## 禁止写法

| 禁止 | 理由 | 替代 |
| --- | --- | --- |
| 在 `components/` 里写裸色值（`#3fb950` / `rgba(97,175,239,.15)`） | 主题切换后不跟随 | 语义 token（护栏 `check_ui_style_tokens` 强制） |
| 在 `themes/` 里写选择器规则（`color-scheme` 除外） | 定义层混入消费逻辑 | 放 `base/reset.css` 或 `components/` |
| 在 `base/` 里写组件类 | 分层失效 | 放 `components/<域>.css` |
| 用 `*-white/N` 当分割线或 hover 底 | 假设海面是暗色，亮色主题下消失 | `border-border-subtle` / `bg-bg-hover` |
| accent 实底上用普通文字色（`color: var(--text-primary)`） | 暗色主题下字与底几乎同色 | `color: var(--text-on-accent)`（护栏判据 5 强制） |
| 新增根级 CSS 文件 | 无法判断归属层 | 归入上述五目录之一 |
| 在 `components/` 文件里 `@import` 另一个 `components/` 文件 | 隐式依赖，顺序不可控 | 在 `index.css` 统一聚合 |
| 留下零引用的类名 | 永不生效但占维护成本 | 删（本次清理了 11 个） |
