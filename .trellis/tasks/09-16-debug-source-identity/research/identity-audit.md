# 身份比较审计表（R1 义务）

> 目的：R1 要求「所有『同一文件』判定走 `FileRef`」，且**不许只修被指出的那一处**。本表是该义务的
> 结论台账：逐处标注「身份比较」还是「合法的展示/解析/派生」。
>
> 口径（grep）：`src/` 下生产代码中 `replace(/\\/g, '/')`，**不含 `__tests__`**。
> 判据：**输出被用来决定「是不是同一个文件」⇒ 身份比较**（必须走 `FileRef`）；输出只用于展示、URL、
> 树结构、命令/包名派生，或作为**边界处的 key 归一** ⇒ 合法保留。
>
> 状态：**全部核实完毕（2026-09-16，第二轮修订）**。结论：**6 处身份比较**（5 处已收敛 + 1 处低危记录）、
> 其余为合法。
>
> ⚠️ **本表第一版的计数是错的（2026-09-16 复审订正）**：第一版声称「28 处」，但**口径从未被脚本执行**，
> 实测（`git show HEAD` 逐 blob 计数）为 **36 处 / 24 文件**；表格逐行覆盖 ≈31 处，另有 **3 个文件 5 处
> 完全未分类**（`browser/hooks/useBrowserTab.ts` ×2、`quick-open/fileIndex.ts` ×2、
> `quick-open/store/recentFilesStore.ts` ×1）。其中 `useBrowserTab.ts` **正是同一个 bug 的孪生副本**
> （第四消费方，第一版漏计）。**教训：口径写成叙述 = 没执行；必须写成可跑命令。**

## 〇、生产者契约（核实所得，2026-09-16）

