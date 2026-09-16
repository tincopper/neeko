# 执行计划：调试停点跟随（切片 1+2，T1–T11）

> 拆解原则（三轮复核确定）：
> 1. **纯函数先行**：S1 全是零行为变化的新增（代际类型 + 位置构造 + 测试夹具），最便宜且被后续所有步骤复用。
> 2. **每步的 Red 必须真能红**：T1 / T3 / T11 必须用 `deferred` **反转 resolve 顺序**构造真实交错，禁止用 `await` 顺序、`sleep` 或「先新后旧」的调用次序伪模拟（那只能测到 happy path）。
> 3. **提交边界 = 自洽可用状态**：`S3` 与 `S4` 之间存在跳转能力真空（旧写入已删、新派生未接）⇒ **禁止 S3 单独合入**；`S1+S2` 一 PR，`S3+S4+S5` 一 PR。
> 4. **断言面跨机制稳定**：症状级用例（T3）断言 `editorStore` 的「活动 tab / 光标行」，该断言面在改造前后都存在，因此能在旧机制上真红、在新机制上真绿。
> 5. **PRD 用例修订 3 处**（详见文末「用例修订记录」）：T2 增「订阅快照无中间态」；T3 拆为 `T3-tab`（S3 绿）与 `T3-cursor`（S4 绿）；T7 与 T3-cursor 共用同一交错夹具但断言不同（幂等自愈 vs 最终收敛）。

## 执行状态

| 步 | 状态 | 说明 |
|---|---|---|
| **S1** | ✅ 完成 | `stopGeneration.ts`（8 例）、`buildStopLocation`（9 例）、`src/testing/async.ts`（S3 由 `deferred.ts` 更名并补 `flushMicrotasks`）。附带：`virtualSourceIdentity` 从 `sourceContent.ts` 迁到 `stackFrames.ts`（避免纯函数模块依赖 IPC 层）；`drainLoop` / `useFileStore` 两处内联 `deferred` 收敛到共享夹具；架构护栏 10 白名单登记 `stopGeneration.ts`（叶子）。 |
| **S2** | ✅ 完成 | 代际守卫（T1）+ 原子写（T2）+ 切帧同代际/规范身份（T4）+ 清空路径（T5）全绿；`stoppedAt`→`location`、新增 `locationSeq` / `generation` / `beginStop`；`withStopLocation` 统一「位置 + 序号成对更新」；`endedSessionPatch` 增位置状态参数。实现中发现并修回一处自引入回归：`dapVariables` 失败必须**只记日志**（旧行为），否则会被外层当成「栈刷新失败」触发重试。另：启动失败路径补 `generation: null`（无会话 ⇒ 无有效代际）。 |
| **S3** | ✅ 完成 | `navigate.ts` 重构：核心 `ensureSourceTab`（只做 tab 生命周期，`canCommit` 落地许可）+ 用户意图入口（`openSourceAtLine` / `openVirtualSourceAtLine`，保留一次性跳转目标）+ 停点入口 `ensureStopSourceTab`（不写跳转目标）。`stackSlice` 两个路径（自动停点 / 点栈帧）统一经它，许可分别是「代际」与「仍选中该帧」；`DebugFramesColumn` 收敛为只调 `selectFrame`；`DebugBreakpointsPane` 改走用户意图路径；删除 `openStopSource.ts`。用例：navigate 8 例 + T11 链级 + `stopReveal.integration.test.ts`（**不 mock navigate** 的症状级回归）。 |
| **S4** | ✅ 完成 | `editor/stopMatch.ts`（匹配策略抽出，黄线与光标共用）；`runner/hooks/useStopLocation.ts`（公开只读面，含 #14 门控 + 引用稳定性）；`editor/hooks/useDebugStopReveal.ts`（派生 + 幂等重放 + 用户接管惰性判定 + 释放分支）；`useCurrentLineHighlight` 收缩为纯黄线（删 `releasePlacedCaret` 注入）；`FileEditor` 装配；`editorStore` 删 `PendingNavigateTarget.debug`。用例 T6–T10 + `useStopLocation` 5 例 + `stopMatch` 7 例 + T3-cursor 端到端接线。**S3+S4 合起来使停点跳转重新可用（真空闭合）。** |
| **S5** | ✅ 完成（仅差真机验收） | 死代码 / 注释同步（S3/S4 已顺带完成）；`pnpm lint` 全绿（cargo fmt + clippy、4 个护栏脚本、java-host tests OK）；`pnpm lint:fe` 全绿（429 文件 / 3647 测试 / 0 type errors）；spec 回写两条经验：`frontend/state-management.md` 新增「场景：停点跟随（异步链代际守卫 + 跟随改为派生状态）」+ 常见错误 #12，`unit-test/frontend-testing.md` 新增常见错误 #9（竞态用例的假绿）；会话记录写入 `workspace/tincopper/journal-4.md`（session 206）。**剩余：真机验收（下方清单，需人工）。** |
| **S5** | ⏳ 未开始 | — |

