"""仓库单元身份（RepoRef）的结构性护栏 —— 钉住「一次做穿」的结果，防其静默回退。

背景（第一性原理）：`git status = f(HEAD, index, workdir)`，而 linked worktree 的这三者
全都独立（只共享 object DB），所以一个 project 在 git 语义下是 `1 + N` 个仓库单元。
此前整条链路只以 `project_id` 为身份，后果是两类现场缺陷：worktree 视图没有权威生产者
（列表不更新，要靠手动刷新）、与主仓共用一个槽（串 main 内容）。2026-09 的重构把身份补
到「仓库单元」这一真实粒度，并**删除**了为此而存在的第二实现与兼容分支。

为什么需要护栏：这类东西的退化方式不是「写新代码时忘了」，而是「把旧通道又接回来」——
旧符号还活在注释与历史里，粘一条 `version <= 0 恒放行` 或一个 `worktreeStore` 镜像字段
回来，界面当下就「好了」，而身份维度再次分叉。本护栏把「必须为 0」写成可执行判据：

1. **退役符号**：被删掉的第二实现 / 兜底分支的符号名，不得再出现在生产代码里
   （注释里允许 —— 注释是记录「为什么删」的地方，删掉记录反而会让它被重新发明）。
2. **第二表示**：`worktreeStore` 的激活态只能经 selector / hook 读，不得再摸镜像属性
   （含解构形态），也不得绕过 `selectActiveRepoKey` / `activeRepoKeyOf` 直读
   `.byProject[...].activePath`（渲染期直读还会停在旧值）。
3. **单一出口**：status 相关 Tauri 命令只能在 `gitApi.ts` 封装；`RepoKey` 只能由
   `repoRef.ts` 产出（别处手拼即第二处 key 实现，必然与后端 `RepoRef::key()` 漂移）。
   ahead/behind 的键就是该 `RepoKey` 本身 —— 带 `{source}:{connectionId}` 前缀的
   `aheadBehindKey` 已退役（读侧拼不出写侧的键，徽标时有时无）。
4. **挂载唯一入口**：生产代码里 `WatcherManager::watch` 只允许出现在 `git/services/status.rs`
   的 `activate()`。R2.1 的「挂载入口唯一」以前只是注释里的约定，实测就被 `app.rs` 启动恢复
   与 `set_active_project` 两处「按项目预挂主仓单元」破掉（每次启动都出现两个发起点，日志报
   `already watched`）；把它写成判据，下一个想「顺手先挂一下」的改动会直接被挡下。
5. **写后收口接线**：`git/commands/` 下任何调用「改变该单元 `f(HEAD, index, workdir)`」的
   operation 的 `#[tauri::command]`，函数体内必须出现收口调用（`wait_status_fresh` /
   `wait_main_status_fresh` / `release_unit`）。命令层要 `State<AppStateWrapper>` 才跑得起来，
   `cargo test` 造不出那个组合根 —— 这条契约只能静态钉，否则「操作成功但列表要手动刷新」会随
   下一个新增的写命令悄悄回来。不改变 status 的操作（push / fetch / create_tag / 建删分支 …）
   一律进 `NO_STATUS_IMPACT_OPERATIONS` 台账并写明理由。
6. **材质白名单**：RepoKey 的第二实现必须「材质化」分隔符 —— 引用 `KEY_SEP` /
   `REPO_KEY_SEP`，或书写 NUL 转义（**任何**引号形态：单引号 / 双引号 / 模板字面量 /
   Rust 的 `\\u{0}`），或 `String.fromCharCode(0)`。这些材质只允许出现在
   `KEY_MATERIAL_ALLOWLIST` 登记的文件里。旧判据只认引号包裹的 `'\\0'`，于是 TS 最自然的
   手拼形态 `` `${projectId}\\0${wtPath}` `` 与 Rust 的 `format!("{}\\u{0}{}", …)` 都能溜过
   —— 那恰是「把旧通道接回来」时最可能写的形态。冒号式（历史缺陷 `${projectId}:wt:${path}`）
   只在**流入 repo-key 消费点**的同形判据下拦截：tab / 终端缓存 / onboarding 各有自己合法的
   `:` 分隔命名空间，全面禁冒号必然误伤。

判据全是「命中即违规」，刻意不配计数台账 —— 台账服务于「已知违例逐个消债」，
这里要的是「永远为零」。扫描集为空由框架统一拦截（见 `core/contract.py`）。

已知边界（诚实声明）：行级静态判据是启发式 —— 无域上下文词的 NUL 复合（如把 worktree
路径存进名为 `p` 的变量再拼接）、经多行/跨变量间接流入消费点的冒号式 key、以及 version
归零这类**运行时**行为，分别由 golden 双端测试与 `cargo test`（`remount_continues_*` /
`pull_after_a_release_*`）兜底，不在本护栏射程内。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

FE_SCOPES = ("src/**/*.ts", "src/**/*.tsx")
BE_SCOPE = "src-tauri/src/**/*.rs"

# 退役符号：身份补全后被删除的第二实现 / 兜底分支 / 双份表示。
RETIRED_FRONTEND = (
    "versionGateAccepts",  # per-project version 门控（含 version<=0 恒放行）
    "applyGitStatus",  # 写 per-project changed_files 的旧入口
    "refreshGitFileStates",  # (projectId, worktreePath) 形态的刷新入口
    "getWorktreeChangedFiles",  # 返回 version=0 的读接口封装
    "ChangedFilesPayload",  # version: 0 = 无版本语义的载荷
    "createDebouncedGitRefresh",  # 以 projectId 为键、可被 '' 覆盖 worktreePath 的调度器
    "mergeGitInfoForStore",  # 「worktree 激活时保留主分支名」的共享槽补丁
    "worktreeStateMap",  # 与全局镜像并存的第二份激活态
    # ahead/behind 的复合键 helper：键里带 `{source}:{connectionId}`，而三个写入点各用一种
    # connectionId 约定（`distro` / `${host}:${port}` / `host`）⇒ 读侧永远拼不出写侧的键。
    # 定址只允许仓库单元身份本身（`repoKeyOf`）。
    "aheadBehindKey",
)
RETIRED_BACKEND = (
    "get_worktree_changed_files",  # libgit2 第二套 status 引擎
    "get_changed_files_from_repo",  # 同上
    "resolve_validated_work_dir",  # 校验时 canonicalize、返回时丢弃结果
    "validate_worktree_path",  # 只校验不归一
    "rearm_worktrees_if_needed",  # 主仓代收别的工作树的事件
    "resolve_worktree_roots",  # 同上
    "is_gitignore_rules_change",  # 同上（规则热重载已落到各单元自己的 watcher）
    "WorktreeMetaChanged",  # 跨单元事件分类
    "has_worktrees",  # 跨单元监听开关
    "apply_rearm_result",  # 同上
)

# 新实现自己的定义点（允许出现这些名字）
FE_ALLOWLIST = (
    "src/shared/utils/repoRef.ts",
    "src/shared/utils/tabKey.ts",  # tab 空间另有自己的复合键约定
)
# status 命令的两个合法出口：git 域的 api 封装，以及 ProjectCommands 这个**按单元绑定**的
# 端口（`createProjectCommands(projectId, worktreePath)` —— 面板经它拿数据，不各自 invoke）。
# 判据要防的是第三个出口：组件 / hook 里散落裸 invoke。
STATUS_COMMAND_ALLOWLIST = (
    "src/features/git/api/gitApi.ts",
    "src/features/project/hooks/use-active-project/commandFactory.ts",
)

# 镜像属性：`.activeWorktreePath`（读取）、`activeWorktreePath:`（对象字面量里定义）、
# 或 `{ activeWorktreePath }`（解构 —— 绕过 selector 的另一种拿法）
MIRROR_ACCESS_RE = re.compile(
    r"\.(?:activeWorktreePath|activeWorktreeBranch|openedWorktrees)\b"
    r"|(?:^|[\s{,(])(?:activeWorktreePath|activeWorktreeBranch|openedWorktrees)\s*:"
    r"|[\{,]\s*(?:activeWorktreePath|activeWorktreeBranch|openedWorktrees)\b"
)
# 绕过 selector 直摸 store 内部状态：`.byProject[...]` 上取激活态字段（渲染期尤其危险 ——
# 非响应式读取会停在旧值）。唯一读取口是 `selectActiveRepoKey` / `selectActiveWorktreePath`。
STORE_STATE_ACCESS_RE = re.compile(r"\.byProject\b[^\n]*\.(?:activePath|activeBranch|opened)\b")
# 允许在自己的定义处（store 实现文件）访问内部状态
STORE_STATE_ALLOWLIST = ("src/shared/store/worktreeStore.ts",)
# status 寻址面的命令名特征（repo_status / repo_unit / status_snapshot）而非枚举两个名字：
# 新增同族命令默认设防（deny-by-default），不需要记得回来扩清单。
STATUS_INVOKE_RE = re.compile(
    r"""invoke[^\n]*['"][a-z_]*(?:repo_status|repo_unit|status_snapshot)[a-z_]*['"]"""
)

