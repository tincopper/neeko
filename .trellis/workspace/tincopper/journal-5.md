# Journal - tincopper (Part 5)

> Continuation from `journal-4.md` (archived at ~2000 lines)
> Started: 2026-09-25

---



## Session 230: git discard 统一入口 + 写后快照新鲜度（watcher-lifecycle 任务收尾归档）

**Date**: 2026-09-25
**Task**: git discard 统一入口 + 写后快照新鲜度（watcher-lifecycle 任务收尾归档）
**Branch**: `main`

### Summary

discard 三入口两命令收敛为 discard_files(paths) 唯一入口（后端按仓库状态分类分派、pathspec 分批、rename 双侧恢复）；前端 DiscardIntent 纯函数域保证确认文案与执行范围同源，GitCommitPanel 297→236 行（useFileSelection/useDiscardConfirm/useGitDialogRequest 三 hook 下沉、JSX 回调稳定化）；GitExecError 补 exit_code、unstage 兜底改 rev-parse 确定性 HEAD 判定；status worker 新增 started/completed 进度对与 check_and_wait 有界等待（1.5s 上限，命令层经 run_blocking），消除写后首刷旧值窗口。审核 4 Nit 全部优化。为 09-24-watcher-lifecycle-and-git-lock 任务补 Step 4 收尾：AC1 现场复验（29 批次零重复发射）+ 全门禁复跑（lib 1362 / integration 103 / 前端 4250）+ spec 沉淀（git-domain §9-11、concurrency watcher 所有权契约）后归档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f2fd39ca` | (see git log) |
| `53ebc610` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 231: AGENTS.md 治理收口（体积预算/台账校验/章节去重）+ 贡献指南去镜像

**Date**: 2026-09-25
**Task**: AGENTS.md 治理收口（体积预算/台账校验/章节去重）+ 贡献指南去镜像
**Branch**: `main`

### Summary

AGENTS.md 治理收口：护栏体积预算由「三文件求和」改为「root + 单个嵌套」（Codex 只拼 cwd 祖先路径；修正前仅剩 951 B 余量，且真实危险组合无人监控）；红线台账新增摘要列（嵌套未加载时的兜底）与「行标题必须含签名」校验（抓出红线 14 标题漏「必须」）；非红线章节全量去重（root 的目录/编号/playbook 副本 + 侧文件已漂移的目录表与重复的 TDD/覆盖率阶梯）；清算旧 neeko-check「支柱」编号体系（支柱 12 = 现红线 5，不能按数字平移），src/ 与 src-tauri/ 已清零；中英两份贡献指南由规则镜像改为落点索引并修掉 6 处漂移。护栏单测 26（+12）。

### Main Changes

AGENTS.md 治理收口（A→F）+ 贡献指南去镜像，3 个提交。

**A 体积预算口径修正** —— `check_agents_md_size.py` 的 `TOTAL_CAP`（三文件求和）改为
`PAIR_CAP`（root + 单个嵌套）。依据：Codex 只拼接 cwd 的**祖先路径**，三份永不同时加载；
求和设限既凭空压低预算（修正前合计仅剩 951 B 余量，而单文件各自还显示 13%/64%/42%），
又漏监控真实危险组合。单文件上限统一 16 KiB（原 14,336/18,432/18,432，其注释「实测值 +20%」
与常量不符）。

**D 台账摘要列** —— 红线表新增「必须 / 禁止（摘要）」列，作为嵌套文件未加载时的最小可执行
摘要（校验非空 + ≤200 B）。此前 root 只有规则标题，Codex 从仓库根启动时 agent 拿到的是规则名
而非可执行判据。摘要只在表格行内、不参与落点判定，故不会变成第二份正文。

**C 台账标题校验** —— `report_ledger` 新增「行标题必须包含该编号签名」，抓出真实漂移：红线 14
台账标题漏「必须」（正文标题一直带）。经**变异测试**验证有牙齿（改回漂移态即 exit=1，还原后
与原文件 hash 逐字节一致）。约定补充：交叉引用一律写 `红线 N`，不复述标题 —— 复述标题即造
第二个名字；同时让「形态判定分不清引用与正文」在约定上不再需要分。

**B 非红线章节去重** —— root 侧删：src-tauri 子目录副本、红线编号清单（编号单源改为表格的
`全文位置` 列）、硬编码计数「11 / 1 条」、单侧 playbook（下放并回补信息）、入口点契约词；
侧文件删：跨栈规则枚举、重复的 TDD 硬约束句与覆盖率阶梯（改指针）、以及**已漂移**的目录副本
—— src-tauri 域目录表列了不存在的 `skill/`、漏了 `about/` `library/` `search/`，`src/shared`
漏了 `constants/` `events.ts`。漂移实证是「删副本而非修副本」的决策依据。

**E 测试死代码** —— 删 `reset_cache()`（`actual_homes` 已无 cache 参数，`__defaults__` 恒 None，
helper 与 2 处调用皆不做事）；`RealRepoTest` 显式钉住 `REAL_REPO`，不再依赖其他用例的
`addCleanup` 顺序。

**F 旧编号体系清算** —— `支柱 12` 经 git 历史证实是旧 neeko-check 体系的**正式术语**（15/13 条、
编号与现「红线」不同；`journal-4` 记「修支柱12双端硬编码」= Event 名常量化），故修正为**红线 5**
而非按数字平移（两体系条目不一一对应，`支柱 13` 在现体系无对应项）。全域清点：`src/` 与
`src-tauri/src/` 中「支柱」清零；其余编号引用（8/12/14/15）主题均正确；归档任务与工作日志中的
历史记录**不回改**（`.qoder/worktrees/**` 是独立 worktree 副本，不在范围）。

**CONTRIBUTING 中英双份收敛** —— 两份指南原本逐条镜像 AGENTS.md 规则，改为落点索引，保留人专属
内容（环境/快速开始/常用命令/提交规范/质量门/分支 PR/文档/发布）。同时修掉保留段落里的 6 处漂移：
Node.js 18+（实际 `engines` >=24）、pnpm 9.12.2（实际 `packageManager` 11.25.0）、`pnpm lint`
描述漏 6 个 Python 护栏 + 护栏单测 + Java host、lefthook hook 表缺 `tools/java-host/**` 与
`**/AGENTS.md` 两条、最小回归集自成一份定义、以及指向不存在章节的**悬空指针**。

**护栏覆盖边界** —— 护栏 docstring 新增「范围」条目：脚本只管 15 条红线与三份文件的体积，
非红线章节的去重靠元规则（「子目录清单一律以 ls / Glob 为准」）+ AI 审查（同红线 13 的处理方式），
并记录本次清理清单与漂移证据。`docs/` 已复核无规则镜像（命中项均为指向 AGENTS.md 的链接或
该文档自身主题）。

### 验证

- `check_agents_md_size.py` 通过（root 13,989 / 16,384；root+src-tauri 24,836 / 30,720）
- 护栏单测 **26 条 OK**（+12）；6 个 Python 护栏逐个通过
- lefthook：提交 1 走 `guard-agents-md`（26 测试 + 全量校验），提交 2 走完整 `pnpm lint:fe`
  （eslint + tsc + vitest typecheck），提交 3 走 `commitlint`；全程未用 `--no-verify`
- `vitest run terminalRenderer.test.ts` → 56 tests passed
- 9 个改动文件 NUL=0 / CR=0；中英贡献指南标题层级 13/13、14 个 TOC 锚点全部可解析

### 提交拆分约束（供后来者）

护栏脚本与它治理的 `AGENTS.md`（root）**必须同一提交**：新脚本要求 4 列表 / 旧表是 3 列 → 只提交
脚本则该提交护栏即红；反之只提交 4 列表则旧脚本解析失败。这比 `git add -p` 拆 hunk 更可靠，也避免
留下坏的中间提交。


### Git Commits

| Hash | Message |
|------|---------|
| `512d9cf6` | (see git log) |
| `f25d2ec0` | (see git log) |
| `e3b706df` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 232: 护栏脚手架：tools/guards 框架取代三份手抄清单

**Date**: 2026-09-26
**Task**: 护栏脚手架：tools/guards 框架取代三份手抄清单
**Branch**: `main`

### Summary

把 6 条 check_*.py 护栏迁进 tools/guards 框架：注册表=checks/ 目录本身（放文件即生效，删文件即下线），stage/scope 由护栏自述，package.json/ci.yml/lefthook.yml 三份手写清单收敛为三次单行调用。框架统一兜住仓库根定位（全仓一处，禁 parents[N]）、反空转（scanned=0 判护栏失效而非通过）、退出码三档（0/1/2 可区分违规与工具坏了）、强制配套单测。顺带修两处真实缺陷：font_family 与 codemirror 护栏此前只挂本地 lint、CI 从不执行；worktree 护栏的 git 术语表匹配不到 git_commit() 导致误豁免。台账数据（MANIFEST / SIZE_CAPS / SIGNATURES）外置到 ledger/*.json。pnpm lint + 110 单测全绿。

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
