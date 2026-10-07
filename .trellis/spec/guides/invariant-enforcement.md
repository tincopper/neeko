# 不变量强制层级（Invariant Enforcement）

> **目的**：让「不变量必须有机」这条规则本身成为机制。凡是被称为「硬指标 / 红线 / 不变量」
> 的东西，都不允许停留在文档或 AI 复审层而无人知晓——要么有可解析的强制落点，要么显式登记
> 为可见债务。

---

## 第一性原理

约束的价值 = 违反成本 × 违反概率。约束的**存储位置**必须与它的**强制层级**一致；存错层 = 约束失效。

一条约束可能待在这些层（从强到弱）：

| 层 | 含义 | 例子 |
| --- | --- | --- |
| `type` | 编译期：非法状态**写不出来** | `RepoRef` 的 `Eq/Hash` 由 `key()` 定义 |
| `structure` | 模块 / 所有权：装配点唯一，**绕不过** | `WatcherEventSink` 端口 + 组合根装配 |
| `guard` | 确定性静态判据（CI 可复现） | `tools/guards/checks/*` |
| `lint` | 既有 lint 规则 | `.eslintrc.cjs` 的某条规则 |
| `test` | 行为测试（含护栏自测、golden） | `cargo test` / `vitest` |
| `prose` | 无法机械化：文档 + AI 复审 | 必须写明理由，且**每次运行可见** |

**规则**：被称作「硬指标」的东西不得停在 `test` / `prose` 之下；确实无法机械化的，必须登记为
`prose` 并写明理由与兜底——**可见债务**，而非**沉默债务**。

> 三条历史延期项（服务层依赖 `AppHandle`、`statuses` 绕过 selector、组件越 300 行）正是
> 「约束存错层」的实例：分别该在 `structure` / `structure` / `guard`，却落在了 `prose`。

---

## 机读台账

唯一事实源：`tools/guards/ledger/invariants.json`。

```jsonc
{
  "tiers": { "type": "…", "structure": "…", "guard": "…", "lint": "…", "test": "…", "prose": "…" },
  "invariants": [
    {
      "id": "repo-unit-key-single-source",
      "title": "仓库单元身份只能由 RepoRef / repoKeyOf 产出",
      "tier": "guard",
      "enforcement": [
        { "kind": "guard", "ref": "check_repo_unit_identity" },
        { "kind": "test", "ref": "tools/guards/tests/test_check_repo_unit_identity.py" }
      ],
      "red_line": 12
    }
  ]
}
```

字段：

- `id` / `title`：非空，`id` 全局唯一。
- `tier`：六档之一。
- `enforcement`：非空数组，落点是**指针**（不复制规则正文 —— 正文仍单一事实源在各自 spec）：
  - `guard` → `tools/guards/checks/{ref}.py` 必须存在；
  - `test` → `ref` 路径必须存在；
  - `lint` → `ref` 必须出现在 `.eslintrc.cjs`；
  - `type` / `structure` → `ref` 路径必须存在且该条必须带 `note`（说明机制）；
  - `prose` → 必须带 `reason`（并会被打印）。
- `red_line`：可空；可为单个编号或编号数组；非空时每个编号都必须存在于 `agents_md_routing.json` 的 `signatures`。

门禁：`check_invariant_enforcement`（`pnpm guards run` / `pnpm lint` 已含）。

---

## 新增一条不变量

1. 判定它的**强制层级**（上表从强到弱）：能落 `type` / `structure` 就不要落 `guard`，能落
   `guard` 就不要落 `prose`。
2. 实现该层的机制（类型 / 端口 / guard / lint / test）。
3. 在 `ledger/invariants.json` 追加一条记录，填 `id` / `title` / `tier` / `enforcement` / `red_line`。
4. 跑 `python3 tools/guards/run.py run`：落点解析失败、缺 `note`/`reason`、重复 `id`、红线引用
   不存在，都会直接变红。

---

## 与 `check_agents_md_size` 的分工

| 护栏 | 保证 |
| --- | --- |
| `check_agents_md_size` | 红线**正文**在恰好一处、索引表落点声明与正文一致、体积预算 |
| `check_invariant_enforcement` | 每条不变量**有可解析的强制落点**；`prose` 债务可见；guard → 红线引用完整 |

前者管「规则写在哪」，后者管「规则靠什么强制」。两者都以机读台账为单一事实源。
