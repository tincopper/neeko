# PR#10: Skill detail panel and create skill wizard

## 概述

实现两个功能：
1. **Skill 详情面板** — 点击 Skill 后展示 SKILL.md 内容预览、tag 编辑、tool toggle 开关
2. **创建 Skill 向导** — 在 central repo (~/.neeko/skills/) 创建新 Skill 目录 + SKILL.md 模板

## 依赖

- PR#9: 本地 Skill 面板（提供 Skill 列表入口）

## 参考项目

- `skills-manager/src/components/SkillDetailPanel.tsx` — Slide-over 面板
- `skills-manager/src/components/SkillMarkdown.tsx` — Markdown 渲染

## 需求

### 1. Skill 详情面板

点击 SkillCard 后，右侧展开详情面板（slide-over 或 inline expand）：

```
┌─────────────────┬───────────────────────┐
│ Skill List      │ 📄 skill-name         │
│                 │ Source: local          │
│ [selected] ────►│ Path: ~/.neeko/skills/ │
│                 │                       │
│                 │ ── SKILL.md ──────── │
│                 │ (Markdown preview)    │
│                 │                       │
│                 │ ── Tags ─────────── │
│                 │ [#tag1] [#tag2] [+]  │
│                 │                       │
│                 │ ── Tool Toggles ──── │
│                 │ ☑ Claude Code         │
│                 │ ☑ Cursor              │
│                 │ ☐ Codex               │
│                 │                       │
│                 │ [Open Folder] [Delete] │
└─────────────────┴───────────────────────┘
```

#### 功能：

1. **SKILL.md 预览**
   - 调用 `get_skill_document(skill_id)` 获取内容
   - 使用现有 MarkdownPreview 组件渲染
   - 显示 name, description, source_type, central_path

2. **Tag 编辑**
   - 显示当前 skill 的 tags
   - 支持添加新 tag（输入框 + Enter 确认）
   - 支持删除 tag（点击 × 移除）
   - 调用 `set_skill_tags_cmd(skill_id, tags)`

3. **Tool Toggle**（在 TagGroup 上下文中）
   - 显示所有已安装工具的开关
   - 调用 `set_skill_tool_toggle_cmd(tag_group_id, skill_id, tool, enabled)`
   - 仅在有 active tag group 时展示

### 2. 创建 Skill 向导

#### 后端新增命令

```rust
#[tauri::command]
pub async fn create_skill(
    name: String,
    description: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<ManagedSkillDtoOut, String>
```

逻辑：
1. `sanitize_skill_name(name)` 验证名称
2. 在 `~/.neeko/skills/{name}/` 创建目录
3. 生成 SKILL.md 模板：
   ```markdown
   ---
   name: {name}
   description: {description}
   ---
   
   # {name}
   
   Write your skill instructions here.
   ```
4. 计算 content_hash
5. 写入 skills 表（source_type: "local"）
6. 返回 ManagedSkillDto

#### 前端 UI

在 PanelHeader 中添加 "Create" 按钮，弹出对话框：

```
┌──────────────────────────────────┐
│ Create New Skill                 │
├──────────────────────────────────┤
│ Name:  [________________]       │
│ Desc:  [________________]       │
│                                  │
│           [Cancel] [Create]      │
└──────────────────────────────────┘
```

创建后自动打开详情面板，用户可以编辑 SKILL.md。

### 3. TypeScript 类型扩展

```typescript
// 新增到 types.ts
export interface CreateSkillParams {
  name: string;
  description?: string;
}
```

## 验收标准

- [ ] 点击 SkillCard 展开详情面板
- [ ] 详情面板展示 SKILL.md Markdown 预览
- [ ] Tag 编辑功能（添加/删除 tag）
- [ ] Tool Toggle 开关功能
- [ ] "Create" 按钮弹出创建对话框
- [ ] 创建新 skill 后自动添加到列表
- [ ] 新 skill 目录和 SKILL.md 正确生成
- [ ] `cargo check` + `npx tsc --noEmit` 通过

## 不包含

- SKILL.md 内联编辑器（可未来扩展）
- Skill 导出/分享功能
