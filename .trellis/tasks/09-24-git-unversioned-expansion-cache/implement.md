# 执行计划

> 修订 v2（2026-09-24）：**执行顺序调整** —— 先落方案 A（前端，单文件级、可独立验证 AC1–AC4/AC7），端到端验证后在决策点 **D1** 再决定方案 B 是否并入本次。v1 把 B 排在最前，会让热路径改动先于用户可见收益落地。
> TDD 强制：每步 Red → Green → Refactor。命令注册无变化，`lib.rs` 不动。

## Step 1 — 前端：展开缓存失效通道（方案 A）—— ✅ 已完成（2026-09-24）

> 结果：`useUntrackedDirExpansion.test.ts` 13 项全绿；全量 `vitest run` 477 文件 / 4204 通过 / 0 失败。
> ⚠️ 与 v2 初稿的偏差（核实后修正，见 design §2.1）：失效信号落在「`files` 引用被替换」，**不用** version —— local 两条刷新都不推进 version（刷新按钮走 `get_git_info` 不经 version gate；聚焦走 `versionGateAccepts(..., allowEqual=true)` 同版本放行），等版本 = AC3 不可达。

**S1 文件事件驱动（做）**

- [x] hook 订阅 `useFileChangedEvent`（内部实现细节，`useCallback([])` 稳定引用 + `entryPathsRef` 读最新目录集）→ 路径段前缀命中（`isPathUnderDir`）→ 标记该目录需重拉
- [x] in-flight 期间多次失效只重新标记 stale → 落地后合并为一次 trailing 重拉（AC7-3）；不命中不重拉（AC7-4）
- [x] `isPathUnderDir` 纯函数 + 3 条单测（前缀别名 `dir-ab` 不误命中、尾斜杠兼容、空目录不误判）

**S2 快照替换失效（做）**

- [x] `files` 引用被替换 → 全部需重拉（SWR：旧值保留到新值落地）+ 已消失目录的缓存键丢弃
- [x] 前置契约 1：`useCommitPanelAux.changedFilesWithStats` 加 `useMemo`（引用稳定性；顺带修掉 `ChangesList` 因每次 render 换引用而失去 `React.memo` 的问题）
- [x] 前置契约 2：`GitCommitPanel` 给 `ChangesList` 加 `key={project.id}`（缓存作用域，否则切换项目后旧项目子行会出现在新项目同名目录下）

**S3 失败语义（做）**

- [x] `GitCommitPanel.handleExpandUntrackedDir` 失败时 toast 后 **rethrow**（不再 `return []` 把失败伪装成空目录）
- [x] hook 侧失败**不写缓存键**（目录条目继续占位）+ `failedDirsRef` 失败抑制；抑制只在下一次失效信号复位（无自发定时重试 → AC4「静默窗口内至多 1 次」）
- [x] 全失败时不回写缓存（`succeeded.length === 0` 直接返回），所有 `setState` 判等回原引用

**用例与门禁**

- [x] `useUntrackedDirExpansion.test.ts`：装配自检、AC7-1～AC7-4、S2-1～S2-3、S3-1～S3-2、`isPathUnderDir` 3 条 —— 13/13 绿
- [x] 版本登记表搬进 `projectStore` state（`statusVersionByProject`；`versionGateAccepts` 语义不变、`version<=0` 不入表）+ `projectStore.test.ts` 增「可被 UI 响应式读取」用例。**该登记表不参与本次失效判定**（design §2.1 末段），仅为 B 落地后「版本前进 ⇔ 内容确实变了 → 跳过无谓重拉」留口径
- [x] `pnpm test:run`（全量）✓、`pnpm type-check` ✓、`eslint` ✓

**踩坑记录（供后续复用）**

- 测试里传内联数组字面量会被 S2 判成「快照替换」→ 每秒 26k 次拉取（引用稳定性是**必要条件**，不只是性能优化）；本文件所有用例已改为稳定引用。

## Step 2 — A 的端到端验证 + 决策点 D1 —— ✅ 已完成（遗留：B 生效后复测一次）

**已就绪**

- 驱动脚本：`scripts/step2-manual.sh`（交互模式逐步停顿；`--no-pause` 无人值守 + 日志取证；只操作自己创建的 `<repo>/tmp-untracked-e2e`，结束时删除）
- 日志取证口径：`~/.neeko/neeko.log` 为 Debug 级，`[FileDebounce:<project>] Emitting file-changed for N paths` 可作为「watcher → debounce → 前端订阅」这条腿的客观证据

**已取得的客观结论（无需人工观察）**

