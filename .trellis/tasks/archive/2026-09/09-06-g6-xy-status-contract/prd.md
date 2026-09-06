# G6 XY 状态码契约：staged/unstaged/conflicted 真实分组

> 落地 `.workbuddy/artifacts/git-changes-redesign-plan.md` §3.2 数据契约。
> 承接 G1–G5（已归档）。这是 G 路线最后一个影响用户可见行为的缺口。

## Goal

`FileChange` 携带 porcelain 的 X（staged）/ Y（unstaged）状态字符与 `renamed_from`；
ChangesList 从「Changes + Unversioned 两组占位」升级为
**Staged Changes / Changes / Unversioned / Merge Conflicts 四组真实语义**
（同一文件允许同时出现在 staged 与 unstaged 两个组，VSCode 同款）；
gitFileDecoration 的 staged 桶转真；rename 行显示 `old → new`。

## Background

当前 `parse_status_line` 已解析 XY 字节但丢弃，只输出单一 status；
ChangesList 的 tracked 组无法区分已暂存与未暂存（`git add` 后 UI 无变化语义）；
gitFileDecoration 的 staged 桶恒 0（头注释自证「临时语义」）；冲突文件被映射为
Modified，无冲突分组。

## Requirements

### R1: Rust 契约字段（common/types.rs FileChange）

- `index_status: Option<char>`（X）/ `worktree_status: Option<char>`（Y）/
  `renamed_from: Option<String>`，均 `#[serde(default)]` + skip_serializing_if none
- 兼容：缺失字段的老 payload 反序列化不炸；单 `status` 枚举保留（消费方渐进迁移）

### R2: 三条计算路径产出 XY

- CLI 解析（parse_status_line）：X = bytes[0]、Y = bytes[1]、
  `renamed_from` = rename 行 `old -> new` 的 old
- libgit2 映射（local/status.rs）：INDEX_* → X（A/M/D/R/T）、WT_* → Y
  （WT_NEW → '?'）、CONFLICTED → 'U'/'U'；单 `status` 派生逻辑不变
- remote shell 路径：复用 parse_status_line 自动获得（验证即可）

### R3: ChangesList 四组真实分组（纯派生，无新状态）

```
staged      = index_status 存在且 ∉ {' ', '?'}
unstaged    = worktree_status 存在且 ∉ {' ', '?'} 且非 unversioned
unversioned = X=='?' && Y=='?'（缺 XY 时回退 status==='Untracked'）
conflicted  = X=='U' || Y=='U' || (X=='A'&&Y=='A') || (X=='D'&&Y=='D')
```

- 组名对齐 VSCode：Staged Changes / Changes / Unversioned / Merge Conflicts
- 同一条目可同时进 staged 与 unstaged（XY 双非空）
- rename 条目行内显示 `old → new`（renamed_from 存在时）
- 既有 filter（状态筛选）与选择/勾选行为保持工作
- 缺 XY 的防御回退：全部归入 unstaged（现行为）

### R4: gitFileDecoration staged 桶转真

- `fileChangeToSummary`：X ∈ {A/M/D/R/T} → staged 桶计数；Y ∉ {' ','?'} → unstaged 桶；
  X=Y='?' → untracked 桶；U 类 → conflict 桶
- 缺 XY 回退现有单 status 映射（realPayload 测试 fixture 无 XY，必须保持绿）

## Non-Goals

- ahead/behind / computed_at 入快照（独立小项，暂缓）
- Conflict 解析流程（merge 向导等）——本任务只做「冲突可见」
- 文件树装饰视觉变更（staged 桶转真后 dominant 优先级已兼容，不改展示规则）

## Acceptance Criteria

- [ ] parser 单测：`M `/` M`/`MM`/`??`/`R  old -> new`/`UU`/`D ` 等 XY 提取正确
- [ ] libgit2 映射单测：index-only / wt-only / both / conflict 各产出正确 XY
- [ ] ChangesList 单测：四组分组 + 双组共存 + rename 显示 + 缺 XY 回退
- [ ] gitFileDecoration：staged 桶计数 + 既有测试全绿（fixture 无 XY 回退路径）
- [ ] 全量回归绿：cargo test / pnpm test:run / lint / type-check
