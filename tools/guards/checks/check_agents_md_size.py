"""AGENTS.md 体积预算 + 红线落点路由台账（数据：ledger/agents_md_routing.json）。

根 AGENTS.md 曾膨胀到 33,969 B（超过 CLI 的 32,768 B 提示线），2026-09-25 按代码物理边界
拆成 root + src + src-tauri 三层。本护栏钉住两件后会悄悄退化的事：

1. **体积**：`size_caps` 只拦「单文件膨胀」；真实预算是 `pair_cap` —— Codex 只拼接 cwd 的
   **祖先路径**，最大组合是 root + 单个嵌套（三份永不同时加载），受 `project_doc_max_bytes`
   （默认 32 KiB）约束。只盯单文件会让 root + 嵌套静默越线；反过来按三文件求和设限会凭空
   压低预算、挡住合法新增（2026-09-25 修正过一次，见 tests 里的常量自洽用例）。
2. **路由**：每条红线全文**恰好**出现在一个文件里。索引表就是机读台账 —— 声明的落点与红线
   正文必须同时存在且一致，否则落点缺失 = 规则静默失效，两处重复 = 同一知识两种表示必然漂移。

**范围**（本护栏只到这里）：校验对象是台账里的 N 条红线与三份文件的体积。**非红线章节**的
「同一知识只允许一处」不在脚本内 —— 目录/清单类副本无稳定语法指纹，静态扫描信噪比不可接受
（与红线 13 同一处理方式），靠根文件「子目录清单一律以 `ls` / Glob 为准」这条元规则 + AI 审查维持。

索引表格式 —— **表头即契约，列名必须完全一致**，落点取每行**末列**：

    | # | 红线 | 必须 / 禁止（摘要） | 全文位置 |
    | 1 | 统一命令执行接口（Local/WSL/SSH） | 命令只走 `core::exec` … | `src-tauri/AGENTS.md` |

摘要里禁止出现未转义的 `|`（会改变列数）。
"""
from __future__ import annotations

import pathlib
import re
from dataclasses import dataclass

from guards.core.contract import Context, Finding, Guard, GuardResult
from guards.core.ledger import load_ledger

ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|(.+)\|\s*$")
INDEX_ROW_RE = re.compile(r"^\s*\|")
HEADING_RE = re.compile(r"^#{1,4} ")
GATE_HEADING = "审查红线"

GUARD = Guard(
    id="check_agents_md_size",
    title="AGENTS.md 体积预算与红线落点路由台账",
    scopes=("AGENTS.md", "src/AGENTS.md", "src-tauri/AGENTS.md", "tools/guards/ledger/agents_md_routing.json"),
    docs="CONTRIBUTING.md",
    ledger="agents_md_routing",
    fix_hint=(
        "新增规则先定作用域：单侧专属 → 对应嵌套 AGENTS.md；跨栈 → 留根并登记进红线表。"
        "台账明细见 `python3 tools/guards/run.py list check_agents_md_size`"
    ),
)


@dataclass(frozen=True)
class Ledger:
    root_file: str
    nested: tuple
    size_caps: dict
    pair_cap: int
    summary_max_bytes: int
    ledger_columns: tuple
    title_column: str
    summary_column: str
    signatures: dict

    @property
    def scanned(self) -> tuple:
        return (self.root_file, *self.nested)

    @classmethod
    def from_dict(cls, data: dict) -> "Ledger":
        return cls(
            root_file=data["root_file"],
            nested=tuple(data["nested"]),
            size_caps=dict(data["size_caps"]),
            pair_cap=int(data["pair_cap"]),
            summary_max_bytes=int(data["summary_max_bytes"]),
            ledger_columns=tuple(data["ledger_columns"]),
            title_column=data["title_column"],
            summary_column=data["summary_column"],
            signatures={int(k): v for k, v in data["signatures"].items()},
        )


def read_ledger() -> Ledger:
    return Ledger.from_dict(
        load_ledger(
            "agents_md_routing",
            required_keys=(
                "root_file",
                "nested",
                "size_caps",
                "pair_cap",
                "summary_max_bytes",
                "ledger_columns",
                "title_column",
                "summary_column",
                "signatures",
            ),
        )
    )


def read_file(repo: pathlib.Path, rel: str) -> str:
    return (repo / rel).read_text(encoding="utf-8")


def sections(text: str) -> list:
    """按标题切分，返回 [(标题, 字节数)]，用于失败时定位是哪块长胖了。"""
    out, cur, size = [], "(preamble)", 0
    for line in text.split("\n"):
        if HEADING_RE.match(line):
            out.append((cur, size))
            cur, size = line.strip()[:60], 0
        else:
            size += len(line.encode("utf-8")) + 1
    out.append((cur, size))
    return [(t, s) for t, s in out if s > 0]