## 评审修复（neeko-check 2026-09-16）

neeko-check 从「第一性原理 + 高内聚/低耦合/可扩展」审出 6 项，本次落地 F1 与 F4：

* [x] **F1 拆 `navigate.ts`（304 行 / 4 类职责）+ 移出 `activeProjectPaths`**：按职责拆为三层 ——
  `sourceOpen.ts`（83 行，**纯函数**：源引用 → 打开请求，可 100% 单测）、
  `sourceTab.ts`（124 行，**机制**：请求 → tab 存在并激活 + 环境读取 `targetTabKey`/`resolveProjectPath`）、
  `navigate.ts`（128 行，**策略**：三类入口的意图语义）。`activeProjectPaths` 只有
  `DebugBreakpointsPane` 一个消费者（非响应式 project 读取），按 YAGNI 内联进该组件，未新造共享工具。
  公开 API（`openSourceAtLine` / `openVirtualSourceAtLine` / `ensureStopSourceTab`）与类型不变 ⇒ 测试零改动。
* [x] **F4 覆盖率工具链**：安装 `@vitest/coverage-v8@4.1.2`（此前 `provider: 'v8'` 无对应依赖，`pnpm test:coverage`
  直接 `MISSING DEPENDENCY`），`coverage/` 加入 `.gitignore`；在 `vitest.config.ts` 写入**分层阈值**并实测校准：
  全局回归地板（stmts 54 / branch 47 / funcs 48 / lines 55，实测 55.6/48.9/49.4/56.7，目标 80）+ 本次改造的
  8 个模块按策略线抬高（纯函数 100%、机制/策略 ≥80%）。
  **闸门真实性已验证**：临时把 8 个 glob 全设为 101 跑负向 —— 8 个文件全部按名被拦下（证明 glob 真匹配，
  不是装饰性条目）。
* [x] **F5 / F6 → 并入切片 3（用户 2026-09-16 决定）**：已建任务目录 `.trellis/tasks/09-16-debug-source-identity`（PRD R1–R9 + 审计范围 + 验收）。不在本任务就地修，改由切片 3
  「身份唯一化 + 概念归属收敛」承接 —— 具体指针与收敛方向已写入 `prd.md` 的 Out of Scope
  与 `design.md` §6 残留表（F6 位置概念三分；F5 单视图 6 个订阅槽，若切片 4 先行可在视图
  唯一化后一并收敛）。
* [x] **F2 已拍板并落地：拒绝放置（不钳到末行）**。依据：`resolveDocPos` 是钳制语义，真越界
  （源码与二进制不一致 / tab 内容陈旧）时会落到末行，而 `flashNavLineEffect` 与 `currentLineDecoField`
  都因越界丢弃装饰 ⇒ 用户看到「光标停在末行 + 无高亮」= 像是跳错了。改为：`stop.line > doc.lines`
  时**不放置、不记账**，只 `console.warn('[debug] stop line is beyond the document', …)` 留诊断线索
  （VS Code / IntelliJ 在此场景同样不伪造行号）。用例 `[T13]`；已用「临时移除守卫」验证真红
  （`expected 223 to be +0` —— 223 正是钳到末行后的光标位置）。
