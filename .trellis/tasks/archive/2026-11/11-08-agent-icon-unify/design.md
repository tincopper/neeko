# Design — AgentIcon 归位 + cli.svg 主题适配

## 1. 目标

1. 全仓 agent 图标渲染**只有一个组件**（`features/agent` 的 `AgentIcon`），
   消除 14 个文件、约 20 处「resolver + 裸 `<img>`」与两份 `broken` state。
2. 组件的**分层合法**：`AgentIcon` 与 `ProjectSettingsDialog` 不再有 `shared → features`
   依赖，本任务不再新增任何 `eslint-disable import/no-restricted-paths`。
3. `cli.svg` 在 `light` / `dark` / `classic-dark` / `one-dark-pro` 下均可辨识。

**非目标**：不改 `AgentConfig.icon` 的数据语义（不把解析下沉到数据边界）；
不引入全局主题信号；不动 `ModelBadge` 的厂商兜底分类。

## 2. 根因

| 层 | 事实 |
| --- | --- |
|  proximate | `AgentIcon` API 只有 `icon/size/fallback/className`，缺 `alt`/`title`/`testId`/加载失败兜底/Terminal 兜底 → 调用方各自裸 `<img>` |
| 结构 | `AgentIcon` 住 `shared/components`，却必须调 `features/agent/api/agentApi` 的 `resolveAgentIconSrc`（自定义上传分支要 `convertFileSrc`，Tauri 边界）—— firewall 禁止 `shared/* → features/*`，`no-restricted-imports` 禁止 `shared/* → @tauri-apps/api/core`。两条路都堵死，只能靠 `eslint-disable` 压着 |
| 后果 | 组件的「家」在架构上不合法 → feature 开发者不认为它是自己的 → 绕行成本低时（API 窄）就绕行 |

**判据**：一个模块该住在「能合法满足其依赖的最低层」。解析这半需要 Tauri 边界 →
组件整体不能住在 `shared/` → 它是 agent 域、app 层组件。

## 3. 决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | **乙**：容器搬进 `features/agent/components/AgentIcon.tsx`；`shared/` 只保留纯展示原语 `FallbackImage` | 让组件回家；`AgentIcon` / `ProjectSettingsDialog` 的 shared→features 依赖归零；下一个画图标的人引的是自己域的组件，绕行动机消失。（注：仓库里 `shared → features` 的 documented exception 普遍存在，本任务只负责消灭自己引入/涉及的那部分） |
| D2 | **A**：`cli.svg` 单文件加圆角底 + 浅色 glyph | 零逻辑、零调用点；`<img>` 是隔离文档，不吃主题变量，任何「按主题换 src」都要引入主题信号（当前不存在）。加底后全主题可读，且与 `pi.svg`/`omp.svg` 形态一致 |
| D3 | `ModelBadge` 改用 shared 的 `FallbackImage`，**保留**自己的厂商兜底分类 | 它渲染的是「模型厂商 logo」，语义与 agent 图标不同，不该塞进 `AgentIcon`；但「img + 加载失败兜底」是公共逻辑，必须只有一份 |
| D4 | `SessionList` 搬进 `features/live-sessions`；**`ProjectSettingsDialog` 不搬**，留在 `shared/` 并改为注入式 | 见下方「D4 修订」 |

### D4 修订（执行中发现，2026-11-08）

初版方案把 `ProjectSettingsDialog` 也搬到 `features/project`。**执行时发现两条硬约束**：

1. **feature 环**：`features/connection/ConnectionProjectCard` → `@/features/project`（门面）
   → `ProjectsPanel` → `@/features/connection`（门面）→ 回到 `ConnectionProjectCard`。
   `import/no-cycle` 直接报红。
2. **仓库自己的规范**：`component-guidelines.md`「展示组件 + 数据 adapter 跨域复用模式」明确写道
   ——「被**多个 feature** 消费的展示组件放 `src/shared/components/`；feature 内出现同名文件且内容
   只有 `export { default } from '@/shared/components/<X>'` 时，那是**门面转发**，不是第二实现」。
   `ProjectSettingsDialog` 被 `features/project`（本地项目）与 `features/connection`（wsl/remote）
   两个域消费，而 `features/project/components/ProjectSettingsDialog.tsx` 原来恰好就是这个门面转发。

**结论**：`ProjectSettingsDialog` 本就属于 shared，初版的「搬家」是误读（把门面转发当成了
搬迁意图）。修法是让它**保持 shared 且彻底 feature-free**：把三处 feature 依赖改为注入 ——

