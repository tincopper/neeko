# Design：配置所有权唯一化与全局 owner 收口

> 对应 `prd.md` 的 R1–R8 / AC1–AC8。本文只描述边界、契约、数据流、取舍与回滚形状。

## 1. 第一性原理与结论

三条不变量，按「不可表达 → 机器可检 → 可扩展」排序：

1. **React 组件生命周期 ≠ 应用生命周期**。Hook 是每实例一份；`useAppConfig` 把应用级唯一
   所有权（config state + `load_config` + DOM 投影 + 终端/字体/agent 主题同步）塞进 hook，
   于是 N 次挂载 = N 个 owner。这不是编码失误，是**设计允许的错误状态**。
2. **CSS 与 TS 是同一事实的两个读者**。`data-theme`、自定义 CSS 变量、`--font-*`、
   终端主题都是 `AppConfig` 的投影。投影者必须恰好一个；两个读者在切换窗口里读到不同值，
   就表现为整窗翻转 + `transition-colors` 放大的闪烁。
3. **约定不是接口**。「只挂一次」目前散落在 7 处注释里。接口必须让非法状态不可表达，
   剩下表达不了的边界再用护栏兜住。

**结论**：保留一个 owner（组合根），把「拥有」与「读」在**模块可见性**上分开；把所有
config→环境的写入集中到一个投影模块；把「恰好一次」的 owner 变成一张声明式清单；
把主题事实前移到首帧之前；把读接口收窄为只读。

## 2. 目标结构与 seam

```
src/app/
  main.tsx                    bootstrap() → createRoot().render()（顺序不变）
  bootstrap.ts                唯一入口：installGlobalOwners()
  bootstrap/
    globalOwners.ts           ← 唯一 owner 清单（声明式）
    configProjection.ts       ← 唯一 config→DOM/全局环境写入点
    themeHint.ts              ← 同步缓存（localStorage），只读写缓存不碰 DOM
  hooks/
    useAppConfigOwner.ts      ← 唯一 owner（由 useAppShellData 直导，不进任何 barrel）
    useAppGlobalEffects.ts    ← 唯一 React-hook 型 owner 适配器
    useAppShellData.ts        ← owner 的唯一调用点
shared/contexts/AppContext.tsx ← 只读投影 + useConfig(selector)
features/settings/**          ← 只剩纯逻辑（normalize / save / customThemeVars / API / UI）
tools/guards/checks/check_config_owner_singleton.py ← 机器判据
```

**Seam 决策**：owner 从 `features/settings/hooks/` 移到 `app/hooks/`。理由：它拥有的是
**应用生命周期**，不是 settings 这个 feature 的能力；feature 只保留纯函数与 UI 面板。
`AppContext` 的 seam 保持在 `shared/contexts/`，因为它是横切读接口。

## 3. 契约（Interface）

### 3.1 `useAppConfigOwner()`

- 位置：`src/app/hooks/useAppConfigOwner.ts`；**不进任何 barrel**；唯一调用点
  `src/app/hooks/useAppShellData.ts`。
- 返回 `{ config, saveConfig, customThemes, hydrated }`。
- 新增 `hydrated`：config 加载完成（含失败兜底）才为 true。**投影只在 hydrated 后运行**，
  否则 DEFAULT_CONFIG 会在首帧把 bootstrap 注入的主题覆盖回 dark。
- 保持原有副作用语义，但全部经 `configProjection`：
  `projectTypography(config)` / `projectTheme(args)` / `applyCustomThemeVars(vars)`。
- `saveConfig` 仍是 config.json 的唯一写点（`persistConfigSave`），语义不变。
- `initializing = sessionInitializing || !hydrated`（`useAppShellData`），让 splash 覆盖
  config 加载窗口；`finally` 保证加载失败也能退出 splash。

### 3.2 `configProjection.ts`（唯一写入点）

```
projectTypography(config: Readonly<AppConfig>): void
projectTheme(args: { config; customThemeVariables; localPaths; wsl }): void
applyCustomThemeVars(vars): void
applyThemeHintBeforeRender(): void   // 由 bootstrap 调用
```
- 只有本模块允许 `document.documentElement.setAttribute('data-theme', …)`。
- 内部调用既有单一职责模块：`customThemeVars.ts`（CSS 变量增删）、`typography.ts`
  （字体 token）、`terminal.ts`（终端主题）、`settingsApi.syncAgentTheme`。
