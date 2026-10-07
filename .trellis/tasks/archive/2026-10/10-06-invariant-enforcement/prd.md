# 不变量强制层级：元机制 + 三条落地

## 背景 / 第一性原理

三条历史延期项（worktree 身份链收尾时记录）不是三个孤立缺陷，而是同一属性的三个症状：

> **不变量被存在了错误的层。** 约束的价值 = 违反成本 × 违反概率；文字层（注释 / spec /
> AI 复审）的违反概率随时间趋近 1。凡是「硬指标」停留在文字层，就必然漂移。

| 延期项 | 性质 | 现在待在哪层 | 该待在哪层 |
| --- | --- | --- | --- |
| `activate()` 自建 `AppHandleSink`（服务层依赖交付适配器） | 结构 | 调用方纪律 | 模块/端口结构 + guard |
| `projectStore.statuses` 有 7 处绕过 selector 直读 | 表示 | 注释（「不得绕过」） | 信息隐藏 + guard |
| 组件 ≤300 行（`ConnectionProjectCard` 曾越线） | 预算 | AI 复审（现 42+17 个文件已越线） | 确定性 lint/guard |

仓库已有把「约定 → 可执行判据」做成框架的基建（`tools/guards/` + `ledger/` + `check_agents_md_size`
的「机读台账 + 一一对应」模式），但**没有任何东西检查「不变量 ↔ 强制机制」的对应关系**：
15 条红线里只有 `{1,3,5,10,11,12,13}` 被 guard 声明，其余靠散落的编译期/测试/复审；也没有东西拦
「某 guard 声明了一条不存在的红线」。

## 目标

1. **元机制**：建立「不变量 → 强制层级 → 落点」的机读台账 + 一致性门禁。使「新增约定只写进
   注释/spec 不配机制」与「机制漏了/坏了」都成为 CI 失败；确实无法机械化的必须显式登记为
   **可见债务**（prose + 理由），而不是沉默债务。
2. **三条落地**：用元机制逼出三条延期项的具体修复，并把它们登记为台账头三条。

## 子任务映射

| 子任务 | 交付 | 独立可验证 |
| --- | --- | --- |
| `10-06-invariant-ledger-guard` | 元机制：`ledger/invariants.json` + `check_invariant_enforcement` + guard `red_lines` 引用完整性 | 护栏自测 + 全量 `pnpm guards run` |
| `10-06-invariant-landing` | 三条落层：依赖方向（端口注入 + services 禁 tauri guard）、status 单一读取口（selector 迁移 + guard）、组件 ≤300 ratchet | `cargo test` / `pnpm test:run` / 四条护栏自测 |

依赖：`landing` 的台账条目需要 `ledger-guard` 的台账格式与门禁先就位（先 T1 后 T2）。

## 跨子任务验收标准

- [ ] `pnpm guards run` 全绿，且 `check_invariant_enforcement` 自测含「坏例必红」用例（非空转）。
- [ ] 台账中每条不变量都有可解析落点；`prose` 条目必须带理由并在运行时打印。
- [ ] 三个延期项各对应台账中一条不变量，且落点为 guard / 测试（不再是注释）。
- [ ] 不新增红线编号；台账通过 `red_line` 字段引用既有红线（引用必须真实存在）。
- [ ] `pnpm check` 全绿。

## Non-goals

- 不要求 15 条红线全部机械化（另有 8 条需先分类）；本任务只保证「已登记的不变量必有机制」
  与「引用完整性」，并把现状缺口暴露成可见项。
- 不引入新的复杂度度量工具（只用既有 guard 框架 + 一个 ratchet 基线）。
- 不重构 zustand 的 state 形状（不做类型级隐藏，见 landing design 的诚实声明）。
- 不做真实 WSL/SSH 现场验证（AC13 遗留，独立于本任务）。

---

## 验收结论（2026-10-06）

- [x] `pnpm guards run` 全绿（14 条护栏 / 263 自测），`check_invariant_enforcement` 自测含「坏例必红」。
- [x] 台账 10 条不变量全部落点可解析；1 条 prose（IPC 2MB）带 reason 且每次运行打印。
- [x] 三个延期项各对应台账一条不变量，落点为 guard / 测试（不再是注释）。
- [x] 未新增红线编号；`red_line` 引用均为既有红线（含 guard `red_lines` 引用完整性校验）。
- [x] `pnpm check` 等价全量门禁绿（lint / test:fe 503 文件 4514 通过 / test:rust / test:host）。

两个子任务均已归档（`10-06-invariant-ledger-guard`、`10-06-invariant-landing`）。