# ── 判据 6：RepoKey 材质白名单 ──────────────────────────────────────────────
# 强材质：KEY_SEP 标识符与 fromCharCode(0) 没有第二种合法用途 —— 出现即必须在白名单文件里。
KEY_MATERIAL_STRONG_RE = re.compile(
    r"\bKEY_SEP\b|\bREPO_KEY_SEP\b|String\.fromCharCode\(\s*0\s*\)"
)
# NUL 转义材质：任何引号形态（'…' / "…" / 反引号模板字面量 / Rust 的 \u{0}）。
# `\\0(?!\d)` 排除 `\012` 这类八进制转义误配。
KEY_MATERIAL_NUL_RE = re.compile(r"\\u\{0\}|\\u0000|\\0(?!\d)")
# NUL 材质的域上下文词：同一行出现仓库单元语义才算 RepoKey 材质化候选 ——
# runner 的 `${projectId}\0${filePath}`（测试结果键）、LSP 的 `${projectPath}\0${languageId}`
# （文档归属键）、git `-z` 输出解析的 `split('\0')` 等无关命名空间不被误伤。
KEY_MATERIAL_CONTEXT_RE = re.compile(
    r"worktree|wtPath|repoKey|repo_key|RepoKey|RepoRef", re.IGNORECASE
)
# 唯一允许材质化 RepoKey 的文件（每条必须写明理由；新增条目 = 出现了第二处 key 实现，
# review 必须拦下而不是顺手登记）。
KEY_MATERIAL_ALLOWLIST = {
    "src/shared/utils/repoRef.ts": "RepoKey 的唯一产出点（与后端 RepoRef::key 逐字对齐）",
    "src-tauri/src/common/git/repo_ref.rs": "RepoRef::key 的唯一产出点 + 内联 golden 测试",
    "src-tauri/src/common/git/status_worker/writer.rs": "快照序列化的 golden 断言（repo_key 的 JSON 形态）",
    "src-tauri/src/common/git/path_guard.rs": "NUL 拒绝路径的测试夹具（UnitPath::resolve 的输入校验闸门）",
}
# 冒号式复合键流入 repo-key 消费点（历史缺陷 `${projectId}:wt:${path}` 的同形复发）。
# 只拦「projectId 插值模板串 + 消费词同现」：tab / 终端缓存 / onboarding 的 `:` 命名空间各自合法。
COLON_KEY_RE = re.compile(r"`[^`]*\$\{[^}]*[pP]roject[iI]d[^}]*\}[:|][^`]*`")
COLON_KEY_CONSUMER_RE = re.compile(
    r"repoKey|RepoKey|repo_key|statuses|aheadBehind|applyStatus|invalidateStatus|setAheadBehind"
)
COMMENT_ONLY = re.compile(r"^\s*(//|/\*|\*|///|#(?!pragma))")


