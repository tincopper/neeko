"""路径「形态重写」出现点必须全部登记并分类（台账：ledger/path_identity_scope.json）。

## 第一性原理（为什么需要它）

「这是不是同一个文件」只允许有一个判据 —— `src/shared/utils/fileRef.ts` 里的 `FileRef`
身份。一旦某个消费方自己写字符串归一（`\\`→`/`、去尾斜杠）或别名匹配，同一份文件就有了
第二种表示：黄线在、光标不在；断点 key 两套；变更事件漏配导致视图不刷新。issue #13 修了
写入侧与比较侧，本护栏负责让它不再回退。

## 背景教训

切片 3 的 R1 义务是产出一张「路径归一结论表」，第一版把口径写成**叙述**（「grep 共 28 处」）
而**从未执行**：实测 36 处 / 24 文件，表格漏掉 3 个文件 —— 其中两个是同一 bug 的孪生副本，
因漏分类而没被修。**口径写成叙述 = 没执行**；本护栏把口径变成可执行断言。

## 边界（如实声明，不过度声称）

- `split('/').filter(…).join('/')` 形态**不在**口径内 —— 它与身份所有者同住，由「单一归属」
  保证，不构成消费侧自造归一；
- 别名匹配（`endsWith('/' + p)` 等）**不在**口径内 —— 该形态噪声过大；这类代码通常**同时**
  含上面的形态重写，因此会以「未登记命中」的形式被拦下。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult
from guards.core.ledger import load_ledger

SCAN_SCOPES = ("src/**/*.ts", "src/**/*.tsx")

# 判据口径留在代码里（写进台账会让它既不可测又不可 grep）
PATTERNS: dict = {
    "backslash": re.compile(r"replace\(/\\\\/g|replaceAll\('\\\\'"),
    "collapse": re.compile(r"replace\(/\\/\+/g"),
    "strip": re.compile(r"replace\(/\\/\+\\?\$/"),
}

GUARD = Guard(
    id="check_path_identity_scope",
    title="路径形态重写出现点必须登记在台账（同文件判定只允许走 FileRef）",
    scopes=SCAN_SCOPES + ("tools/guards/ledger/path_identity_scope.json",),
    red_lines=(12,),
    docs=".trellis/spec/frontend/state-management.md",
    ledger="path_identity_scope",
    fix_hint=(
        "优先删除该归一并改走身份所有者（sameIdentity / pathsContainFile / canonicalFsPath）；"
        "确属展示/URL/树结构/命令入参派生的，在 ledger/path_identity_scope.json 登记"
        "分类（owner / legit / debt）与计数"
    ),
)


def scan(ctx: Context) -> tuple[int, dict]:
    """生产代码里每个文件的形态重写计数 → (扫描文件数, {相对路径: {口径: 次数}})。

    每个文件只读一次、只算一遍：原先按口径循环各读一次（955 文件 × 3）既慢，
    也让「扫描数」与实际读盘数脱钩。
    """
    files = [p for p in ctx.glob(SCAN_SCOPES[0]) + ctx.glob(SCAN_SCOPES[1]) if "__tests__" not in p.parts]
    hits: dict[str, dict[str, int]] = {}
    for path in files:
        text = ctx.read(ctx.rel(path))
        per = {name: len(rx.findall(text)) for name, rx in PATTERNS.items()}
        per = {name: n for name, n in per.items() if n}
        if per:
            hits[ctx.rel(path)] = per
    return len(files), hits


def _fmt(counts: dict) -> str:
    return "、".join(f"{k}×{v}" for k, v in sorted(counts.items())) or "无"


def check(ctx: Context) -> GuardResult:
    ledger = load_ledger("path_identity_scope", required_keys=("owner", "valid_kinds", "manifest"))
    owner, manifest = ledger["owner"], ledger["manifest"]
    valid_kinds = set(ledger["valid_kinds"])

    scanned, hits = scan(ctx)
    if scanned == 0:
        return GuardResult.broken(
            f"在 {' / '.join(SCAN_SCOPES)} 下扫到 0 个文件 —— 口径失效", scanned=0
        )

    findings: list[Finding] = []

    for path in sorted(set(hits) - set(manifest)):
        detail = ", ".join(f"{k}×{v}" for k, v in sorted(hits[path].items()))
        findings.append(Finding(f"未登记命中: {path}（{detail}）", path))
    for path in sorted(set(manifest) - set(hits)):
        findings.append(Finding("登记失效: 已无命中，请从台账删除", path))
    for path in sorted(set(manifest) & set(hits)):
        expected = manifest[path]["counts"]
        if expected != hits[path]:
            findings.append(
                Finding(
                    f"计数漂移: {path}（登记 {_fmt(expected)}，实测 {_fmt(hits[path])}）", path
                )
            )

    for path, entry in sorted(manifest.items()):
        if entry["kind"] not in valid_kinds:
            findings.append(
                Finding(
                    f"分类非法: {path} = {entry['kind']!r}"
                    f"（只允许 {' / '.join(sorted(valid_kinds))}）",
                    "tools/guards/ledger/path_identity_scope.json",
                )
            )
    owners = [p for p, e in manifest.items() if e["kind"] == "owner"]
    if owners != [owner]:
        findings.append(
            Finding(
                f"owner 必须恰为 {owner}，实测 {owners}",
                "tools/guards/ledger/path_identity_scope.json",
            )
        )

    total = sum(sum(v.values()) for v in hits.values())
    counts = {k: sum(1 for e in manifest.values() if e["kind"] == k) for k in sorted(valid_kinds)}
    metrics = (
        f"扫描 {scanned} / 命中 {len(hits)} 文件 {total} 处 / "
        + " ".join(f"{k} {v}" for k, v in counts.items())
    )
    notes = _ledger_notes(scanned, hits, manifest, counts, total)

    if findings:
        return GuardResult.violated(scanned, findings, metrics=metrics, notes=notes)
    return GuardResult.passed(scanned, metrics=metrics, notes=notes)


def _ledger_notes(scanned, hits, manifest, counts, total) -> tuple:
    lines = [
        f"路径形态重写台账（{scanned} 文件扫描，命中 {len(hits)} 文件 / {total} 处）",
    ]
    for path in sorted(hits):
        kind = manifest.get(path, {}).get("kind", "未登记")
        lines.append(f"  [{kind:<6}] {path}  {hits[path]}")
    for path, entry in sorted(manifest.items()):
        if entry["kind"] == "debt":
            lines.append(f"  [debt] {path}: {entry['note']}")
    lines.append(
        "  分类合计：" + " / ".join(f"{k} {v}" for k, v in sorted(counts.items()))
    )
    lines.append(f"  台账：ledger/{GUARD.ledger}.json")
    return tuple(lines)