`file-changed` 事件由 Rust watcher 发出（`src-tauri/src/common/file/watcher/debounce.rs:96-104`）：
`paths` 是**项目相对路径**（`strip_prefix(project_root)` + `\` → `/`）；**strip 失败时回退为绝对路径**。
这一条事实决定了所有消费侧的比较必须做「相对/绝对」双向归一 —— 靠字符串等值或 `endsWith` 拼接都不成立。

> 教训：本表第一版把 HtmlPreview 定性为「误命中同后缀」、第二版改为「词法差异偶发漏配」，
> 两版都不对。**去读生产者**才得出真因（正常路径下**恒不命中**）。凡断言「X 会/不会命中」，
> 先确认产出方的数据形态。

## 一、身份比较（本切片收敛目标）

| 落点 | 现状 | 收敛动作 |
|---|---|---|
| `src/features/runner/sourceTab.ts:75-78`（`.find((t) => t.data.filePath === identity)`） | 裸字符串等值找既有 tab；比较值来自 `sourceIdentityOf` | 改在 `FileRef` 上比较（`sameFile`）。性质 = **机制加固**：已核实当前各生产者都经 `canonicalFsPath`/`normalizePath`/`jdtDisplayPath`，无可复现的重复 tab 输入（见 PRD Background 的撤回说明） |
| `src/features/editor/stopMatch.ts:12` + `debugPathsMatch` | `\`→`/`、去尾斜杠，再允许「互为后缀」 | 换到 `FileRef`/`sameFile`；其「只对非规范输入可达」的第三分支已删（见下「已闭环」） |
| **`src/features/editor/components/HtmlPreview.tsx:112-121`（本次新发现，**已修**）** | 判断 `file-changed` 是否涉及本文件 | **恒定缺陷（生产者证据）**：事件路径为项目相对、本组件 `filePath` 为规范绝对 ⇒ 等值不命中、`endsWith('//abs')` 恒假 ⇒ **预览永不自动刷新**。已改为 `sameFile(fileRefFromTabPath(root, p), fileRefFromTabPath(root, filePath))`（root 取自 projectStore）；新增 3 例（canonical 命中 / 重复斜杠命中 / 他文件不命中），前两例在改前为红 |
| **`src/features/browser/hooks/useBrowserPanelEvents.ts:201-206`（本次新发现，**已修**）** | 判断浏览器当前 file:// 文件是否在变更列表 | 拼接 `${projectRoot}/${rel}` 在两种真实形态下漏配：① 事件回退为**绝对路径**时拼成 `/repo/repo/...`（恒不命中）；② 项目根带尾斜杠/`rel` 带重复斜杠。漏配后果 = **面板不刷新、显示过期内容**。已改为 `sameFile` 比较；新增 4 例（canonical / 绝对回退 / 尾斜杠 / 重复斜杠），后三例**已实证改前为红** |
| **`src/features/browser/hooks/useBrowserTab.ts:222-224`（第二轮复审新发现，**已修**）** | 编辑器 Browser **tab** 的 file:// 自动刷新判定 | 与上一行**同一个 bug 的孪生副本**：`${projectRoot}/${rel} === browserFileNorm`。第一版台账声称「`file-changed` 消费方共 3 处」⇒ **漏计**，实际 ≥4。已改为 `pathsContainFile`；新增 4 例（canonical / **绝对回退** / 尾斜杠+重复斜杠 / 他文件），**绝对回退与尾斜杠两例改前为红**（`expected "vi.fn()" to be called 1 times, but got 0 times`）。注：该分支仅在 `isProjectAutoRefreshArmed(projectId)` 时生效（同文件 `:183` 武装） |
| **`src/features/quick-open/store/recentFilesStore.ts:28-35`（第二轮复审新发现，**未收敛**）** | 「最近文件」列表的**去重键**：`prev.filter((e) => e.filePath !== norm)` | **是身份比较**（同一文件只保留一条最近记录），但只做斜杠归一 ⇒ 重复/尾斜杠形态会留重复条目。**低危**（重复行，非功能失效）：`record()` 的调用方（`openFile.ts:42` 走 `canonicalFsPath`、`trackActivity.ts:18` 取 `tab.data.filePath`）当前形态一致。记录在案，建议随「`dap-source:` 身份文法闭合」一并收（见 §六） |

## 二、合法保留（展示 / URL / 结构 / 派生 / 边界归一）

| 落点 | 用途 | 判定依据 |
|---|---|---|
| `src/shared/components/ChangeFileTree.tsx:41` | 变更列表建树（按 `/` 分段） | 输出用于树结构，不参与同文件判定 |
| `src/ui/MarkdownPreview.tsx:24,26,27` | 图片 `src` → `asset:` URL（`convertFileSrc`） | URL 构建 |
| `src/shared/utils/fileTree.ts:183`（`getFileName`） | 取文件名用于显示 | 展示 |
| `src/shared/utils/browserUtils.ts:10,14`（`resolveAbsolutePath`） | 相对 → 绝对路径**解析** | 边界解析（与 `canonicalFsPath` 同职责；见下方 DRY 观察） |
| `src/shared/utils/browserUtils.ts:23` | 本地路径 → `file://` URL | URL 构建 |
| `src/shared/utils/languageRegistry.ts:95,103`（`extensionOf` / `baseNameOf`） | 取扩展名 / 文件名查语言表 | 查表 key 是「文件名」，非同文件判定 |
| `src/shared/utils/markdownLinks.ts:10,24`（`resolveInternalHref` + `normalizePath`） | md 内链 → 绝对路径（折叠 `.`/`..`） | 边界解析 |
| `src/shared/utils/gitFileDecoration.ts:165` | git 输出路径 → 内部 map key（确定性归一，无模糊匹配） | 边界归一 |
| `src/features/git/components/gitlog/commitListUtils.ts:180`（`splitFilePath`） | commit 行「文件名 + 目录」 | 展示 |
| `src/features/git/components/diff/diffViewUtils.ts:8`（`splitFilePath`） | diff 行「文件名 + 目录」 | 展示 |
| `src/features/editor/breadcrumb.ts:38`（`normalize` + `splitBreadcrumb`） | 面包屑分段 | 展示 |
| `src/features/editor/hooks/useFileEditorState.ts:52-59`（`basePath`） | 预览 / 资源基准目录 | 展示/解析（内部用 `resolveAbsolutePath`） |
| `src/features/lsp/api/languageMap.ts:134,141`（`toFileUri`） | 路径 → LSP `file://` uri | 边界编码 |
| `src/features/symbol-nav/store/symbolNavStore.ts:75` | 引用项标签取 basename（`filePath` 原样携带为身份） | 展示 |
| `src/features/file/utils/fileTreeUtils.ts:20`（`getParentPaths`） | 各级父目录（树展开） | 树结构 |
| `src/features/file/utils/javaPackageTree.ts:17,26` | 判定 Java 源根 / 是否位于源根下（正则） | 树结构/派生 |
| `src/features/runner/languages/go/pkg.ts:47`（`pkgDirRelativeToModule`） | 文件所在目录相对 module 根 | 命令构造派生（`:65` 已用 `relativeToRoot`） |
| `src/features/runner/languages/rust/commands.ts:164`（`resolveTestTargetFlag`） | 路径形状 → cargo target flag | 命令构造派生 |
| `src/features/runner/languages/java/commands.ts:39`（`deriveJavaFqcn`） | 路径布局 → FQCN | 命令构造派生 |
| `src/features/quick-open/fileIndex.ts:17,25`（`flattenFilePaths` / `normalizeProjectRelative`） | 文件索引条目 + 去 `./` 前缀 | 派生（索引条目，不参与同文件判定；`normalizeProjectRelative` 目前无第二个消费者） |

