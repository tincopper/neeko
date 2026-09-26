"""命令行 —— 三个消费端（package.json / CI / lefthook）各自只调用这里一次。

约定：`--stage` 决定「哪个场合的门禁集」，护栏自己声明自己属于哪些 stage。
所以新增护栏不需要新增任何一处接线；删掉一条也同理。
"""
from __future__ import annotations

import argparse
import subprocess
import sys

from . import repo, runner
from .contract import STAGES
from .registry import RegistryError, discover
from .report import FORMATS

GIT_ERROR = "拿不到 git 改动集（不在 git 仓库内 / git 不可用）"


def _split(argv: list[str]) -> tuple[list[str], list[str]]:
    """允许 `run.py <cmd> ... -- <显式路径>`：路径里出现空格或 `-` 开头时不被 argparse 吃掉。"""
    if "--" in argv:
        i = argv.index("--")
        return argv[:i], argv[i + 1 :]
    return argv, []


def _changed(args, extra: list[str]) -> list:
    if extra:
        return extra
    if args.staged:
        out = subprocess.run(
            ["git", "diff", "--cached", "--name-only"], capture_output=True, text=True
        )
        if out.returncode != 0:
            raise RuntimeError(GIT_ERROR)
        return [p for p in out.stdout.splitlines() if p.strip()]
    return list(args.changed or [])


def _registry_table(stage: str | None = None) -> int:
    try:
        registrations = discover(repo.find_repo_root())
    except RegistryError as exc:
        print("护栏注册表校验未通过：", file=sys.stderr)
        for problem in exc.args[0] if isinstance(exc.args[0], list) else [exc.args[0]]:
            print(f"  - {problem}", file=sys.stderr)
        return 2

    shown = [r for r in registrations if not stage or stage in r.guard.stages]
    excluded = [r.id for r in registrations if r not in shown]

    scope_note = f"（stage={stage}）" if stage else ""
    print(f"护栏清单{scope_note}（来源：guards/checks/ 目录本身，新增文件即注册）\n")
    for reg in shown:
        g = reg.guard
        reds = ",".join(str(n) for n in g.red_lines) or "-"
        print(f"  {g.id}")
        print(f"      {g.title}")
        print(f"      stage={','.join(g.stages)}  红线={reds}  台账={g.ledger or '-'}  预算={g.budget_ms:,}ms")
        print(f"      scope={', '.join(g.scopes)}")
        if g.docs:
            print(f"      机制详解：{g.docs}")
        if g.fix_hint:
            print(f"      修复：{g.fix_hint}")
        print()

    if stage:
        total = len(registrations)
        tail = f"未列入：{', '.join(excluded)}" if excluded else "无护栏被排除"
        print(f"stage={stage}：{len(shown)} / {total} 条在册（{tail}）")
        return 0
    print(f"共 {len(registrations)} 条。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="guards", description="Neeko 护栏框架：注册表 = guards/checks/ 目录"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="跑一个 stage 的全部护栏")
    run.add_argument("--stage", choices=STAGES, default="local")
    run.add_argument("--format", choices=FORMATS, default="text", dest="fmt")
    run.add_argument("--only", action="append", default=[], help="只跑指定护栏（可重复）")
    run.add_argument("--staged", action="store_true", help="用 git 暂存集跳过无关护栏")
    run.add_argument("--changed", nargs="*", default=[], help="显式改动集（相对仓库根）")
    run.add_argument("--no-selftest", action="store_true", help="跳过护栏自身单测")

    lst = sub.add_parser("list", help="列护栏清单；带护栏 id 则打印该护栏的台账明细")
    lst.add_argument("guard_id", nargs="?")
    lst.add_argument("--stage", choices=STAGES, help="只看某个 stage 实际会门禁的集合")
    return parser


def main(argv: list[str]) -> int:
    head, extra = _split(argv)
    args = build_parser().parse_args(head)
    if args.command == "list":
        if not args.guard_id:
            return _registry_table(args.stage)
        return runner.execute(only=[args.guard_id], list_mode=True, run_selftest=False)

    try:
        changed = _changed(args, extra)
    except RuntimeError as exc:
        print(f"护栏框架无法启动：{exc}", file=sys.stderr)
        return 2
    return runner.execute(
        stage=args.stage,
        changed=changed,
        only=args.only,
        fmt=args.fmt,
        run_selftest=not args.no_selftest,
    )