* [x] **F3 已拍板并落地：删除第三分支**。依据：穷举（251 候选 / 63001 对输入）显示该分支只在
  **非规范输入**（`'////a/ab'` vs `'/ab'`）下可达，与模块自述前提矛盾且零覆盖；另一条候选路
  （把 `normalizePath` 补成折叠重复斜杠）会引入**第二个 normalizer**（还需处理 UNC `//host` 前缀），
  正是切片 3 要审计的同类问题，且该处将由 `FileRef/sameFile` 接管 ⇒ 取 KISS：删分支 + 把
  「两侧均为规范身份」写成前置条件（模块头注释）。
* [x] **第二轮评审 F7 已修（F1 的自留残渣）**：`sourceTab.ts` 曾声明但不消费 `targetTabKey` /
  `resolveProjectPath`（唯一消费者是 `navigate.ts`）。已把两者下沉到入口层 `navigate.ts`
  （同层职责：入口的共同输入解析），并按 YAGNI 注明「出现第二个消费者再抽独立模块」。
  `sourceTab.ts` 124 → 111 行、`navigate.ts` 128 → 147 行；补一条空 `projectId` 守卫用例覆盖
  新迁入的三元分支。
* [x] **第二轮评审 F9 已修（注释与实现不符）**：① `sourceTab.canCommit` 的 JSDoc 只提「await 之后」，
  实际还有入口早检 —— 已写明**两处校验**及各自作用；② `stopMatch` 头注释说「只做斜杠形态兜底」，
  实际还允许「互为后缀」（绝对 vs 相对）—— 已把两条容忍显式列出并声明「此外没有别的兜底」。
* [x] **并发改动归属已确认 + 按选项 A 收口（2026-09-16）**：
  - **归属**：`stackSlice.ts` 的 `generationAtSelect` 守卫**非本会话作者**。证据：`find src -newermt` 显示 12:26 后仅 3 个文件被写（2 个是我的 F8），该文件 12:33:44 → 12:33:56 两次写入后静止；我自 S2 起未再编辑它；进程表里除我的 `codebuddy` 外只有 **Zed + `@github/copilot-language-server`**；Trellis 无新会话文件、该改动**无配套测试** ⇒ 指向 IDE（Zed/Copilot）侧编辑，无法进一步区分手改 vs Copilot。
  - **收口内容**：新增 `stopGeneration.stopContextUnchanged(current, captured)` —— 与 `isSameGeneration` 的唯一差别是「**双方皆无代际**」判为**未变**（它按定义判为非同一代际）；`selectFrame` 两处复查改用它。原本直接用 `isSameGeneration` 会让未过 `beginStop` 的停止态（attach 到已暂停进程 / 测试 seed frames+session）**静默不写变量、不打开源码 tab**。
  - **双向反证（两个新用例都不是摆设）**：回到外部作者的原始形态 → `[T14]` 红（`expected [] to deeply equal [{name:'v', value:'kept'}]`，即变量被静默丢弃）；把守卫改成恒真 → `[T15]` 红（`expected [{name:'stale'}] to deeply equal []`，即迟到变量被写入）。恢复后 46 例全绿。
  - **备案**：PR-2 的 diff 因此含**两位作者**的内容（外部编辑 + 我收口），提交信息需注明，便于日后 `git blame` 有据。
* [x] **第三轮评审 F11 已修（2026-09-16）**：新增 `FileEditor` **组合冒烟测试**
  `editor/components/__tests__/FileEditor.compose.test.tsx`（4 例）—— 断言 CodeMirror 真实挂载、
  `useLspClient` 入参、**两段式晚绑定**（`bind(navigateToLocation, ctx)`）、卸载解绑、交互态光标样式
  （`cmd-held` / `lsp-jumping` 两分支）、二进制兜底分支不实例化编辑器、菜单条件渲染。
  效果：`useFileEditorLsp.ts` **0 → 100/100/100/100**；`FileEditor.tsx` **0 → 95.23 行 / 90.9 语句**
  （分支 69.23 与函数 50 的缺口是「作为 props 传递但未被调用的内联回调」，其行为归属各自 hook 的测试）。
  两者已加入 `vitest.config.ts` 阈值清单（hook 全门控、组件只门控行/语句，理由写在配置注释里）。
  **冒烟测试第一次运行就抓到两条隐式依赖**：`useEditorSave → useActiveProject` 需读 `project.environment.type`
  （手搭最小 project 会抛）、组合层还需 `AppProvider` 上下文 —— 正是这类「装配隐式契约」此前零覆盖。
