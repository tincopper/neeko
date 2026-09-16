# 调试源码身份唯一化 + 概念归属收敛（切片 3）

## Goal

把「同一份源码 / 同一个停点位置只有一种表示」这条不变式从**写入侧**（切片 1+2 已完成）推进到**比较与复用侧**，并收掉评审遗留的概念归属与订阅面问题。

一句话判据：**任何「这是不是同一个文件」的判定都必须落在 `FileRef` 身份上**，不允许消费侧自造字符串归一或别名匹配；同一概念的 `类型 + 构造 + 状态 + 使用` 收敛到单一归属模块。

## Background

### 来源

本切片出自 issue #13 的第一性原理根因分析所拆的 5 个切片（1 代际化 / 2 状态化 / **3 身份唯一化** / 4 视图唯一化 / 5 清理）。切片 1+2 已修掉 #13 的观测症状（见任务 `09-16-debug-stop-reveal`：`prd.md` / `design.md` / `implement.md`），并把**写入侧**统一为规范身份（`stackFrames.buildStopLocation` + `sourceIdentityOf` 单写者）。

本切片的条目有两个来源：
1. 原始分析里的 **P3（身份双口径）/ P4（tab 复用绕过身份抽象）** 在 1+2 后仍残留的部分；
2. neeko-check 评审（2026-09-16）遗留的 **F6 / F5**（用户决定并入本切片）与 **F3**（预期随本切片消解）。

### 现状证据（2026-09-16 核对）

- **tab 复用用裸字符串等值**：`src/features/runner/sourceTab.ts:75-78` 以字符串等值找既有 tab：
  ```ts
  .find((t) => t.data.filePath === identity)
  ```
  其中 `identity = sourceIdentityOf(root, path)`（规范身份）。
  **核实结论（重要，勿按旧说法引用）**：逐一核对了各 tab 生产者的入库形态 ——
  `quick-open/openFile.ts:34` 与 `editor/hooks/useFileViewTabOps.ts:46` 都经 `canonicalFsPath` 归一；
  markdown 内链经 `shared/utils/markdownLinks.ts` 的 `normalizePath` 折叠 `.`/`..`；LSP 目标经 `jdtDisplayPath`/`fromFileUri`；
  导航历史复用既有 tab 的形态；untitled 是合成 id（不与身份比较）。
  即**当前不存在「同一文件产出两种形态」的可复现输入** ⇒ 此前「会开出第二个 tab」的说法**未获证实，已撤回**。
  该条的真实内容是：**这是「各生产者各自产出同一规范字符串」的隐含约定，而非机制保证** ——
  没有编译期或测试期的手段阻止下一个新增入口（或历史恢复数据）偏离；而身份抽象 `FileRef` / `sameFile` 已经存在
  且被 LSP 路径正确使用（`editor/hooks/useLspNavigation.ts:102`），单点化是低风险、可验证的加固。
- **比较仍靠宽松别名匹配**：`src/features/editor/stopMatch.ts:16-25` 的 `debugPathsMatch` 用「末段同名 + 互为后缀」兜底（注释也自承「两侧都已是规范源身份」）。其第三分支经穷举验证**只在非规范输入**下可达（例：`'////a/ab'` vs `'/ab'`），与自述前提矛盾且零测试覆盖 → 即评审 F3（**已在 `09-16-debug-stop-reveal` 删除**，2026-09-16）。
- **既有正确先例（应照抄）**：`src/features/editor/hooks/useLspNavigation.ts:102` 的同文件判定走 `sameFile(fileRefFromTabPath(...), ...)`；身份抽象在 `src/shared/utils/fileRef.ts`（`fileRefFromTabPath:169` / `sourceIdentityOf:233` / `sameFile:289`）。
- **概念三分（F6）**：`StopLocation` 类型与构造在 `src/features/runner/stackFrames.ts:43`；状态对（`location` + `locationSeq`）在 `src/features/runner/store/debug/shared.ts:70`、`:81`；使用在 `src/features/runner/store/debug/stackSlice.ts`。`shared.ts` 是「叶子原语聚合」文件（命名即低内聚信号），新状态最自然的落点仍在它那里。
- **订阅面重复（F5）**：单视图 6 个 store 订阅槽 —— `src/features/runner/hooks/useStopLocation.ts:27`（内部已订阅 session + activeProjectId）、`src/features/editor/hooks/useDebugStopReveal.ts:45`、`src/features/editor/hooks/useCurrentLineHighlight.ts:28` 又各订阅一次。

