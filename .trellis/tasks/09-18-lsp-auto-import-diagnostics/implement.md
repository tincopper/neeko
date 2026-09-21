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

18. **2026-09-20 十一轮（用户反馈"菜单不要预选中"）**：打开 quickfix 菜单时不再把首个/
    首选可执行项标为高亮，改为「未移动 = 不高亮」，只有 ↑/↓ 或鼠标 hover 后才出现选中态。
    两侧同步：`quickFixMenuRender.ts` 的 `activeIndex` 初值 `firstEnabledIndex(flatItems)`
    → `-1`（`stepEnabledIndex` 从 -1 起步落到首个/末个可执行项），`DiagnosticQuickFix.tsx`
    派生式 `activeIndex = navIndex ?? firstEnabledIndex(...)` → `navIndex ?? -1`（不再依赖
    `firstEnabledIndex`，两处消费点归零，仅保留其 `stepEnabledIndex` 内部用途）。
    **副作用（须记录）**：未移动直接 Enter 现在是 no-op —— 菜单要求显式选择后才生效。
    测试：编辑器侧 4 条改写（不预选中断言 / ↓ 起步 / 边界 / Enter 先行移动），面板侧键盘
    链补一次 `ArrowDown`；`lspQuickFix.test.ts` 31 + `DiagnosticQuickFix.test.tsx` 10 全绿。

19. **2026-09-21 十二轮（用户反馈"Java 项目里问题链接是一段数字"）**：`16777218` 是
    jdtls 把 Eclipse `IProblem` 内部 ID（0x01000002）当 `Diagnostic.code` 发出、我们按
    VS Code 约定原样渲染的结果。判定**按形态不按语言**（红线 15）：新增共享策略
    `lsp/components/diagnosticCode.ts`（`diagnosticCodeBadge` + `diagnosticCodeTooltip`），
    Problems 行（`DiagnosticRow.tsx`）与编辑器 hover popup（`lspQuickFixPopup.ts`）共用
    同一份规则 —— 字符串 code 照原样（有 href 则链接）；数字 code 不再占行尾、原值进
    `title`（悬停仍可查，TS 的 `2339` 也适用）；数字 code 且服务器给了文档链接时保留链接、
    文案换 `source`（无 source 兜底 `docs`）。测试：`diagnosticCode.test.ts` 12 例 +
    面板级 3 条回归（含 `16777218 不得出现在行上`）；既有的 `(2339)` 断言改写为
    「不占行尾 + title 可查」。全量 466 文件 4062 passed。

20. **2026-09-21 十三轮（AC5 rust-analyzer 真机验证暴露的根因：编辑器没有波浪线/灯泡）**：
    现象分裂 —— Problems 面板有诊断、hover popup 有诊断（`E0425 cannot find type int32`）
    且 `textDocument/codeAction` 正常发出，但编辑器**既没波浪线也没 gutter 灯泡**。
    日志取证（`~/.neeko/neeko.log`）逐步收敛：
    1. 同文件 47ms 内两条 `didOpen`（v1 然后 v0）且无 didClose → rust-analyzer
       `ERROR duplicate DidOpenTextDocument`
    2. 加 `previous=` 取证日志后发现：**v1 那条根本没走 `lsp_transport` 的转发分支**
       （无取证行）→ 定位到**第三条 didOpen 路径**：`lsp_request` 的内联代开
       （读盘 + 手写 `version: 1` + 裸发 + **不登记**）；`lsp_go_to_definition` 是第四条
    3. 服务器按 v1 推诊断，而 `@codemirror/lsp-client` 手里文档是 v0 → 版本门
       (`serverDiagnostics`: `params.version != file.version` 直接 return) **整批丢弃**
       → 编辑器无 lint 状态 ⇒ 波浪线与灯泡同时消失（面板走 lspStore，不经过该门）
    **修法（入口归一）**：新增 `lsp/document_open.rs`（`ensure_document_open` +
    `next_open_version`：版本由登记表推进，首开 0）+ `LspManager::send_did_open`
    （didOpen 唯一出口：重复先补 didClose、发送、登记）；`lsp_transport` 转发分支、
    `lsp_request`、`lsp_go_to_definition` 三处全部委托。另修 `TauriLspTransport.destroy()`
    后仍可 `send()` 的漏洞（僵尸 client 能继续用自己计数器写同一会话）。
    测试：Rust +4（`next_open_version` / `needs_backend_open` / 登记去重 / 版本查询）、
    前端 +1（destroy 后 send 不触发 IPC）；全量 cargo 1309 + 前端 380(lsp) 全绿。
    用户复测：**波浪线与灯泡恢复**。