* [ ] **第二轮评审 F8（已修，保留原文备查）**：`FileEditor.tsx` 290/300 行，余量 10 —— 建议抽走一块装配（如 run/debug 或
  reveal 组合 hook）后再给该文件加任何东西；属「组合层瘦身」，可独立小任务或并入切片 3/4。
* [x] **第二轮评审 F10 已修（2026-09-16）**：越界告警按「**同一事件只报一次**」去重（键 `identity#seq`，模块级只记最后一条键 —— 零状态增长、无需容量控制）。**不等切片 4**：切片 4 只能消除「多副本」这条轴，「同一事件重放（`viewEpoch` 变化）」那条它管不到；且该告警是本轮新引入的诊断，新债自己还。用例 `[T16]`（两个 view 同挂载 → 只报一次）+ `[T13]` 扩展（同 seq 重放不重复报、新 seq 仍报）；已用「撤掉去重」验真红（`expected "warn" to be called 1 times, but got 2 times` ×2）。
* 另见评审新观察：`vitest.config.ts` 不在 `eslint src/` 范围内（改动前后均为 11 个既有格式错误，
  本改动未新增）；`openVirtualSourceAtLine` 目前**无生产消费者**（用户意图打开虚拟源码的路径
  尚不存在），保留与否待定。

## 步骤总览

| 步 | 目的 | 对应用例 | 出口 | 提交边界 |
|---|---|---|---|---|
| **S1** | 纯函数地基 + 测试夹具 | —（新增纯函数用例） | 纯新增、零行为变化 | PR-1 |
| **S2** | store 代际化 + 位置单写者 + 原子写 | T1 / T2 / T4 / T5 | 旧 pending 机制仍在，行为不真空 | PR-1 |
| **S3** | `navigate` 拆分 + 调用点收敛 | T11 / T3-tab | 无 pending 写入；tab 生命周期独立 | PR-2 |
| **S4** | 幂等兑现（派生 + 重放） | T6 / T7 / T8 / T9 / T10 / T3-cursor | 跳转由派生链承担，症状消失 | PR-2 |
| **S5** | 收尾、全量回归、上机验收 | 全部回归 | 可交付 | PR-2 |

## 用例 ↔ 步骤 ↔ 文件 ↔ 断言面

| 用例 | 步骤 | 测试文件 | 断言面 |
|---|---|---|---|
| T1 代际守卫 | S2 | `runner/__tests__/debugStore.test.ts` | store：`frames` / `selectedFrameId` / `location` |
| T2 原子写 | S2 | 同上 | `store.subscribe` 快照序列 |
| T4 切帧同代际 | S2 | 同上 | store：`generation` 未变 + `locationSeq+1` + 规范身份 |
| T5 清空 | S2 | 同上 | store：`location=null` + `locationSeq+1` |
| T11 过期不抢激活 | S3 | `runner/__tests__/navigate.test.ts` + `debugStore.test.ts` | `editorStore.addTab/activateTab` 调用次数 |
| T3-tab 症状（tab） | S3 | `runner/__tests__/stopReveal.integration.test.ts`（新） | `editorStore.tabs[tabKey].activeTabId` |
| T6 命中 | S4 | `editor/hooks/__tests__/useDebugStopReveal.test.ts`（新） | headless view：`selection.main.head` / `doc.lineAt` |
| T7 幂等自愈 | S4 | 同上 | 同上 + `caretBeforeDebug` 记录次数 |
| T8 用户接管 | S4 | 同上 | 同上 |
| T9 释放 | S4 | 同上（由 `useCurrentLineHighlight.test.ts` 迁移） | 同上（还回旧光标 / 不动） |
| T10 不误伤 | S4 | 同上 | dispatch 计数 = 0 |
| T3-cursor 症状（光标） | S4 | `stopReveal.integration.test.ts` | 挂载 view 的最终光标行 = L2 |
| — 门控与引用恒等 | S4 | `runner/hooks/__tests__/useStopLocation.test.ts`（新） | hook 返回值与引用 |

