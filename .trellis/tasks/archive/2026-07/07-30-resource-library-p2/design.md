# 资源库管理 Phase 2 技术设计

> 任务：`07-30-resource-library-p2`
> 前置：Phase 1（`07-29-resource-library`）已归档

---

## 1. Action 模板入库

### 1.1 数据模型

`shared/types/library.ts` 已有 `ActionResource` 定义，补充 `ActionPayload` 联合类型：

```ts
type ActionPayload =
  | { type: 'insert-prompt'; promptId: string }
  | { type: 'run-skill'; skillId: string }
  | { type: 'run-command'; command: string }
  | { type: 'open-panel'; panelId: string };

interface ActionResource {
  id: string;
  name: string;
  description?: string;
  group: 'terminal' | 'agent' | 'file' | 'git' | 'quick' | 'custom';
  payload: ActionPayload;
  shortcut?: string | null;
  tags: string[];
  enabled: boolean;
  usageCount: number;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}
```

### 1.2 后端

```sql
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  group TEXT NOT NULL DEFAULT 'custom',
  payload_json TEXT NOT NULL,  -- 序列化的 ActionPayload
  shortcut TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

命令：`save_action` / `list_actions` / `get_action` / `update_action` / `delete_action` / `run_action`

`run_action` 根据 `payload.type` 分发：
- `insert-prompt` → 查找 prompt 内容，返回给前端插入
- `run-skill` → 触发 skill 执行
- `run-command` → 写入活跃终端 PTY
- `open-panel` → toggle 指定 dock 面板

### 1.3 前端

- `ActionListSection.tsx`：复用 `PromptListSection` 的网格/列表双视图模式
- `ActionEditorDialog.tsx`：表单（name、description、group、payload 类型选择、command/promptId/panelId 输入、tags）
- `ActionsTabContent.tsx`：容器，组合 ActionListSection + ActionEditorDialog

### 1.4 Action Palette 动态 Provider

扩展 `libraryActionProvider`（Phase 1 已实现骨架）：
- 读取 `list_actions` + `list_prompts`，按 `last_used_at` 排序取 top 5
- 每项格式：`⚡ {name}`（Action）/ `💬 {name}`（Prompt）
- 执行时调用 `run_action` 或直接 insert prompt

---

## 2. 资源导入/导出

### 2.1 导出格式

```json
{
  "version": "1.0",
  "exportedAt": 1722288000000,
  "prompts": [ ... ],
  "actions": [ ... ]
}
```

### 2.2 后端命令

```rust
#[tauri::command]
pub fn export_library_bundle(path: String) -> Result<(), AppError>

#[tauri::command]
pub fn import_library_bundle(path: String, mode: String) -> Result<ImportResult, AppError>
// mode: "skip" | "overwrite"
```

`ImportResult`：

```ts
interface ImportResult {
  promptsImported: number;
  promptsSkipped: number;
  actionsImported: number;
  actionsSkipped: number;
}
```

### 2.3 前端

- `LibraryHeader.tsx` 增加"导入"/"导出"按钮（Prompts tab 显示）
- 导出：调用 `saveDialog` 选择路径 → `export_library_bundle`
- 导入：调用 `openDialog` 选择 JSON → 预览冲突 → 确认 → `import_library_bundle`

---

## 3. Prompt 变量填充

### 3.1 语法

`{{variable_name}}`，变量名仅支持字母数字+下划线。

### 3.2 预定义变量

| 变量 | 来源 | 自动填充 |
|------|------|----------|
| `{{branch}}` | `gitStore.activeBranch` | 是 |
| `{{projectName}}` | `projectStore.activeProject.name` | 是 |
| `{{filePath}}` | 当前活跃文件路径 | 是 |
| `{{projectPath}}` | `projectStore.activeProject.path` | 是 |
| 自定义 | 用户输入 | 否 |

### 3.3 交互流程

```
用户点击 Insert（含 {{var}} 的 Prompt）
    ↓
检测变量 → 弹出 VariableDialog
    ↓
自动填充已知变量，未知变量留空
    ↓
用户确认 → 渲染最终文本 → 插入
```

### 3.4 实现

- `VariableDialog.tsx`：表单，字段由变量列表动态生成
- `libraryStore.ts`：`resolveVariables(content, context)` 方法
- Insert 流程中插入变量检测步骤

---

## 4. usage / recent 排序

### 4.1 排序选项

```ts
type SortMode = 'recent' | 'frequent' | 'alphabetical';
```

### 4.2 前端

- `LibraryHeader.tsx` 排序下拉菜单
- `PromptListSection.tsx` / `ActionListSection.tsx` 按 `sortMode` 排序

### 4.3 Action Palette 动态区

- `libraryActionProvider` 读取最近 5 个资源（prompts + actions 合并按 last_used_at 排序）

---

## 5. 关键文件

| 文件 | 角色 |
|------|------|
| `src-tauri/src/skill/migrations.rs` | v4→v5 migration（actions 表） |
| `src-tauri/src/skill/commands.rs` | 新增 6 个 action 命令 + 2 个 bundle 命令 |
| `src-tauri/src/skill/repository.rs` | actions CRUD + bundle import/export |
| `src/features/library/components/ActionListSection.tsx` | Action 列表 |
| `src/features/library/components/ActionEditorDialog.tsx` | Action 编辑器 |
| `src/features/library/components/VariableDialog.tsx` | 变量填充表单 |
| `src/features/library/store/libraryStore.ts` | resolveVariables + sortMode |
| `src/features/action-menu/providers/libraryActionProvider.ts` | 动态 Palette 项 |

---

## 6. 开放问题

1. Action `run-command` 类型：是否需要确认步骤？（危险命令）
2. 导入冲突：是否支持"重命名"选项？
3. 变量是否支持默认值语法 `{{branch:main}}`？

---

## 7. 与 Phase 1 关系

- 复用 `prompts` 表，不修改
- 新增 `actions` 表独立
- 复用 `libraryStore` 扩展（+ sortMode + resolveVariables）
- 复用 `PromptListSection` 的网格/列表模式
