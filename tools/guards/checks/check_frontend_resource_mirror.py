"""前端「后端资源状态的影子副本」禁令（红线 17 的机器判据）。

## 第一性原理

红线 17 说的是**同一事实只允许一个所有者**：

- 前端若需要知道「后端接管了谁」，那是后端应提供的**读接口** —— 而不是前端自己记账
  （`requestedIntent` / `inflightMount` 类「我请求过什么」的变量）。记账会漂移：后端因任何
  未通知前端的原因释放了挂载，记账仍说「已请求」，界面就永久停在「加载中」；反过来重试环
  为了兜住这种漂移，就成了打后端的自激源（`11-04-frontend-single-writer` 的删除台账）。
- 后端若需要知道「数据是否新鲜」，那是 store 的字段（`computed_at` / `dirty`）—— 不是
  「是否挂载」。资源状态不是数据可信度的代理。

这类「约定级」不变量历史上全靠 review 维持的都会长回来（参照 git-optional-lock 四次复发复盘），
因此钉成确定性静态判据。

## 判据

A. **影子记账标识符**（清单 = 下方 `MIRROR_IDENTIFIERS` 元组本身，不要在本段 prose 里另列
   一份副本）：`src/**` 的生产前端代码出现即违规。扫描是**原文级**（含注释）—— 注释里留
   「我们曾经用 requestedIntent 记账」这种措辞会把概念留在代码库里，下一个读代码的人照着
   抄回来；要解释历史就写「后端资源状态的影子副本（红线 17）」，不要写出已退役的变量名。

B. **状态读调用不得在渲染期裸调用**：`getWorkspaceStatus(` / `refreshWorkspaceStatus(` 的
   调用点必须位于 `useEffect(` / `useCallback(` / `useLayoutEffect(` 的括号范围内，或位于
   **普通函数**（既不是 hook `useXxx` 也不是组件 `Xxx`）的函数体里。

   为什么 B 需要：「渲染期裸调用」= 每次渲染一次 IPC + 一次 store 写入，比缺数据更糟
   （抖动 + 打后端）。而普通函数里的调用不是渲染期（它们是命令式流程：session 恢复、刷新
   按钮、事件回调），静态扫描看不到调用者，所以只能按**声明所在位置**判定 —— 这是**保守**
   判据，代价是「在 hook 里写一个非 `useCallback` 的裸 `async` 闭包再去调」会被误报。那本身
   也违反 hook 指南（跨组件/Context 分发必须 `useCallback`），误报可接受。

   允许 `const cb = useCallback(async () => { … })` 形态；刻意**不**允许 `useMemo` —— 它在
   渲染期同步执行，把副作用塞进去与裸调用等价。

## 范围

- 只扫生产代码：`__tests__/` / `*.test.ts(x)` / `src/testing/` 是夹具（那里出现这些名字是
  「验证它们不存在」，不是违规）。
- `src/shared/types/**` 是纯类型：没有运行时，接口里的方法签名不是调用。

## 已知边界

判据 A 是**标识符级**子串匹配：`requestedIntentFoo` 里的前缀相撞不会命中（词边界），但把
记账改名成 `pendingIntents` 这类同义新词不会被拦住 —— 判据的目标是「已退役机制不得回潮」，
不是自然语言语义分类。判据 B 依赖括号配平（先抹掉注释与字符串再配平），跨行模板字符串里的
括号不会影响（模板字面量同被抹平）。
"""
from __future__ import annotations

import re

from guards.core.contract import Context, Finding, Guard, GuardResult

SCOPES = ("src/**/*.ts", "src/**/*.tsx")

# 非生产代码：测试夹具与纯类型声明。
EXCLUDED_PREFIXES = ("src/shared/types/", "src/testing/")
TEST_FILE_RE = re.compile(r"\.(?:test|spec)\.tsx?$")

# 判据 A 的清单（唯一事实源）。加新词 = 加一行；不要在本文件别处再列一遍。
MIRROR_IDENTIFIERS = (
    "requestedIntent",
    "inflightIntent",
    "inflightMount",
    "requestedMount",
    "mountedIntent",
    "mountTicket",
    "mountTickets",
    "reportedGiveUp",
    "retryTick",
    "activationRetry",
)

