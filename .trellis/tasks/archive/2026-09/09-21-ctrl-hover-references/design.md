# Design：上下文感知 Ctrl+Click（v2，徽标方案已废弃删除）

## 1. 边界与职责（高内聚低耦合）

| 模块 | 职责 | 所有权 |
|---|---|---|
| `src/features/editor/hooks/useCmdClickGoToDefinition.ts`（扩展） | 纯函数 `isOnDefinitionSite`（同文档 + 落在 definition range 内）+ 点击分流：定义处 → `findReferences` + `referencesPeekStore.openPeek({ navigate 端口 })`；调用处 → 既有 `navigateToLocation`。 | editor feature |
| `src/features/editor/hooks/useLspNavigation.ts`（透传最小改） | 把 `definition.findReferences` 传入 CmdClick 链路（`Shift+F12` 旧链路仍走 `symbolNavStore.openFindUsages`，零改动）。 | editor feature |
| `src/features/symbol-nav/store/symbolNavStore.ts` + `SymbolNavPalette.tsx`（复用，零改动） | 弹窗展示与跳转兑现。 | symbol-nav feature |

禁止事项：通用模块出现 `languageId === 'xxx'`（红线 15）；新增第二套弹窗或第二套跳转函数（DRY）。

## 2. 数据流与契约

```
Ctrl+Click ──▶ goToDefinition（既有，含缓存/jdt守卫）
      │ 有结果
      ├─ isOnDefinitionSite(当前uri/pos, location) == true
      │     └─▶ findReferences(显式) → openPeek({locations, symbolHint, navigate})
      │                                    ▼
      │              ReferencesPeekDialog → confirm → navigate(location) 端口
      │                                    ▼
      │              editor 域 navigateToLocation → NavigateGoal
      └─ false → navigateToLocation（既有跳转）
      │ 无结果 → 既有 No Definition 提示
```

### 契约

```ts
// useCmdClickGoToDefinition.ts
export function isOnDefinitionSite(
  currentUri: string,
  line: number,
  character: number,
  location: LspLocation,
): boolean; // 同文档（fileRefFromLspUri + sameFile）+ 同行 + character 落在 [start, end) 内
```

- 同文档比较：先精确字符串相等，其余一律走**身份所有者** `fileRefFromLspUri` + `sameFile`
  （红线 12：消费侧不得自造归一）；任一侧解析失败 → false。
- 命中区间按 LSP 协议取**半开** `[start, end)`：`end` 处已不属于该符号（点 `myFn` 后的
  `(` 不算落在定义名上，走跳转语义）。
- `symbolHint` 取点击处 `wordAt` 切片，仅用于弹窗标题。
- F12 键盘链路不进分流（`runGotoDef` 保持纯跳转）。

```ts
// symbol-nav/store/referencesPeekStore.ts —— 跳转经端口注入（DIP）
export type PeekNavigate = (location: LspLocation) => Promise<void>;
openPeek(opts: { projectId; projectPath; languageId; locations; symbolHint?; navigate: PeekNavigate }): void;
```

**为什么是端口而不是 `openProjectFile`**（2026-09-23 修正）：`openProjectFile` 走
`readFileContent`，对 `jdt:/…` 展示路径与项目外路径必然读盘失败；且 jdt 目标需要
`readOnly + virtualUri`（后续 tab 内 LSP 请求要靠原始 `jdt://` uri 定位 IClassFile），
只有 editor 域的 `navigateToLocation` 建得对。因此 store **不持有任何跳转实现**：
editor 在 `openPeek` 时注入绑定好当前 tab 上下文的端口，store 只调它。

## 3. 关键决策与权衡

| 决策 | 选项 | 选择与理由 |
|---|---|---|
| 徽标通道 | A.复活 hover docs / B.新 decoration widget | B。docs 在 mod 按住时被抑制是为了解决定位截获旧坑（`lspHoverExtension.ts:68-71`）；widget 走 decoration，不进 tooltip，不重引。 |
| 展示 | A.复用 Find Usages 弹窗 / B.新建内联 peek | A。YAGNI + OCP：弹窗已支持空态、过滤、键盘导航；内联 peek 需虚拟滚动+预览取数，二期。 |
| 计数 | A.悬停先探计数 / B.不计数直接弹框 | B（用户 09-21 确认）。计数探针省掉一次 LSP 往返 + 无失败面；空结果由弹窗空态承载。 |
| 仅函数过滤 | A.kind 查表 / B.不过滤 | B（用户已确认）。`references` 对非函数自然返回空；避免语言分支违反红线 15。将来若要真过滤，加 `LspPlugin` 数据字段下沉，而非通用模块白名单。 |
| macOS/Windows | `IS_MACOS ? metaKey : ctrlKey` | 沿用 `useCmdClickGoToDefinition` 与 `modKeyState` 同一判定，不新增第三种。 |

## 4. 兼容与边界

- 空 LS / 未启动会话：点击照常发起 `definition`/`references`，失败走既有 toast；不影响下划线与跳转。
- 大文件/慢 LS：点击为单次显式 `findReferences`，无悬停探针、无洪水面。
- 事件名：无新增 Tauri 事件；弹窗与编辑器经 store 直接调用，不新增事件字符串（守事件常量化红线）。

