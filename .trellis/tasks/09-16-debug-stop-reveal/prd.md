# 调试停点跟随：代际化与状态化（垂直切片 1+2）

## Goal

修掉「停点/单步时编辑器有时不跳到断点位置，重新点一下栈帧中的函数才能定位」（issue #13）。

根因不是某处时序没对准，而是**把「可推导的期望视图状态」实现成了「一次性事件 + 全局单槽 + 两个消费者」**。本切片把这条链路换成第一性原理形态：

1. **代际化**：停点的异步链落地必须携带代际，旧代际不得写任何状态；跳转目标成为停点原子写的一部分（不再有异步写入口）。
2. **状态化**：编辑器「跟随停点」改为**派生 + 幂等重放**，删除「命中即清槽、rAF 里兑现」的消费模型。

做到 1+2 后，本 bug 的两条成因在结构上不可能再发生（不是靠把竞态窗口变窄）。切片 3/4/5（身份唯一化 / 视图唯一化 / 旧机制清理）的接缝见 Out of Scope。

## Background

### 现状链路（4 个所有者）

| 阶段 | 所有者 | 产出 | 位置 |
|---|---|---|---|
| 选帧 | `pickStopFrame` | 栈顶第一个带源码的帧 | `src/features/runner/stackFrames.ts:23` |
| 写停点状态 | `stackSlice.applyFrames` | `stoppedAt` + `selectedFrameId` + `frames` | `src/features/runner/store/debug/stackSlice.ts:42-135` |
| 打开源码 tab | `navigate.openStopTab` | tab 复用/新建 + 写 `pendingNavigateTarget` | `src/features/runner/navigate.ts:75-132` |
| 消费跳转意图 | `useEditorViewSnapshot` **两条路径** | 光标 + 居中滚动 + 闪蓝 | `src/features/editor/hooks/useEditorViewSnapshot.ts:148-167`、`220-238` |

意图载体是**一个全局单槽**：`editorStore.pendingNavigateTarget`（`src/shared/store/editorStore.ts:258-271`、`1055`）。

### 成因 A｜意图槽无序、无主 ⇒ 迟到者覆盖（P1）

- `applyFrames` 的唯一守卫 `stillLive()` **只比对 sessionId**（`stackSlice.ts:35-40`），不区分「哪一次停点」。
- `stoppedAt` **同步**写（`stackSlice.ts:61/81`），而 `pendingNavigateTarget` 在「新建 tab」分支被 `await load()` 推到**异步尾部**（`navigate.ts:105` → `129-131`）；`load()` 是一次 IPC 读盘（jdt `src.zip` 解压可达数百 ms）。
- `refreshStackAndVars` 有 3 个触发点：`sessionSlice.ts:70`（启动）、`sessionSlice.ts:145`（attach）、`eventsSlice.ts:52`（stopped 事件）；加上 `stackSlice.ts:114-134` 的 150ms 重试，同 session 内并发链是常态。

于是两条链交叠时**谁最后写谁赢**：旧停点链的文件读取更慢 ⇒ 它在新的 `stoppedAt` 之后才写跳转目标 ⇒ **黄线在正确的 L2、viewport 停在 L1**；用户点一下栈帧 → 重新写一次（此时无竞态）→ 立刻定位成功。与报告症状逐字吻合。

### 成因 B｜「先清槽、后兑现」且无补偿（P2）

- 订阅路径命中后**立刻**清槽，真正的动作塞进 `requestAnimationFrame`（`useEditorViewSnapshot.ts:226-233`）；rAF 里是闭包捕获的旧 view，若此间视图被重建/仍隐藏（零高测量），滚动静默丢失，且意图已被清掉，**无重试、无校验**。
- 视图创建路径的 `if (editorRestoredRef.current) return;` 排在读 pending **之前**（`useEditorViewSnapshot.ts:148`）：视图一旦建过，只能靠「状态变化」触发订阅。
- 对照黄线：`useCurrentLineHighlight` 在 `viewEpoch` / `highlightedLine` 变化时反复重放（`useCurrentLineHighlight.ts:91-104`），是幂等的；**光标/滚动却是一次性的** —— 这就是「黄线在、位置不在」这一族症状的来源。