## 三、附带观察（不属 R1，供后续决策）

- **两个「相对 → 绝对」解析器并存**：`shared/utils/browserUtils.ts:9`（`resolveAbsolutePath`）与
  `shared/utils/fileRef.ts`（`canonicalFsPath`）。语义重叠（都不折叠 `..`），但**后者才是身份所有者**；
  前者被 `useFileEditorState` 等展示路径使用。**不建议**在本切片合并（会牵动展示层），但应记录：
  新增代码需要「拼根」时一律用 `canonicalFsPath`，`resolveAbsolutePath` 只服务展示/资源定位。
- **三处新发现的后果都是「少刷一次变更 → 用户看到过期内容」**；其中 HtmlPreview 是**恒定**不刷新（生产者证据），
  应视作用户可感知的既有缺陷（不在 issue #13 范围，但同根因）。三处均已修并用例锁定，且新增用例
  **逐个实证过「改前为红」**（不是靠叙述断言）。
- **`file-changed` 的消费方共 4 处**（`useFileTabRefresh` / `HtmlPreview` / `useBrowserPanelEvents` /
  **`useBrowserTab`**）：前身各写一套比较（`relativeToRoot`+`includes`、等值+`endsWith`、`${root}/${rel}` 拼接），
  其中三处会漏配。**第一版台账把 `useBrowserTab` 漏掉了**（当时写「共 3 处」）—— 这正是 R1
  「不许只修被指出的那一处」要防的事。四处的判定现已全部收敛到 `pathsContainFile`，新增消费方一律用它。

## 四、已闭环（本任务前序提交）

- `stopMatch.debugPathsMatch` 的第三分支（只对非规范输入可达）已删除，前置条件写入模块头注释。
- `sourceTab` 的两个 store 读取（`targetTabKey`/`resolveProjectPath`）已下沉到入口层 `navigate.ts`。

## 五、实施收口（R1/R2/R3，2026-09-16 完成）

新增身份原语（`src/shared/utils/fileRef.ts`，`sameFile` 之上的两个消费侧便捷函数，避免调用方各自拼 `FileRef`）：

