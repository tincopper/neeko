# Journal - tincopper (Part 4)

> Continuation from `journal-3.md` (archived at ~2000 lines)
> Started: 2026-09-04

---



## Session 177: StatusBar registry修门禁

**Date**: 2026-09-04
**Task**: StatusBar registry修门禁
**Branch**: `main`

### Summary

子代理交付36 lint+10 tsc；修：Lsp自订阅undefined守卫、认领机制改槽位直写（immutability禁render期可变表）、拆import环、测试改名/规则；tsc/eslint/全量2666通过

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


## Session 178: neeko-check十三支柱审查

**Date**: 2026-09-04
**Task**: neeko-check十三支柱审查
**Branch**: `main`

### Summary

主会话代执行（子代理429限额）；修支柱12双端硬编码：Rust LSP_INSTALL_PROGRESS_EVENT + 前端 events.ts + bridge消费；Rust check/clippy/fmt/955用例、前端tsc/eslint/2667全过

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


## Session 179: StatusBar开发规范文档

**Date**: 2026-09-04
**Task**: StatusBar开发规范文档
**Branch**: `main`

### Summary

新增.trellis/spec/frontend/status-bar.md（registry机制/item契约/bridge规则/互斥决策/测试约定/禁止模式/踩坑），index.md登记；registry任务归档d3c221a2；spec提交0c206bb1

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


## Session 180: Cmd+W 未保存关闭确认修复（任务 09-04-cmdw-unsaved-confirm）

**Date**: 2026-09-04
**Task**: Cmd+W 未保存关闭确认修复（任务 09-04-cmdw-unsaved-confirm）
**Branch**: `main`

### Summary

修复 Cmd+W/Ctrl+W 关闭 tab 绕过未保存确认：确认状态机提升为全局 closeConfirmStore（AppModals 挂 CloseConfirmDialog），三条关闭路径（X/菜单/快捷键）统一走 closeTabWithConfirmation；SaveAsRequest 增加 closeAfterSave 闭环 untitled 保存后自动关 tab；删除 useCloseConfirmation（clean cutover）。门禁全绿：type-check / test:run 2682 passed / lint:fe。spec 沉淀 state-management.md 场景 + 常见错误 10。

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


## Session 181: 修复项目切换时 unlisten 注册竞态 toast（safeUnlisten 收口）

**Date**: 2026-09-04
**Task**: 修复项目切换时 unlisten 注册竞态 toast（safeUnlisten 收口）
**Branch**: `main`

### Summary

用户报错 listeners[eventId].handlerId（项目切换时）。根因：多个裸 unlisten 调用点命中 tauri 注入脚本注册竞态/双重注销。TDD 修复：新增 useFileTreeSync 竞态回归测试（Red→Green），7 处裸调用点收口 safeUnlisten（useFileTreeSync/useDiffData/useAgentChat/tauriTurn/debugStore/taskRunner/terminalFactory/TerminalViewBase）。门禁全绿：type-check / test:run 2683 passed / lint:fe。spec 沉淀 state-management.md 常见错误 11。

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


## Session 182: 编辑器单测运行/调试按钮（任务 09-04-editor-test-run-buttons）

**Date**: 2026-09-05
**Task**: 编辑器单测运行/调试按钮（任务 09-04-editor-test-run-buttons）
**Branch**: `main`

### Summary

CodeLens 风格内联 Run/Debug 按钮：testCases.ts 用例检测（TS test/it + Rust #[test]）、testCodelens.ts CodeMirror block widget（facet+300ms 防抖）、testCommands.ts 命令构造（vitest run -t / cargo test 子串过滤）、runTask options 扩展（cwd 覆盖+观察者+runId）、Rust debug 闭环（cargo --no-run → 解析二进制 → dap_start_session_config lldb 会话）。trellis-check 修复 closeConsoleSession 观察者泄漏 + timer 类型错误。实现期修正：去掉 --exact（嵌套 mod tests 匹配问题）。acp 真实往返测试对齐 serve.rs 惯例标 #[ignore]。门禁：test:run 345 文件 2742 passed / lint:fe / type-check / cargo test 956+100 全绿。

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


## Session 183: 测试按钮二次迭代：gutter 图标 + Run/Debug 下拉（IDEA 交互）

**Date**: 2026-09-05
**Task**: 测试按钮二次迭代：gutter 图标 + Run/Debug 下拉（IDEA 交互）
**Branch**: `main`

### Summary

用户反馈改交互：block widget 替换为行号旁 gutter play 图标（GutterMarker + StateField，检测/防抖复用），点击 Rust 用例弹 shared ContextMenu 下拉（Run/Debug 两项），TS 用例直跑不弹菜单。overlayStore 惯例配对 + 卸载清理。trellis-check 修复 FileEditor 未使用变量（noUnusedLocals 会挂）与 testCases.ts 陈旧注释。门禁：type-check / lint:fe / cargo 不涉及；test:run 5 轮 4 绿，1 轮偶发 2 失败未捕获身份（连续 4 轮复跑全绿，待再现再定位）。

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


## Session 184: S3 git 状态入模：组装期 Join + 子树指纹 memo 落地

**Date**: 2026-09-06
**Task**: S3 git 状态入模：组装期 Join + 子树指纹 memo 落地
**Branch**: `main`

### Summary

实现 09-06-s3-git-status-into-model：git 状态成为视图节点一等属性（组装期盖章 git_status/is_ignored + 逐节点视图状态），删除 resolver 单例。三处实现期修正：①逐节点视图状态必须入模（props 流经父渲染，bail out 后子元素不更新，投影比较失效）；②handleToggleDir 经 ref 稳定身份；③修复存量缺陷——递归引用原始函数绕过 memo，深度节点从未被 memo 保护。渲染隔离从 1 场景扩展到 7 场景（桶重载/展开/击键从整树降为 0~链路）。质量门全绿：type-check / lint:fe / test:run 353 文件 2860 用例。

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


## Session 185: G5 Git Status 路线收尾：diff 刷新回归修复 + 嵌套 gitignore 分层 + 上限统一 + 压测替身

**Date**: 2026-09-06
**Task**: G5 Git Status 路线收尾：diff 刷新回归修复 + 嵌套 gitignore 分层 + 上限统一 + 压测替身
**Branch**: `main`

### Summary