---

## S1 纯函数地基 + 测试夹具（零行为变化）

* [x] `src/testing/async.ts`：`deferred<T>()` + `flushMicrotasks()`（runner/editor 两侧交错用例复用；不放进被测代码）。
* [ ] `src/features/runner/store/debug/stopGeneration.ts`：`StopGeneration` / `nextGeneration` / `isSameGeneration` / `resetGenerationSeqForTest`（design §2.1）。
  * [Red] 新建 `stopGeneration.test.ts`：`nextGeneration('s1').seq < nextGeneration('s1').seq`、跨 sessionId 不相等、`null` 永不相等 → 因模块不存在而失败。
  * [Green] 实现后同用例通过；`resetGenerationSeqForTest` 保证用例独立（每个用例前重置）。
* [ ] `src/features/runner/stackFrames.ts` 增 `buildStopLocation(frame, projectRoot)`（唯一位置构造点）。
  * [Red] 扩 `__tests__/stackFrames.test.ts`：① `sourcePath` → `sourceIdentityOf` 规范身份（含 JDK 缓存路径 → `jdt:/…`）；② `sourceReference>0` → `virtualSourceIdentity`；③ 两者皆无 → `null` → 函数不存在而失败。
  * [Green] 实现后通过；确认 `pickStopFrame` 既有用例不受影响。
* 验证：`pnpm test:run -- src/features/runner/store/debug src/features/runner/__tests__/stackFrames.test.ts` + `pnpm type-check`。

## S2 store 代际化 + 位置单写者（T1/T2/T4/T5）

依赖：S1。**本步只改 store 与消费点，不改跳转机制。**

* [ ] **[Red] T1 代际守卫**（`debugStore.test.ts`）：用两个 `deferred` 的 `dapStackTrace`（gen1 挂起、gen2 挂起）→ **先 resolve gen2、再 resolve gen1** →
      `await` 两条链 → 断言 `frames` / `selectedFrameId` / `location` 全部属 gen2（gen1 的帧与方法名不得出现）。
      判据：在 S2 实现前，gen1 后到会覆盖 gen2（现行为）⇒ 失败。
* [ ] **[Red] T2 原子写**（`debugStore.test.ts`）：`useDebugStore.subscribe` 收集快照 → 触发一次停点 → 断言每个快照中「`frames` 与 `location` 的来源代际一致」，即**不存在**「`frames` 为旧、`location` 为新」的快照。
* [ ] **[Red] T4 切帧**（`debugStore.test.ts`）：`applyStop` 后 `selectFrame(otherId)` → 断言 ① `generation` 未变；② `locationSeq` +1；③ `location.identity` 为规范身份（含 jdt 帧断言 `jdt:/…`，覆盖旧实现写裸 `sourcePath` 的缺陷）。
* [ ] **[Red] T5 清空**（`debugStore.test.ts`）：`continued` / `terminated` / `resetSession` 三路 → 断言 `location === null` 且 `locationSeq` +1。
* [ ] **[Green]** `store/debug/types.ts` / `stackSlice.ts` / `shared.ts` / `sessionSlice.ts` / `eventsSlice.ts`：按 design §2.3/§2.4 落地（`beginStop` + `isCurrent` 守卫 + `nextLocation`/`clearLocation` + `buildStopLocation` 单写者）。
* [ ] **[Green] 改名扩散适配**（以编译器报错为枚举手段）：`stoppedAt`→`location` 的全部消费点 —— `editor/hooks/useCurrentLineHighlight.ts`、`editor/hooks/useEditorViewSnapshot.ts`、`runner/__tests__/DebugPanel.variables.test.tsx`、`editor/hooks/__tests__/useCurrentLineHighlight.test.ts`（仅字段名）。
* [ ] 保持既有 `debugStore.test.ts` 中「第三个 stop 停在库帧并高亮」「无源码帧 → `location` null」用例语义不变（仅字段改名）。
* 验证：`pnpm test:run -- src/features/runner src/features/editor` + `pnpm type-check` + `pnpm lint:fe`。

## S3 navigate 拆分 + 调用点收敛（T11 / T3-tab）

