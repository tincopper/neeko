# 执行计划

> 顺序即依赖：Step 1 先落领域原语（编译器驱动调用点），Step 2 调用点，Step 3 假实现，Step 4 护栏 + 单测，
> Step 5 验证，Step 6 文档与提交。

## Step 0 · 前置

- [x] `task.py create`（子任务挂在 `10-01-async-path-resolution` 下）
- [x] `task.py add-context`（implement / check 各含 concurrency-guidelines）+ `task.py start`
      （2026-10-02 复核时补做：此前 status=in_progress 但 current 指针为空，硬闸门无法自证）

## Step 1 · 领域原语（成对提供）

- [x] `common/git/transport/mod.rs`
  - trait 增 `open_repo_async`（**无默认实现**，doc 写明同步核心的调用纪律）
  - `impl GitTransport for ExecTarget`：Local 分支在 `spawn_blocking` 内调同步核心；
    `is_git_repo` 的 Local 分支同样落池（`JoinError` → `log::warn!` + `false`）
- [x] `common/git/local/diff.rs`（紧邻同步核心）：`assert_git_repo_async`

## Step 2 · 调用点（异步入口，语义零变化）

- [x] `common/git/operations/info.rs`：`get_git_info` / `get_git_branch_info` 各 2 处
- [x] `common/git/operations/log.rs`：`get_ahead_behind` 1 处
- [x] `common/git/operations/diff.rs`：`get_changed_files_diff_stats` / `get_file_diff` 各 1 处

## Step 3 · 测试假实现（编译器驱动）

- [x] `common/git/operations/tests.rs` 三处 `impl GitTransport` 各补 `open_repo_async → None`

## Step 4 · 护栏（F4）

- [x] `tools/guards/checks/check_blocking_fs_in_commands.py`：`GUARD` + `check(ctx) -> GuardResult`
      （判据三条：同步原语 ∧ async fn 体内 ∧ 不在 `spawn_blocking` / `run_blocking` /
      `run_blocking_result` 括号内）
- [x] `tools/guards/tests/test_check_blocking_fs_in_commands.py`：14 条用例 —— 违规三形 / 同步函数体 /
      池内闭包（三形态）/ 异步入口 / `#[cfg(test)]` 豁免 / 测试文件 / scope 外；外加判据健壮性四形
      （注释里的 `}`、闭包里的 `'('`、`mod tests;` 分号形态、`use` 导入后的裸名）+ `sanitize` 等长性
- [x] `pnpm guards run --stage local`：9 条护栏 0 违规、框架自检 206 条全过

## Step 5 · 验证

- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- [x] `cargo test --lib`（无新增/删除用例，逐条不变）
- [x] `pnpm guards run`（含新护栏自检）
- [x] `pnpm lint` / `pnpm check`（含 `test:fe` / `test:host`）
- [x] 复核：`operations/**` 内无同步原语直连（唯一命中 `transport.is_git_repo(...).await` 是异步方法）

## Step 5b · 第三轮 neeko-check 复核收口（2026-10-02）

审查结论：主体合规（行为零变化、门禁全绿、成对契约与护栏同 diff 落地），但**护栏判据自身**有
四个真实漏报/误报窗口，且新增的生产分支无直测。逐条修复：

- [x] `run_blocking_result` 未被识别为阻塞池包装 ⇒ 命令层 79 处（skill 51 / mcp 28，都在扫描集内）
      池内合法调用会集体误报。`POOL_WRAPPER_RE` 收 `run_blocking(?:_result)?`；
      旧判据实测对该形态报 `hits=[3,4]`，修后 PASS。
- [x] 字符级配对在原始文本上做 ⇒ `// 结束 }` 截断 async 体（漏报：旧判据对同函数后续真实违规
      报 `hits=[]`）、闭包里的 `'('` 让池区间永不配平（误报：`hits=[4,5]`）。新增 `sanitize()`
      把注释与字面量等长抹平（含 `r#"…"#` / 字节串 / 字符字面量；`'a` 生命周期不误吞），
      行号仍按原文本报告。
- [x] `#[cfg(test)] mod tests;`（分号形态）向后找 `{` ⇒ 把后面的真实代码块整段当测试块豁免
      （旧判据漏掉第二处违规，`hits=[2]` vs `[2,10]`）。分号形态不再产生豁免区间。
- [x] `use ...::is_git_repo;` 后的裸名调用漏报（旧判据 `hits=[]`）。新增
      `(?<![\w.:])is_git_repo\s*\(`，同时排掉方法调用 `t.is_git_repo(` 与 `Self::is_git_repo(`。
- [x] 生产分支直测（勿让「假实现返回 None」成为唯一覆盖）：
      `transport::tests::test_local_open_repo_async_matches_sync_core`、
      `local::diff::tests::assert_git_repo_async_matches_sync_core`（错误文案不被 `JoinError` 覆盖）。
- [x] spec 对账：Contracts 10 收三个池包装名 + 抹平纪律；Tests Required 收两条新测试与判据健壮性四形；
      `Pillar 7` → `红线 3`（AGENTS.md 已废止支柱编号）。
- [x] 台账对账：本任务 Step 0 补勾 + `task.py start`（current 指针此前为空）；PRD 验收项逐条勾选并附证据。
- [x] DRY：`transport::local::is_git_repo_local` 与 `local::is_git_repo` 曾是同一 `.git` 探测的**两份**
      实现（注释里靠人肉约定同步）；本次改动把 `ExecTarget::is_git_repo` 的 Local 分支指向了前者，
      等于把两条路都加固了一遍。改为前者委托单一实现（`common::git::local::is_git_repo`），
      依赖方向单向（transport → local，local 不依赖 transport），行为逐字不变。

## Step 6 · 文档与提交

- [x] `.trellis/spec/backend/concurrency-guidelines.md`：Scenario 扩 Scope（仓库打开/校验类）+
      Signatures（成对原语）+ Contracts 8/9/10（成对提供 / 无默认实现 / 护栏 id）+ Good·Bad + Tests Required
- [x] 提交（英文 message，2026-10-02；护栏拆成独立一笔，比原计划多一笔）：
      `e0f50516` `refactor(git): isolate blocking repo open and validation`（src-tauri + spec）、
      `90fac3bb` `chore(guards): forbid blocking fs primitives outside the pool`（护栏 + 单测）、
      `chore(task): record the 10-02-blocking-fs-sweep task`、`chore: record journal`（不 push）