落地 git-changes-redesign-plan 对照核查发现的 4 项收尾：①useDiffData 死监听切换 git-status-snapshot（修复 G2 起停发 v1 事件导致的 diff 自动刷新潜伏回归）；②GitIgnoreFilter 重写为按目录分层 matcher 栈（根因：ignore crate 单 Gitignore 不感知 glob 来源目录，单 builder 会让子包规则全仓泄漏；WalkBuilder 收集 + 深层裁定优先 + exclude 最高优先级）；③status 相关截断上限统一 1000（决策点4，untracked 单目录保持 500）；④G2 压测验收自动化替身（并发信号风暴零 emit + 变更/切分支严格单调 + porcelain 真值一致）。cargo fmt 全仓消除 G2 格式漂移。全部门禁绿：cargo test 1055 / pnpm test:run 2860 / lint / type-check。XY 契约独立立项待做。

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


## Session 186: G6 XY 状态码契约：ChangesList 四组真实分组落地

**Date**: 2026-09-06
**Task**: G6 XY 状态码契约：ChangesList 四组真实分组落地
**Branch**: `main`

### Summary

落地 git-changes-redesign-plan §3.2 核心契约：FileChange 携带 porcelain X/Y 字符 + renamed_from（serde 向后兼容）；parse_status_line 提取 XY/renamed_from；libgit2 路径 status flags → porcelain 词表映射（空侧归一为字面空格）；新增 gitStatusGroups 纯函数派生 staged/unstaged/unversioned/conflicted 四组（同文件可双组，conflicted 独占，缺 XY 回退）；ChangesList 渲染 Staged Changes/Changes/Unversioned/Merge Conflicts 四组 + rename 行 old→new；gitFileDecoration staged 桶转真（临时语义标注移除，realPayload 无 XY 回退保持绿）。门禁：cargo 1060 / pnpm 2870 / lint / type-check 全绿。G 路线至此全部关闭。

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


## Session 187: S4 文件树窗口虚拟化：扁平化 + VirtualList，万级节点渲染 O(可见行数)

**Date**: 2026-09-06
**Task**: S4 文件树窗口虚拟化：扁平化 + VirtualList，万级节点渲染 O(可见行数)
**Branch**: `main`

### Summary

落地调研文档 S4：flattenFileTreeView 纯函数把嵌套视图树按渲染顺序摊平（node/renaming/creating 三种行）；FileTreeNode 递归组件拆为无递归 FileTreeRow（扁平行结构上免除「父 bail out 断供子 props」问题，指纹比较器保留）；FilesPanel 接共享 VirtualList（@tanstack/react-virtual 动态测量，窗口化断言：201 行目录仅挂载视口窗口行）；定位改走 scrollToIndex（虚拟化后目标行可能未挂载）；DEFAULT_TREE_DEPTH 3→2 初始扫描减半。测试基建沿用 OutputScroll 的 offsetWidth/offsetHeight mock 模式。门禁全绿：lint / type-check / 354 文件 2865 用例。调研文档 S 路线至此 S0/S1/S3/S4 完成，剩 S2 排除式监听与 fsmonitor 引导、ignored_files 退役。

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


## Session 188: S2 注册层排除 + fsmonitor 引导 + ignored_files 退役：调研文档全部收口

**Date**: 2026-09-07
**Task**: S2 注册层排除 + fsmonitor 引导 + ignored_files 退役：调研文档全部收口
**Branch**: `main`

### Summary

完成剩余三项（调研文档 S0-S5 与 G1-G6 全部落地）：①S2 排除式监听——registration.rs 平台策略枚举（Linux=Selective 逐可见目录注册、macOS/Windows=Recursive+回调过滤）+ compute_watch_dirs 计划纯函数（超限/失败降级整树）+ 独立维护线程（规避 notify 回调内 watch 的 FSEvents 死锁），ignored 子树在 inotify 注册层不再产生事件；②G7 fsmonitor/untracked cache 引导——perf.rs 检测（>2万文件阈值 + git config 探测，纯决策函数可测）+ 一次性 git-perf-suggestion 事件 + 前端通知（只提示不代改用户仓库配置）；③S5 ignored_files 退役——GitIgnoreFilter 提升为 pub + should_ignore_own（自匹配语义，保「展开 ignored 目录可见内容」穿透性）+ FileNode.ignored 原生标注 + read_dir_tree 签名改 filter 引用 + get_ignored_files/gitStore.ignoredByProject/前端 ignoredFiles props 全链退役，灰显单一事实源收敛到读层。门禁：cargo 1064/0、pnpm 355 文件 2868/0、lint（fmt+clippy+3守卫）全绿、type-check 0。

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


## Session 189: neeko-check 审核修复 + register_selective 降级路径注入化测试

**Date**: 2026-09-07
**Task**: neeko-check 审核修复 + register_selective 降级路径注入化测试
**Branch**: `main`

### Summary

完成 neeko-check 审核整改（1 Block + 3 Warning + 2 Nit）：①perf 线程加 git_repo 门控（对齐 watch() 内非 git 项目跳过约定）；②'git-perf-suggestion' 收入 shared/events.ts 常量（红线12）；③notify 回调内 fs::metadata 移入维护线程（回调零 fs 探测）；④GitIgnoreFilter 两个判定函数提取共用 is_ignored_with（with_parents 参数区分 watcher/read 层语义）；⑤doc 残留 + _root 改名。同步完成 register_selective 降级路径注入化：WatchRegistration 全方法泛化 W: Watcher（生产 RecommendedWatcher / 测试 FailureWatch mock，MutexGuard 调用点显式解引用 &mut *w），新增 4 条确定性测试（连续失败降级+部分成功 drain 解除 / 超限直接降级 / 维护补注册与降级 no-op / 规则重算平台条件断言——Linux drain 重算 vs Recursive 平台策略性 no-op），registration 测试 10/10。门禁：cargo 1069/0、pnpm 2868/0、lint 全绿、type-check 0。

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


## Session 190: 对标差距收口：窗口聚焦触发 + P2/check-ignore 文档化

**Date**: 2026-09-07
**Task**: 对标差距收口：窗口聚焦触发 + P2/check-ignore 文档化
**Branch**: `main`

### Summary

