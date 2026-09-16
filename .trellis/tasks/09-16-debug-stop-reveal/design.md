# 调试停点跟随：代际化与状态化 —— 模块契约设计（切片 1+2）

> 本文是 `prd.md`（R1–R10 / I1–I7）的可执行落地契约：模块划分、类型与函数签名、状态机、时序、测试契约、落地顺序。
> 不含 Rust / IPC / 命令面改动。术语：**代际**（`StopGeneration`）= 一次停点事件的身份；**位置**（`StopLocation`）= 规范身份的停止位置；**兑现**（reveal）= 把光标/滚动落到位置上。

---

## 0. 一页结论

| 旧 | 新 |
|---|---|
| 跳转目标 = 全局可清空单槽（`pendingNavigateTarget`），由**异步链**写入 | 位置 = 停点的**原子状态**，只由**同步写入口**产生（`applyFrames` / `selectFrame`） |
| 消费 = 「命中即清槽 + rAF 里兑现」两条路径，不可重放 | 兑现 = 「从位置派生 + 幂等重放」一条路径，视图任何时刻挂载都能收敛 |
| 异步链只校验 sessionId | 异步链校验 `(sessionId, seq)`，旧代际不得落地 |
| `stoppedAt` 两个写入口径（规范身份 / 裸 `sourcePath`） | `location` 单写者（`buildStopLocation`），身份一律 `sourceIdentityOf` |

---

## 1. 所有权与依赖（before → after）

```
before
  stackSlice ──(async)──► navigate.openStopTab ──► editorStore.pendingNavigateTarget(单槽)
                                  ▲                        │
                                  │                        ├─► useEditorViewSnapshot.handleCreateEditor（视图创建路径）
  DAP 事件 ──► eventsSlice ──► refreshStackAndVars          └─► useEditorViewSnapshot 订阅（状态变化路径）
                                                                    │ rAF → applyNavigateCaret（一次性、无补偿）
after
  DAP 事件 ──► eventsSlice ──► stackSlice ──[原子 set]──► debugStore { generation, location, locationSeq, frames }
                                   │                                     │
                                   └─(gen 守卫)─► navigate.ensureStopSourceTab（只确保 tab 存在/激活，不写跳转）
                                                                         │
                                            editor.useStopLocation ◄─────┘（只读，门控 #14）
                                                     │
                                    editor.useDebugStopReveal ──► applyNavigateCaret / releaseDebugCaret（幂等、可自愈）
```

依赖方向：`runner → editor` 仅经 `@/features/runner` 门面与 `@/features/runner/store/debugStore` 白名单面；editor 只**读**runner 的公开只读钩子，**不反向写**。无新增反向依赖、无新 store。

---

## 2. runner 侧契约

### 2.1 `store/debug/stopGeneration.ts`（新增，纯函数）

```ts
export interface StopGeneration {
  sessionId: string;
  seq: number; // 模块级单调递增
}

/** 取下一个代际。每次「停点事件 / 栈刷新」调用一次。 */
export function nextGeneration(sessionId: string): StopGeneration;

/** 代际相等（当前有效代际判定）。null 永不相等。 */
export function isSameGeneration(
  a: StopGeneration | null | undefined,
  b: StopGeneration | null | undefined,
): boolean;

/** 仅测试使用：重置模块级计数器，保证用例独立。 */
export function resetGenerationSeqForTest(): void;
```

设计说明：
- `seq` **全局单调**、`sessionId` 参与相等性：跨会话永远不会误判为同一代际，因此不需要 per-session 计数器（更少状态 ⇒ 更少出错面）。
- 只做**相等**判定（`isCurrent`），不做大小比较，故无需时钟/排序语义。
- 计数器放模块级而非 store：它不是 UI 状态、不应被 React 订阅；store 只存「当前有效代际」这一份。

### 2.2 `stackFrames.ts` 增补：`buildStopLocation`（纯函数，**唯一位置构造点**）

```ts
export interface StopLocation {
  identity: string; // 规范源身份（sourceIdentityOf / virtualSourceIdentity）
  line: number;
  column: number;
}

/** 帧 → 停止位置。三分支：sourcePath / sourceReference / 无源码（null）。 */
export function buildStopLocation(frame: StackFrameDto, projectRoot: string): StopLocation | null;
```