| 原依赖 | 注入 prop | 消费者各自传什么 |
| --- | --- | --- |
| `<AgentIcon icon size fallback>` | `renderAgentIcon(icon, fallback?) => ReactNode` | `(icon, fb) => <AgentIcon icon={icon} size={16} fallback={fb} />` |
| `setProjectAgents(projectId, agentIds)` | `onSaveAgents(projectId, agentIds) => Promise<void>` | `setProjectAgents`（`@/features/agent/api/agentApi`） |
| `setProjectIde(projectId, ide)` | `onSaveIde(projectId, ideCommand) => Promise<void>` | `setProjectIde`（`features/project/api/projectApi`） |

这与仓库已记录的 `SessionChips` 模式（shared 展示组件 + 各域 adapter）完全一致，
且行为零漂移：保存的 try/catch 与 IDE 命令计算都仍在弹窗内，只是函数来源由调用方注入。

**对 `SessionList` 的判断不变**：它只有 `features/live-sessions` 一个消费者，且没有任何
feature 持有它的门面转发，所以搬进该域是正确的（且它因此不再需要 shared→features 依赖）。

## 4. 组件契约

### 4.1 `src/shared/components/FallbackImage.tsx`（新增，纯展示）

```tsx
export interface FallbackImageProps {
  /** `null` = 直接渲染 fallback */
  src: string | null;
  /** 边长（px）。仅当未传 `className` 时通过 inline style 生效 —— 传了 className 就是调用方完全控制盒子 */
  size?: number;
  className?: string;
  alt?: string;
  title?: string;
  testId?: string;
  /** `src` 为空或加载失败（`onError`）时的兜底内容 */
  fallback?: ReactNode;
}
```

行为：

- 失败态用**派生**而非 effect 重置：`const [failedFor, setFailedFor] = useState<string | null>(null)`，
  判据 `!src || failedFor === src` → 渲染 `fallback`；`onError` 只做 `setFailedFor(src)`。
  `src` 一变等式自然不成立 —— 不在 effect 里同步 `setState`（react-hooks 规则判违规）。
  副作用：回到已知失败的 src 时保持兜底（不重试同一 URL），比旧实现「一旦 broken 永远 fallback」更准。
- 否则 `<img src alt={alt ?? ''} title width={size} height={size}
  className={cn('shrink-0 object-contain', className)}
  style={className ? undefined : { width: size, height: size }}
  data-testid={testId} onError={() => setFailedFor(src)} />`
- **尺寸语义**：`className` 存在 → 调用方完全控制（不注入 inline style）；否则 `size` 生效。
  这修掉了现状的一个潜伏 bug：`size={12}` 但因为默认 class `w-4 h-4` 实际渲染 16px
  （`ConversationPanel` / `ConversationItem` / `ConversationViewer` / `ProjectGuidePage` 都中招）。

### 4.2 `src/features/agent/components/AgentIcon.tsx`（唯一容器）

```tsx
export interface AgentIconProps {
  /** agent 配置里的图标标识：preset 文件名或用户上传路径；`null` = 兜底 */
  icon?: string | null;
  size?: number;            // 默认 16
  className?: string;
  alt?: string;             // 默认 ''
  title?: string;
  /**
   * 无图标 / 加载失败时的兜底内容。默认 `null`（不渲染）—— 保持现状，
   * 需要 Terminal glyph 的调用点显式传（`AgentRailRow` / `AgentSkillContent`）。
   */
  fallback?: ReactNode;
  testId?: string;
}
```

实现要点：

- `const src = resolveAgentIconSrc(icon)`（`features/agent/api/agentApi`，本域直导）
- `fallback` 为字符串时包一层 `<span>`（保持 `RemoteDialog` / `WSLDialog` /
  `AgentSelector` / `ProjectSettingsDialog` 现有的 `"&#9889;"` / `"?"` 行为）
- 不再有 `shared → features` 的 import，`eslint-disable` 删除
- `React.memo` 保留

### 4.3 删除

- `src/shared/components/AgentIcon.tsx`

## 5. 文件迁移

| 从 | 到 | 说明 |
| --- | --- | --- |
| `src/shared/components/SessionList.tsx` | `src/features/live-sessions/components/SessionList.tsx` | 252 行（≤300，未登记 ratchet），唯一消费者 `UnitSessionList`（同域） |
| `src/shared/components/__tests__/SessionList.test.tsx` | `src/features/live-sessions/components/__tests__/SessionList.test.tsx` | 随组件走；import 路径同步 |
| `src/shared/components/ProjectSettingsDialog.tsx` | **不搬**（留在 shared） | 多 feature 消费（project + connection）→ 按仓库规范属 shared；改为注入式（见「D4 修订」），彻底去除 features import |

