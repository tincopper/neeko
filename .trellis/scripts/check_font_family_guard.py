#!/usr/bin/env python3
"""
Font-family guard: 禁止在 src/styles 下新增裸 font-family 硬编码（非 var 引用）。

豁免：
- src/styles/nerd-font.css（@font-face 定义，必须用 font-family）
- src/styles/jetbrains-mono.css（打包等宽字体 @font-face 定义，必须用 font-family）
- 值为 var(--*) 或 inherit 的合法角色引用

检查范围：src/styles/**/*.css（豁免上述）
匹配：  font-family: <非 var/non-inherit>
失败时 exit 1，并打印违规文件与行号
"""
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STYLES_DIR = ROOT / "src" / "styles"
EXEMPT = {"nerd-font.css", "jetbrains-mono.css"}

# font-family: 之后到 ; 之间
RE_FONT_FAMILY = re.compile(r"font-family\s*:\s*([^;{}]+);", re.IGNORECASE)

def is_allowed_value(val: str) -> bool:
    v = val.strip().lower()
    # 允许 var(--*) / inherit / initial / unset （含 !important 后缀）
    if "var(--" in v:
        return True
    # 去掉 !important 等后缀后判断关键字
    core = v.replace("!important", "").strip()
    if core in ("inherit", "initial", "unset"):
        return True
    # 允许 inherit 作为独立 token（如 "inherit !important" 已处理）
    if "inherit" in v:
        return True
    return False

def main() -> int:
    if not STYLES_DIR.exists():
        print(f"[font-guard] styles dir not found: {STYLES_DIR}", file=sys.stderr)
        return 0

    violations: list[str] = []
    for css_file in STYLES_DIR.rglob("*.css"):
        if css_file.name in EXEMPT:
            continue
        text = css_file.read_text(encoding="utf-8", errors="ignore")
        for idx, line in enumerate(text.splitlines(), start=1):
            for m in RE_FONT_FAMILY.finditer(line):
                raw_val = m.group(1)
                # 去除注释尾部？
                raw_val = raw_val.split("/*")[0].strip()
                if not is_allowed_value(raw_val):
                    rel = css_file.relative_to(ROOT)
                    violations.append(f"{rel}:{idx}: font-family: {raw_val.strip()}  (use var(--font-mono) / var(--font-ui) / inherit)")

    if violations:
        print("[font-guard] 裸 font-family 硬编码违规 (仅 nerd-font.css 允许，消费方请用 var(--font-mono)/var(--font-ui)):", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return 1

    print("[font-guard] ok — no bare font-family")
    return 0

if __name__ == "__main__":
    sys.exit(main())