21. **2026-09-22 十四轮（方案 C 混合：内容锚定校验 + 删 settle/指纹，用户裁定）**：
    现象 —— rust-analyzer 下输入 `HashMap::new()` 过程中及收尾后，`int32`（E0425）
    的波浪线长期落在错行（`let map` 行），typing 期语义波浪线直接消失，用户两轮复测
    「还是不行」。
    法医证据（`~/.neeko/neeko.log`，0-based 行号）：
    ① v34：map 行 14、`int32` 行 15，publish `[syntax-error@14:18, E0425@15:11-16]`
    坐标正确；
    ② v35：一次 didChange 带两个 contentChanges（键入 `Hash` + 自动导包在 line 5 插入
    `\nuse std::hash::Hash;`），此后 map→15、`int32`→16，但 publish
    `[syntax-error@15:18, E0425@15:11-16]` —— syntax 跟输入走（新鲜），E0425 钉死
    （陈旧），`version:35` 照跟，版本门放行；v36→v43 及 12:59 新会话复现同一模式。
    根因（两时钟模型）：`syntax-error`（source=rust-analyzer，live parsing，每击新鲜）
    与 E0425（source=rustc + `data.rendered`，flycheck 缓存）在同一 push 里混装；
    文档版本钟 ≠ 分析新鲜钟，version 相等不代表坐标新鲜 —— version 门 / 越界检查 /
    指纹去重三层对「无 syntax 批次里的孤立陈旧语义诊断」（v43）全部放行。
    VSCode 对照（`vscode-languageserver-node` 源码）：push →
    `DiagnosticCollection.set(uri, items)` 整批替换，无穿编辑映射、无语法语义分流、
    无延迟去重；同样短暂画错，但零延迟零丢弃故自愈快、不隐藏语义诊断。
    方案（用户选 C，比较用 `includes(token)` 宽容匹配）：保留 `keepSyntaxLayerOnly` +
    `rangeFitsDocument` + 内层版本门；删除 settle 整条路径
    （`DIAGNOSTICS_SETTLE_MS`/`pending`/`flush`）与指纹整块
    （`lastApplied`/`fingerprintDiagnostics`）；新增**内容锚定校验**为唯一陈旧判据
    （逐条 fail-open）：仅 message 含反引号 token 且 range 单行时检查；映射与内层同源
    （`fromPosition(range, syncedDoc)` → `unsyncedChanges.mapPos` → 当前 view 文本切片
    `includes(token)`）；不含则丢该条，全丢空则 `return true` 保旧线。
    TDD：新增 v34→v35 日志回放 e2e（陈旧必丢 / 旧线保留 / 新鲜必画）；原 settle 语义
    3 条用例（静置待定 / 快打丢弃 / 权威取消待定）改写为即时应用；其余保留。
    门禁：`npx vitest run src/features/lsp`（404 基线）+ `npx tsc --noEmit` + `eslint`
    两文件；真机：stock-buddy `main.rs`「补全导包→插行→`;`收尾」三步复测，波浪线钉住。
    回滚：`lspServerDiagnostics.ts` 单文件回退即回退全部行为。