| 观测 | 结果 | 对应 AC |
|---|---|---|
| 目录内建文件是否触发 file-changed | ✅ 触发（`tmp-untracked-e2e/a.txt` 等命中） | AC1 前置 |
| 连续快速建 10 个文件是否合并为 1 批 | ✅ 恰好 1 条 `for 10 paths`（非 10 条） | AC7 前提 |
| 删除目录时的事件 | ✅ 1 批 `for 12 paths`（11 文件 + 目录） | AC2 前置 |
| 前端拉取次数上界 | ✅ 由自动化用例判定（13/13 绿，AC7-1～AC7-4） | AC7 |

**⚠️ 环境干扰（测量前必须排除）**

1. **同时运行两个 Neeko 实例**：`target/debug/neeko`（dev，30 分钟，含本次前端改动）+ `/Applications/Neeko.app`（12:48 构建的旧包，**不含**本次改动）。两者都在监听同一批项目并写同一个日志 → 事件计数被放大且无法区分来源。**手动观察必须用 dev 窗口，并先退出旧包**。
2. **单次文件变更被 emit 3 次**（同一毫秒 3 行 `for 2 paths`）。静态分析指向 `WatcherManager::unwrap` 生命周期问题：notify 回调闭包持有 `maintenance_tx_for_closure`（与维护线程等待的同一 channel），维护线程持有 watcher 的 `Arc` → 两者互相保活，`unwatch` 后旧 watcher 仍在投递事件（会话内多次切换项目即累积）。**这是本任务之外的既有缺陷**，但会把 S1 的现场观感放大 2–3 倍，D1 结论需按此折算；建议单开任务（证据：本文件 + 日志）。

**待人工确认（需在 dev 窗口观察并回报；驱动：`bash scripts/step2-manual.sh`）**

- [ ] AC1：目录内新建 b.txt → 面板自动出现（不点刷新、不折叠重开）
- [ ] AC2：删除 a.txt → 自动消失
- [ ] AC3：面板刷新按钮 / Alt+Tab 切回 → 列表与 `git status --porcelain -uall` 一致
- [ ] AC4：失败态（可临时断开 IPC 或指向非仓库）→ 目录条目继续占位、无 toast 刷屏、恢复后可重试
- [ ] AC7 现场观感：风暴后列表最终一致、无明显闪烁反复
- [ ] AC9：WSL/SSH 项目抽查刷新仍更新外层 status

**质量门（Step 2 后）**：`pnpm lint`、`pnpm type-check`、`pnpm test:run`

**D1 结论（2026-09-24 22:1x）**

- [x] S1 命中率 / 即时性：**通过** —— 目录内新建删除即时反映到面板（用户现场确认，无问题）
- [x] 聚焦与刷新一致性：**通过** —— 刷新按钮 / Alt+Tab 切回后与 `git status --porcelain -uall` 真值一致
- [x] IPC 计数：自动化用例覆盖上界（前端 13/13、后端 18/18）；现场计数受上述 3× 事件放大干扰，如需精确实测需先修 watcher 生命周期
- [x] **B 是否并入本次**：按 D1 原口径（A 已满足用户可见需求）B 可降级为独立任务；**用户明确指示继续**，故 B 保留在本次并已完成（Step 3/4）——B 的独立价值是「watcher 丢事件时靠心跳自愈」+「闸门语义正确（不再声称无变化而 untracked 集合已变）」
- [x] **B 生效后复测（2026-09-24 22:4x）**：重启 dev 后 AC1–AC3 复测**通过**（用户现场确认「没有问题」）
- [ ] 遗留（可选）：AC4 失败态现场观察、AC9 WSL/SSH 抽查

## Step 3 — 后端：折叠目录内容摘要（B 基建）—— ✅ 已完成（2026-09-24）

**落地**

- [x] 新文件 `src-tauri/src/common/git/status_worker/collapsed_probe.rs`：`collapsed_dirs_digest(repo_path, entries) -> Digest`（`Known { dirs, files, hash } | Unknown`），`hash` 覆盖「目录路径 + `ls-files -z` 原始输出字节」
- [x] 枚举走 worker 线程的同步桥：`git -C <repo> --no-optional-locks ls-files --others --exclude-standard -z -- <dir>`（`--no-optional-locks` 置于子命令前，避免顺手刷 index 形成自反馈）
- [x] **禁止截断**：不复用展示层 500 条 cap，改为 `MAX_PROBE_BYTES = 8 MiB` 超限 → `Unknown` 放行
- [x] 6 条单测：新增文件必变、只改内容不变、ignored 不进摘要、无折叠目录恒等、非仓库 → Unknown、**超 cap 目录仍能看见新增（回归钉死「不截断」）**

**与 v2 初稿的偏差（已记入 design §3.1/§3.4）**