- 放在 `stackFrames.ts`（既有「帧 → 停止点」纯函数模块，`pickStopFrame` 同处）：单一职责且已有测试文件。
- **I4 的落点**：`applyFrames` 与 `selectFrame` 都只能经它构造位置，删除 `stackSlice.ts:143/152` 的裸 `frame.sourcePath` 写入。

### 2.3 store 字段与动作（`types.ts` diff）

| 旧 | 新 | 语义 |
|---|---|---|
| `stoppedAt: { filePath; line; column? } \| null` | `location: StopLocation \| null` | 规范身份的停止位置（**唯一位置真相**） |
| — | `locationSeq: number` | 位置变化序号，**严格单调**（停点 / 切帧 / 清空都 +1） |
| — | `generation: StopGeneration \| null` | 当前有效代际；`null` ⟺ 无有效停点（running / ended / reset） |
| `refreshStackAndVars()` | 同名 + 内部分配代际 | 入口取新代际，使在途旧链全部失效 |
| `selectFrame(frameId)` | 同名，语义扩展 | 同代际内更新 `location` + `locationSeq+1` |

不变式：
- `location === null` ⟺ 当前停点没有可显示的源码帧（黄线与 reveal 同时为空）。
- `locationSeq` 只增不减；`generation === null` 时 `locationSeq` 仍可增（清空也是一次位置变化）。
- `generation` 是「写权限令牌」：不在 `isCurrent` 内的链不得写 `frames` / `location` / `variables` / 不得激活 tab。

### 2.4 `stackSlice.ts` 契约（伪代码）

```ts
/** 新动作：取新代际并写入 store（使所有在途旧链失效）。 */
beginStop(sessionId: string): StopGeneration {
  const gen = nextGeneration(sessionId);
  set({ generation: gen });
  return gen;
}

refreshStackAndVars: async () => {
  const sid = get().session?.sessionId;
  if (!sid || !isLiveSession(get().session)) return;
  const gen = get().beginStop(sid);            // ★1 先占代际
  set({ ...CLEAR_EXPANSION });

  const isCurrent = () => isSameGeneration(get().generation, gen);

  let frames: StackFrameDto[];
  try {
    frames = await dapStackTrace(sid);
  } catch (e) {
    logDebugStackError(String(e));
    await sleep(150);
    if (!isCurrent()) return;                  // ★2 重试前先校验
    frames = await dapStackTrace(sid);         // 失败则冒泡到 console（保持现行为）
  }
  if (!isCurrent()) return;                    // ★3 旧代际整链丢弃
  await applyStop(gen, frames, sid);
}

applyStop: async (gen, frames, sid) => {
  if (!isSameGeneration(get().generation, gen)) return;
  const session = get().session;
  if (!session) return;

  if (frames.length === 0) {
    set({ frames: [], variables: [], selectedFrameId: null, ...clearLocation(get()) });
    return;                                    // ★4 一次原子 set：清空也是事件
  }

  const nav = pickStopFrame(frames) ?? frames[0];
  const location = buildStopLocation(nav, session.projectPath);   // 唯一构造点
  set({                                        // ★5 原子写：帧 + 选中帧 + 位置 + seq
    frames,
    selectedFrameId: nav.id,
    ...nextLocation(get(), location),          // { location, locationSeq: +1 }
  });

  void ensureStopSourceTab({                   // R4：只确保源码 tab 存在并激活
    projectId: session.projectId,
    projectPath: session.projectPath,
    frame: nav,
    sessionId: sid,
    isCurrent: () => isSameGeneration(get().generation, gen),   // ★6 注入谓词
  }, (m) => get().pushConsole('err', m));

  const variables = await dapVariables(sid, nav.id);
  if (!isSameGeneration(get().generation, gen)) return;          // ★7 代际未变
  if (get().selectedFrameId !== nav.id) return;                  // ★8 且未被切帧抢走
  set({ variables });
}

selectFrame: async (frameId) => {
  const sid = get().session?.sessionId;
  const session = get().session;
  if (!sid || !isLiveSession(session)) return;
  const frame = get().frames.find((f) => f.id === frameId);
  if (!frame) return;

  const location = buildStopLocation(frame, session.projectPath);
  set({                                        // ★9 同代际内的一次原子写（不新开代际）
    selectedFrameId: frameId,
    ...CLEAR_EXPANSION,
    ...nextLocation(get(), location),
  });

  void ensureStopSourceTab({ ...同上，isCurrent 用同一代际 ... }, onError);

  const variables = await dapVariables(sid, frameId);
  if (!isLiveSession(get().session)) return;
  if (get().selectedFrameId !== frameId) return;
  set({ variables });
}
```