## 5. 运维与回滚

- 回滚点：仅前端改动，`git revert` 单提交即可；`useCmdClickGoToDefinition` 的分流以纯函数 + 单分支呈现，摘除即回退纯跳转。
- 风险文件：`useCmdClickGoToDefinition.ts`（扩展身份抖动会触发 CM reconfigure，需保持 `useMemo` 依赖稳定，只进标量+稳定引用）。

## 6. 原型落地实现方案（v3：VSCode 式 References Peek）

原型：`prototype/references-peek.html`（左列表右预览，标题 `文件 — References (N)`，`↑↓` 切换 / `↵` 跳转 / `esc` 关闭）。

### 6.1 形态映射（原型 → 生产组件）

| 原型区 | 生产实现 | 数据来源 |
|---|---|---|
| 标题栏（文件 + References (N) + ×） | 新 `ReferencesPeekDialog`（复用 `Dialog`，挂 `AppShell`，与 `SymbolNavPalette` 同层） | 选中项 + 去重后引用总数 |
| 左列表（按文件分组 + 计数 + 单行片段） | 按 `uri` 分组，组头双行（文件名 + 完整目录，均带 title 悬停）+ 右侧计数；列表宽 340px，中间分隔条拖拽/键盘可调（220–600px 钳制） | `findReferences` 的 `Location[]` + 每文件一次文本拉取 |
| 右预览（上下文代码 + 命中行高亮） | 只读 CodeMirror（`ReferencesPeekPreview`）：语言扩展与语法配色均复用编辑器同源（`getLanguageExtension` + `neekoSyntaxTagStyles` 单一事实源），缺包回落纯文本；预览给整文件（>2000 行以命中为中心开窗），挂载即滚到命中行；弹窗本体原生 resize 可调 | 同左（同一份已拉取文本，同文件多引用共用行数组） |
| 底部操作栏 | `↑↓ navigate · ↵ go to · esc close`（沿用既有 palette 文案体例） | — |

### 6.2 数据流

```
定义处 Ctrl+Click ──▶ findReferences ──▶ openReferencesPeek({ locations, symbolHint })
      │ 按 uri 去重分组（Map<uri, Location[]>，保持服务器返回顺序）
      ├─▶ 组内每 uri 一次文本拉取（项目内走既有 readFileContent；项目外/jdt 走
      │    definition 预授权通道；失败该组显示 uri + 行号，不阻塞他组）
      └─▶ 切片：命中行上下各取 CONTEXT=3 行 → items（含 filePath/line/col/preview/matchRange）
                                              ▼
                        ReferencesPeekDialog（左列表 + 右预览 + 键盘导航 + confirm 跳转）
                                              ▼
                        editor navigateToLocation → NavigateGoal（注入端口，见 §2 契约）
```

### 6.3 关键决策

| 决策 | 选择与理由 |
|---|---|
| 新弹窗 vs 改造旧弹窗 | 新 `ReferencesPeekDialog`，`SymbolNavPalette`（`Shift+F12` 入口）零改动——OCP，加法不碰既有行为 |
| 预览渲染 | 只读 CM + 共享 `neekoSyntaxHighlighting()`（与编辑器同色，配色单源）；回落纯文本，不断渲染 |
| 状态归属 | 新建 `symbol-nav/store/referencesPeekStore.ts`（zustand，与 `symbolNavStore` 同域并列），不污染既有 `findUsages` 状态机 |
| 文本拉取 | 按 uri 去重后并发拉取（`Promise.allSettled`，单文件失败只影响该组）；引用数 >200 沿用既有截断体例；超大文件截断预览行 |
| 语言无关 | 分组/切片只认 `uri + range`，无 `languageId` 分支（红线 15）；jdt 目标复用既有 classfile 读取通道 |
| 弹窗默认尺寸 | `94vw × 80vh`（上限 1600×900，下限 640×380），原生 `resize` 可调——引用列表行多，默认大窗免滚动扫读 |

### 6.4 文件清单（预估 ≤5 文件，同层单 feature 内聚）

1. 新增 `src/features/symbol-nav/store/referencesPeekStore.ts`（分组 + 文本拉取 + 选择态，纯 store + 薄 async action）
2. 新增 `src/features/symbol-nav/ReferencesPeekDialog.tsx`（左列表右预览 + 键盘导航，`React.memo`）
3. 新增两者单测（分组/截断/失败隔离；弹窗键盘导航/空态）
4. 改 `useCmdClickGoToDefinition.ts`：定义处分支改调 `referencesPeekStore.openPeek`（1 处调用点替换，含 `navigate` 端口注入）
5. 改 `AppShell`（或 `AppModals`）：挂载新弹窗（与 `SymbolNavPalette` 并列 1 行）

### 6.5 验证与回滚

- TDD：分组纯函数 → store action（含失败隔离）→ 弹窗交互 → 接线替换；每步红绿确认。
- 门禁：`pnpm lint:fe`（含 468+ 文件全量回归）+ `pnpm type-check`。
- 回滚：摘除 `useCmdClickToDefinition` 定义处分支即回退纯跳转；新文件删除无残留。
