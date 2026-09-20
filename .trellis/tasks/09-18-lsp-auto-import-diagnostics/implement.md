# 实施计划：M1 → M2 → M3 → M4（M0 用户协作验证贯穿）

> 契约依据：design.md §2。每阶段独立可交付，TDD 红绿留痕，阶段完成即跑门禁。

## 顺序与理由

**M1 诊断可视化**（首个实现阶段）：独立可交付（纯前端 + store）、是 AC 的感知基础、
为 M3 灯泡提供数据承载。M0 用户协作验证与其并行。

**M2 健康度**：Rust 钩子 + status-bar，小而独立。

**M3 codeAction 通道**：横跨 Rust 转发 + 前端应用 + 灯泡 UI（复用 M1 面板），依赖
M1 的诊断行承载。

**M4 策略三态**：纯策略层，最后（在真实三通道跑通后才有意义）。

## M0：用户协作验证清单（与 M1 并行，不阻塞）

用户在 Go 项目中执行并回填结果：
1. gopls 是否安装（终端 `gopls version`）；未装 → Neeko 内触发 builtins 安装兜底
2. 打开 Go 文件 → 编辑器是否有 squiggle（如输入 `undefinedX()` 观察诊断）
3. 输入 `fmt.` → 是否弹补全；选择 `Println` → import 块是否自动落 `import "fmt"`
4. status-bar 是否有 LSP 相关信号（预期：无 → M2 交付项）
结果回填 prd.md「用户协作验证项」，任何断点按 design 错误矩阵定位。

## M1 诊断可视化（R1/AC1）

1. **Red**：lspStore 诊断切片单测——整体替换语义 / 空 arrays 清空 / 跨项目隔离 /
   解析容错（设计错误矩阵逐条）；DiagnosticsPanel 分组/跳转/空态组件测试
2. **Green**：lspStore 切片 + 事件订阅生命周期（acquire/release 对齐会话）+
   DiagnosticsPanel 接线（数据从 props 改为 lspStore 选择）
3. 挂载点：按 design §M1 判定标准三选一（dock 面板 / 底部折叠条 / status-bar 弹层），
   实现期考察既有面板模式后取最小侵入；在实现报告里记录选择依据
4. 门禁 + 汇报挂载点决策

## M2 健康度（R2/AC2）

1. Rust：会话生命周期钩子 → `lsp-health-{projectPath}` 事件（常量化进 events.ts，
   前后端同源）；白名单语义不动
2. 前端：lspStore health 切片（幂等）+ status-bar item（语言图标 + phase + failed
   重试入口）
3. 测试：Rust 触发矩阵单测、store 幂等、item 组件测试

## M3 codeAction（R3/AC3）

1. Rust：`workspace/applyEdit` 进 server_request 白名单 → `lsp-apply-edit-{projectPath}`
   事件转发 + ok 应答（LSP 语义）；MethodNotFound 兜底回归测试
2. 前端：`requestCodeActions` / `applyCodeAction` 封装（lspRequest 面）+ applyEdit
   事件消费（原子多 edit 应用）+ DiagnosticsPanel 行内灯泡（动作列表 + 应用）
3. 测试：Rust 转发单测、前端原子应用事务测试、灯泡交互测试、mock codeAction 链路
4. **Go 真机验证**：未导入符号诊断 → quickfix → import 落块（AC3 终验）

### M3 续做：诊断 UI 的 AI 动作（✨ Fix / ✨ Explain，B1 形态）

> 交接文档：`~/.codebuddy/plans/radiant-aurora-tesla-dkTvg_AA.md`。产出形态 B1：
> agent 自己通过工具改文件，宿主只把诊断上下文喊给它 —— 不解析补丁、不走 applyWorkspaceEdit。

1. `editor/api/aiActionRegistry.ts`：FileRef 身份 → AI 派发 handler 注册表（镜像 editorViews）
2. `useFileEditorState`：抽出 `dispatchCodeAction`（buildCodeMessage → sendToAgent）共用；
   挂载即登记 / 卸载即注销；诊断路径无 agent 时清 pending（无工具栏可承接）
