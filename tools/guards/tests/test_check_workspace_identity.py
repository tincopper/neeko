"""Workspace身份护栏用例 —— 重点是「注释里允许、代码里禁止」这条边界。

退役符号被记录在注释里是**有价值的**（说明为什么不能再接回来）；但判据一旦放行注释，
就可能被「把违规代码写成注释样式」绕过，因此同时钉住：真代码必须报、注释必须不报、
扫描数必须非零（空转即 ERROR 由框架统一负责，这里再验一次扫描集不为空）。
"""
from __future__ import annotations

import unittest

from guards.checks import check_workspace_identity as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo


class WorkspaceIdentityTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_fe(self, rel: str, body: str):
        """每个用例独立仓库树：同一次断言里先造违例再造正例时必须先清场，
        否则上一个文件仍在扫描集里，会把「应当 PASS」的用例染成 VIOLATION。"""
        import shutil

        shutil.rmtree(self.root / "src", ignore_errors=True)
        make_repo(self.root, {rel: body, "src/keep.ts": "export const x = 1;\n"})
        return subject.check(context(self.root))

    def run_be(self, body: str):
        make_repo(
            self.root,
            {"src-tauri/src/common/git/x.rs": body, "src-tauri/src/keep.rs": "// keep\n"},
        )
        return subject.check(context(self.root))

    def test_retired_frontend_symbol_is_a_violation(self):
        result = self.run_fe(
            "src/features/git/bridge.ts",
            "export function write(p: any) {\n  store.applyGitStatus(p.id, p.files);\n}\n",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("applyGitStatus" in f.message for f in result.findings))

    def test_comment_mention_is_allowed_but_still_counted(self):
        result = self.run_fe(
            "src/features/git/commented.ts",
            "// 取代旧的 applyGitStatus（per-project 单槽）\nexport const ok = 1;\n",
        )
        self.assertEqual(result.verdict, PASS)
        self.assertGreater(result.scanned, 0)

    def test_retired_ahead_behind_key_helper_is_a_violation(self):
        # ahead/behind 的键只允许是Workspace身份；带 `{source}:{connectionId}` 的复合键 helper
        # 是「读侧拼不出写侧」的根源，不得重新引入。
        result = self.run_fe(
            "src/features/git/behind.ts",
            "const k = aheadBehindKey('local', pid, pid);\n",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("aheadBehindKey" in f.message for f in result.findings))

    def test_comment_mention_of_ahead_behind_key_is_allowed(self):
        result = self.run_fe(
            "src/shared/store/gitStore.ts",
            "// 旧键是 aheadBehindKey('local', pid, pid)：读侧拼不出写侧那个键\n"
            "export const ok = 1;\n",
        )
        self.assertEqual(result.verdict, PASS)

    def test_store_mirror_access_is_a_violation(self):
        result = self.run_fe(
            "src/features/x/Panel.tsx",
            "const p = useWorkspaceStore((s) => s.activeWorktreePath);\n",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("镜像" in f.message for f in result.findings))

    def test_direct_byproject_active_path_is_a_violation(self):
        # 「当前单元」的唯一派生点是 selectActiveWorkspaceKey / activeWorkspaceKeyOf —— 直摸 store 内部
        # 状态既会分叉身份，渲染期还会停在旧值（非响应式）。
        result = self.run_fe(
            "src/features/x/hook.ts",
            "const p = useWorkspaceStore.getState().byProject[pid]?.activePath ?? null;\n",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("selector" in f.message for f in result.findings))

    def test_store_implementation_may_access_its_own_state(self):
        result = self.run_fe(
            "src/shared/store/workspaceStore.ts",
            "export const pick = (s: any, pid: string) => s.byProject[pid]?.activePath;\n",
        )
        self.assertEqual(result.verdict, PASS)

    def test_selector_form_is_accepted(self):
        result = self.run_fe(
            "src/features/x/Ok.ts",
            "const p = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);\n",
        )
        self.assertEqual(result.verdict, PASS)

    def test_direct_project_statuses_read_is_a_violation(self):
        # 判据 7：status 的唯一读取口是 selectors，store 的内部表示不得外泄。
        result = self.run_fe(
            "src/features/git/components/Leak.tsx",
            "const entries = useProjectStore((s) => s.statuses[workspaceKey]?.entries);\n",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("statuses" in f.message for f in result.findings))

    def test_statuses_destructuring_is_a_violation(self):
        result = self.run_fe(
            "src/features/git/components/Leak.tsx",
            "const { statuses } = useProjectStore();\n",
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_selector_status_form_is_accepted(self):
        result = self.run_fe(
            "src/features/git/components/Ok.tsx",
            "const entries = selectEntries(s, workspaceKey);\nconst branch = selectBranch(s, workspaceKey);\n",
        )
        self.assertEqual(result.verdict, PASS)

    def test_project_store_may_access_its_own_statuses(self):
        result = self.run_fe(
            "src/shared/store/projectStore.ts",
            "export const pick = (s: any, k: string) => s.statuses[k];\n",
        )
        self.assertEqual(result.verdict, PASS)

    def test_status_command_must_go_through_git_api(self):
        bad = self.run_fe(
            "src/features/git/hooks/leak.ts",
            "const r = await invoke('get_workspace_status', { projectId });\n",
        )
        self.assertEqual(bad.verdict, VIOLATION)
        good = self.run_fe(
            "src/features/git/api/gitApi.ts",
            "return invoke<GitStatusSnapshot>('get_workspace_status', { projectId });\n",
        )
        self.assertEqual(good.verdict, PASS)

    def test_handbuilt_workspace_key_outside_workspace_ref_is_a_violation(self):
        bad = self.run_fe(
            "src/features/git/utils/key.ts",
            "const key = projectId + '\\0' + worktreePath;\n",
        )
        self.assertEqual(bad.verdict, VIOLATION)
        good = self.run_fe(
            "src/shared/utils/workspaceRef.ts",
            "export const WORKSPACE_KEY_SEP = '\\u0000';\n",
        )
        self.assertEqual(good.verdict, PASS)

    # ── 判据 6：材质白名单（旧判据只认引号包裹的 '\0'，以下形态全部溜得过）──

    def test_template_literal_handbuilt_key_is_a_violation(self):
        """TS 最自然的手拼形态：`\\0` 在反引号里、没有引号包裹。"""
        result = self.run_fe(
            "src/features/git/utils/key2.ts",
            "const key = `${projectId}\\0${wtPath}`;\n",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("材质化" in f.message for f in result.findings))

    def test_from_char_code_key_is_a_violation(self):
        result = self.run_fe(
            "src/features/git/utils/key3.ts",
            "const key = projectId + String.fromCharCode(0) + wtPath;\n",
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_key_sep_import_outside_producer_is_a_violation(self):
        """引用分隔符常量自拼 = 第二处 key 实现（消费方应该用 workspaceKeyOf）。"""
        result = self.run_fe(
            "src/features/git/utils/key4.ts",
            "import { WORKSPACE_KEY_SEP } from '@/shared/utils/workspaceRef';\n"
            "export const k = `${projectId}${WORKSPACE_KEY_SEP}${wtPath}`;\n",
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_other_namespace_nul_composite_is_not_flagged(self):
        """runner 测试结果键（projectId + filePath）是另一个合法命名空间：无Workspace
        上下文词，不得误伤（真实形态：src/features/runner/store/testResults.ts）。"""
        result = self.run_fe(
            "src/features/runner/store/results.ts",
            "export const k = `${projectId}\\u0000${filePath}`;\n",
        )
        self.assertEqual(result.verdict, PASS)

    def test_backend_format_nul_key_is_a_violation(self):
        """Rust 侧第二实现：`format!("{}\\u{0}{}", …)`（旧判据完全不扫后端材质）。"""
        result = self.run_be(
            "pub fn k(project_id: &str, worktree_path: &str) -> String {\n"
            "    format!(\"{}\\u{0}{}\", project_id, worktree_path)\n}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("材质化" in f.message for f in result.findings))

    def test_backend_git_z_parsing_is_not_flagged(self):
        """git `-z` 输出解析的 split('\\0') 与 WorkspaceKey 无关（无域上下文词），不得误伤。"""
        result = self.run_be(
            "pub fn parse(output: &str) -> Vec<&str> {\n"
            "    output.split('\\0').collect()\n}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_colon_key_flowing_into_workspace_key_consumer_is_a_violation(self):
        """历史缺陷形态 `${projectId}:wt:${path}` 的同形复发：流入 status 消费点即拦。"""
        result = self.run_fe(
            "src/features/git/utils/key5.ts",
            "applyStatus({ workspace_key: `${projectId}:${wtPath}` } as never);\n",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("冒号式" in f.message for f in result.findings))

    def test_colon_key_in_other_namespace_is_not_flagged(self):
        """onboarding 进度键 `${projectId}::${worktreePath}` 是另一个命名空间：
        没有流入 repo-key 消费点，不得误伤（真实形态：useWorktreeActions.ts）。"""
        result = self.run_fe(
            "src/features/project/hooks/onboarding.ts",
            "const worktreeKey = `${projectId}::${worktreePath}`;\n",
        )
        self.assertEqual(result.verdict, PASS)

    def test_mirror_destructuring_is_a_violation(self):
        """解构是绕过 selector 的另一种拿法（旧判据只认 `.prop` 与 `prop:` 字面量）。"""
        result = self.run_fe(
            "src/features/x/destructure.ts",
            "const { activeWorktreePath } = useWorkspaceStore.getState();\n",
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("镜像" in f.message for f in result.findings))

    def test_retired_backend_symbol_is_a_violation(self):
        result = self.run_be(
            "pub fn refresh() {\n    let files = get_worktree_changed_files();\n}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("get_worktree_changed_files" in f.message for f in result.findings))

    def test_backend_doc_comment_is_allowed(self):
        result = self.run_be(
            "/// 取代旧的 `get_worktree_changed_files`（双引擎）\npub fn status_porcelain() {}\n"
        )
        self.assertEqual(result.verdict, PASS)

    # ── 第 4 类判据：写命令的 status 收口接线 ──────────────────────────────

    def run_cmd(self, body: str, rel: str = "src-tauri/src/git/commands/probe.rs"):
        """命令层用例：必须落在 `git/commands/` 下才进入接线判据的扫描集。"""
        import shutil

        shutil.rmtree(self.root / "src-tauri/src/git", ignore_errors=True)
        make_repo(self.root, {rel: body})
        return subject.check(context(self.root))

    def test_write_command_without_status_closure_is_a_violation(self):
        result = self.run_cmd(
            "#[tauri::command]\npub async fn stage_files(project_id: String) -> Result<(), AppError> {\n"
            "    operations::stage_files(&t, &wd, &paths)\n"
            "        .await\n"
            "        .map_err(AppError::from)?;\n"
            "    Ok(())\n}\n"
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("没有收口" in f.message for f in result.findings))

    def test_closure_via_any_of_the_three_helpers_passes(self):
        for marker in ("wait_status_fresh", "wait_main_status_fresh", "release_workspace"):
            result = self.run_cmd(
                "#[tauri::command]\npub async fn stage_files(project_id: String) -> Result<(), AppError> {\n"
                "    operations::stage_files(&t, &wd, &paths)\n"
                "        .await\n"
                "        .map_err(AppError::from)?;\n"
                f"    status::{marker}(&state, &repo).await;\n"
                "    Ok(())\n}\n"
            )
            self.assertEqual(result.verdict, PASS, f"{marker} 应被视为已收口")

    def test_read_only_and_ledgered_operations_are_exempt(self):
        """台账必须显式：只读前缀 + 写明理由的 no-impact 操作，二者都不该报。"""
        result = self.run_cmd(
            "#[tauri::command]\npub async fn show(project_id: String) -> Result<(), AppError> {\n"
            "    operations::get_commit_log(&t, &wd).await?;\n"
            "    operations::push(&t, &wd, false).await?;\n"
            "    Ok(())\n}\n"
        )
        self.assertEqual(result.verdict, PASS)

    def test_ledger_entry_cannot_borrow_a_mutating_name(self):
        """台账里的名字如果同时是改变 status 的操作，判据不能被它绕过（防台账腐化）。"""
        self.assertIn("push", subject.NO_STATUS_IMPACT_OPERATIONS)
        self.assertNotIn("stage_files", subject.NO_STATUS_IMPACT_OPERATIONS)
        self.assertNotIn("stash_apply", subject.NO_STATUS_IMPACT_OPERATIONS)
        self.assertNotIn("checkout_branch", subject.NO_STATUS_IMPACT_OPERATIONS)

    def test_no_status_impact_ledger_is_frozen(self):
        """台账防腐的完整版：新增豁免必须显式改这个集合并写明理由 —— 悄悄塞进一个
        改变 status 的操作名（如 commit_changes）会让整条收口判据对它失明。"""
        self.assertEqual(
            frozenset(subject.NO_STATUS_IMPACT_OPERATIONS),
            frozenset(
                {
                    "create_branch",
                    "delete_branch",
                    "create_tag",
                    "push",
                    "push_with_credentials",
                    "fetch",
                    "fetch_with_credentials",
                    "stash_drop",
                }
            ),
        )

    def test_command_layer_is_actually_scanned(self):
        """接线判据不能空转：必须断言**命令层分段**的扫描数 > 0 —— 总 scanned 是
        前端+后端合计，命令层扫描集归零时它照样非零（测非所名的旧形态）。"""
        import re

        result = self.run_cmd("// 无命令\n")
        cmd = re.search(r"命令层 (\d+)", result.metrics)
        self.assertIsNotNone(cmd, f"metrics 必须报告命令层扫描数：{result.metrics}")
        self.assertGreater(int(cmd.group(1)), 0)
        mount = re.search(r"挂载扫描 (\d+)", result.metrics)
        self.assertIsNotNone(mount, f"metrics 必须报告挂载扫描数：{result.metrics}")
        self.assertGreater(int(mount.group(1)), 0)

    # ── 第 5 类判据：挂载唯一入口 ──────────────────────────────────────────

    def run_backend_files(self, files: dict):
        import shutil

        shutil.rmtree(self.root / "src-tauri/src", ignore_errors=True)
        make_repo(self.root, files)
        return subject.check(context(self.root))

    def test_extra_mount_call_outside_activate_is_a_violation(self):
        """第二个挂载发起点正是实测破过一次的那形态（启动先挂主仓、随后被前端改挂 worktree）。"""
        result = self.run_backend_files(
            {
                "src-tauri/src/project/commands.rs": (
                    "pub fn activate() {\n    state.watcher_manager.watch(repo, sink);\n}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertTrue(any("挂载唯一入口" in f.message for f in result.findings))

    def test_activate_is_the_only_allowed_mount_caller(self):
        result = self.run_backend_files(
            {
                "src-tauri/src/git/services/status.rs": (
                    "pub fn activate() {\n        manager.watch(watch_repo, sink);\n}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_manager_own_module_is_not_flagged(self):
        result = self.run_backend_files(
            {
                "src-tauri/src/common/file/watcher/manager/core.rs": (
                    "    pub fn watch(&self, repo: WorkspaceRef, sink: Arc<dyn WatcherEventSink>) {}\n"
                ),
                "src-tauri/src/common/file/watcher/keeper.rs": (
                    "pub fn keep() {}\n// 这里的 .watch( 只是注释里的提及\n"
                ),
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_comment_mentioning_watch_is_allowed(self):
        result = self.run_backend_files(
            {
                "src-tauri/src/app.rs": (
                    "// 旧实现在这里 state.watcher_manager.watch(...) 预挂主仓单元，已删除\n"
                    "pub fn setup() {}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)


if __name__ == "__main__":
    unittest.main()