# 判据 B 的调用面（命令名 + 前端 wrapper 名）。
STATUS_READ_CALL = re.compile(r"\b(?:getWorkspaceStatus|refreshWorkspaceStatus)\s*\(")
# 合法的执行上下文：effect / 回调（渲染期之外）。
CALLBACK_SCOPE = re.compile(r"\b(?:useEffect|useCallback|useLayoutEffect)\s*(?:<[^>]*>)?\s*\(")
# 普通函数声明（命令式流程所在）：名字既不是 hook 也不是组件 ⇒ 不在渲染期。
PLAIN_FUNCTION = re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(")
RENDER_NAME = re.compile(r"^(?:use[A-Z_$]|[A-Z_$])")

GUARD = Guard(
    id="check_frontend_resource_mirror",
    title="前端不得维护后端资源状态的影子副本；状态读调用不得在渲染期裸调用（红线 17）",
    scopes=SCOPES,
    red_lines=(),
    docs=".trellis/spec/frontend/state-management.md",
    fix_hint=(
        "删掉记账/重试环：需要知道后端接管了谁就问后端（读接口），需要知道数据新不新就看 "
        "store 的 computed_at/dirty。状态读一律放进 effect 或事件回调。"
    ),
)


def _blank_noise(text: str) -> str:
    """抹掉注释与字符串/模板字面量，保留长度与换行（偏移与行号因此仍可用）。

    TS 需要覆盖的三类噪声：`//` 行注释、`/* */` 块注释、`'`/`"`/`` ` `` 字面量。
    正则字面量刻意不处理 —— 本仓的这两个调用面不会出现在正则里，且误把 `/.../` 当代码
    只会让「括号配平」更保守（宁可漏配成区域也不至于凭空放大区域）。
    """
    out = []
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < length else ""
        if ch == "/" and nxt == "/":
            end = text.find("\n", i)
            i = length if end == -1 else end
        elif ch == "/" and nxt == "*":
            end = text.find("*/", i + 2)
            i = length if end == -1 else end + 2
        elif ch in ("'", '"', "`"):
            quote = ch
            j = i + 1
            while j < length and text[j] != quote:
                # 转义序列整体跳过（`\'` 不得提前结束字面量）
                j += 2 if text[j] == "\\" else 1
            i = length if j >= length else j + 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _paren_end(text: str, open_idx: int) -> int:
    """`text[open_idx] == '('` ⇒ 返回与之配对的 `)` 下标；配不上则返回文本末尾。"""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i
    return len(text)


def _brace_end(text: str, open_idx: int) -> int:
    """`text[open_idx] == '{'` ⇒ 返回与之配对的 `}` 下标；配不上则返回文本末尾。"""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i
    return len(text)


def _function_body(blanked: str, match) -> "tuple[int, int] | None":
    """`function name(...) {...}` 的整体区间（含声明位置）；拿不到函数体返回 None。"""
    params_end = _paren_end(blanked, match.end() - 1)
    body_start = blanked.find("{", params_end)
    if body_start == -1:
        return None
    return (match.start(), _brace_end(blanked, body_start))


def _hook_body_regions(blanked: str) -> list:
    """hook / 组件本体的区间（`function useXxx` / `function Xxx`）。"""
    regions = []
    for match in PLAIN_FUNCTION.finditer(blanked):
        if not RENDER_NAME.match(match.group(1)):
            continue
        span = _function_body(blanked, match)
        if span is not None:
            regions.append(span)
    return regions


def _allowed_regions(blanked: str) -> list:
    """判据 B 的合法上下文区间：`[(start, end)]`（含两端）。"""
    regions = []
    for match in CALLBACK_SCOPE.finditer(blanked):
        regions.append((match.start(), _paren_end(blanked, match.end() - 1)))
    # hook / 组件本体的区间先算出来：下面给「普通函数」授区间时要排除落在它们体内的声明。
    hook_regions = _hook_body_regions(blanked)
    for match in PLAIN_FUNCTION.finditer(blanked):
        name = match.group(1)
        if RENDER_NAME.match(name):
            # hook / 组件本体：调用必须落在它内部的 effect / callback 区间里。
            continue
        # 声明位置本身就在 hook / 组件体内 ⇒ **不**授予区间。
        # 否则「hook 里包一层具名函数、再在渲染期调用它」会整段放行 —— 那正是本判据要挡的
        # 形态（比直接裸调隐蔽；探针实测曾被这条豁免漏掉，2026-11 复核发现）。
        if any(start <= match.start() <= end for start, end in hook_regions):
            continue
        span = _function_body(blanked, match)
        if span is not None:
            regions.append(span)
    return regions


def _is_allowed(pos: int, regions: list) -> bool:
    return any(start <= pos <= end for start, end in regions)


def _is_production_ts(ctx: Context, path) -> bool:
    rel = ctx.rel(path)
    if any(rel.startswith(prefix) for prefix in EXCLUDED_PREFIXES):
        return False
    if TEST_FILE_RE.search(rel):
        return False
    return "/__tests__/" not in rel


def check(ctx: Context) -> GuardResult:
    files = sorted({p for scope in SCOPES for p in ctx.glob(scope)})
    scanned = 0
    findings = []
    for path in files:
        if not _is_production_ts(ctx, path):
            continue
        scanned += 1
        rel = ctx.rel(path)
        raw = ctx.read(rel)

        # 判据 A：原文级（注释里留退役机制的名字也算 —— 下一个读代码的人会照着抄）
        for identifier in MIRROR_IDENTIFIERS:
            for match in re.finditer(rf"\b{re.escape(identifier)}\b", raw):
                findings.append(
                    Finding(
                        f"出现「镜像后端资源态」的记账标识符 {identifier!r} —— "
                        "前端不得维护后端资源状态的影子副本（红线 17）："
                        "需要知道后端接管了谁就问后端，不需要自己记账",
                        rel,
                        raw.count("\n", 0, match.start()) + 1,
                    )
                )

        # 判据 B：代码级（先抹噪声再配平括号）
        blanked = _blank_noise(raw)
        regions = _allowed_regions(blanked)
        for match in STATUS_READ_CALL.finditer(blanked):
            if _is_allowed(match.start(), regions):
                continue
            findings.append(
                Finding(
                    f"{match.group(0).rstrip('(')} 的调用不在 effect / 回调 / 普通函数里 —— "
                    "渲染期裸调用等于每次渲染一次 IPC + 一次 store 写入（红线 17 的状态读一面）",
                    rel,
                    blanked.count("\n", 0, match.start()) + 1,
                )
            )

    metrics = f"{scanned} 个生产 .ts(x) / 违规 {len(findings)}"
    if findings:
        return GuardResult.violated(scanned, findings, metrics=metrics)
    return GuardResult.passed(scanned, metrics=metrics)
