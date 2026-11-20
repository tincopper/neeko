# 团队成为跨单元容器：成员会话挂到团队下

## Goal

侧栏里「团队」今天是一个**单元下的会话级行**（`UnitSessionList` 里与我的会话并列），成员会话则被
`sessionsByUnit` 整批过滤掉 —— 于是**成员在干什么看不到**，团队挂在哪棵树下面也被单元绑死。

本任务把团队升为**项目下的容器行**（与单元平级、语义不同）：

```
▾ neeko
    ▾ local                         ← 地点（单元）
        ├ 我的会话 A
        └ 我的会话 B
    ▾ wt/feat-auth                  ← 地点（单元）
    ▾ ⟦team⟧ refactor · open 2/5     ← 容器（团队）：跨单元
        ├ Lead · 把任务板接上
        ├ w1 · 修登录竞态
        └ w2 · 还没有会话
```

为什么必须是跨单元：`SessionAttribution` 让「这条会话属于哪个团队成员」**与它跑在哪棵树无关**地
可回答（`{kind:'teamMember', teamId, memberId}`）。一旦成员能用自己的 worktree，把团队挂在任一单元
下都错 —— 挂 A 漏掉跑在 B 的成员，挂每棵下则重复。**容器是唯一随成员空间扩张而仍然正确的形状。**

## 现状（可指到文件的事实）

| # | 事实 | 位置 |
| --- | --- | --- |
| 1 | 团队行在单元内部渲染，与会话子列表相邻 | `src/features/live-sessions/components/UnitSessionList.tsx` |
| 2 | 成员会话被 `sessionsByUnit` 整批过滤 → 侧栏**完全看不到**成员 | `shared/selectors/liveSessionSelectors.ts`（`isTeamMemberSession` 跳过） |
| 3 | 单元行把团队算进 `childCount`，以便「纯团队单元」也能展开 | `ProjectGitSection.tsx:50-53`、`WorktreeRowList.tsx:98-102`、`ConnectionProjectCard.tsx:172-175` |
| 4 | 团队按 `(projectId, workspaceWorktree).key` 分组（单元锚定） | `agent-team/utils/teamList.ts::teamsByUnit` |
| 5 | 成员的**名字**只在花名册里（`TeamSnapshot.members`），会话只带 `memberId`（形如 `w1@tm_1`） | `shared/types/team.ts:513-528`、`team/types.rs:204` |
| 6 | `teamStore.snapshot` 是「面板当前打开的那一个队」 | `agent-team/store/teamStore.ts` |
| 7 | 团队的工作树被删后，团队行**永不渲染**（团队只在单元行下挂载） | 本任务顺带修 |

## Requirements

### R1 · 容器行（项目下的第二层）

- 团队行渲染在**项目**层（`ProjectGitSection` 的子项区，与 `WorktreeList` 同级），不再出现在任何
  单元的子列表里。
- 点击行的分派**不变**（活队长 ⇒ 接管那条 PTY；否则 ⇒ 打开团队面板）—— 判据仍在
  `utils/memberTerminal` 的宿主侧，侧栏不重算五态。

#### R1' · 第二轮：与 local / worktree **同一行形状**（用户验收反馈 2026-11-20）

四条反馈，合成一条规则：**团队行就是第二级的第三种行，与单元行同构**。

| # | 反馈 | 落地 |
| --- | --- | --- |
| 1 | 「team 还是用 icon 图标展示」 | 行首用**图标**（`Users`，与 Team dock 图标同源），不再用 `⟦team⟧` 文字标记 |
| 2 | 「后面加一个 team 的标识不合适」 | 删掉名字后面的 `⟦team⟧`（`TeamMarker` / `UnitTeamMarker` 整个删除，含宿主上的两个插槽） |
| 3 | 「把 team 和 local、worktree 并齐」 | 团队行**复用 `SessionRow`**（`kind: 'team'`）：同样的行高 / 内距 / 行首图标位 / 行尾展开箭头 / 自动展开规则 —— 一个组件，一种几何 |
| 4 | 「team 成员可以支持 worktree，但不用再单独显示为 worktree 的工作项」 | 被团队占用的工作树**不再作为单元行出现**（按 `team.workspaceWorktree` 命中即隐藏）；成员自己的 worktree 支持是下一轮的后端工作，届时同一条判据覆盖 |

由此产生的两处行为变化（都是 R1' 的直接结果，不是附赠）：

- 团队行变成**单行**（原来两行 + `Lead · <标题>` 副文案）。队长信息进**成员子行**：展开后队长排在
  第一位并带 `Lead` 标记。折叠态靠状态徽标 + 任务计数表达「这个队有动静」，不再有副文案。