依赖：S2。**与 S4 同 PR。**

* [ ] **[Red] T11 过期不抢激活**
  * `navigate.test.ts`（新增，真 unit）：直接调 `ensureStopSourceTab({ …, isCurrent: () => false })` → 断言 `editorStore.addTab` / `activateTab` **均未发生**（用 spy 或状态断言）；`isCurrent: () => true` → 正常打开（复用 / 新建两分支各一）。
  * `debugStore.test.ts`（新增，链级）：gen1 的 `ensureStopSourceTab` 被 mock 为挂起 → gen2 正常落地并激活 → 再让 gen1 的返回值到达 → 断言激活态仍属 gen2。
  * 判据：S3 前 `openStopTab` 无代际校验，迟到链会 `activateTab` ⇒ 失败。
* [ ] **[Red] T3-tab 症状级回归**（新建 `runner/__tests__/stopReveal.integration.test.ts`，**不 mock `../navigate`**，只 mock `features/file/api/fileApi` + `../api/debugApi` + `tauriCore`）：
  * 场景：停点1 → A 文件（`readFileContent` 用 `deferred` 挂起）→ 停点2 → B 文件（立即 resolve）→ 最后 resolve A。
  * 断言：`editorStore.tabs[tabKey].activeTabId === B 的 tabId`；且 A 的迟到不得改变活动 tab。
  * 判据：旧实现 `activateTab` 由迟到链执行 ⇒ 活动 tab 变成 A ⇒ 失败（真红）。
  * **实现注记（2026-09-16）**：首版用例在旧机制上「通过」——`await firstRun` 只让出一个微任务，
    而迟到链在 `loadStopSourceContent` → `openStopTab` 之间还有若干 await 层，断言抢先执行 ⇒ **假绿**。
    修法：resolve 迟到内容后补 `await flushMicrotasks()`；随后用例在旧机制上稳定失败于
    `expected 'p1:/repo/src/A.java' to be 'p1:/repo/src/B.java'`（正是本 issue 的症状）。
    这类「断言早于迟到链执行」是竞态用例最常见的假绿来源，新增交错用例必须自查。
* [ ] **[Green]** `navigate.ts`：抽 `ensureSourceTab`（核心，不写跳转目标）+ 新增 `ensureStopSourceTab`（`await load` 后、`addTab`/`activateTab` 前 `req.isCurrent()`）；两个用户意图入口保留 pending 写入、删除 `debug` 位。
* [ ] **[Green] 调用点收敛**：`DebugFramesColumn.handleFrameClick` → 只 `await selectFrame(frame.id)`（删 `activeProjectPaths` / `openStopSource` / `openStopVirtualSource` 及 import）；`DebugBreakpointsPane` → `openSourceAtLine`（用户意图，不设 debug 位）；删除 `runner/openStopSource.ts`。
* [ ] **[Green] mock 面同步**：`debugStore.test.ts` 的 `vi.mock('../navigate', …)` 从 `openSourceAtLine/openVirtualSourceAtLine` 换成 `ensureStopSourceTab`（否则 T1/T3 断言不到，会出现「假绿」）。
* [ ] 保持 `navigate.test.ts` 既有用例（身份归一 / 外部通道 / 复用 / 失败上报）语义不变。
* 验证：`pnpm test:run -- src/features/runner` + `pnpm type-check` + `pnpm lint:fe`。

## S4 幂等兑现（T6/T7/T8/T9/T10/T3-cursor）

依赖：S3。

