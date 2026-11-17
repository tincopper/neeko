# 简化团队面板信息密度（原型先行）

## Goal

团队视图（`TeamHeader` + `TeamRoster` + `TeamTaskBoard`）在 260–300px 的 dock 右栏里纵向堆叠过密：
典型场景（1 队长 + 3 成员 + 4 任务）下内容高度约为两屏以上，且其中大半是**重复表达**（同一个事实在
头部 / 行 / 卡片各说一遍）与**低频入口常驻**（刷新、改名、恢复团队各占按钮位）。

本轮先交付一份**可交互 HTML 原型**用于裁决，不在原型被认可前改业务代码。

## 现状盘点（密度来源，逐条可指到文件）

| # | 位置 | 现在显示 | 为什么算噪音 |
| --- | --- | --- | --- |
| 1 | `components/TeamHeader.tsx` | 3 行：队名 + 状态 + `返回列表` + `刷新`；`N 成员` + `M 待批` + 项目根末段；`改名` + `恢复团队` + `关闭团队` | 快照已由 `usePulseRefresh` 自动刷新；改名已有队名双击入口；恢复团队只在 `open` 且存在可恢复成员时成立 |
| 2 | `components/TeamRoster.tsx` | 标题右侧 `N 人（含队长）` | 头部 pill 是後端口径（不含队长），同屏两个不同的「人数」 |
| 3 | `components/RosterRow.tsx` | 每行 4 层：头像 + 名字 + 队长 + 六态徽标 / 最多 5 枚 chip（agent、persona、通道、workspace、档位）/ 租约 / 动作按钮 + 置灰理由 | 无租约时每行恒亮「无在飞任务」；5 枚 chip 里 4 枚与「这是谁、它在等什么」无关 |
| 4 | `components/TeamTaskBoard.tsx` | 5 列全部渲染，空列也占 `label + count + —` | 空列白占约 40px × N |
| 5 | `components/TaskCardRow.tsx` | 标题 + id / 状态 + workspace + owner + 指派 + 依赖 + 回收 + 截断 共 7 枚 chip / 租约 + owner 状态 | 状态 chip 与所在列重复；`shared` 是缺省值却每次都渲染；id / 依赖数属于详情 |

## 原型

`.trellis/tasks/11-17-team-panel-density/prototype-team-panel-density.html`（零依赖，直接打开；
`#before` = 直接看现状，`#drawer` / `#menu` = 直接看对应状态）。

同屏三件事：① 优化后 / 现状 一键切换；② 每条变更可逐条勾掉（收敛范围）；③ 实时测量。

### 实测（典型场景 1 队长 + 3 成员 + 4 任务，内容自然高度）

| 列宽 | 现状 | 优化后 | 降幅 | 头部 / 花名册 / 任务板 |
| --- | --- | --- | --- | --- |
| 280px | 1041 px | 600 px | **−42%** | 67→31 / 422→194 / 520→326 |
| 320px | 1003 px | 596 px | **−41%** | 67→31 / 422→194 / 482→324 |

同一份数据下「可读/可点元素」从 52 降到 27。

### 原型观察到的两个实现约束

- **D2-b（整枚 `C 档 · sentinel only` chip）在 280px 会把名字挤成 `researc…`**：整枚 chip 约 100px，
  与「名字 + 徽标 + 动作」抢同一行。D2-a（`⚠ C` + 分区说明）才是可用的默认值。
- **任务板分组不该是盒子**：去掉每列的外框 / 底色 / 内边距（保留计数与分组语义）后，
  任务板从 520 → 326 px；列映射与「空列汇总」都还在。这是原型里最省的一刀，A/B 都没覆盖它，
  实施时按「紧凑分组」落地（需同步 `TeamTaskBoard` 的注释）。

## Requirements（候选变更清单 — 分档，原型负责裁决）

编号是稳定标识符，spec / 提交信息与原型清单共用。

### A 档 · 纯去噪（不改任何既有契约）

- **R1** 头部收成 1 行：`←` 返回 + 队名（双击改名）+ 状态徽标 + `⋯` 菜单；`改名` / `刷新` / `恢复团队` /
  `关闭团队` 进菜单。菜单项与现有按钮**走同一条路径**（同一个 hook 实例），不新写实现。
- **R2** 头部保留一行 micro 元信息：`N 成员 · M 待批（仅 > 0）· 项目根末段`（信息不丢，只是降级为文字）。
- **R3** 花名册行：`leaseRemainingSecs === null` 时**不渲染**租约文案。
- **R4** 花名册标题去掉右侧人数（头部 pill 已是唯一口径）。
- **R5** 任务板空列折叠成一行汇总（`待认领 0 · 阻塞 0`），非空列照常分组渲染。
- **R6** 卡片状态 chip 只在「列无法唯一确定状态」时渲染（同列多态：`claimed`/`in_progress`、
  `failed`/`blocked`）。
- **R7** 卡片去掉 `task.id`、`依赖 N` 与缺省 workspace chip（`shared` 不渲染；`worktree …` / `只读` 仍渲染）。
- **R12** 任务板分组去掉外框 / 底色 / 内边距（列语义与计数保留）—— 280px 下每列省约 12px，
  是原型里最省的一刀；`data-column` / `role="group"` 等机器标识不变。

