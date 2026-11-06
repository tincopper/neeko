"""身份空间的**比较/渲染层**不得借宿主路径语义（`std::path` / `std::fs`）。

## 第一性原理

身份串（`identity` 渲染）的分隔符**只有** `/`，而 `std::path` 的规则跟**宿主平台**走：
Windows 上 `\\` 也是分隔符、`C:` 与 `C:/` 是不同的分量形态。两者混用 ⇒ 同一批远端路径在
macOS 与 Windows 上得到**两种归属**，而 macOS 上永远绿（`\\` 只是普通字符）。

2026-11-05 实测（红线 11/12 的同族事故）：`UnitScope::owns` 用
`Path::new(path).starts_with(Path::new(root))` 判归属，Windows 上 `PathAlphabet::Posix` 的
远端路径 `/p\\x` 被当成 `/p/x`，被判进 `/p` 单元。macOS 绿、Windows 红 —— 因为**语义**不同，
不是字节不同，所以任何本地门禁都复现不了。

## 判据

`ledger/identity_host_path.json` 登记的模块（身份空间的比较/渲染层）里，禁止出现：

- `std::path`（`Path` / `PathBuf` / `Path::new`）—— 宿主分量语义；
- `std::fs` —— 触碰工作区会让「身份」变成「此刻磁盘上有什么」，破坏时刻无关性（I3）。

**谁该被登记**：只对**身份串**做比较/渲染的模块。`CheckoutPath::resolve` 这类
「把宿主路径铸成身份」的入口**不登记** —— 它正是宿主语义的合法归属地（seam 在这里收口）。

## 边界（如实声明）

本护栏不「发现」身份模块，它只**守住已登记的**那批：新写一个身份比较模块时，
把它加进台账才会被守。而不登记也能看见的失效（比如有人在 `commands/` 里手写
`format!("{}/{}", ...)`）不在口径内 —— 那属于「单一身份出口」的元规则，由 AI 审查兜。
"""
from __future__ import annotations

from guards.core.contract import Context, Finding, Guard, GuardResult
from guards.core.ledger import load_ledger

LEDGER = "identity_host_path"
REQUIRED_KEYS = ("note", "modules")

# 宿主路径语义的引用形态。注释里出现这些词是允许的（本模块自己的文档就在解释它们），
# 所以判定按**行内非注释前缀**做：`//` / `///` / `//!` 之后的内容先切掉。
FORBIDDEN = (
    "std::path",
    "Path::new",
    "PathBuf",
    "std::fs",
)

GUARD = Guard(
    id="check_identity_no_host_path",
    title="身份比较/渲染模块禁止引用宿主路径语义（std::path / std::fs）",
    scopes=(f"tools/guards/ledger/{LEDGER}.json", "src-tauri/src/**/*.rs"),
    red_lines=(11, 12),
    docs=".trellis/spec/backend/git-domain.md",
    ledger=LEDGER,
    fix_hint=(
        "身份串比较写成纯字符串（按 `/` 切分量）；需要把宿主路径铸成身份时走 "
        "CheckoutPath::resolve（唯一铸造点），它不登记在本台账里"
    ),
)


def strip_comment(line: str) -> str:
    """切掉注释部分 —— 规则与它的解释必须能共存（文档里要写「不要用 std::path」）。"""
    if line.lstrip().startswith("//"):
        return ""
    # 行内注释只认「前面有空白」的 `//`：`"http://…"` 这类字符串字面量不会被误切。
    for marker in (" //", "///", "//!"):
        idx = line.find(marker)
        if idx >= 0:
            return line[:idx]
    return line


def check(ctx: Context) -> GuardResult:
    ledger = load_ledger(LEDGER, required_keys=REQUIRED_KEYS)
    modules: dict = ledger["modules"]

    findings: list[Finding] = []
    references = 0

    for rel, entry in sorted(modules.items()):
        path = ctx.path(rel)
        if not path.is_file():
            findings.append(Finding("登记失效: 文件不存在，请从台账删除", rel))
            continue
        references += 1
        for idx, raw in enumerate(ctx.read_tolerant(rel).splitlines(), start=1):
            code = strip_comment(raw)
            for token in FORBIDDEN:
                if token in code:
                    findings.append(
                        Finding(
                            f"身份模块引用了宿主路径语义 {token!r}"
                            f"（{entry['note']} ⇒ 同一批路径在两端会得到两种归属）",
                            rel,
                            idx,
                        )
                    )

    metrics = f"{references} 个登记模块 / {len(findings)} 处宿主语义引用"
    if findings:
        return GuardResult.violated(references, findings, metrics=metrics)
    return GuardResult.passed(references, metrics=metrics)
