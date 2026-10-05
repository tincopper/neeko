# 路径身份字母表：identity 与 exec 双渲染（平台无关身份）

## Goal

Windows CI 上 `common::git::path_guard::tests::worktree_nonexistent_path_is_lexically_normalized` 失败：

```
left : \\?\C:\Users\...\.tmpUQMRRe\new-wt     （函数返回值）
right: \\?\C:\Users\...\.tmpUQMRRe/new-wt     （测试写死的期望串）
```

根因不是「测试少写一个字符」，而是 `RepoRef::key()` 的**身份被定义成了宿主 API 的当前输出形态**：
`path_guard::canonicalize_worktree_path` 按「存在 / 不存在」分叉成两个不同的字符串生产者
（存在 → `std::fs::canonicalize`，Windows 带 `\\?\`；不存在 → `PathBuf` 逐分量重建，宿主分隔符），
于是 identity 是「输入写法 × 分支 × 平台」的函数，而不是「文件系统对象」的函数。任何依赖它做
等值判定的消费点都必须编码平台细节 —— 测试只是第一个撞上的消费点。

本次按第一性把**身份**与**执行形态**拆成两个渲染，并把 φ 的唯一来源收敛为
「最深已存在祖先的 canonical 形态 ⊕ 尾分量」。

## Requirements

**契约（φ 的唯一定义，落点为模块头注释）**

- 一个仓库单元路径 = 一个值（`UnitPath`），两个渲染：
  - `identity()`：平台无关字母表（`/` 分隔、无 `\\?\`/`\\.\` 前缀、盘符 ASCII 大写、UNC → `//server/share/…`、
    无 `.`/空段/尾分隔符）。消费者：`RepoRef::key()` / `worktree_path()` / IPC `Worktree.path` /
    `canonical_worktree_path` 命令 / watcher·diff·status 槽位 / 前端 `RepoKey`。
  - `exec()`：宿主可执行形态。消费者：git argv / `std::fs` / notify 根 / `strip_prefix` /
    gitignore `same_root` / 缓存键前缀 / `file/commands.rs::resolve_base`。
- 不变量：
  - **I1 写法无关**：同一对象的多种写法（`.`、尾分隔符、符号链接祖先、盘符大小写）→ 同一 identity
  - **I2 区分性**：不同对象 → 不同 identity（不做大小写折叠、不做 Unicode 归一）
  - **I3 时刻无关**：同一路径创建前与创建后的 identity 相同
  - **单一实现处**：identity 只允许由本入口产出（前端与其它后端模块不得自造）
- WSL / SSH：identity == exec（POSIX 纯字符串词法归一，绝不进宿主 `std::path`）—— 保持现有行为与回归测试。
- **exec 逐字保持今天的行为**（存在 → `canonicalize` 原样，Windows 含 `\\?\`；不存在 → 调用者拼写的宿主形态），
  全仓 ~200 处 exec 消费者一行不改。
- 平台差异（verbatim 剥除、盘符规范化、UNC 渲染）落 `platform/path_identity/`（红线 10）；
  规则实现为纯字符串函数，三端编译、三端可测。
- 退役旧单串入口 `path_guard::canonicalize_worktree_path`（不留兼容壳）。
- 前端生产代码零改动；不新增前端归一表达式（不触发 `check_path_identity_scope` 台账漂移）。

**显式非目标**（写入契约，避免范围膨胀）

- Unicode NFD/NFC 归一；大小写不敏感文件系统上输入大小写的折叠；`\\?\Volume{GUID}` 形态。

## Acceptance Criteria

- [ ] `unit_path::resolve` 为 identity 的唯一产出点；`path_guard::canonicalize_worktree_path` 已删除且无调用点
- [ ] I1 / I2 / I3 各有一条跨平台（不硬编码分隔符，期望值由 `tempdir()`/`PathBuf` 推导）的用例
- [ ] Windows 形态渲染规则（verbatim / UNC / 盘符 / 折叠）有纯字符串用例，且在 macOS/Linux 也执行
- [ ] `RepoRef`：`key()`/`worktree_path()` 走 identity，`work_dir*()` 走 exec，`Eq/Hash` 只按 key
- [ ] exec 消费者（git argv / fs / watcher / 缓存键 / `resolve_base`）取 `exec()`，行为与改动前逐字相同
- [ ] `Worktree.path`（IPC）为 identity 字符串（类型不再暗示它是 OS 路径）
- [ ] `pnpm test:rust` 全绿（本地）；`pnpm lint` 全护栏通过（`check_repo_unit_identity` / `check_path_identity_scope`）
- [ ] `.trellis/spec/backend/git-domain.md` §12 已同步为双渲染契约 + 不变量 + 非目标

## Notes

- 关联父任务：`09-26-worktree-repo-identity`（仓库单元身份链）。
- Windows 判定只能由 CI 的 `cargo test` job 提供（红线 13 的执行方式）。
- 不提交代码：改完停在未提交状态。
