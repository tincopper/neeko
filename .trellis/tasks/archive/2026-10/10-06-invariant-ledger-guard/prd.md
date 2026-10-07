# T1：不变量台账 + 一致性门禁（元机制）

## Goal

把「不变量必须有机」这条规则本身变成机制：新增 `tools/guards/ledger/invariants.json` 机读台账，
新增 `tools/guards/checks/check_invariant_enforcement.py` 门禁，并补齐 guard → 红线的**引用完整性**。

## Requirements

- **台账格式**：每条形如
  ```json
  {
    "id": "service-no-delivery-dependency",
    "title": "服务层不得依赖交付适配器（tauri::AppHandle）",
    "tier": "structure",
    "enforcement": [
      {"kind": "guard", "ref": "check_service_no_delivery_dep"},
      {"kind": "test", "ref": "tools/guards/tests/test_check_service_no_delivery_dep.py"}
    ],
    "red_line": null,
    "note": null,
    "reason": null
  }
  ```
- **强制层级（tier）** 六档固定：`type` / `structure` / `guard` / `lint` / `test` / `prose`。
- **落点解析**（逐条，命中即违规）：
  - `guard` → `tools/guards/checks/{ref}.py` 必须存在；
  - `test` → `ref` 路径必须存在；
  - `lint` → `ref` 规则名必须出现在 `.eslintrc.cjs`；
  - `type` / `structure` → `ref` 路径必须存在且该条必须带 `note`；
  - `prose` → 必须带 `reason`，并在运行输出里作为 note **每次打印**（可见债务）。
- **每条不变量至少一个落点**；`id` 全局唯一；`tier` 必须是六档之一。
- **红线引用完整性**：台账 `red_line` 字段（若给出）与**每个 guard 的 `red_lines=(...)`** 中的编号
  都必须存在于 `ledger/agents_md_routing.json` 的 `signatures` 里。
- 门禁必须带自测（框架强制），且自测含「坏例必红、好例必绿、空转不允许」。

## Acceptance Criteria

- [ ] `tools/guards/ledger/invariants.json` 存在，且通过 `load_ledger("invariants", required_keys=("tiers","invariants"))` 校验。
- [ ] `check_invariant_enforcement` 注册成功（`pnpm guards list` 可见），`ledger=invariants`、`docs` 指向存在的文档。
- [ ] 坏例：落点指向不存在的 guard/test/lint/路径 → VIOLATION；缺 `note`/`reason` → VIOLATION；重复 id → VIOLATION。
- [ ] 好例：合法台账 + 合法红线引用 → PASS；`scanned > 0`。
- [ ] 坏例：guard 声明了 `red_lines=(99,)` → VIOLATION（引用完整性）。
- [ ] 台账先登记**已存在机制**的 4~6 条真实不变量（自证机制可用），含至少 1 条 `prose` 可见债务。
- [ ] `python3 tools/guards/run.py run`（含护栏自测）全绿。
- [ ] `pnpm lint` 全绿。

## Non-goals

- 不要求覆盖全部 15 条红线（只做引用完整性 + 已登记条目解析）。
- 不改 guard 框架核心（`core/**`）——复用现有 `Context` / `GuardResult` / `load_ledger`。

## 前置

- 无。可与 T2 并行（T2 只往台账追加条目）。

## Notes

- `docs` 指针指向新增 `.trellis/spec/guides/invariant-enforcement.md`（本任务落档层级阶梯与判据）。