* [ ] **[Red] T6 命中**：构造真实 headless `EditorView`（照 `editor/__tests__/navigateCaret.test.ts` 的 `makeView`）+ 直接 `useDebugStore.setState({ session, location, locationSeq })` + `renderHook(() => useDebugStopReveal({...}))` → 断言光标落在 `location.line`（1-based）。
* [ ] **[Red] T7 幂等自愈**：同一 `locationSeq` 下重挂载（`viewEpoch` 变化 / 重新 `renderHook`）→ 断言仍收敛到停止行，且 `caretBeforeDebug` 不重复记录（用重复放置后可 `releaseDebugCaret` 的行为间接断言，或补一个只读探针导出）。
* [ ] **[Red] T8 用户接管**：放置后手动 `view.dispatch({ selection: 别处 })` + 同 `seq` 触发重放 → 断言**未**被夺回；随后 `locationSeq+1`（新停点）→ 断言被带回。
* [ ] **[Red] T9 释放**（由 `useCurrentLineHighlight.test.ts` 的释放用例迁移）：`location→null` 两分支 —— 光标仍在放置行 ⇒ 还回旧位置；用户已改动 ⇒ 不动。
* [ ] **[Red] T10 不误伤**：`location.identity` 属别的文件 → 断言该 view 零 dispatch（`selection` 未变、无 flash 装饰）。
* [ ] **[Red] T3-cursor 症状（光标）**：扩展 `stopReveal.integration.test.ts`：A（慢，停点行 L1 ≠ 1）/ B（快，停点行 L2）交错 → 为 A、B 各挂一个 view（`useDebugStopReveal` + headless view）→ 断言 ① B view 光标落在 L2；② A view 光标**仍在初始位置**（`pos === 0`，即其迟到未触发任何 placement）。
      判据：旧机制下 A 的迟到会写 pending=L1 并把光标移到 L1 ⇒ ②失败（真红）；且旧机制下 B view 会先被放到 L2、随后又被 A 覆盖 ⇒ ①失败。
* [ ] **[Red] `useStopLocation` 门控与引用恒等**（`runner/hooks/__tests__/useStopLocation.test.ts`）：无会话 / 别项目会话 / `location=null` → `null`；store 值不变时反复渲染返回**同引用**（防 `useSyncExternalStore` 无限重渲）。
* [ ] **[Green]** `editor/stopMatch.ts`（抽出 `debugPathsMatch` + `resolveDebugHighlightLine`）；`runner/hooks/useStopLocation.ts`（design §3.1 的引用稳定性约束）；`editor/hooks/useDebugStopReveal.ts`（design §3.2 状态机）；`useCurrentLineHighlight.ts` 收缩为纯黄线（删 `releasePlacedCaret` 参数与释放分支）；`useEditorBreakpoints.ts` 少传一参数；`FileEditor.tsx` 装配；`useEditorViewSnapshot.ts` 摘 debug 分支与 `rememberPrevCaret` 开关；删 `PendingNavigateTarget.debug`。
* [ ] **[Green] 测试迁移**：`useCurrentLineHighlight.test.ts` 的释放用例 → T9；匹配纯函数用例 → 新 `editor/__tests__/stopMatch.test.ts`；`useLspNavigation.test.ts` 仅字段适配。
* 验证：`pnpm test:run -- src/features/editor src/features/runner` + `pnpm type-check` + `pnpm lint:fe`。

## S5 收尾、全量回归、上机验收

* [x] 删除死代码：`openStopSource.ts`（S3 删除）、`PendingNavigateTarget.debug` 与相关注释（S4 删除）。
* [x] 注释同步：`stackSlice.ts` 顶注（代际 + 单写者 + 原子写三条不变式）、`useCurrentLineHighlight.ts` 顶注（去掉释放职责）、`useDebugStopReveal.ts` 顶注（幂等/自愈/接管语义）、`editorStore.ts` 的 pending 注释（仅剩用户意图）。
* [x] 全量质量门：`pnpm lint:fe`（eslint + tsc + vitest --typecheck：429 文件 / 3647 测试 / 0 type errors）与 `pnpm lint`（cargo fmt + clippy、4 个护栏脚本、java-host tests OK）全绿。
* [ ] 上机验收（`pnpm tauri dev`，Java 单测调试 + Go 单测调试各一轮）—— **待人工执行**：
  * 连续单步 20 次（含进入 JDK / 库源码帧）→ 每次编辑器落在当前停止行；
  * 「继续到下一个断点」跨文件 5 次 → 不得回到上一个停点；
  * 首次打开新文件时停点 → 文件打开即定位到停止行；
  * 用户手动滚走 / 点走光标后同一次停点内不被夺回；再单步 → 恢复跟随；
  * 点栈帧切换文件与不存在的 tab（未打开的文件）→ 打开并定位；
  * 停止结束 / 继续运行 → 光标还回调试前位置（用户改动过则保持不动）。
