"""不变量强制层级门禁 —— 钉住「约定不能只停在文字层」。

第一性原理：约束的价值 = 违反成本 × 违反概率，而约束必须与它的**强制层级**同层存放。
凡是被称为「硬指标 / 红线 / 不变量」的东西，若只写进注释 / spec / AI 复审，违反概率随时间
趋近 1（本仓实测：服务层依赖交付适配器、status 绕过 selector、组件越 300 行，三条都是
「约束存错层」的实例）。

本护栏把这条元规则变成可执行判据：

1. **落点必须可解析**：`ledger/invariants.json` 每条不变量的 `enforcement` 里，`guard` 指向
   真实存在的 `checks/{ref}.py`、`test` 指向真实文件、`lint` 规则出现在 `.eslintrc.cjs`；
   `type` / `structure` 必须给出机制所在路径 + `note`。
2. **`prose` 是合法档但必须带理由**，且每次运行都打印 —— 目标不是「全部机械化」，而是
   「没有无人知晓的未机械化」：沉默债务才是危险的。
3. **引用完整性**：每条不变量与每个 guard 的 `red_lines` 编号都必须真实存在于
   `agents_md_routing.json` 的红线台账里（防「守卫声明了一条不存在的红线」）。

落点只存**指针**，不复制规则正文 —— 正文仍单一事实源在各自 spec / AGENTS.md，避免二次表示漂移。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult
from guards.core.ledger import LedgerError, load_ledger

REQUIRED_TIERS = frozenset({"type", "structure", "guard", "lint", "test", "prose"})

# guard 源码里 `red_lines=(1, 3)` 的形态（单行；本仓 GUARD 定义皆为单行）。
RED_LINES_RE = re.compile(r"red_lines\s*=\s*\(([^)]*)\)")

ESLINT_CONFIG = ".eslintrc.cjs"
CHECKS_GLOB = "tools/guards/checks/*.py"


class InputError(RuntimeError):
    """台账/配置无法解析 —— 门禁自身失效（退出码 2），不是被检查代码违规。"""


GUARD = Guard(
    id="check_invariant_enforcement",
    title="每条不变量必须有可解析的强制落点（台账 ↔ 机制一一对应）",
    scopes=(
        "tools/guards/ledger/invariants.json",
        "tools/guards/checks/**/*.py",
        ESLINT_CONFIG,
    ),
    red_lines=(),
    docs=".trellis/spec/guides/invariant-enforcement.md",
    ledger="invariants",
    fix_hint=(
        "把不变量登记进 tools/guards/ledger/invariants.json，并给可解析落点"
        "（guard=checks/{ref}.py / test=路径 / lint=.eslintrc.cjs 规则 / type|structure=路径+note）；"
        "确实无法机械化的写 tier=\"prose\" + reason（会成为可见债务）。"
    ),
)


def _red_line_numbers(iid: str, value: object) -> tuple[list[int] | None, list[Finding]]:
    """把 `red_line` 归一成编号列表；类型非法时返回 Finding。"""
    if value is None:
        return [], []
    if isinstance(value, bool):
        return None, [Finding(f"{iid}: red_line 不接受布尔值")]
    if isinstance(value, int):
        return [value], []
    if isinstance(value, list):
        numbers: list[int] = []
        for item in value:
            if isinstance(item, bool) or not isinstance(item, int):
                return None, [Finding(f"{iid}: red_line 数组元素必须是整数：{item!r}")]
            numbers.append(item)
        return numbers, []
    return None, [Finding(f"{iid}: red_line 必须是 int / int[] / null：{value!r}")]


def _eslint_config(ctx: Context) -> str:
    path = ctx.path(ESLINT_CONFIG)
    if not path.is_file():
        raise InputError(f"lint 落点需要 {ESLINT_CONFIG}，但它不存在")
    return path.read_text(encoding="utf-8")


def _check_enforcement(iid: str, entry: object, ctx: Context) -> list[Finding]:
    if not isinstance(entry, dict):
        return [Finding(f"{iid}: enforcement 条目必须是对象")]
    kind = entry.get("kind")
    ref = entry.get("ref")
    if kind not in REQUIRED_TIERS:
        return [Finding(f"{iid}: enforcement.kind={kind!r} 不是六档之一")]
    if kind == "guard":
        if not ref or not ctx.path(f"tools/guards/checks/{ref}.py").is_file():
            return [
                Finding(
                    f"{iid}: guard 落点不存在 tools/guards/checks/{ref}.py —— ⭐ 指针必须可解析"
                )
            ]
        return []
    if kind == "test":
        if not ref or not ctx.path(str(ref)).is_file():
            return [Finding(f"{iid}: test 落点不存在：{ref}")]
        return []
    if kind == "lint":
        rule = str(ref or "")
        if not rule:
            return [Finding(f"{iid}: lint 落点缺 ref（规则名）")]
        if rule not in _eslint_config(ctx):
            return [Finding(f"{iid}: lint 规则不存在于 {ESLINT_CONFIG}：{rule}")]
        return []
    if kind in ("type", "structure"):
        findings: list[Finding] = []
        if not entry.get("note"):
            findings.append(
                Finding(f"{iid}: {kind} 落点必须带 note 说明机制（只给路径不算强制）")
            )
        if not ref or not ctx.path(str(ref)).is_file():
            findings.append(Finding(f"{iid}: {kind} 落点路径不存在：{ref}"))
        return findings
    # prose
    if not entry.get("reason"):
        return [Finding(f"{iid}: prose 必须带 reason（无法机械化的理由与兜底）")]
    return []


def validate_invariants(ledger: dict, ctx: Context, signatures: set[str]) -> list[Finding]:
    """台账条目校验（纯函数，便于单测直接喂坏例）。"""
    findings: list[Finding] = []
    invariants = ledger.get("invariants")
    if not isinstance(invariants, list) or not invariants:
        findings.append(Finding("invariants 必须是非空数组"))
        return findings

    seen: set[str] = set()
    for inv in invariants:
        if not isinstance(inv, dict):
            findings.append(Finding("不变量条目必须是对象"))
            continue
        iid = inv.get("id")
        if not iid or not isinstance(iid, str):
            findings.append(Finding("不变量缺 id"))
            continue
        if iid in seen:
            findings.append(Finding(f"不变量 id 重复：{iid}（id 是台账主键，必须唯一）"))
        seen.add(iid)

        if not inv.get("title") or not isinstance(inv.get("title"), str):
            findings.append(Finding(f"{iid}: 缺 title"))
        tier = inv.get("tier")
        if tier not in REQUIRED_TIERS:
            findings.append(Finding(f"{iid}: tier={tier!r} 不是六档之一"))

        numbers, red_findings = _red_line_numbers(iid, inv.get("red_line"))
        findings.extend(red_findings)
        for num in numbers or []:
            if str(num) not in signatures:
                findings.append(
                    Finding(f"{iid}: 引用了不存在的红线 {num}（红线台账里没有这条）")
                )

        enforcement = inv.get("enforcement")
        if not isinstance(enforcement, list) or not enforcement:
            findings.append(Finding(f"{iid}: enforcement 不能为空（不变量必须有落点）"))
            continue
        for entry in enforcement:
            findings.extend(_check_enforcement(iid, entry, ctx))
    return findings


def validate_guard_red_line_refs(
    paths: list, ctx: Context, signatures: set[str]
) -> list[Finding]:
    """每个 guard 的 `red_lines=(...)` 必须引用真实存在的红线。"""
    findings: list[Finding] = []
    for path in paths:
        rel = ctx.rel(path)
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            for group in RED_LINES_RE.findall(line):
                for num in re.findall(r"\d+", group):
                    if num not in signatures:
                        findings.append(
                            Finding(
                                f"guard 声明了不存在的红线 {num}（红线台账里没有这条）",
                                rel,
                                number,
                            )
                        )
    return findings


def check(ctx: Context) -> GuardResult:
    try:
        ledger = load_ledger("invariants", required_keys=("tiers", "invariants"))
        routing = load_ledger("agents_md_routing")
    except LedgerError as exc:
        return GuardResult.broken(str(exc))

    declared_tiers = set(ledger.get("tiers", {}))
    if declared_tiers != REQUIRED_TIERS:
        return GuardResult.broken(
            "invariants.json 的 tiers 必须是六档："
            f"期望 {sorted(REQUIRED_TIERS)}，实际 {sorted(declared_tiers)}"
        )

    signatures = {str(k) for k in routing.get("signatures", {})}
    guard_paths = ctx.glob(CHECKS_GLOB)
    try:
        findings = validate_invariants(ledger, ctx, signatures)
        findings += validate_guard_red_line_refs(guard_paths, ctx, signatures)
    except InputError as exc:
        return GuardResult.broken(str(exc))

    invariants = ledger["invariants"]
    scanned = len(invariants) + len(guard_paths)
    prose = [i.get("id") for i in invariants if isinstance(i, dict) and i.get("tier") == "prose"]
    notes = tuple(f"prose（可见债务，需人工复审）：{pid}" for pid in prose)
    metrics = (
        f"{len(invariants)} 条不变量 / {len(guard_paths)} 个 guard 文件"
        f"（prose {len(prose)} 条），{len(findings)} 处违规"
    )
    if findings:
        return GuardResult.violated(scanned, findings, metrics=metrics, notes=notes)
    return GuardResult.passed(scanned, metrics=metrics, notes=notes)
