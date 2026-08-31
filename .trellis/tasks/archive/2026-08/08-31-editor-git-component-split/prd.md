# 编辑器/Git 大组件拆分（4 组件回到 300 行红线内）

## Background

neeko-check 多轮审核累积的存量超限（pilllar 10：组件 ≤300 行）。四个组件的超限
根因不同，分两类对症处理，拒绝按行数硬切。

## 拆分方案（按 PR 排序）

### PR2 FileEditor（314 行）——渲染分支堆积型，风险低热身
JSX 有 5 条渲染分支（binary / externally-modified / markdown 预览 / html 预览 /
CodeMirror），逻辑已在 8 个 custom hooks。抽视图组件消分支。
### PR1 GitCommitPanel（623 行，36 hook 调用，20+ handler）——逻辑堆积型，重灾区
抽 `useGitActions`（push/pull/fetch/commit/stage/discard 系列 + 凭据对话状态），
渲染层只留装配（~180 行）。
### PR3 DiffView（390 行）——双形态渲染型
useDiffData/useDiffReview 已抽，剩 single/combined 两套装配。抽 single 分支
骨架（loading/error/toolbar+body）为 DiffViewBody 或状态占位组件。
### PR4 EditorGroupPane（301 行，超 1 行）——微拆
PaneTabBar 装配段 / action menu 装配收进现有 hooks，回线即可。

## 约束

- 每个 PR 独立可回归（最高频交互面），独立提交
- 纯移动迁移，行为保持；TDD 补关键分支断言
- 抽「增长源」而非「存量」：新增逻辑落在正确的层，宿主不再回弹

## Implemented（2026-08-31，一次性落地）

| 组件 | 前 | 后 | 拆出 |
|---|---|---|---|
| GitCommitPanel | 623 | 308 | `hooks/useGitActions.ts`（fetch/pull/push/commit/stage/凭据对话/AuthRequired 分流，runNetworkOp 收敛三连重复）+ `hooks/useCommitPanelAux.ts`（diff stats 懒加载 / divider 拖拽含卸载守卫 / AI commit message）+ `formatGitHost.ts` |
| FileEditor | 314 | 267 | `FileEditorView.tsx`（166，纯渲染：Header + preview/source 分支 + SelectionToolbar；binary/超大早退留编排层） |
| DiffView | 390 | 291 | `SingleDiffBody.tsx`（211，single 分支四态 body + 工具栏装配 + language 就绪 effect 内聚） |
| EditorGroupPane | 301 | 292 | renderTabLeading 回调迁入 `usePaneAgents`（agent 状态与渲染回调同域） |

决策记录：
- useGitActions 的 handleConfirmDiscard/handleStageAllUntracked 由宿主传参调用（确认弹窗
  状态留组件，命令编排进 hook）——UI 状态与命令编排分离。
- SingleDiffBody 内聚 language 检测/注册 effect（仅 single 分支消费）。
- extract 过程 git 域 376 测试全程绿，type-check 0 error。

## 验证

- `pnpm lint:fe` 0 error / `pnpm type-check` / `pnpm test:run` 299 文件 2368 passed
