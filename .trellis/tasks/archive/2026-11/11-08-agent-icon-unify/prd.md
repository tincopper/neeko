# Unify AgentIcon rendering and fix cli.svg dark-theme contrast

## Goal

把散落在 14 个文件、约 20 处「`resolveAgentIconSrc` / `getAgentIconSrc` + 裸 `<img>`」的
agent 图标渲染收编进单一 `AgentIcon` 组件，消除重复的加载失败兜底与 Terminal glyph 兜底；
并据此让 `cli.svg` 在所有主题下都可辨识。

## Background

- `AgentIcon` 已存在于 `src/shared/components/AgentIcon.tsx`，但 API 只有
  `icon / size / fallback / className`，覆盖不了 `alt`/`title`、加载失败兜底、`data-testid`、
  Terminal glyph 兜底、圆角/灰度等真实需求，于是调用方各自裸 `<img>`。
- `AgentBadge` 与 `ModelBadge` 各自维护一份 `broken` state（同一逻辑两份实现）。
- `AgentSkillContent` / `AgentRailRow` 各自写 `<Terminal/>` 兜底。
- `cli.svg` 是资产目录里**唯一没有背景底**的 agent 图标（其余 6 个 svg 都有 `<rect>` 圆角底），
  glyph 硬编码 `fill="#444444"`，深色主题下与背景同色、不可辨识。
- 全部图标走 `<img src>`（`shared/utils/agents.ts` 的 `AGENT_ICONS` 返回 URL），
  `<img>` 是隔离文档，吃不到主题 CSS 变量，也无法用 `currentColor` 着色。

## Requirements

### R1 组件 API 收编

- 拆两层：`shared/components/FallbackImage`（纯展示：`src` + 加载失败兜底）与
  `features/agent/components/AgentIcon`（容器：`icon` 标识 → 解析 → 展示）。
- `AgentIcon` 支持：`icon` / `size` / `className` / `alt` / `title` / `fallback`(ReactNode) /
  `testId`，以及**图片加载失败**兜底（与「无图标」同一个 `fallback`）。
- `fallback` 默认 `null`（不渲染，保持现状）；需要 Terminal glyph 的调用点显式传。
- 现有 `fallback` 语义（字符串，渲染成 `<span>`）保留；既有调用方
  （`RemoteDialog` / `WSLDialog` / `AgentSelector` / `ProjectSettingsDialog` 传的
  `"&#9889;"` / `"?"`）行为不变。
- **尺寸语义修正**：`size` 只在未传 `className` 时生效 —— 现状因默认 class `w-4 h-4`，
  `size={12}` 实际渲染 16px（`ConversationPanel` / `ConversationItem` /
  `ConversationViewer` / `ProjectGuidePage` 均中招）。

### R2 调用点迁移

- 14 个文件里的裸 `<img>` 全部改为 `AgentIcon`，**行为不变**：圆角、透明度/灰度、
  `alt`/`title`、`data-testid`、原 `else` 分支的兜底内容（首字母 chip 等）一律保留。
- `AgentBadge` / `ModelBadge` 删除各自的 `broken` state；`AgentBadge` 走 `AgentIcon`，
  `ModelBadge` 直用 `FallbackImage`（保留自己的厂商兜底分类）。

### R3 分层归位

- 删除 `src/shared/components/AgentIcon.tsx`（含那行 `eslint-disable`）。
- `SessionList` 搬进 `features/live-sessions/components/`（唯一消费者在同域）。
- `ProjectSettingsDialog` **留在 shared**（多 feature 消费，仓库规范归属），但改为彻底
  feature-free：`AgentIcon` / `setProjectAgents` / `setProjectIde` 三处依赖改为注入
  （`renderAgentIcon` / `onSaveAgents` / `onSaveIde`）。
- `shared/` 不再出现任何 `features/` import。

### R4 cli.svg 主题适配

- 单文件加圆角底 + 浅色 glyph，零逻辑、全主题可读。

## Acceptance Criteria

- [x] `src/shared/components/AgentIcon.tsx` 已删除
- [x] `AgentIcon` / `ProjectSettingsDialog` 内**无** `features/` import（前者已不在 shared，后者三处依赖已注入）
- [x] 新增的 shared 代码不再引入 `shared → features` 依赖（仓库尚有其他历史遗留的 documented exceptions，不在本任务范围）
- [x] 全仓除 `AgentIcon` 内部与 `ModelBadge` 外，不再有「resolver + 裸 `<img>`」的图标渲染
- [x] `AgentBadge` / `ModelBadge` 不再各自持有 `broken` state
- [x] `FallbackImage` / `AgentIcon` 有单测（`src` 为空 / `onError` / `src` 变化重置 / 兜底透传）
- [x] 既有测试全部通过：`AgentBadge.test`、`SessionList.test`、`agentApi.test`、
      `AgentsInlineEdit.test`、`AgentForm.modelListGate.test`、`AgentForm.builtinChat.test`、
      `AgentChatTabView.test`（全量 `pnpm test:fe` 741 文件 / 6883 用例绿）
- [x] `cli.svg` 在 `light` / `dark` / `classic-dark` / `one-dark-pro` 下均可辨识（用户目视确认）
- [x] `check_component_size` 基线已同步（`ProjectSettingsDialog` 361 / `ProjectSkillCard` 463 /
      `ProjectSkillContent` 1453，理由记在 ledger note）
- [x] `pnpm check:quick` 绿（40/40）

## 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | **乙**：容器进 `features/agent`，`shared/` 只留 `FallbackImage` | 组件需要 Tauri 边界（`convertFileSrc`）才能完成解析职责，在 `shared/` 没有合法位置；归位后绕行动机消失，`eslint-disable` 归零 |
| D2 | **A**：`cli.svg` 单文件加圆角底 | `<img>` 是隔离文档，按主题换 src 必须引入主题信号（当前不存在）；加底零逻辑、全主题可读，与 `pi.svg` / `omp.svg` 形态一致 |
| D3 | `ModelBadge` 只用 `FallbackImage`，保留厂商兜底分类 | 语义是「模型厂商 logo」，不是 agent 图标 |
| D4 | `SessionList` 搬进 `features/live-sessions`；**`ProjectSettingsDialog` 不搬**，留 shared 并改为注入式 | 后者被两个 feature 消费（仓库规范归 shared）；搬家会引入 `connection → project → connection` 的 facade 环 |

## Notes

- 技术设计见 `design.md`，执行顺序见 `implement.md`。
- 不做：全局主题信号、把解析下沉到 shared、改 `AgentConfig.icon` 语义。
