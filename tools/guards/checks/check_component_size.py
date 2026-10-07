"""组件 / hook 文件规模红线（≤300 行）的 **ratchet** 门禁。

背景：`.trellis/spec/frontend/component-guidelines.md` 早已把「组件文件严禁超过 300 行」
写成硬指标，但此前只由 AI 复审（neeko-check P10）把关 —— 没有确定性门禁的约定必然漂移，
实测当前 `components/` 42 个、`hooks/` 17 个文件已越线，`ConnectionProjectCard` 也曾冲到 315。
一次性全量硬门禁会立刻红，所以采用 **ratchet**：

- 未登记在基线的文件：`> max_lines` 即违规（新债止步）；
- 已登记在基线的文件：只允许**缩小**（`> 基线值` 即违规）；
- 基线台账缺失/不可解析 → 护栏失效（退出码 2），不是代码违规。

基线由脚本一次性生成（**禁手抄**，见 `ledger/component_size.json` 的 note）：

```bash
python3 - <<'EOF'
import json, pathlib
root = pathlib.Path(".")
pats = ["src/**/components/**/*.tsx", "src/**/components/**/*.ts",
        "src/**/hooks/**/*.ts", "src/**/hooks/**/*.tsx"]
files = {f for p in pats for f in root.glob(p) if f.is_file()}
bad = {f.as_posix(): len(f.read_text(encoding="utf-8").splitlines())
       for f in files
       if "__tests__" not in f.as_posix()
       and not f.as_posix().endswith((".test.ts", ".test.tsx"))
       and not f.as_posix().startswith("src/testing/")
       and len(f.read_text(encoding="utf-8").splitlines()) > 300}
json.dump({"max_lines": 300, "note": "…", "baseline": dict(sorted(bad.items()))},
          open("tools/guards/ledger/component_size.json", "w"), ensure_ascii=False, indent=2)
EOF
```

存量还债（把基线条目逐个拆到 ≤300）是独立任务，不由本护栏完成。
"""
from __future__ import annotations

from guards.core.contract import Context, Finding, Guard, GuardResult
from guards.core.ledger import LedgerError, load_ledger

SCOPES = (
    "src/**/components/**/*.ts",
    "src/**/components/**/*.tsx",
    "src/**/hooks/**/*.ts",
    "src/**/hooks/**/*.tsx",
)

GUARD = Guard(
    id="check_component_size",
    title="组件 / hook 文件规模 ≤300 行（ratchet：新债止步、旧债只许缩小）",
    scopes=SCOPES,
    red_lines=(),
    docs=".trellis/spec/frontend/component-guidelines.md",
    ledger="component_size",
    fix_hint=(
        "超线时按职责抽取子组件 / 子 hook 到同目录独立文件（抽取只迁移 JSX 与依赖，行为零漂移）；"
        "已登记基线的文件只允许缩小，不得回涨。"
    ),
)


def _is_excluded(rel: str) -> bool:
    return (
        "__tests__" in rel
        or rel.startswith("src/testing/")
        or rel.endswith(".test.ts")
        or rel.endswith(".test.tsx")
    )


def _line_count(path) -> int | None:
    """行数；读取失败（非 UTF-8 / IO）返回 None 由调用方跳过 —— 不让单个噪声文件把整条护栏
    打成 ERROR（与其余护栏的 `_read` 容错一致）。"""
    try:
        return len(path.read_text(encoding="utf-8").splitlines())
    except (OSError, UnicodeDecodeError):
        return None


def evaluate(records: list[tuple[str, int]], baseline: dict, max_lines: int) -> list[Finding]:
    """纯判据（便于单测直接喂记录）。`records` = [(rel, lines)]。"""
    findings: list[Finding] = []
    for rel, lines in records:
        limit = baseline.get(rel, max_lines)
        if lines <= limit:
            continue
        if rel in baseline:
            findings.append(
                Finding(
                    f"{rel}: {lines} 行 > 基线 {limit} 行 —— ratchet 只许缩小（不得回涨）；"
                    "拆分后请下调基线值",
                    rel,
                    0,
                )
            )
        else:
            findings.append(
                Finding(
                    f"{rel}: {lines} 行 > {max_lines} 行红线 —— 新增/未登记文件不得越线；"
                    "按职责抽取子组件/子 hook",
                    rel,
                    0,
                )
            )
    return findings


def check(ctx: Context) -> GuardResult:
    try:
        ledger = load_ledger("component_size", required_keys=("max_lines", "baseline"))
    except LedgerError as exc:
        return GuardResult.broken(str(exc))

    max_lines = int(ledger["max_lines"])
    baseline = dict(ledger["baseline"])

    records: list[tuple[str, int]] = []
    for pattern in SCOPES:
        for path in ctx.glob(pattern):
            rel = ctx.rel(path)
            if _is_excluded(rel):
                continue
            lines = _line_count(path)
            if lines is None:
                continue
            records.append((rel, lines))

    findings = evaluate(records, baseline, max_lines)
    present = {rel for rel, _ in records}
    stale = sorted(set(baseline) - present)
    metrics = (
        f"{len(records)} 个组件/hook / 基线 {len(baseline)} 个（残留 {len(stale)}）"
        f" / {len(findings)} 处越线"
    )
    notes = tuple(f"基线残留（文件已删，可清理）：{s}" for s in stale)
    if findings:
        return GuardResult.violated(len(records), findings, metrics=metrics, notes=notes)
    return GuardResult.passed(len(records), metrics=metrics, notes=notes)
