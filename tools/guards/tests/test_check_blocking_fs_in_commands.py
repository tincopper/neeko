"""阻塞原语护栏用例。

回归来源（两轮 neeko-check）：
- 10-01：29 处 `resolve_repo` + 8 处 `resolve_base` + 6 处 `UnitPath::resolve` 直连跑在 worker 上；
- 10-02：`assert_git_repo` / `transport.open_repo` / `is_git_repo` 在同一代码路径上仍是同步实现。

两次都是「修了旧的、新写的又踩」，故本护栏存在的意义是让第三次无法合入。判据的三条前提
（同步原语 / async fn 体内 / 池外）各有对应用例，避免把「同步函数体」与「池内闭包」这两种
合法形态误报 —— 误报一次，护栏就会被习惯性忽略。

第三轮 neeko-check 复核（同轮修）：
- `run_blocking_result` 漏识别 ⇒ 命令层 79 处框架封装闭包内全变误报；
- 字符级配对不剥注释/字面量 ⇒ `// 结束 }` 截断 async 体（漏报）、闭包里的 `'('` 让池区间
  永不配平（误报）；
- `#[cfg(test)] mod tests;`（分号形态）向后找 `{` ⇒ 把它之后的真实代码块整段豁免（漏报）；
- `use` 导入后的裸名 `is_git_repo(...)` 不匹配（漏报）。
本文件每一条都有对应用例（扫描加固的用例在下面「判据自身的健壮性」一节）。
"""
from __future__ import annotations

import unittest

from guards.checks import check_blocking_fs_in_commands as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

COMMAND_FILE = "src-tauri/src/git/commands/worktree.rs"
OPS_FILE = "src-tauri/src/common/git/operations/info.rs"


class BlockingFsInCommandsTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files: dict):
        make_repo(self.root, files)
        return subject.check(context(self.root))

    # ── 违规：async fn 体内、池外直连 ────────────────────────────────────

    def test_sync_path_resolve_in_async_command_is_a_violation(self):
        result = self.run_guard(
            {
                COMMAND_FILE: (
                    "#[tauri::command]\n"
                    "pub async fn create_worktree(p: String) -> Result<(), AppError> {\n"
                    "    let unit = UnitPath::resolve(&t, &p)?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 3)
        self.assertIn("resolve_async", result.findings[0].message)

    def test_sync_repo_open_and_validation_in_async_ops_are_violations(self):
        result = self.run_guard(
            {
                OPS_FILE: (
                    "pub async fn get_git_info(t: &dyn GitTransport, work_dir: &str) -> Result<()> {\n"
                    "    crate::common::git::local::assert_git_repo(std::path::Path::new(work_dir))?;\n"
                    "    if let Some(_repo) = t.open_repo(work_dir) {\n"
                    "        return Ok(());\n"
                    "    }\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual([f.line for f in result.findings], [2, 3])

    def test_repo_ref_resolve_and_local_is_git_repo_in_async_fn_are_violations(self):
        result = self.run_guard(
            {
                COMMAND_FILE: (
                    "pub async fn f() {\n"
                    '    let repo = RepoRef::resolve("p1", "/r", None, &t);\n'
                    "    let ok = crate::git::is_git_repo(&path);\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual([f.line for f in result.findings], [2, 3])

    # ── 合法：同步函数体 / 池内闭包 / 异步入口 / 测试 ────────────────────

    def test_sync_fn_may_call_sync_core(self):
        """同步函数体的调用方负责隔离（`parse_worktree_list` 由阻塞池调用）。"""
        result = self.run_guard(
            {
                OPS_FILE: (
                    "fn normalized_worktree(raw: &str) -> Option<Worktree> {\n"
                    "    match UnitPath::resolve(&ExecTarget::Local, raw) {\n"
                    "        Ok(p) => Some(Worktree { path: p.identity().to_string() }),\n"
                    "        Err(_) => None,\n"
                    "    }\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_inside_spawn_blocking_is_accepted(self):
        result = self.run_guard(
            {
                COMMAND_FILE: (
                    "pub async fn read_dir_tree(p: String) -> Result<(), AppError> {\n"
                    "    let repo = tokio::task::spawn_blocking(move || {\n"
                    "        RepoRef::resolve(&pid, &wd, Some(&p), &target)\n"
                    "    })\n"
                    "    .await\n"
                    "    .map_err(|e| AppError::Unknown(e.to_string()))?;\n"
                    "    run_blocking(move || assert_git_repo(Path::new(&dir))).await?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_run_blocking_result_is_a_pool_wrapper(self):
        """`run_blocking_result` 是命令层主力封装（skill 51 处 / mcp 28 处，都在扫描集内）。

        漏识别 ⇒ 池内合法调用集体变误报，而误报会让护栏被习惯性忽略。
        """
        result = self.run_guard(
            {
                COMMAND_FILE: (
                    "pub async fn f(t: &dyn T) -> Result<(), AppError> {\n"
                    "    run_blocking_result(move || {\n"
                    '        let _ = t.open_repo("/x");\n'
                    "        RepoRef::resolve(&pid, &wd, None, &target)\n"
                    "    })\n"
                    "    .await\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_async_entries_are_accepted(self):
        result = self.run_guard(
            {
                OPS_FILE: (
                    "pub async fn get_git_info(t: &dyn GitTransport, work_dir: &str) -> Result<()> {\n"
                    "    crate::common::git::local::assert_git_repo_async(work_dir).await?;\n"
                    "    if let Some(_repo) = t.open_repo_async(work_dir).await {\n"
                    "        return Ok(());\n"
                    "    }\n"
                    "    let ok = t.is_git_repo(work_dir).await;\n"
                    "    let unit = UnitPath::resolve_async(&t, work_dir).await?;\n"
                    "    let repo = state.resolve_repo(&pid, Some(work_dir)).await?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_cfg_test_block_and_test_files_are_exempt(self):
        result = self.run_guard(
            {
                COMMAND_FILE: (
                    "pub async fn f() {}\n"
                    "\n"
                    "#[cfg(test)]\n"
                    "mod tests {\n"
                    "    #[tokio::test]\n"
                    "    async fn uses_sync_core() {\n"
                    '        assert!(assert_git_repo(std::path::Path::new("/x")).is_err());\n'
                    '        let _ = UnitPath::resolve(&t, "/x");\n'
                    "    }\n"
                    "}\n"
                ),
                "src-tauri/src/common/git/operations/tests.rs": (
                    'async fn fake() {\n    let _ = UnitPath::resolve(&t, "/x");\n}\n'
                ),
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_files_outside_scope_are_ignored(self):
        """`common/git/local/**` 是同步实现层：async 里也没有这些原语可调。"""
        result = self.run_guard(
            {
                "src-tauri/src/common/git/local/diff.rs": (
                    "pub fn assert_git_repo(p: &Path) -> Result<()> {\n"
                    '    let _ = UnitPath::resolve(&t, "/x");\n'
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)
        self.assertEqual(result.scanned, 0)

    # ── 判据自身的健壮性：注释 / 字面量 / 分号测试模块 / 裸名导入 ────────────

    def test_pool_closure_with_char_literal_keeps_the_exemption(self):
        """字符字面量 `'('` 曾让池区间永不配平 → 池内合法调用被判违规（误报）。"""
        result = self.run_guard(
            {
                COMMAND_FILE: (
                    "pub async fn f(t: &dyn T) -> Result<(), AppError> {\n"
                    "    run_blocking(move || {\n"
                    "        let paren = '(';\n"
                    '        let _ = t.open_repo("/x");\n'
                    '        let unit = UnitPath::resolve(&t, "/x");\n'
                    "    })\n"
                    "    .await\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_comment_braces_do_not_truncate_async_body(self):
        """注释里的 `}` 曾提前闭合 async 体 → 同函数后续的真实违规漏报。"""
        result = self.run_guard(
            {
                COMMAND_FILE: (
                    "pub async fn f() -> Result<(), AppError> {\n"
                    "    // 结束 } 与开括号 (\n"
                    '    let unit = UnitPath::resolve(&t, "/x")?;\n'
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual([f.line for f in result.findings], [3])

    def test_semicolon_test_module_does_not_swallow_following_code(self):
        """`#[cfg(test)] mod tests;` 曾向后找 `{` 把后面的真实代码整段当测试块豁免。"""
        result = self.run_guard(
            {
                OPS_FILE: (
                    "pub async fn f(t: &dyn T) -> Result<(), AppError> {\n"
                    '    let _ = t.open_repo("/x");\n'
                    "    Ok(())\n"
                    "}\n"
                    "\n"
                    "#[cfg(test)]\n"
                    "mod tests;\n"
                    "\n"
                    "pub async fn g(t: &dyn T) -> Result<(), AppError> {\n"
                    '    let _ = t.open_repo("/y");\n'
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual([f.line for f in result.findings], [2, 10])

    def test_imported_bare_name_is_a_violation_but_method_call_is_not(self):
        """`use ...::is_git_repo;` 后的裸名曾整体漏掉；异步方法 `t.is_git_repo(` 仍须豁免。"""
        result = self.run_guard(
            {
                OPS_FILE: (
                    "use crate::common::git::local::is_git_repo;\n"
                    "\n"
                    "pub async fn f(p: &Path) -> bool {\n"
                    "    is_git_repo(p)\n"
                    "}\n"
                    "\n"
                    "pub async fn g(t: &dyn T, p: &str) -> bool {\n"
                    "    t.is_git_repo(p).await\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual([f.line for f in result.findings], [4])

    def test_sanitize_preserves_offsets(self):
        """等长替换是行号准确的前提（字符数 / 换行逐字不变）。"""
        text = (
            "fn a() {\n"
            "    // } 注释\n"
            '    let s = "} )";\n'
            "    let c = '(';\n"
            '    let r = r#"}"#;\n'
            "}\n"
        )
        clean = subject.sanitize(text)
        self.assertEqual(len(clean), len(text))
        self.assertEqual(clean.count("\n"), text.count("\n"))
        # 注释 / 普通字符串 / 字符字面量 / 原始字符串里的 `}` 全被抹平，只剩函数体那一个
        self.assertEqual(clean.count("}"), 1)
        self.assertEqual(clean.strip().splitlines()[-1], "}")


if __name__ == "__main__":
    unittest.main()
