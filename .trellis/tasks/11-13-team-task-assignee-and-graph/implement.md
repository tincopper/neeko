# implement — assignee + 去认领边（TDD，逐段留红）

> 改动面：`src-tauri/src/agent/team/{types,store,manager,mcp/schema,mcp/dispatch,view,fixtures}.rs`
> · `src-tauri/src/common/db/migrations.rs` · `src/shared/types/team.ts` ·
> `src/features/agent-team/{utils/flowLayout.ts,components/FlowEdgesRenderer.tsx,components/TeamFlowGraph.tsx,components/TaskCardRow.tsx}`
> 及其测试。**零新事件、零新 IPC 命令。**

## 动手前（硬指令）

- [ ] Read `src-tauri/AGENTS.md`（红线 4/5/8/12/14/15）与 `src/AGENTS.md`（前端红线）。
- [ ] Read `.trellis/spec/backend/team-domain.md` §2.5（任务寻址）、§3（准入表字段纪律）、
      §1（库是真相，改列必须四处同步）。
- [ ] 读本任务 `design.md` §1（为什么不自动 claim）与 §2（迁移纪律）。

## 阶段 A：后端字段与迁移

- [ ] A1 红：`store` round-trip 测试 —— 带 `assignee: Some(W1)` 的任务写入后读回必须是 `Some(W1)`；
      再断言老库升级（v23 → v24）后既有行读成 `None`。
- [ ] A2 绿：
      - `types::TeamTask` 加 `pub assignee: Option<String>`（文档写清「计划事实」）；
      - `store::v23_to_v24`（`add_column_if_missing`）+ `migrations::persist_step` 加 `23 => …`
        + `TEAM_MIGRATION_LAST = 23`；
      - 四处 SQL 同步：`CREATE TABLE team_task` / `SELECT` / `INSERT … ON CONFLICT` / `UPDATE`；
      - **不动** v17 的 `team_task_v17` 历史 DDL。
- [ ] A3 `fixtures.rs` 与各测试里的 `TeamTask { .. }` 字面量补字段（编译错误会点名）。

## 阶段 B：认领闸门（唯一的状态机改动）

- [ ] B1 红：`manager` 测试三条
      - `assignee = Some(W1)`，`W2` claim ⇒ `Conflict`，文案含 `W1`；
      - `assignee = Some(W1)`，`W1` claim ⇒ Ok，`owner == Some(W1)`、`state == Claimed`；
      - `assignee = None`，`W2` claim ⇒ Ok（**回归**：未指派任务行为不变）。
- [ ] B2 绿：`claim_task` 在 `state != Pending` 判据之后加 assignee 闸门（见 design §4.1）。

## 阶段 C：写入面（`task_create`）

- [ ] C1 红：`dispatch` 测试
      - `task_create` 带本队成员 ⇒ 落库 `assignee == Some(id)`，且
        `state == pending && owner == None && claimed_at == None`；
      - 带**别队**成员 / 不存在的 id ⇒ `NotFound`，错误里列出本队成员 id；
      - 不带 ⇒ `assignee == None`（回归）。
- [ ] C2 绿：`schema::TOOLS` 里 `task_create` 的 `input_schema` 加 `assignee`（`type: string`，
      不进 `required`）；`dispatch::create` 用既有的 `member_of_team` 校验并落字段。
      错误信息里列本队成员时复用既有清单拼法（不新增第二份格式化实现）。

## 阶段 D：读侧

- [ ] D1 `view::TaskCard` 加 `assignee`（`view.rs` 的构造点 + 列的构造点都在同一处）；
      `TeamSnapshot` 测试同步（`camelCase` 断言）。
- [ ] D2 `fixtures::task_card` 之类的夹具补字段。

## 阶段 E：前端

- [ ] E1 红：`flowLayout.test.ts` —— 断言 `edges` **不含** `kind: 'claim'`（既有两条 claim 期望删除），
      且 `dep` / `create` 边仍在（同一条测试里断言三者的数量）。
- [ ] E2 绿：`FlowEdge.kind` 收成 `'create' | 'dep'`；删掉 claim 边生成循环；
      `FlowEdgesRenderer` 删 claim 分支与随之无用的导入/props（`memberTint` 工具保留）。