- 未与命令层共享枚举函数：命令层是异步 + transport 抽象，worker 是同步 + 仅 local；强行为一次 git 调用引入 async↔sync 适配层不划算（第 2 次出现，未达 DRY 阈值）。`operations/files.rs` 因此零改动 → 「Refactor：命令层复用」一项取消。

**验证**：`cargo test --manifest-path src-tauri/Cargo.toml status_worker` → 18/18 绿

## Step 4 — 后端：worker 比较闸门升级（B）—— ✅ 已完成（2026-09-24）

**落地**

- [x] worker 增加 `last_collapsed_digest: Option<Digest>`；闸门改为
  `status_unchanged = porcelain 相等 && branch 相等`、`digest_unchanged = digest 已知 && digest == last`，
  两者同时成立才 `continue`；emit 时写入当前摘要
- [x] 摘要**无条件计算**（emit 时也要有值，否则下一次快路径会拿陈旧值多 emit 一次）→ v2 计划的 `probe_skipped_when_porcelain_changed` 取消
- [x] **mtime 前置短路取消**（实测见 design §3.2）：成本由进程启动主导（15–24 ms），且在 worker 线程；mtime 还有嵌套目录洞
- [x] 测试：`untracked_dir_burst_creates_emit_exactly_one_snapshot`（同批次 10 次创建 → 恰好 1 次 emit + version 前进 + 仍 1 条 `is_dir` 条目；同时覆盖 v2 计划的 `untracked_dir_content_change_emits_new_snapshot_version`）、`untracked_dir_unchanged_does_not_emit`（防矫枉过正）；原有 `worker_does_not_emit_when_status_unchanged` / `worker_stress_*` 保持绿

**实测留痕（macOS，2026-09-24，5 次取 min/avg）**

| 目录规模 | min | avg | 输出字节 |
|---|---|---|---|
| 3 个文件 | 15.1 ms | 15.6 ms | 39 B |
| 10,000 个文件 | 23.8 ms | 24.0 ms | 138,890 B |

结论：8 MiB 上界约 50 万文件才触发（`Unknown` 属病态场景）；当前成本可接受，无需前置短路；若日后成为热点，正确方向是「watcher 变更路径作为 hint 传入 worker」。

**验证**：`cargo test --manifest-path src-tauri/Cargo.toml status_worker` → 18/18 绿

## Step 5 — 集成回归 + 全量质量门 —— ✅ 已通过（2026-09-24）

**AC8 四命令 + 附加门（全部实跑）**

| 门禁 | 结果 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml`（lib） | **1326 passed / 0 failed / 3 ignored**（1329） |
| 同上（`tests/unit.rs`） | **102 passed / 0 failed / 1 ignored** |
| `pnpm type-check`（`tsc --noEmit`） | ✅ |
| `pnpm test:run`（全量前端） | **477 文件 / 4204 passed / 1 skipped / 0 failed** |
| `pnpm lint`（fmt check + clippy `-D warnings` + 5 个 python 护栏 + java-host） | ✅ |
| `check_path_identity_scope.py` | ✅ 台账一致（949 文件 / 23 文件命中 / 42 处全部分类，owner 1 / legit 22 / debt 0） |

**AC 覆盖状态**

- AC1/AC2/AC3：Step 2 现场确认通过（A 生效）；B 落地后需重启 dev 复测一次（见 D1 遗留）
- AC4：自动化 S3-1/S3-2 绿；现场失败态观察属可选
- AC5/AC6：`untracked_dir_burst_creates_emit_exactly_one_snapshot`（恰好 1 次 emit + version 前进 + 仍 1 条 `is_dir` 条目）、`untracked_dir_unchanged_does_not_emit`、折叠语义既有测试全绿
- AC7：前端 AC7-1～AC7-4 + 后端 batch 用例绿
- AC8：见上表
- AC9：自动化无回归；WSL/SSH 现场抽查属可选

**路径身份护栏顺带修正**：新增的 `isPathUnderDir` 初版用了 `replace(/\/+$/, '')` 归一，被护栏按「计数漂移」拦下 → 改为「补足分隔符 + 精确等值」的纯比较（不做形态归一，与 `gitFileDecoration.ts:292` 同 idiom），护栏恢复一致。

## 附带修复（同类缺陷，Step 5 复测时发现）

> 复测反馈：「中文文件名显示有问题」（截图：`"test/\346\265\213\350\257\225.txt"`）。
> 定性：**与本任务的缓存/闸门缺陷无因果关系**，是 git 文本输出对非 ASCII 路径做 C 风格转义
> （`core.quotePath` 默认 true）而解析入口未解码。按「同类全域排查」一并收口。

**波及面（扫描结果）**

| 调用点 | 输出形态 | 后果 | 处理 |
|---|---|---|---|
| `worker.rs` `status --porcelain`（local 主链路） | 转义引号 | 面板显示乱码、按路径建索引不命中、staging/diff 命令拿伪路径 | ✅ 解析入口解码 |
| `operations/{info,worktree,diff}.rs` `status --porcelain`（WSL/SSH/worktree 兜底） | 同上 | 同上 | ✅ 同上（共用 `parse_status_line`） |
| `operations/diff.rs` / `log.rs` / `stash.rs` `diff|stash show --numstat` | 转义引号 | 行数统计合并不上（退化为 0/0） | ✅ 同上（共用 `parse_numstat_line`） |
| `operations/{files,log,stash}.rs` `--name-status`（经 `parse_numstat_with_status`） | 转义引号 | 提交/暂存文件列表乱码；numstat 与 status 两侧形态不一致还会**静默退化为 `M`** | ✅ 两处一并解码 |
| `operations/files.rs::get_untracked_files`（折叠目录展开） | 转义引号 | **现场截图即此处**：展开出的子文件名乱码 | ✅ 改走 `-z`（NUL 分隔且不做转义），顺带不再 `trim`（文件名可含首尾空格） |
| `collapsed_probe`（本次新增的探测） | 已用 `-z` | 无 | ✅ 无需改动 |

**落地**

- 新文件 `common/git/parsers/quoting.rs`：`unquote_git_path`（C 转义解码：`\a \b \f \n \r \t \v \\ \"` + 1–3 位八进制 → UTF-8，lossy 兜底），5 条单测
- `parse_status_line`：解码 + rename 行改为 **token 扫描**（引号内的名字本身可能含 ` -> `，整行 `find` 会拆错），3 条新单测
- `parse_numstat_line` / `parse_numstat_with_status`：解码路径（后者两侧同形态，否则 status 合并 key 不一致）
- `get_untracked_files`：`-z` + NUL 切分；新增集成测试 `get_untracked_files_returns_raw_non_ascii_paths`