`nextLocation` / `clearLocation` 为本地纯辅助：`{ location, locationSeq: prev.locationSeq + 1 }`（清空时 `location: null`）。

**为什么切帧不新开代际**：切帧不是新停点事件，若开新代际会把在途的 `variables` 全部判死且使「停点 → 切帧」的因果链断裂；「位置变了」由 `locationSeq` 表达。若切帧发生在旧代际的 `dapVariables` 在途期间，★8 的 `selectedFrameId` 校验负责丢弃迟到变量。

**为什么 `applyStop` 同步完成核心写**：I2。帧 / 选中帧 / 位置 / `locationSeq` 必须同一次 `set`，从根上消除「黄线新、位置旧」的可观测中间态。

### 2.5 `navigate.ts` 契约

```ts
/** tab 生命周期核心：只保证 tab 存在并激活，不写任何跳转目标。 */
async function ensureSourceTab(req: {
  tabKey: string;
  projectId: string;
  identity: string;      // 规范身份（= tab 身份）
  tabTitle: string;
  load: () => Promise<StopSourceContent>;
}): Promise<string | null>; // 返回 tabId（已激活）；失败 null

/** 用户意图入口（保留 pending 写入；不再有 debug 位）。 */
export async function openSourceAtLine(
  projectId: string, projectPath: string, sourcePath: string, line: number, column = 0,
  opts?: { sessionId?: string; onError?: (m: string) => void },
): Promise<void>;

/** 用户意图入口（虚拟源码，同上）。 */
export async function openVirtualSourceAtLine(
  projectId: string, sourceName: string | null | undefined, reference: number,
  line: number, column = 0, opts?: { sessionId?: string; onError?: (m: string) => void },
): Promise<void>;

/** 停点入口：只确保源码 tab 打开/激活（R4）；`isCurrent` 由调用方注入（await 后校验）。 */
export async function ensureStopSourceTab(
  req: {
    projectId: string;
    projectPath: string;
    frame: StackFrameDto;
    sessionId?: string;
    isCurrent: () => boolean;
  },
  onError?: (m: string) => void,
): Promise<string | null>;
```

要点：
- `ensureStopSourceTab` **不写** `pendingNavigateTarget`；`await load()` 之后、`addTab` / `activateTab` 之前必须 `req.isCurrent()`，否则直接放弃（旧停点迟到的内容不得抢激活 —— 对应用例 T11）。
- 用户意图入口沿用现有逻辑（含 `debug` 位删除），`navigate.test.ts` 的既有用例（身份归一 / 外部通道 / 复用 / 失败上报）语义不变。
- 代际类型不进入 `navigate`（它只需要「还能不能落地」这一布尔语义）：DIP + 让 navigate 测试无需构造 store 代际。

---

## 3. editor 侧契约（含其唯一输入面）

### 3.1 `runner/hooks/useStopLocation.ts`（新增）

> 归属 runner（它是停点数据的公开只读面），列在此节是因为它是 editor 侧的**唯一输入**：editor 不反向写 debug store，只读这一个钩子。

```ts
export interface StopLocationView extends StopLocation {
  seq: number; // = store.locationSeq
}

/** 当前可见会话的停点位置；无会话 / 别项目会话 / 无位置 → null。 */
export function useStopLocation(): StopLocationView | null;
```

实现约束（**必须遵守**，否则触发 `useSyncExternalStore` 无限重渲）：
- 订阅 `useVisibleDebugSession()`（沿用 #14 的 activeProject 门控）+ `useDebugStore((s) => s.location)` + `useDebugStore((s) => s.locationSeq)`。
- `location` 是 store 内**已存在的稳定对象引用**（只在写位置时变引用），`seq` 是原始值 ⇒ 用 `useMemo([session, location, seq])` 组装返回值。
- **禁止** selector 内 `{ ...location, seq }` 直接返回新对象（每次 getSnapshot 都是新引用）。

经 `src/features/runner/index.ts` 导出（与 `useVisibleDebugSession` 同列，属「数据符号」，非渲染能力）。