- `sameIdentity(a, b)`：两个**字符串身份**是否同一文件（内部按普通路径形态构造 `FileRef`）；
- `pathsContainFile(root, paths, filePath)`：`file-changed` 事件的 `paths`（项目相对或绝对）是否包含某文件。

六处身份比较的收敛结果：

| 落点 | 收敛方式 | 测试 |
|---|---|---|
| `HtmlPreview.tsx` | `pathsContainFile(root, event.paths, filePath)` | 4 例（canonical / **绝对回退** / 重复斜杠 / 他文件） |
| `useBrowserPanelEvents.ts` | `pathsContainFile(project.path, paths, browserFilePath)` | 4 例；**后 3 例已实证改前为红** |
| **`useBrowserTab.ts`**（第二轮复审补修） | `pathsContainFile(project.path, paths, browserFilePath)` | 4 例；**绝对回退 / 尾斜杠+重复斜杠 2 例实证改前为红** |
| `useFileTabRefresh.ts` | `pathsContainFile(projectRoot, paths, tab.data.filePath)`（原 `paths.includes(relativeToRoot(...))`，与另三处口径不一） | 既有用例 |
| `sourceTab.ts`（R2） | `sameIdentity(identity, t.data.filePath)` | 1 例（既有 tab 存非规范形态 → 复用，改前红：会开出第二个 tab） |
| `stopMatch.ts`（R3） | `debugPathsMatch` 委托 `sameIdentity`；删除「互为后缀」容忍 | 重写为「形态归一相等 / 不同文件不等 / **不再**做相对绝对混比 / 空值早退 / 不做身份转换」5 组 |

`recentFilesStore.ts` 的去重键（第 6 处）**未收敛**：低危（只产生重复行），与 §六 的 `dap-source:` 文法闭合同批处理。

**R2 的性质如实说明（含边界）**：该例输入（既有 tab 存 `…/src//A.java`）在当前代码里**没有任何生产者会产出**
（各入口都经 `canonicalFsPath`/`normalizePath`/`jdtDisplayPath`），因此它是**机制加固的护栏**，不是 bugfix；
但该断言在改前**确实为红**（字符串等值漏判 ⇒ 二次建 tab），说明「复用同一 tab」这条不变式此前只靠约定维持。

⚠️ **R2 的保证范围必须如实限定为「形态归一」**（实测）：
`sameIdentity('/repo//src//A.java','/repo/src/A.java') = true`，但 `sameIdentity('src/A.java','/repo/src/A.java') = false`
—— `sameIdentity` 走空 root，**没有 root 就无法归一「相对 vs 绝对」**。所以「历史 / 会话恢复出的**根相对形态** tab」
仍会漏判。若要把它也变成机制保证，需把 `projectPath` 传进 `ensureSourceTab` 用 `fileRefFromTabPath(root, …)`
两侧比较（`navigate.ts` 每个入口都已有 `resolveProjectPath(projectPath)`，改造成本很小）；**在此之前不得声称
R2 覆盖相对/绝对**。

**R3 的契约变更（破坏性，需知悉）**：`debugPathsMatch` 原先允许「绝对 vs 相对互为后缀」（`/repo/a.go` vs
`a.go` 命中）。调用方两侧都已是规范身份（`location.identity` 来自 `buildStopLocation`/`sourceIdentityOf`；
tab 侧来自 `tabIdentityOf`），该容忍的唯一可达路径是**非规范输入**，且它是**真实误命中源** ——
`a.go` 会命中任意目录下的同名文件。相对/绝对混比属**边界解析**职责，由
`pathsContainFile`/`canonicalFsPath` 在入口归一，不在身份比较里兜。

其余为合法展示 / URL / 树结构 / 命令派生 / 边界归一，不做改动（见第二节）。

## 六、已知洞（留给后续切片）—— `dap-source:` 不在身份文法里

**实测（探针，非推断）**：

