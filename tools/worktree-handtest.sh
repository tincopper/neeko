#!/usr/bin/env bash
# worktree 主链路手测夹具（任务 09-26-worktree-repo-identity · Step 0.2 / 7.2）。
#
# 存在理由：这个仓库的 worktree 缺陷全部只在「真 app + 真 linked worktree」上才看得见，
# 而手测最容易翻车的两处是（1）手测实例与已安装的 Neeko.app 共用 ~/.neeko（互相改写会话状态，
# 日志也混在一起），（2）手测路径不是 canonical 形态却以为自己在测符号链接形态。
# 本脚本把夹具建在 /tmp 下的独立 HOME 里，绝不碰你的真实仓库与 ~/.neeko。
#
# 用法：
#   bash tools/worktree-handtest.sh            # 只建夹具并打印启动命令与检查清单
#   bash tools/worktree-handtest.sh --run      # 建夹具并直接起 vite + dev 二进制
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${TMPDIR:-/tmp}/neeko-wt-handtest"
PID="handtest-0001"

[[ -d "$ROOT/src-tauri/target/debug" ]] || {
  echo "缺少 dev 二进制：先在 $ROOT 跑 'cargo build --manifest-path src-tauri/Cargo.toml'" >&2
  exit 1
}

rm -rf "$BASE"
mkdir -p "$BASE/home/.neeko" "$BASE/repo" "$BASE/wt-a" "$BASE/wt-b"

git -C "$BASE/repo" init -q .
echo seed > "$BASE/repo/README.md"
git -C "$BASE/repo" add README.md
git -C "$BASE/repo" -c user.email=t@t -c user.name=T commit -q -m init
# 两个 linked worktree 与主仓同级：嵌在主仓工作树里会让主仓 status 报出未跟踪目录，
# 污染「主仓应当干净」这条判据。
git -C "$BASE/repo" worktree add -q -b feat-a "$BASE/wt-a"
git -C "$BASE/repo" worktree add -q -b feat-b "$BASE/wt-b"
# 每个单元各自的脏改动：串内容时会立刻看出来
echo dirty > "$BASE/wt-a/only-in-a.txt"
echo dirty > "$BASE/wt-b/only-in-b.txt"

# session 刻意写成 /tmp 符号链接形态（macOS 上真身是 /private/tmp）：这是 AC6 的形态，
# 也是实测过会「恢复后被立刻判没、回落主仓」的那一类。
BASE_REAL="$(cd "$BASE" && pwd -P)"
python3 - "$BASE" "$BASE_REAL" "$PID" <<'PY'
import json, pathlib, sys
base, real, pid = sys.argv[1:4]
pathlib.Path(base, 'home/.neeko/sessions.json').write_text(json.dumps({
    "projects": [{
        "id": pid, "name": "handtest", "path": f"{base}/repo",
        "environment": {"type": "Local"}, "selected_agents": [], "selected_ide": None,
        "terminal_history": [], "last_status": "Idle", "collapsed": False,
        "avatar_color": "#61afef",
    }],
    "active_project_id": pid, "last_updated": "", "sidebar_width": 300,
    # 激活单元 = wt-a，且用符号链接形态书写
    "worktree_state": {pid: f"{base}/wt-a"},
}, indent=1))
print(f"session 激活单元（符号链接形态）: {base}/wt-a")
print(f"后端应归一为: {real}/wt-a")
PY

cat <<EOT

夹具就绪： $BASE
  repo(干净)  wt-a(README.md 无改动 + only-in-a.txt 未跟踪)  wt-b(同理)

启动（另开一个终端，手测期间请先退出 /Applications/Neeko.app，避免共用状态目录）：
  cd "$ROOT" && pnpm dev &
  HOME="$BASE/home" "$ROOT/src-tauri/target/debug/neeko"
  # 手测实例的日志在 $BASE/home/.neeko/neeko.log，与已安装 app 的 ~/.neeko 完全分离

真值口径（面板显示应当与此逐条一致，不多不少）：
  git -C "$BASE/wt-a" status --porcelain      # → ?? only-in-a.txt
  git -C "$BASE/wt-b" status --porcelain
  git -C "$BASE/repo" status --porcelain      # → 空

待人工确认的 4 项（其余 AC 已自动化/实测，见 .trellis/tasks/09-26-worktree-repo-identity/prd.md）：
  AC4  在 wt-a 里新建/删除文件 → 不点任何刷新，Changes 列表跟着变。
       （编辑→推送的 P95 已机器出数：worktree 57.1ms / 主仓 56.8ms，
        cargo test --lib -- --ignored --nocapture edit_to_push_latency；这里只核「列表真的变了」）
  AC7 首屏：启动后第一个画面就应是 wt-a 的内容（不是主仓、也不是 No changes 闪一下）
  AC12 主仓 ↔ wt-a ↔ wt-b 来回切 + 失焦聚焦 10 次：不得出现「串到别的单元的条目」或列表变空需手动刷新
  AC13 WSL / SSH：需要真实远端环境，macOS 本机测不了（脚本不覆盖）

补一条专项（第八轮修掉的缺陷形态，日常最容易漏测）：
  切项目 A → B → A：回到 A 时不点任何刷新，Changes 列表必须是 A 的**当前**内容。
  判据是真值：先 `touch <A 工作树>/probe.txt`，切走再切回，面板要出现 probe.txt。
  （曾经的 bug：注册表从槽位取号，而释放会连槽位一起删 ⇒ 切回后第一份快照永远是 v1，
   被前端 `version <= prev` 判成旧的丢掉，界面停在离开时的旧数据。
   红→绿见 `lifecycle_tests::remount_continues_the_unit_version_sequence`。）
EOT

if [[ "${1:-}" == "--run" ]]; then
  cd "$ROOT"
  pnpm dev &
  VITE=$!
  sleep 4
  HOME="$BASE/home" "$ROOT/src-tauri/target/debug/neeko"
  kill "$VITE" 2>/dev/null || true
fi