### 3.2 `editor/hooks/useDebugStopReveal.ts`（新增）

```ts
export interface DebugStopRevealParams {
  absFilePath: string | null;                      // 规范身份（FileEditor 已算好）
  tabFilePath: string | null;
  editorViewRef: React.RefObject<EditorView | null>;
  viewEpoch: number;                               // 视图重建/文件 reload 时递增
}

export function useDebugStopReveal(params: DebugStopRevealParams): void;
```

状态机（本视图局部，不用 store）：

```ts
const placedRef = useRef<{ seq: number; line: number } | null>(null); // 本视图上一次放置

const stop = useStopLocation();
const session = useVisibleDebugSession();                 // 状态门（stopped/starting）
const sessionStatus = session?.status ?? null;
// 匹配策略与黄线共用同一纯函数（避免两套口径）
const targetLine = resolveDebugHighlightLine(absFilePath, tabFilePath, stop, sessionStatus);

useEffect(() => {
  const view = editorViewRef.current;
  if (!view) return;

  // 分支 1：不再匹配（停点结束 / 继续运行 / 会话终止 / 切到别的位置）
  if (targetLine == null || !stop) {
    if (placedRef.current) releaseDebugCaret(view, placedRef.current.line);
    placedRef.current = null;
    return;
  }

  // 分支 2：本次事件是否为新事件 + 光标是否仍在我们放的位置（用户接管惰性判定）
  const placed = placedRef.current;
  const newEvent = placed?.seq !== stop.seq;
  const sel = view.state.selection.main;
  const caretUntouched =
    placed != null && sel.empty && view.state.doc.lineAt(sel.head).number === placed.line;
  if (!newEvent && !caretUntouched) return;   // 同事件重放 + 用户已改动 → 不夺光标

  if (!resolveDocPos(view, stop.line, stop.column)) return; // 越界保护（doc 未就绪）
  applyNavigateCaret(view, stop.line, stop.column, { rememberPrevCaret: true });
  placedRef.current = { seq: stop.seq, line: stop.line };
}, [stop?.seq, targetLine, viewEpoch, editorViewRef, absFilePath, tabFilePath]);
```

设计要点：
- **幂等**：`applyNavigateCaret` 内部 `caretBeforeDebug` 仅在 absent 时记录 ⇒ 重放不叠加副作用；`placedRef` 同 `seq` 重写等价。
- **可自愈**：视图重建（`viewEpoch`）/ 切回停点所在 tab 都会重跑 effect；丢失后无需外部补偿。
- **用户接管**：判据与 `releaseDebugCaret` 完全同一谓词（空选区 + 光标停在放置行）⇒ 不引入新的「谁动了光标」耦合、无需 `EditorView.updateListener`（见 §4.2）。
- **新事件必然重新跟随**：`seq` 变 ⇒ `newEvent=true` ⇒ 即使光标被用户挪走也会跟随到新停点（IDE 语义）。
- 复用 `resolveDebugHighlightLine`（纯函数、已测）做匹配 ⇒ 黄线与 reveal 的匹配策略单点。
- 越界保护：`resolveDocPos` 为 null（doc 尚未就绪 / 行号越界）时**不放置**且**不写 `placedRef`**，等下一次触发重试；不写「已放置」是为了避免分支 2 误判为「用户接管」。

### 3.3 `editor/stopMatch.ts`（新增，纯匹配策略）+ `useCurrentLineHighlight.ts`（收缩为纯黄线）

新增 `editor/stopMatch.ts`：把 `debugPathsMatch` 与 `resolveDebugHighlightLine` 从 hook 文件里抽出（现在有**两个** hook 消费同一策略，放在 hook 文件里会形成 hook → hook 的隐式依赖）。纯函数、零依赖，是「停点是否落在本 tab」的**唯一**判定点。

- `resolveDebugHighlightLine(absFilePath, tabFilePath, location, sessionStatus)`：仅把入参 `stoppedAt` 换成 `location`（字段 `filePath` → `identity`），逻辑与 `debugPathsMatch` 不变（§4.5）。
- `useCurrentLineHighlight(absFilePath, tabFilePath, editorViewRef, viewEpoch)`：**删除** `releasePlacedCaret` 参数、删除释放分支与 `lastHighlightedLine` ref（释放已归 §3.2）。只保留 decoration effect（幂等重放不变）。
- `useDebugStopReveal` 从 `stopMatch.ts` 直接导入匹配函数（同 feature 内具体文件直导，不经门面）。
- `useEditorBreakpoints.ts` 调用点少传一个参数；`editor/index.ts` 的既有 re-export（`applyDebugCurrentLine` / `resolveDebugHighlightLine` / `useCurrentLineHighlight`）保持不破坏。

