# 导航目标状态模型（Navigation Goal）

> 「编辑器应展示某文件某行」这一用户意图的承载与兑现契约。
> 适用范围：任何「打开/定位到某处」的入口（断点点击、go-to-definition、quick-open、
> 终端/控制台链接、导航历史 Back/Forward、适配器虚拟源码）。
> 与 [状态管理](./state-management.md) §12（可派生期望视图不做一次性槽）互补：
> 停点跟随走**派生模型**（`useDebugStopReveal`），用户意图走**目标状态模型**（本文）。

---

## 1. 设计决策：意图是目标（goal），不是事件（event）

**Context**：旧实现用一次性单槽（`pendingNavigateTarget`）承载跳转意图：命中即清槽、
rAF 兑现一次、清槽与成败无关。三个竞态窗口全部源于「用事件承载目标、用猜测替代屏障」：

1. 视图首帧几何未就绪（langExtension 异步后置 / 容器布局未稳）→ 滚动算错，
   表现为「点断点定位不准，再点一下才准」；
2. 重挂载时停点跟随重放（`viewEpoch++` → 派生链同步放置停止行）与意图兑现交错；
3. StrictMode 双挂载 / 视图销毁时微任务清槽 → 意图永久丢失且无补偿。

**Decision**：意图表达为**目标状态** `NavigateGoal`——为真直到被兑现或被取代；
兑现绑定「视图就绪」事实（CodeMirror 测量 + 语言扩展缓存命中），用幂等重放自愈，
不用时间窗猜测。

**三条不变量（违反即为 Block）**：

| # | 不变量 | 机制 |
|---|---|---|
| I1 | 意图不丢失：要么被兑现，要么被更新意图取代 | goal 存活至兑现；viewEpoch 重放自愈 |
| I2 | 恰好一次：兑现成功后不重复兑现 | 微任务内 seq 货币性复检 + 成败都清槽 |
| I3 | 最新意图获胜 | `setNavigateGoal` seq 自增覆盖；陈旧回调 no-op |

## 2. 签名与契约

```ts
// src/shared/store/editorStore.ts
interface NavigateGoal {
  seq: number;      // 自增事件键：取代判定 + 兑现回调货币性检查
  tabKey: string;   // resolveTabKey 产物（与 tab 同一事实源，红线 12）
  tabId: string;    // getTabId 产物
  line: number;     // 1-based
  col: number;      // 0-based
}
setNavigateGoal(target: Omit<NavigateGoal, 'seq'>): number;  // seq++ 覆盖写（取代语义），返回本次 seq
clearNavigateGoal(seq: number): void;  // 仅当前 goal.seq === seq 才清（货币性）。**没有无参
                                        // 强制清形态**——生产方失败路径凭 setNavigateGoal
                                        // 返回的 seq 清除自己的目标；无参清会吞掉并发写入的
                                        // 新目标（迟到失败清不得越权），设计上已否决。
```

```ts
// src/features/editor/hooks/useNavigateGoal.ts —— 兑现器（机制唯一所有者）
useNavigateGoal({ tabKey, tabId, editorViewRef, viewEpoch }): {
  consumeOnViewCreate(): boolean;  // onCreateEditor 内调用；true = 本视图认领目标（跳过快照恢复）
}
```

- 三条兑现路径全部收敛在 hook 内：挂载消费（`consumeOnViewCreate`）、store 订阅
  （tab 已激活路径）、`viewEpoch` 重放（视图重建自愈）。
- 兑现绑定 CM 屏障：`view.requestMeasure({ read, write })`，write 阶段武装
  `queueMicrotask`（**CM write 阶段禁止 dispatch**——见 §4 Gotcha），微任务内
  重读 store 复检 seq/tabKey/tabId + `isViewDestroyed`，然后 `applyNavigateCaret`。
- 成败都按 seq 清槽：失败滞留只会造成迟到的陈旧跳转（宁可放弃不换弹）。

## 3. 项目约定

### 新增一个导航意图入口 = 1-2 行

```ts
// 生产方只触 store API，零机制感知（不 import navigateCaret、不触碰视图）。
useEditorStore.getState().setNavigateGoal({ tabKey, tabId, line, col });
```

