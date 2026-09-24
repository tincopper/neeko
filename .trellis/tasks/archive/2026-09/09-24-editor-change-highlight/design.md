# 设计：源码行级变更高亮（IDEA 风格）

任务：`.trellis/tasks/09-24-editor-change-highlight` · 原型已确认 · git 口径已确认（相对 HEAD 单档）

## 1. 第一性原理问题分析

### 1.1 问题重述

用户在编辑器中阅读/修改源码时，必须不切换视图就能回答：「**当前文件里，哪些行相对上一次提交被改动了？**」

（剥离实现细节：这是在二维文本视图上标注「变更存在性」的空间感知问题，不是 diff 内容审阅问题——内容审阅已由 DiffView 承担。）

### 1.2 基本事实

| 类别 | 事实 |
|---|---|
| 材料唯一来源 | git 中「工作区+暂存 vs HEAD」的差异已落盘可查；无需发明数据 |
| 行号对齐 | 编辑器可见行 = diff 的 **new 侧**；删除行不占编辑器行位 |
| 数据口径（已确认） | 单档：相对 HEAD（工作区+暂存合并），与 `get_file_diff`、文件树徽标、DiffView 一致 |
| 缓冲区边界 | 高亮是 **VCS 快照语义**：磁盘保存/外部变更后刷新；**未保存 buffer 不计入**（三处同口径，最少惊讶） |
| 性能 | 拉取是按文件、低频的（打开 + VCS 事件）；**按键路径上不得重算数据或 reconfigure 扩展** |
| IPC | 单次 JSON ≤ 2MB；行映射只需 `(line, kind, words?)`，hunk 载荷已是 O(变更区+3 行 context)，足够且远小于红线 |
| 交互分层 | 变更条是**被动状态指示**（无点击语义）；断点/run/test 是**交互图标**——职责不同 |
| 展示三级 | 文件级（已有徽标）→ **行级存在性（本任务）** → 内容对照（DiffView 已有）；词级是行内增强，数据与行级同源 |

### 1.3 假设挑战

| 假设 | 裁决 |
|---||---|
| 「必须新增 unified=0 后端命令」 | **否（YAGNI）**。`get_file_diff` 返回的 Added/Removed 已含行映射与词级配对所需全部材料，载荷 O(变更区)。方案 A 零后端、零新 API 面。derive 纯函数隔离数据源，日后载荷/截断成为实证问题再升方案 B（换 hook 实现，渲染层不动 = OCP） |
| 「必须塞进 GutterContribution registry」 | **否**。registry 服务交互贡献（同行与断点抢 cell、居中布局、冲突表）。变更条要独立左列、连续段圆角、零点击——塞入是错位耦合。独立薄列，高内聚拆分 |
| 「需要区分 staged / unstaged 多色」 | **否（已确认）**。单口径对齐文件树与 DiffView；`kind` 枚举可日后扩变体，渲染 `match` 强制处理 |
| 「要实时反映未保存编辑」 | **否**。与文件树/DiffView 统一为磁盘快照；实时 buffer diff 是另一个产品问题（YAGNI） |
| 「词级要独立数据源」 | **否**。词级 = 同一 hunk 内 Removed/Added 块配对 + 词级 LCS，与行级一次拉取同源 |

### 1.4 从真理构建（最小机制）

1. 打开文件 → 调既有 `get_file_diff` → 纯函数推导 `FileLineChange[]` → `StateEffect` 写入常驻 `StateField`。
2. Field 同时喂三个渲染面：左缘变更条（独立 gutter）、行背景 Decoration、修改行词级 Decoration。
3. VCS 事件（既有常量）去抖重拉当前打开文件；设置开关关闭 = 派发空数据/卸载扩展。
4. 之后的每个复杂度都必须回答「哪条事实要求它」——当前无更多要求。

## 2. 架构与边界（高内聚 / 低耦合 / 开闭）

```
┌─ git feature（数据域：diff 语义归 git 所有）────────────────┐
│  api/gitApi.ts            既有 invoke get_file_diff         │
│  utils/lineChange.ts      纯函数 DiffResult → FileLineChange│  ← 可测 100%
│  api/fileLineChange.ts    拉取 + 推导一体（IPC seam）         │
│  index.ts (facade)        公开组件/hooks 门面（类型/types 直导）│
└──────────────────────────┬───────────────────────────────────┘
                           │ 类型契约 FileLineChange[]（shared/types/git.ts）
                           │ 跨 feature 只经 types 直导 / api/ 白名单（防火墙）
┌─ editor feature（呈现域：只上色，不理解 diff）────────────────┐
│  git-change/index.ts      StateField+Effect+Decoration+gutter│
│                           │（单文件模块门面，引用稳定工厂）    │
│  hooks/useGitChangeEditor.ts    装配：开关 + 事件去抖 + 派发   │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌─ settings（开关）─────────▼───────────────────────────────────┐
│  AppConfig.editorGitChangeHighlight?: boolean（默认 true）    │
│  EditorPanel Switch → AppContext → FileViewer → FileEditor    │
└───────────────────────────────────────────────────────────────┘
```