### 3.4 `editor/hooks/useEditorViewSnapshot.ts`（摘除 debug 分支）

- `rememberPrevCaret: pending.debug === true` → 去掉（用户意图跳转不再记原光标）。
- `handleCreateEditor` 中 `resolveDebugHighlightLine(..., dbg.stoppedAt, ...)` → `dbg.location`。
- 两条消费路径（视图创建 / 订阅）**语义不变**（R8），仅摘 debug 相关代码与注释。

### 3.5 调用点收敛

| 文件 | 改动 |
|---|---|
| `editor/components/FileEditor.tsx` | 装配 `useDebugStopReveal({ absFilePath, tabFilePath: tab.filePath, editorViewRef, viewEpoch: editorViewEpoch })` |
| `runner/components/DebugFramesColumn.tsx` | `handleFrameClick` → 只 `await selectFrame(frame.id)`；删除 `activeProjectPaths` / `openStopSource` / `openStopVirtualSource` 调用与 import |
| `runner/components/DebugBreakpointsPane.tsx` | 点断点属**用户意图** → 走 `openSourceAtLine`（不设 debug 位） |
| `runner/openStopSource.ts` | 删除文件（两个消费者已改道；能力被 `openSourceAtLine` + `ensureStopSourceTab` 完全覆盖） |
| `shared/store/editorStore.ts` | 删除 `PendingNavigateTarget.debug` 字段与注释 |

---

## 4. 决策记录（含被否方案）

**4.1 `locationSeq` 是否冗余（可派生）？——不冗余。**
「位置值相同」≠「事件相同」：同一断点在循环里连续命中时 `location` 值逐字段相等，若用值做 effect 依赖键，则 ① 新停点不会重新跟随（用户接管后永远不再跟随同一行）；② 无法重臂接管闩锁。`locationSeq` 编码「又发生了一次停点/位置决策」，是**事件身份的载体**，不是可派生状态。（这正是 check 侧要审的点。）

**4.2 为什么不引入 `EditorView.updateListener` 做「用户接管」闩锁？——被否。**
① 需要把新扩展塞进 `useEditorExtensions` 的组装管线（顺序敏感、影响所有文件）；② 与既有 `caretBeforeDebug` / `releaseDebugCaret` 的判据重复，会形成两套「谁动了光标」的真相；③ 惰性判定已充分：effect 只在 `[seq, targetLine, viewEpoch]` 变化时运行，用户在同一 `seq` 内的移动本就不会触发任何重放，只有「视图重建重放」才需要判定，而那时用「光标是否还在我们放的那一行」即可得到正确答案。

**4.3 为什么「确保 tab 存在」仍由 stackSlice 触发（而非独立订阅 / 常驻 hook）？**
因果内聚：一次停点 = 「确定位置」+「让源码可见」，两者同属停点处理；`navigate` 已是该职责的既有承担者。独立订阅需要新增常驻宿主与生命周期管理（对比 `useDebugSessionLifecycle` 的先例，收益不成比例）。切片 4 的 `MountRegistry` 会把「确保可见 + 唯一兑现」整体收编，届时一并迁移。

**4.4 为什么不做「视图可不可见」判定（跳过隐藏挂载的 reveal）？——被否。**
隐藏挂载跳过 placement 后，可见性变化**不会**触发 effect 依赖变化（`viewEpoch` 只在视图创建时递增），reveal 会永久丢失 —— 拿 P2 换 P2。正确解法是切片 4 消除重复挂载（一个 `tabId` 一个视图），本切片不引入半成品。

**4.5 为什么保留 `debugPathsMatch` 的宽松比对？**
本切片只保证「**写入口径唯一**」（`buildStopLocation`）；匹配函数与 `FileRef/sameFile` 的收敛属切片 3（身份唯一化）。现在强行收敛会与身份重构耦合，扩大回滚面。