22. **2026-09-22 十五轮（对齐 VS Code：删语法层过滤 + 内容锚定，用户裁定）**：
    现象复现十四轮方案 C 后仍「编辑时旧波浪线不跟随错误代码位置」——用户明确：
    编辑插行后错误代码下移，旧波浪线却跳到别的行。
    第一性原理再审查（见 `prd.md` 附注）：客户端在信息论上**无法判定**「坐标是新鲜
    还是陈旧」——文档版本钟 ≠ 分析新鲜钟，服务器会把当前版本号盖在旧分析结果上重发。
    任何启发式（语法层过滤 `keepSyntaxLayerOnly` / 内容锚定 `anchorFitsCurrentText`）
    都既误杀（语法错误时隐藏全部语义诊断）又漏网（跨行/无 token 诊断 fail-open 放行），
    表现为波浪线跳动/不跟随；防御失败的代价不对称——漏网长期错位、误杀错误凭空消失，
    且无法靠调参消除。
    裁定（对齐 VS Code 哲学）：客户端**不猜新鲜度，信任服务器，靠重推自愈**。
    VS Code 对照（`DiagnosticCollection.set(uri, items)` 零过滤整批替换）：同样短暂画错，
    但零延迟零丢弃故自愈快、不隐藏语义诊断；其成熟在于**不做信息论上不可能的判断**。
    **改动**：`lspServerDiagnostics.ts` 收敛为只保留**可判定**防御 ——
    ① 空推送清空（整体替换语义）；② 无 doc 委托内层；③ `rangeFitsDocument` 越界安全网
    （纯防御，只防坐标形状不合法）；④ 整批全越界 → 不应用保留旧线；⑤ 其余**整批应用**
    （陈旧坐标短暂画错，靠下一次新鲜推送整批替换自愈）。
    删除：`keepSyntaxLayerOnly` / `anchorToken` / `anchorFitsCurrentText` /
    `ANCHOR_TOKEN_PATTERN` / `languageOf`；`syntax_error_codes` 全链路 dead code
    （`LspPlugin` 字段+builder、`LspExtensionMapEntry` DTO、registry 映射、rust builtin
    声明、前端 `lspApi`/`languageMap`）一并删除（clean cutover，grep 零残留）。
    保留：内层版本门（防「旧版本号+旧坐标」真实违规）+ lint `map(tr.changes)` 文本跟随
    （CodeMirror 天然行为，编辑时旧线随文本走——比 VS Code 更优）。
    TDD：`lspDiagnosticsMapping.test.ts` 15 用例改写/新增——陈旧坐标**应用**（短暂画错）
    而非锚定识破丢弃；「陈旧应用 → 新鲜纠正自愈」完整序列用例
    `aligned_vscode_editor_edit_preserves_follow_then_fresh_corrects`；语法+语义同批
    **都应用**（不隐藏语义）；版本门/越界保留语义原样钉死。
    门禁（trellis-check PASS）：`pnpm type-check`、`npx vitest run src/features/lsp`
    （404 tests）、eslint 本改动文件、`cargo check` + `cargo test lsp::plugin`（32）、
    残留扫描零命中。
    **行为变化（接受）**：语法错误期间语义诊断坐标陈旧时会短暂画错，由下一次新鲜推送
    自愈——这是「隐藏语义诊断」与「短暂画错」之间的取舍，VS Code 选择后者（错误始终
    可见、最终正确）。
    回滚：`lspServerDiagnostics.ts` 单文件回退即回退全部行为；`syntax_error_codes` 属
    未提交工作区状态，删除后 plugin/api 文件与 HEAD 一致。

23. **2026-09-22 十六轮（修正：恢复内容锚定，不恢复语法层过滤）**：
    十五轮（对齐 VS Code）后用户复测仍报「编辑时旧波浪线不跟随错误代码位置」——
    日志取证（`~/.neeko/neeko.log`）确认传输链路本身通畅（didChange 逐版本发出、
    publishDiagnostics 逐版本响应），问题在**客户端**：rust-analyzer 语义诊断重推慢
    （flycheck 缓存），"信任服务器靠重推自愈"在本栈不成立——陈旧坐标（新版本号 +
    旧坐标，不越界）被**整批应用**后，把 lint/mirror 已**跟随正确**的旧波浪线**拽回
    旧行**，即用户看到的「变动到别的行」。
    修正：**恢复内容锚定**（`anchorToken` / `anchorFitsCurrentText` / `ANCHOR_TOKEN_PATTERN`），
    作为陈旧坐标的**唯一可判定判据**——点名 token 的诊断（E0425/E0433）映射到当前
    文本切片不含该 token → 该批含陈旧坐标 → **整批拒绝**，跟随正确的旧线保留。
    **不恢复**语法层过滤 `keepSyntaxLayerOnly`（语义诊断保持可见，VS Code 行为）。
    TDD：`lspDiagnosticsMapping.test.ts` 翻转 4 个「陈旧应用」用例为「锚定拒绝、跟随
    旧线不被拽回」（含用户现场：插行后陈旧 E0425 落在插入行 `"inser"` 切片 → 拒绝）；
    新增 `edit_insert_line_then_stale_rejected_then_fresh_applies` 完整序列。
    门禁：`npx vitest run src/features/lsp`（404）+ `pnpm type-check` + eslint 两文件全绿。
    回滚：`lspServerDiagnostics.ts` 单文件回退即回退全部行为。

