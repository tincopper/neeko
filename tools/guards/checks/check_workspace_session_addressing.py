"""git 命令寻址必须是 `WorkspaceSession` 值对象（后端唯一入口 + 前端禁散签 + 禁手搓字面量）。

## 第一性原理

一次 git 操作的真值依赖是 `(Workspace, 操作)`。地址信息的保真度决定正确性，
当前架构在三处让它失真，本护栏逐条钉住：

| 失真 | 形态 | 后果 | 判据 |
| --- | --- | --- | --- |
| **可手搓** | 前端 `worktreePath?: string \\| null` 可选散参 / 后端手写 `WorkspaceSession { .. }` 字面量 | 漏传或按错单元 → 静默按主仓执行 | **B**（前端散签）/ **F**（后端字面量） |
| **可拆分** | 后端 `(project_id, worktree_path)` 两个 wire 字段（请求体与事件回显各一份） | 两字段可独立缺失/错配 | **签名**（收单 `workspace` 对象，AC2 + 类型检查；半用对象由 **A2** 兜底）|
| **可选地址** | `workspace: Option<WorkspaceSession>` | 「没传就退回按 project 取根」成为合法路径（A2/D 的判据是必填形态，看不见它）| **G** |
| **可绕过** | 命令层直调 `resolve_workspace(&str, Option<&str>)` | 解析逻辑两个外观 | **A** |
| **半迁移** | 签名收了 `workspace`，却仍从 `get_project(...).path` 取根 | worktree 视图扫主仓（签名看着对） | **D** |
| **该有却没有** | 命令体按 project 取 cwd/根，签名里压根没有地址 | 项目级通道被当成免死金牌，静默跑主仓 | **E**（台账）|

与前置任务 `10-09-file-io-workspace-scope` 的 `check_file_io_scope` 互补：那条管**文件 IO**的
唯一命令面与旧编码，本条管**命令层**的地址形态（不限 git 域 —— file / terminal / search 同理）。
两者的 B 判据作用域不同（那条管 `rootPath` 退役，本条管 `gitApi.ts` 的 `worktreePath` 散签），
不重叠。

## 判据（六条，均确定性可复现）

- **A1 后端唯一解析入口（无条件）**：命令层（`src-tauri/src/**/commands*.rs` 与
  `**/commands/**/*.rs`，扣除 `RS_EXEMPT_DIRS`）内不得直调 `resolve_workspace(`
  （唯一入口是 `resolve_workspace_target(&workspace)`）。
  收口完成后已无 `worktree_path: Option<String>` 散参，旧的"函数带散参形参才判"前置会永真空
  （2026-10-12 实证：history/commit 8 个命令收了 `workspace` 却走 `resolve_project`，护栏盲区）——
  故不设前置，字面零命中（AC3）。
- **A2 收对象必须真用对象**：带 `workspace: WorkspaceSession` 形参的命令不得调 `resolve_project(`
  （那会丢弃 worktree 维度，worktree 视图静默按主仓执行；写命令再配 `wait_main_status_fresh`
  就是戳错单元，违反 git-domain §10）。无 `workspace` 形参的命令（`canonical_worktree_path` /
  `is_git_repo` / worktree 目标型 ops）走 `resolve_project` 合法，不判。
- **B 前端禁散签**：`gitApi.ts` 内不得保留 `worktreePath` **形参**（迁移后地址是首参
  `workspace: WorkspaceSession`；内部 `const { projectId, worktreePath } = workspace`
  的解构行是唯一合法出现处）。
  **豁免 C 类命令**：`createWorktree` / `removeWorktree` / `renameWorktree` / `isWorktreeDirty`
  的 `worktreePath` 是**被操作的目标**（worktree 名/路径），不是寻址散参（design.md §2.3 例外）。
- **C 前端禁伪造地址**：`src/**` 生产代码不得把字面量**断言/标注成** `WorkspaceSession`
  （`{ projectId, worktreePath } as WorkspaceSession`、`: WorkspaceSession = { … }`）——
  class 私有构造已挡住直接 `new`，这两种是仅剩的绕过形态。
- **D 收了地址就不得再按 project 取根（半迁移态）**：函数带 `workspace: WorkspaceSession` 形参，
  却仍 `get_project( … )` 取 `project.path` 当工作目录 —— 签名看着对（A2 过），但它把**另一个**
  根交给了下游（worktree 视图扫主仓）。2026-10-13 的 `search/commands.rs` 正是此形（旧形态
  `search_run` 无`workspace` 形参，与 `set_active_project` 这类**合法的 project 级命令**语法同形，
  无法用静态规则区分 —— 故本判据只钉「已收地址却还用另一个根」这个**可判定**的子集）。
- **E 执行上下文台账**：命令体以 project 取 cwd/根（`resolve_project_ctx(...)` 或
  `get_project(...)` + `.path`），签名里却**没有**地址 —— A2/D 只能看见「签名里已经有 workspace」
  的形态，看不见「该有却没有」。这类函数必须入 `tools/guards/ledger/exec_context_commands.json`
  登记**为什么它确实是项目级操作**（空 reason 视为未登记）。台账**只增需评审**：
  新增一条 = 声称一个执行上下文不需要地址，正是必须有人看的地方。
- **F 后端禁手搓地址**：`src-tauri/src/**` 生产代码不得写 `WorkspaceSession { … }` 字面量。
  它是 C（前端禁伪造）的后端对应物，且是 E 的逃逸口：`translation.rs` 曾手写
  `{ project_id, worktree_path: None }` 绕过整条地址链路 —— 项目级通道要用命名构造点
  `WorkspaceSession::main(id)` 显式声明「按主 checkout 执行」，让意图可 grep、可评审。

> **为何不拦裸 `{ projectId, worktreePath }`**：该形态在 `commandFactory.ts` 里是**合法 wire 载荷**
> （`invoke('stage_files', { projectId, worktreePath })`，由 `gitApi` 内部解构产生），与「手搓地址」
> 在语法上同形、语义上相反。用正则区分二者无稳定指纹（spec 结论：无稳定指纹时不硬上静态检查），
> 故只拦**带类型意图**的两形 —— 那才是"我要造一个 session"的明确表达。

> 豁免：`shared/utils/workspaceRef.ts` 与 `common/git/workspace_ref.rs`（值对象自身，字面量出现在
> JSDoc 说明里）、测试文件（`__tests__` / `.test.ts` / `tests/`）与 `#[cfg(test)]`。
"""
from __future__ import annotations

