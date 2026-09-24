#!/usr/bin/env bash
# Step 2 端到端手测驱动（AC1/AC2/AC3/AC4/AC7 现场观察 + 日志取证）
#
# 用法：
#   bash step2-manual.sh                 # 交互模式：每步停下等你在面板上确认
#   bash step2-manual.sh --no-pause      # 无人值守：只跑操作 + 汇总日志证据
#   bash step2-manual.sh [--no-pause] <repo>   # 指定被测仓库（默认 neeko 本仓）
#
# 前置：Neeko 已 `pnpm tauri dev` 运行，且面板当前显示的就是 <repo> 这个项目，
#       Changes 面板的 Unversioned 分组可见。
#
# 说明：本脚本只操作自己创建的目录（<repo>/tmp-untracked-e2e），结束时会删除它。
set -uo pipefail

PAUSE=1
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-pause) PAUSE=0 ;;
    *) ARGS+=("$arg") ;;
  esac
done
REPO="${ARGS[0]:-/Users/tomgs/RustroverProjects/neeko}"
TEST_DIR="$REPO/tmp-untracked-e2e"
LOG="$HOME/.neeko/neeko.log"

case "${LC_ALL:-${LC_CTYPE:-${LANG:-C}}}" in
  *.[uU][tT][fF]-8|*.[uU][tT][fF]8) ;;
  *) export LC_ALL='' LC_CTYPE=en_US.UTF-8 ;;
esac

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
expect() { printf '   期望看到：%s\n' "$1"; }
hold() {
  if [ "$PAUSE" = "1" ]; then
    printf '   ↳ 观察完后按回车继续…'
    read -r _
  else
    sleep "${1:-2}"
  fi
}

if [ ! -d "$REPO/.git" ]; then
  echo "!! $REPO 不是 git 仓库" >&2
  exit 1
fi

START_TS=$(date '+%Y-%m-%d %H:%M:%S')
printf '被测仓库：%s\n日志：%s\n起始时间：%s\n' "$REPO" "$LOG" "$START_TS"

step "0. 清场"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
printf '  git status 真值（应只有一条折叠目录条目）：\n'
git -C "$REPO" status --porcelain -- tmp-untracked-e2e

step "1. 目录内建 a.txt → 展开应显示 a.txt（首次展开）"
printf 'x\n' > "$TEST_DIR/a.txt"
printf '  git status --porcelain -uall（真值）：\n'
git -C "$REPO" status --porcelain -uall -- tmp-untracked-e2e | sed 's/^/    /'
expect "Unversioned 分组出现 tmp-untracked-e2e 条目，并展开出 tmp-untracked-e2e/a.txt"
hold 3

step "2. 不碰面板，目录内新建 b.txt → 应自动出现（AC1 核心）"
printf 'x\n' > "$TEST_DIR/b.txt"
printf '  git status --porcelain -uall（真值）：\n'
git -C "$REPO" status --porcelain -uall -- tmp-untracked-e2e | sed 's/^/    /'
expect "b.txt 在 ~2s 内自动出现（无需点刷新、无需折叠重开）"
hold 4

step "3. 删除 a.txt → 应从列表消失（AC2）"
rm -f "$TEST_DIR/a.txt"
printf '  git status --porcelain -uall（真值）：\n'
git -C "$REPO" status --porcelain -uall -- tmp-untracked-e2e | sed 's/^/    /'
expect "a.txt 自动消失，仅剩 b.txt"
hold 4

step "4. 风暴：连续新建 10 个文件（AC7 的现场观感）"
for i in $(seq 1 10); do printf 'x\n' > "$TEST_DIR/f$i.txt"; done
printf '  git status --porcelain -uall（真值，应 11 个文件）：\n'
git -C "$REPO" status --porcelain -uall -- tmp-untracked-e2e | wc -l
expect "列表最终与真值一致（11 条子行）；不卡顿、不闪烁反复；AC7 的调用次数上界以自动化用例为准"
hold 4

step "5. 手动刷新一致性（AC3）"
expect "点面板刷新按钮、再 Alt+Tab 切走切回：列表与上面 git status -uall 真值一致"
hold 5

step "6. 清场（删除本脚本创建的目录）"
rm -rf "$TEST_DIR"
printf '  剩余（应为空）：\n'
git -C "$REPO" status --porcelain -- tmp-untracked-e2e | sed 's/^/    /'
hold 2

step "7. 日志取证（watcher → debounce → file-changed；AC7 批次合并）"
awk -v start="$START_TS" '
  /Emitting file-changed/ {
    ts = substr($0, 2, 19)
    if (ts >= start) print
  }
' "$LOG" | sed 's/^/  /'
printf '\n  本窗口内 file-changed 批次数与每次路径数（供 D1 记录）：\n'
awk -v start="$START_TS" '
  /Emitting file-changed/ {
    ts = substr($0, 2, 19)
    if (ts >= start) {
      n++
      match($0, /for [0-9]+ paths/)
      paths[substr($0, RSTART + 4, RLENGTH - 10)]++
    }
  }
  END {
    printf "    批次数=%d\n", n
    for (p in paths) printf "    %s paths × %d 次\n", p, paths[p]
  }
' "$LOG"

printf '\n完成。请把上面每一步的「是否与期望一致」结果记入 implement.md 的 D1。\n'