GUARD = Guard(
    id="check_repo_unit_identity",
    title="git 状态的仓库单元身份不得被第二实现 / 兜底分支 / 镜像字段稀释，写命令必须收口",
    scopes=(*FE_SCOPES, BE_SCOPE),
    red_lines=(5, 12),
    docs=".trellis/spec/backend/git-domain.md",
    fix_hint=(
        "status 的寻址单位是仓库单元（`RepoRef` / `repoKeyOf(projectId, canonicalWtPath)`），"
        "不是 project。请经 `applyStatus` 写、经 selector 读激活态、经 `gitApi` 发命令；"
        "不要恢复被删除的 version=0 / allowEqual / 全局镜像等第二通道。"
    ),
)


def _code_lines(text: str) -> list:
    """注释行按空行处理（行号保持不变，Finding 要能钉回 diff 行）。"""
    return ["" if COMMENT_ONLY.match(line) else line for line in text.splitlines()]


def _read(path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _key_material_findings(rel: str, number: int, line: str) -> list:
    """判据 6 的执行体（FE / BE 扫描共用；`rel` 在此统一成 posix 形态再比白名单）。"""
    rel = rel.replace("\\", "/")
    out: list[Finding] = []
    strong = KEY_MATERIAL_STRONG_RE.search(line)
    nul = KEY_MATERIAL_NUL_RE.search(line) and KEY_MATERIAL_CONTEXT_RE.search(line)
    if (strong or nul) and rel not in KEY_MATERIAL_ALLOWLIST:
        out.append(
            Finding(
                "手拼/材质化 RepoKey：key 只能由 `repoRef.ts::repoKeyOf`（前端）/ "
                "`repo_ref.rs::RepoRef::key()`（后端）产出。KEY_SEP 标识符与 NUL 转义"
                "（含模板字面量、`\\u{0}`、fromCharCode(0)）只允许出现在 "
                "KEY_MATERIAL_ALLOWLIST 文件里 —— 第二处实现必然与后端 key 形态漂移",
                rel,
                number,
            )
        )
    if COLON_KEY_RE.search(line) and COLON_KEY_CONSUMER_RE.search(line):
        out.append(
            Finding(
                "冒号式复合键流入 RepoKey 消费点：`${projectId}:…` 是同一身份的第二表示"
                "（历史缺陷形态 `${projectId}:wt:${path}`）。status / ahead-behind 的定址"
                "只认 `repoKeyOf(projectId, canonicalWtPath)`",
                rel,
                number,
            )
        )
    return out


def scan_frontend(ctx: Context) -> tuple:
    findings: list[Finding] = []
    paths = [path for pattern in FE_SCOPES for path in ctx.glob(pattern)]
    scanned = 0
    for path in paths:
        rel = ctx.rel(path)
        if "__tests__" in rel or rel.startswith("src/testing/"):
            continue
        text = _read(path)
        if not text:
            continue
        scanned += 1
        allow_retired = rel.startswith(FE_ALLOWLIST)
        allow_store_state = rel in STORE_STATE_ALLOWLIST
        for number, line in enumerate(_code_lines(text), start=1):
            for symbol in RETIRED_FRONTEND:
                if not allow_retired and symbol in line:
                    findings.append(
                        Finding(
                            f"退役符号 `{symbol}` 又回来了 —— 它是共享单槽时代的第一/第二实现，"
                            "重新引入等于把身份维度再削回 project",
                            rel,
                            number,
                        )
                    )
            if "WorktreeStore" in line or "worktreeStore" in line or ".byProject" in line:
                if MIRROR_ACCESS_RE.search(line):
                    findings.append(
                        Finding(
                            "直接摸 `worktreeStore` 的镜像字段：激活态只有 "
                            "`byProject[projectId]` 一份表示，请改用 "
                            "`selectActiveWorktreePath(state, projectId)` / `useActiveWorktreePath()`",
                            rel,
                            number,
                        )
                    )
            if not allow_store_state and STORE_STATE_ACCESS_RE.search(line):
                findings.append(
                    Finding(
                        "绕过 selector 直读 store 内部状态（`.byProject[...].activePath`）："
                        "「当前单元」的唯一派生点是 `selectActiveRepoKey` / `activeRepoKeyOf`"
                        "（渲染期直读还会停在旧值 —— 非响应式）",
                        rel,
                        number,
                    )
                )
            if STATUS_INVOKE_RE.search(line) and rel not in STATUS_COMMAND_ALLOWLIST:
                findings.append(
                    Finding(
                        "status 命令只能在 gitApi.ts 或 ProjectCommands 端口封装（api-layer 单一出口）",
                        rel,
                        number,
                    )
                )
            findings.extend(_key_material_findings(rel, number, line))
    return scanned, findings


def scan_backend(ctx: Context) -> tuple:
    findings: list[Finding] = []
    paths = list(ctx.glob(BE_SCOPE))
    for path in paths:
        text = _read(path)
        if not text:
            continue
        rel = ctx.rel(path)
        for number, line in enumerate(_code_lines(text), start=1):
            for symbol in RETIRED_BACKEND:
                if re.search(rf"\b{re.escape(symbol)}\b", line):
                    findings.append(
                        Finding(
                            f"退役符号 `{symbol}` 又回来了 —— status 的计算与寻址都只允许一条路径"
                            "（CLI porcelain + `RepoRef` 定址）",
                            rel,
                            number,
                        )
                    )
            findings.extend(_key_material_findings(rel, number, line))
    return len(paths), findings


# ── 第 4 类判据：写命令的 status 收口接线（§10 的「任何写命令」是全称命题）────────
#
# 为什么用静态判据而不是运行时测试：命令层要 `State<AppStateWrapper>` 才能跑，`cargo test`
# 造不出那个组合根（本仓可测试性契约的边界就在这里）。而「漏一次收口」的表现恰好是用户报的
# 那句「操作成功了但列表要手动刷新」——它必须由 CI 挡住，不能靠人记得。
#
# 判据：`git/commands/` 下任何 `#[tauri::command]` 调用了**改变该单元
# status = f(HEAD, index, workdir)** 的 operation，函数体内就必须出现收口调用
# （`wait_status_fresh` / `wait_main_status_fresh` / `release_unit`）。
# 例外一律走下面的显式台账 —— 台账要写清「为什么不改变 status」，不接受"看着像只读"。
COMMANDS_SCOPE = "src-tauri/src/git/commands/"
STATUS_CLOSURE_CALLS = ("wait_status_fresh", "wait_main_status_fresh", "release_unit")
# 只读形态（前缀判定）：不写任何东西，自然没有收口义务。
READ_ONLY_PREFIXES = ("get_", "list_", "is_", "detect_", "has_", "find_", "default_branch")
# 显式台账：确实写仓库、但不改变**被调用单元**的 HEAD / index / workdir 的操作。
NO_STATUS_IMPACT_OPERATIONS = {
    "create_branch": "只建 ref，HEAD 仍指原提交（工作树与 index 一字不动）",
    "delete_branch": "git 拒删已检出的分支，因此该单元的 HEAD 必然不受影响",
    "create_tag": "写的是 tag，不进 status",
    "push": "只上传对象，本地工作树/索引/HEAD 不变",
    "push_with_credentials": "同 push",
    "fetch": "只更新 remote-tracking ref，工作树与当前分支的 HEAD 不变",
    "fetch_with_credentials": "同 fetch",
    "stash_drop": "删 stash 条目不触碰当前工作树（apply / pop 会，故它们不在此列）",
}
# 挂载唯一入口：生产代码里 `WatcherManager::watch` 的合法调用文件（管理器自身实现与测试除外）。
MOUNT_ALLOWLIST = ("src-tauri/src/git/services/status.rs",)
# 任意接收者的 `.watch(` 都算候选（不硬编码变量名 —— 改名即绕过的判据等于没有判据）；
# notify 内部的 `watcher.watch(path, mode)` 全部位于 common/file/watcher/（已整体豁免）。
MOUNT_CALL_RE = re.compile(r"\w+\s*\.\s*watch\s*\(")


def scan_mount_singularity(ctx: Context) -> tuple:
    """`WatcherManager::watch` 的调用点必须只有一个（`activate()`）。"""
    findings: list[Finding] = []
    paths = list(ctx.glob(BE_SCOPE))
    for path in paths:
        rel = ctx.rel(path).replace("\\", "/")
        if "common/file/watcher/" in rel or rel in MOUNT_ALLOWLIST:
            continue  # 管理器自身定义处与唯一合法调用方
        for number, line in enumerate(_code_lines(_read(path)), start=1):
            if MOUNT_CALL_RE.search(line):
                findings.append(
                    Finding(
                        "挂载唯一入口是 `git/services/status.rs::activate`；此处直接 `watch()` "
                        "等于加第二个「谁在看」的发起点（实测破过一次：启动时先挂主仓、随后被前端改挂 worktree）",
                        rel,
                        number,
                    )
                )
    return len(paths), findings


# 命令块与函数签名：attribute 允许带参数形态 `#[tauri::command(...)]`，函数允许同步
# （tauri command 不强制 async —— 只认 `pub async fn` 会让同步写命令静默漏检）。
COMMAND_BLOCK_RE = re.compile(
    r"#\[tauri::command(?:\([^\]]*\))?\](.*?)(?=#\[tauri::command(?:\([^\]]*\))?\]|\Z)", re.S
)
FN_RE = re.compile(r"pub(?:\(crate\))?\s+(?:async\s+)?fn\s+(\w+)[^)]*\)\s*->[^{]*(\{.*\})", re.S)
OPERATIONS_CALL_RE = re.compile(r"operations::(\w+)\s*\(")


def scan_write_command_wiring(ctx: Context) -> tuple:
    """命令层「写后必须收口」的接线判据。返回 (扫描文件数, findings)。"""
    findings: list[Finding] = []
    paths = [
        path
        for path in ctx.glob(BE_SCOPE)
        if COMMANDS_SCOPE in ctx.rel(path).replace("\\", "/")
    ]
    for path in paths:
        text = _read(path)
        if "[tauri::command]" not in text:
            continue
        rel = ctx.rel(path)
        for block in COMMAND_BLOCK_RE.findall(text):
            match = FN_RE.search(block)
            if not match:
                continue
            name, body = match.group(1), match.group(2)
            writes = [
                op
                for op in OPERATIONS_CALL_RE.findall(body)
                if not op.startswith(READ_ONLY_PREFIXES) and op not in NO_STATUS_IMPACT_OPERATIONS
            ]
            if not writes:
                continue
            if not any(marker in body for marker in STATUS_CLOSURE_CALLS):
                findings.append(
                    Finding(
                        f"写命令 `{name}` 调用了改变 status 的 {sorted(set(writes))} 却没有收口 "
                        "（`wait_status_fresh` / `wait_main_status_fresh` / `release_unit`）："
                        "读接口会拿写前快照当权威数据返回 —— 正是「操作成功但列表要手动刷新」的根因。"
                        "确属不改变 status 的操作，请进 NO_STATUS_IMPACT_OPERATIONS 并写明理由",
                        rel,
                        1,
                    )
                )
    return len(paths), findings


def check(ctx: Context) -> GuardResult:
    fe_scanned, fe_findings = scan_frontend(ctx)
    be_scanned, be_findings = scan_backend(ctx)
    cmd_scanned, cmd_findings = scan_write_command_wiring(ctx)
    mount_scanned, mount_findings = scan_mount_singularity(ctx)
    findings = list(fe_findings) + list(be_findings) + list(cmd_findings) + list(mount_findings)
    scanned = fe_scanned + be_scanned
    metrics = (
        f"前端 {fe_scanned} / 后端 {be_scanned} 个文件"
        f"（命令层 {cmd_scanned} / 挂载扫描 {mount_scanned}），{len(findings)} 处违规"
    )
    if findings:
        return GuardResult.violated(scanned, findings, metrics=metrics)
    return GuardResult.passed(scanned, metrics=metrics)
