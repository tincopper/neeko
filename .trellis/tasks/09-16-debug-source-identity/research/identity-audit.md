# 身份比较审计表（R1 义务，进行中）

> 目的：R1 要求「所有『同一文件』判定走 `FileRef`」，且**不许只修被指出的那一处**。本表是
> 该义务的结论台账：逐处标注「身份比较」还是「合法的展示/解析归一」。
>
> 口径（grep）：`src/` 下生产代码中 `replace(/\\/g, '/')` 共 **28 处**（不含 `__tests__`）。
> 判据：**输出被用来决定「是不是同一个文件」 ⇒ 身份比较**（必须走 `FileRef`）；
> 输出只用于展示、URL、树结构、或作为**边界处的 key 归一**（供 map 查表）⇒ 合法保留。
>
> 状态：6 处已核实（下两节）；其余 22 处**尚未逐个核实** —— 实施时按同一判据补齐，禁止凭模块名推断。

## 已核实：身份比较（本切片收敛目标）

| 落点 | 现状 | 收敛动作 |
|---|---|---|
| `src/features/editor/stopMatch.ts:12`（`normalizePath`）+ `debugPathsMatch` | `\`→`/`、去尾斜杠，再允许「互为后缀」 | 换到 `FileRef`/`sameFile`；其「只对非规范输入可达」的第三分支已于 `09-16-debug-stop-reveal` 删除 |
| `src/features/runner/sourceTab.ts:78`（`.find((t) => t.data.filePath === identity)`） | 裸字符串等值（比较值来自 `sourceIdentityOf`） | 改为在 `FileRef` 上比较；性质是**机制加固**（已核实当前无重复 tab 的可复现输入，见 PRD Background），无可复现 Red |

## 已核实：合法保留（展示 / 结构 / 边界归一）

| 落点 | 用途 | 判定依据 |
|---|---|---|
| `src/features/git/components/gitlog/commitListUtils.ts:180`（`splitFilePath`） | commit 行的「文件名 + 目录」 | 注释与实现均为展示拆分，不参与同文件判定 |
| `src/features/editor/breadcrumb.ts:38`（`normalize` + `splitBreadcrumb`） | 面包屑分段显示 | 文档字符串明示「把文件路径拆成面包屑三段」 |
| `src/features/file/utils/fileTreeUtils.ts:20`（`getParentPaths`） | 生成各级父目录（树展开） | 输出用于树结构，不参与同文件判定 |
| `src/shared/utils/gitFileDecoration.ts:165`（`normalizePath`） | 把 git 输出路径归一后**作 map key 查表** | 边界处确定性归一（仅 `\`→`/`，无后缀/模糊匹配），属「入口归一」而非消费侧别名匹配 |

## 待核实（22 处，实施时逐个判定并回填本表）

已定位但**未读上下文**的落点（从 grep 结果摘录，含展示/URL/解析嫌疑，但**未经核实不得下结论**）：

- `src/shared/components/ChangeFileTree.tsx:41`、`src/ui/MarkdownPreview.tsx:24,26,27`、
  `src/shared/utils/fileTree.ts:183`、`src/shared/utils/browserUtils.ts:10,14,23`、
  `src/shared/utils/languageRegistry.ts:95,103`、`src/shared/utils/markdownLinks.ts:10,24`、
  `src/features/git/components/diff/diffViewUtils.ts:8`、`src/features/lsp/api/languageMap.ts:134,141`、
  `src/features/editor/hooks/useFileEditorState.ts:58`、`src/features/editor/components/HtmlPreview.tsx:112`、
  `src/features/runner/languages/go/pkg.ts:47,65`、`src/features/symbol-nav/store/symbolNavStore.ts:75`、
  `src/features/runner/languages/rust/commands.ts:164`、`src/features/runner/languages/java/commands.ts:39`、
  `src/features/file/utils/javaPackageTree.ts:17,26`、`src/features/browser/hooks/useBrowserPanelEvents.ts:201`

## 后续

- 实施时：每读一处 → 回填上表并给判定依据（一行一词即可，但**必须真读过**）。
- 已知会随本切片消失的项：`stopMatch.ts` 的`normalizePath`（被 `FileRef` 取代后不再需要）。
- 相关任务：`09-16-debug-stop-reveal`（切片 1+2，已删除 `stopMatch` 的死分支）。
