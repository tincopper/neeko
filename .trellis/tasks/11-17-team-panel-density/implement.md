# 实施计划：团队面板密度优化（A + B）

> 视觉契约：`.trellis/tasks/11-17-team-panel-density/prototype-team-panel-density.html`
> 技术裁决：`design.md`。TDD：每一档先写/改测试 → 确认红 → 实现 → 确认绿。

## 0. 基线（必做，先看红绿再动手）

```bash
cd /Users/tomgs/.neeko/worktrees/feat-team
pnpm vitest run src/features/agent-team --reporter=dot   # 只看这个域的绿基线
cargo test --manifest-path src-tauri/Cargo.toml --no-run  # 不需要；本任务后端零改动，跳过
```

- [x] 记录基线：`src/features/agent-team` 全绿（失败项必须是改动**之前**就红的，写进本文件）。

## 1. utils 层（先做，测试最便宜）

- [x] **1.1** `utils/__tests__/memberChips.test.ts` 增加 `memberRowMeta` 判据（红）：
  - `tier: 'c'` ⇒ `sentinelOnly: true`；`a`/`b` ⇒ `false`
  - `workspace: 'shared'` ⇒ `workspace: null`
  - `workspace: 'read_only'` ⇒ `只读`
  - worktree ⇒ 末段（`feat-auth-ui`）
- [x] **1.2** `utils/memberChips.ts` 实现 `MemberRowMeta` + `memberRowMeta()`；把文件头文档改成
      「抽屉的身份 chip / 行内的 `memberRowMeta`」双口径。
- [x] **1.3** `utils/workspaceLabel.ts` 加 `nonDefaultWorkspaceLabel()`：
      `shared → null`，其余与 `workspaceLabel` 同源（不复制字符串，内部调它）。
- [x] **1.4** 新建 `utils/__tests__/workspaceLabel.test.ts`（若无）：`shared → null` / `只读` / worktree 末段。

验收：`pnpm vitest run src/features/agent-team/utils --reporter=dot`

## 2. 花名册（R3 / R4 / R8 / R9）

- [x] **2.1** 测试先行（`TeamPanel.roster.test.tsx`）：
  - 行内**没有** `qoder` / `CLI · PTY` / `A 档` 这些 chip（它们只在抽屉）
  - 行内**有** `feat-auth-ui`（worktree 末段）、`只读`（read_only 成员）
  - `leaseRemainingSecs === null` ⇒ 行内没有 `无在飞任务`
  - C 档行内是 `⚠ C`（可见文字）+ `role="note"` 仍含「卡住永远不可知」
  - 六态：`运行中` / `空闲 ⚠ 未声明` / `待批准` 仍可见
  - 租约三态：`租约剩 22:54` / `租约已超时` 仍可见（`null` 的第三条已改成「不渲染」）
  - 动作五态与「可见理由」不变（`暂无会话` / `已关闭` / `查看记录` / `恢复会话`）
  - 花名册标题旁**没有** `N 人（含队长）`
- [x] **2.2** 实现 `RosterRow` 单行 + 第二行（workspace · 租约），`TeamRoster` 去掉人数。
- [x] **2.3** 确认既有「点行开抽屉 / 点按钮开终端，两者不合并」的用例仍绿。

验收：`pnpm vitest run src/features/agent-team/components/__tests__/TeamPanel.roster.test.tsx`

## 3. 头部（R1 / R2）

- [x] **3.1** 新增 `components/TeamHeaderMenu.tsx`（`@/ui/DropdownMenu`，照 `SessionRowMenu` 的
      菜单结构与 `pointerDown` 可测性）。菜单项与出现条件见 `design.md` §3.2。