def ledger_rows(repo: pathlib.Path, ledger: Ledger) -> tuple:
    """解析根文件「审查红线」章节 → (表头单元格, {编号: 单元格列表})。

    表格解析的**唯一入口** —— parse_index / report_ledger / notes 共用，避免多份解析各自漂移。
    """
    header, rows, gate = [], {}, False
    for line in read_file(repo, ledger.root_file).split("\n"):
        if HEADING_RE.match(line):
            gate = GATE_HEADING in line
            continue
        if not gate or not INDEX_ROW_RE.match(line):
            continue
        match = ROW_RE.match(line)
        if match:
            num = int(match.group(1))
            if num in ledger.signatures:
                rows[num] = [c.strip() for c in match.group(2).split("|")]
        elif not header:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells and cells[0] == "#":
                header = cells
    return header, rows


def parse_index(repo: pathlib.Path, ledger: Ledger) -> dict:
    """从红线表解析 {编号: 声明的落点文件}（落点 = 每行末列）。"""
    declared = {}
    for num, cells in ledger_rows(repo, ledger)[1].items():
        loc = cells[-1]
        if "本文件" in loc:
            declared[num] = ledger.root_file
            continue
        tick = re.search(r"`([^`]+)`", loc)
        declared[num] = tick.group(1) if tick else loc
    return declared


def report_ledger(repo: pathlib.Path, ledger: Ledger) -> list:
    """表结构校验：列齐全 + 台账标题含签名 + 摘要列逐条非空且不超长。

    标题必须**包含**签名（正文标题通常带更长限定），否则同一条规则就有两个名字，
    grep 任一名字都找不全。摘要只校验存在性与长度，不比对文案 —— 否则摘要会退化成
    需要第三份同步维护的正文。
    """
    problems: list[str] = []
    header, rows = ledger_rows(repo, ledger)
    if not header:
        return [f"根 {ledger.root_file} 红线表缺少表头行；需含列：" + " / ".join(ledger.ledger_columns)]
    for column in ledger.ledger_columns:
        if column not in header:
            problems.append(f"红线表缺少列「{column}」（现有列：{' / '.join(header)}）")
    if problems:
        return problems

    title_idx = header.index(ledger.title_column)
    sum_idx = header.index(ledger.summary_column)
    for num in sorted(ledger.signatures):
        cells = rows.get(num)
        if cells is None:
            continue  # 缺行由 report_routing 报「缺少编号」
        full = [str(num), *cells]
        if len(full) != len(header):
            problems.append(
                f"红线 {num} 列数 {len(full)} 与表头 {len(header)} 不一致"
                "（摘要里禁止出现未转义的 |）"
            )
            continue
        title = full[title_idx]
        if ledger.signatures[num] not in title:
            problems.append(
                f"红线 {num} 台账标题「{title}」不含签名「{ledger.signatures[num]}」"
                "（台账标题与正文标题已漂移 —— 同一条规则会因此有两个名字）"
            )
        summary = full[sum_idx]
        size = len(summary.encode("utf-8"))
        if not summary:
            problems.append(
                f"红线 {num} 摘要列为空 —— 嵌套 AGENTS.md 未加载时该条规则不可执行"
            )
        elif size > ledger.summary_max_bytes:
            problems.append(
                f"红线 {num} 摘要 {size} B 超过上限 {ledger.summary_max_bytes} B"
                "（摘要只做兜底，正文以落点文件为准）"
            )
    return problems


def actual_homes(repo: pathlib.Path, ledger: Ledger) -> tuple:
    """扫描三份文件 → ({编号: [实际含正文的文件]}, [正文形态异常])。

    同一红线在落点文件里出现多行是正常的（标题 + 正文引用），因此只校验「首次出现是否
    位于标题/列表项/引用块」，不限制出现次数。表格行永不算正文 —— 那只是索引。
    """
    cache = {rel: read_file(repo, rel).split("\n") for rel in ledger.scanned if (repo / rel).exists()}
    homes, strays = {}, []
    for num, sig in ledger.signatures.items():
        for rel in ledger.scanned:
            lines = cache.get(rel, [])
            body = [ln for ln in lines if sig in ln and not INDEX_ROW_RE.match(ln)]
            if not body:
                continue
            homes.setdefault(num, []).append(rel)
            if not body[0].lstrip().startswith(("#", "*", ">")):
                strays.append((num, rel, body[0].strip()[:70]))
    return homes, strays


def pair_sizes(repo: pathlib.Path, ledger: Ledger) -> list:
    """[(嵌套文件, root + 嵌套字节数)] —— Codex 按 cwd 祖先路径实际会合并加载的组合。"""
    root = repo / ledger.root_file
    if not root.exists():
        return []
    return [
        (nested, root.stat().st_size + (repo / nested).stat().st_size)
        for nested in ledger.nested
        if (repo / nested).exists()
    ]