- `projectTheme` 每次都 `writeThemeHint(...)` → 同步缓存与权威状态同源。
- 行为对齐原实现：字体 effect 只依赖字体字段；主题 effect 只在 `config.theme` 变化时跑；
  终端主题走 `requestAnimationFrame`；agent 主题同步只在有项目时发。

### 3.3 `themeHint.ts`（L3 首帧前注入）

- `ThemeHint = { theme: string; customThemeVariables: Record<string,string> | null }`。
- `readThemeHint()` / `writeThemeHint()`：localStorage，读写都吞异常（隐私模式 / 配额）；
  读取时校验结构，脏数据返回 null。
- `applyThemeHintBeforeRender()` 在 `bootstrap()` 中、`createRoot().render()` **之前**执行：
  有 hint 就写 `data-theme` + 自定义 CSS 变量；无 hint（首次启动/升级首启）沿用
  `:root:not([data-theme])` 的 dark 兜底，且此时 splash 尚未消失，加载完成后由
  `projectTheme` reconcile，不产生可见翻转。

### 3.4 `globalOwners.ts`（L2 唯一清单）

```
GlobalOwner = { id; phase: 'preRender' | 'reactHook'; start?: () => void | cleanup }
GLOBAL_OWNERS: readonly GlobalOwner[]
installGlobalOwners(): cleanup   // 只启动 phase='preRender'
```
- preRender（bootstrap 期，全部为普通函数，天然避开 StrictMode 双挂载）：
  `errorHandlers`、`webkitInputGuard`、`rendererAddons`、`newTabDockPolicy`、
  `themeHint`、`libraryChunkPreload`、`quickOpenTracking`、`scrollAutoHide`。
- reactHook：`liveSessionsBridge`。Hook 不能进普通函数循环，由 `useAppGlobalEffects`
  无条件调用一次，并在清单里显式登记（审计点不遗漏）。
- `bootstrap()` 保存 cleanup：`import.meta.hot?.dispose(dispose)` 处理 HMR；
  `registerGlobalErrorHandlers` / `installWebKitInputGuard` / `initScrollAutoHide` /
  `startQuickOpenActivityTracking` 的 cleanup 不再被丢弃。
- 新增 owner 只需在清单加一行；单测断言 id 唯一、preRender 都有 start、
  reactHook 恰为清单中登记的那一个。

### 3.5 `AppContext`（L4 只读）

- `AppContextValue.config: Readonly<AppConfig>`（原地写零处，settings 面板用 `{...config, x}`，
  类型兼容已核实）。
- 新增 `useConfig<T>(selector: (c: Readonly<AppConfig>) => T): T`，读侧唯一推荐入口。
- `saveConfig` 保持原签名（settings 面板传整份可变 `AppConfig`）；不把 `ConfigSaveInput`
  反向引进 `shared/`（避免 shared→features 依赖）。
- 至少一个消费者（`ViewSkillDialog`）改用 `useConfig(c => c.theme)` 示范。

### 3.6 护栏 `check_config_owner_singleton`

判据（生产 `src/**/*.ts(x)`，排除 `__tests__`）：
1. `useAppConfigOwner(` 调用点恰好 1 处，且落在 `src/app/hooks/useAppShellData.ts`；
   `src/features/**` 出现即违规。
2. `setAttribute('data-theme'` 只在 `src/app/bootstrap/configProjection.ts`。
3. `@/features/settings/index.ts` 不得导出 `useAppConfig` / `useAppConfigOwner`。
4. `useLiveSessionsBridge(` 调用点恰好 1 处（`useAppGlobalEffects.ts`）。
- `scanned` = 扫描的生产文件数（>0 由框架兜住）。自测含 4 个负例（多 owner、
  非投影模块写主题、barrel 漏出 owner、重复挂载 hook owner）。

### 3.7 mount-invariance 测试助手

`src/testing/mountInvariance.ts` → `expectNoGlobalSideEffectsOnMount(render: () => void)`：
记录 `data-theme` 与 `documentElement.style` 前后值，渲染后断言不变。
接入 `ViewSkillDialog.test.tsx`、`LibraryPanel.test.tsx`（≥2 处）。

## 4. 数据流

