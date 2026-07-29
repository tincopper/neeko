# 资源库管理动作 · 执行计划

> 任务：`07-29-resource-library`
> 前置：`prd.md`（需求）/ `design.md`（技术设计）/ `prototypes/resource-library.html`（交互原型）
> 状态：planning → 待 `task.py start` 进入 in_progress

---

## 阶段划分

### Phase 1 — Library 壳 + Prompts CRUD + Action 入口

目标：用户可从 Action Palette 打开 Library、切换 Skills/Prompts、创建并 Insert Prompt。

- [ ] 1.1 新增 `features/library` 壳层（LibraryPanel + libraryStore）
- [ ] 1.2 内嵌现有 `SkillsPanel` 为 Skills tab（不重写 skill 业务逻辑）
- [ ] 1.3 Prompts 后端：`prompts` 表 + `list_prompts` / `get_prompt` / `save_prompt` / `delete_prompt` / `use_prompt` 命令
- [ ] 1.4 Prompts 前端：PromptEditorDialog / PromptInsertDialog / PromptListSection
- [ ] 1.5 Action 入口：`open-resource-library` / `new-prompt` / `insert-prompt` 写入 actionRegistry
- [ ] 1.6 快捷键 `Ctrl/⌘+Shift+L` toggle Library
- [ ] 1.7 空状态 + 删除确认
- [ ] 1.8 列表/详情视图 + 标签过滤 + 搜索

验证：`pnpm test:run` 通过 · `pnpm type-check` 通过 · 原型主路径可走通

### Phase 2 — Action Palette 动态化 + 使用闭环

- [ ] 2.1 ActionProvider 机制（动态 actions 注入 Palette）
- [ ] 2.2 最近 Prompt（top N）出现在 Palette
- [ ] 2.3 Save as Prompt（Agent 输入多选 → Prompt）
- [ ] 2.4 Prompt 变量填充（`{{branch}}` + 上下文自动填充）
- [ ] 2.5 usage / recent 排序

验证：`pnpm test:run` · `pnpm lint:fe` · Palette 动态项可搜索到

### Phase 3 — Action 模板 + 导入导出

- [ ] 3.1 ActionResource 数据模型 + 后端命令
- [ ] 3.2 Action 模板入库 + Palette 执行
- [ ] 3.3 Library bundle import/export
- [ ] 3.4 项目级 Prompt 覆盖

验证：同上 + 新增单测

### Phase 4 — Themes / Media（按需）

- [ ] 4.1 对接 `features/theme`
- [ ] 4.2 Media 附件索引（可选）

---

## 关键文件

| 文件 | 角色 |
|------|------|
| `src/features/library/` | 新壳层（Panel/Store/Adapters） |
| `src/features/skill/` | 保持，Skills tab 内嵌现有内容 |
| `src/features/action-menu/actionRegistry.ts` | 新增静态 Action |
| `src/features/action-menu/providers/libraryActionProvider.ts` | 动态 Provider（P1） |
| `src-tauri/src/library.rs` | Prompt/Action 后端（新模块，复用 skill DB） 或扩展 `skill/` |
| `src/shared/types/library.ts` | ResourceSummary / PromptResource / ActionResource |

---

## Review Gates

- Phase 1 结束：原型 + 设计评审通过 · skill 回归测试通过
- Phase 2 结束：Palette 动态项可测 · usage 统计正确
- Phase 3 结束：导入导出双向通过 · 项目级覆盖逻辑单测
- 全量结束：`pnpm lint` + `cargo test` + `pnpm test:run` 全绿

## 回滚点

- Phase 1：若 Library 壳影响现有 Skills 面板，保留 `panelId: skills` 文案不变，仅内部重构
- Phase 2：ActionProvider 失败时回退到静态 Action（现有行为）
- 数据：新表 `prompts` / `actions` 独立，删除即回滚，不影响 skill DB