3. `agentPrompt`：`CodeContext.diagnostic` —— fix/explain 模板带诊断消息
4. `codeAction.ts`：`QuickFixMenuItem.ai` 标记；`groupQuickFixActions` 固定在 Quick Fix
   组末尾追加 ✨ Fix / ✨ Explain（服务器零动作时也提供）；`runAiQuickFixAction`
   （LSP 0-based → 1-based 行 + 诊断消息）
5. 编辑器侧 `lspQuickFix`：hover popup 消息行带 `source (code)`；动作行第三项 ✨ Fix (⌘I)；
   新键位 `Mod-i`（AI Fix，与 `Mod-.` 服务器首选并存）；菜单 AI 行 sparkle 图标 + 注册表派发；
   空菜单形态随之消失（AI 动作固定在列）
6. 面板侧 `DiagnosticQuickFix`：菜单顶部诊断消息行（共用 `diagnosticMetaSuffix`）；
   AI 行 sparkle + 点击/Enter 走 `pick`（AI 派发 / 服务器应用分流）；派发失败菜单不关
7. 测试：registry 5、buildCodeMessage 4、codeAction AI 5、lspQuickFix AI 8、
   DiagnosticQuickFix AI 5、useFileEditorState 登记 4（全量 3990 passed）
8. **2026-09-20 UI 简化（用户反馈"太复杂，参考 VS Code"）**：hover popup 去掉内嵌菜单
   与 source(code)，只留「消息 + View Problem / Quick Fix… / ✨ Fix」动作行；quickfix
   菜单拍平为单列（去掉分组头 / Source Action 置灰声明 / command-only 行 / 每行 hint /
   面板菜单消息重复行），`groupQuickFixActions` 只列带 `edit` 且非 `source.*` 的修复 +
   末尾 ✨ Fix / ✨ Explain；删除 `diagnosticMeta.ts`。空菜单形态随之消失（AI 动作固定在列）。
9. **2026-09-20 二轮（用户反馈）**：① 动作行单行不换行（去掉 `flex-wrap`，加
   `whitespace-nowrap`，`appendShortcutRow` 导出供单测）；② popup 消息行复用 Problems
   面板诊断行样式 —— 新增 `components/SeverityIcon.tsx` 单一事实源（lucide 同形
   CircleX/TriangleAlert/CircleInfo/CircleDot 的 inner SVG），`DiagnosticsPanel` 与 popup
   共用 `severityName` / `severityColorClass` / `SeverityIcon` / `severitySvgMarkup`；
   消息行 = 严重度图标 + 消息 + source + (code)（有 codeDescription 时开诊断文档）。
10. **2026-09-20 三轮（用户反馈"展示框不全 / 四角黑色"）**：① popup 改用专属类
    `neeko-diagnostic-popup`，边框/底色/圆角/阴影由**外层** `.cm-tooltip` 承载
    （`lsp.css` 加 `:has` 规则，与 LSP hover 文档同款），内层透明 —— 消除方形外壳
    深色底在圆角处透出；② 宽度 `max-w-64`→`max-w-96`，消息 `truncate`→`break-words`
    长消息换行完整展示。
11. **2026-09-20 四轮（用户反馈"图标用 lucide"）**：`SeverityIcon.tsx` 删除手写 SVG
    path，改直接引用 lucide 组件（XCircle / AlertTriangle / Info / CircleDot）；
    原生 DOM 侧经 `renderToStaticMarkup`（`react-dom/server.browser`，`searchPanel.ts`
    同款先例）渲染同一 lucide 图标为字符串 —— 单一来源，无自绘图标。
12. **2026-09-20 五轮（用户反馈"AI 图标复用 lucide"）**：AI sparkle 从手绘四角星改为
    **lucide `Sparkles`**（与应用其他 AI 场景同一图标，如 `EditorHeader` /
    `ReviewInstructionPopover`）。`QuickFixBulbIcon.tsx` 的 `QuickFixSparkleIcon` 直接渲染
    `<Sparkles/>`，原生 DOM 侧导出 `sparklesSvgMarkup()`（`renderToStaticMarkup`）；
    hover 快捷栏的 `✨ Fix (⌘I)` 去掉 `✨` 字符，改为 lucide Sparkles 图标 + `Fix (⌘I)`；
    菜单 AI 行同步换用同一图标。