### 为什么 1+2 能独立闭环

把跳转目标降级为**停点原子写的一部分**（同步、带代际）后，「迟到者覆盖」不再是概率问题而是类型上不可能（异步链不再持有写权限）；把兑现改成**从状态派生的幂等投影**后，「清槽后丢失」这个中间态不存在了（视图任何时刻挂载都能收敛）。两者共同覆盖报告症状的全部观测面。

## 第一性原理与不变式（本切片立起来的部分）

| # | 不变式 | 消除 |
|---|---|---|
| I1 | 任何异步落地前校验 `(sessionId, seq)`；旧代际不得写 `frames` / `location` / `variables`、不得激活 tab | P1 |
| I2 | 一次停点 = 一次原子 `set`（帧 + 选中帧 + 位置 + `locationSeq`） | 「黄线对、位置不对」的中间态 |
| I3 | 跳转目标**只由同步写入口产生**（`applyFrames` / `selectFrame`），异步链无写权限 | P1 |
| I4 | 位置只有一个写入口，且身份一律由 `sourceIdentityOf` 产出（禁止裸 `frame.sourcePath` 写位置） | P3 的传播前提 |
| I5 | 兑现是状态投影 + 幂等重放（按 `seq` + `viewEpoch` 派生），不存在「已清未兑现」 | P2 |
| I6 | 用户接管（光标离开放置位置）后本次 `seq` 内停止跟随，新 `seq` 恢复 | 跟随不夺光标 |
| I7 | 跟随仅在 session 属于 activeProject 时生效（沿用 #14 门控） | 跨项目误写 |

## Requirements

- **R1 代际（runner）**：`refreshStackAndVars` 入口取新代际 `{ sessionId, seq }`（`seq` 对该 session 单调递增）；所有 `await` 之后落地前必须 `isCurrent(gen)`，否则**整条链放弃**（不写 frames / location / variables，不产生 console 噪音）。会话切换（`sessionId` 变）使旧代际永久失效。
- **R2 单写者 + 原子写（runner）**：`stoppedAt` 更名为 `location: { identity; line; column } | null`，`identity` 一律由 `sourceIdentityOf(projectRoot, path)` 产出；`frames` / `selectedFrameId` / `location` / `locationSeq` 在**同一个 `set`** 内落地。`selectFrame` 在同一代际内更新 `location` 与 `locationSeq+1`（不新开代际）。删除 `stackSlice.ts:143/152` 的裸 `frame.sourcePath` 写入口径。
- **R3 `locationSeq` 单调（runner）**：任何位置变化（停点、切帧、清空）都 `+1`；它是编辑器侧「期望视图」的唯一依赖键（替代原先「可被清掉的槽」）。
- **R4 跳转目标不再经异步链（runner）**：`navigate.openStopTab` 只负责「确保源码 tab 已打开」（内容获取 + 复用/新建 + 激活），**不再写** `pendingNavigateTarget`；其 debug 跳转语义随之删除。异步链的唯一职责是让 tab 存在 —— 顺序不再影响最终结果。**但该链在 `addTab` / `activateTab` 之前必须校验代际**（`isCurrent(gen)`）：旧停点迟到的内容加载不得抢走新停点的 tab 激活。
- **R5 幂等兑现（editor）**：新增 `useDebugStopReveal`，从 runner 公开面读取当前停点位置（经 `useStopLocation()`，内部沿用 `useVisibleDebugSession` 的 activeProject 门控），按 `[匹配, seq, viewEpoch]` 派生执行光标 + 居中滚动 + 闪蓝；**同一 `seq` 在同一视图上可安全重放**（视图重建 / 隐藏→可见 / 切回 tab 都会自愈）。
- **R6 用户接管闩锁（editor）**：光标**离开本 hook 放置的位置**（选区位移或非空选区）即视为用户接管，本次 `seq` 内不再跟随；新 `seq` 自动解除。判定沿用 `releaseDebugCaret` 的既有谓词，不引入新的「谁动了光标」耦合（除必要的 `EditorView.updateListener` 观测）。
- **R7 释放语义显式化（editor）**：光标**释放**（停点结束 / 继续运行 / 会话终止，即 `location === null`）从「黄线变 null 的间接触发」改为 `useDebugStopReveal` 的一个分支：仅当光标仍停在我们放置的位置时还回调试前位置（保留现有保护语义，返回布尔值不变）。`useCurrentLineHighlight` 退回纯黄线职责（移除 `releasePlacedCaret` 注入参数）。
- **R8 用户意图跳转边界不动**：`pendingNavigateTarget` 保留给 go-to-definition / quick-open / 终端与任务链接等**用户意图**跳转，其两条消费路径（`handleCreateEditor` pending 分支、订阅）本切片**不改语义**，仅摘除 debug 分支与 `debug?: boolean` 字段（`editorStore.ts:263-270`）及其消费点（`useEditorViewSnapshot.ts:157-159`、`228-231`）。user 意图槽的有序化不在本切片。
- **R9 公开面（门面）**：`useStopLocation` 经 `@/features/runner` 门面导出（与 `useVisibleDebugSession` 同列，属数据符号）；editor 侧不导入 `runner/store/debug/**`（该目录对其他 feature 是封闭 zone，见 `.eslintrc.cjs:32-51`）。本切片不需要 runner → editor 的新反向写入。
- **R10 非功能**：无 Rust 改动、无新 Tauri 命令、IPC 不变；不新增 per-stop 全量重渲染；`mod.rs`/`index.ts` 形态与防火墙约定不变；全程 TDD（先写失败测试）。