**4.6 为什么用「注入 `isCurrent` 谓词」而不是把 `StopGeneration` 传进 navigate？**
navigate 只需要「还能不能落地」的布尔语义，不需要认识代际；注入后 `navigate.test.ts` 无需构造 store 代际即可覆盖「过期不激活」，符合 DIP 且降低测试耦合。

---

## 5. 关键时序

### A. 新文件停点（含 gen1/gen2 交错）

```
t0  stop#1 → beginStop(gen1) → dapStackTrace … → applyStop(gen1)
      └ 原子 set{frames,selectedFrameId,location=L1,locationSeq=1}
      └ void ensureStopSourceTab(gen1) → await load(A 文件内容)      ← 慢（磁盘/IPC）
t1  stop#2 → beginStop(gen2) → applyStop(gen2)
      └ 原子 set{…, location=L2, locationSeq=2}                      ← 覆盖 L1（同代际单写者）
      └ void ensureStopSourceTab(gen2) → await load(B 文件内容)      ← 快 → addTab+激活 B
t2  gen1 的 load 回来 → isCurrent() === false → 直接放弃（不 addTab、不激活、不写任何目标）
t3  A/B 视图挂载/可见 → useDebugStopReveal 读 location=L2 → 收敛到 L2

旧行为：t2 会写 pending=L1 ⇒ viewport 回到 L1（黄线仍在 L2）⇒ 本 bug。
```

### B. 同文件单步（同值不同事件）
`locationSeq 1→2`、`location` 值不变 ⇒ `seq` 变 ⇒ `newEvent=true` ⇒ 重新跟随（光标被用户挪走也会被带回新停点）。

### C. 点栈帧（单一入口）
`handleFrameClick` → `selectFrame(id)` → 同代际原子写 `{selectedFrameId, location, locationSeq+1}` → `ensureStopSourceTab`（若该帧源码未打开）→ reveal effect 跟随。与自动跟随**同一条路径**，不再依赖「手动点击恰好没有竞态」。

### D. 继续运行 / 会话结束
`continued` / `terminated` / `resetSession` → `{ generation: null, location: null, locationSeq+1 }` → reveal 分支 1：若光标仍在我们放置的行 ⇒ `releaseDebugCaret` 还原；用户已改动 ⇒ 不动（保护语义不变）。

---

## 6. 已知残留（切片 3/4/5 接缝，本切片不解决）

| 残留 | 现象 | 归属 |
|---|---|---|
| 同一 `tabId` 多份挂载（`FileViewer` 在每个 pane 渲染全部 file tab） | 隐藏副本也会执行 placement，其测量不可靠（滚动位置无意义）；可见副本正确 | 切片 4（视图唯一化） |
| `pendingNavigateTarget` 仍是无序单槽（用户意图） | 定义跳转/quick-open/终端链接之间的抢写 | 切片 5 |
| `debugPathsMatch` 宽松比对 | 身份相等的判定标准仍有两套 | 切片 3 |
| `EditorMountRegistry` 缺席 | 无法选举「唯一兑现者」 | 切片 4 |

---

## 7. 测试契约

新增共享工具：`src/testing/deferred.ts`（`deferred<T>()` → `{ promise, resolve, reject }`），供 runner/editor 两侧交错用例复用（避免各自内联）。