13. **2026-09-20 六轮（用户反馈"Fix/Explain 点击没有反应"）**：根因 —— 没有打开的 agent
    终端 tab 时 `sendToAgent` 返回 false，handler 静默清 pending 后 no-op。修复：
    `useFileEditorState` 抽出 `buildActionMessage` + `sendAfterBoot`（无 agent 时自动创建
    agent 终端 tab，1.5s 引导后把诊断消息补发进去 —— B1"把它喊起来"，对齐 Copilot 打开
    chat）；`handleCreateTab` 复用 `sendAfterBoot` 消除重复；点击 Fix/Explain 必有反应
    （有终端直发，无终端自动开 + 补发）。
14. **2026-09-20 七轮（用户反馈"打开对应 agent CLI，执行一次性 prompt 命令"）**：不再打进
    交互 TUI（避免"终端开了但 agent CLI 没起来 → 消息发不出去"）。新增
    `shared/utils/agentPromptCommand.ts`：按 `AgentConfig.prompt_args`/`post_prompt_args`
    拼一次性命令（镜像后端 `build_agent_commit_cmd` 内联分支；`-f` 文件模式内联场景去掉，
    prompt 作位置参数，如 opencode → `opencode run --pure … 'prompt'`）。`sendAfterBoot`
    改为：`getAgent` 拉配置 → 建 `taskCommand` 终端 tab → PTY `sh -c` 直接执行该命令，
    无需等 session 就绪。handler 异步接管返回 true。
15. **2026-09-20 八轮（用户反馈"点击选项列表后不隐藏"）**：编辑器 quickfix 菜单
    `showQuickFixMenu` 的 pick 回调只执行 `onPick`（应用动作）不调 `close()` —— 点完项
    菜单固定残留。修复：`close` 定义提前，pick 回调 `item.onPick?.(); close();`（点击/Enter
    选中即关，VS Code 同构）；新增 2 条回归测试（服务器项 / AI 项点击后菜单必须移除）。
16. **2026-09-20 九轮（用户反馈"opencode cli 报错" + 指令）**：报错根因是用户 opencode
    全局配置默认模型 `opencode/deepseek-v4-flash-free` 在 1.18.31 不存在（任何 `run` 都
    服务器报错）。用户明确：Fix 流程用 **`opencode --prompt 'xxx'`（交互 TUI 形态，打开
    CLI 并预填 prompt）**，**headless 命令（`AgentConfig.prompt_args`，AI commit 等用）
    不动**。`buildAgentPromptCommand` 对 `agent.id === 'opencode'` 返回
    `opencode --prompt '…'`，其余 agent 仍走 `prompt_args` 数据驱动拼装。
17. **2026-09-20 十轮（用户反馈"不要 if 特判，AgentConfig 原生支持交互式/headless"）**：
    去掉 `buildAgentPromptCommand` 的 `agent.id === 'opencode'` 分支。`AgentConfig`
    新增 `interactive_prompt_args`（后端 `types.rs` + 前端 `agent.ts`，serde default/
    skip None 向后兼容）：交互式（TUI）prompt 形态，如 opencode `["--prompt"]` →
    `opencode --prompt '…'`；opencode builtin 声明之，其余 agent `None`。util 数据驱动：
    `interactive_prompt_args ?? prompt_args`，无任何 agent 特判。后端测试钉住 opencode
    交互式 `["--prompt"]` 与 headless `prompt_args` 双契约。

## M4 策略三态（R4/AC4）

1. 设置项 `editor.lsp.importStrategy`（settings 域既有模式 + 持久化）
2. 拦截点：`lspCompletionInfoRenderer.createThemedCompletionSource` 返回处按策略变换
   option（auto 放行 / never 剥离附加编辑 / ask 弹 import 预览确认）
3. 测试：三态行为差异单元测试 + 设置持久化

## 收尾

- AC5 语言无关性验证：builtins 中选一个未实测 LS（如 python/pyright 或 rust-analyzer）
  重复 M0 清单 1-3 项
- 全量门禁 + 各阶段报告归档 implement.jsonl / check.jsonl
- trellis-update-spec：三通道模型沉淀进 spec（LSP 域规范文件——参照 dap-domain.md
  先例新建 lsp-domain.md，收录：通道模型、单写点决策 D3、白名单语义 D4、语言无关铁律 D1）