**边界规则**

1. editor **禁止**解析 `DiffResult`/hunk/`DiffLine`；只消费 `FileLineChange[]`（低耦合）。
2. git **禁止** import editor 的 CM/Decoration 类型；hook 只吐纯数据（低耦合）。
3. `invoke` 仅在 `git/api/gitApi.ts`（既有封装，api-layer spec）。
4. 不修改 `gutter/registry.ts`、`contribution.ts`、`useUnifiedGutter.ts` 的既有语义——变更条是**旁路新增扩展**，与断点列并存（对扩展开放，对修改关闭）。
5. 不新增 Tauri 事件（复用 `git-status-snapshot` / `git-changed` / `file-changed` 常量，红线 5）。
6. 不改 Rust（方案 A）；`cargo` 侧零 diff。

## 3. 数据契约

```ts
// src/shared/types/git.ts（追加）
export type LineChangeKind = 'added' | 'modified';
/** 行内词片段，偏移相对该行纯文本（UTF-16 code unit，与 CM 一致）。 */
export interface WordRange { from: number; to: number }
export interface FileLineChange {
  /** 1-based，diff new 侧 = 编辑器行号 */
  line: number;
  kind: LineChangeKind;
  /** 仅 kind=modified 时可选；无配对（如纯新增行）则缺省 */
  words?: WordRange[];
}
```

**推导规则（`deriveFileLineChanges(diff: DiffResult): FileLineChange[]`）**

- 遍历 hunks：从 `new_start` 起维护 `newLine`；`Context`/`Added` 推进 `newLine`，`Removed` 不推进（占 old 侧），`Collapsed` 按文本内计数跳过（复用 `diffText.ts:56-57` 既有语义，实现内置自测对齐）。
- 每遇到 `Added` 行 → 记 `kind: 'added'`（无 words）。
- **词级配对**：同一 hunk 内连续 `Removed*` 块后紧跟 `Removed` 邻接的 `Added*` 块 → 按索引逐行配对（`min(len)`）；配对成功 → `kind: 'modified'` + 词级 LCS 差分 `words`；`Added` 块剩余行 → `kind: 'added'`。孤立 `Removed`（纯删除）→ 不产出条目（编辑器无该行）。
- 同行去重（后写覆盖）；结果按 `line` 升序。
- `truncated: true` → 仍返回已得部分（不完整视图，见 §6）；untracked fallback hunk（全 Added）自然覆盖。
- 空 `hunks` → `[]`。

**词级 LCS**：行内按「词」（`\w+` | 非空白 | 空白串）分段做标准 LCS，输出新增/替换侧 `WordRange`。实现放 git 域 `lineChange.ts`（不依赖 DiffView 内部 `diffAlgorithm.ts`——防火墙禁止跨 feature 直导组件内部；重复的 LCS 若三处出现再按 DRY 提 `shared/utils`，当前 DiffView 自有一份、本任务新写一份 = 2 处，不强制抽）。

## 4. 呈现层设计

### 4.1 状态通道（防 reconfigure）

```ts
// editor/git-change/index.ts（单文件模块门面：field + effect）
export const setFileLineChangesEffect = StateEffect.define<readonly FileLineChange[]>();
export const fileLineChangesField = StateField.define<readonly FileLineChange[]>({
  create: () => [],
  update(lines, tr) {
    for (const e of tr.effects) if (e.is(setFileLineChangesEffect)) return e.value;
    return lines;
  },
});
```

- 扩展数组 memo 仅依赖 `enabled` 等配置输入，**引用终身稳定**；数据更新只走 `view.dispatch({ effects: … })`。
- 禁止把 `FileLineChange[]` 本身或 fetch Promise 接进 `useEditorExtensions` / 扩展 memo。

### 4.2 变更条（独立薄列）

- `gutter({ class: 'cm-change-gutter', markers })`：markers 读 `fileLineChangesField`，每变更行一个 `GutterMarker`。
- 列宽 4px；颜色 `var(--diff-added)` 语义映射到 `--accent-green` / `--accent-blue`（对齐 `gitFileDecoration.ts` JetBrains 色：绿=新增、蓝=修改；具体 class 落 `src/styles/components/editor.css` 或 CM theme）。
- **连续段圆角**：marker 渲染时查 field 中 `line-1` / `line+1` 是否同 `kind` → `seg-start` / `seg-end` class（纯读 field，O(1) map 预构建一次 per markers() 调用）。
- hover tooltip：`title="已修改 · git 工作区 vs HEAD"` / `"新增行 · 相对 HEAD 为新增"`。
- **无 onClick**，不注册进 `gutterContributions` facet，不参与冲突表；与 `cm-breakpoint-gutter` 并列（扩展顺序置于 unified gutter **左侧**，对齐 IDEA 最左变更条）。
- 设置关闭 / 数据空 → 无 marker，列退化为空（不卸载列亦可，零视觉；或扩展工厂按 `enabled=false` 返回 `[]`——选后者更干净）。

### 4.3 行背景 + 词级 Decoration