完成 redesign-plan 对标审计后的三项建议优化：①窗口重新聚焦触发（VSCode 触发源⑤对标）——useGitStatusEventsSync 经 getCurrentWindow().onFocusChanged 对活跃项目调度 refreshGitFileStates（复用 500ms 去抖 + worker 查询-比较闸门兜底平台丢事件），unlisten 正确析构；②P2 rename 降级语义文档化（redesign-plan §3.5 标注已落地 + parser 就近注释：similarity 不足由 git 自身输出 D+?，不做补偿推断）；③redesign-plan 补实施状态注记（G1-G6 关闭、check-ignore 点查由分层 GitIgnoreFilter 替代满足、per-repo 全操作串行队列留作按需项及理由）。对标结论：五条公理全部达成，无架构性违反。门禁：cargo 1069/0、lint 全绿、type-check 0、pnpm 2868/0。

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


## Session 191: Fix WebKit autocapitalize and IME segmentation spaces in text inputs

**Date**: 2026-09-08
**Task**: Fix WebKit autocapitalize and IME segmentation spaces in text inputs
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c13a12a6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 192: file-tree-security-async-fix 回归确认并归档

**Date**: 2026-09-08
**Task**: file-tree-security-async-fix 回归确认并归档
**Branch**: `main`

### Summary

cargo test 全量回归通过（lib 1004/unit 100，0失败），任务归档关闭

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c13a12a6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 193: cmdw-unsaved-confirm 收尾：check 审查通过 + 门禁全绿 + 任务置 done

**Date**: 2026-09-08
**Task**: cmdw-unsaved-confirm 收尾：check 审查通过 + 门禁全绿 + 任务置 done
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `5ff465d6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 194: 统一 run/debug 管线实现 + 门禁全绿

**Date**: 2026-09-08
**Task**: 统一 run/debug 管线实现 + 门禁全绿
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `HEAD` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 195: 测试 Run/Debug v2：载体分离 + 无头构建 + 门禁全绿

**Date**: 2026-09-08
**Task**: 测试 Run/Debug v2：载体分离 + 无头构建 + 门禁全绿
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `HEAD` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 196: 编辑器滚动点击错位：CodeMirror 双实例单例化修复

**Date**: 2026-09-09
**Task**: 编辑器滚动点击错位：CodeMirror 双实例单例化修复
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `cd75ea70b87b27eb514773bc056690a98a1cda9b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 197: 编辑器滚动点击错位：CodeMirror 双实例单例化修复

**Date**: 2026-09-09
**Task**: 编辑器滚动点击错位：CodeMirror 双实例单例化修复
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `cd75ea70b87b27eb514773bc056690a98a1cda9b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 198: 编辑器滚动点击错位：CodeMirror 双实例单例化修复

**Date**: 2026-09-09
**Task**: 编辑器滚动点击错位：CodeMirror 双实例单例化修复
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `cd75ea70b87b27eb514773bc056690a98a1cda9b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 199: 编辑器滚动点击错位根治：WebKit focus 滚动漂移

**Date**: 2026-09-09
**Task**: 编辑器滚动点击错位根治：WebKit focus 滚动漂移
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `cd75ea70b87b27eb514773bc056690a98a1cda9b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 200: 编辑器滚动点击错位根治：WebKit focus 滚动漂移

**Date**: 2026-09-09
**Task**: 编辑器滚动点击错位根治：WebKit focus 滚动漂移
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `cd75ea70b87b27eb514773bc056690a98a1cda9b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 201: 编辑器滚动点击错位根治：WebKit focus 滚动漂移

**Date**: 2026-09-09
**Task**: 编辑器滚动点击错位根治：WebKit focus 滚动漂移
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `cd75ea70b87b27eb514773bc056690a98a1cda9b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 202: 提交：编辑器滚动点击错位修复（双实例 + focus 漂移 + 简化）

**Date**: 2026-09-09
**Task**: 提交：编辑器滚动点击错位修复（双实例 + focus 漂移 + 简化）
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `195bac2e31f4b6148ba8eed1a574429b4913502a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 203: 编辑器滚动点击错位修复 + 归档

**Date**: 2026-09-09
**Task**: 编辑器滚动点击错位修复 + 归档
**Branch**: `main`

### Summary

修复 CodeMirror 双实例 + WebKit focus 滚动漂移；guard 简化移除 caret 层；neeko-check PASS；提交 195bac2e 归档 09-09 任务

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `195bac2e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 204: DAP 调试源码可达性：去 Just My Code + 外部只读 + Java classpath 源码解析

**Date**: 2026-09-12
**Task**: DAP 调试源码可达性：去 Just My Code + 外部只读 + Java classpath 源码解析
**Branch**: `main`

### Summary

Java 调试无法跳转第三方库/源码库的端到端修复（P0/P1/P2/P3），含 host 自检

### Main Changes

## 问题
Java 调试时第三方库 / 源码库函数无法跳转（手工 LSP 跳转正常）。

## 根因（反编译 neeko-java-host.jar 字节码确认）
- `AttachRequestHandler` 把 attach 载荷 `sourcePaths` 写进 context；attach 无 `classPaths` 字段（仅 `launch` 有）。
- host `SimpleSourceLookUpProvider` 只在 `user.dir`（项目根）做文本后缀搜索 → 库类未命中返回 "" → java-debug `AdapterUtils.sourceLookup([cwd])` 亦未命中 → `StackFrame.source = null`。
- `sourceReference` 仅 `SourceType.REMOTE` 分支产生 → 本地 Java attach 永不出现。
- 前端 `openSourceAtLine` 只有 `InProject` 读取通道（项目外被拒），且失败静默。
- Just My Code 把无 sourcePath 的库帧判为系统帧 → `step` 时自动 continue（静默跳过）。

## 实施
- P0 删除 Just My Code：`stackFrames.ts` 收窄为停止位置选择；`debugStore` 移除自动 continue 机制与 `justMyCode` 状态。
- P1 外部源码只读通道：`dap/external_source.rs` + `assert_stopped_at_path`（凭据=「正停在该路径」）+ `dap_read_external_source`；前端拆出 `sourceContent.ts`（内容获取，判别式联合）与 `openStopSource.ts`（store 感知入口，避免 navigate ↔ store 循环）。
- P2 DAP 虚拟源码：`StackFrameDto` 增 `sourceName`/`sourceReference`，`parse_stack_frames` 纯函数化；`dap_source_content`（512KB 上限）；前端 `dap-source:` 合成身份 + 只读虚拟 tab。
- P3 Java classpath 源码解析：`LaunchConfig.classpath` → `sourcePaths` 送达 host；host 新增 `ClasspathSources`（目录直查 / `-sources.jar` / JDK `src.zip`，解压到 `~/.neeko/java-src-cache`，构造期预筛 sources jar）；`resolveClassName` 增 jdt 展示路径与 cache 布局两条规则（库断点 FQN）。
- host 首次具备测试守卫：`tools/java-host/test/...SimpleSourceLookUpProviderTest.java`（15 断言）接入 `build.sh` 3/4 步。

## 验证
- `pnpm lint`（fmt + clippy -D warnings + 4 guard）✅
- `pnpm lint:fe`（eslint + tsc + vitest --typecheck）✅ 396 文件 / 3436 用例 / 0 类型错误
- `cargo test` ✅ 1112 lib + 100 integration
- `bash tools/java-host/build.sh` ✅ 15/15 自检通过并重打 fat jar
- 未提交代码

## 已知残留（未修，已在报告中标注）
- `buildJavaClasspath`/`buildJavaClasspathEntries` 硬编码 `:` 分隔符（Windows 目标应为 `;`）—— 既有问题，与本次改动同源保持一致；修复需 `path.delimiter` 化并在 Windows CI 验证。
- 非 jdt、非 java-src-cache 的项目外源码路径无可靠包名依据（退化为默认包，断点不绑定）。
- `~/.neeko/java-src-cache` 不做主动淘汰（量级由被调试类数决定，已注释说明取舍）。


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 205: neeko-check B1/B2/C dap 优化

**Date**: 2026-09-14
**Task**: neeko-check B1/B2/C dap 优化
**Branch**: `main`

### Summary

兑现dap/mod.rs Java别名(B1); 会话存kind消除backend_for硬编码(B2); 统一DebugStartOutcome删Java专用结果类型并给LaunchConfig加Default(C); cargo test 1206+dap243全绿,fmt/clippy干净

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `282c40a4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 206: 调试停点跟随：代际化与状态化（切片 1+2，issue #13）