* [x] 集成测试覆盖：T3-tab / T3-cursor 作为 issue #13 的常驻回归用例保留在 `stopReveal.integration.test.ts`（并在旧机制上验过真红）。

---

## 逐用例 Red 判据（防「假红 / 假绿」）

| 用例 | Red 必须表现为 | 禁止的伪红方式 |
|---|---|---|
| T1 | gen1 后到覆盖 gen2 → 断言看到 gen1 的帧 | 用 `await` 顺序制造「新后到」（不构成竞态） |
| T2 | 订阅快照中出现「旧 frames + 新 location」 | 只断言终态（中间态才是 I2 的目标） |
| T4 | `location.identity` 为裸 `sourcePath`（非规范身份） | 只断言行号 |
| T5 | 清空后旧 `location` 残留 / `locationSeq` 未变 | 只断言 `location===null` 而漏 `locationSeq` |
| T11 | 迟到链调用 `addTab`/`activateTab` | 用 mock 断言「函数被调用」而不校验代际参数 |
| T3-tab | 活动 tab 变成迟到文件（A） | 只断言「A 的 tab 被创建」（创建本身不违规） |
| T6/T9 | 无 `useDebugStopReveal` → 光标不动 | 直接调 `applyNavigateCaret` 绕过 hook |
| T7 | 重放时 `caretBeforeDebug` 被重复写入（释放后回到错误位置） | 只断言光标最终位置（那是一次性行为即可满足） |
| T8 | 同 `seq` 重放把用户光标抢回 | 用新 `seq` 触发（那是另一种语义） |
| T10 | 别的文件 view 收到 dispatch | 只断言自己的 view 正确 |
| T3-cursor | 最终光标停在 L1（迟到者胜） | 只断言「A 已打开」 |

## 质量门禁与回滚

* 每步结束：`pnpm test:run` + `pnpm type-check` + `pnpm lint:fe`；S5 追加 `pnpm lint`。
* Review Gates（沿用仓库红线）：`mod.rs`/`index.ts` 仅声明式；跨 feature 只经门面 / `store` 白名单面（`.eslintrc.cjs` 的 `FIREWALL_EXCEPT` 与 `sliceZones`）；无 `any` 新增；`FileEditor` 组合层不落业务逻辑；不新增 Rust / IPC。
* 回滚点：
  * **S1 未达** → 纯新增，直接 revert，零影响。
  * **S2 未达** → revert S2（S1 可保留）；行为回到「单写者 + 旧 pending 写入」，无真空。
  * **S3/S4 未达** → 二者必须整体 revert 回 S2 状态（保留 `S3` 而不做 `S4` = 跳转能力真空，绝对禁止）；revert 后 pending 写入随 `navigate` 恢复，行为等价于 S2。
  * **S5 上机验收未过** → 保留 S1–S4（症状已修，残留只是清理不彻底），把未过的项单独立 issue，不得回退到 pending 机制。
* 已知未覆盖（不得声称已修）：同一 `tabId` 多份挂载（切片 4）、用户意图槽无序（切片 5）、`debugPathsMatch` 宽松匹配（切片 3）。

## 用例修订记录（相对 PRD）

| PRD 原文 | 本执行计划 | 原因 |
|---|---|---|
| T2「原子写（订阅快照无中间态）」 | 不变，明确为「快照来源代际一致」 | 断言面写实，便于实现 |
| T3「迟到者不可覆盖跳转目标 / 最终 location = gen2」 | 拆为 **T3-tab**（S3 绿，断言活动 tab）+ **T3-cursor**（S4 绿，断言最终光标行）；`location` 部分并入 T1 | design §2.4 后「异步链写位置」已不存在，原表述的前提消失；拆开后两部分各自可在对应步骤真红 |
| T7「重放不重复记录 caretBeforeDebug」 | 不变，与 T3-cursor 共用同一交错夹具、断言不同 | 夹具复用，避免两套构造 |
| — | 新增 **T11**（PRD R4 补充 / I1 扩容） | 写 design 时发现「迟到链抢激活」是同类缺陷的第二处落点 |
