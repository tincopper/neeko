"""config 所有权与主题投影必须唯一（对应 .trellis/spec/frontend/state-management.md §2）。

## 第一性原理

`useAppConfig` 曾是一个「自带 state + 全局副作用」的 hook，却从 feature barrel 导出，
看起来与普通 feature hook 无异。React 允许组件被挂载任意多次，于是任何组件都能成为
**第二个 config owner**：mount 时把 `data-theme` 重置成 DEFAULT_CONFIG.theme（dark），
异步 `load_config` 完成再改回用户主题（light）——整窗主题翻转，叠加卡片/按钮的
`transition-colors` 就是「进入 Skills 闪一下黑」（2026-11 事故：`ViewSkillDialog`
在 `open=false` 时仍被 `SkillContent` 挂载）。

局部修复（改用只读 context）只能删掉这一个非法实例。本护栏把设计不变量变成机器判据：
**owner 恰好一个、投影写入点恰好一个、React-hook 型 owner 恰好挂一次**。

## 边界（如实声明，不过度声称）

- 只扫生产代码（排除 `__tests__/` 与 `*.test.*`）：测试夹具里的 `data-theme` 写入是
  断言前置条件，不是投影。
- `app/bootstrap/customThemeVars.ts` / `typography.ts` / `terminal.ts` 内部的 CSS 变量写入是
  既有单一职责模块，且只被 `configProjection` 调用，不在本护栏口径内；本护栏只钉
  `data-theme` 这个「整窗主题开关」的写入点（两种等价写法都算：`setAttribute` 与
  `dataset.theme =`）。
- 「清单 ↔ React 适配器表」的对应关系由 **tsc** 判（`Record<ReactHookOwnerId, …>`），
  不在本护栏重复实现；本护栏只钉「接线点唯一」。
- 注释里出现的名字不算调用：只看 `标识符(` 形态；定义文件本身豁免。
- hook 型 owner 的「接线」只认两种形态：直接调用 `hook()` 与适配器表的值引用
  `id: hook`。`import` / `export { … }` 只是搬运名字（门面 re-export 更不是接线点），
  不计入接线点。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCAN_SCOPES = ("src/**/*.ts", "src/**/*.tsx")

OWNER_DEF = "src/app/hooks/useAppConfigOwner.ts"
OWNER_CALL_SITE = "src/app/hooks/useAppShellData.ts"
PROJECTION = "src/app/bootstrap/configProjection.ts"
REACT_HOOK_SITE = "src/app/hooks/useAppGlobalEffects.ts"
SETTINGS_BARREL = "src/features/settings/index.ts"

RE_OWNER_CALL = re.compile(r"\buseAppConfigOwner\s*\(")
RE_LEGACY_OWNER = re.compile(r"\buseAppConfig\s*\(")
# `data-theme` 的两种等价写法：`setAttribute('data-theme', …)` 与 `dataset.theme = …`。
# 只认一种等于给判据留后门 —— 换成另一种写法就能静默绕过「唯一投影点」。
RE_THEME_WRITE = re.compile(
    r"""setAttribute\(\s*['"`]data-theme['"`]|dataset\.theme\s*="""
)
RE_BRIDGE_USE = re.compile(r"\buseLiveSessionsBridge\s*\(|:\s*useLiveSessionsBridge\b")
RE_BARREL_LEAK = re.compile(r"\buseAppConfig(?:Owner)?\b")
BRIDGE_DEF = "src/features/live-sessions/hooks/useLiveSessionsBridge.ts"

RE_LINE_COMMENT = re.compile(r"//[^\n]*")
RE_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)


def _strip_comments(text: str) -> str:
    """保留换行地剥掉注释：注释里提到 `useAppConfig()` 不是调用点。"""
    text = RE_BLOCK_COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), text)
    return RE_LINE_COMMENT.sub("", text)

GUARD = Guard(
    id="check_config_owner_singleton",
    title="config owner 恰好一个、data-theme 投影恰好一处、hook 型全局 owner 接线点唯一",
    scopes=SCAN_SCOPES + (SETTINGS_BARREL, OWNER_DEF, OWNER_CALL_SITE, PROJECTION, REACT_HOOK_SITE),
    docs=".trellis/spec/frontend/state-management.md",
    fix_hint=(
        "业务组件只读 useAppContext()/useConfig()，不得调用 useAppConfigOwner()；"
        "主题写入统一走 src/app/bootstrap/configProjection.ts；"
        "全局恰好一次的 owner 只在 src/app/bootstrap/globalOwners.ts 清单里登记"
    ),
)