**Date**: 2026-09-16
**Task**: 调试停点跟随：代际化与状态化（切片 1+2，issue #13）
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

## 背景

issue #13：调试停点/单步时编辑器有时不跳到当前断点位置，重新点一下栈帧里的函数才能定位。

第一性原理走查后定位两条成因：
1. **迟到者覆盖**：停点异步链只校验 `sessionId`，旧停点迟到的结果（帧/位置/源码内容）覆盖新停点；
   而跳转目标 `pendingNavigateTarget` 在「新建 tab」分支被 `await load()` 推到异步尾部，谁最后写谁赢。
2. **先清槽、后兑现**：跟随被实现成一次性事件（全局单槽 + 命中即清槽 + rAF 兑现），
   槽清掉后若兑现落空（视图重建/未测量）就静默丢失、无从补偿 —— 根因是「把可派生的期望视图做成了事件」。

## 交付（S1–S5，切片 1+2）

- **S1 纯函数地基**：`store/debug/stopGeneration.ts`（代际类型/谓词/测试重置）、
  `stackFrames.buildStopLocation`（唯一位置构造点，规范身份）、`src/testing/async.ts`
  （`deferred` + `flushMicrotasks`；并收敛 drainLoop/useFileStore 的内联副本）。
  附带把 `virtualSourceIdentity` 从 `sourceContent.ts` 迁到 `stackFrames.ts`（纯函数模块不得依赖 IPC 层）。
- **S2 store 代际化 + 位置单写者**：`stoppedAt`→`location`（规范身份）+ `locationSeq`（严格单调）
  + `generation`（写权限令牌）+ `beginStop`；一次停点的帧/选中帧/位置/序号**原子写**；
  四条清空路径（continued/terminated/resetSession/启动失败）统一清位置 + 作废代际。
- **S3 navigate 拆分**：核心 `ensureSourceTab`（只做 tab 生命周期）+ 用户意图入口（保留一次性跳转目标）
  + 停点入口 `ensureStopSourceTab`（不写跳转目标，`await` 后校验注入的 `isCurrent`）；
  自动停点与点栈帧统一经它（许可分别是「代际未变」「仍选中该帧」）；删 `openStopSource.ts`。
- **S4 派生跟随**：`editor/stopMatch.ts`（黄线与光标共用匹配策略）、`runner/hooks/useStopLocation.ts`
  （公开只读面 + activeProject 门控 + 引用稳定性）、`editor/hooks/useDebugStopReveal.ts`
  （派生 + 幂等重放 + 用户接管惰性判定 + 释放分支）；`useCurrentLineHighlight` 收缩为纯黄线；
  删 `PendingNavigateTarget.debug`。
- **S5 收尾**：`pnpm lint:fe`（429 文件 / 3647 测试 / 0 type errors）与 `pnpm lint`（cargo fmt+clippy、
  4 个护栏脚本、java-host tests）全绿；spec 回写两条经验（见下）。

## 关键教训（已回写 spec）

1. **`state-management.md` 新增场景「停点跟随（异步链代际守卫 + 跟随改为派生状态）」**：
   代际单调 + 原子写 + 位置单写者 + `locationSeq` 为何不可派生 + 跨 feature 落地许可（`isCurrent` 注入）
   + 视图局部接管；并新增常见错误 #12「把可派生的期望视图做成一次性槽」。
2. **`unit-test/frontend-testing.md` 新增常见错误 #9「竞态用例的假绿」**：
   `T3-tab` 首版在旧机制上直接绿 —— `await` 主链只让出一个微任务，迟到链还有若干 await 层，
   断言抢先执行。修法是兑现迟到方后再 `flushMicrotasks()`；判定准则是「在缺陷代码上必须真红」。
   （该用例修正后在旧机制上稳定红于 `expected 'p1:/repo/src/A.java' to be 'p1:/repo/src/B.java'`。）

## 未完成

- 真机验收（需人工）：连续单步 20 次 / 跨文件 continue / 首次打开新文件 / 用户接管不被夺回 /
  点栈帧打开未打开的文件 / 停止结束后光标还回原位。
- 切片 3/4/5（身份唯一化 / 视图唯一化 / 用户意图槽有序化）为后续任务，本切片只留接缝。


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 207: 调试源码身份唯一化 + 概念归属收敛（切片 3，issue #13）

**Date**: 2026-09-16
**Task**: 调试源码身份唯一化 + 概念归属收敛（切片 3，issue #13）
**Branch**: `main`

### Summary

