"""字体角色化护栏：禁止在 `src/styles` 下新增裸 `font-family` 硬编码。

豁免：`nerd-font.css` / `jetbrains-mono.css` —— 它们是 @font-face 定义源，必须写裸值。
合法值：`var(--*)` / `inherit` / `initial` / `unset`（含 `!important` 后缀）。

历史：接在 `pnpm lint` 上却从未接进 CI（CI 不调用 `pnpm lint`），2026-09 收敛进框架后
两条 stage 一起声明，本地与 PR 门禁集不再可能漂移。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

EXEMPT = {"nerd-font.css", "jetbrains-mono.css"}
SCOPE = "src/styles/**/*.css"
RE_FONT_FAMILY = re.compile(r"font-family\s*:\s*([^;{}]+);", re.IGNORECASE)

GUARD = Guard(
    id="check_font_family_guard",
    title="src/styles 下禁止裸 font-family 硬编码（消费方走角色变量）",
    scopes=(SCOPE,),
    docs=".trellis/spec/frontend/quality-guidelines.md",
    fix_hint=(
        "改用 var(--font-mono) / var(--font-ui) / inherit；"
        "确属 @font-face 定义源的文件加进本模块 EXEMPT"
    ),
)


def is_allowed_value(val: str) -> bool:
    v = val.strip().lower()
    if "var(--" in v or "inherit" in v:
        return True
    return v.replace("!important", "").strip() in ("inherit", "initial", "unset")


def check(ctx: Context) -> GuardResult:
    files = ctx.glob(SCOPE)
    findings: list[Finding] = []
    exempted = 0

    for css_file in files:
        if css_file.name in EXEMPT:
            exempted += 1
            continue
        for idx, line in enumerate(ctx.read_tolerant(ctx.rel(css_file)).splitlines(), start=1):
            for match in RE_FONT_FAMILY.finditer(line):
                raw_val = match.group(1).split("/*")[0].strip()
                if not is_allowed_value(raw_val):
                    findings.append(
                        Finding(f"裸 font-family: {raw_val}", ctx.rel(css_file), idx)
                    )

    metrics = f"{len(files)} 个 css（豁免 {exempted}）/ {len(findings)} 处违规"
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