def _production_files(ctx: Context) -> list:
    paths = ctx.glob(SCAN_SCOPES[0]) + ctx.glob(SCAN_SCOPES[1])
    return sorted(
        {
            p
            for p in paths
            if "__tests__" not in p.parts
            and ".test." not in p.name
            and ".spec." not in p.name
        }
    )


def _line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def check(ctx: Context) -> GuardResult:
    files = _production_files(ctx)
    if not files:
        return GuardResult.broken("src 下一个生产 ts/tsx 都没扫到 —— 扫描口径失效", scanned=0)

    texts: dict[str, str] = {}
    for path in files:
        texts[ctx.rel(path)] = _strip_comments(ctx.read(ctx.rel(path)))

    findings: list[Finding] = []
    owner_calls: list[tuple[str, int]] = []
    theme_writes: list[tuple[str, int]] = []
    bridge_refs: list[tuple[str, int]] = []

    for rel, text in texts.items():
        if rel != OWNER_DEF:
            for m in RE_OWNER_CALL.finditer(text):
                owner_calls.append((rel, _line_of(text, m.start())))
        for m in RE_LEGACY_OWNER.finditer(text):
            findings.append(
                Finding("旧 owner 名 useAppConfig( 仍在生产代码里；必须改用只读 context", rel, _line_of(text, m.start()))
            )
        for m in RE_THEME_WRITE.finditer(text):
            theme_writes.append((rel, _line_of(text, m.start())))
        if rel != BRIDGE_DEF:
            for m in RE_BRIDGE_USE.finditer(text):
                bridge_refs.append((rel, _line_of(text, m.start())))

    # 判据 1：owner 调用点恰好一个，且落在组合根
    if len(owner_calls) != 1 or owner_calls[0][0] != OWNER_CALL_SITE:
        where = ", ".join(f"{r}:{n}" for r, n in owner_calls) or "无"
        findings.append(
            Finding(
                f"useAppConfigOwner() 调用点必须恰好 1 处且位于 {OWNER_CALL_SITE}；实测：{where}",
                owner_calls[0][0] if owner_calls else OWNER_CALL_SITE,
                owner_calls[0][1] if owner_calls else 0,
            )
        )
    for rel, line in owner_calls:
        if rel.startswith("src/features/"):
            findings.append(Finding("feature 组件不得成为 config owner（只读 useAppContext）", rel, line))

    # 判据 2：data-theme 只允许投影模块写
    for rel, line in theme_writes:
        if rel != PROJECTION:
            findings.append(
                Finding(f"data-theme 只允许在 {PROJECTION} 写入（唯一投影点）", rel, line)
            )
    if not any(rel == PROJECTION for rel, _ in theme_writes):
        findings.append(Finding(f"{PROJECTION} 必须持有唯一的 data-theme 写入点", PROJECTION))

    # 判据 3：settings barrel 不得漏出 owner
    barrel = texts.get(SETTINGS_BARREL)
    if barrel is None:
        if ctx.path(SETTINGS_BARREL).is_file():
            barrel = ctx.read(SETTINGS_BARREL)
    if barrel and RE_BARREL_LEAK.search(barrel):
        for m in RE_BARREL_LEAK.finditer(barrel):
            findings.append(
                Finding("settings barrel 不得导出 config owner（业务组件只许读 context）", SETTINGS_BARREL, _line_of(barrel, m.start()))
            )

    # 判据 4：React-hook 型全局 owner 只允许在一个文件里接线
    # 认「标识符出现」而不是「标识符(」：实现可以是直接调用，也可以是适配器表里的值引用，
    # 两种写法都必须只有一个落点。
    bridge_sites = sorted({rel for rel, _ in bridge_refs})
    if bridge_sites != [REACT_HOOK_SITE]:
        where = ", ".join(bridge_sites) or "无"
        findings.append(
            Finding(
                f"useLiveSessionsBridge 只允许在 {REACT_HOOK_SITE} 接线；实测：{where}",
                bridge_sites[0] if bridge_sites else REACT_HOOK_SITE,
                bridge_refs[0][1] if bridge_refs else 0,
            )
        )

    seen: set[tuple[str, str, int]] = set()
    unique: list[Finding] = []
    for finding in findings:
        key = (finding.message, finding.file, finding.line)
        if key not in seen:
            seen.add(key)
            unique.append(finding)
    findings = unique
    metrics = (
        f"{len(files)} 文件 / owner {len(owner_calls)} / 主题写入 {len(theme_writes)} / bridge {len(bridge_refs)}"
    )
    if findings:
        return GuardResult.violated(len(files), findings, metrics=metrics)
    return GuardResult.passed(len(files), metrics=metrics)
