# 设计：阻塞原语的「同步核心 + 异步入口」纪律与护栏

> 需求与验收见 `prd.md`；执行顺序见 `implement.md`。与 `10-01-async-path-resolution` 同一原理，
> 只是把落点从「路径解析」扩到「仓库打开 / 校验」。

## 1. 第一性：异步 trait 方法里的同步实现 = 假异步

调用方看到 `async fn is_git_repo` 会认为「它不会阻塞」，而 Local 分支里是 `Path::exists` / git2 ——
**契约与实现相反**。修法不是删掉同步实现，而是把「谁负责隔离」写进类型与命名：

| 角色 | 形态 | 允许的调用者 |
| --- | --- | --- |
| 同步核心 | `open_repo` / `assert_git_repo` / `is_git_repo_local` | 同步上下文、**已在阻塞池内**的闭包 |
| 异步入口 | `open_repo_async` / `assert_git_repo_async` / `is_git_repo`（async trait 方法） | 命令层、`common/git/operations/**` |

判据由此可静态检查（F4 的护栏只收这一对有替代的原语）。

## 2. 职责分解

| 单元 | 职责（唯一改变理由） | 本任务后不再承担 |
| --- | --- | --- |
| `GitTransport::open_repo_async`（新） | 打开本地仓库并把 git2 的阻塞 fs 隔离到阻塞池 | 任何业务判定 |
| `GitTransport::is_git_repo`（改） | 同上，Local 分支在池内执行 | 「自称 async 却同步执行」 |
| `local::assert_git_repo_async`（新） | 异步版 `.git` 探测（语义 = 同步核心） | — |
| `common/git/operations/{info,log,diff}.rs` | 只 `await` 异步入口 | 直连同步核心 |
| `tools/guards/checks/check_blocking_fs_in_commands.py`（新） | 把纪律变成判据（命令层 + async ops 层） | 运行时干预 |

## 3. 契约

```rust
pub trait GitTransport {
    /// 同步核心：**只允许**同步上下文或已在阻塞池内的调用方使用（红线 3）。
    fn open_repo(&self, path: &str) -> Option<git2::Repository>;

    /// 异步入口：Local 的 git2 open 在阻塞池内执行。**无默认实现**——默认 = 静默退化成阻塞。
    async fn open_repo_async(&self, path: &str) -> Option<git2::Repository>;

    async fn is_git_repo(&self, path: &str) -> bool;   // Local 分支在池内
}

/// 异步版仓库校验：语义与同步核心逐字相同，只是发生在阻塞池内。
pub async fn assert_git_repo_async(path: &str) -> Result<()>;
```

- **为什么无默认实现**：Rust 的 trait 默认体一旦回落同步核心，未来的 transport impl 就会「默认阻塞」——
  这正是本次要消灭的形态。三个测试假实现各补一行 `None`（显式表态），编译器保证不漏。
- **为什么不做「一次 hop 包住 assert + open」**：两者是不同职责、各自微秒级；为省一次线程池往返造
  bespoke API 违反 YAGNI（与 `read_dir_tree` 的例外判据同源：只有**语义不同**才允许各自 hop）。
- **失败语义**：`JoinError`（阻塞池 panic / 运行时关停）→ 校验走 `anyhow!`（与 `info.rs` 既有
  `git info task join error` 同风格）；`is_git_repo` 是 `bool` 接口，`JoinError` 记 `log::warn!` 后返回
  `false`（保守：当作「不是仓库」→ 走 shell 兜底，而不是假装成功）。

## 4. 护栏判据（`check_blocking_fs_in_commands`）

| 禁止 | 替代 | 备注 |
| --- | --- | --- |
| `UnitPath::resolve(` | `UnitPath::resolve_async(...).await` | 与 10-01 的契约同源 |
| `RepoRef::resolve(` | `state.resolve_repo(...).await` | — |
| `assert_git_repo(` | `assert_git_repo_async(...).await` | 匹配时排除 `_async` 形态 |
| `.open_repo(` | `.open_repo_async(...).await` | 同上 |
| `common::git::local::is_git_repo(` | `transport.is_git_repo(...).await` | 只匹配本地同步 helper |
| `is_git_repo(`（`use` 导入后的裸名） | `transport.is_git_repo(...).await` | 前导 `(?<![\w.:])` 排掉 `t.is_git_repo(` / `Self::is_git_repo(` |

