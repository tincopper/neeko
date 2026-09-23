# Implement：执行计划（TDD 红→绿→重构）

> **状态（2026-09-23）**：Step 1–3 的**徽标方案已废弃**（见 `prd.md` 顶部状态说明与
> `design.md` 标题）；实际落地为 §5 的 v3 原型方案。Step 1–3 保留仅作决策留痕，
> 不再执行。
>
> 落地完成项（含实施期修正）：
> - §5 全部步骤已实现（`referencesPeek` / `referencesPeekStore` / `ReferencesPeekDialog`
>   / `ReferencesPeekPreview` / `AppShell` 挂载）。
> - **偏离 design §6.2 一处**：跳转出口由 `openProjectFile` 改为**注入端口**
>   `PeekNavigate`（`openProjectFile` 读不了 `jdt:/` 展示路径与项目外文件，且 jdt
>   tab 需要 `readOnly + virtualUri`）。详见 `design.md §2`。
> - 实施期修正（`neeko-check` 审核结论）：路径身份台账命中、弹窗焦点未落、
>   `openPeek` 迟到批次覆盖、`sameDocumentUri` 自造归一、`React.memo` 死导出、
>   `items`/`groups` 双数组手工不变式、截断后置、`isOnDefinitionSite` 闭区间。

## 0. 前置（硬闸门）

- [x] `prd.md` + `design.md` + 本文件已评审通过。
- [x] 用户明确说“可以开始实现”。
- [x] 执行 `python3 ./.trellis/scripts/task.py start`（status → `in_progress`）后再改码。

## 1. 有序清单（已废弃 — 徽标方案取消，本节不执行，仅作决策留痕）

### Step 1 — 纯函数 `referencePeek`（TDD）
- [ ] 🔴 新增 `src/features/lsp/api/__tests__/referencePeek.test.ts`：正常计数、`null`/空数组→`0`、抛错→`null`、参数透传（含 `includeDeclaration:true`）、jdt/null-uri 由调用方守卫（本函数只测透传与归一）。
- [ ] 🟢 新增 `src/features/lsp/api/referencePeek.ts` 最简实现（依赖注入 `request`，便于单测）。
- [ ] 🔵 重构：与 `useLspDefinition.toLspLocation` 的位置归一逻辑对齐，禁止第二份 `uri/range` 解析（DRY：复用或抽共享，选复用）。

### Step 2 — 徽标扩展接线
- [ ] 🔴 扩展 `useLspLinkHighlight` 测试：探针命中→徽标渲染、失败→无徽标、松开修饰键/移出→清除、点击徽标→调 `openFindUsages`（mock store）。
- [ ] 🟢 在 `useLspLinkHighlight.ts` 内新增独立 `Extension[]`（徽标 widget + 200ms debounce + latest-wins），definition 下划线逻辑零改动。
- [ ] 🔵 重构：确认 `useMemo` 依赖仅标量+稳定引用，扩展身份稳定（不触发宿主全量 reconfigure）。

### Step 3 — 点击→弹窗→跳转联调
- [ ] 点击徽标发显式 `findReferences`（独立请求）→ `openFindUsages({ locations, symbolHint })`；空结果弹窗 `No usages found`。
- [ ] 弹窗条目跳转复用 `confirm → openProjectFile → NavigateGoal`，不新增跳转函数。
- [ ] jdt 展示路径：`lspDocumentUri == null` 时不发探针不渲染徽标。

### Step 4 — 回归与清理
- [ ] 全量跑通既有 `useCmdClickGoToDefinition`、`lspHoverRouting`、`useLspDefinition`、`symbolNav` 相关单测。
- [ ] 无新增 `any`、无跨防火墙引用、无新事件字符串、无语言分支。

## 2. 验证命令

```bash
pnpm test:run -- src/features/lsp/api/__tests__/referencePeek.test.ts
pnpm test:run -- src/features/lsp src/features/editor/hooks/__tests__/useCmdClickGoToDefinition.test.ts src/features/symbol-nav
pnpm type-check
pnpm lint:fe
pnpm test:run
```

## 3. 风险文件与回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `src/features/lsp/hooks/useLspLinkHighlight.ts` | 扩展身份抖动致 CM reconfigure / 徽标残留 | 徽标扩展独立拼装，整段摘除即回退纯下划线 |
| `src/features/lsp/api/referencePeek.ts`（新增） | 位置归一与既有 `toLspLocation` 漂移 | 删除新增文件，前端行为回退到无徽标 |
| `src/features/editor/hooks/useLspNavigation.ts`（若动） | 依赖数组引入不稳定引用致 keymap 重建 | 只透传稳定回调；有问题先 revert 本文件 |

## 5. v3 原型落地执行清单（§6 设计）

> 前置：用户确认 §6 方案（新弹窗 vs 改造旧弹窗、V1 纯文本预览）后再开工。

- [x] 🔴 Step 1 — 分组纯函数测试（按 uri 分组保序、空输入、计数）→ 🟢 `referencesPeekStore` 分组实现
- [x] 🔴 Step 2 — store action 测试（多文件一次拉取去重、`allSettled` 单文件失败隔离、>200 截断）→ 🟢 实现
- [x] 🔴 Step 3 — 弹窗测试（分组渲染/片段高亮、`↑↓↵esc`、空态、200+ 截断提示）→ 🟢 `ReferencesPeekDialog`
- [x] 🟢 Step 4 — 接线：`AppShell` 并列挂载 + 定义处分支改调 `openPeek`（含 `navigate` 端口）
- [x] 验证：`pnpm lint` + `pnpm lint:fe` 全绿；回滚 = 定义处分支摘除即回退纯跳转 + 删新文件