- [x] **3.2** 测试先行：
  - 新 `components/__tests__/TeamHeaderMenu.test.tsx`：
    - 只传 `onRefresh` ⇒ 菜单里只有「刷新快照」
    - `sealed` ⇒ 没有「关闭团队…」
    - `open + resumable` ⇒ 有「恢复团队」，`resuming` 时 disabled
    - `sealed` ⇒ 没有「恢复团队」
    - 点「刷新快照」调用 `onRefresh`；点「关闭团队…」调用 `onRequestClose`；点「改名」调用 `onRename`
  - 改写 `TeamHeader.rename.test.tsx`：入口 = 开菜单 → `menuitem` 「改名」；双击入口保留
  - `TeamPanel.teamList.test.tsx`：团队视图里的 `关闭团队` 改为开菜单取 `menuitem`；
    `返回列表` 保持按 `aria-label` 取（图标按钮）
  - `TeamPanel.roster.test.tsx`：「恢复团队」用例开菜单后点 `menuitem`
- [x] **3.3** 重写 `TeamHeader`：1 行 + 1 行 meta（保留 `data-awaiting` / `aria-label="返回列表"` /
      双击改名 / `sealed` 的「只读快照」文案）。
- [x] **3.4** 断言头部只剩两行：`header` 内直接子元素数量 = 2（防回退）。

验收：`pnpm vitest run src/features/agent-team/components/__tests__/TeamHeaderMenu.test.tsx src/features/agent-team/components/__tests__/TeamHeader.rename.test.tsx`

## 4. 任务板（R5 / R6 / R7 / R10 / R12）

- [x] **4.1** `TaskCardRow` 增加 `showState: boolean` 必填 prop；测试先行：
  - `showState=false` ⇒ 卡片无状态 chip；`true` ⇒ 有
  - `workspace: 'shared'` ⇒ 无 `共享工作区` chip；`worktree …` ⇒ 有
  - 无可见 `t1`（`queryByText('t1')` 为空），但 `aria-label` / `data-task-id` 仍在
  - 无 `依赖 2`
  - `idle+unverified` 且任务非终结 ⇒ `空闲 ⚠ 未声明` 可见；`done` 任务不渲染 owner 状态
- [x] **4.2** 实现 `TaskCardRow`（见 `design.md` §3.7）。
- [x] **4.3** `TeamTaskBoard`：扁平分组 + 空列汇总 + 去内部标题；`showState` 按
      `column.states.length > 1` 计算后传给卡片。
- [x] **4.4** 新测试 `components/__tests__/TeamTaskBoard.test.tsx`：
  - 空列不进 `role="group"`，汇总行里 `[data-column="awaiting_approval"][data-count="0"]` 存在
  - `unplaced`（未知状态）仍 `role="alert"`
  - `tasksTruncated` 仍 `只显示前 200 条`
  - `claimed` 与 `in_progress` 同列时，`claimed` 卡片有 `已认领`
- [x] **4.5** 改写 `TeamPanel.roster.test.tsx` 的 `countOf`：从 `[data-column][data-count]` 读
      （覆盖空列汇总行）。
- [x] **4.6** `TeamView`：任务区头（`任务 N` + 看板/分配图 + 在中间打开 + 折叠）+ 折叠摘要；
      新测试 `components/__tests__/TeamView.boardCollapse.test.tsx`（默认展开 / 折叠只剩摘要 /
      `aria-expanded` 切换）。
- [x] **4.7** `TeamBoardCenterView`：头部补 `N 个任务`（板内部标题移除后的计数来源）。

验收：`pnpm vitest run src/features/agent-team/components --reporter=dot`

## 5. 全量确认（只跑一次）

```bash
pnpm check:quick
```

- [x] 全绿。若 `check:quick` 的覆盖没跑到 `.rs`（本任务无后端改动，可接受）。
- [x] 抽查原型对齐：260 / 280 / 320px 下头部两行、花名册单行、任务板扁平分组；
      对照 `prototype-team-panel-density.html` 的 `优化后`。

## 6. Spec 同步

- [x] `.trellis/spec/frontend/component-guidelines.md`：新增「团队面板密度契约」小节
      （头部两行 / 花名册单行 / 扁平分组 / 空列汇总 / C 档两处可见）。
- [x] `.trellis/spec/backend/team-domain.md`：把「面板 UI 契约」段落里 C 档的描述改成
      「行内 `⚠ C` + 分区说明」（红线 14 的两种承载一起写明）。
- [x] 若 `memberChips` 的文档口径变了，同步 `team-domain.md` 里引用它的段落（grep `memberChips`）。


