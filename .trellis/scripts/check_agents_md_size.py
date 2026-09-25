#!/usr/bin/env python3
"""AGENTS.md 体积与红线路由台账护栏。

背景：根 AGENTS.md 曾膨胀到 33,969 B（超过 CLI 的 32,768 B 提示线），其中约 34% 是
15 条「AI 代码审查红线」的散文。2026-09-25 按代码物理边界拆分：

    AGENTS.md            跨栈内容 + 红线索引表（启动即加载，每个会话都付费）
    src/AGENTS.md        前端专属（读到 src/** 后懒加载）
    src-tauri/AGENTS.md  后端专属（读到 src-tauri/** 后懒加载）

本脚本钉住两件事后会悄悄退化的事：

1. **体积**：根文件不再长回散文堆。单文件上限取当前值 +20%，留出真实新增余地；
   三文件**合计**另有 `TOTAL_CAP` —— Codex 从仓库根到 cwd 拼接全部 AGENTS.md，预算受
   `project_doc_max_bytes`（默认 32 KiB）约束，只盯单文件会让合计静默越线。
2. **路由**：每条红线全文**恰好**出现在一个文件里（"一个位置"仅指下面三个 AGENTS.md ——
   `.trellis/spec/` 是机制详解层，允许承载同主题的背景与事故复盘）。索引表就是机读台账 ——
   声明的落点与红线正文必须同时存在且一致，否则：
   - 落点缺失 → 规则静默失效（比超长更糟）；
   - 两处重复 → 同一知识两种表示，必然漂移（正是红线 15 反对的事）。

索引表格式（根 AGENTS.md「AI 代码审查红线」章节）：

    | # | 红线 | 全文位置 |
    | 1 | 统一命令执行接口（Local/WSL/SSH） | `src-tauri/AGENTS.md` |
    | 4 | **IPC 大文本边界** | 本文件 ↓ |

用法：
    python3 .trellis/scripts/check_agents_md_size.py          # 校验
    python3 .trellis/scripts/check_agents_md_size.py --list   # 打印当前台账
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent

ROOT_FILE = "AGENTS.md"
SCANNED = ["AGENTS.md", "src/AGENTS.md", "src-tauri/AGENTS.md"]

# 上限 = 2026-09-25 拆分后实测值 + 约 20% 余地。
SIZE_CAPS = {
    "AGENTS.md": 14_336,
    "src/AGENTS.md": 18_432,
    "src-tauri/AGENTS.md": 18_432,
}

# 三文件合计上限：Codex project_doc_max_bytes 默认 32 KiB（根 → cwd 全量拼接），留 2 KiB 余量。
# SIZE_CAPS 之和（51,200 B）远超该预算 —— 单文件各自合规 ≠ 合并后仍能装下。
TOTAL_CAP = 30_720

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

# 索引表行：| 4 | **IPC 大文本边界** | 本文件 ↓ |
ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$")
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


def parse_index(text: str):
    """从根文件的红线表解析 {编号: 声明的落点文件}。"""
    gate_section = False
    found = {}
    for line in text.split("\n"):
        if HEADING_RE.match(line):
            gate_section = "审查红线" in line
            continue
        if not gate_section:
            continue
        m = ROW_RE.match(line)
        if not m:
            continue
        num = int(m.group(1))
        if num not in SIGNATURES:
            continue  # 表头/分隔行之外的陌生编号，忽略
        loc = m.group(3).strip()
        if "本文件" in loc:
            found[num] = ROOT_FILE
        else:
            p = re.search(r"`([^`]+)`", loc)
            found[num] = p.group(1) if p else loc
    return found


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


def report_sizes():
    problems = []
    total = 0
    for rel in SCANNED:
        p = REPO / rel
        if not p.exists():
            problems.append(f"缺少文件 {rel}")
            continue
        size = p.stat().st_size
        total += size
        cap = SIZE_CAPS[rel]
        if size > cap:
            problems.append(f"{rel} 体积 {size:,} B 超过上限 {cap:,} B")
            for title, ssz in sorted(sections(read(rel)), key=lambda x: -x[1])[:6]:
                problems.append(f"    {ssz:>6,} B  {title}")
    if total > TOTAL_CAP:
        problems.append(
            f"三文件合计 {total:,} B 超过上限 {TOTAL_CAP:,} B"
            "（Codex project_doc_max_bytes 默认 32 KiB，按根→cwd 全量拼接计）"
        )
        for rel in SCANNED:
            p = REPO / rel
            if p.exists():
                problems.append(f"    {p.stat().st_size:>7,} B  {rel}")
    return problems


def report_routing():
    problems = []
    root_text = read(ROOT_FILE)
    declared = parse_index(root_text)

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
            )
        if want and where[0] != want:
            problems.append(
                f"红线 {num} 落点漂移：表声明 {want}，正文实际在 {where[0]}"
            )

    for num, rel, snippet in strays:
        problems.append(
            f"红线 {num} 在 {rel} 的正文形态异常（应位于 # / ** / > 起始行）：{snippet}"
        )
    return problems


def main() -> int:
    if "--list" in sys.argv:
        declared = parse_index(read(ROOT_FILE))
        print("红线台账（编号  签名  →  落点）")
        for num in sorted(SIGNATURES):
            print(f"  {num:>2}  {SIGNATURES[num]:<24} → {declared.get(num, '未声明!')}")
        print()
        for rel in SCANNED:
            size = (REPO / rel).stat().st_size
            print(f"  {size:>7,} B / {SIZE_CAPS[rel]:>7,} B  {rel}")
        total = sum((REPO / rel).stat().st_size for rel in SCANNED)
        print(f"  {total:>7,} B / {TOTAL_CAP:>7,} B  三文件合计（Codex 合并预算）")
        return 0

    problems = report_sizes() + report_routing()
    if problems:
        print("FAIL: AGENTS.md 体积 / 红线路由校验未通过\n", file=sys.stderr)
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
    total = sum((REPO / rel).stat().st_size for rel in SCANNED)
    print(f"  OK  {total:>7,} B / {TOTAL_CAP:>7,} B  三文件合计")
    print("  OK  15 条红线落点唯一且与索引表一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
