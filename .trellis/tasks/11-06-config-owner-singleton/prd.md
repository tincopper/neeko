# PRD：配置所有权唯一化与全局 owner 收口

## 背景与问题

用户反馈「进入 Library / Skills 模块时整窗闪黑一下」。定位结果：

- `ViewSkillDialog`（`SkillContent` 无条件挂载，即使 `open=false`）误调 `useAppConfig()`，
  成为**第二个 config owner**。该 hook 自带 `AppConfig` state 与副作用：mount 时把
  `document.documentElement` 的 `data-theme` 写成 `DEFAULT_CONFIG.theme`（dark），随后
  `load_config` 异步完成再改回用户已保存主题（light）→ 整窗主题翻转一次。
- 卡片 / 按钮上的 `transition-colors` 把这次翻转放大成可见的灰白/黑色闪烁（截图已确认）。
- 已完成两处局部修复：`ViewSkillDialog` 改用 `useAppContext()`（含回归测试）；
  `AppCenter` 改为 Library 子树启动即常驻（方案 A，消除 `React.lazy` 挂载间隙）。
- **但非法状态仍可表达**：`useAppConfig` 仍从 feature barrel 导出，任何组件都能再造一个 owner；
  「全局恰好一次」目前全靠注释约定；主题首帧仍有一次 `DEFAULT → 已保存` 翻转。

本任务的目标不是再修一个点，而是从方案层面让这类问题**不可表达、机器可检、扩展不返工**。

## 范围

L0–L4 全量（用户已确认），含上一轮的局部修复成果一并纳入验收。不改 Rust 后端、不改构建配置、
不引入新的状态管理框架、不重写现有 feature。

## 需求

| # | 需求 | 说明 |
| --- | --- | --- |
| R1 (L0) | config owner 私有化 | 只有一个调用点（`useAppShellData`）；owner 不再从 `@/features/settings` barrel 导出；所有 config→DOM/全局环境的投影集中到单一模块 |
| R2 (L1) | 约定变机器判据 | 新增护栏：owner 调用点数量 == 1；`data-theme` / 自定义 CSS 变量写入只许出现在投影模块；提供通用 `expectNoGlobalSideEffectsOnMount` 测试助手并在 ≥2 个 feature 测试中使用 |
| R3 (L2) | 全局 owner 单一清单 | 所有「恰好一次」的 effect owner 收口到 `src/app/bootstrap.ts` 的 owner registry：一张清单、一个审计点、一个测试；渲染型宿主（dialog host）保持原位但纳入清单核对 |
| R4 (L3) | 首帧前主题注入 | 内置主题在 `ReactDOM.createRoot().render()` **之前**已应用；`load_config` 只做 reconcile，不再产生可见翻转；自定义主题不回退 |
| R5 (L4) | 读接口收窄 | `AppContextValue.config` 只读；提供 `useConfig(selector)` 读钩子；写侧仍只有 `saveConfig` 一个 action |
| R6 | 行为零漂移 | 主题切换、自定义主题 CSS 变量、终端主题、字体 token、agent 主题同步、LSP import strategy、config 保存/加载全部保持原语义 |
| R7 | 保留既有成果 | `ViewSkillDialog` 只读修复 + 回归用例、方案 A（`AppCenter` 常驻）及其回归用例、相关 spec 文档同步 |
| R8 | 工程约束 | `pnpm check:quick` 通过；不新增组件行数 ratchet 债务；不主动提交代码 |

## 验收标准（可测）

- **AC1**：全库检索 `useAppConfigOwner(` 恰好 1 处（`useAppShellData`）；`@/features/settings` barrel
  不再导出 owner；feature 目录无任何 owner 引用。
- **AC2**：新护栏进入 `check:quick` 且通过；护栏自测含负例（人为复制一个 owner 调用点 / 在非投影模块
  写 `data-theme` 时必须判失败）。
- **AC3**：`ViewSkillDialog`（`open=false`）挂载后 `data-theme` 不变；`ViewSkillDialog.test.tsx`、
  `LibraryPanel.test.tsx` 等使用 mount-invariance 助手断言「挂载不产生全局副作用」。
- **AC4**：`bootstrap()` 在渲染前写入正确主题；有单测断言「bootstrap 后、render 前 `data-theme` 等于
  同步缓存里的主题」；用户主题为 light 时冷启动不再出现 dark 帧。
- **AC5**：`AppContextValue.config` 为 `Readonly<AppConfig>`，`useConfig(selector)` 可用且被至少一个
  消费者使用；`pnpm type-check` / `check:quick` 全绿。
- **AC6**：主题切换链路（data-theme、CSS vars、终端主题、字体 token、agent 主题同步）有测试覆盖，
  改前改后行为一致。
- **AC7**：新增一个「恰好一次」owner 只需在 owner registry 增一行；存在能发现重复挂载的测试/护栏。
- **AC8**：模块数量与接口面不膨胀：不新增 store 层 / 第三方依赖；新增**生产模块 ≤5**（测试、护栏自测、任务制品不计，文件数不是有效指标）；`AppContextValue` 只读化后读侧只多 `useConfig(selector)` 一个入口，写侧仍只有 `saveConfig`。

## 非目标

- 不改 Tauri 窗口 / capabilities / 构建脚本。
- 不重构 `useLiveSessionsBridge` 的业务逻辑（只调整其归属与生命周期表达）。
- 不处理与主题无关的其他闪烁源（如 WebGL renderer）。
- 不做 UI 视觉改版。
