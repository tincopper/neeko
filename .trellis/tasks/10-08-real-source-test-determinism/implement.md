# implement — 真实源测试的确定性契约

> 顺序按「先恢复绿、再固正确默认、后上机器强制、最后登记收敛」排列。
> 依赖：R4 的域判定依赖 R1/R3 之后的文件形态；R5 依赖 R4。故顺序 R1 → R3 → R2 → R4 → R5。
> 每步完成即跑该步验证命令，不等最后一起跑。

## 0. 前置

- [ ] 读 `.trellis/spec/unit-test/index.md`、`.trellis/spec/unit-test/backend-testing.md`、
      `.trellis/spec/guides/invariant-enforcement.md`。
- [ ] 读护栏先例 `tools/guards/checks/check_worktree_byte_assertions.py` +
      `tools/guards/tests/test_check_worktree_byte_assertions.py` + `tools/guards/tests/support.py`。
- [ ] 确认 `task.py current` 指向本任务。

## 1. R1 — 遏制（恢复 main 绿）

- [ ] 编辑 `src-tauri/src/common/file/watcher/git_meta/tests/watcher.rs`：
  - 删 `130/131`（index 测试的 `head_changed` / `refs_changed` 零断言）；
  - 删 `206/207`（refs 测试的 `_index_changed` / `_head_changed` 零断言）；
  - 保留各测试正向可达断言；文件头「确定性约定」注释改为指向新 spec 的指针。
- [ ] **不改** `classify.rs` / `paths.rs` / `watcher.rs`（生产）。
- 验证：`cd src-tauri && cargo test git_meta`
- 回滚点：纯删断言，`git checkout -- <file>` 即回滚。

## 2. R3 — 观察探针

- [ ] 新增 `src-tauri/src/common/file/watcher/probe.rs`（`#[cfg(test)]` + `pub(crate)`），
      实现 `CallbackProbe`（`new` / `callback` / `wait_reached`，**不暴露计数**）。
- [ ] `src-tauri/src/common/file/watcher/mod.rs` 加 `#[cfg(test)] mod probe;`。
- [ ] 重构 `git_meta/tests/watcher.rs` 用 `CallbackProbe` 替换 `Arc<AtomicUsize>` + 本地
      `wait_until`；删除相应 import。
- [ ] 确认 `spawn_watcher_for` 的失败注入用例（`create_git_meta_watcher_with`）不受影响。
- 验证：`cd src-tauri && cargo test git_meta` 且 `cargo clippy -- -D warnings`（或 `pnpm lint:rust`）。

## 3. R2 — 语义（spec 正文 + 接线）

- [ ] 新增 `.trellis/spec/unit-test/real-source-determinism.md`：判定表、正/反例、
      本次事故锚点、`CallbackProbe` 用法、guard id、**收敛规则**（design §5）。
- [ ] `.trellis/spec/unit-test/index.md` 指导原则第 2 条补对偶条款 + 链接。
- [ ] `.trellis/spec/unit-test/backend-testing.md` §常见错误 增「错误 #6：真实源绝对零断言」+ 链接。
- [ ] 新 spec 落盘后，把它追加进 `check.jsonl`（`task.py add-context ... check ...`），让 check 子代理能读到唯一正文。
- 验证：人工核对 `trellis-before-dev` 加载路径（index.md → 新 spec）可达；无死链；`task.py validate` 通过。

## 4. R4 — 域级 guard

- [ ] 新增 `tools/guards/checks/check_nondeterministic_event_assertions.py`：
      `GUARD`（id=文件名；scopes=两份 Rust glob；docs=新 spec；red_lines=()）+ `check(ctx)`，
      按 design §4 的域判定 + 判据实现；返回 `GuardResult`（`scanned` 必填、`Finding.file/line`）。
- [ ] 新增 `tools/guards/tests/test_check_nondeterministic_event_assertions.py`：
      design §4 自测矩阵 6 条（正例 / 确定性反例 / 差分反例 / 正向反例 / 空转扫描数 / 逃生舱）。
- 验证：`python3 tools/guards/run.py run`（框架先跑全部护栏单测；保证 selftest 通过）。
- 关键反例必须在测试里逐字覆盖：`assert_eq!(calls_b.load(Ordering::SeqCst), 0)` 在
  **无域标记**文件 → PASS；`assert_eq!(sink.count(X), baseline)` 在域内 → PASS。

## 5. R5 — 台账登记

- [ ] `tools/guards/ledger/invariants.json` 追加 `nondeterministic-event-assertion-ban`
      （tier=guard；enforcement = guard + test；red_line=null；见 design §5）。
- 验证：`python3 tools/guards/run.py run`（含 `check_invariant_enforcement`）。
- 决策点：若用户改判新增红线，则需同步 `tools/guards/ledger/agents_md_routing.json`
  signatures + 根 `AGENTS.md` 表格行 + `src-tauri/AGENTS.md` 正文，并跑 `check_agents_md_size`；
  默认不做（design §9）。

## 6. 收尾验证（全量）

- [ ] `pnpm lint`（lint_fe + lint_rust + 进程内护栏）
- [ ] `pnpm test:rust`（含 `cargo test git_meta`）
- [ ] `python3 tools/guards/run.py run`（护栏全量 + 自测）
- [ ] `python3 tools/guards/run.py list` 目视新 guard 的 stage / scopes 正常
- [ ] Windows 侧由 CI `backend-test (windows-latest)` 复验 AC1（本机不可验）
- [ ] 更新 spec / 记 session（Phase 3.3–3.4）

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 删断言时误删正向覆盖 | 每个测试保留 1 条正向可达断言，AC1 明确 |
| 探针重构改变重试写语义 | `wait_reached(timeout, poke)` 保留「反复 poke」语义 |
| guard 误伤确定性替身 | 自测矩阵 2/3/4 逐字钉住 `conversation` / `lifecycle` / `sink` 反例 |
| 域判定启发式漏掉未来源 | 逃生舱注解 + 收敛规则（R5）要求提升而非新增特例 |
| 根 AGENTS.md 体积超限 | 默认不加红线；如加，先跑 `check_agents_md_size` 量余量 |

## Review Gates

- [ ] guard 自测含**正例 + 反例 + 空转**三类（缺一即视为没护栏）。
- [ ] spec 正文只有一份（新 spec）；`index.md` / `backend-testing.md` 只放指针，不复述判据。
- [ ] 生产代码零改动（`git diff --stat` 中 `src-tauri/src` 只有 `#[cfg(test)]` 与 tests 目录）。