24. **2026-09-22 十七轮（批级决策：修复「编辑后波浪线消失」，用户复测）**：
    十六轮（恢复内容锚定）后用户复测报「编辑代码后错误上面的波浪线消失」。
    日志取证（`~/.neeko/neeko.log`）：服务器端 E0425 **从未消失**（逐版本推
    `E0425@syntax-error` 混装批，坐标正确）→ 问题在前端过滤层的**子集应用**：
    旧逻辑 `kept = incoming.filter(rangeFitsDocument)` 后，批里 E0425 陈旧越界被滤、
    新鲜的 syntax-error 通过 → `kept` 非空 → 只应用 syntax 子集 → `setDiagnostics`
    **整批替换**把 lint 里已跟随正确的 E0425 波浪线**挤掉** → 波浪线消失。
    **根因**：`publishDiagnostics` 是**整批替换**语义，部分过滤 + 应用子集 = 隐式清除
    被过滤的诊断。VS Code 从不过滤（`DiagnosticCollection.set` 整批信服务器），故从不丢。
    **修法（批级决策）**：`applyFiltered` 收敛为「**任一条**越界或锚定失败 → **整批拒绝**
    （`return true` 保留 lint/mirror 已跟随旧线）；只有**全部**通过 → 整批应用
    （`inner(client, params)`，与 VS Code 同语义，服务器推什么就画什么）」。
    不再做任何子集应用。
    TDD：新增用户现场精确复现 `陈旧越界 E0425 + 新鲜 syntax-error：整批拒绝，E0425
    波浪线不消失`（编辑截短行 + sync 后推混装批，断言 E0425 lint 位置保留）；
    翻转 `混合批` 用例为「任一条越界 → 整批拒绝」。16 用例全绿。
    门禁：`npx vitest run src/features/lsp`（405）+ `pnpm type-check` + eslint 全绿。
    回滚：`lspServerDiagnostics.ts` 单文件回退即回退全部行为。

25. **2026-09-22 十八轮（逐条合并：修复「缺分号 syntax-error 不显示」，用户复测）**：
    十七轮（批级决策：任一条陈旧整批拒绝）后用户复测报「代码最后没有分号的错误没显示
    波浪线」——日志取证：批 = `[syntax-error@15:21-21(零长度点, 无反引号 token →
    锚定 fail-open 通过) + E0425@15:11-16]`。批级决策的「任一条锚定失败 → 整批拒绝」
    把**新鲜的 syntax-error 连带拒掉**（E0425 陈旧拖累整批）。
    修正（逐条合并）：`applyFiltered` 拆分为**逐条判定** —— 越界/锚定判定独立作用于
    每条诊断；`fresh`（越界+锚定通过）原样应用；`stale`（陈旧）从 lint 层按 message
    取**已跟随位置**重建坐标后一并应用（`lintPositionsByMessage` 用 `forEachDiagnostic`
    读 lint 当前渲染位置；`plugin.toPosition` 转回 LSP 坐标，内层同源映射落回跟随处）；
    lint 里也没有（无旧线可保留）→ 丢弃避免旧坐标画错位。三种结果：全新鲜整批应用 /
    全陈旧整批拒绝保留旧线 / 混合逐条合并。
    TDD：翻转 `陈旧越界 E0425 + 新鲜 syntax-error` 用例为「逐条合并：E0425 保留 lint
    跟随位置 **且** syntax-error 点显示」（用 `arrayContaining` 断言两者并存）。
    16 用例全绿。门禁：`npx vitest run src/features/lsp`（405）+ `pnpm type-check` +
    eslint 全绿。回滚：`lspServerDiagnostics.ts` 单文件回退即回退全部行为。