- 单元行上的「被团队占用」标记随之消失 —— 那些工作树本来就不再作为单元行显示（`local` 主仓除外，
  那里也不再标：团队行本身已经说明了一切）。

### R2 · 成员子项（成员会话不再被过滤）

- 展开团队行 ⇒ 列出**花名册的全部成员**（含没有会话的），每行：`成员名 · 会话标题 / 没有会话`。
- 成员会话的归属由 `attribution` 求交（`teamId` + `memberId`），**与单元无关** —— 这是容器模型的
  全部依据。
- 点击成员行 ⇒ 有活会话则接管（`activateUnit` 到**该会话自己的单元** + `openExistingTerminalTab`）；
  没有会话 ⇒ 不可点（理由可见，与花名册同一口径）。
- `sessionsByUnit` 的过滤**保持**（成员会话仍不进单元的子列表）—— 两处出现才是回归。

### R3 · 花名册展开才拉

- 团队行的**副文案与徽标不依赖花名册**（只读 `team_list` + live 快照），所以折叠态零额外请求。
- 展开时才按 `teamId` 读一次花名册，结果按队缓存，由既有团队脉冲作废。
- **不得复用 `teamStore.snapshot`**（那是「面板当前打开的那个队」）：侧栏展开 A 队不能把面板切到 A。

### R4 · 单元行不再承载团队

- 单元行的 `childCount` 回到「会话数」（团队升到项目层后，单元里不再有团队行）。
- 纯团队、无会话的单元因此可以折叠 —— 这是正确的（团队不在那里了）。

### R5 · 团队占用的单元行加标记（**不隐藏**）

- 若某单元的 `(projectId, worktreePath)` 等于某团队的 `(projectId, workspaceWorktree)`，该单元行加一枚
  `⟦team⟧` 标记。
- **不隐藏**那是决策（design §4）：隐藏会带走「在这棵树里开终端 / 看我的会话 / 看文件树」的唯一入口，
  而团队行提供的是另一个视角（谁在跑），两者不冲突。

### R6 · 团队空间缺失要可见

- 团队记的 `workspaceWorktree` 在 `git worktree list` 里已不存在时，团队行**仍然渲染**（容器不依赖树），
  并标注该空间已缺失（不静默）。

## 明确不做

- **不做成员独立 workspace**（后端路径判据还没放开，见 `execution.rs:384-403`）；本任务只把容纳它的
  那一层建好。
- 不改面板（花名册仍是团队的完整事实面：六态 / 租约 / 待批）。
- 不做「一个单元一队」的唯一性约束。

## Acceptance Criteria

- [x] **AC1** 团队行渲染在项目层；单元子列表里不再出现团队行（`UnitSessionList` 不再引用团队域）。
- [x] **AC2** 折叠态：团队行显示队名 / 状态 / `未完成任务` 与副文案；**零**花名册请求（断言 `team_snapshot`
      未被 invoke）。
- [x] **AC3** 展开 ⇒ 一次 `team_snapshot(teamId)`，列出全部成员（含无会话者）；折叠再展开不重复拉。
- [x] **AC4** 展开 A 队 ⇒ `teamStore.teamId` **不变**（面板没有被侧栏切走）。
- [x] **AC5** 成员行点击 ⇒ 先切到**该会话自己的单元**（跨单元正确），再接管 PTY（有活会话时）；
      无会话的成员行不可点且理由可见。
- [x] **AC6** 单元行 `childCount` 只数会话；无团队的侧栏输出与今天一致（零回归锚点）。
- [x] **AC7** 团队占用的单元行带 `⟦team⟧` 标记；团队空间已被删除时团队行仍渲染并标注。
- [x] **AC8** `pnpm check:quick` 通过；vitest 相关目录全绿。

## Notes

- 红线自查：12（单元身份只经 `WorkspaceSession` 铸造；成员名只来自花名册，**禁止**拆 `w1@tm_1`）·
  17（花名册是按队读取的缓存，不是「当前队」的第二份；过滤仍然只有一处）。
- 相关（已归档）：`11-17-sidebar-lead-session`（团队行首次落地）、`11-20-team-board-view-memory`。

## 实施记录（与原计划的差异）