切片 3：身份比较单点（4 个 file-changed 消费方收敛到 pathsContainFile，修掉 3 处静默漏配含 HtmlPreview 恒定不刷新）+ tab 复用按身份 + 位置概念单一归属 runner/stopLocation.ts + 编辑器侧订阅槽 6→2（护栏 12 结构断言）。审计台账订正（28→36 实测口径，补第 4 消费方）。门禁：432 文件/3706 passed/0 ERROR、lint:fe 0 类型错误、三 commit 各自独立可构建。

### Main Changes

## 背景

切片 3 出自 issue #13 第一性原理分析拆出的 5 个切片（1 代际化 / 2 状态化 / **3 身份唯一化** / 4 视图唯一化 / 5 清理）。
切片 1+2（session 206）修掉了观测症状并把**写入侧**统一为规范身份；本切片把「同一份源码只有一种表示」
这条不变式推进到**比较与复用侧**，并收掉 neeko-check 遗留的 F5（订阅面）/ F6（位置概念三分）/ F3（宽松别名匹配）。

一句话判据：**任何「这是不是同一个文件」的判定都必须落在 `FileRef` 身份上**；同一概念的
`类型 + 构造 + 状态 + 使用` 收敛到单一归属模块。

## 交付（三个 commit）

### `8a4a8fc4` fix(identity): route same-file checks through the FileRef owner（R1/R2/R3）

- 身份所有者新增两个消费侧原语：`sameIdentity(a, b)`、`pathsContainFile(root, paths, filePath)`，
  调用方不再自行组装 `FileRef`。
- **四个** `file-changed` 消费方统一收敛到 `pathsContainFile`。其中三处原本会静默漏配：
  - `HtmlPreview`：事件路径是**项目相对**、组件 `filePath` 是规范**绝对** ⇒ 等值不命中 +
    `endsWith('//abs')` 恒假 ⇒ **预览永不自动刷新**（恒定缺陷，读 Rust `debounce.rs:96-104` 才发现）；
  - `useBrowserPanelEvents` / `useBrowserTab`：拼接 `${root}/${rel}`，在 watcher `strip_prefix` 失败
    回退绝对路径时拼成 `/repo//repo/...`（恒不命中），项目根带尾斜杠/重复斜杠时同样漏配；
  - `useFileTabRefresh`：口径与前三者又不同（`paths.includes(relativeToRoot(...))`）。
- `sourceTab` 的 tab 复用从裸字符串等值改为 `sameIdentity`：把「各生产者各自产出同一规范字符串」的
  隐含约定升级为机制保证。
- `debugPathsMatch` 委托 `sameIdentity` 并删除「互为后缀」容忍：该容忍只在非规范输入下可达，
  且是**真实误命中源**（`a.go` 会命中任意目录下的同名文件）。
- 覆盖率闸门：新增 `fileRef.ts` 条目（实测地板 100/98/100/95），`stopMatch.ts` 抬到 100 全项。

### `235d2546` refactor(runner): give the stop location a single home（R5/F6）

「位置」原本三分：类型+构造在 `stackFrames.ts`、状态对在 `store/debug/shared.ts`、写在 debug 各 slice。
新建域层叶子 `runner/stopLocation.ts` 收齐 `StopLocation` + `buildStopLocation` + `StopLocationState` +
`withStopLocation`；`stackFrames.ts` 收窄为「帧 → 源身份」。

**落点取舍**：PRD 原建议放 `store/debug/stopLocation.ts`，被否——那会让域层反向 import store 内部件。
依赖方向定为 `store/debug/* → stopLocation.ts → stackFrames.ts → fileRef.ts`（单向无环）。
副作用：未在 `store/debug/` 新增文件 ⇒ 护栏 10 白名单无需改动（不为凑 AC 硬塞条目）。

新增 `stopLocation.test.ts`（构造 9 例 + 状态对 4 例；后者此前**零直接覆盖**），并给该叶子加 100/100/100/100 阈值。

### `948ee5a0` refactor(runner): read the stop input from a single subscription（R6/F5）

编辑器侧两个消费者（`useDebugStopReveal` 光标 / `useCurrentLineHighlight` 黄线）都需要「位置 + 会话状态」，
此前各自再调一次 `useVisibleDebugSession()`：单视图 **6 个订阅槽**，且「会话属于当前项目」门控在多处各判一遍
（漏一处即 #14）。

`useStopLocation` 改为**一次** `useShallow` 选择器取齐（位置 + 序号 + 会话身份 + 状态）并一并交出 `status`；
两个消费者去掉第二次订阅（`useVisibleDebugSession` 保留给 DebugPanel / DebugRunButton / 状态栏）。
单视图订阅槽 **6 → 2**。

## 审计台账（R1 义务）与一次自我订正

`research/identity-audit.md` 是 R1 的交付物。**第一版计数是错的**：声称「28 处路径归一 / 4 处身份比较」，
但该口径从未被脚本执行；实测（`git show HEAD` 逐 blob 计数）为 **36 处 / 24 文件**，表格覆盖 ≈31，
另有 **3 文件 5 处完全未分类**。订正后：**6 处身份比较**（5 处已收敛 + `recentFilesStore` 去重键 1 处低危记录）、
`file-changed` 消费方 **3 → 4**。

**教训已写入审计头部**：口径写成叙述 = 没执行，必须写成可跑命令。

## neeko-check 第三轮：F1 漏修 + F7 缺例

- **F1**：审计漏掉了第 4 个消费方 `useBrowserTab.ts`（与 `useBrowserPanelEvents` **同一个 bug 的孪生副本**）。
  按 TDD 补 4 例，**绝对回退 / 尾斜杠+重复斜杠两例在改前实证为红**
  （`expected "vi.fn()" to be called 1 times, but got 0 times`），再改实现。
- **F7**：生产者两种下发形态（相对 / **绝对回退**）在三个消费方各补齐；订正
  `useBrowserPanelEvents.test.ts` 中标题与输入不符的用例（标题写「重复斜杠」，实际测的是根尾斜杠）。
  新增/订正的 4 个关键用例逐个反证过「改前为红」，canonical 对照例保持绿。

## 已知洞（留给后续切片）：`dap-source:` 不在身份文法内

实测（探针）：

```
fileRefFromTabPath('/repo', 'dap-source:/42/Foo.java') = { kind:'fs', path:'/repo/dap-source:/42/Foo.java' }
sourceIdentityOf('/repo', 'dap-source:/42/Foo.java')   = '/repo/dap-source:/42/Foo.java'   ← 非原值
sourceIdentityOf('/repo', 'jdt:/…')                     = 原样（幂等 ✅）
```