import json
import re

from guards.core.contract import Context, Finding, Guard, GuardResult
from guards.core.rust_cfg import mask_cfg_test

TS_SCOPES = ("src/**/*.ts", "src/**/*.tsx")
# 后端域：不限于 git —— 「在哪个 Workspace 执行」是**跨域**不变量（file / terminal / search …）。
# 曾仅扫 `git/commands/**` + `agent/commands_commit.rs`，search 域的同类缺陷因此**不可见**
# （2026-10-13 实证：`search_run` 直取 `project.path` 作搜索根，三重基准错位）。
RS_SCOPES = (
    "src-tauri/src/**/commands*.rs",
    "src-tauri/src/**/commands/**/*.rs",
)

# 非「在一个 Workspace 里执行」的域：它们按 project 或全局概念工作，不适用本护栏。
# （保留目录形式以便新增域时显式决定，而不是静默被扫。）
RS_EXEMPT_DIRS = (
    "src-tauri/src/project/",  # 项目管理本身（set_active_project / primary_language …）
    "src-tauri/src/library/",  # 资源库（按 project 绑定的 skill / prompt 安装）
    "src-tauri/src/app/",  # 组合根（启动 / 关闭协议）
    "src-tauri/src/about/",  # 版本信息
)

# D：收了 `workspace` 却仍从 `get_project(...).path` 取根（半迁移态）
GET_PROJECT_RE = re.compile(r"\bget_project\s*\(")
PROJECT_PATH_RE = re.compile(r"\bproject\.path\b|\bp\.path\b")

# A1：后端直调旧解析入口（`resolve_workspace_target` 是合法入口，负向查断言它不在）
RESOLVE_DIRECT_RE = re.compile(r"(?<!_target)\bresolve_workspace\s*\(")
# A2：收了 workspace 却只按 project 解析（丢弃 worktree 维度）
WS_PARAM_RE = re.compile(r"\bworkspace\s*:\s*WorkspaceSession\b")
RESOLVE_PROJECT_RE = re.compile(r"\bresolve_project\s*\(")
# 函数边界：`pub async fn <name>(` 起，到下一个同类声明或文件尾
FN_START_RE = re.compile(r"^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+", re.M)