```
fileRefFromTabPath('/repo', 'dap-source:/42/Foo.java') = { kind:'fs', path:'/repo/dap-source:/42/Foo.java' }
sourceIdentityOf('/repo', 'dap-source:/42/Foo.java')   = '/repo/dap-source:/42/Foo.java'   ← 非 'dap-source:/42/Foo.java'
sourceIdentityOf('/repo', 'jdt:/java.base/java/io/PrintStream.java') = 原样（幂等 ✅）
```

`fileRefFromTabPath` 只认 `jdt:/`（展示）与 `jdt://contents/`（uri），**不认 `virtualSourceIdentity` 产出的
`dap-source:` 前缀**，于是它被当作**相对路径**拼上项目根。即身份构造点**对虚拟身份不幂等**
（`id(id(x)) ≠ id(x)`），而幂等是「同一份源码只有一种身份」这条不变式的最低要求。

**已核实的三条后果**：

1. `FileEditor.tsx:61-62` 的 `absFilePath` 对虚拟 tab 是**伪路径** `/repo/dap-source:/42/Foo.java`；
2. 同一值还是**断点 key**（`useEditorBreakpoints.ts:30,36`：`breakpoints[projectId][absFilePath]`）
   经 `useBreakpointGutter.ts:208` 的 `toggleBreakpoint(projectId, filePath, line)` **下发给后端**。
   后端确实设计了「按规范身份翻译」这一层（`src-tauri/src/dap/manager.rs:742-749`：`jdt:/…` → 真实路径，
   翻译失败按原样落回）—— 也就是说**协议上后端期待收到的是规范身份**，而 `dap-source:` 被拼根后
   连翻译都无从谈起（`jdt:` 能翻，`/repo/dap-source:/…` 不能）。所以这不是「理论不优雅」，
   而是**已经流到后端翻译层的错误输入**；
3. 任何**新**消费者若用 `absFilePath` 与 `location.identity` 比较，**恒不命中且静默** —— 与 issue #13 同一失败模式。

**这解释了两件事**：

- 为什么 `resolveDebugHighlightLine(absFilePath, tabFilePath, …)` 要**同一个文件收两个参数** —— 那是绕过本洞的
  权宜：虚拟 tab 只靠第二个参数（`tabFilePath === 'dap-source:/42/Foo.java'`）命中，而该分支的测试**此前为零覆盖**
  （切片 3 补上了，否则删掉它不会有任何用例变红）；
- 为什么 `sameIdentity` 必须走**空 root** —— 只有 root 为空时 `canonicalFsPath` 才不拼根，`dap-source:` 才原样保留。
  换句话说 `sameIdentity` 对虚拟身份「恰好能用」，而不是「设计上正确」。

**两个候选修法**（择一，需独立切片 + 自己的 Red）：

- **A（不透明透传，最小改动）**：`fileRefFromTabPath` 识别 `dap-source:` 前缀 → 直接返回
  `{ kind: 'fs', path: p }`。`sourceIdentityOf` 随即幂等，`absFilePath` 变成真身份，`tabFilePath` 参数与
  回退分支可删。风险：`lspUriOf(fs)` 会给出 `file://dap-source:/…`（今天给的是更糟的 `file:///repo/dap-source:/…`），
  需确认虚拟 tab 上 LSP 是否启用。
- **B（补一个 FileRef kind）**：`{ kind: 'virtual'; reference: number; name: string }`。语义最正，`sameFile` 多一个
  case；但要动 `tabIdentityOf` / `lspUriOf` / `getFileName` 面，成本更高。

**建议**：选 **A**，同一批处理掉 `recentFilesStore` 的去重键；在**做之前**先补两条锁定用例
（`sourceIdentityOf(root, virtualId) === virtualId` 与 `FileEditor` 虚拟 tab 的 `absFilePath === location.identity`），
再改实现 —— 否则无法证明修的是同一个洞。