## 状态与接口契约（本切片定型）

```ts
// runner · store/debug/stopGeneration.ts（新增，纯函数）
export type StopGeneration = { sessionId: string; seq: number };
export function isSameGeneration(a: StopGeneration | null, b: StopGeneration | null): boolean;

// runner · store/debug（stackSlice / types）
generation: StopGeneration | null;                                    // 当前有效代际
location: { identity: string; line: number; column: number } | null;   // 唯一位置真相（规范身份）
locationSeq: number;                                                  // 位置变化序号（单调）
// selectFrame(frameId) → 同一代际内：selectedFrameId + location 同步更新 + locationSeq+1

// runner · hooks/useStopLocation.ts（新增，经门面导出）
//   返回 null 当且仅当：无会话 / 会话不属于 activeProject（#14）/ location === null
export function useStopLocation(): { identity: string; line: number; column: number; seq: number } | null;

// editor · hooks/useDebugStopReveal.ts（新增）
export function useDebugStopReveal(params: {
  absFilePath: string;                 // 规范身份（FileEditor 已算好）
  tabFilePath: string | null;
  editorViewRef: React.RefObject<EditorView | null>;
  viewEpoch: number;
}): void;
// 内部状态：placedRef = { seq, pos } | null；pausedSeqRef = number | null
// effect deps: [stop?.seq, matched, viewEpoch]
//   !matched                     → placed 存在则 releaseDebugCaret，清 placed
//   matched && seq === pausedSeq  → 不动作
//   matched                       → applyNavigateCaret(view, line, col, { rememberPrevCaret: true })
//                                   placedRef = { seq, pos }（幂等：同 seq 重放不再记录 caretBeforeDebug）
```

## 文件级改动清单