`fileRefFromTabPath` 只认 `jdt:/` 与 `jdt://contents/`，于是 `dap-source:` 被当**相对路径**拼根 ⇒
身份构造点对虚拟身份**不幂等**。三条已核实的后果：① `FileEditor.absFilePath` 对虚拟 tab 是伪路径；
② 该值同时是断点 key，经 `useBreakpointGutter.ts:208` 的 `toggleBreakpoint` **下发给后端**（后端确实有
「按规范身份翻译」层：`dap/manager.rs:742-749`，`jdt:/…` 能翻，`/repo/dap-source:/…` 不能）；
③ 任何新消费者用 `absFilePath` 比身份会**恒不命中且静默**（#13 同类）。

它还解释了两件事：`resolveDebugHighlightLine(absFilePath, tabFilePath, …)` 为何要收**两个**参数
（虚拟 tab 只靠第二个命中，而那条分支**此前零覆盖**，本切片才补上）；以及 `sameIdentity` 为何必须走**空 root**
（只有 root 为空 `canonicalFsPath` 才不拼根）——即它对虚拟身份「恰好能用」而非「设计上正确」。

方案对比（第一性原理）：A（不透明透传 fs）/ B（补 `FileRef` variant）。结论 **B-full 是根本解**：
两者都能消掉三条后果，但 A 会让 `kind` 失去判据能力（`kind === 'fs'` 不再蕴含「是文件系统路径」），
且 `lspUriOf` 对虚拟身份继续返回 truthy 伪 uri（实测 A 得 `file://dap-source:/42/Foo.java`，
B 得 `null`，与既有「jdt 无 query → null」先例一致）。B 的改造面实测仅 5 处
（`fileRef.ts` 3 + `sourceOpen.ts:45` + `virtualSourceIdentity` 迁移），且 **jdt 就是现成同形先例**。
已连同 5 条待写 Red 与实施顺序记入审计 §六。

## 门禁

- `pnpm test:coverage`（HEAD 复跑）：**432 文件 / 3706 passed / 1 skipped / 0 ERROR**
- `pnpm lint:fe`：432 文件 / 3706 passed / 0 类型错误（三个 commit 的 pre-commit 各自全量跑过）
- `npx eslint src`：0 error（仅剩既有 `VirtualList.tsx` 的 react-compiler warning）
- 三个 commit 均可独立构建：commit 2 的暂存态经手工复现 lefthook 隐藏语义验证（tsc 无错 + 112 文件 1062 用例）

## 过程经验（可复用）

1. **lefthook 会先隐藏未暂存改动再跑钩子** ⇒ 钩子校验的是**暂存态**。做分段提交时，
   中间 commit 必须能独立构建；若某文件的 diff 横跨两个 commit 而 hunk 无法切分，
   可临时写「中间版本」入索引用（从备份恢复做下一 commit），但提交前**先手工复现隐藏语义**
   （`git stash push --keep-index`）+ 跑 tsc/子集测试，比赌钩子便宜。
2. **stash 恢复冲突**发生在 HEAD 已推进之后（三方合并 base 是旧 HEAD）。解法定然：用权威备份覆盖后
   逐文件 `diff -q` 比对，确认零损失再 drop。
3. **护栏只能结构断言**：React `useSyncExternalStore` 按 `subscribe` 函数去重，多个 selector 运行时
   只产生一条订阅 ⇒ 行为上测不出「订阅槽数量」，而「门控有几处」是结构属性。
   `architecture.test.ts` 新增护栏 12 用源码扫描锁住「消费者零 store 读取 + 输入面恰好两次读取」。


### Git Commits

| Hash | Message |
|------|---------|
| `8a4a8fc4` | (see git log) |
| `235d2546` | (see git log) |
| `948ee5a0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 208: feat(dap): breakpoint disable/mute/rerun + architecture review fixes

**Date**: 2026-09-16
**Task**: feat(dap): breakpoint disable/mute/rerun + architecture review fixes
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9952db85` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 209: debug bp disable/mute/rerun — full cycle done

**Date**: 2026-09-16
**Task**: debug bp disable/mute/rerun — full cycle done
**Branch**: `main`

### Summary

Implemented breakpoint disable/mute/rerun via trellis flow: design review amendments, TDD implement, quality gate, /neeko-check architecture review (3 Major + 5 Minor fixed), spec scenario captured, full test suite green, committed and archived.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9952db85` | (see git log) |
| `1f54c1f4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 210: source-identity slice3: check pass + archive

**Date**: 2026-09-16
**Task**: source-identity slice3: check pass + archive
**Branch**: `main`

### Summary

Completed 09-16-debug-source-identity (identity uniqueness slice 3): verified all AC R1-R11 via trellis-check (gates green, zero code violations), filled check.jsonl, corrected two doc leftovers (audit sec5 recentFilesStore, PRD R5 dep direction), committed and archived.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ae78567e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 211: DAP manager 按 neeko-check 规范重构（5 阶段）

**Date**: 2026-09-17
**Task**: DAP manager 按 neeko-check 规范重构（5 阶段）
**Branch**: `main`

### Summary

抽 DapEventSink 端口解 AppHandle 耦合；拆出 breakpoints 单锁仓储/sessions 注册表/source_translation/launch_config/project_context；修 TOCTOU 丢更新、持锁跨 await、语言身份分裂（type 别名）、异步阻塞 IO、路径静默降级；新增 FakeAdapter 测试支撑与 20+ 回归用例；新增 dap-domain.md spec

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


## Session 212: DAP 续拆：BackendRegistry / DapContext / launch / breakpoints::service

**Date**: 2026-09-17
**Task**: DAP 续拆：BackendRegistry / DapContext / launch / breakpoints::service
**Branch**: `main`

### Summary

manager 生产代码 861 → 345 行，退化为门面（组装上下文 + 转调 + 会话级透传）；新增 backends.rs（注册表与锁同住）、context.rs（四协作者借用打包）、launch.rs（启动编排）、breakpoints/service.rs（断点全链路）；测试归位到各自模块：launch 用 launch_via_endpoint seam，service 就地构造 DapContext；新增 8 个回归用例；修正 over-copy 契约误判（回传是适配器视图，前端 merge）

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


## Session 213: neeko-check 复审后的整改：门面纪律 + 覆盖缺口 + 嵌套拍平

**Date**: 2026-09-17
**Task**: neeko-check 复审后的整改：门面纪律 + 覆盖缺口 + 嵌套拍平
**Branch**: `main`

### Summary

