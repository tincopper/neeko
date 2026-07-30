# 资源库管理 Phase 2 · 执行计划

> 任务：`07-30-resource-library-p2`
> 前置：`prd.md` + `design.md`

---

## 阶段划分

### Step 1 — Action 入库

- [ ] 1.1 `actions` 表 migration（v4→v5）
- [ ] 1.2 后端 6 命令：save/list/get/update/delete/run
- [ ] 1.3 前端：ActionListSection + ActionEditorDialog + ActionsTabContent
- [ ] 1.4 Action 执行分发（run_action 根据 payload 类型）

### Step 2 — 导入/导出

- [ ] 2.1 后端：export_library_bundle + import_library_bundle
- [ ] 2.2 前端：LibraryHeader 导入/导出按钮 + 冲突确认对话框

### Step 3 — 变量填充

- [ ] 3.1 `resolveVariables` 方法（libraryStore）
- [ ] 3.2 VariableDialog 组件
- [ ] 3.3 Insert 流程中变量检测

### Step 4 — usage/recent + Action Palette 动态化

- [ ] 4.1 sortMode 状态 + 排序逻辑
- [ ] 4.2 `libraryActionProvider` 实现（动态 Palette 项）
- [ ] 4.3 最近 5 项展示

---

## Review Gates

- 每步结束：`pnpm type-check` + `cargo check` 通过
- 全量结束：`pnpm lint:fe` + `cargo test` 全绿
- 验收标准 10 项全部达成

## 关键文件

| 文件 | 角色 |
|------|------|
| `src-tauri/src/skill/migrations.rs` | v4→v5 |
| `src-tauri/src/skill/commands.rs` | action + bundle 命令 |
| `src-tauri/src/skill/repository.rs` | actions CRUD + bundle |
| `src/features/library/components/ActionListSection.tsx` | Action 列表 |
| `src/features/library/components/ActionEditorDialog.tsx` | Action 编辑器 |
| `src/features/library/components/VariableDialog.tsx` | 变量表单 |
| `src/features/library/store/libraryStore.ts` | resolveVariables + sortMode |
| `src/features/action-menu/providers/libraryActionProvider.ts` | 动态 Provider |