- 池豁免：`spawn_blocking` / `run_blocking` / `run_blocking_result` **三者缺一不可**（后者是命令层
  主力形态：`library/skill/commands.rs` 51 处、`library/mcp/commands.rs` 28 处都在扫描集内）。
- 配对在 `sanitize(text)`（注释与字面量**等长**抹平，含 `r#"…"#` / 字节串 / 字符字面量；
  `'a` 生命周期不误吞）的结果上做 —— 原始文本上的配对会被 `// 结束 }` 截断函数体（漏报）、
  被闭包里的 `'('` 破坏配平（误报）；等长保证行号仍按原文本报告。
- 扫描集：`src-tauri/src/**/commands*.rs`、`src-tauri/src/**/commands/**/*.rs`、
  `src-tauri/src/common/git/operations/**/*.rs`；跳过 `tests.rs` / `*_tests.rs` 与源码内 `#[cfg(test)]` 块。
- **刻意不收 `std::fs::*`**：`spawn_blocking(move || std::fs::create_dir_all(..))` 是合法形态，静态
  判定「是否在闭包内」会制造噪声；该纪律由 spec Scenario + 审查兜底。护栏只在**有成对替代**时生效。
- 框架契约：`GUARD`（id == 文件名）+ `check(ctx) -> GuardResult`（显式返回注解）+ 配套单测 —— 由
  `tools/guards/core/registry.py` 强制，缺失即注册表校验失败。

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 测试假实现漏改 ⇒ git2 分支静默走 shell 兜底（覆盖变弱） | `open_repo_async` 无默认实现 ⇒ 编译器强制三条假实现表态；implement 里单列该步骤 |
| 同理：**生产** 的 Local 分支无直测 ⇒ 改坏了也全绿（假实现全返回 `None`） | `transport::tests::test_local_open_repo_async_matches_sync_core` 直测 git2 分支；`local::diff::tests::assert_git_repo_async_matches_sync_core` 验证错误文案不被 `JoinError` 覆盖 |
| `is_git_repo` 的 `JoinError → false` 掩盖故障 | 记 `log::warn!`（可观测），且语义上是「保守失败」而非「伪造成功」 |
| 护栏**漏报**：注释里的 `}` 截断 async 体；`mod tests;` 把后续代码整段豁免；裸名导入 | `sanitize()` 抹平注释/字面量；分号形态不产生豁免区间；裸名模式（前导 `(?<![\w.:])`）；三条均有回归用例 |
| 护栏**误报**：`run_blocking_result` 未认作池包装（79 处）；闭包里的 `'('` 破坏池配平 | `POOL_WRAPPER_RE` 收 `run_blocking(?:_result)?`；`sanitize()` 后人肉可读字符不再干扰配对；两条均有回归用例 |
| `assert_git_repo` 的调用条件被顺手"修正" | Non-goal 明确：条件与顺序一行不动（含 `get_git_info` 的无条件调用） |

判据自身的健壮性已升为一级验收对象：审查发现「修了旧的、新写的又踩」的根源不只在新代码，
也在**判据能不能看见新代码**（三个漏报窗口都是静默失明）。故护栏单测从 9 条扩到 14 条。

## 6. 测试策略

1. 新增护栏的配套单测（框架强制）：`tools/guards/tests/test_check_blocking_fs_in_commands.py`
   （14 条：判据三形 + 豁免 + 判据健壮性四形 + `sanitize` 等长性）。
2. 两个新增生产分支的直测：`transport::tests::test_local_open_repo_async_matches_sync_core`、
   `local::diff::tests::assert_git_repo_async_matches_sync_core`（既有回归证明不了这两条）。
3. 领域改动无新行为 ⇒ 既有回归兜底：`cargo test --lib` 1386 → 1388（**增量恰为上面 2 条**）。
4. 门禁：`pnpm guards run --stage local`（新护栏即生效）、`cargo clippy -D warnings`、`pnpm check`。