import 变更：

- `features/live-sessions/components/UnitSessionList.tsx`：`@/shared/components/SessionList` → `./SessionList`
- `features/project/components/ProjectSettingsDialog.tsx`：**保持原样**（`export { default } from '@/shared/components/ProjectSettingsDialog'` 门面转发）
- `features/connection/components/ConnectionProjectCard.tsx`：**保持** `@/shared/components/ProjectSettingsDialog`
- `features/project/components/ProjectItem.tsx` / `ConnectionProjectCard.tsx`：新增注入
  `renderAgentIcon` / `onSaveAgents` / `onSaveIde`
- `features/live-sessions/components/SessionList.tsx` 内部的 `AgentIcon` import → `@/features/agent`

## 6. 调用点迁移映射（14 文件 / 约 20 处）

| # | 文件 | 现状 | 迁移后要点 |
| --- | --- | --- | --- |
| 1 | `settings/BuiltInAgentsSection.tsx` | `getAgentIconSrc` + `<img>` / 空 span | `<AgentIcon icon={effectiveAgent.icon} size={18} className={cn('text-[var(--font-size)] size-[18px] object-contain', isDisabled && 'opacity-50')} />` |
| 2 | `settings/CustomAgentsSection.tsx` | `resolveAgentIconSrc` + `<img>` / 空 span | `<AgentIcon icon={agent.icon} size={18} className={cn('size-[18px] object-contain shrink-0', isDisabled && 'opacity-50')} />` |
| 3 | `skill/ImportToAgentDialog.tsx` | `<img>` / `null` | `<AgentIcon icon={agentIcon} size={14} className="h-3.5 w-3.5 rounded" />` |
| 4 | `skill/SkillCard.tsx` | `<img alt/title={agent.name}>` / `null` | `<AgentIcon icon={agent.icon} size={16} alt={agent.name} title={agent.name} className={cn('w-4 h-4 rounded-[3px]', enabled ? 'opacity-100' : 'opacity-30 grayscale')} />` |
| 5 | `skill/AgentSkillCard.tsx` | `<img alt/title>` / `null` | `<AgentIcon icon={agentIcon} size={16} alt={agentName ?? ''} title={agentName} className={cn('w-4 h-4 rounded-[3px]', libraryDisabled && 'opacity-40 grayscale')} />` |
| 6 | `skill/AgentSkillContent.tsx` | `<img>` / `<Terminal/>` | `fallback={<Terminal className="h-4 w-4 text-text-secondary shrink-0" />}` |
| 7 | `skill/ImportToProjectDialog.tsx` | `<img>` / `null` | `<AgentIcon icon={agent.icon} size={14} className="h-3.5 w-3.5 rounded" />` |
| 8a | `skill/ProjectSkillContent.tsx` | `<img>` / 首字母 chip | `fallback={<span className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] bg-bg-hover text-[9px] font-semibold">{a.name.slice(0,1).toUpperCase()}</span>}` |
| 8b | 同上 | `<img>` / 首字母文本 | `fallback={<span className="text-[10px] font-semibold text-text-muted">{agent.name.slice(0,1).toUpperCase()}</span>}` |
| 8c | 同上 | `<img>` / 首字母 chip | `fallback={<span className="inline-flex w-4 h-4 text-[9px] items-center justify-center bg-bg-hover rounded">…</span>}` |
| 9a | `skill/ProjectSkillCard.tsx` | `<img>` / 首字母 chip | size 14、`fallback` 保留 chip |
| 9b | 同上 | `<img>` / 首字母 chip | size 16、`fallback` 保留 chip |
| 10 | `agent-chat/AgentBadge.tsx` | `broken` state + `<img>` | 删 state；`className="agent-badge-img"`、`alt={name}`、`fallback={<span className="model-opt-icon"><Rotate3d size={14}/></span>}` |
| 11 | `agent-chat/ModelBadge.tsx` | `broken` state + `<img>` | 删 state，改直用 `FallbackImage`；厂商兜底分类不动 |
| 12 | `editor/TabItemLeading.tsx` | 三元链里的 `<img data-testid="agent-icon">` | 分支条件保留在「有 icon 名」上（`agentIconName` 为 null 时仍落到 `<Icon>`，行为不变）；`testId="agent-icon"` |
| 13 | `agent/AgentRailRow.tsx` | `<img>` / `<Terminal/>` | `fallback={<Terminal className="h-3.5 w-3.5 shrink-0 opacity-50" />}` |
| 14 | `agent/AgentForm.tsx` | 选择器按钮里的 `<img>` | `<AgentIcon icon={iconName} size={14} className="size-3.5 object-contain" />` |