```
[首次启动]  localStorage(hint) ──bootstrap()──> data-theme + custom vars ──> CSS 首帧正确
                                      │
                              installGlobalOwners()  ← 唯一清单
                                      │
[React] useAppShellData ──唯一调用──> useAppConfigOwner ──load_config──> hydrated=true
                                      │                         │
                                      │                  projectTheme/Typography
                                      │                  ──> DOM / 终端 / agent 主题
                                      │                  ──> writeThemeHint(同步缓存)
                                      └─> AppContext(Readonly) ──> useConfig(selector) ──> consumers
[saveConfig] 唯一写点 ──> setConfig ──> 上述投影链重放（无第二 owner）
```

## 5. 兼容性与取舍

- **行为零漂移**：主题切换、自定义主题变量清理、字体 token、终端主题、agent 主题同步、
  LSP import strategy、config 保存/加载语义不变；仅新增 `hydrated` 门控与 splash 覆盖窗口。
- **不引入新 store / 框架**：`AppContext` 已是唯一读源；再加 `configStore` 是第二份事实，
  违反 KISS / 红线 17。owner 仍是 hook，但**唯一且私有**——这是「让第二 owner 不可表达」
  的最小充分改动。
- **不转换 `useLiveSessionsBridge`**：它是 React hook 且有 6 个依赖 StrictMode 语义的用例；
  转成普通函数的收益小于风险。它以 `reactHook` 形态登记进清单，审计不遗漏。
- **首启（无 hint）**：仍以 dark 兜底一帧，但 splash 覆盖 config 加载，用户不可见；
  第二次启动起完全无翻转。自定义主题的 hint 同样缓存变量表，不回退。
- **护栏口径边界**：只扫生产代码；注释里的名字、测试夹具、既有 `customThemeVars.ts` /
  `typography.ts` / `terminal.ts` 内部的 CSS 变量写入不在本护栏口径内（它们本就是单一职责
  写入模块，且被 `configProjection` 独家调用）。不过度声称。

## 6. 回滚形状

按 L0→L4 分步提交式实现（不实际 commit），每步独立 `check:quick`：
- L0 可单独回滚：把 owner 改回 barrel 导出 + 恢复 `useAppConfig` 名。
- L3 可单独回滚：删 `themeHint` 调用即可，不影响 owner 唯一性。
- L2 回滚：`bootstrap()` 恢复 4 个直接调用 + `useAppGlobalEffects` 恢复 3 个 effect。
- 全局回滚点：`git diff` 全量丢弃（工作树当前未提交，含上一轮局部修复，勿误丢）。

## 7. 文件清单（AC8 对账：生产模块 6 个，上限 ≤5 —— 超 1，理由见下）

**Round 1 设计值**（4 个 + 1 个迁移）：`app/bootstrap/globalOwners.ts`、
`app/bootstrap/configProjection.ts`、`app/bootstrap/themeHint.ts`、`src/testing/mountInvariance.ts`
（测试基础设施）、`app/hooks/useAppConfigOwner.ts`（由 `features/settings/hooks/useAppConfig.ts`
迁移，旧文件删除，净增 0）。`shared/contexts/AppContext.tsx` 内新增 `useConfig`（同文件）。
护栏 + 自测 2 个；新增测试 3 个、迁移测试 1 个。接口面净增仅 `useConfig` 一个读入口。

**Round 2 实际落地（本轮如实对账，不改 AC）**：净新增生产模块 **6** 个 ——
`app/bootstrap/configProjection.ts`、`app/bootstrap/globalOwners.ts`、`app/bootstrap/themeHint.ts`、
`app/hooks/useConfigProjection.ts`、`features/settings/api/customThemeResolver.ts`、
`shared/contexts/VisibilityScope.tsx`（`app/hooks/useAppConfigOwner.ts` 为迁移，`useAppConfig.ts`
已删，不计入）。相对 ≤5 上限**超 1 个**，超出的部分是 Round 2 审核修订的三个落点：

| 模块 | 是从哪里拆出来的 | 为什么值得多一个文件 |
| --- | --- | --- |
| `useConfigProjection.ts`（49 行） | 原 `useAppConfigOwner` 的投影半边 | IO/并发 与 投影 的变更理由不同；合回去 owner 会涨到 ~180 行，突破 `check_component_size` 的 135 ratchet |
| `customThemeResolver.ts`（41 行） | 原 `useAppConfig` 里的 ref 缓存 + `get_custom_theme` 调用 | 原子投影要求「先拿变量再提交主题」，解析（IO + 缓存）与写 DOM 不是一个变更理由 |
| `VisibilityScope.tsx`（30 行） | 新增（原本不存在） | 常驻挂载把 mount 副作用提前到启动期，「挂载 ≠ 可见」需要显式信号，接在 `AppContext` 里会让两个 context 共用一行 |

