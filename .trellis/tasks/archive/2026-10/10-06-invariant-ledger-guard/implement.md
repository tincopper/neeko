# T1 Implement：不变量台账 + 一致性门禁

## Step 0 — 前置阅读

- `CONTRIBUTING.md` → 「Adding a guard」（GUARD / check / 自测契约）
- `tools/guards/core/contract.py`（`Context` / `Guard` / `GuardResult`）
- `tools/guards/core/ledger.py`（`load_ledger` 的非空约束）
- `tools/guards/checks/check_agents_md_size.py`（机读台账 + 一致性判据的范式）
- `tools/guards/tests/support.py`（`make_repo` / `context` / `temp_repo`）

## Step 1 — 文档（先落机制说明）

- [ ] 1.1 新增 `.trellis/spec/guides/invariant-enforcement.md`：层级阶梯 + 台账字段 + 新增步骤 + 与 `check_agents_md_size` 的分工。

## Step 2 — 台账数据

- [ ] 2.1 新增 `tools/guards/ledger/invariants.json`：`tiers`（六档）+ `invariants`（design §5 的 7 条；`guard`/`test` 落点用**真实文件 stem 与路径**）。
- [ ] 2.2 复核每条 `red_line` 与 `signatures` 一致；guard 落点 stem 与 `checks/` 文件名逐字一致。

## Step 3 — 门禁（红先）

- [ ] 3.1 先写 `tools/guards/tests/test_check_invariant_enforcement.py`（design §7 全部用例），确认失败。
- [ ] 3.2 实现 `tools/guards/checks/check_invariant_enforcement.py`：`GUARD`（`ledger="invariants"`、`docs=".trellis/spec/guides/invariant-enforcement.md"`、`red_lines=()`）+ `check(ctx)`。
- [ ] 3.3 `validate_invariants` + `validate_guard_red_line_refs` 两个纯函数（便于单测直接调用）。
- [ ] 3.4 `load_ledger`/`.eslintrc.cjs` 缺失 → `GuardResult.broken`。

## Step 4 — 验证

- [ ] 4.1 `python3 tools/guards/run.py run`（含护栏自测）全绿。
- [ ] 4.2 `pnpm guards list invariant` 能列出新 guard 与台账。
- [ ] 4.3 临时把一条落点改成不存在的 guard → 变红；改回 → 绿（留痕写进 implement）。
- [ ] 4.4 `pnpm lint`（静态全量，含护栏）exit 0。

## Step 5 — spec 同步

- [ ] 5.1 `CONTRIBUTING.md`「Adding a guard」补一句：新增领域不变量须在 `ledger/invariants.json` 登记（指针式）。

## 交付状态

- [ ] 全部勾选后 `task.py finish` 并归档 T1。

---

## 实测留痕（2026-10-06）

- **Step 3 先红后绿**：先写 `tests/test_check_invariant_enforcement.py`（19 用例），模块不存在 → `ImportError`（红）；
  实现 `checks/check_invariant_enforcement.py` 后 19/19 绿。
- **Step 4.1**：`python3 tools/guards/run.py run` → 护栏自测 **243 用例 OK**，12 条护栏全通过，
  新增行 `check_invariant_enforcement scanned=20  7 条不变量 / 13 个 guard 文件（prose 1 条），0 处违规`。
- **Step 4.3 坏例必红**：把台账首条 `enforcement[0].ref` 改成 `check_does_not_exist`，直接调 `check()` →
  `verdict: VIOLATION`，message = `repo-unit-key-single-source: guard 落点不存在 tools/guards/checks/check_does_not_exist.py`；
  回滚后 `verdict: PASS`。（注：该坏例也会让「真台账必须自洽」的自测变红，与 `check_agents_md_size` 同款约定。）
- **Step 4.4**：`pnpm lint` exit 0（eslint 0 error，含 1 条既有 warning）。
- **Step 5.1**：`CONTRIBUTING.md` 增「Adding an invariant」小节（台账字段 + 解析规则 + prose 可见债务）。
- **Step 1.1**：新增 `.trellis/spec/guides/invariant-enforcement.md` 并挂进 `guides/index.md`。