# B：gitApi 的 worktreePath 形参（`worktreePath?: string | null` / `worktreePath: string | null`）
# 解构行（`const { projectId, worktreePath } = workspace`）不是形参，用 `?`/`:` 后的类型标注区分。
# 豁免 C 类命令：它们的 `worktreePath` 是**被操作的目标**（worktree 名/路径），不是寻址散参。
# `activateWorkspace` 旧属此表，现已改为 A 类（收 `workspace: WorkspaceSession`）。
B_EXEMPT_FNS = {"createWorktree", "removeWorktree", "renameWorktree", "isWorktreeDirty"}
GIT_API_FILE = "src/features/git/api/gitApi.ts"
WORKTREE_PARAM_RE = re.compile(r"\bworktreePath\s*\??\s*:\s*(?:string|WorkspaceSession)")

# C：伪造地址（把字面量断言 / 标注成 WorkspaceSession）
# 只拦带**类型意图**的两形；裸 `{ projectId, worktreePath }` 是合法 wire 载荷（gitApi 内部解构产出），
# 与手搓地址语法同形、语义相反，无稳定指纹可区分（见模块 docstring）。
FORGED_CAST_RE = re.compile(r"\{\s*projectId\s*:?[^}]*?worktreePath[^}]*?\}\s*as\s+WorkspaceSession")
FORGED_ANNOTATION_RE = re.compile(r":\s*WorkspaceSession\s*=\s*\{[^}]*?projectId")

# C 的豁免文件：值对象自身（JSDoc 里以字面量说明 wire 形态）
C_EXEMPT_FILES = {"src/shared/utils/workspaceRef.ts"}

# E：执行上下文台账 —— 「该不该有地址」也是可登记的事实。
# A2/D 只能看见「签名里已经有 workspace」的形态，看不见「该有却没有」。这条补另一维：
# 命令体里以 project 取 cwd/根，必须在台账登记**为什么这确实是项目级操作**，否则违规。
# 台账只增需评审 —— 新增一条登记 = 声称一个执行上下文不需要地址，正是要人看的地方。
EXEC_CTX_LEDGER = "tools/guards/ledger/exec_context_commands.json"
RESOLVE_PROJECT_CTX_RE = re.compile(r"\bresolve_project_ctx\s*\(")
# 「拿项目路径当根」的两个信号必须**同时**出现（与 D 同口径）：`get_project(` 可能只是读元数据
# （名称 / 环境），单独的 `.path` 也可能是无关字段；合起来才是「用项目路径当工作目录」。
# 形如 `pm.get_project(id).path` 与 `pm.get_project(id).map(|p| p.path.clone())` 都要命中。
GET_PROJECT_CALL_RE = re.compile(r"\bget_project\s*\(")

# G：地址**不得可选**。`Option<WorkspaceSession>` 让「没传地址就退回按 project 取根」成为合法
# 路径，而 A2/D 的判据前缀是**必填**形态（`WS_PARAM_RE`），对它完全不触发 —— 2026-10-30 实证：
# 同一函数体把形参从必填改成 `Option` 后，A2 由「违规」变「放行」。两种语义（项目级 / 单元级）
# 用判别联合表达（见 `ConversationListScope`），不用可空参数。
OPTIONAL_WS_RE = re.compile(r"\bworkspace\s*:\s*Option\s*<\s*&?\s*(?:[\w:]+::)?WorkspaceSession\s*>")
OPTIONAL_WS_LEDGER = "tools/guards/ledger/optional_workspace_commands.json"

# 测试域豁免（与 check_command_execution 同口径）
TEST_PATH_RE = re.compile(r"(^|/)(__tests__|tests)(/|$)|\.test\.(ts|tsx)$|_test\.rs$|/tests\.rs$")

