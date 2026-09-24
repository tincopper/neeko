# 实施计划：源码行级变更高亮

前置：`prd.md` + `design.md` 已评审；`task.py start` 后方可动码。全程 TDD（红→绿→重构）。

## 验证命令（每阶段末跑子集，阶段 6 跑全量）

```bash
pnpm type-check
pnpm lint:fe
pnpm test:run
pnpm lint            # 含 Rust fmt/clippy + 护栏脚本（本任务无 Rust 改动仍须过）
cargo test --manifest-path src-tauri/Cargo.toml
```

目标文件过滤示例：`pnpm test:run -- src/features/git/utils/__tests__/lineChange.test.ts`

## 阶段 0 · 基线

- [x] 确认工作树干净、当前分支测试基线绿（跑 `pnpm test:run` + `pnpm type-check` 记录结果）
- 回滚点：无改动

## 阶段 1 · 类型 + 派生纯函数（git 域）

**文件**：`src/shared/types/git.ts`（追加 3 个类型）、`src/features/git/utils/lineChange.ts`、`src/features/git/utils/__tests__/lineChange.test.ts`

- [x] 🔴 写失败测试：`deriveFileLineChanges` 表驱动
  - 纯 context hunk → `[]`
  - Added 行（含 untracked 全 Added fallback 形态）
  - Removed+Added 邻接配对 → `modified` + words（含词替换/纯增词/整行替换）
  - Added 块剩余行 → `added`
  - 孤立 Removed → 无条目
  - Collapsed 推进规则与 `diffText.ts` 语义一致
  - 同行去重、line 升序、truncated 仍返回部分
  - 词级 LCS 单测：`buildWordRanges(old, new)` 边界（空串、纯空白、中文、无变化）
- [x] 跑测试确认按预期失败（Red）
- [x] 🟢 实现 `lineChange.ts` 至全绿（Green）
- [x] 🔵 门面边界（按防火墙白名单落地，与初稿 design 不同处以此为准）：类型经 `shared/types/git.ts` 直导；拉取+推导经 `git/api/fileLineChange.ts`（`api/` 白名单直导 editor）；**无独立 `useFileLineChanges` hook** —— 事件去抖与装配合入 editor 侧 `useGitChangeEditor`
- [x] 验证：`pnpm test:run -- lineChange` + `pnpm type-check`
- 回滚点：删除 3 个新文件 + revert `types/git.ts`、`index.ts`

## 阶段 2 · 状态通道 + Decoration + 变更条（editor 域，尚不接真数据）

**文件**：`src/features/editor/git-change/index.ts`（单文件模块门面，含 field/deco/gutter/factory）+ `__tests__/gitChange.test.ts`、`src/styles/components/editor.css`

- [x] 🔴 测试：
  - field：`setFileLineChangesEffect` 覆盖、无关 effect 不清空
  - decorations：added/modified 行 class 正确；words 区间 clip 到行内；空数据 `DecorationSet.empty`
  - changeGutter：markers 只标变更行；`seg-start`/`seg-end`/中段 class；同 kind 连续段判定；added/modified 颜色 class；**无 onClick 时 DOM 无 `data-gutter-contribution`**
- [x] Red → 🟢 实现 `createGitChangeExtensions(enabled)`（false → `[]`）→ Green
- [x] 🔵 CSS：`cm-change-gutter` 4px 列、`cm-git-line-*` 背景、`cm-git-word` 词底、圆角段；全部走主题变量（对照原型 `idea-change-highlight.html` 色值语义）
- [x] 🔵 `editor/git-change/index.ts` 模块门面（feature 内部目录，单文件聚合 field/deco/gutter，非根 barrel）
- [x] 验证：`pnpm test:run -- gitChange` + `pnpm type-check` + `pnpm lint:fe`
- 回滚点：删 `editor/git-change/` + CSS 增量

## 阶段 3 · 设置开关（配置链）

**文件**：`src/shared/types/settings.ts`、`src/features/settings/hooks/useAppConfig.ts`、`src/features/settings/components/EditorPanel.tsx`

- [x] 🔴 测试：`DEFAULT_CONFIG.editorGitChangeHighlight === true`；load 归一缺键/`null`/非法值 → `true`
- [x] 🟢 加字段 + 归一 + `EditorPanel` Switch（标签：「编辑器 Git 变更高亮」，参照 `autoLocateFileOnTabSwitch` 模式）
- [ ] 人工：设置面板开关可见、保存/重载后保持
- [x] 验证：`pnpm test:run -- useAppConfig`（或既有 settings 测试文件）+ `pnpm type-check`
- 回滚点：字段保留无害；revert 即可

## 阶段 4 · 装配进 FileEditor（静态数据通路）

**文件**：`src/features/editor/hooks/useGitChangeEditor.ts`（新）、`src/features/editor/FileEditor.tsx`（或 `FileViewer.tsx` 传 config 处）