按 neeko-check 复审结论整改：删除 2 个因 pub 存活的死方法（stop_project_sessions / backend_for_config，manager 生产 345→329 行）；抽 resolve_cached 拍平 adapter_breakpoints 的 3 层解构；补 launch 层 plan 三态断言（Warming/Unavailable 绝不建会话）；DapFixture 提到 testing.rs，launch/service 测试全部脱离门面；manager 测试收口为 4 条门面契约（消除与服务层的重复覆盖）；spec 固化门面纪律 3 条 + plan 三态不变量 + 单锁拆锁条件

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


## Session 214: 补 M1：adapter_binary_override 三态夹具（含变异验证）

**Date**: 2026-09-17
**Task**: 补 M1：adapter_binary_override 三态夹具（含变异验证）
**Branch**: `main`

### Summary

project_context 新增 3 个用例覆盖 dap.adapterBinaries.<kind> 的命中/空串/缺省（键缺、类型错、非对象、文件缺、JSON 坏）共 7 条分支；变异测试取证：抽掉 .filter(!s.is_empty()) 后空串用例转红；顺带暴露 key 空间与 launch type 别名的 UX 陷阱（adapterBinaries.rust 被静默忽略），已在 dap-domain.md 记为已知契约并给出正确修法（入口归一，而非别名回落）

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


## Session 215: 修掉 adapterBinaries 别名陷阱：键空间在读取入口归一

**Date**: 2026-09-17
**Task**: 修掉 adapterBinaries 别名陷阱：键空间在读取入口归一
**Branch**: `main`

### Summary

adapter_binary_override 改为读取时按 AdapterKind::from_config_type 归一：规范键（go/lldb/java）恒优先，缺失或空串时接受 launch.json type 别名（delve/rust/codelldb/junit），无法归一的键忽略；抽 usable_override 复用空串过滤；新增 2 个用例（别名生效 + 规范键优先/空串让位），变异验证：删别名回落分支→2 用例转红。同类全域排查：仅 java/backend.rs 读 /dap/javaBackend（标量枚举键，无别名空间）→ 无需处理

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


## Session 216: 导航目标状态模型重构 + 两个键空间/清理后续任务

**Date**: 2026-09-17
**Task**: 导航目标状态模型重构 + 两个键空间/清理后续任务
**Branch**: `main`

### Summary

诊断「点断点列表定位不准需二击」根因（一次性单槽 + rAF 时间窗 + 清槽与成败无关），从第一性原理重构为导航目标状态模型：NavigateGoal{seq} + useNavigateGoal 兑现器（requestMeasure 屏障 + 货币性复检 + viewEpoch 重放）+ sourceTab 扩展屏障 + 6 生产方迁移 + goal 随 tab 移除清理；新增 frontend spec navigation-goal.md；随后完成两个审查发现任务：consoleLinks tabKey 改 resolveTabKey（worktree 键空间）、handleRemoveProject 级联清理项目 tab 空间 + runTabCleanup 故障隔离。三轮 check 全过，门禁 440 文件 / 3801 passed

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `17ed222a` | (see git log) |
| `2d235c92` | (see git log) |
| `cb723203` | (see git log) |
| `1c96f541` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 217: LSP 诊断权威副本与可重建投影

**Date**: 2026-09-18
**Task**: LSP 诊断权威副本与可重建投影
**Branch**: `main`

### Summary

定位「编辑器波浪线出现后消失（Problems 面板正常）」根因：@uiw/react-codemirror 在 extensions 身份变化时 dispatch StateEffect.reconfigure，而 @codemirror/state 的 reconfigure 会整体替换 base，丢弃 @codemirror/lint 经 appendConfig 惰性安装的渲染扩展；触发源是 extensions 依赖混入活状态（saveKeymap←currentContent/isDirty、lspKeymap←每次渲染新建的 tab 对象），每次按键都重建整个扩展世界。从第一性原理确立三条不变量——I1 权威副本唯一归 lspStore、I2 投影可重建、I3 配置纯净——新增 lspDiagnosticsProjection（位于 base 的镜像 StateField + 微任务重放 reconciler）并修正三个 hook 的依赖；顺带收敛 cmd+click 的 uri 派生到唯一派生点、移除 M0 探针与逐事件日志、@codemirror/lint 归位为运行时依赖。门禁 eslint 0 error / 446 文件 3855 passed / cargo test 1357 passed。

### Main Changes

- **根因三层**：机制=reconfigure 丢弃 appendConfig 追加的 lint 渲染扩展；触发=extensions 身份被活文档/活 tab 状态污染；设计=诊断渲染扩展的存续被默认外包给库的隐式副作用安装，且 D3「同源⇒天然一致」是错误推论（同源只保证初始一致）
- **两条实证反直觉结论**：`Transaction.reconfigured` 只是 `startState.config != state.config`，对 `appendConfig` 同样为 true（用作判据会自己触发自己，实测首推/重放各多一次事务）；`diagnosticCount` 是 lint 合并后的 range 数，不能与诊断数组长度比对
- **新增 `src/features/lsp/hooks/lspDiagnosticsProjection.ts`**：模块级单例 `diagnosticsMirror`（StateField 位于 base，故 reconfigure 存活；随 docChanged 按 assoc +1/-1 映射并丢弃塌缩项以对齐 lint 语义）+ `reconciler`（仅 `StateEffect.reconfigure` 且镜像非空时在微任务重放 setDiagnostics，含 isViewDestroyed 守卫与 pending 合并）；模块覆盖率 100% 语句/分支/函数/行
- **配置纯净 I3**：`useEditorSave` 的 saveKeymap 改为按键时从 store 读内容与脏标记（顺带删掉 `currentContent` 入参、`setIsSaving` 改 try/finally 防卡死）；`useLspNavigation` 的 lspKeymap 去掉 `tab` 对象依赖（派生 `lspDocumentUri` 标量）；`useCmdClickGoToDefinition` 改显式标量入参并删除死 lint 抑制
- **装配**：`useEditorExtensions` 在稳定段装配投影（不随 lspClientExt 挂载/释放起落），移除 M0 诊断探针
- **顺带修复**：cmd+click 的文档 uri 收敛到唯一派生点 `resolveLspDocumentUri`（原先自行回退伪造 `file://jdt:/…`）；`@codemirror/lint` 从 devDependencies 归位到 dependencies（已被生产代码 import）
- **测试**：新增 `lspDiagnosticsProjection.test.ts`（9 例：推送渲染 / reconfigure 后自愈 / 位置映射与塌缩丢弃 / 空镜像不重放 / 连续重建合并 / 推送本身不触发 / 重放前被清空 / 销毁守卫）；`useEditorExtensions.test.ts`（装配契约 + 真实装配段端到端，注释掉装配行即复现用户症状 `expected null not to be null`）；`saveKeymap` / `lspKeymap` 身份稳定回归
- **文档**：design.md 重写 M1 真实根因与 I1/I2/I3 + 不做清单补「不挂第二套 linter」；frontend quality-guidelines 新增禁止模式 10（CodeMirror 扩展身份不稳定）
- **审查发现（已修）**：装配行零覆盖（删掉该行全部测试仍全绿 → 已补端到端用例并验证 Red）；`useCmdClickGoToDefinition` 的死 lint 抑制（实测移除后 eslint 仍干净）；投影 line 110 分支未覆盖
- **审查发现（未修，待决策）**：分屏 Ctrl+S 串写——`onSave(content)` 不传 `tabId`，`saveFile` 落到 tab 空间 `activeTabId`，在非 active 面板保存会把该面板内容写入 active tab（既有缺陷，需放宽 `onFileSave` 类型 + 补分屏用例）
- 已在 design.md 记录的边界：split 同 uri 两视图（lsp-client DefaultWorkspace 单视图模型）、镜像生命周期 = EditorView