## 7. 收尾

- [ ] `python3 ./.trellis/scripts/add_session.py --title "team-panel-density: A+B 落地" --commit <hash>`
- [ ] 不主动 commit（等用户）。

## 回滚点

| 阶段 | 回滚方式 |
| --- | --- |
| 1（utils） | 新增函数与测试，`git checkout` 单文件即可 |
| 2（花名册） | 单文件级回滚 `RosterRow.tsx` / `TeamRoster.tsx` |
| 3（头部） | 删 `TeamHeaderMenu.tsx` + 恢复 `TeamHeader.tsx`（三行版）回到 A 档之前 |
| 4（任务板） | `TaskCardRow` 的 `showState` 有默认值需求时改成可选即可逐步启用；`TeamView` 折叠是局部 state，删掉即恢复 |

## 执行记录（2026-11-17，implement agent）

- **基线**：`pnpm vitest run src/features/agent-team` = 39 files / 342 tests 全绿（改动前无红项）。
- **阶段验证**（每个阶段先红后绿，只跑该阶段的文件）：
  - 1 utils：`memberChips.test.ts` + `workspaceLabel.test.ts` → 先 7 红 → 绿（16 files / 135 tests）。
  - 2 花名册：`TeamPanel.roster.test.tsx` → 26 tests 绿。
  - 3 头部：`TeamHeaderMenu.test.tsx` / `TeamHeader.rename.test.tsx` / `TeamHeader.test.tsx` +
    `TeamPanel.teamList.test.tsx` / `TeamPanelWrapper.wiring.test.tsx` → 52 tests 绿。
  - 4 任务板：`TaskCardRow.test.tsx` / `TeamTaskBoard.emptyColumns.test.tsx` /
    `TeamView.boardCollapse.test.tsx` → 32 tests 绿；全域 44 files / 396 tests 绿。
  - 5 门禁：`pnpm check:quick` 15/15 护栏通过（含 lint_fe / component_size / ui_style_tokens）。
- **偏离 design.md 的三处（都有理由）**：
  1. `TeamTaskSection.tsx` 是**新增**文件（design 的文件表里没有）：`TeamView` 加完任务区头后
     344 行，超过 `check_component_size` 的 300 行红线（该文件未登记基线，不会放行）。把
     「任务区头 + 看板/分配图 + 折叠 + 两个导航态」整体抽出，`TeamView` 回到 234 行。
  2. `MemberDetailDrawer` **未改**：R8 说「补 workspace 与租约」，但抽屉的 `memberChips` 已含
     workspace chip，租约已由 `MemberDetailTasks` **逐任务实时**展示（比花名册的成员级快照值
     更准）。再加一行成员级快照租约 = 同一个事实两个数（且会与既有「租约走动」用例撞文案）。
  3. `TeamBoardCenterView` **未改**：其头部本来就有 `N 成员 · N 任务`（板内部标题删掉后计数
     仍有着落），design 的「补任务计数」已成立。
- **design 之外的必要修正（Radix 菜单焦点陷阱）**：`onSelect` 里直接开行内编辑会被菜单的
  `focusin` 抢焦点 / 卸载时焦点归还 → 输入框立刻 blur → 提交（草稿没变）→ 编辑态一闪而过。
  改为 `onSelect` 只记标记、`onCloseAutoFocus` 里 `preventDefault()` 并**这时才**开编辑。
  已写进 `component-guidelines.md`「团队面板密度契约」。
- **`showState` 口径**：按 design 用 `column.states.length > 1`（列级）。副作用：`pending`
  列（`pending`/`proposed` 两态）的卡片也会带「待认领」chip；原型是逐卡判（状态文案 ≠ 列
  标签才出 chip）。若后续觉得这一枚多余，改成逐卡判即可（判据仍在 `taskBoard.ts` 的封闭枚举）。
- **AC2 的高度实测未在 CLI 里做**：jsdom 无布局，`0.42` 的降幅只能靠原型口径回归；实现逐条
  对齐了原型的三处结构（两行头 / 单行花名册 / 扁平分组 + 空列汇总）。需要人工开面板复核。
