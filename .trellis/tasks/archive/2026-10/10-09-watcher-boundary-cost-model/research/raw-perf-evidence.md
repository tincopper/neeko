# 研究：`pnpm check` 慢的原始测量证据

> 目的：为 PRD 的「背景」提供可复现数字。测量环境：本机 macOS / RustRover 运行中。

## 1. `pnpm check`（check4.log）门禁耗时

```
test_rust   424,456ms / 900,000ms   ← 主项
lint_fe      70,499ms / 180,000ms   (eslint --cache + tsc)
test_fe      54,520ms / 300,000ms   (vitest run)
lint_rust     1,361ms
test_host       985ms
17 条进程内护栏 + 398 条框架自测 ≈ 4.5s（check_workspace_identity 998ms）
23 条护栏：23 通过 / 0 违规 / 0 护栏失效 / 0 跳过
```

- 门禁合计 **≈ 9.3 min**；外层报告 **`Took 24m 28s`** → 约 **15 min 未计入任何门禁**
  （可能来自孤儿进程持有 stdout/PTY，或外层计时口径；需后续钉时间戳确认）。
- 框架自身开销可忽略：`run.py --only lint_rust` → `real 5.41s`（自测 ~2.6s + 门禁 2.7s）。

## 2. `cargo test` 直接复跑

```
real 689.38s   user 6.91s   sys 11.36s        ← 97% 阻塞，CPU 几乎为 0
libtest 自报：1445 passed / 4 ignored, finished in 315.20s
tests/unit.rs：104 passed, finished in 0.49s
Doc-tests neeko_lib：0 passed, 2 ignored, 0.00s
```

- `cargo test --no-run`（暖）：**0.85s** → 慢不在编译，在**测试执行/阻塞**。
- libtest 打出 **13 条 `has been running for over 60 seconds`**：
  - 12 条在 `common::file::watcher::manager::lifecycle_tests`
    （`activate_style_release_except_*`、`linked_worktree_edit_*`、`poke_*`、`remount_*`、
    `twenty_unit_switches_*`、`two_units_*`、`unwatch_*`、`writes_in_unmounted_*` 等）；
  - 1 条在 `git::services::status::tests::activate_releases_the_previous_unit`。
- 这些测试的常量：`WATCH_SETTLE=300ms` / `FIRST_EVENT_TIMEOUT=8s` / `QUIET_WINDOW=2000ms`，
  且用真实 FSEvents + 真实 git 子进程 → 事件投递被拖慢即退化为多次 8s 超时。
- `real 689s` vs libtest `315s` 的差值（~374s）：进程在测试跑完后**长期不退出**（`sample` 显示
  主线程 0% CPU 卡在 `run_tests_console` 的 CompletedTest channel）。

## 3. `src-tauri/target/` 体积与条目数

```
du -sh src-tauri/target                    353G
  debug/deps                               300G   ← 单目录 883,175 个条目
  debug/incremental                         33G   （25153 个文件）
  release                                  7.3G
  llvm-cov-target                          7.5G
  debug/.fingerprint                       118M

target/debug/deps 顶层：
  *.o                                      870,181 个
    其中 neeko_lib*.rcgu.o                 769,482 个   ← 本项目自己的 CGU 目标文件
  rmeta*/full.rmeta 目录                    208 个（各 ~25MB，残留）
  rustc*/ 空临时目录                        215 个（残留）

顶层文件 apparent size 合计 ≈ 791.5GB（du 分配 ≈ 2.8G/批次；du -sh deps = 300G）
单文件：libneeko_lib.a = 844MB / libneeko_lib.rlib = 405MB / 测试可执行文件 92–133MB
```

- `src-tauri/Cargo.toml` **无 `[profile]` 覆盖** → dev 默认 `debug=true`（全量 DWARF）。
- `.o` 采样：`neeko_lib-*.rcgu.o` 约 0.12–1.55MB；mtime 跨 2026-06 ~ 2026-10（多月累积）。

## 4. 系统级放大

```
ps: fseventsd %CPU → 100.8
mdutil -s /          → Indexing enabled
target/ 下被 Spotlight 收录的 object-code 文件数 → 303,405
target/ 无 .metadata_never_index 标记
rust-analyzer（RustRover）在运行，共用同一 target
磁盘：531Gi/926Gi used（60%）
```

## 5. 复现命令

```bash
du -sh src-tauri/target src-tauri/target/debug/deps src-tauri/target/debug/incremental
find src-tauri/target/debug/deps -maxdepth 1 -name '*.o' | wc -l
find src-tauri/target/debug/deps -maxdepth 1 -name 'neeko_lib*rcgu.o' | wc -l
/usr/bin/time -p cargo test --manifest-path src-tauri/Cargo.toml
mdfind -onlyin "$PWD/src-tauri/target" "kMDItemContentType == 'public.object-code'" | wc -l
ps aux | grep -i fseventsd | grep -v grep
```

## 6. 与本任务的关系

- 第 1/2 节的测试阻塞**部分由系统级 FSEvents 压力放大**（watcher 测试依赖真实事件投递）；
- 第 3 节的 `target/` 体量说明**"ignored 子树零监听"直接收益巨大**（88 万条目从监听集合移除）；
- 第 4 节说明**应用侧 watcher 不是唯一成本源**：exclusion 减应用侧回调，卷级 journal/索引需另治
  （`cargo clean` / `[profile]` / `.metadata_never_index`，可另开任务）。
