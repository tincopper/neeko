# T1 Design：不变量台账 + 一致性门禁

## 1. 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | 台账与新红线表**分离**（`invariants.json`），不改 `agents_md_routing.json` 的表头 | `check_agents_md_size` 的表头即契约；改列会连带改其 ledger 与自测，收益不抵扰动 |
| D2 | 落点只存**指针**（guard id / 路径 / lint 规则），不复制规则正文 | 正文仍单一事实源在各自 spec/AGENTS.md；台账只管「有没有机制」 |
| D3 | `prose` 是**合法** tier，但必须带 reason 且每次运行打印 | 目标不是「全部机械化」，而是「没有无人知晓的未机械化」 |
| D4 | 门禁用**文件存在性 + 文本匹配**解析落点，不 import checks 模块 | 避免「守卫 import 守卫」的注册表循环；`ctx.glob` 已够 |
| D5 | 红线引用完整性放在本 guard，不放进 `check_agents_md_size` | 装配点唯一：对外键引用校验与「不变量有机制」同域 |

## 2. 台账 schema

```jsonc
{
  "tiers": {
    "type":      "编译期：非法状态写不出来",
    "structure": "模块/所有权：装配点唯一，绕不过",
    "guard":     "确定性静态判据（CI 可复现）",
    "lint":      "既有 lint 规则",
    "test":      "行为测试（含护栏自测与 golden）",
    "prose":     "无法机械化：文档 + AI 复审（必须写明理由）"
  },
  "invariants": [
    {
      "id": "repo-unit-key-single-source",
      "title": "仓库单元身份只能由 RepoRef / repoKeyOf 产出",
      "tier": "guard",
      "enforcement": [{"kind": "guard", "ref": "check_repo_unit_identity"}],
      "red_line": 12,
      "note": null,
      "reason": null
    }
  ]
}
```

字段约束：
- 顶层必填 `tiers` / `invariants`，均非空（`load_ledger` 已强制非空）。
- `id` 非空且全局唯一；`title` 非空；`tier` ∈ `tiers` keys。
- `enforcement` 非空数组；每项 `kind` ∈ {guard,lint,test,type,structure,prose}。
- `red_line` 可为 null 或 int；非 null 时必须存在于红线 signatures。
- 不同 kind 的附加必填：`type`/`structure` → `note`；`prose` → `reason`。

## 3. 判据实现（`check_invariant_enforcement.py`）

```
check(ctx):
  ledger = load_ledger("invariants", required_keys=("tiers","invariants"))
  signatures = load_ledger("agents_md_routing")["signatures"]   # 15 条 # -> 签名
  findings = []
  findings += validate_invariants(ledger, ctx, signatures)
  findings += validate_guard_red_line_refs(ctx, signatures)
  scanned = len(invariants) + len(guard_files)
  if scanned == 0 -> broken（框架亦会拦，但显式声明）
  return passed/violated(scanned, findings, metrics=...)
```

`validate_guard_red_line_refs`：`ctx.glob("tools/guards/checks/*.py")`，正则
`red_lines\s*=\s*\(([^)]*)\)` 抽数字；任一数字 ∉ signatures → Finding。

`load_ledger` 抛 `LedgerError` 时返回 `GuardResult.broken`（台账坏 = 门禁自身失效，退出码 2）。

## 4. 落点解析细节

| kind | 解析 |
| --- | --- |
| guard | `ctx.path(f"tools/guards/checks/{ref}.py").is_file()` |
| test | `ctx.path(ref).is_file()` |
| lint | `ref in ctx.read(".eslintrc.cjs")`（文件不存在 → broken） |
| type / structure | `ctx.path(ref).is_file()` 且 `note` 非空 |
| prose | `reason` 非空（不解析路径） |

## 5. 台账初值（本任务登记，证明机制可用）

登记仓库**现有**机制，不含 T2 尚未实现的条目：

1. `repo-unit-key-single-source`（guard `check_repo_unit_identity`，红线 12）
2. `mount-entry-singularity`（guard `check_repo_unit_identity`，红线 12）
3. `blocking-io-off-async-thread`（guard `blocking_fs`，红线 3）
4. `platform-diff-in-platform-adapter`（guard `platform_imports`，红线 10）
5. `worktree-byte-assertion-ban`（guard `worktree_byte_assertions`，红线 11/13）
6. `read-only-git-semantics-single-source`（guard `check_git_optional_locks_single_source`，红线 1）
7. `ipc-large-payload-boundary`（**prose**，红线 4，reason：需运行时载荷体积，静态不可判；兜底：review + 分页/二进制流约定）

（T2 会追加 `service-no-delivery-dependency` / `status-single-read-path` / `component-size-budget`。）

## 6. 文档落档

新增 `.trellis/spec/guides/invariant-enforcement.md`：
- 层级阶梯（type/structure/guard/lint/test/prose）与「硬指标不得停在 test/prose 之下」规则；
- 台账字段与新增一条不变量的步骤；
- 与 `check_agents_md_size` 的分工（红线正文路由 vs 不变量强制落点）。

## 7. 测试计划（`tools/guards/tests/test_check_invariant_enforcement.py`）

- 好例：合法台账（1 条 guard 落点 + 1 条 prose）→ PASS，且 `scanned > 0`。
- 坏例：落点指向不存在的 guard → VIOLATION。
- 坏例：`type` 缺 `note` → VIOLATION。
- 坏例：`prose` 缺 `reason` → VIOLATION。
- 坏例：重复 id → VIOLATION。
- 坏例：`red_line=99` → VIOLATION。
- 坏例：guard 文件写 `red_lines=(99,)` → VIOLATION。
- 空转：`invariants=[]` → `load_ledger` 抛错 → `GuardResult.broken`（scanned/report 断言）。