| 文件 | mock / 夹具 | 关键断言 | 对应用例 |
|---|---|---|---|
| `runner/store/debug/__tests__/stopGeneration.test.ts`（新） | 无（纯函数） | 单调递增；`isSameGeneration` 的 null 语义；`resetGenerationSeqForTest` 隔离 | R1 |
| `runner/__tests__/stackFrames.test.ts`（扩） | 无 | `buildStopLocation`：`sourcePath`→规范身份、`sourceReference`→`dap-source:`、无源码→null | R2/I4 |
| `runner/__tests__/debugStore.test.ts`（改 + 扩） | `dapStackTrace` / `dapVariables` 用 `deferred`；`../navigate` 的 mock 面从 `openSourceAtLine/openVirtualSourceAtLine` 改为 **`ensureStopSourceTab`** | T1 反转 resolve 顺序 → 全部状态属 gen2；T2 订阅快照无「新 location + 旧 frames」；T4 切帧同代际 + `locationSeq+1`；T5 清空 + `locationSeq+1`；T11 过期链不激活 tab | T1/T2/T4/T5/T11 |
| `runner/hooks/__tests__/useStopLocation.test.ts`（新） | `useDebugStore.setState` + `useProjectStore` | 无会话 / 别项目 / location null → null；值不变时引用恒等（防重渲） | R5/I7 |
| `runner/__tests__/navigate.test.ts`（改 + 扩） | 既有 mock（fileApi / debugApi / navigationHistoryStore） | 既有断言保持；新增：`ensureStopSourceTab` 不写 `pendingNavigateTarget`；`isCurrent=false` 时 `addTab`/`activateTab` 均未发生 | R4/T11 |
| `editor/hooks/__tests__/useDebugStopReveal.test.ts`（新） | 真实 headless `EditorView`（照 `navigateCaret.test.ts` 的 `makeView`）+ `renderHook` + 直接写 debug store | T6 命中→光标在停止行；T7 同 `seq` 改 `viewEpoch` 重放→仍收敛且 `caretBeforeDebug` 不重复记录；T8 挪走光标后同 `seq` 不夺回、新 `seq` 夺回；T9 `location→null` → 释放/不释放两分支；T10 不匹配 → 零 dispatch | T6–T10 |
| `editor/hooks/__tests__/useCurrentLineHighlight.test.ts`（改） | 既有夹具 | 去掉释放相关用例（迁至 T9）；黄线用例仅换字段名；匹配纯函数用例改从 `editor/stopMatch` 导入 | R7 |
| `editor/__tests__/stopMatch.test.ts`（新，由原用例迁移） | 无（纯函数） | `debugPathsMatch` 各分支 + `resolveDebugHighlightLine` 的状态门与匹配优先级 | I5 |
| `editor/hooks/__tests__/useLspNavigation.test.ts`（改） | 既有 | 仅 `pendingNavigateTarget` 字段适配 | R8 |

质量门：`pnpm test:run`、`pnpm type-check`、`pnpm lint:fe`、`pnpm lint`。

---

## 8. 落地顺序（每步可编译、可测、可回滚）

| 步 | 内容 | 出口 |
|---|---|---|
| S1 | `stopGeneration.ts` + `buildStopLocation`（纯函数 + 单测） | 纯新增，零行为变化 |
| S2 | store 代际化 + `stoppedAt`→`location` 改名 + 原子写 + `selectFrame` 归一（编译器枚举全部消费点） | T1/T2/T4/T5 绿；**此步后跳转仍由旧 pending 承担**，行为不真空 |
| S3 | `navigate` 拆分（`ensureSourceTab` / `ensureStopSourceTab` + 用户入口去 debug 位）+ `DebugFramesColumn` / `DebugBreakpointsPane` 适配 + 删 `openStopSource.ts` | T11 + `navigate.test.ts` 绿 |
| S4 | `useStopLocation` + `useDebugStopReveal` + 黄线收缩 + `FileViewer/FileEditor` 装配 + 摘 debug 位 | T6–T10 绿 |
| S5 | 收尾：删除 `PendingNavigateTarget.debug`、注释与文档同步、全量质量门 | 回归全绿 + 上机验收 |

**发布切分（重要）**：S3 与 S4 之间存在**跳转能力真空**（旧写入已删、新派生未接）。因此：
- 方案 A（推荐）：`S1+S2` 一个 PR，`S3+S4+S5` 一个 PR —— 每个 PR 结束都是自洽可用状态；
- 方案 B：全部一个 PR（改动面大但只有一次验证）。

禁止 `S3` 单独合入。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `location` 改名扩散到多处消费点与测试桩 | 以编译器报错为枚举手段；S2 单独成步、单独可回滚 |
| 幂等重放被误解为「每次都夺光标」 | T7/T8 明确锁定：同 `seq` 重放仅在光标未被改动时生效；新 `seq` 才重新跟随 |
| 「确保 tab 存在」留在 stackSlice 被质疑职责越界 | §4.3 决策记录 + S4 后 `ensureStopSourceTab` 不再承担跳转语义（只做 tab 生命周期），切片 4 迁移 |
| 交错用例写成「伪同步」而没真正覆盖竞态 | T1/T3/T11 必须用 `deferred` 反转 resolve 顺序，禁止用 `await` 顺序模拟 |
| 隐藏副本的 placement 语义被误认为已修 | §6 明确列为切片 4 接缝，PR 描述与验收话术不得声称已修 |