**新增**
- `src/features/runner/store/debug/stopGeneration.ts` — 代际类型与谓词（纯函数）。
- `src/features/runner/store/debug/__tests__/stopGeneration.test.ts` — R1 单测。
- `src/features/runner/hooks/useStopLocation.ts` — 停点位置的公开只读钩子（含 activeProject 门控）。
- `src/features/runner/hooks/__tests__/useStopLocation.test.ts` — 门控与 null 语义。
- `src/features/editor/hooks/useDebugStopReveal.ts` — 幂等兑现 + 接管闩锁 + 释放分支。
- `src/features/editor/hooks/__tests__/useDebugStopReveal.test.ts` — R5/R6/R7 单测。
- `src/features/editor/stopMatch.ts` — 停点匹配策略纯函数（从 `useCurrentLineHighlight` 抽出，供黄线与 reveal 共用同一判定）。
- `src/testing/deferred.ts` — `deferred<T>()` 夹具，供 runner/editor 两侧的代际交错用例复用。

**修改**
- `src/features/runner/store/debug/stackSlice.ts` — 代际入口与守卫；`stoppedAt`→`location`；原子写；`selectFrame` 归一 + `locationSeq`；删除「打开源码」调用（tab 打开职责留在 navigate）。
- `src/features/runner/store/debug/types.ts` — `DebugStackSlice` / `DebugStore` 字段与动作签名（R1/R2/R3）。
- `src/features/runner/store/debug/shared.ts`、`sessionSlice.ts`、`eventsSlice.ts` — `stoppedAt`→`location`、`locationSeq` 复位/递增（`continued` / `terminated` / `resetSession`）。
- `src/features/runner/navigate.ts` — `openStopTab` 去掉 pending 写入与 `debug: true`（R4）；保留 tab 生命周期与错误上报。
- `src/features/runner/index.ts` — 导出 `useStopLocation`（R9）。
- `src/features/editor/hooks/useCurrentLineHighlight.ts` — 抽走匹配纯函数（迁往 `stopMatch.ts`）；只留黄线；删除 `releasePlacedCaret` 参数与释放分支；改读 `location`（规范身份）。
- `src/features/editor/hooks/useEditorViewSnapshot.ts` — 删除 `debug` 相关分支与字段消费（R8），user 意图路径不动。
- `src/features/editor/hooks/useEditorBreakpoints.ts` — 调用点适配（少一个参数）。
- `src/features/editor/components/FileEditor.tsx` — 装配 `useDebugStopReveal`。
- `src/shared/store/editorStore.ts` — 删除 `PendingNavigateTarget.debug` 与其注释（R8）。
- 测试桩同步：`src/features/runner/__tests__/debugStore.test.ts`、`src/features/runner/__tests__/DebugPanel.variables.test.tsx`、`src/features/editor/hooks/__tests__/useCurrentLineHighlight.test.ts`、`src/features/editor/hooks/__tests__/useLspNavigation.test.ts`（字段改名/签名适配）。

**删除**
- `stackSlice` 内对 `navigate.openSourceAtLine` / `openVirtualSourceAtLine` 的调用与相关 import。
- `openStopSource.ts` 中仅为 debug 跳转服务的包装（R4 后若无消费者则一并删除；有消费者则保留但去掉 `debug` 语义）。

> 注：R4 之后「打开 tab」与「跳转到行」彻底解耦 —— 前者是 runner 的 tab 生命周期职责（异步、可失败、经 Debug Console 上报），后者是 editor 的派生视图职责（同步、幂等、可自愈）。

## Out of Scope（后续切片，本切片只留接缝）

- **切片 3 身份唯一化**：tab 复用改走 `FileRef/sameFile`（`navigate.ts:86-88` 的裸字符串等值）；`debugPathsMatch` 的宽松归一收敛为身份相等；`useCurrentLineHighlight` 与 reveal 共用同一匹配函数。
- **切片 4 视图唯一化**：`FileViewer` 只渲染本 group 的 tab（消除同一 `tabId` 的多份挂载）；`MountRegistry` 选举唯一兑现者，隐藏副本不消费。
- **切片 5 清理**：user 意图槽的有序化 / 单消费者化（`pendingNavigateTarget` 全量替身）；`editorRestoredRef` 时序分支拆除。
- 与 #13 无关：Java 后端选择、SSH 端口转发、求值 / HCR 能力。