**为什么解码放解析入口而不是各调用点加 `-c core.quotePath=false`**：后者要求所有调用点不漏、且无法处理**必须**转义的路径（含引号/控制字符）；前者一处收口，符合「同一事实只有一种表示」。走 `-z` 的调用天然免疫。

**验证**：`cargo test --lib` 1337 passed / 0 failed（+11 条新用例：quoting 4、status 4、numstat 2、commit 1）；`cargo test --test unit` 103 passed（+1 条 `get_untracked_files_returns_raw_non_ascii_paths`）；`cargo clippy -D warnings` 与 `cargo fmt --check` 均过。

**过程教训（自查项）**：改动共享解析器时，只跑「新增用例过滤」（`--lib quoted_`）会漏掉既有契约 —— 首版实现把 `old -> new` 的非引号分支也走了 token 扫描，直接打挂 4 条既有 rename 测试（`rename_arrow_takes_new_path` 等），是全量 `cargo test` 才发现的。**结论：共享解析层改动一律跑全量 lib 测试**。

**现场复测（2026-09-24 22:4x）**：重启 dev 后中文文件名显示正常（面板展开行 + 工具提示），用户确认「中文显示也正常了，没有问题」。

**已知残留（不在本次范围）**：rename 在 numstat / name-status 的形态（`old => new` / `R100\told\tnew`）与 status 的 `old -> new` 不同，提交/暂存列表的 rename 行仍取不到新名。

## Review Gates

1. Step 1 完成后跑前端 `pnpm test:run` + `pnpm type-check`；重点复核**无自激**（失败退避、`setDirFilesMap` 判等）。
2. Step 2 的 D1 必须有书面记录（实测结论 + B 是否继续），不得跳过。
3. Step 3/4 完成后跑后端全量 `cargo test`（换行红线 11：测试不对工作区字节做精确断言）。
4. Step 5 全量四命令为最终门（AC8）。

## Rollback Points

- Step 1 A 的改动集中在 hook + `GitCommitPanel` handler + `ChangesList` 传参，可单批 revert，UI 无耦合。
- Step 3 纯函数 + `files.rs` 参数化：无行为变化 → 直接 revert。
- Step 4 闸门条件单点回滚（去掉摘要条件即回原语义）；`collapsed_probe.rs` 整体删除。

## 明确不做

- 不改 `lib.rs` / 命令注册 / IPC payload 形状（`FileChange` 加目录 token 方案见 design §5.2，需单开变更）。
- 不开 `recurse_untracked_dirs`。
- 不用展示层的 500 截断做探测输入。
- 不新增定时轮询（复用既有 30s 心跳）。
- 不修 WSL/SSH/worktree 的自动失效信号（缺口登记，AC9 只要求不回归）。
- 不动 worktree 分支展开失效（Non-Goal）。