判断基准（`design.md` §1 第三条）：AC8 的本质是「不膨胀」——不新增 store 层 / 第三方依赖 /
读入口，这几条都达成（读侧净增只有 `useConfig`，写侧仍只有 `saveConfig`）；文件数量本身
在 AC8 里已声明「不是有效指标」，故本轮按**记录偏差**而非强行合并处理。

## 8. 审查修订（Round 2，2026-11）

第一轮实现通过验收后做了代码审核（neeko-check），以下**偏离原设计**的决定已落地并同步到
spec；本节是「设计 → 现实」的差异台账，实现理由都写进了对应模块头注释。

| # | 原设计 | 现在 | 理由（第一性原理） |
| --- | --- | --- | --- |
| 1 | `GlobalOwner = { id; phase; start? }`（`start` 可选，缺失静默跳过） | 判别联合：`preRender` 必带 `start`；`reactHook` 无 `start`，实现由 `Record<ReactHookOwnerId, () => void>` 适配器表接线 | 「声明了 preRender 却没给 start」必须编译期不可表达；清单 ↔ 实现靠类型对齐（tsc 判），不靠命名巧合 |
| 2 | 清单含 `libraryChunkPreload` | 删除 | `AppCenter` 启动即挂载 lazy `LibraryPanelWrapper` ⇒ 同一模块已被首次渲染拉取，idle 预载是同一目标的两个机制 |
| 3 | `bootstrap()` 返回 dispose + `import.meta.hot.dispose` | `bootstrap(): void`，不注册 HMR 清理 | 整图无 `import.meta.hot.accept` ⇒ 任何改动冒泡成整页 reload，清理钩子永不执行（死代码） |
| 4 | `customThemeVars.ts` 留在 `features/settings/`；`appConfigNormalize/appConfigSave` 在 `features/settings/hooks/` | 前者迁 `app/bootstrap/`（投影的 DOM 写助手）；后两者迁 `features/settings/api/`（公开面） | `app → feature 内部实现` 是反向耦合：app 只该依赖 feature 的公开面（`store/types/api`）；解析/合并是领域纯逻辑，`api/` 已有先例（`git/api/fileLineChange.ts`） |
| 5 | `projectTheme({theme, customThemeVariables})` 恒写 DOM | 三态原子投影，自定义主题缺变量时**什么都不写**并返回 `false`；`themeHint` 只在投影成功后回写；`applyThemeHintBeforeRender` 同样拒绝半套主题 | 主题 = 属性 + 变量表，分开写必然留一帧无配色；把半套主题写进首帧缓存 = 把错色搬到下次冷启动 |
| 6 | owner 一个 hook 承担 IO + 投影 | 拆出 `app/hooks/useConfigProjection.ts` | IO/并发与投影变更理由不同；同时把 owner 收回 ratchet 基线内（≤135 行） |
| 7 | 只解决「挂载间隙」 | 新增 `shared/contexts/VisibilityScope.tsx`，`LibraryPanel` / `SkillContent` 的 mount 拉取按可见性门控；删 `AppCenter` 的激活刷新 effect | 常驻挂载把 mount 副作用提前到启动期，从不打开 Library 的用户白付 IPC；「挂载 ≠ 可见」需要显式信号，且刷新只能有一个机制 |
| 8 | `initializing = sessionInitializing \|\| !hydrated`（无超时） | owner 内 3s 兜底退出加载态 | 同一关键路径上加了第二个阻塞源，必须配一个「IPC 悬挂」的出口，否则窗口永久停 splash |
| 9 | 护栏只认 `setAttribute('data-theme'`；hook owner 判「`hook()` 调用点」 | 增补 `dataset.theme =` / 反引号写法；hook owner 判「接线点（调用 or 适配器值引用）唯一」，`import`/`export` 不计 | 只认一种写法 = 给判据留后门；适配器表形态下没有 `hook(` 调用，判据要跟着实现形态走，而不是让实现迁就正则 |
| 10 | — | `useConfig` 拆两行 + 浅只读边界说明；`expectNoGlobalSideEffectsOnMount` 声明覆盖范围 | 可读性 / 不过度声称 |