### 审计范围（同类点，不许只修被指出的那一处）

「身份比较」与「路径归一」必须区分对待，本切片要求给出**结论表**：

- `src/` 下自造 `\` → `/` 归一的生产代码共 **28 处**（grep 口径：`replace(/\\/g, '/')`）。其中**大部分是合法的展示 / URL / 解析归一**（如 `ui/MarkdownPreview.tsx`、`shared/utils/browserUtils.ts`、`features/lsp/api/languageMap.ts`、`file/utils/*`）。本切片的判定义务是：逐处标注「这是**身份比较**（必须走 `FileRef`）还是**展示/解析归一**（合法，保留）」，并把身份比较类的全部改到同一条抽象上。
- 已确认的身份比较候选（起点清单）：`editor/stopMatch.ts`（`debugPathsMatch`）、`runner/sourceTab.ts`（tab 复用）、`git/components/gitlog/commitListUtils.ts:180`、`editor/breadcrumb.ts:38`、`file/utils/fileTreeUtils.ts:20`、`shared/utils/gitFileDecoration.ts:165`。

## Requirements

- **R1 身份比较单点**：所有「同一文件」判定改走 `FileRef`（`fileRefFromTabPath` + `sameFile`），禁止裸字符串路径等值、禁止消费侧自造别名匹配。落点：`sourceTab.ts` 的 tab 复用查找、`stopMatch.ts` 的匹配判定。
- **R2 tab 复用按身份（机制加固，非 bugfix）**：`sourceTab.ts` 找既有 tab 时在 `FileRef` 形态上比较，把「各生产者各自产出同一规范字符串」的**隐含约定升级为机制保证**；覆盖相对/绝对/JDK 缓存/jdt/virtual 各形态收敛到同一身份。
  ⚠️ **不得声称当前会产生重复 tab**（已核实撤回，见 Background）：本项的价值是「下一个新增入口不会悄悄偏离」，因此**没有可复现的 Red**。测试形态为 **characterization/防回归**：新增「同一文件的两种形态（如 `canonicalFsPath` 形态 vs `sourceIdentityOf` 形态）复用同一 tab」用例 —— 当前应**绿**；实施需在 PR 中如实写明「无 Red，属机制加固」。若实施中真的构造出可复现的第三形态输入，则改为先红后绿并补进本文档。
- **R3 匹配判定收敛**：`debugPathsMatch` 的宽松后缀比对收敛为身份相等（或保留「形态容错」但必须在 `FileRef` 之上，而非字符串后缀）。**注：F3（第三分支）已由任务 `09-16-debug-stop-reveal` 决策并删除**（2026-09-16），本项只剩「把比较换到身份形态」这一半。
- **R4 匹配策略单点**：黄线（`useCurrentLineHighlight`）与停点跟随（`useDebugStopReveal`）已共用 `resolveDebugHighlightLine`（切片 1+2 完成）；本切片要求其内部实现同步落在身份抽象上，不得出现「同一判定两套实现」。
- **R5 位置概念单一归属（F6）**：把「位置」的类型 + 构造 + 状态对收敛到单一模块。建议 `src/features/runner/store/debug/stopLocation.ts`（叶子，需在 `runner/__tests__/architecture.test.ts` 的护栏 10 白名单显式登记）；若判定应该与 `stackFrames.ts` 同住，需说明「store 侧状态对放 domain 纯模块」不引入反向依赖的理由。
- **R6 订阅面收敛（F5）**：编辑器侧读取停点/会话状态收敛为一次订阅（方向：`useStopLocation` 一并返回 `status`，或在 hook 层订阅一次后透传），使单视图的 debug/project 订阅槽从 6 降到 2。⚠️ 若切片 4（视图唯一化）先行，本项在视图唯一化后收敛更省事 —— 实施前先确认两者顺序，避免做两遍。
- **R7 不得回退切片 1+2 的不变式**：位置单写者（`buildStopLocation`）、原子写（帧/选中帧/位置/序号同一次 `set`）、代际守卫（`isSameGeneration`）、用户接管语义保持不变；`stackSlice` / `navigate` 的既有用例（T1–T12、T3-tab、T3-cursor）必须继续绿。
- **R8 覆盖率门槛**：本切片涉及的模块按 `vitest.config.ts` 的分层阈值执行（纯函数 100%、机制/策略 ≥80%）；新增的叶子模块（如 `stopLocation.ts`）须同步加入阈值清单。测试须遵循 `unit-test/frontend-testing.md` §9（竞态/交错用例不得假绿）。
- **R9 非功能**：无 Rust 改动、无新 Tauri 命令、IPC 不变；跨 feature 只经门面（`.eslintrc.cjs` 的 firewall 与 sliceZones 不得为本次改动放宽）。
- **R10 身份构造点完备（本轮追加，用户定调「一个功能一步到位」）**：`FileRef` 的**值域必须等于真实身份种类集合**，
  使身份函数**全且幂等**（`id(id(x)) === id(x)`）。具体：`dap-source:`（适配器虚拟源码）纳入文法 ——
  `fileRefFromTabPath` 解析、`tabIdentityOf` 反向渲染、`sameFile` 增 virtual 分支、`lspUriOf` 返回 `null`、
  `virtualSourceIdentity` 迁入身份所有者。随之**删除**为绕该洞而设的权宜（`resolveDebugHighlightLine` 的
  `tabFilePath` 参数与回退分支），并**全域排查同因同类点**（`openFile` 的拼根、`recentFilesStore` 去重键、
  第三处 #14 门控）。
- **R11 评审遗留收口**：F4 门控单点（`isSessionVisibleFor`）、F5 tab 复用比较带 `projectRoot`（`sameFileAt`）、
  F6/F9 注释归位、F8 测试工厂抽取（`createStackFrame`）。

## Out of Scope

- **切片 4 视图唯一化**（`FileViewer` 只渲染本 group 的 tab + `MountRegistry` 选举唯一兑现者）；**切片 5**（用户意图槽有序化、`editorRestoredRef` 时序分支拆除）。
  （原计划的「切片 3.5 身份构造点完备」**已并入本切片**作为 R10 —— 它与切片 3 是同一条不变式，不该另开任务留个 `debt`。）
- **F2 的行为决策**（`useDebugStopReveal` 越界语义）—— **已由任务 `09-16-debug-stop-reveal` 拍板为「拒绝放置」并落地**（2026-09-16），不在本切片范围。
- 与 #13 无关：Java 后端选择、SSH 端口转发、求值 / HCR。
- 全部 28 处路径归一的**重写**：仅处理「身份比较」类，展示/URL/解析类归一只做标注（避免为一致性做无收益改动）。

## Acceptance Criteria

- [x] R1/R2：`sourceTab` 的复用查找走 `FileRef`（经 `sameIdentity`）；新增「同一文件两种形态复用同一 tab」characterization 用例（改前**红**：字符串等值漏判会开第二个 tab；如实标注：该输入当前无生产者，属机制加固护栏）；既有 `navigate.test.ts` 的身份归一 / 复用用例语义逐条核对通过。
- [x] R3：`debugPathsMatch` 委托 `sameIdentity`；「互为后缀」容忍已删，「两侧规范身份」写成前置条件，并新增「不再做相对/绝对混比」契约用例（改前**红**）。注：原 Acceptance 的「第三分支要么删除要么保留」二选一 —— 该分支已在切片 1+2 删除，本项落的是「换到身份形态」。
- [x] R1（审计）：产出路径归一的**结论表**（`research/identity-audit.md`）。**第二轮复审订正了第一版的错误计数**：第一版声称「28 处 / 4 身份 + 24 合法」，实测（`git show HEAD` 逐 blob 计数）为 **36 处 / 24 文件**，表格覆盖 ≈31，有 3 文件 5 处**完全未分类** —— 其中 `useBrowserTab.ts` 正是同一个 bug 的孪生副本。订正后口径为 **6 处身份比较**（5 处已收敛 + `recentFilesStore` 去重键 1 处低危记录）。教训已写入审计头部：**口径写成叙述 = 没执行，必须写成可跑命令**。
- [x] R4：黄线与停点跟随共用 `resolveDebugHighlightLine`（切片 1+2），其内部判定已随 R3 落在身份抽象上 —— 单点判定 + 实现委托，无「同一判定两套实现」。R6 后两者还共用**同一个输入面**（`useStopLocation`），判定与输入都不再各写一份。
- [x] R8（R2/R3 部分）：`vitest.config.ts` 同步 —— `fileRef.ts` 新增条目（lines 100 / statements 98 / functions 100 / branches 95，按实测地板；缺口来自 jdt/LSP 解析的既有分支）、`stopMatch.ts` 抬到 100 全项（补 `tabFilePath` 回退、`line < 1`、`starting`/状态缺省三组用例后实测 100）；新增 glob 已按仓库既定 `101` 负向跑验证会拦下文件。`pnpm test:coverage` 全量零 ERROR。
- [x] R5：位置概念的 `类型 + 构造 + 状态对` 收敛到单一模块 —— **落点改为域层叶子 `src/features/runner/stopLocation.ts`**（PRD 原建议 `store/debug/stopLocation.ts` 被否：那会让域层 `stackFrames.ts` 反向 import store 内部件）。依赖方向 `store/debug/* → stopLocation.ts → fileRef.ts`，单向无环（`stackFrames.ts` 为兄弟模块，仅依赖 `runner/types`，不参与该链）。副作用：**未在 `store/debug/` 新增文件 ⇒ 护栏 10 白名单无需改动**（不硬塞文件进白名单凑 AC）。新增 `runner/__tests__/stopLocation.test.ts`（构造 9 例 + 状态对 4 例），`stopLocation.ts` 覆盖率 100/100/100/100 并写入阈值清单；`stackFrames.test.ts` 收窄为只测帧选择。
- [x] R6：编辑器侧停点输入收敛为**单视图 2 个订阅槽**（debug 1 + project 1）。`useStopLocation` 用一次 `useShallow` 选择器取齐「位置 + 序号 + 会话身份 + 状态」并一并交出 `status`，`useDebugStopReveal` / `useCurrentLineHighlight` 不再各自调 `useVisibleDebugSession()`（`useVisibleDebugSession` 仍服务 DebugPanel / DebugRunButton / DebugItem，未删）。可复现断言 = `architecture.test.ts` **护栏 12**（源码扫描，两条：消费者零 store 读取、输入面恰好两次读取）—— 改前 **Red**（`expected [ …(2) ] to deeply equal []`、`expected 2 to be 1`）。为何用结构断言而非行为断言：React `useSyncExternalStore` 会按 `subscribe` 去重，多个 selector 运行时只产生一条订阅，行为测不出差别，而「门控有几处」是结构属性。T6–T10（`useDebugStopReveal.test.ts`）保持绿。
- [x] R7：`pnpm test:coverage`（432 文件 / 3699 通过 / **零 ERROR**，分层阈值全过）、`pnpm lint:fe`（同规模，无类型错误）、`pnpm lint`（Rust fmt + clippy + java-host）全绿。
- [x] R10：`dap-source:` 纳入身份文法（B-full）。**先提 5 条 Red**并逐条在改前实证失败：
  ①`sourceIdentityOf(root, v) === v`（幂等，实测 `/repo/dap-source:/42/Foo.java`）②`tabIdentityOf(fileRefFromTabPath(root,v)) === v`
  （互逆）③`lspUriOf(...) === null`（实测 `file:///repo/dap-source:/42/Foo.java`）④端到端（`stopReveal.integration.test.ts`：
  虚拟帧 → tab 身份 `dap-source:/9/f9` → `absFilePath === location.identity` → **单参数**跟随命中）⑤`sameFile` virtual 分支
  （元组比较与 name 归一）。实现后 5 条全绿。改造面实测 5 处 + `virtualSourceIdentity` 迁入所有者。
- [x] R10 收口：删除 `resolveDebugHighlightLine` 的 `tabFilePath` 参数与回退分支（连带 `useEditorBreakpoints` 的 `filePath`
  参数、`FileEditor`/`useEditorViewSnapshot` 两处调用）—— **删除后全量 432 文件 / 3714 用例零失败**，证明该分支已不可达。
- [x] R10 同因同类（全域排查）：`openFile` 改走 `sourceIdentityOf`（伪路径 tab，3 条 Red）；`recentFilesStore`
  去重键改走 `sameIdentity`（2 条 Red）⇒ 守卫 `debt 0`；`useEditorViewSnapshot` 的**第三处** #14 门控统一。
- [x] R11：F4（`isSessionVisibleFor`，3 处共用 + 4 条直测 + 覆盖率条目 101 负向体检）/ F5（`sameFileAt` + `ensureSourceTab`
  收 `projectRoot`，Red：相对形态 tab 复用）/ F6（`sameFile` doc 归位，模块头边界集更新）/ F8（`createStackFrame` 收敛 4 处工厂）/
  F9（`shared/debug` 依赖方向注释）。
- [x] R7（终版）：`pnpm test:coverage` 434 文件 / **3730 通过** / 1 skipped / **0 ERROR**；`eslint src` 0 error；`tsc` 干净；
  两个新守卫（口径台账 + 字节断言）均 exit 0。
- [x] 全程 TDD：R2/R3/R6 均有在**改造前**代码上验证的真红（R2 `expected [ {…}, {…} ] to have a length of 1 but got 2`；R3 `expected true to be false`；R6 护栏 12 `expected [ …(2) ] to deeply equal []` 与 `expected 2 to be 1`）。**R5 是纯搬迁重构**（类型/构造/状态对换模块，行为不变）—— 按重构纪律保持既有用例全程绿，不伪造 Red；其新增的 `stopLocation.test.ts` 覆盖的是既有行为（构造 9 例 + 状态对 4 例，此前零直接覆盖）。
- [x] 附带修复（审计所得，均真红）：`HtmlPreview.tsx`（**恒定缺陷**：`file-changed` 生产者给项目相对路径，原比较恒不命中 ⇒ 预览永不自动刷新）、`useBrowserPanelEvents.ts`（事件回退绝对路径时拼成 `/repo/repo/...` ⇒ 面板不刷新）、`useBrowserTab.ts`（**与前者同一 bug 的孪生副本，第二轮复审补修**）、`useFileTabRefresh.ts`（与前三者口径不一）。四处统一收敛到 `pathsContainFile`，新增用例逐个实证过「改前为红」。
- [x] 复审修复（`/neeko-check` 第三轮）：F1 = `useBrowserTab.ts` 漏修（同因同类）已修并补 4 例；F7 = 生产者两种形态（相对 / **绝对回退**）与「根尾斜杠 / 重复斜杠」在三个消费方各补齐，`useBrowserPanelEvents.test.ts` 中标题与输入不符的用例已订正。
- [x] 复审记录：F3 = **`dap-source:` 不在身份文法内 ⇒ `sourceIdentityOf` 对虚拟身份不幂等**（实测 `'/repo/dap-source:/42/Foo.java'`）—— 已连同三条后果、两个候选修法与推荐（A 不透明透传）写入审计 §六「已知洞」，作为**独立切片**执行（需自己的 Red，会触及 LSP uri 推导面），不在本切片顺手改。

## Notes

- **前置**：切片 1+2 已提供「位置单写者 + 规范身份」，本切片只改**比较与复用**，不需要重新设计停点状态机。
- **依赖顺序**：R6 与切片 4 重叠（视图唯一化后订阅面天然减少）；实施前先定序，避免同一处做两遍。
- **台账来源**：本 PRD 的指针均于 2026-09-16 对照代码核对；引用 `09-16-debug-stop-reveal` 的 `prd.md`（Out of Scope 切片 3 条目）/ `design.md`（§6 残留表）/ `implement.md`（评审修复块）。
- **核实义务（本条 PRD 的教训）**：「X 会导致重复 / 错乱」这类断言，写进文档前必须核对**所有生产者**的产出入库形态，否则会把「约定」误报成「缺陷」。本切片原本的第一条即因此被撤回并改写 —— 保留这段记录，供后人复核而不是照抄。
- 轻量起步：本 PRD 可直接开工；若实施中发现 R2 牵连面大（历史 tab 形态、会话恢复、worktree），再补 `design.md` 与 `implement.md`。