# F：后端禁手搓地址（C 的后端对应物）—— 生产代码不得写 `WorkspaceSession { .. }` 字面量。
# 只匹配「字面量设置地址字段」的形态：`-> WorkspaceSession {`（函数体起始括号）与
# `impl WorkspaceSession {` 都不命中（括号后不是 `field:`）。
RS_ADDRESS_MODULE = "src-tauri/src/common/git/workspace_ref.rs"
RS_FORGE_RE = re.compile(
    r"\bWorkspaceSession\s*\{\s*(?:\n\s*)?(?:project_id|worktree_path)\s*:"
)
# F 的扫描面必须宽于命令层：逃逸口就在 `translation.rs` 这类非 commands 文件里。
RS_ALL_SCOPE = "src-tauri/src/**/*.rs"
# 整行注释（含 `///` / `//!` 文档）在 F 之前剔除：注释里写反例是合法的，且注释不是代码。
LINE_COMMENT_RE = re.compile(r"^\s*//.*$", re.M)


def _is_test(rel: str) -> bool:
    return bool(TEST_PATH_RE.search(rel))


def _is_exempt_dir(rel: str) -> bool:
    """非「在一个 Workspace 里执行」的域（见 `RS_EXEMPT_DIRS` 注释）。"""
    return rel.startswith(RS_EXEMPT_DIRS)


GUARD = Guard(
    id="check_workspace_session_addressing",
    title="按 WorkspaceSession 寻址（后端唯一解析入口 / 前端禁散签 / 禁手搓地址）",
    scopes=TS_SCOPES + RS_SCOPES,
    red_lines=(12,),
    docs="docs/domain-model.md",
    fix_hint=(
        "后端：`state.resolve_workspace_target(&workspace).await?`（勿直调 resolve_workspace）；"
        "前端：gitApi 首参收 `workspace: WorkspaceSession`，地址由 activeWorkspaceSession / "
        "WorkspaceSession.of / fromKey 构造，禁止手搓 { projectId, worktreePath }"
    ),
)


def _iter_functions(text: str):
    """按 `fn` 声明切出 `(起始偏移, 结束偏移)`，供函数级判据使用。"""
    starts = [m.start() for m in FN_START_RE.finditer(text)]
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        yield start, end


def _owning_function(text: str, pos: int) -> str | None:
    """TS 侧：偏移 `pos` 所属的 `export function <name>` 名（找不到返回 None）。"""
    owner = None
    for m in re.finditer(r"export (?:async )?function (\w+)\(", text):
        if m.start() > pos:
            break
        owner = m.group(1)
    return owner


def _load_registry(ctx: Context, ledger: str) -> dict:
    """读台账（`{ "rel::fn": "reason" }`）。缺失/不可解析 ⇒ 空表，由判据报违规。"""
    path = ctx.path(ledger)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    entries = data.get("commands") if isinstance(data, dict) else None
    return entries if isinstance(entries, dict) else {}


def _rs_fn_name(body: str) -> str | None:
    """从函数块首行取 `fn <name>`。"""
    m = re.search(r"\bfn\s+(\w+)", body[:200])
    return m.group(1) if m else None


