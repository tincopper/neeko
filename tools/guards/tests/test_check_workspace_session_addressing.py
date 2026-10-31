"""git 寻址护栏用例：A–F 六判据的违规形态、正例零命中、豁免（值对象自身 / 测试域）。"""
from __future__ import annotations

import unittest

from guards.checks import check_workspace_session_addressing as subject
from guards.core.contract import PASS, VIOLATION
from guards.tests.support import context, make_repo, temp_repo

RS_FIXTURE = "src-tauri/src/git/commands/query.rs"
RS_AGENT_FIXTURE = "src-tauri/src/agent/commands_commit.rs"
TS_API = "src/features/git/api/gitApi.ts"
TS_CALLER = "src/features/git/components/CommitDialog.tsx"
TS_EXEMPT = "src/shared/utils/workspaceRef.ts"

# 对侧干净基线：护栏要求 TS 与 Rust 两侧都非空（反空转判据），故每个夹具都补一份对侧干净文件。
CLEAN_RS = RS_FIXTURE
CLEAN_TS = TS_API
# F 的扫描面宽于命令层：逃逸口就在这类非 commands 文件里。
RS_NON_COMMAND = "src-tauri/src/agent/chat/translation.rs"


class WorkspaceSessionAddressingTest(unittest.TestCase):
    def setUp(self):
        self.root = temp_repo(self)

    def run_guard(self, files: dict):
        # 缺哪一侧就补哪一侧的干净基线，使夹具只表达"本条判据的输入"。
        merged = dict(files)
        if not any(k.startswith("src/") for k in merged):
            merged[CLEAN_TS] = "export function noop() {}\n"
        if not any("commands" in k for k in merged if k.startswith("src-tauri/")):
            merged[CLEAN_RS] = "pub fn noop() {}\n"
        make_repo(self.root, merged)
        return subject.check(context(self.root))

    # ── A：后端唯一解析入口
    def test_direct_resolve_workspace_is_a_violation(self):
        result = self.run_guard(
            {
                RS_FIXTURE: (
                    "pub async fn get_git_info(\n"
                    "    project_id: String,\n"
                    "    worktree_path: Option<String>,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let (t, repo) = state.resolve_workspace(&project_id, worktree_path.as_deref()).await?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 5)
        self.assertIn("resolve_workspace_target", result.findings[0].message)

    def test_resolve_workspace_target_is_clean(self):
        result = self.run_guard(
            {
                RS_FIXTURE: (
                    "pub async fn stage_files(\n"
                    "    workspace: WorkspaceSession,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let (t, repo) = state.resolve_workspace_target(&workspace).await?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_agent_commit_is_scanned_too(self):
        result = self.run_guard(
            {
                RS_AGENT_FIXTURE: (
                    "pub async fn generate_commit_message(\n"
                    "    project_id: String,\n"
                    "    worktree_path: Option<String>,\n"
                    ") -> Result<String, AppError> {\n"
                    "    let (t, repo) = state\n"
                    "        .resolve_workspace(&project_id, worktree_path.as_deref())\n"
                    "        .await?;\n"
                    "    Ok(String::new())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_worktree_op_target_is_not_a_violation(self):
        """worktree 操作命令经 `resolve_workspace_target` 为被操作单元解析身份（§15.1）。"""
        result = self.run_guard(
            {
                "src-tauri/src/git/commands/worktree.rs": (
                    "pub async fn remove_worktree(\n"
                    "    project_id: String,\n"
                    "    worktree_path: String,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let worktree_path = CheckoutPath::resolve_async(&t, &worktree_path).await?;\n"
                    "    let (_t, _repo) = state\n"
                    "        .resolve_workspace_target(&WorkspaceSession::of(\n"
                    "            project_id.clone(),\n"
                    "            Some(worktree_path.identity().to_string()),\n"
                    "        ))\n"
                    "        .await?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_direct_resolve_workspace_without_address_param_is_still_violation(self):
        """A1 无条件：无散参形参的直调同样违规（收口完成后已无散参，AC3 字面零命中）。"""
        result = self.run_guard(
            {
                RS_FIXTURE: (
                    "pub async fn get_git_info(\n"
                    "    project_id: String,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let (t, repo) = state.resolve_workspace(&project_id, None).await?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("resolve_workspace_target", result.findings[0].message)

    def test_workspace_param_with_resolve_project_is_violation(self):
        """A2：收 workspace 却只按 project 解析（丢 worktree 维度，2026-10-12 实证）。"""
        result = self.run_guard(
            {
                RS_FIXTURE: (
                    "pub async fn get_commit_log(\n"
                    "    workspace: WorkspaceSession,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let (t, wd) = state.resolve_project(&workspace.project_id)?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("resolve_workspace_target", result.findings[0].message)

    # ── D：收了地址却仍从 get_project(...).path 取根（半迁移态）
    def test_workspace_param_with_get_project_path_is_violation(self):
        """D：签名看着对，但把另一个根交给下游（2026-10-13 `search_run` 的形态）。"""
        result = self.run_guard(
            {
                "src-tauri/src/search/commands.rs": (
                    "pub async fn search_run(\n"
                    "    workspace: WorkspaceSession,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let manager = state.project_manager.lock()?;\n"
                    "    let project = manager.get_project(&workspace.project_id);\n"
                    "    let root = project.path.to_string_lossy().to_string();\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("repo.root()", result.findings[0].message)

    def test_search_run_target_form_is_clean(self):
        """正确形态：地址经唯一入口解析，根取 `repo.root()`。"""
        result = self.run_guard(
            {
                "src-tauri/src/search/commands.rs": (
                    "pub async fn search_run(\n"
                    "    workspace: WorkspaceSession,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let (target, repo) = state.resolve_workspace_target(&workspace).await?;\n"
                    "    let root = repo.root().to_string();\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_get_project_without_path_is_clean(self):
        """D 需两信号同时出现：只读项目元数据（名称 / 选中 agent）不违规。"""
        result = self.run_guard(
            {
                "src-tauri/src/task/commands.rs": (
                    "pub fn project_label(\n"
                    "    workspace: WorkspaceSession,\n"
                    ") -> Result<String, AppError> {\n"
                    "    let pm = state.project_manager.lock()?;\n"
                    "    let name = pm.get_project(&workspace.project_id).map(|p| p.name.clone());\n"
                    "    Ok(name.unwrap_or_default())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_exempt_domain_is_not_scanned(self):
        """`project/commands.rs` 是项目管理本身，读 `project.path` 合法。"""
        result = self.run_guard(
            {
                "src-tauri/src/project/commands.rs": (
                    "pub fn set_active_project(\n"
                    "    project_id: String,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let pm = state.project_manager.lock()?;\n"
                    "    let p = pm.get_project(&project_id).map(|p| p.path.clone());\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_non_git_command_domain_is_scanned(self):
        """非 git 域也在扫描范围内（「在哪个 Workspace 执行」是跨域不变量）。"""
        result = self.run_guard(
            {
                "src-tauri/src/terminal/commands.rs": (
                    "pub async fn create_terminal_session(\n"
                    "    project_id: String,\n"
                    ") -> Result<(), AppError> {\n"
                    "    let (t, wd) = state.resolve_workspace(&project_id, None).await?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_project_only_resolve_project_is_clean(self):
        """无 workspace 形参的命令（canonical/is_git_repo）走 resolve_project 合法。"""
        result = self.run_guard(
            {
                RS_FIXTURE: (
                    "pub async fn is_git_repo(\n"
                    "    project_id: String,\n"
                    ") -> Result<bool, AppError> {\n"
                    "    let (t, wd) = state.resolve_project(&project_id)?;\n"
                    "    Ok(true)\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    # ── B：前端禁散签形参
    def test_worktree_path_param_is_a_violation(self):
        result = self.run_guard(
            {
                TS_API: (
                    "export function stageFiles(\n"
                    "  projectId: ProjectId,\n"
                    "  filePaths: string[],\n"
                    "  worktreePath?: string | null,\n"
                    "): Promise<void> {\n"
                    "  return invoke<void>('stage_files', { projectId, filePaths, worktreePath });\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertEqual(result.findings[0].line, 4)

    def test_destructuring_line_is_not_a_param(self):
        result = self.run_guard(
            {
                TS_API: (
                    "export function stageFiles(\n"
                    "  workspace: WorkspaceSession,\n"
                    "  filePaths: string[],\n"
                    "): Promise<void> {\n"
                    "  const { projectId, worktreePath } = workspace;\n"
                    "  return invoke<void>('stage_files', { workspace, filePaths });\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_c_class_worktree_op_param_is_exempt(self):
        """C 类命令的 `worktreePath` 是被操作目标，不是寻址散参（design.md §2.1 C 类）。"""
        result = self.run_guard(
            {
                TS_API: (
                    "export function removeWorktree(projectId: ProjectId, worktreePath: string): Promise<void> {\n"
                    "  return invoke<void>('remove_worktree', { projectId, worktreePath });\n"
                    "}\n"
                    "export function stageFiles(\n"
                    "  workspace: WorkspaceSession,\n"
                    "  filePaths: string[],\n"
                    "): Promise<void> {\n"
                    "  return invoke<void>('stage_files', { workspace, filePaths });\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    # ── C：前端禁伪造地址
    def test_forged_session_cast_is_a_violation(self):
        result = self.run_guard(
            {
                TS_CALLER: (
                    "const s = { projectId, worktreePath } as WorkspaceSession;\n"
                    "export const t = s;\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("伪造地址", result.findings[0].message)

    def test_forged_session_annotation_is_a_violation(self):
        result = self.run_guard(
            {TS_CALLER: "const s: WorkspaceSession = { projectId, worktreePath };\n"}
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_legal_wire_payload_is_not_a_violation(self):
        """`invoke(…, { projectId, worktreePath })` 是合法 wire 载荷，不是手搓地址。"""
        result = self.run_guard(
            {
                TS_CALLER: (
                    "export function go(session: WorkspaceSession) {\n"
                    "  const { projectId, worktreePath } = session;\n"
                    "  return invoke<void>('stage_files', { projectId, worktreePath });\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_value_object_file_is_exempt(self):
        result = self.run_guard(
            {
                TS_EXEMPT: (
                    "/**\n"
                    " * JSON.stringify(session) 产出 `{ projectId, worktreePath }`。\n"
                    " */\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    # ── 正例与测试域豁免
    def test_clean_repo_passes(self):
        result = self.run_guard(
            {
                RS_FIXTURE: "let (t, repo) = state.resolve_workspace_target(&workspace).await?;\n",
                TS_API: "const { projectId, worktreePath } = workspace;\n",
                TS_CALLER: "const s = activeWorkspaceSession(projectId);\n",
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_test_files_are_exempt(self):
        result = self.run_guard(
            {
                "src/features/git/hooks/__tests__/useGitActions.test.ts": (
                    "const s = { projectId, worktreePath };\n"
                ),
                "src-tauri/src/git/commands/tests.rs": (
                    "let (t, repo) = state.resolve_workspace(&id, None).await?;\n"
                ),
            }
        )
        self.assertEqual(result.verdict, PASS)

    # ── E：执行上下文台账（没有 workspace 形参的命令也必须说清理由）
    LEDGER = "tools/guards/ledger/exec_context_commands.json"

    def ledger(self, commands: dict):
        import json

        return {self.LEDGER: json.dumps({"note": "fixture", "commands": commands})}

    def test_project_root_without_address_and_without_ledger_is_violation(self):
        result = self.run_guard(
            {
                RS_AGENT_FIXTURE: (
                    "pub async fn run_search(project_id: String) -> Result<(), AppError> {\n"
                    "    let root = pm.get_project(&project_id).map(|p| p.path.clone())?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("exec_context_commands.json", result.findings[0].message)
        self.assertEqual(result.findings[0].line, 2)

    def test_ledger_entry_with_reason_is_clean(self):
        result = self.run_guard(
            {
                **self.ledger(
                    {f"{RS_AGENT_FIXTURE}::run_search": "项目级操作：按项目统计，不执行进程"}
                ),
                RS_AGENT_FIXTURE: (
                    "pub async fn run_search(project_id: String) -> Result<(), AppError> {\n"
                    "    let root = pm.get_project(&project_id).map(|p| p.path.clone())?;\n"
                    "    Ok(())\n"
                    "}\n"
                ),
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_ledger_entry_with_blank_reason_is_violation(self):
        result = self.run_guard(
            {
                **self.ledger({f"{RS_AGENT_FIXTURE}::run_search": "   "}),
                RS_AGENT_FIXTURE: (
                    "pub async fn run_search(project_id: String) -> Result<(), AppError> {\n"
                    "    let root = pm.get_project(&project_id).map(|p| p.path.clone())?;\n"
                    "    Ok(())\n"
                    "}\n"
                ),
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("reason 为空", result.findings[0].message)

    def test_resolve_project_ctx_call_is_violation(self):
        result = self.run_guard(
            {
                RS_AGENT_FIXTURE: (
                    "pub async fn open_chat(project_id: String) -> Result<(), AppError> {\n"
                    "    let (name, env, root) = resolve_project_ctx(&state, &project_id)?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)

    def test_project_metadata_without_path_is_clean(self):
        result = self.run_guard(
            {
                RS_AGENT_FIXTURE: (
                    "pub async fn project_manifest(project_id: String) -> Result<(), AppError> {\n"
                    "    let (name, env) = project_display(&state, &project_id)?;\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_hand_written_address_literal_outside_commands_is_violation(self):
        """逃逸口形态：非命令层文件手写地址字面量，绕过整条地址链路。"""
        result = self.run_guard(
            {
                RS_NON_COMMAND: (
                    "pub async fn translation_stream(project_id: String) -> Result<(), AppError> {\n"
                    "    let workspace = WorkspaceSession {\n"
                    "        project_id: project_id.clone(),\n"
                    "        worktree_path: None,\n"
                    "    };\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, VIOLATION)
        self.assertIn("WorkspaceSession::main", result.findings[0].message)
        self.assertEqual(result.findings[0].line, 2)

    def test_named_constructor_is_clean(self):
        result = self.run_guard(
            {
                RS_NON_COMMAND: (
                    "pub async fn translation_stream(project_id: String) -> Result<(), AppError> {\n"
                    "    let workspace = WorkspaceSession::main(project_id);\n"
                    "    Ok(())\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_return_type_brace_is_not_a_literal(self):
        """`-> WorkspaceSession {`（函数体起始括号）不是地址字面量。"""
        result = self.run_guard(
            {
                RS_NON_COMMAND: (
                    "pub fn address_of(project_id: &str) -> WorkspaceSession {\n"
                    "    WorkspaceSession::main(project_id)\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_literal_inside_inline_test_module_is_exempt(self):
        """docstring 承诺的 `#[cfg(test)]` 豁免必须真的生效（否则夹具自己会撞线）。"""
        result = self.run_guard(
            {
                RS_NON_COMMAND: (
                    "pub fn production() {}\n"
                    "#[cfg(test)]\n"
                    "mod tests {\n"
                    "    fn fixture() {\n"
                    "        let w = WorkspaceSession { project_id: \"p1\".into(), worktree_path: None };\n"
                    "    }\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)

    def test_address_module_itself_is_exempt(self):
        result = self.run_guard(
            {
                "src-tauri/src/common/git/workspace_ref.rs": (
                    "pub struct WorkspaceSession { pub project_id: String }\n"
                    "impl WorkspaceSession {\n"
                    "    pub fn of(project_id: String) -> Self {\n"
                    "        Self { project_id, worktree_path: None }\n"
                    "    }\n"
                    "}\n"
                )
            }
        )
        self.assertEqual(result.verdict, PASS)