## Acceptance Criteria

**先写的失败测试（Red → Green）**

- [ ] T1 代际守卫：两个 deferred `dapStackTrace`（gen1 慢 / gen2 快）→ 反转 resolve 顺序 → `frames` / `location` / `selectedFrameId` 全部来自 gen2，gen1 不留痕。
- [ ] T2 原子写：订阅 store 断言不存在「新 `location` + 旧 `frames`」的中间快照（帧 / 选中帧 / 位置成对更新）。
- [ ] T3 迟到者不可覆盖跳转目标：gen1 的源文件读取（deferred）晚于 gen2 完成 → 最终 `location` = gen2，`locationSeq` 单调递增。
- [ ] T4 切帧：`selectFrame` 同代际内更新 `location`（规范身份）并 `locationSeq+1`，不新开代际。
- [ ] T5 结束 / 继续：`continued` / `terminated` / `resetSession` → `location=null` 且 `locationSeq+1`。
- [ ] T6 命中：stop 匹配本 tab → 光标落在停止行并居中（1 次）。
- [ ] T7 幂等自愈：同 `seq` 下 `viewEpoch` 变化（模拟视图重建 / 切回 tab）→ 仍收敛到停止行；重复应用不重复记录 `caretBeforeDebug`。
- [ ] T8 用户接管：光标被移开后同 `seq` 不再夺回；新停点（新 `seq`）恢复跟随。
- [ ] T9 释放：`location→null` 且光标仍在放置行 → 还回调试前位置；用户已改动则不动。
- [ ] T10 不误伤：其他文件的编辑器对该 stop 不产生任何 dispatch。
- [ ] T11 旧停点不抢激活：gen1 的源码内容加载（deferred）晚于 gen2 的 tab 激活 → 最终激活的是 gen2 的 tab（gen1 迟到的 `addTab`/`activateTab` 被代际守卫拦下）。

**回归与质量门**

- [ ] 现有 `debugStore.test.ts` / `navigate.test.ts` / `stackFrames.test.ts` / `navigateCaret.test.ts` / `useLspNavigation.test.ts` 语义保持（仅字段 / 签名适配）。
- [ ] 三处 `refreshStackAndVars` 并发（启动路径）不再产生交叉写：`location` 与派生视图永远同代际。
- [ ] `pnpm test:run`、`pnpm type-check`、`pnpm lint:fe`、`pnpm lint`（Rust 无改动，保持绿）全通过。
- [ ] 真机验收（手动）：Java / Go 单测调试连续单步 20 次 +「首次打开新文件」场景，编辑器每次落在当前断点行；「继续到下一个断点」跨文件不回到上一个停点。

## Risks

- `location` 改名会牵动多个消费点与测试桩：以编译器报错作为枚举手段，避免遗漏（这也是选择改名而非加字段的原因）。
- `useDebugStopReveal` 的幂等重放意味着「切回停点所在的 tab 会把光标带回停止行」—— 与 IDE 一致（黄线同语义），但需确保**用户接管闩锁**生效，否则会与用户操作抢光标。
- 删除 debug 版 pending 写入后，`openStopTab` 仅剩「打开 tab」职责，需确认 `DebugBreakpointsPane` 点击断点打开文件的路径在本切片后仍能跳转（其跳转改由 reveal 派生路径承担，须一并验证）。

## Notes

- 根因分析（P1 迟到者覆盖 / P2 清槽后丢失）来自本次会话的代码走查；本 PRD 只落 1+2 两条不变式集合。
- 本切片完成后 issue #13 的观测症状应完全消失；切片 3/4/5 处理身份与视图唯一化（防御更深层的重复身份 / 重复挂载问题），不阻塞本切片验收。