def check(ctx: Context) -> GuardResult:
    ts_files = sorted({p for scope in TS_SCOPES for p in ctx.glob(scope)})
    # `mod.rs` 只允许声明 + re-export（红线 9），不可能承载命令体 —— 排除，免得它们充数。
    rs_files = sorted(
        p for scope in RS_SCOPES for p in ctx.glob(scope) if p.name != "mod.rs"
    )
    if not ts_files:
        return GuardResult.broken("在 src/**/*.{ts,tsx} 下扫到 0 个文件 —— 口径失效", scanned=0)
    if not rs_files:
        return GuardResult.broken(
            "在 src-tauri/src/**/commands*.rs 下扫到 0 个文件 —— 口径失效", scanned=0
        )

    findings: list[Finding] = []
    exec_ctx_registry = _load_registry(ctx, EXEC_CTX_LEDGER)
    optional_ws_registry = _load_registry(ctx, OPTIONAL_WS_LEDGER)

    # ── A1：后端唯一解析入口（无条件：命令层不得直调旧入口，AC3 字面零命中）
    # ── A2：收 workspace 的命令不得只按 project 解析（丢 worktree 维度，§10 戳错单元）
    # ── D ：收了地址却仍从 `get_project(...).path` 取根（半迁移态）
    for path in rs_files:
        rel = ctx.rel(path)
        if _is_test(rel) or _is_exempt_dir(rel):
            continue
        text = ctx.read(rel)
        for start, end in _iter_functions(text):
            body = text[start:end]
            for m in RESOLVE_DIRECT_RE.finditer(body):
                findings.append(
                    Finding(
                        "命令层不得直调 `resolve_workspace(`：唯一入口是 "
                        f"`resolve_workspace_target(&workspace)`；直调 {m.group(0)!r} "
                        "会让解析逻辑存在两个外观",
                        rel,
                        text.count("\n", 0, start + m.start()) + 1,
                    )
                )
            if WS_PARAM_RE.search(body):
                for m in RESOLVE_PROJECT_RE.finditer(body):
                    findings.append(
                        Finding(
                            "收 `workspace: WorkspaceSession` 却调 `resolve_project(`："
                            "会丢弃 worktree 维度（worktree 视图静默按主仓执行）；"
                            "用 `resolve_workspace_target(&workspace)`",
                            rel,
                            text.count("\n", 0, start + m.start()) + 1,
                        )
                    )
                # D：收了地址却仍从 `get_project(...).path` 取根（半迁移态）。
                # 两个信号**同时**出现才算：只有 `get_project(` 可能只是读元数据（名称 / 环境），
                # 只有 `.path` 也可能是无关字段 —— 合起来才是「用项目路径当工作目录」。
                if GET_PROJECT_RE.search(body) and PROJECT_PATH_RE.search(body):
                    for m in GET_PROJECT_RE.finditer(body):
                        findings.append(
                            Finding(
                                "收 `workspace: WorkspaceSession` 却仍从 `get_project(...).path` "
                                "取工作目录：那会把**另一个**根交给下游（worktree 视图扫主仓）；"
                                "根唯一来源是 `resolve_workspace_target(&workspace)` → `repo.root()`",
                                rel,
                                text.count("\n", 0, start + m.start()) + 1,
                            )
                        )

    # ── E：执行上下文台账（没有 workspace 形参的命令也必须说清「为什么不需要地址」）
    for path in rs_files:
        rel = ctx.rel(path)
        if _is_test(rel) or _is_exempt_dir(rel):
            continue
        # 内联 `#[cfg(test)] mod tests` 不是命令体（docstring 的豁免承诺必须实现）。
        text = mask_cfg_test(ctx.read(rel))
        for start, end in _iter_functions(text):
            body = text[start:end]
            name = _rs_fn_name(body)
            if name is None:
                continue
            # 收了地址的命令由 A2/D 判（那是「半迁移」形态）；E 只管「压根没有地址」的命令。
            if WS_PARAM_RE.search(body):
                continue
            hit = RESOLVE_PROJECT_CTX_RE.search(body)
            if hit is None and (
                GET_PROJECT_CALL_RE.search(body) and PROJECT_PATH_RE.search(body)
            ):
                hit = GET_PROJECT_CALL_RE.search(body)
            if hit is None:
                continue
            line = text.count("\n", 0, start + hit.start()) + 1
            key = f"{rel}::{name}"
            reason = exec_ctx_registry.get(key)
            if reason is None:
                findings.append(
                    Finding(
                        "命令体从 project 取 cwd/根，但未在 `ledger/exec_context_commands.json` "
                        "登记：执行地址必须是 `WorkspaceSession`（worktree 单元与主仓是两个执行上下文）。"
                        "确属项目级操作请登记并写明理由",
                        rel,
                        line,
                    )
                )
            elif not str(reason).strip():
                findings.append(
                    Finding(
                        f"台账 {key} 的 reason 为空：登记必须说明「为什么这不是执行上下文」",
                        rel,
                        line,
                    )
                )

    # ── G：地址不得可选（`Option<WorkspaceSession>` 让「丢地址」变成静默降级）
    # 扫描面与 F 同为**全部 Rust 文件**：逃逸口不只在命令层 —— 请求结构体可以住在
    # `conversation/types.rs` 这类非 commands 文件里，命令层只是把它传下去。
    for path in sorted(ctx.glob(RS_ALL_SCOPE)):
        rel = ctx.rel(path)
        if rel == RS_ADDRESS_MODULE or _is_test(rel) or _is_exempt_dir(rel):
            continue
        # 注释里写反例是合法的（docstring 也会提到这个类型），先剔除整行注释再判。
        text = LINE_COMMENT_RE.sub("", mask_cfg_test(ctx.read(rel)))
        if not OPTIONAL_WS_RE.search(text):
            continue
        # 台账按「所属函数」登记；形参之外（结构体字段）无归属函数时用文件级键。
        spans = list(_iter_functions(text))
        for m in OPTIONAL_WS_RE.finditer(text):
            owner = None
            for start, end in spans:
                if start <= m.start() < end:
                    owner = _rs_fn_name(text[start:end])
                    break
            key = f"{rel}::{owner}" if owner else rel
            reason = optional_ws_registry.get(key)
            line = text.count("\n", 0, m.start()) + 1
            if reason is None:
                findings.append(
                    Finding(
                        "执行地址不得可选（`workspace: Option<WorkspaceSession>`）："
                        "缺地址时会静默退回按 project 取根，正是 worktree 单元跑错目录的形态。"
                        "项目级与单元级请用判别联合区分（参考 `ConversationListScope`）；"
                        "确属必需的请登记 ledger/optional_workspace_commands.json 并写明理由",
                        rel,
                        line,
                    )
                )
            elif not str(reason).strip():
                findings.append(
                    Finding(
                        f"台账 {key} 的 reason 为空：登记必须说明「为什么这里的地址可以缺」",
                        rel,
                        line,
                    )
                )

    # ── F：后端禁手搓地址（扫全部 Rust 文件 —— 逃逸口不只在命令层）
    for path in sorted(ctx.glob(RS_ALL_SCOPE)):
        rel = ctx.rel(path)
        if rel == RS_ADDRESS_MODULE or _is_test(rel):
            continue
        code = LINE_COMMENT_RE.sub("", mask_cfg_test(ctx.read(rel)))
        for m in RS_FORGE_RE.finditer(code):
            findings.append(
                Finding(
                    "手写 `WorkspaceSession { .. }` 字面量：地址只能由命名构造点产生"
                    "（`WorkspaceSession::of` / `::main`，或前端 `activeWorkspaceSession`）。"
                    "项目级通道用 `WorkspaceSession::main(id)` 显式声明「按主 checkout 执行」",
                    rel,
                    code.count("\n", 0, m.start()) + 1,
                )
            )

    # ── B：前端禁散签（只查 gitApi.ts 的形参；C 类命令的 worktreePath 是被操作目标，豁免）
    for path in ts_files:
        rel = ctx.rel(path)
        if rel != GIT_API_FILE or _is_test(rel):
            continue
        text = ctx.read(rel)
        # 逐函数：C 类函数体内的形参不判
        for m in WORKTREE_PARAM_RE.finditer(text):
            owner = _owning_function(text, m.start())
            if owner in B_EXEMPT_FNS:
                continue
            findings.append(
                Finding(
                    f"旧散参形参 {m.group(0)!r} 已退役：gitApi 首参改为 "
                    "`workspace: WorkspaceSession`（内部解构取 worktreePath）",
                    rel,
                    text.count("\n", 0, m.start()) + 1,
                )
            )

    # ── C：前端禁伪造地址
    for path in ts_files:
        rel = ctx.rel(path)
        if _is_test(rel) or rel in C_EXEMPT_FILES:
            continue
        text = ctx.read(rel)
        for m in FORGED_CAST_RE.finditer(text):
            findings.append(
                Finding(
                    "不得把字面量 `as WorkspaceSession` 伪造地址："
                    "用 activeWorkspaceSession / WorkspaceSession.of / fromKey 构造",
                    rel,
                    text.count("\n", 0, m.start()) + 1,
                )
            )
        for m in FORGED_ANNOTATION_RE.finditer(text):
            findings.append(
                Finding(
                    "不得用类型标注把字面量写成 WorkspaceSession："
                    "用 activeWorkspaceSession / WorkspaceSession.of / fromKey 构造",
                    rel,
                    text.count("\n", 0, m.start()) + 1,
                )
            )

    metrics = f"后端 {len(rs_files)} / 前端 {len(ts_files)} 个文件 / 违规 {len(findings)}"
    if findings:
        return GuardResult.violated(len(ts_files) + len(rs_files), findings, metrics=metrics)
    return GuardResult.passed(len(ts_files) + len(rs_files), metrics=metrics)
