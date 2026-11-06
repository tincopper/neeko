# Implement：配置所有权唯一化与全局 owner 收口

> 顺序执行；TDD（Red → Green → Refactor）；**`pnpm check:quick` 只在收尾跑一次**，
> 例外仅 TDD 红绿反馈时跑单个测试文件。不主动提交代码。

## Step 0 · 基线确认

- [x] `git status` 记录当前 14 个未提交改动（上一轮局部修复 + 方案 A），全部纳入本任务，不丢弃。
- [x] `pnpm exec vitest run src/features/skill/components/__tests__/ViewSkillDialog.test.tsx src/app/components/__tests__/AppCenter.test.tsx src/features/library/components/__tests__/LibraryPanel.test.tsx` → 绿（确认起点）。

## Step 1 · L1 护栏先行（Red 优先，锁住目标态）

- [x] 写 `tools/guards/checks/check_config_owner_singleton.py` + 同名自测
      `tools/guards/tests/test_check_config_owner_singleton.py`（4 个负例）。
- [x] 此时目标态尚不存在，护栏应判 **VIOLATION**（Red）：
      `pnpm exec python3 -m unittest tools.guards.tests.test_check_config_owner_singleton -v`
      或 `pnpm guards run --only check_config_owner_singleton`（按可用 CLI）。
- [x] 护栏必须满足：id == 文件名、docs 指向存在的 spec、fix_hint 非空、scanned > 0。

## Step 2 · L0 owner 私有化 + 投影抽离

- [x] 新增 `src/app/bootstrap/themeHint.ts`：read/write `ThemeHint`（localStorage，容错 + 结构校验）。
- [x] 新增 `src/app/bootstrap/configProjection.ts`：
      `projectTypography` / `projectTheme` / `applyCustomThemeVars` / `applyThemeHintBeforeRender`；
      唯一 `setAttribute('data-theme')`。
- [x] 迁移 `useAppConfig` → `src/app/hooks/useAppConfigOwner.ts`（3 个相对导入改绝对），
      投影/字体/主题同步全部改调 `configProjection`；新增 `hydrated`。
- [x] `src/features/settings/index.ts` 删除 owner 导出。
- [x] `src/features/settings/hooks/__tests__/useAppConfig.test.ts` 改导入路径与 describe 名，
      补 `hydrated` 相关断言（加载完成/失败都置 true）。
- [x] `useAppShellData.ts` 改为唯一调用点；`initializing` 合入 `!hydrated`。
- [x] `ViewSkillDialog.tsx` 保持只读修复（上一轮成果），行数不回涨（ratchet 基线 325）。

## Step 3 · L3 首帧前主题注入

- [x] `globalOwners.ts` 的 `themeHint` 项在 `bootstrap()` 中先于 render 执行。
- [x] 单测：`bootstrap()` 后 `data-theme` == hint.theme；无 hint 时保持兜底；
      脏 hint 不抛错；`projectTheme` 会回写 hint。
- [x] 确认 `projectTheme` 受 `hydrated` 门控，不会用 DEFAULT_CONFIG 覆盖 hint。

## Step 4 · L2 owner registry 收口

- [x] 新增 `src/app/bootstrap/globalOwners.ts`：声明式清单 + `installGlobalOwners()`（保存 cleanup）。
- [x] `bootstrap.ts` 改为 `installGlobalOwners()` + `import.meta.hot?.dispose(...)`；
      保留「renderer 预热必须在任何终端创建前」的顺序契约（清单顺序即执行顺序）。
- [x] `useAppGlobalEffects.ts` 收敛为唯一 `reactHook` owner 适配器；
      quick-open / scroll-autohide / library preload 移入 preRender 清单。
- [x] 单测：id 唯一、preRender 都有 start、reactHook 恰 1、cleanup 可调用、
      `installGlobalOwners` 不重复启动。
- [x] `src/app/__tests__/bootstrap.test.ts` 按新契约更新。

## Step 5 · L4 只读接口

- [x] `shared/contexts/AppContext.tsx`：`config: Readonly<AppConfig>`，新增 `useConfig(selector)`。
- [x] `ViewSkillDialog.tsx` 改用 `useConfig(c => c.theme)`（1 行换 1 行，不回涨行数）。
- [x] `pnpm type-check` 隐式由收尾 `check:quick` 覆盖；留意 settings 面板 `{...config, x}` 仍合法。

## Step 6 · mount-invariance 助手与回归网

- [x] `src/testing/mountInvariance.ts` + 接入 `ViewSkillDialog.test.tsx`、`LibraryPanel.test.tsx`。
- [x] 保留并确认上一轮回归用例：`关闭态常驻不重写 data-theme`、`首进 Library 不重挂载`。
- [x] `PromptDialogHosting.integration.test.tsx` / `AppModals.test.tsx` 仍绿。

## Step 7 · 文档同步

- [x] `.trellis/spec/frontend/state-management.md`：owner 唯一性段落升级为完整契约（L0–L4）。
- [x] `.trellis/spec/frontend/hook-guidelines.md`：owner hook vs 只读 hook 的判据。
- [x] `.trellis/spec/frontend/quality-guidelines.md` / `component-guidelines.md`：护栏数量若从
      28 变 29，只改措辞不改门禁接线（A1/A3 由 `check_gate_topology` 保证）。
- [x] `docs/ARCHITECTURE.md` 的 Key Architectural Decisions 增一条（可选）。
- [x] 代码里所有「首次进入 Library 才挂载 / useAppConfig 是唯一调用方」等过期注释更新。

## Step 8 · 收尾验证（只跑一次）