| # | 计划 | 实际 | 为什么 |
| --- | --- | --- | --- |
| 1 | 脉冲「清空」roster 缓存 | 改为**标记 stale**（保留上次成功的成员，脉冲后按需重取） | `implement.md` 自己同时要求「清空」与「失败保留上次成功」，两者合起来只能是 stale 标记；闪白比旧数据更糟（`teamStore` 同一条纪律） |
| 2 | `unitsWithListedActiveSession` **不计入**成员会话 | 与本计划一致（上一轮加的那条子句**删掉**） | 那条子句是为了「单元让出、团队行承担高亮」；团队行已升到项目层，单元里没有它的子项，留着会让单元亮而无高亮 |
| 3 | `ProjectActionsProvider` 在侧栏子树里必备 | 收进 `ProjectTeamEntries`：**只有真有团队时**才需要 provider | 无团队的项目不该因为「将来可能有团队」而在测试里全都要包 provider；同时保持「静默不切项目」的严格性（有团队时仍必填） |
| 4 | `extraChildCount` 归零 | 直接**换成** `unitBadge` | 保留一个恒为 0 的 prop 就是留一条会被误用的空通道 |
| 5 | 单元行的团队标记 | 抽成 `UnitTeamMarker`（三端共用） | 否则同一段 JSX 在 4 个宿主里各写一遍 |

## Check 阶段发现并修掉的缺陷

**花名册在「脉冲落在请求在飞期间」会永久停在脉冲前那一版。** 那一帧 `stale` 已经是 `true`
（`useTeamRoster` 的第 ② 个 effect 已经跑过一次并在 `loading` 处短路），响应落地时 store 只能
把条目**重新标脏**（`teamRosterStore::superseded`），而 `stale` 并没有从 `false` 变回 `true`
—— 只认 `stale` 的 effect 于是不会再跑。用户看到的是「成员列表不更新」，且只有折叠再展开才自愈。

修法：第 ② 个 effect 的依赖带上 `loading`，让「在飞 → 落地且仍标脏」这一刻再触发一次
（`ensure` 同步把 `loading=true / stale=false`，立刻短路，不成环）。
回归用例：`ProjectTeamList` 的「脉冲打断在飞请求 ⇒ 丢弃陈旧响应后**自动重取**」（修前红、修后绿）。

顺带修的两处：`team-domain.md` 里新加的条目插错了序号（4 后面接 6 再接 5）；门面里
`ProjectTeamListProps` 是无人引用的死导出（已删）。

## 已知遗留（下一轮，本任务不做）

- **成员独立 workspace**：后端 `workspace_cwd` 仍要求成员路径在团队根内（`execution.rs:400`），
  而 Neeko 自己的工作树在 `~/.neeko/worktrees/`（项目外）⇒ 成员用自己的 worktree 今天必被拒。
  容器层已经建好，放开判据后只需在成员行下加一层「空间子项」。
- **`check:quick` 的 `lint_fe` 预算偏紧**：冷缓存时 `eslint src/ --cache` 实测 285s（预算 300s），
  已两次触发「护栏自身失效」。与本次改动无关，但会咬任何冷跑的人。

## 第二轮实施记录（R1'）

| # | 反馈 | 落地 |
| --- | --- | --- |
| 1 | icon 展示 | `SessionRow` 的 `kind` 加 `'team'` ⇒ 行首 `Users` 图标（与 Team dock 图标同源） |
| 2 | 后面加 team 标识不合适 | `TeamMarker` / `UnitTeamMarker` 整个删除（含 `SessionRow.labelBadge` 上的那枚、`WorktreeRowList.unitBadge` 及其三个宿主接线） |
| 3 | 与 local / worktree 并齐 | 团队行改成 `SessionRow kind="team"` 的薄适配器：同一行高 / 内距 / 图标位 / 行尾箭头 / 展开状态机（自绘的两行结构与 `toggleExpanded` 删除） |
| 4 | 成员可支持 worktree，但不再单独显示为工作项 | `useTeamFreeWorktrees`：被团队占用的工作树从二级列表消失（主仓永不过滤） |

**订正一处验收时发现的问题**：团队行一开始跟着「有子项就首帧展开」的规则，于是侧栏每次挂载都会
为每个队各拉一次 `team_snapshot`（含 ≤200 条任务卡片）—— 而用户可能整场都不看任何一个队。
给 `SessionRow` 加了显式的 `defaultExpanded`（默认保持单元行行为），团队行传 `false`：
**行几何同构、代价不同**，因为单元行的子项在内存里、团队行的子项要发请求。「成员数增长 ⇒ 自动
展开」的规则仍对团队行生效（那是真实变化）。

**行为变化（R1' 的直接结果）**：团队行变成单行，折叠态不再显示 `Lead · <标题>`；队长信息进成员
子行（展开后队长排第一并带 `Lead` 标记）。

## 第三轮实施记录（状态文字删除）

用户：「团队无需加上状态显示，特别这种文字的状态显示，很占用空间」。