### Git Commits

| Hash | Message |
|------|---------|
| `d8d44697` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 218: Rust flyimport：全局声明 resolveSupport + 通用 completionItem/resolve 通道

**Date**: 2026-09-19
**Task**: Rust flyimport：全局声明 resolveSupport + 通用 completionItem/resolve 通道
**Branch**: `main`

### Summary

定位 r-a 静默丢弃 flyimport 候选的根因；按通用（非按语言）方案补齐 declaration + consumer 两端

### Main Changes

## 根因（裸 r-a 1.97.1 + scratch crate A/B 实测）

客户端 `initialize` 未声明 `completionItem.resolveSupport.properties` 含 `additionalTextEdits`
时，rust-analyzer **丢弃全部** flyimport 候选（108 项、无 HashMap）；声明后 109 项且
`HashMap` 居首，import 编辑改由 `completionItem/resolve` 下发。Neeko 三处全缺：没声明、
补全库丢掉原始 item 的 `data`、从不发 resolve。

## 设计取舍（按通用抽象，非按语言切开关）

同一探针跑三种 server，只切换这一条声明：

- rust-analyzer 1.97.1：不声明 → 候选整条不发；声明 → 走 resolve
- jdtls 1.61.0：不声明 → 33/33 内联；声明 → 改走 resolve（resolve 返回 `import java.awt.List;`）
  即 jdtls **也读标准能力**，不只它私有的 `extendedClientCapabilities`
- gopls v0.23.0：恒内联，无感

三种策略由**同一套**通用 consumer 兜住，故声明写进 `build_client_capabilities()` 全局生效；
jdtls 私有 flag 仍保持删除。刻意只声明 `additionalTextEdits`（不带 documentation/detail），
避免服务器把文档一并推迟导致信息面板空。

## 落地

- `instance.rs::build_client_capabilities` 加 resolveSupport + 单测钉住
- `patches/@codemirror__lsp-client@6.2.5.patch`：`option.lspItem = item` 透出原始 item；
  `collectEdits(doc)` 接受期收集（延迟编辑并入**同一事务**，单步撤销）；`applyEdits` 支持取值函数
- 新增 `src/features/lsp/hooks/lspCompletionResolve.ts`（WeakMap 去重、原样回传 item、失败静默）
- `lspCompletionInfoRenderer.ts` 接线：构建期标注 `neekoNeedsResolve`、首个候选预热、选中即解析

## 验证

Rust 1291+102 全绿、前端 3899 全绿、lint/clippy/type-check 通过。
待手动冒烟：stock-buddy 内打 `Hash` → `HashMap (use std::collections::HashMap)`，回车后
文件头出现 `use …`，一次 Ctrl+Z 同时撤销；Java `List`、Go `fmt.Pr` 回归。


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 219: Rust flyimport 修复收尾：提交并回填 commit

**Date**: 2026-09-19
**Task**: Rust flyimport 修复收尾：提交并回填 commit
**Branch**: `main`

### Summary

两笔提交落地；全量回归 3901 / 1291+102 全绿；三语言手动冒烟通过

### Main Changes

## 两笔提交

- `6871c985` fix(lsp): fetch deferred auto-import edits via completionItem/resolve
  —— 能力声明 + patch + 通用 resolver + 接线 + 文档（12 files）
- `921ba9ab` chore(lsp): extend auto-import probe with import-candidate sampling
  —— 诊断探针（2 files）

## 提交前的拦截（均未绕过）

1. lefthook pre-commit 报 3 个 eslint 错误（prettier 换行、import/order 排错位置）
   → `eslint --fix` 修正后重跑，**未使用 --no-verify**
2. `.git/index.lock` 残留 → 先确认无 git 进程在跑，锁自行释放后才继续，**未强删**

## 回归

- `pnpm lint` = 0（cargo fmt --check、clippy -D warnings、5 个护栏脚本、java-host、
  eslint、tsc --noEmit、vitest --typecheck）
- `pnpm test:run` = 3901 passed
- `cargo test` = 1291 + 102 passed

## 手动冒烟（用户确认）

Rust（stock-buddy 内 `Hash` → `HashMap` + `use std::collections::HashMap;`）、
Java（`List`）、Go（`fmt.Pr`）三种语言自动导包均生效，一次 Ctrl+Z 可同时撤销插入与 import。

## 遗留

- 竞态窗口：用户快于 resolve 时退化为"插入但不带 import"，已在能力矩阵登记；
  未为追平而补第二次 dispatch（会拆成两段 undo + 坐标漂移）
- 未 push


### Git Commits

| Hash | Message |
|------|---------|
| `6871c985` | (see git log) |
| `921ba9ab` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 220: lsp M3+重构收尾

**Date**: 2026-09-20
**Task**: lsp M3+重构收尾
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `799f3a1a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 221: lsp M4策略三态收尾

**Date**: 2026-09-20
**Task**: lsp M4策略三态收尾
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6909b543` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 222: lsp跟进修复提交

**Date**: 2026-09-20
**Task**: lsp跟进修复提交
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8ec80d77` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
