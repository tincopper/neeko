# 源码行级变更高亮（IDEA 风格）

## Goal

在 CodeMirror 编辑器内标示「当前文件哪些行相对 HEAD 被改动」：最左变更竖条（绿=新增、蓝=修改）+ 行背景 + 修改行词级片段，视觉与交互对齐已确认原型 `prototype/idea-change-highlight.html`，色彩语义对齐 JetBrains（与 `gitFileDecoration.ts` 一致）。

用户价值：不切换 Diff 视图即可感知改动位置；与文件树徽标、DiffView 同一 git 口径。

## Background（已确认事实）

- **git 口径（用户已确认）**：单档「相对 HEAD（工作区+暂存合并）」，不区分 staged/unstaged；未保存 buffer 不计入（磁盘 VCS 快照，与文件树/DiffView 一致）。
- **数据源**：复用 `get_file_diff`（HEAD vs workdir+index；untracked 有全 Added fallback），前端从 hunk 推导行映射 —— **方案 A，零后端改动**（调研见 `research/gutter-diff-survey.md`，设计权衡见 `design.md` §7）。
- **呈现**：独立 `cm-change-gutter` 薄列 + StateField/Decoration 旁路扩展；**不改** `gutter/registry.ts` 既有语义。
- **设置**：`AppConfig` 加可选布尔，默认开；config.json 透传，Rust 零改动。
- **刷新**：既有事件 `git-status-snapshot` / `git-changed` / `file-changed`，不新增事件。
- 原型评审通过；删除行编辑器内不渲染（DiffView 承担）。

## Requirements

### R1 行级数据派生（git 域）

纯函数 `deriveFileLineChanges(DiffResult) -> FileLineChange[]`：new 侧行号映射；Removed+Added 邻接配对得 `modified`+词级 `WordRange[]`，多余 Added 为 `added`；孤立 Removed 不产出；Collapsed 推进语义与既有 diff 行号算法一致；去重、升序、容忍 `truncated`。类型落 `shared/types/git.ts`，经 git facade 导出。

### R2 呈现（editor 域）

- 最左 4px 变更条：绿/蓝、连续段首尾圆角、hover 提示；无点击语义。
- 行背景：added/modified 低透明度着色；modified 行词级片段高透明度底。
- 单一 `StateField`+`StateEffect` 数据通道；扩展 memo 仅依赖配置，禁止高频 reconfigure。
- editor 只消费 `FileLineChange[]`，不解析 hunk。

### R3 设置开关

`editorGitChangeHighlight?: boolean` 默认 `true`；`DEFAULT_CONFIG` + load 归一 + `EditorPanel` Switch；关闭即卸载扩展（零残留）。

### R4 刷新与生命周期

打开/切文件/`enabled` 打开时拉取；三类既有事件去抖重拉（path 匹配）；卸载与过期响应防陈旧；无模块级 diff 缓存。

### R5 共存与兼容

与断点/run/testStatus gutter 并存互不覆盖；深浅主题变量着色；旧 config 缺键回退默认开。

## Out of Scope

- staged/unstaged 双色、未保存 buffer diff、删除行占位、blame/author 装饰。
- 新后端命令、新 Tauri 事件、`@codemirror/merge`、DiffView 改造。
- Rust 侧任何代码变更。

## Acceptance Criteria

- [x] AC1 `deriveFileLineChanges` 单测覆盖 R1 全部分支（含 untracked fallback、配对边界、词级 LCS），`pnpm test:run` 绿。
- [ ] AC2 编辑器打开已修改文件：变更条颜色/圆角、行背景、词级高亮与原型一致；未改动文件零渲染。（待 `pnpm tauri dev` 手动）
- [ ] AC3 设置关 → 高亮立即消失；开 → 恢复；重载应用后状态保持（load 归一单测已绿；开关/重载待手动）。
- [ ] AC4 外部 `git`/写盘操作后，已打开文件高亮在去抖窗口内自动刷新；切 tab 不串数据。（事件单测已绿；目视待手动）
- [x] AC5 断点/运行/测试 gutter 行为无回归（既有 gutter 测试全绿；未改 registry/useUnifiedGutter）。
- [x] AC6 全量门：`pnpm type-check`、`pnpm lint:fe`、`pnpm test:run`、`pnpm lint`、`cargo test` 全部通过。
- [x] AC7 架构边界：editor 无 diff 解析（`loadFileLineChanges` 在 git 域）、git 无 CM 导入、`useEditorExtensions`/`useUnifiedGutter`/`registry` 无高频数据污染、无新事件名（常量走 `@/shared/events`）、invoke 仅在 `git/api`。

## Constraints

- 遵循 Import/Export Firewall（跨 feature 仅 `store/`/`types/`/`api/` + facade）。
- TDD：每阶段先红后绿；`implement.md` 阶段顺序不可倒。
- 不自动 commit；回滚优先设置开关，其次 revert 前端增量（见 `implement.md` 回滚点）。

## Open Questions

无阻塞项。（staged 双色、buffer diff 已明确移出范围。）