- 团队行**去掉 `TeamStateBadge`**（`open` / `Closing` / `Sealed` 三个词在 260px 列宽里要吃掉
  40–60px）。它回答的问题（这个队还活着吗）只在**点进去**时才有意义 —— 面板头与团队列表页仍带
  那个徽标，那里宽度够且是用户主动看状态的地方。侧栏这一行只留「还差几个活」（`2/5`）。
- **顺带**：`workspace missing` 那句话也换成一枚 `AlertTriangle` 图标（同样的空间理由，但它是
  **异常**而非每行都有的信息，所以保留可见性：字形 + 颜色 + `aria-label` / `title` 里的句子）。
- 判据：`ProjectTeamList` 的行形状用例改成「三态文案**一个都不出现**」（只删 `open` 而忘了
  `closing` 会静默通过），空间缺失用例改成按 `data-testid` + 可访问名断言。

## 第四轮实施记录（文字按钮改图标）

用户贴出团队列表表头的 `<button ...>Refresh</button>`：「使用 icon 的形式，不要使用文字的按钮」。

- `TeamListSection` 的刷新键改成**图标按钮**（`RefreshCw` 13px，几何与 `TeamBoardCenterView` 头部的
  刷新键同一套 `grid size-7`）。`Refresh` 这几个字母在已经挤着「N total」的窄表头里要占 50px 以上，
  而它是最低频的入口。
- 可访问名仍由 `aria-label="Reload team list"` 给出（图标按钮**必须**有它，否则读屏只剩「按钮」），
  外加 `title`。既有用例按 role name 取按钮，因此零改动即通过 —— 这也说明「文字按钮 → 图标按钮」
  在这套测试下是**行为不变、只有呈现变化**。

## 第五轮实施记录（选中高亮）

用户：「选择团队选项时高亮状态也需要进行切换」。

**根因**：团队行的「当前」原先只由 `foregroundTeamId`（前台会话的归属）派生。队长不在跑时点击
只会打开面板，**没有任何会话成为前台** ⇒ 高亮不动，原来亮着的 `local` 还亮着。

**修法**：第二级的「当前」由两个事实合成，都是派生、没有本地记账：

| 事实 | 来源 | 覆盖 |
| --- | --- | --- |
| 我**点过**这一行 | `workspaceStore.activeTeamId` | 队长不在跑、点了只开面板 |
| 它的会话**在前台** | `foregroundTeamId(refs, sessions)` | 点开了某个成员的终端 |

`activeTeamId` 放在 `workspaceStore`（不是 `teamStore`）：它和 `byProject[].activePath` 是同一层
——**「这个项目的第二级哪一行是当前」**。清空点只有一处且是自动的：
`setActiveWorkspace` / `clearActiveWorkspace` **就是**「用户选了某个单元」的全部入口，于是
「选了团队之后再去点单元/会话/切项目/切工作树」不需要任何调用方记得手工清。反向由点击团队行的
一方显式 `selectTeam`，且**必须写在 `activateUnit` 之后**（它内部会 `setActiveWorkspace` 把选中清掉）
—— 这条顺序有专门用例钉住，写反了就是 `null`。

为什么不做「团队是当前 ⟺ 激活单元是团队的单元」这种纯派生：团队跑在主 checkout 时它会与
`local` 行**同时**高亮（同一棵树两个入口），那正是前几轮修过的双亮形态。

## 第六轮实施记录（高亮互斥）

用户（截图：`local` 与团队行**同时**有选中填充）：「高亮肯定不能同时出现，一次只会激活一个」。

**根因**：上一轮修的是「点团队行不亮」，但没修它的反面 —— 团队跑在**主 checkout** 时，团队行与
`local` 行指向同一棵树，`activateUnit` 先把单元点亮、`selectTeam` 再把团队点亮 ⇒ 两行都亮。

**修法**：把「第二级只有一行亮」变成一条机器判据而不是靠调用方自觉：
`workspaceStore` 导出 `useTeamRowSelected()`（= `activeTeamId !== null`），三个二级宿主统一
`isActive = 单元激活 && !teamRowSelected`：

| 宿主 | 行 |
| --- | --- |
| `ProjectGitSection` | `local`（主 checkout） |
| `WorktreeRowList` | 每个 linked worktree |
| `ConnectionProjectCard` | WSL / SSH 主仓单元 |

为什么不是「让 `selectTeam` 顺手把 activePath 清掉」：那会让团队行背后的单元失去「我在这棵树里」
的事实（点成员会话要回到那个单元），而**高亮**才是那个唯一的东西。分开表达：`activePath` 说
「动作落在哪棵树」，`activeTeamId` 说「当前那一行是谁」。

