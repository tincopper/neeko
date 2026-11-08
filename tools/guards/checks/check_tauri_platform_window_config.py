"""平台 Tauri 配置的**有效窗口配置**必须满足应用契约。

机制（`tauri-cli` 2.12 `helpers/config.rs`）：主配置与 `tauri.<platform>.conf.json`
用 `json_patch::merge`（RFC 7396 JSON Merge Patch）合并 —— 对象深合并、`null` 删键、
数组整体替换。macOS 配置为了原生标题栏声明自己的 `app.windows`，会把主配置的窗口
对象整个换掉：没写出来的 `maximized: true` 回落到默认值，表现为冷启动不最大化。

**判据只作用于合并后的有效配置**（`merge_patch(main, platform_conf)`），不去猜配置
文件长什么样 —— 配置文件形状只是手段，应用最终拿到什么才是事实：

1. 主配置是窗口集合与字段清单的唯一事实源；`REQUIRED_STARTUP_STATE` 是唯一硬编码的
   产品约束（冷启动即最大化）；
2. 每个平台的有效 `app.windows` 必须与主配置同长度，且每个窗口与
   `_expected_window()` 逐字段一致 —— 缺字段、值漂移、`null` 删键、窗口被删/多出、
   平台覆盖整段消失，都会在这里显形；
3. `PLATFORM_WINDOW_STATE` 是平台专属、主配置里没有（或有意取不同值）的期望增量；
   它同时保证「有专属契约的平台必须存在配置文件」。

扩展方式：新平台配置出现即自动纳入，默认继承主配置契约；新增显式窗口字段无需改护栏；
平台外观变更改这一张表。合并语义只在 `merge_patch()` 一处，check 只消费结果。
"""
from __future__ import annotations

import json
from typing import Any

from guards.core.contract import Context, Finding, Guard, GuardResult

MAIN_CONF = "src-tauri/tauri.conf.json"
PLATFORM_GLOB = "src-tauri/tauri.*.conf.json"

# 唯一硬编码的产品约束。其余窗口字段一律由主配置派生，护栏里不抄第二份配置值。
REQUIRED_STARTUP_STATE = {"maximized": True}

# 平台专属期望增量（不是「允许差异」的许可表）：覆盖整段消失时，有效配置会退回
# 主配置外观，这里会直接判失败。`titleBarStyle` 是主配置里不存在的字段。
PLATFORM_WINDOW_STATE = {
    "macos": {
        "title": "",
        "decorations": True,
        "transparent": True,
        "titleBarStyle": "Overlay",
    },
}

GUARD = Guard(
    id="check_tauri_platform_window_config",
    title="平台 Tauri 配置合并后的有效窗口配置必须满足应用契约",
    scopes=(MAIN_CONF, PLATFORM_GLOB),
    docs=".trellis/spec/backend/window-lifecycle.md",
    fix_hint=(
        "平台配置的 app.windows 数组会整体替换主配置数组：补齐主配置的全部窗口字段"
        "（尤其 maximized: true）；平台外观变更同步改 PLATFORM_WINDOW_STATE"
    ),
)

_MISSING = object()


def merge_patch(doc: Any, patch: Any) -> Any:
    """RFC 7396 JSON Merge Patch —— 与 tauri-cli `json_patch::merge` 同语义。

    对象深合并；`null` 删除键；数组与其它非对象值整体替换。整个护栏里关于
    「Tauri 怎么合并配置」的知识只此一处，且是纯函数，可被测试与其它护栏复用。
    """
    if not isinstance(patch, dict):
        return patch
    merged = dict(doc) if isinstance(doc, dict) else {}
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = merge_patch(merged.get(key), value)
    return merged


def _read(path) -> dict:
    """读 JSON 配置；解析失败抛 ValueError，由 check 统一转「护栏失效」。"""
    try:
        conf = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"{path.name} 不是合法 JSON：{e}") from e
    if not isinstance(conf, dict):
        raise ValueError(f"{path.name} 顶层必须是对象")
    return conf


def _windows(conf: dict):
    app = conf.get("app")
    return app.get("windows") if isinstance(app, dict) else None