统一后的 import 规则：

- `features/**` → `import { AgentIcon } from '@/features/agent'`（门面，已有先例）
- `features/agent/**` 内部 → `./AgentIcon` 或 `../AgentIcon`（本域直导）
- `ModelBadge` → `import FallbackImage from '@/shared/components/FallbackImage'`

## 7. 资产改动（D2 = A）

`src/assets/agents/cli.svg`：

```svg
<svg width="800px" height="800px" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg">
<rect width="32" height="32" rx="7" fill="#18181b"/>
<path fill="#fafafa" d="M25.716 6.696h-19.296c-0.888 0-1.608 0.72-1.608 1.608v16.080c0 0.888 0.72 1.608 1.608 1.608h19.296c0.888 0 1.608-0.72 1.608-1.608v-16.080c0-0.888-0.72-1.608-1.608-1.608zM8.028 17.952l3.216-3.216-3.216-3.216 1.608-1.608 4.824 4.824-4.824 4.824-1.608-1.608zM20.892 19.56h-6.432v-1.608h6.432v1.608z"/>
</svg>
```

- 去掉 `<?xml?>` 与 DOCTYPE（与 `pi.svg` / `omp.svg` 一致）
- `rx=7`（32 分之一 ≈ 0.22，与 `reasonix.svg` 的 0.234 同档）
- 底色 `#18181b` + glyph `#fafafa`：浅底深底都成立，且与 `pi.svg`（`#09090b` + `#fff`）同语言
- 字形路径原样保留（viewBox 内边界约 6.4~6.7，居中良好，无需缩放）

## 8. 护栏影响

| 护栏 | 影响 | 处理 |
| --- | --- | --- |
| `check_component_size` | `SessionList` 252 行（未登记）搬家后仍 ≤300 → 无影响；`ProjectSettingsDialog` 不搬，但新增 3 个注入 prop 后 356→361 行（已登记文件不得回涨） | 手工把该键从 356 下调为 361（只改这一条，不重跑全量生成 —— 工作区存在与本任务无关的存量行数漂移） |
| `check_feature_firewall_coverage` | feature 目录清单不变 | 无 |
| `check_frontend_resource_mirror` | 不涉及状态镜像 | 无 |
| `check_ui_style_tokens` / `check_styles_layout` | 不改样式 token / 布局文件 | 无 |

## 9. 测试影响

| 测试 | 影响 |
| --- | --- |
| `SessionList.test.tsx` | 随文件搬到 `features/live-sessions/components/__tests__/`，import 路径更新 |
| `AgentBadge.test.tsx` | mock 的是 `@/features/agent/api/agentApi`；`AgentBadge` 经 `AgentIcon` 仍调同一模块 → mock 生效，断言不变（`onError` 用例由 `FallbackImage` 承担） |
| `ProjectItem.test.tsx` / `ConnectionProjectCard.test.tsx` | 需渲染 `ProjectSettingsDialog` 注入的 3 个新 prop（否则 TS 报错）；如测中发现弹窗渲染断言变化需同步 |
| `AgentsInlineEdit.test.tsx` / `AgentForm.*.test.tsx` / `AgentChatTabView.test.tsx` | mock `resolveAgentIconSrc`；调用链不变 → 无影响 |
| `agentApi.test.ts` | 直接测 resolver，无影响 |
| 新增 | `FallbackImage` 单测（`src` 为空 / `onError` / `src` 变化重置）；`AgentIcon` 单测（preset / 自定义路径 / 兜底透传） |

## 10. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| `size` 语义修正导致 4 处视觉尺寸从 16px 变为作者意图值（12/14/18px） | 这是修 bug；改动集中、可逐一比对；如需保守可先只对无 `className` 的调用点生效（本方案即是） |
| 搬家导致 ratchet / import 遗漏 | 搬家后立即跑 `pnpm check:quick`；import 由 eslint firewall + tsc 双兜底 |
| `ProjectSettingsDialog` 基线重生成带入无关漂移 | 重生成前 diff 基线，只保留路径变更；若出现无关条目则改为手工只改这一条键 |
| `ModelBadge` 语义被误并入 agent 概念 | D3 明确它只用 `FallbackImage`，自有兜底分类不动 |

**回滚点**：每个阶段（组件 → 搬家 → 收编 → 资产）独立可回退，见 `implement.md`。