判据（`ProjectGitSection.test.tsx`）：选中团队后 `local` 行无填充、整个二级列表**恰好一行**带填充
且那行是团队行；`clearActiveWorkspace` 之后团队选中归 `null`、`local` 行拿回填充。

## 遗留（下一轮）

- **成员独立 worktree 的后端支持**：`execution::workspace_cwd` 仍要求成员路径在团队根内
  （`execution.rs:400`），而 Neeko 的工作树在 `~/.neeko/worktrees/` ⇒ 成员用自己的 worktree 今天
  必被拒。放开判据后，隐藏判据（`useTeamFreeWorktrees`）需要覆盖**成员**的 workspace 路径，
  而不只是团队的 `workspaceWorktree` —— 届时把判据从「团队的树」扩成「团队 ∪ 成员的树」。

## 第七轮（代码审核修复）：把「当前行」收成一份判据 + 隐藏的边界

审核（neeko-check）在第五/六轮之上发现三处形态问题，都归到同一类根因：**同一个事实被两个消费者
各算一半**。修法不是补第三条判据，而是让判据只剩一处。

| # | 现场 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | **双亮回来**：点成员行（`onOpenMember` 只接管 PTY，不写 `activeTeam`）⇒ 团队行按 `foregroundTeamId` 亮、单元行按 `activeTeam === null` 不让出 | 「当前行是团队吗」有两个判据：「前台 ∪ 点过」与「只点过」 | 新增 `utils/teamRowSelection::currentTeamIdOf`（纯函数，唯一实现）= `foregroundTeamId` ∪ `activeTeam`（且必须仍在本项目清单里）。团队行用 `useCurrentTeamId`，三个单元宿主用 `useTeamRowSelected` —— 同一份 |
| 2 | **跨项目串高亮**：`activeTeamId` 是全局裸 id；`addProjectFromPath` / `handleSelectFile` 切项目时不走 `clearActiveWorkspace` ⇒ B 项目所有单元行让出、而 B 里没有任何团队行 | 「作废点」分散在 N 个切项目入口 | `activeTeam` 带 `projectId`：跨项目状态**不可表达**，不靠任何调用方记得清；另加「必须仍在清单里」的失效判据（删队后自动失效） |
| 3 | **隐藏把地点弄丢**：被团队占用的工作树整行消失 ⇒ 用户自己的会话、删除/重命名、开终端全部不可达；它若是当前单元则**零行高亮** | 「隐藏 = 被占用」，但地点行同时是能力入口 | 「隐藏 = 冗余」：那一行有用户自己的会话（`sessionsByUnit` 已滤掉成员会话）、或它正是当前单元，就保留。判据仍走身份（`WorkspaceSession.key`），不是路径 |

顺带修掉（同一次审核的低优先级项）：

- 红线 12：`workspaceMissing` 的裸路径 `includes` → 现存单元的 **key 集合**（`ProjectTeamEntries`
  一次铸好，与 `teamUnitKeys` 同一份 mint）。
- `useTeamRoster(teamId, expanded)` 的 `expanded` 恒为 `true`（子块只在展开时挂载）⇒ 删形参。
- `worktrees.map(...)` 内联生成新数组让三层 `React.memo` 失效 ⇒ 传清单本身，派生进块内 `useMemo`。
- 组件内文档自相矛盾（`ProjectTeamRow`「折叠态靠状态徽标」vs 同文件「没有状态徽标」、
  `ProjectTeamList` ASCII 里的 `Running`）；`formatCreatedAt` 的 JSDoc 被挤到 `teamsOfProject` 前。
- 测试夹具缺 `teamId`（`__tests__` 不在 `tsc` 范围，类型洞不会显形）。

**验收（新增用例）**

- `teamRowSelection.test.ts`：前台优先 / 点过生效 / 跨项目不生效 / 已删不生效 / 都没有 ⇒ null。
- `ProjectGitSection.test.tsx`：前台是成员会话（`activeTeam` 为 `null`）⇒ 二级列表**恰好一行**亮，
  且是团队行。
- `workspaceStore.test.ts`：`selectTeam` 写 `(projectId, teamId)`；单元激活（**路径没变**）与
  `clearActiveWorkspace`（主仓）都清。
- `WorktreeList.test.tsx`：占用 + 有我的会话 ⇒ 行仍在且会话可见；占用 + 是当前单元 ⇒ 行仍在。

**仍然不做**（与第三轮一致）：团队状态文字回侧栏、团队订阅第二条 `listen`、成员独立 worktree
（后端判据未放开，见「遗留」）。