- [ ] E3 红：`TeamFlowGraph` 组件测试三种副标题（只有 assignee / 只有 owner / 都没有）
      + 图例断言（不再出现「实线 = 认领」）。
- [ ] E4 绿：`TeamFlowGraph` 副标题取 `task.assignee ?? task.owner`；图例文案；
      `shared/types/team.ts` 加 `assignee: string | null`。
- [ ] E5 看板卡片：`owner` 空且 `assignee` 有值时显示短标签（组件测试一条）。

## 阶段 F：收尾

- [ ] F1 `cargo test --manifest-path src-tauri/Cargo.toml agent::team` 绿
- [ ] F2 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` 绿
- [ ] F3 `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` 绿
- [ ] F4 `pnpm check:quick`（只跑一次）
- [ ] F4b 组件规模护栏：`TeamFlowGraph.tsx` 加完副标题后 307 行 > 300 红线 ⇒ 节点渲染抽成
      `components/FlowTaskNode.tsx`（含 `NODE_W/NODE_H`/状态色/副标题），文本截断与字号常量
      抽到 `utils/svgText.ts`；图组件降到 233 行。行为零漂移（组件测试全绿）
- [ ] F5 更新 spec：`.trellis/spec/backend/team-domain.md` §2.5（任务行的字段语义：
      `assignee` 计划 / `owner` 执行）、§3（若新增字段影响准入面则补）；前端
      `.trellis/spec/frontend/interaction-patterns.md` 的分配图交互段（认领边取消）。

## 判据汇总（谁红说明哪里退化了）

| 退化 | 变红的测试 |
| --- | --- |
| 指派被写成自动认领 | B1 第一条 + C1 第一条（`state/owner/claimed_at` 断言） |
| 认领闸门漏判 | B1 第一条（别的人能抢被指派的任务） |
| 迁移漏一列 / 漏一条 SQL | A1 round-trip + 升级测试 |
| claim 边又长回来 | E1（`edges` 不含 claim） |
| 副标题来源漂移（只看 owner） | E3 三种情形 |
| 图例又写回「实线 = 认领」 | E3 图例断言 |

---

# 第 2 轮：分配图可读性 + 视口（接阶段 F 之后）

> 只动前端。改动面：`flowLayout.ts` · `FlowEdgesRenderer.tsx` · `FlowTaskNode.tsx` ·
> `TeamFlowGraph.tsx` · `TeamBoardCenterView.tsx` · 新增 `utils/flowViewport.ts` ·
> `utils/svgText.ts` · 上述文件的测试。

## 动手前

- [ ] Read `src/AGENTS.md`（前端红线）与 `.trellis/spec/frontend/interaction-patterns.md`
      （dnd-kit 纪律的**适用边界**：列表排序 vs 画布 pan）。
- [ ] 读本任务 `design.md` §8~§12（第 2 轮设计，尤其 §11.2 单一 zoom 持有者）。
- [ ] 注意本 worktree 有大量别的任务未提交改动：禁止 `git checkout/restore/stash`。

## 阶段 G：节点副标题（#1）

- [ ] G1 红：`FlowTaskNode` 组件测试（或 `TeamFlowGraph.test.tsx`）四种组合，
      断言**两行**副标题的确切文本（见 design §8 的表）。特别是
      `assignee=A, owner=B`（A≠B）时两行分别出现 A 与 B —— 旧实现只显示 A。
- [ ] G2 绿：`FlowTaskNode` 拆成 `meta1` / `meta2` 两个独立推导函数；
      `NODE_H` 38→52，文字 y 改 15/29/42；`TeamFlowGraph` 的 `GAP_Y` 34→40。
      `svgText.ts` 加 `TEXT_META2_STYLE`（或复用 `TEXT_META_STYLE` + 类名区分）。

## 阶段 H：派发边（#2）

- [ ] H1 红：`flowLayout.test.ts` 改「三层关系」用例：`create` 边只有首层 2 条、
      `dispatched` == 首层 id；`TeamFlowGraph.test.tsx` 断言 `path.flow-create` 的
      `stroke-dasharray` 不再是 `1 3`（实线 = 属性缺失或 `none`）、图例含「实线 = 派发」。
- [ ] H2 绿：
      - `flowLayout`：`create` 边与 `dispatched` 只遍历 `layers[0]`（首层），
        注释改「派发 = 拆出入口任务」，**删掉**「每个任务都由 lead 派发」的旧说法；
      - `FlowEdgesRenderer`：`create` 分支去掉 `strokeDasharray="1 3"`，改
        `strokeWidth={1.4}` + `stroke-text-muted`（与依赖虚线靠线型区分）；
      - `TeamFlowGraph` 图例文案；`renderFlowEdges` 的 `leadBottomY` 起点仍用
        `layerY(0) - LEAD_GAP`（首层只在 layer 0，不再有跨层曲线）。

## 阶段 I：移除成员行（#3）

- [ ] I1 红：组件测试断言传入 members 后 SVG 里不出现成员名 + `任务` 计数，
      且 `viewBox` 高度 < 第 1 轮基线。
- [ ] I2 绿：删 `TeamFlowGraph` 的成员行 JSX / `memberY` / `memberX` / `memberById` /
      `MEMBER_NAME_MAX_CHARS`；`contentW = max(layerW, 160)`；`contentH` 去掉 `+40`；
      `svgText.ts` 删 `TEXT_SUB_STYLE`；`flowLayout` 的 `workerRow/memberRow` **保留**并
      在注释标明「图上暂不消费」；`members` prop 保留（aria-label）。

## 阶段 J：视口（#4）

- [ ] J1 红：新建 `utils/__tests__/flowViewport.test.ts` 打三个纯函数
      （clamp 上下界 / wheel 上滚放大下滚缩小 / `isPanClick` 阈值边界）。
- [ ] J2 绿：新建 `utils/flowViewport.ts`（常量 + 三函数，见 design §11.4）。
- [ ] J3 红：组件测试
      - 受控模式 `fireEvent.wheel` → `onZoomChange` 收到钳制后的值；
      - 非受控模式 wheel 后 SVG `width` 变化；
      - `pointerdown` → `pointermove`(dx>4) → `pointerup` → `click` 时 `onOpenTask` **不**调用；
        位移 0 时**要**调用（反证：不能把正常点击也吞了）；
      - 拖动改了容器 `scrollLeft`。
- [ ] J4 绿：`TeamFlowGraph` 加 `onZoomChange?` prop；`useEffect` 原生注册
      `wheel`（`{ passive: false }`，清理函数必须 remove）；`pointerdown/move/up` +
      `setPointerCapture`；`onClickCapture` 判 `isPanClick`；
      拖动 delta 直接作用于滚动容器 `scrollLeft/scrollTop`。
- [ ] J5 `TeamBoardCenterView` 传 `onZoomChange={setZoom}`（保留 `+/-/重置` 按钮），
      `ZOOM_STEP` 按钮步长与 wheel 步长**各自独立**（按钮 0.25 / wheel 0.1，别强行合并成
      一个常量：两者的手感不是同一件事）。

## 阶段 K：收尾

- [ ] K1 `pnpm vitest run` 覆盖 `src/features/agent-team` 全部相关测试
- [ ] K2 `npx tsc --noEmit` / `npx eslint <改动文件>` / `prettier --check` 绿
- [ ] K3 `pnpm check:quick`（只跑一次；含组件规模护栏 300 行）
- [ ] K4 更新 spec：`.trellis/spec/backend/team-domain.md` 的分配图段（若 §9a.7/§9.2 记了
      「两类边」要补「派发只连首层」）、`.trellis/spec/frontend/interaction-patterns.md`
      补一节「画布 pan 与列表排序的边界」（说明为什么这里不用 dnd-kit）。

## 判据汇总（第 2 轮）

| 退化 | 变红的测试 |
| --- | --- |
| 两行副标题又合成一个 `??` | G1 的 `A≠B` 用例 |
| 派发线又变回 `1 3` 点线 | H1 的 dasharray 断言 |
| 派发线又给每个任务都画（跨层穿节点） | H1 的 create 边数量 |
| 成员行又长回来 | I1 |
| wheel 被页面滚走（passive） | J3 受控 wheel 断言 + 手动验证 |
| 拖完手一松误开详情 | J3 超阈值 click 断言 |
| 正常点击被吞 | J3 零位移反证 |
| zoom 出现第二份 state | 代码审查 + J3 受控断言 |