- 同一 field 上 `provide: EditorView.decorations.from(...)` 构建 `DecorationSet`：
  - `kind=added` → `Decoration.line({ class: 'cm-git-line-added' })` 覆盖该行；
  - `kind=modified` → `Decoration.line({ class: 'cm-git-line-modified' })`；
  - `words[]` → `Decoration.mark({ class: 'cm-git-word' })` 区间（裁剪到该行 `from..to`，越界防御性 clip）。
- CSS：背景低透明度（原型 `line-added/line-mod` 同款），词级稍高透明度；类名进 `editor.css`，颜色走主题变量（深浅主题自动）。
- 删除行：**不渲染任何占位**（与 IDEA 一致；DiffView 承担）。

### 4.4 单一扩展工厂

```ts
// editor/git-change/index.ts（feature 内单文件模块门面）
export function createGitChangeExtensions(enabled: boolean): Extension[] {
  if (!enabled) return [];
  return [fileLineChangesField, lineChangeDecorations, changeGutter];
}
```

- `FileEditor.tsx` 中与 `bpGutterExt` 并列组装，`enabled` 来自 `config.editorGitChangeHighlight !== false`。
- **不改动** `useEditorExtensions` 的既有依赖数组语义；`enabled` 是低频配置，变化时 reconfigure 一次可接受。

## 5. 数据流与刷新时机

```
[打开/切换 tab / enabled 0→1]
    → useGitChangeEditor（editor 侧装配 hook）
    → loadFileLineChanges（git/api）→ invoke get_file_diff(collapse: false)
    → deriveFileLineChanges
    → view.dispatch(setFileLineChangesEffect.of(data))

[GIT_STATUS_SNAPSHOT_EVENT / GIT_CHANGED_EVENT]      // 既有常量，不新增
    → 去抖 300ms（hook 内部，直接 listen + 卸载解除）
    → KISS：命中本项目即重拉单文件 → 同上派发

[FILE_CHANGED_EVENT（保存/外部写盘）]
    → 经共享 useFileChangedEvent（单 IPC 订阅 + refcount）
    → 若 pathsContainFile 命中当前 tab 路径 → 同一去抖窗口重拉

[enabled true→false] → 扩展工厂返回 [] → reconfigure 卸载（或派发空数组，二选一：选 reconfigure 卸载，零残留 DOM）
[组件卸载] → 取消订阅/忽略过期响应（generation token，参照 refreshGitFileStates 范式）
```

- **缓存**：仅 React 组件态 + CM field；**禁止**模块级跨挂载 diff 缓存（`git-domain.md`）。
- 多 tab：每个 FileEditor 实例各自 hook 只服务自己的文件；不做全局行状态 store（状态就近，YAGNI）。

## 6. 兼容、边界与回滚

| 场景 | 行为 |
|---|---|
| 二进制/超大只读 | 编辑器已有门控；`enabled` 仍可拉，`truncated` 时展示已有部分；体积超限后端已截断 |
| `truncated: true` | 行映射可能不完整——接受（与 DiffView 截断语义一致）；不另弹提示（YAGNI） |
| 文件未变更 | `[]`，零渲染 |
| worktree 切换/项目切换 | hook 依赖 `projectId+absPath`，变化即重置并重拉 |
| 旧 config 无新键 | load 归一默认 `true`；`?` 可选字段，serde 透传无迁移 |
| 回滚 | ① 设置关 = 功能卸载；② 前端 commit revert（无存储格式、无后端、无事件，回滚面 = 本任务新增的前端文件 + 少量装配点） |

## 7. 关键权衡（已决）

1. **方案 A（前端推导）vs B（新 unified=0 命令）** → A。零后端、复用已测路径；B 的「更紧凑」在 O(变更区) 载荷下无实证收益。升级点收敛在 `loadFileLineChanges` 一处。
2. **独立薄列 vs GutterContribution** → 独立薄列。被动状态与交互图标职责分离；registry 零改动。
3. **staged 双色** → 不做（用户已确认）；`LineChangeKind` 枚举留扩。
4. **词级与行级同期交付** → 是（同一数据、原型含词级）；实现清单里作为独立里程碑，可单独回退（关掉 words 渲染不影响条/背景）。
5. **不新增事件/命令/存储** → 红线触达面最小。

## 8. 测试策略（指向 implement.md 细节）

- `deriveFileLineChanges` + 词级 LCS：纯函数表驱动，覆盖 Context/Added/Removed/Collapsed/untracked 配对/truncated/空/去重（Tier 1，100%）。
- field/effect/decoration：`EditorState` 单测（effect 覆盖、Decoration 区间合法性）。
- changeGutter markers + 圆角段：仿 `registry.test.ts` harness。
- `useGitChangeEditor`：mock `gitApi.getFileDiff` + 事件 emit，断言去抖与 generation 防陈旧；`file-changed` 走共享 `useFileChangedEvent` 订阅入口。
- 设置 load 归一：既有 `useAppConfig` 测试模式补默认值用例。
- 无 Rust 测试（方案 A 零后端变更；回归仍跑 `cargo test` 作护栏）。
