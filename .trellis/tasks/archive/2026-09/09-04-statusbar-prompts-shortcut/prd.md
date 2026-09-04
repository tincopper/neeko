# StatusBar prompts 快捷入口（terminal 追加插入）

## Goal

StatusBar 右簇新增 prompts 快捷入口：下拉列出 library 中的 prompts（name + 描述），点击后经变量渲染，以追加方式键入活动 terminal PTY，不自动执行。agent-chat 写入本期不做。
## Requirements

1. StatusBar 右簇 `NotificationButton` 之前新增 prompts 按钮（lucide 图标 12px 系，经 `shared/icons` 入口）；无 `activeProjectId` 时隐藏（同 Console/Debug 门控）。
2. 下拉面板：搜索框 + 列表行（主标题 `name` truncate，副标题描述 11px muted truncate）+ 空态引导。
   - 描述规则：`description` 优先，为空回退 `content.slice(0,120).replace(/\n/g, ' ')`。
   - 排序：favorite 置顶 + `lastUsedAt` 倒序；过滤复用 `PromptInsertDialog` 逻辑（name/slash/description/tags），`slice(0, 20)`。
   - 数据源：`useLibraryStore.prompts`，空时调一次 `refreshPrompts()`。
3. 点击行：`recordUsage(id)` → `detectVariables` 有变量则弹 `openVariableDialog` 渲染（取消则不插入）→ 插入。
4. 插入语义：追加键入活动 terminal，不自动回车；多行 content 用 bracketed-paste 包裹（`\x1b[200~…\x1b[201~`）整段插入，不逐行执行。
5. 首版支持 local + WSL + SSH（按项目环境分发到各自 terminal cache）。
6. 无活动终端时纯 toast 提示，不降级 clipboard；插入成功静默（内容已直观落在终端里）。

## Acceptance Criteria

- [ ] 有项目时按钮可见，无项目时隐藏；点击弹出带搜索的 prompts 列表
- [ ] 行显示 name + 描述（含 description 为空时的 content 兜底）
- [ ] 单行 prompt 键入后留在输入缓冲，未执行
- [ ] 多行 prompt 整段进入多行缓冲，零行被执行
- [ ] 含 `{{var}}` 的 prompt 先弹变量框，确认后插入，取消不插入
- [ ] WSL / SSH 项目下可插入；无会话时 toast 而非静默丢失
- [ ] `pnpm lint`、`pnpm type-check`、`pnpm test:run` 通过

## Non-goals

- agent-chat 输入框写入；prompt CRUD；slash 解析；多行二次确认
