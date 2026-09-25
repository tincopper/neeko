#!/usr/bin/env python3
"""AGENTS.md 体积与红线路由台账护栏。

背景：根 AGENTS.md 曾膨胀到 33,969 B（超过 CLI 的 32,768 B 提示线），其中约 34% 是
15 条「AI 代码审查红线」的散文。2026-09-25 按代码物理边界拆分：

    AGENTS.md            跨栈内容 + 红线索引表（启动即加载，每个会话都付费）
    src/AGENTS.md        前端专属（读到 src/** 后懒加载）
    src-tauri/AGENTS.md  后端专属（读到 src-tauri/** 后懒加载）

本脚本钉住两件事后会悄悄退化的事：

1. **体积**：根文件不再长回散文堆。`SIZE_CAPS` 只拦「单文件膨胀」；真实预算是 `PAIR_CAP` ——
   Codex 只拼接 cwd 的**祖先路径**，最大组合是 root + 单个嵌套（三份永不同时加载），受
   `project_doc_max_bytes`（默认 32 KiB）约束。只盯单文件会让 root + 嵌套静默越线；
   反过来按三文件求和设限则会凭空压低预算、挡住合法新增（2026-09-25 修正）。
2. **路由**：每条红线全文**恰好**出现在一个文件里（"一个位置"仅指下面三个 AGENTS.md ——
   `.trellis/spec/` 是机制详解层，允许承载同主题的背景与事故复盘）。索引表就是机读台账 ——
   声明的落点与红线正文必须同时存在且一致，否则：
   - 落点缺失 → 规则静默失效（比超长更糟）；
   - 两处重复 → 同一知识两种表示，必然漂移（正是红线 15 反对的事）。
3. **兜底**：表格里的「摘要」列是嵌套文件**未加载**时的最小可执行摘要（Codex 从仓库根启动即
   此情形）。它只校验「非空 + 不超长」，不参与落点判定 —— 表格行永不算正文，故摘要不会变成
   第二份正文；判据与例外一律以落点文件为准。
4. **范围**（本脚本只到这里）：校验对象是 15 条红线与三份文件的体积。**非红线章节**的「同一知识
   只允许一处」不在脚本内 —— 目录/清单类副本无稳定语法指纹，静态扫描信噪比不可接受（与红线 13
   同一处理方式），靠根文件「子目录清单一律以 `ls` / Glob 为准」这条元规则 + AI 审查维持。
   2026-09-25 按此清掉一批已漂移的副本：src-tauri 领域目录表（`skill/` 幽灵、`about/`/`library/`/
   `search/` 缺失）、`src/shared` 子目录表、跨栈规则枚举（两处嵌套头部）、TDD 硬约束句与覆盖率
   阶梯的 root↔src 双份、root 里的单侧 playbook 与目录副本。

索引表格式（根 AGENTS.md「AI 代码审查红线」章节）—— **表头即契约，列名必须完全一致**，
落点取每行**末列**（允许在摘要后追加列）：

    | # | 红线 | 必须 / 禁止（摘要） | 全文位置 |
    | 1 | 统一命令执行接口（Local/WSL/SSH） | 命令只走 `core::exec` / `common::executor` … | `src-tauri/AGENTS.md` |
    | 4 | **IPC 大文本边界** | 单次 Command 返回 JSON ≤ 2MB … | 本文件 ↓ |

摘要里禁止出现未转义的 `|`（会改变列数）。

用法：
    python3 .trellis/scripts/check_agents_md_size.py          # 校验
    python3 .trellis/scripts/check_agents_md_size.py --list   # 打印当前台账
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent

ROOT_FILE = "AGENTS.md"
NESTED = ["src/AGENTS.md", "src-tauri/AGENTS.md"]
SCANNED = [ROOT_FILE, *NESTED]

# 真实预算：Codex 只拼接 cwd 的**祖先路径**，最大组合是 root + 单个嵌套（三份永不同时加载）。
# project_doc_max_bytes 默认 32 KiB → 取 30 KiB，留 2 KiB 余量。
PAIR_CAP = 30_720

# 单文件上限：统一取 16 KiB，只拦「某个文件独自长胖」。实测（2026-09-25 拆分后）
# root 12,418 / src 6,583 / src-tauri 10,768 B，三份都留有余地。
# 三者之和（49,152 B）远超 PAIR_CAP —— 单文件各自合规 ≠ root + 嵌套合规，故两项都必要。
SIZE_CAPS = {
    "AGENTS.md": 16_384,
    "src/AGENTS.md": 16_384,
    "src-tauri/AGENTS.md": 16_384,
}

# 每条红线的判定签名（用于确认「全文在此文件」）。刻意选正文独有、且不会在
# 交叉引用句里被复述的片段 —— 各文件的「跨栈红线见根文件」提示语刻意避开了这些词。
SIGNATURES = {
    1: "统一命令执行接口",
    2: "跨平台 shell 选择",
    3: "阻塞 I/O 隔离",
    4: "IPC 大文本边界",
    5: "Event 名常量化",
    6: "Command 层保持极薄",
    7: "嵌套不超过 3 层",
    8: "路径安全校验",
    9: "`mod.rs` 保持极薄",
    10: "平台代码规范化",
    11: "换行边界",
    12: "路径身份唯一化",
    13: "测试夹具路径平台无关",
    14: "能力声明必须与实现一致",
    15: "语言差异必须落在插件数据",
}

# 红线表必需列（表头即契约）。摘要列供「嵌套 AGENTS.md 未加载」时兜底。
LEDGER_COLUMNS = ("#", "红线", "必须 / 禁止（摘要）", "全文位置")
TITLE_COLUMN = "红线"
SUMMARY_COLUMN = "必须 / 禁止（摘要）"
# 摘要只做兜底，不得长成第二份正文（正文以落点文件为准）。
SUMMARY_MAX_BYTES = 200

# 索引表行：| 4 | **IPC 大文本边界** | 单次… | 本文件 ↓ |
# 列数以表头为准 → 只锚定编号与行尾，中间单元格按 | 拆。
ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|(.+)\|\s*$")
# 表格行（允许非落点文件出现的唯一形态 —— 即它只是索引，不是第二份正文）
INDEX_ROW_RE = re.compile(r"^\s*\|")
HEADING_RE = re.compile(r"^#{1,4} ")


def read(path: str) -> str:
    return (REPO / path).read_text(encoding="utf-8")


def sections(text: str):
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


def ledger_rows():
    """解析根文件「审查红线」章节，返回 (表头单元格, {编号: 单元格列表})。

    表格解析的唯一入口 —— parse_index / report_ledger / --list 共用，避免多份解析各自漂移。
    """
    header, rows, gate = [], {}, False
    for line in read(ROOT_FILE).split("\n"):
        if HEADING_RE.match(line):
            gate = "审查红线" in line
            continue
        if not gate or not INDEX_ROW_RE.match(line):
            continue
        m = ROW_RE.match(line)
        if m:
            num = int(m.group(1))
            if num in SIGNATURES:
                rows[num] = [c.strip() for c in m.group(2).split("|")]
        elif not header:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cells and cells[0] == "#":
                header = cells
    return header, rows


def parse_index():
    """从根文件的红线表解析 {编号: 声明的落点文件}（落点 = 每行末列）。"""
    declared = {}
    for num, cells in ledger_rows()[1].items():
        loc = cells[-1]
        if "本文件" in loc:
            declared[num] = ROOT_FILE
            continue
        m = re.search(r"`([^`]+)`", loc)
        declared[num] = m.group(1) if m else loc
    return declared


def report_ledger():
    """红线表结构校验：必需列齐全 + 标题含签名 + 摘要列逐条非空且不超长。

    - **标题含签名**：台账「红线」列是正文标题的**唯一对外名字**，必须包含 `SIGNATURES[num]`。
      否则同一条规则就有两个名字（台账一个、正文一个），grep 任一名字都找不全 —— 正是红线 15
      反对的「同一知识两种表示」。只要求包含（正文标题通常带更长限定），不要求逐字相等。
    - **摘要列**：嵌套文件未加载时的兜底，够用来识别并停止违规即可 —— 只校验存在性与长度，
      不比对文案，否则摘要会退化成需要同步维护的第二份正文。
    """
    problems = []
    header, rows = ledger_rows()
    if not header:
        problems.append(
            "根 AGENTS.md 红线表缺少表头行；需含列：" + " / ".join(LEDGER_COLUMNS)
        )
        return problems
    for col in LEDGER_COLUMNS:
        if col not in header:
            problems.append(f"红线表缺少列「{col}」（现有列：{' / '.join(header)}）")
    if problems:
        return problems

    title_idx = header.index(TITLE_COLUMN)
    sum_idx = header.index(SUMMARY_COLUMN)
    for num in sorted(SIGNATURES):
        cells = rows.get(num)
        if cells is None:
            continue  # 缺行由 report_routing 报「缺少编号」
        full = [str(num), *cells]  # 编号列由 ROW_RE 单独捕获，这里补回以便与表头对位
        if len(full) != len(header):
            problems.append(
                f"红线 {num} 列数 {len(full)} 与表头 {len(header)} 不一致"
                "（摘要里禁止出现未转义的 |）"
            )
            continue
        title = full[title_idx]
        if SIGNATURES[num] not in title:
            problems.append(
                f"红线 {num} 台账标题「{title}」不含签名「{SIGNATURES[num]}」"
                "（台账标题与正文标题已漂移 —— 同一条规则会因此有两个名字）"
            )
        summary = full[sum_idx]
        size = len(summary.encode("utf-8"))
        if not summary:
            problems.append(
                f"红线 {num} 摘要列为空 —— 嵌套 AGENTS.md 未加载时该条规则不可执行"
            )
        elif size > SUMMARY_MAX_BYTES:
            problems.append(
                f"红线 {num} 摘要 {size} B 超过上限 {SUMMARY_MAX_BYTES} B"
                "（摘要只做兜底，正文以落点文件为准）"
            )
    return problems


def actual_homes():
    """扫描三个文件，返回 {编号: [实际含正文的文件]} 与「正文形态异常」清单。

    同一条红线在自己的落点文件里出现多行是正常的（标题 + 正文引用），因此只校验
    「首次出现是否位于标题/列表项/引用块」，不限制出现次数。
    """
    cache = {rel: read(rel).split("\n") for rel in SCANNED}
    homes, strays = {}, []
    for num, sig in SIGNATURES.items():
        for rel in SCANNED:
            body = [ln for ln in cache[rel] if sig in ln and not INDEX_ROW_RE.match(ln)]
            if not body:
                continue
            homes.setdefault(num, []).append(rel)
            if not body[0].lstrip().startswith(("#", "*", ">")):
                strays.append((num, rel, body[0].strip()[:70]))
    return homes, strays


def pair_sizes():
    """[(嵌套文件, root + 嵌套字节数)]，仅列两者都存在时的组合。

    Codex 只拼 cwd 的祖先路径，因此这是它实际会合并加载的组合；三份永不同时加载。
    """
    root = REPO / ROOT_FILE
    if not root.exists():
        return []
    return [
        (nested, root.stat().st_size + (REPO / nested).stat().st_size)
        for nested in NESTED
        if (REPO / nested).exists()
    ]


def report_sizes():
    problems = []
    for rel in SCANNED:
        p = REPO / rel
        if not p.exists():
            problems.append(f"缺少文件 {rel}")
            continue
        size = p.stat().st_size
        cap = SIZE_CAPS[rel]
        if size > cap:
            problems.append(f"{rel} 体积 {size:,} B 超过上限 {cap:,} B")
            for title, ssz in sorted(sections(read(rel)), key=lambda x: -x[1])[:6]:
                problems.append(f"    {ssz:>6,} B  {title}")
    for nested, pair in pair_sizes():
        if pair > PAIR_CAP:
            problems.append(
                f"{ROOT_FILE} + {nested} 合计 {pair:,} B 超过上限 {PAIR_CAP:,} B"
                "（Codex project_doc_max_bytes 默认 32 KiB，按 cwd 祖先路径拼接计）"
            )
            for rel in (ROOT_FILE, nested):
                problems.append(f"    {(REPO / rel).stat().st_size:>7,} B  {rel}")
    return problems


def report_routing():
    problems = []
    declared = parse_index()

    missing = sorted(set(SIGNATURES) - set(declared))
    if missing:
        problems.append(
            "根 AGENTS.md 红线表缺少编号：" + ", ".join(str(n) for n in missing)
            + "（表是机读台账，15 条必须逐条在列）"
        )
    unknown = sorted(set(declared) - set(SIGNATURES))
    if unknown:
        problems.append("红线表出现未知编号：" + ", ".join(str(n) for n in unknown))

    homes, strays = actual_homes()

    for num, sig in SIGNATURES.items():
        where = homes.get(num, [])
        want = declared.get(num)
        if want and not (REPO / want).exists():
            problems.append(f"红线 {num} 声明的落点文件不存在：{want}")
        if not where:
            problems.append(
                f"红线 {num} 全文缺失（签名「{sig}」在任何 AGENTS.md 正文中都未出现）"
                f"，声明落点={want or '未声明'}"
            )
            continue
        if len(where) > 1:
            problems.append(
                f"红线 {num} 正文出现在多个文件：{', '.join(where)} —— 同一知识只允许一处正文"
                "（若本意是交叉引用，只写 `红线 N`，不要复述标题）"
            )
        if want and where[0] != want:
            problems.append(
                f"红线 {num} 落点漂移：表声明 {want}，正文实际在 {where[0]}"
            )

    for num, rel, snippet in strays:
        problems.append(
            f"红线 {num} 在 {rel} 的正文形态异常（应位于 # / ** / > 起始行）：{snippet}"
            "；交叉引用请只写 `红线 N`"
        )
    return problems


def main() -> int:
    if "--list" in sys.argv:
        header, rows = ledger_rows()
        declared = parse_index()
        print("红线台账（编号  签名  →  落点）")
        for num in sorted(SIGNATURES):
            print(f"  {num:>2}  {SIGNATURES[num]:<24} → {declared.get(num, '未声明!')}")
        print()
        if header and SUMMARY_COLUMN in header:
            idx = header.index(SUMMARY_COLUMN)
            print("摘要（嵌套 AGENTS.md 未加载时的兜底）")
            for num in sorted(SIGNATURES):
                cells = rows.get(num) or []
                if len(cells) + 1 == len(header):
                    print(f"  {num:>2}  {cells[idx - 1]}")
            print()
        for rel in SCANNED:
            size = (REPO / rel).stat().st_size
            print(f"  {size:>7,} B / {SIZE_CAPS[rel]:>7,} B  {rel}")
        for nested, pair in pair_sizes():
            print(f"  {pair:>7,} B / {PAIR_CAP:>7,} B  {ROOT_FILE} + {nested}（Codex 合并预算）")
        return 0

    problems = report_sizes() + report_ledger() + report_routing()
    if problems:
        print("FAIL: AGENTS.md 体积 / 红线台账校验未通过\n", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\n参考：`python3 .trellis/scripts/check_agents_md_size.py --list` 看全量台账。"
            "\n新增规则请先决定作用域：单侧专属 → 对应嵌套 AGENTS.md；跨栈 → 留根并登记进红线表。",
            file=sys.stderr,
        )
        return 1

    for rel in SCANNED:
        size = (REPO / rel).stat().st_size
        print(f"  OK  {size:>7,} B / {SIZE_CAPS[rel]:>7,} B  {rel}")
    for nested, pair in pair_sizes():
        print(f"  OK  {pair:>7,} B / {PAIR_CAP:>7,} B  {ROOT_FILE} + {nested}")
    print("  OK  15 条红线落点唯一且与索引表一致")
    print(f"  OK  红线表 {len(LEDGER_COLUMNS)} 列齐全，摘要逐条非空且 ≤ {SUMMARY_MAX_BYTES} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