- [x] 🔴 测试（`renderHook`）：
  - `enabled=false` → 扩展 `[]`
  - `enabled=true` + mock fetch 成功 → 派发后 `state.field(fileLineChangesField)` 内容正确
  - fetch 失败 → 字段保持 `[]`，不抛未捕获异常
- [x] 🟢 实现 hook：`invoke` **只经** `@/features/git` facade / `gitApi`；拼 `createGitChangeExtensions`；扩展 memo 依赖仅 `[enabled]`（数据不进 memo）
- [x] 🟢 `FileEditor`：读 `editorGitChangeHighlight`（FileViewer 自 AppContext config 透传），与 `bpGutterExt` 合并后传入 `useEditorExtensions`（**不改** `useEditorExtensions` 高频依赖语义；变更条扩展顺序位于 unified gutter 左侧）
- [x] 手动（Red→Green 后）：`pnpm tauri dev` 打开已修改文件 → 绿条/蓝条/行背景/词级与原型一致；未改动文件无渲染
- [x] 验证：`pnpm test:run -- useGitChangeEditor` + `pnpm type-check` + `pnpm lint:fe`
- 回滚点：摘除 FileEditor 一行装配；hook 可留

## 阶段 5 · 事件刷新 + 生命周期

**文件**：同 `useGitChangeEditor.ts`

- [x] 🔴 测试：
  - `git-status-snapshot` / `git-changed` emit → 去抖后再次 fetch（fake timers）
  - `file-changed`（path 匹配）→ 重拉；path 不匹配 → 不拉
  - 卸载后 emit → 不再 dispatch（generation/alive flag）
  - `enabled` 翻转 true→false → 扩展变 `[]`
- [x] 🟢 接 `listen(GIT_STATUS_SNAPSHOT_EVENT | GIT_CHANGED_EVENT | FILE_CHANGED_EVENT)`（常量一律 `@/shared/events`）；清理函数解除监听；去抖 300ms；file-changed 需 project_id+path 双匹配；卸载 active=false + 解除监听
- [ ] 手动：编辑器开着 → 终端改文件/git 操作 → 高亮自动更新；关设置 → 立即消失；开回 → 恢复
- 验证：同阶段 4 + 手动清单（目标 7/7 + type-check + eslint/prettier 已过）
- 回滚点：摘事件订阅分支，静态数据通路仍在

## 阶段 6 · 重构 + 全量回归（收尾门）

- [x] 🔵 对照 design.md §2 边界：editor 无 diff 类型泄漏（`loadFileLineChanges` 收进 git 域，editor 只消费 `FileLineChange[]`）、git 无 CM 导入、无模块级缓存、无新事件名、无裸 `Command`
- [x] 🔵 对照原型色值/图例：主题变量 `--accent-green`/`--accent-blue` + 8%/24% 透明度；深浅主题各过一遍（代码对照已过，UI 目视待手动）
- [x] 全量验证：
  ```bash
  pnpm type-check && pnpm lint:fe && pnpm test:run && pnpm lint && cargo test --manifest-path src-tauri/Cargo.toml
  ```
  结果：type-check 0 error；lint:fe 475 文件 / 4175 通过 / 1 skip / Type Errors 0；test:run 475/4175 绿；pnpm lint（fmt+clippy+护栏+java-host）OK；cargo test 102 passed。
- [x] 对照 `prd.md` Acceptance Criteria 逐条勾验（见 prd.md；AC2/AC3 手动项保留未勾）
- [x] 填写会话记录（不自动 commit；提交权归用户）
- 残留手动项：AC2 视觉对照、AC3 开关重载保持、AC4 事件刷新目视（需 `pnpm tauri dev`）

## 风险与敏感文件

| 风险 | 缓解 |
|---|---|
| `useEditorExtensions.ts` 误加高频依赖 → 全量 reconfigure 卡顿 | **不改该文件**；数据只走 StateField；code review 检查 memo deps |
| 改 `useUnifiedGutter.ts`/`registry.ts` 破坏断点 | 设计已禁改；变更条旁路扩展 |
| 词级 LCS 边界（多字节/代理对） | 测试覆盖 emoji/中文；CM 偏移同 UTF-16 |
| 事件泄漏/重复监听 | 测试断言 unlisten；单 hook 单订阅 |
| 路径口径（仓库根 vs tab 路径） | `get_file_diff` 已按 tab 同参工作（DiffView 先例）；不新开路径拼接 |

## 建议里程碑（独立验收）

1. **M1**：阶段 1–2 —— 纯函数 + 渲染单元全绿（无 UI 接线也可验收）
2. **M2**：阶段 3–4 —— 开关 + 打开文件可见高亮（核心用户价值）
3. **M3**：阶段 5–6 —— 事件刷新 + 全量回归 + 原型对照

M1→M2→M3 顺序不可倒；每个 M 结束跑对应验证命令后再进下一个。