def _base_windows(main: dict) -> list:
    """主配置窗口集合：既是字段清单的事实源，也是窗口数量的基准。"""
    windows = _windows(main)
    if not isinstance(windows, list) or not windows or not all(
        isinstance(w, dict) for w in windows
    ):
        raise ValueError(f"{MAIN_CONF} 缺少合法的 app.windows 数组")
    return windows


def _platform_name(path) -> str:
    return path.name.split(".")[1]  # tauri.<platform>.conf.json


def _show(value) -> str:
    return "缺失" if value is _MISSING else repr(value)


def _expected_window(base: dict, platform: str) -> dict:
    """主配置窗口 + 平台专属期望增量 —— 契约的唯一产出点。"""
    return {**base, **PLATFORM_WINDOW_STATE.get(platform, {})}


def _main_findings(base_windows: list) -> list[Finding]:
    """产品约束只判主配置（唯一事实源），不在每个平台重复判一遍。"""
    findings = []
    for idx, base in enumerate(base_windows):
        for key, value in REQUIRED_STARTUP_STATE.items():
            if base.get(key, _MISSING) != value:
                findings.append(
                    Finding(
                        f"主配置 app.windows[{idx}].{key} 必须为 {_show(value)}，"
                        f"实际 {_show(base.get(key, _MISSING))}",
                        MAIN_CONF,
                    )
                )
    return findings


def _platform_targets(ctx: Context) -> list[tuple[str, Any]]:
    """待评估平台 = 仓库里存在的配置 ∪ 契约里登记的平台（后者消失 = 静默回退）。"""
    files = {_platform_name(p): p for p in ctx.glob(PLATFORM_GLOB)}
    return [
        (name, files.get(name))
        for name in sorted(set(files) | set(PLATFORM_WINDOW_STATE))
    ]


def _evaluate(effective: dict, base_windows: list, platform: str, rel: str) -> list[Finding]:
    """只消费合并后的有效配置：窗口集合完整 + 逐字段匹配期望。"""
    windows = _windows(effective)
    if not isinstance(windows, list) or len(windows) != len(base_windows):
        return [
            Finding(
                f"有效 app.windows 应为 {len(base_windows)} 个窗口，实际 {windows!r} —— "
                "平台配置数组会整体替换主配置数组（RFC 7396），null 也会删掉整个键",
                rel,
            )
        ]

    findings = []
    for idx, (base, window) in enumerate(zip(base_windows, windows)):
        if not isinstance(window, dict):
            findings.append(Finding(f"有效 app.windows[{idx}] 不是对象：{window!r}", rel))
            continue
        for key, value in _expected_window(base, platform).items():
            actual = window.get(key, _MISSING)
            if actual != value:
                findings.append(
                    Finding(
                        f"有效 app.windows[{idx}].{key} 应为 {_show(value)}，"
                        f"实际 {_show(actual)}（平台 {platform}）",
                        rel,
                    )
                )
    return findings


def check(ctx: Context) -> GuardResult:
    main_path = ctx.path(MAIN_CONF)
    if not main_path.is_file():
        return GuardResult.broken(f"找不到 {MAIN_CONF}")

    try:
        main = _read(main_path)
        base_windows = _base_windows(main)
    except ValueError as e:
        return GuardResult.broken(str(e))
    scanned = 1

    findings = _main_findings(base_windows)
    targets = _platform_targets(ctx)
    if not targets:
        return GuardResult.broken(f"{PLATFORM_GLOB} 下没有平台配置，护栏空转", scanned=scanned)

    for name, path in targets:
        if path is None:
            findings.append(
                Finding(
                    f"缺少 {name} 平台配置：该平台有专属窗口契约，配置文件消失会让"
                    "窗口状态静默回退主配置",
                    MAIN_CONF,
                )
            )
            continue
        try:
            patch = _read(path)
        except ValueError as e:
            return GuardResult.broken(str(e), scanned=scanned)
        scanned += 1
        findings.extend(
            _evaluate(merge_patch(main, patch), base_windows, name, ctx.rel(path))
        )

    metrics = (
        f"主配置 + {sum(1 for _, path in targets if path is not None)} 份平台配置"
        f" / {len(targets)} 个平台"
    )
    if findings:
        return GuardResult.violated(scanned, findings, metrics=metrics)
    return GuardResult.passed(scanned, metrics=metrics)