- [x] `pnpm check:quick` → 37 条护栏全绿（改动 `tools/guards/**` 触发全量 lint 档）、改动文件单测全绿、eslint/tsc 绿。
- [x] 复核 AC1–AC8：
      `rg -n "useAppConfigOwner\(" src`、`rg -n "setAttribute\('data-theme'" src`、
      `rg -n "useLiveSessionsBridge\(" src`。
- [x] 护栏负例再跑一次：人为复制 owner 调用 → 必须红 → 撤销。
- [x] 报告覆盖面诚实：`check:quick` 只跑改动文件相关单测，全量由 push/CI 兜底。

## Step 9 · 审查修订（Round 2，2026-11）

- [x] 投影原子化：`projectTheme` 三态 + 返回 `boolean`；`themeHint` 只在成功后回写；
      `applyThemeHintBeforeRender` 拒绝半套主题。回归：`configProjection.test.ts`（缺变量分支）、
      `useAppConfigOwner.test.ts`（变量未到不换主题名 / 拿不到变量保留上一帧）。
- [x] owner 拆分：`useConfigProjection`（投影）与 `useAppConfigOwner`（IO + 并发）；
      owner 行数回到 ratchet 基线内（135）。
- [x] 公开面收口：`appConfigNormalize` / `appConfigSave` → `features/settings/api/`；
      `customThemeVars` → `app/bootstrap/`；删 settings barrel 的 `isBuiltinTheme` 导出。
- [x] owner 清单类型收口：判别联合 + `ReactHookOwnerId` + 适配器表（漏改由 tsc 判）；
      删 `libraryChunkPreload`；`bootstrap()` 去掉永不执行的 HMR dispose。
- [x] 常驻挂载可见性门控：新增 `shared/contexts/VisibilityScope.tsx`；
      `LibraryPanel` / `SkillContent` 按 `useVisible()` 拉取；`AppCenter` 删激活刷新 effect。
- [x] splash 兜底：`load_config` 3s 未返回即退出加载态（`useAppConfigOwner.test.ts` 假定时器用例）。
- [x] 护栏加固：`dataset.theme =` / 反引号写法也判违规；hook 型 owner 判「接线点唯一」
      （调用 or 适配器值引用；import/export 不计）。自测 12 条含 3 条新负例 + 1 条适配器正例。
- [x] 收尾：`pnpm check:quick` 全绿；`python3 tools/guards/run.py ... --source python` 35/35。

## Step 10 · 归档前复核（2026-11，AC 逐条验）

- [x] AC1–AC5 / AC7 机器复核：owner 调用点 1（`useAppShellData.ts:55`）、settings barrel 无 owner、
      `data-theme` 只写于 `configProjection.ts`（第 94 / 114 行）、`Readonly<AppConfig>` +
      `useConfig` 有消费者（`ViewSkillDialog.tsx:60`）、`globalOwners.test` 4 条。
- [x] 门禁实跑（工作区干净时 `check:quick` 会跳过，故跑等价全量 lint 档）：
      `guards --stage local --suite lint` **35/35**（含 `check_config_owner_singleton`，`scanned=1191`）；
      `pnpm lint:fe` → eslint **0 error**（14 warning 均为既有其它文件）、tsc `No errors`；
      相关 9 个测试文件 **79 passed**。
- [x] **AC6 补缺**：原 `configProjection.test.ts` 只 `vi.mock` 了 `updateAllTerminalThemes` /
      `syncAgentTheme`，**零断言**（终端主题与 agent 主题同步没有测试覆盖）→ 新增 4 条断言
      （rAF 合并后终端刷新 1 次 / 本地项目带 `local_paths` 扇出 / WSL 按 distro 扇出 / 无项目不扇出），
      并在「变量未就绪整体跳过」用例里加「下游不被惊动」两条否定断言。文件 8 → 12 例。
- [x] **变异验证**：删掉 `projectTheme()` 末尾的 `scheduleTerminalThemeRefresh();` 与
      `syncAgentThemeForKnownProjects(theme);` → 3 红（终端刷新 / 本地扇出 / WSL 扇出），
      恢复后全绿 —— 断言真的钉在实现上，不是自我安慰。
- [x] **AC8 对账**：净新增生产模块 6 个（上限 ≤5，超 1）。不改 AC，在 `prd.md` AC8 下写完成对账、
      在 `design.md` §7 补三个 Extract 的逐项理由（`useConfigProjection` 避免 owner 突破 135 ratchet、
      `customThemeResolver` 解析与写 DOM 是两个变更理由、`VisibilityScope` 是新增的「挂载≠可见」信号）。
- [x] spec 教训沉淀：`state-management.md` 投影段落补「下游扇出必须断言」（mock 不是覆盖）。

## Review gates / 回滚点

| 步骤 | gate | 回滚 |
| --- | --- | --- |
| Step 1 | 护栏自测含负例且当前判红 | 删两个新文件 |
| Step 2 | 单测 + `pnpm exec tsc --noEmit` | 恢复 barrel 导出 + 旧文件名 |
| Step 3 | bootstrap 单测 | 删 themeHint 调用 |
| Step 4 | owner registry 单测 + bootstrap.test | bootstrap 恢复 4 个直接调用 |
| Step 5 | type-check | `Readonly` 回退 |
| Step 8 | `pnpm check:quick` | 按步骤逆序撤销 |

## 明确不做

- 不 commit、不创建分支、不改 Rust、不改 CI/lefthook/`gates.json`。
- 不把 `useLiveSessionsBridge` 转普通函数。
- 不新增 `configStore` / 第三方依赖。