26. **2026-09-22 十九轮（jdtls quickfix 缺失：声明 codeActionLiteralSupport，用户反馈）**：
    现象 —— Java 未导入包（`ArrayList cannot be resolved to a type`）的 quick fix 没有
    修复方法，Go 有。日志取证：`textDocument/codeAction` 请求**正常到达** jdtls（context
    诊断含 `source:"Java"`、`code:16777218`），但 jdtls **返回空列表**。
    jdtls 源码实证（`CodeActionHandler.getCodeActionFromProposal` + `ClientPreferences`
    字节码反编译）：`isSupportedCodeActionKind(kind)` 从
    `capabilities.textDocument.codeAction.codeActionLiteralSupport.codeActionKind.valueSet`
    读取；**客户端未声明 valueSet（null）→ 恒 false → 所有 quickfix proposal 被丢弃**。
    gopls 不检查该声明故 Go 正常。根因：`build_client_capabilities()` 缺 `textDocument.codeAction`。
    **修复**：`session/instance.rs::build_client_capabilities` 新增
    `codeAction.codeActionLiteralSupport.codeActionKind.valueSet = ["quickfix", "source"]`。
    **红线 14 双向护栏（不重蹈 resolveAdditionalTextEditsSupport 覆辙）**：
    - **声明** `codeActionLiteralSupport`：前端确实消费带 `edit` 的 quickfix
      （`groupQuickFixActions` 已有 `{ title:'Add import', kind:'quickfix', edit }` 用例，
      `applyCodeAction` → `applyWorkspaceEdit` 单事务）；
    - **不声明** `resolveSupport`：本栈无 `codeAction/resolve` 通道，声明会让 jdtls 把
      edit 全推迟到 resolve。
    TDD：新增护栏 `client_capabilities_advertise_code_action_literal_support_without_resolve`
    （valueSet 含 quickfix + resolveSupport 不得出现）。后端 lsp:: 222 passed、cargo check 绿。
    **生效方式**：能力在 initialize 时发送 → 需**重启 Java 会话**（改的是 Rust 载荷）。
    回滚：删 `codeAction` 块 + 该测试即可。

## M4 策略三态（R4/AC4）

1. 设置项 `editor.lsp.importStrategy`（settings 域既有模式 + 持久化）
2. 拦截点：`lspCompletionInfoRenderer.createThemedCompletionSource` 返回处按策略变换
   option（auto 放行 / never 剥离附加编辑 / ask 弹 import 预览确认）
3. 测试：三态行为差异单元测试 + 设置持久化

### M4 落地（2026-09-20，TDD 红绿留痕）

1. `LspConfig.importStrategy`（`shared/types/settings.ts`，必填默认 auto；后端
   `plugin/types.rs::LspSettings` 镜像 `#[serde(default)]`，`manager.rs` 快照同步）
2. `lsp/api/lspImportStrategy.ts`（新建，`api/` 白名单面）：`auto` no-op；`never`
   换只插入 + 跳过预热/选中解析；`ask` 有编辑弹确认（首行摘要），fail-open 到 auto
3. `LspPanel` ToggleGroup（Auto/Ask/Never，走 `patchLsp`）；`useAppConfig`
   加载/保存同步策略缓存（单写点）
4. 测试：api 层 ~20 + renderer 接线 4 + `useAppConfig` 3 + Rust serde 2；全量
   463 文件 4038 passed，tsc/clippy/fmt/eslint 全绿；R5 零语言分支

## 收尾

- AC5 语言无关性验证：builtins 中选一个未实测 LS（如 python/pyright 或 rust-analyzer）
  重复 M0 清单 1-3 项
- 全量门禁 + 各阶段报告归档 implement.jsonl / check.jsonl
- trellis-update-spec：三通道模型沉淀进 spec（LSP 域规范文件——参照 dap-domain.md
  先例新建 lsp-domain.md，收录：通道模型、单写点决策 D3、白名单语义 D4、语言无关铁律 D1）