- tab 键空间必须与 tab 实际所在空间同源（`resolveTabKey`，红线 12）；
  **禁止**直接用 projectId 当 tabKey（历史教训：`consoleLinks.ts` 任务链接——
  2026-09-17 已修，`openFileInEditor` 收敛为单派生点 `resolveTabKey`）。
- 生产方失败路径（读取失败 / 会话失效）→ 凭 `setNavigateGoal` 返回的 seq 调
  `clearNavigateGoal(goalSeq)` 货币性清除（不误伤并发新目标；useLspNavigation /
  navigationHistoryStore 均如此）。

### 就绪屏障：扩展未就绪不建 tab

创建 tab 的生产方在读取内容 / 提交前 `await getLanguageExtension(filePath)`
（in-flight 去重，缓存命中即时返回——`sourceTab.ts` / `quick-open/openFile.ts` 均如此）。
视图挂载即带扩展，「兑现后 reconfigure 重排」这一类整体消灭。
`preloadLanguageExtension` 仅用于**非本生产者提交**的预热场景（fire-and-forget 语义）。

### goal 生命周期

goal 与其目标 tab 同生共死：`closeTab`（tabKey+tabId 精确匹配）、
`clearProjectTabs`（tabKey 匹配）在移除的同一 set 更新内清 goal
（`dropNavigateGoalFor` 私有 helper）。防止「上周的目标下周换弹」。

## 4. Gotcha：CodeMirror `requestMeasure` 的两个硬约束（6.43.x）

> **Warning**：① write-only 请求会在 read 阶段抛 `BadMeasure`，write 被跳过——
> read/write 必须成对给；② write 阶段处于 CM 更新周期内，`view.dispatch` 抛
> "Calls to EditorView.update are not allowed while an update is in progress"。

正确做法：write 只武装 `queueMicrotask`（measure 同步强制布局完成后立即执行、
早于下一帧——屏障语义不变），dispatch 放微任务内；`view.destroyed` 为 TS private，
经 unknown 收窄访问（`isViewDestroyed`）。

## 5. Wrong vs Correct

```ts
// Wrong：命中即清槽 + rAF 猜一帧 + 清槽与成败无关
requestAnimationFrame(() => applyNavigateCaret(view, pending.line, pending.col));
queueMicrotask(() => setPendingNavigateTarget(null));  // 落空 = 静默丢失

// Correct：屏障 + 货币性 + 成败都按 seq 清（useNavigateGoal.applyGoal）
view.requestMeasure({
  read: () => undefined,
  write: () => queueMicrotask(() => {
    if (isViewDestroyed(view)) return;
    const g = useEditorStore.getState().navigateGoal;
    if (!g || g.seq !== seq || g.tabKey !== tabKey || g.tabId !== tabId) return;
    applyNavigateCaret(view, g.line, g.col);
    useEditorStore.getState().clearNavigateGoal(seq);
  }),
});
```

## 6. 测试要求

- `editor/hooks/__tests__/useNavigateGoal.test.ts`：I1（无视图写入→挂载兑现；销毁→重建
  重放自愈）、I2（二次消费 no-op；失败清槽）、I3（陈旧 seq 不 apply 不误清）+ 屏障调度
  断言。**变异验证**：删 seq 货币性检查后 I3 用例必须转红。
- `runner/__tests__/navigate.test.ts`：屏障期不读内容 / 不建 tab；屏障后许可复检。
- `quick-open/__tests__/openFile.test.ts`：屏障期不读内容 / 不建 tab，放行后提交。
- `shared/store/__tests__/editorStore.test.ts`：goal 随 closeTab / clearProjectTabs 清理
  与保留分支。
- 时序断言必须经「flush rAF + flush microtasks」驱动（CM measure 假帧），直接 await 会有假绿。

## 7. 所有权边界（与停点跟随的分工）

| 通道 | 模型 | 光标所有权 |
|---|---|---|
| 用户意图（断点/跳转/链接/历史） | **目标状态**（本文） | 最新 seq 胜；停点重放被用户意图压制至下一停点事件 |
| 调试停点跟随 | **派生状态**（`useDebugStopReveal`：location+seq 推导，幂等重放 + 接管 + 释放） | 无新停点事件且光标仍在放置行 → 重放；用户挪走即让位 |

两通道共用 `applyNavigateCaret` 与「视图就绪」纪律；**禁止**把停点跟随塞进 goal 槽
（可派生状态做槽 = 退回 issue #13 的病根，见 state-management.md §12）。
