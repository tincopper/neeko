# Ctrl 悬停查看函数调用（Find Usages 入口）

> 状态（09-21 晚间 v2）：用户细化需求——`Ctrl+Click` 上下文感知：点**定义名**弹调用窗口（Find Usages），点**调用处**跳转到定义。徽标方案已删除，以下为当前有效需求。

## Goal

`Ctrl+Click`（macOS 按 `Cmd+Click`）根据点击位置自动分流：落在函数/方法**定义名**上时弹出该符号的被调用列表；落在**调用/引用处**时跳转到定义。交互对齐 VSCode / IDEA，且不新增手势、不占用新快捷键。

调用窗口采用 VSCode 式 Peek 形态（左列表右预览，见 `prototype/references-peek.html` 与 `design.md §6`），替代早期方案中的旧 `Find Usages` 弹窗。

用户价值：写代码时快速回答“这个函数谁在用”，无需记忆 `Shift+F12 / Alt+F7` 快捷键。

## Background（已确认事实）

- `Ctrl/Cmd+Click → 跳转定义` 已占用：`src/features/editor/hooks/useCmdClickGoToDefinition.ts:53` → `useLspDefinition.goToDefinitionWithContent` → `useLspNavigation.navigateToLocation`。
- `找引用` 传输与展示已跑通：`src/features/lsp/hooks/useLspDefinition.ts:166 findReferences`（`textDocument/references` 通用透传）→ `src/features/editor/hooks/useLspNavigation.ts:249 runFindRefs` → `symbolNavStore.openFindUsages` → `SymbolNavPalette`。快捷键 `Shift+F12 / Alt+F7` 已可用。
- `Ctrl+悬停下划线` 已存在：`src/features/lsp/hooks/useLspLinkHighlight.ts`（definition probe，150ms debounce，probe 永不 cancel 跳转）。
- `Ctrl 按住时 hover docs 被抑制` 是有意行为（避免遮挡点击目标）：`src/features/lsp/hooks/lspHoverExtension.ts:164` + `modKeyState.ts`。本次不复活 docs（点击分流复用 definition 结果，无悬停探针）。
- 后端无需新增 Tauri 命令：`lspRequest(projectPath, languageId, 'textDocument/references', …)` 已是通用透传。

## Requirements

### R1 交互（上下文感知 Ctrl+Click）
- [ ] `Ctrl/Cmd+Click` 先发 `textDocument/definition`（复用既有链路、缓存与 jdt 守卫）。
- [ ] 若定义目标即当前位置（同文档 + 点击落在定义名 range 内）→ 视为点在**定义名**上：发显式 `findReferences`，打开 VSCode 式 Peek 弹窗（标题带 `symbolHint`，空结果显示 `No references found`），不跳转。
- [ ] 否则（定义在别处）→ 视为点在**调用处**：走既有 `navigateToLocation` 跳转。
- [ ] 无定义结果时保持既有 `No Definition Found` 提示不变。
- [ ] F12 等键盘跳转保持纯跳转语义不变（本次只改鼠标链路）。

### R2 范围（已决策：不过滤，空结果即可）
- [ ] V1 不做客户端“仅函数”硬过滤：所有可导航符号统一发 `references` 请求，非函数自然返回 0/1 条。禁止按 `languageId` 分支判断是否为函数（红线 15）。
- [ ] jdt 展示路径（`jdt:/…` 无有效文档身份）不发请求，与 F12 / Ctrl+Click 守卫一致（`resolveLspDocumentUri` 返回 null 即跳过）。

### R3 性能与正确性
- [ ] 无新增悬停探针：分流复用本次点击已发出的 definition 结果，仅定义名命中时追加一次 `findReferences`。
- [ ] “是否定义处”判定为纯函数 `isOnDefinitionSite`（同文档 + 落在 range 内），jdt uri 与 file uri 各自归一比较。
- [ ] F12 / Shift+F12 链路不受影响；StrictMode 下无重复弹窗。

### R4 架构约束
- [ ] 前端-only 改动，不新增 Tauri 命令，不改后端 LSP 会话逻辑。
- [ ] 复用 `findReferences` 端口；跳转经**注入端口** `PeekNavigate`（editor 在 `openPeek` 时绑定 `navigateToLocation → NavigateGoal`；`openProjectFile` 读不了 `jdt:/` 展示路径与项目外文件，见 `design.md §2`）。弹窗为新增 `ReferencesPeekDialog`（`Shift+F12` 的旧 `SymbolNavPalette` 零改动，见 `design.md §6`）。
- [ ] 跨 feature 只走公开面：`store/` 直导、`index.ts` 门面；禁止 editor 直引 lsp 内部实现（防火墙规范）。

## Acceptance Criteria

- [ ] AC1：`Ctrl+Click` 点定义名 → 弹出 Peek 调用窗（与 `Shift+F12` 在该位置结果条目一致）；不发生跳转。
- [ ] AC2：`Ctrl+Click` 点调用处 → 跳转到定义（既有行为，`useCmdClickGoToDefinition.test.ts` 原有用例保持）。
- [ ] AC3：弹窗内回车/双击条目 → 跳转到对应文件行列（复用 `confirm`）。
- [ ] AC4：无定义时保持既有提示；质量门禁 `pnpm lint:fe` 全绿。

## Out of Scope

- 调用层次（Call Hierarchy）树：不在本次。
- 后端 `textDocument/references` 缓存/聚合优化：本次纯前端。
- “仅函数”客户端硬过滤（documentSymbol kind 查表）：本次不做，留待插件数据化方案。

## Open Questions

- 无阻塞问题。细节（弹窗尺寸默认值、中英文案终稿）在实现时按 `design.md` 默认值执行，评审时可调。