def report_sizes(repo: pathlib.Path, ledger: Ledger) -> list:
    problems: list[str] = []
    for rel in ledger.scanned:
        path = repo / rel
        if not path.exists():
            problems.append(f"缺少文件 {rel}")
            continue
        size = path.stat().st_size
        cap = ledger.size_caps[rel]
        if size > cap:
            problems.append(f"{rel} 体积 {size:,} B 超过上限 {cap:,} B")
            for title, section_size in sorted(sections(read_file(repo, rel)), key=lambda x: -x[1])[:6]:
                problems.append(f"    {section_size:>6,} B  {title}")
    for nested, pair in pair_sizes(repo, ledger):
        if pair > ledger.pair_cap:
            problems.append(
                f"{ledger.root_file} + {nested} 合计 {pair:,} B 超过上限 {ledger.pair_cap:,} B"
                "（Codex project_doc_max_bytes 默认 32 KiB，按 cwd 祖先路径拼接计）"
            )
            for rel in (ledger.root_file, nested):
                problems.append(f"    {(repo / rel).stat().st_size:>7,} B  {rel}")
    return problems


def report_routing(repo: pathlib.Path, ledger: Ledger) -> list:
    problems: list[str] = []
    declared = parse_index(repo, ledger)

    missing = sorted(set(ledger.signatures) - set(declared))
    if missing:
        problems.append(
            f"根 {ledger.root_file} 红线表缺少编号：" + ", ".join(str(n) for n in missing)
            + f"（表是机读台账，{len(ledger.signatures)} 条必须逐条在列）"
        )
    unknown = sorted(set(declared) - set(ledger.signatures))
    if unknown:
        problems.append("红线表出现未知编号：" + ", ".join(str(n) for n in unknown))

    homes, strays = actual_homes(repo, ledger)
    for num, sig in ledger.signatures.items():
        where = homes.get(num, [])
        want = declared.get(num)
        if want and not (repo / want).exists():
            problems.append(f"红线 {num} 声明的落点文件不存在：{want}")
        if not where:
            problems.append(
                f"红线 {num} 全文缺失（签名「{sig}」在任何 AGENTS.md 正文中都未出现），"
                f"声明落点={want or '未声明'}"
            )
            continue
        if len(where) > 1:
            problems.append(
                f"红线 {num} 正文出现在多个文件：{', '.join(where)} —— 同一知识只允许一处正文"
                "（若本意是交叉引用，只写 `红线 N`，不要复述标题）"
            )
        if want and where[0] != want:
            problems.append(f"红线 {num} 落点漂移：表声明 {want}，正文实际在 {where[0]}")

    for num, rel, snippet in strays:
        problems.append(
            f"红线 {num} 在 {rel} 的正文形态异常（应位于 # / ** / > 起始行）：{snippet}"
            "；交叉引用请只写 `红线 N`"
        )
    return problems


def check(ctx: Context) -> GuardResult:
    ledger = read_ledger()
    repo = ctx.repo_root
    present = [rel for rel in ledger.scanned if (repo / rel).is_file()]
    if not present:
        return GuardResult.broken(
            f"AGENTS.md 一份都没找到（期望 {' / '.join(ledger.scanned)}）—— 校验对象消失",
        )

    problems = report_sizes(repo, ledger) + report_ledger(repo, ledger) + report_routing(repo, ledger)
    metrics = (
        f"{len(present)} 份 AGENTS.md / {len(ledger.signatures)} 条红线 / "
        + " ".join(f"{(repo / rel).stat().st_size:,}B" for rel in present)
    )
    notes = _notes(repo, ledger, present)

    if problems:
        findings = [Finding(p) for p in problems]
        return GuardResult.violated(len(present), findings, metrics=metrics, notes=notes)
    return GuardResult.passed(len(present), metrics=metrics, notes=notes)


def _notes(repo: pathlib.Path, ledger: Ledger, present: list) -> tuple:
    declared = parse_index(repo, ledger)
    homes, _ = actual_homes(repo, ledger)
    lines = [
        "红线台账（编号  签名  →  声明落点  [正文实际落点]）",
    ]
    for num in sorted(ledger.signatures):
        want = declared.get(num, "未声明!")
        actual = ", ".join(homes.get(num, [])) or "无正文!"
        mark = "" if want == actual else f"   ← 漂移（声明 {want}）"
        lines.append(f"  {num:>2}  {ledger.signatures[num]:<24} → {want}{mark}")
    lines.append("")
    for rel in present:
        lines.append(
            f"  {(repo / rel).stat().st_size:>7,} B / {ledger.size_caps[rel]:>7,} B  {rel}"
        )
    for nested, pair in pair_sizes(repo, ledger):
        lines.append(
            f"  {pair:>7,} B / {ledger.pair_cap:>7,} B  {ledger.root_file} + {nested}（Codex 合并预算）"
        )
    return tuple(lines)