### B 档 · 结构收敛（改 `utils/memberChips` 的契约 + 需同步 spec）

- **R8** 花名册行单行化：行内只留「名字 + 队长标记 + 六态徽标 + 打开会话」；agent / persona / 通道 /
  档位 / workspace / 租约移入成员详情抽屉（`MemberDetailDrawer` 已有这些块，只需补齐 workspace 与租约）。
- **R9** C 档可见性（红线 14 的 UI 侧不许降级）：行内保留一处**可见文字**警示，分区底部说明保持常显；
  具体形态见 D2。
- **R10** 任务板分区可折叠（默认展开）：折叠后为一行摘要，点开才渲染分组。

### C 档 · 结构性（视觉契约级，需单独裁决）

- **R11** 任务板整体退为中央 tab，面板主面让给花名册 + 待批队列（调研建议见
  `.trellis/tasks/10-30-multi-agent-orchestration/research/05-team-ui-interaction-survey.md` §3.5）。
  会改动 `prototype-agent-team.html` 视图①与 AC11，本轮**默认不做**。

## 不许降级的既有契约

改任何一条都算超范围，除非另开裁决：

1. **红线 14 / C 档**：`C 档 · sentinel only` 的语义必须有可见文字承载（行内徽标 + 分区说明），
   不得只靠 `title` 或颜色。
2. **AC2**：`idle + unverified`（`空闲 ⚠ 未声明`）与 `idle + verified`（`空闲 ✓ 已声明`）文案与 tone 都不同。
3. **列映射封闭枚举**：`COLUMN_OF` 不动；空列折叠只是渲染，`unplaced` 报警仍必须能出现。
4. **截断必须说出来**：`tasksTruncated` 的 `只显示前 MAX_BOARD_TASKS 条` 仍在卡片区可见。
5. **打开会话五态**：`打开会话` / `恢复会话` / `查看记录` / `暂无会话` / `已关闭` 的判据与「理由可见文字」不变。
6. **抽屉是对话框**：`role="dialog"` + 焦点陷阱 + Esc + 焦点归还（`useDrawerFocus`）。

## Non-goals

- 不改后端命令与载荷（`team_snapshot` / `team_list` 形状不动），本任务纯前端 + spec。
- 不改团队列表页（`TeamListPage` / `TeamListRow`）与建队流程（`TeamLaunchPanel`）—— 如需要另开任务。
- 不新增动作（审批 approve/deny、`team_send` steer 等属别的任务）。
- C 档（R11）默认不做。

## Acceptance Criteria

- [x] **AC0** 交付 `.trellis/tasks/11-17-team-panel-density/prototype-team-panel-density.html`：同屏可切换
      「现状 / 优化后」，含变更清单与一键测量（同一份数据、同一宽度下的内容高度对比）。
- [x] **AC1** 原型被用户裁决通过（范围 A / A+B / A+B+C 之一）后，再落 `design.md` + `implement.md`。
- [ ] **AC2**（**待人工目测**：CLI 无布局引擎，需开面板换 280px 对照原型）实施后，280px 宽度下典型场景（1 队长 + 3 成员 + 4 任务）内容高度相对现状下降 ≥ 40%
      （以原型 AC0 的测量口径为准），且**没有**任何信息变成只能靠 hover 才拿得到。
- [x] **AC2b** 任务板分组不再是盒子（无外框 / 无底色），但列计数、空列汇总、`unplaced` 报警仍渲染。
- [x] **AC3** R9 落地后，`hasSentinelOnly` 场景仍满足红线 14：行内可见警示 + 分区说明可读。
- [x] **AC4** R6 / R7 落地后仍有测试覆盖「同列多态可区分」与「缺省 workspace 不渲染」。
- [x] **AC5** R1 的菜单项复用既有 hook（`useTeamDestructives` / `useTeamResumePanel` / `useTeamRename`），
      不产生第二份「关闭 / 恢复 / 改名」实现。
- [x] **AC6** `pnpm check:quick` 全绿；既有 agent-team 测试不被删除（只允许按新契约改写断言）。

## Decisions（2026-11-17 裁决，用户「按建议推进」）

| # | 问题 | 裁决 | 备注 |
| --- | --- | --- | --- |
| D1 | 本轮实施范围 | **A + B**（R11 不做） | 视觉契约级变更另开任务 |
| D2 | C 档在行内的呈现 | **a**：行内 `⚠ C` + 分区固定说明 | b 在 280px 把名字挤成 `researc…`（原型实拍） |
| D3 | 任务板是否默认折叠 | **展开** | 折叠是用户主动动作 |
| D4 | 团队列表页同批 | **否** | 另开任务 |

## Notes

- 原「刷新」按钮保留在 `⋯` 菜单里而不是删掉：`usePulseRefresh` 的订阅依赖事件通道，通道异常时
  手动重取是唯一的恢复路径。
- 花名册行单行化后，「成员在哪个 worktree」仍然要能一眼看到 —— 原型里以名字后的 micro 后缀呈现
  （仅 `worktree` / `只读` 时出现），不塞回 chip 排。
