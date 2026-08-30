# LSP 导航体验优化：跳转丝滑化（Cmd+Click / 双击 / 项目外定义）

## Goal

消除 LSP 代码跳转的三个体验痛点：
1. Cmd+Click 跳转被 hover docs 挡住 / 弹出 docs 而非跳转；
2. 双击（选中后跳转）有明显卡顿感；
3. 跳转到项目外文件时静默失败、tab 不出现、无任何反馈。

## Root Causes（分析结论，2026-08-29）

- **tooltip 挡点击**：CodeMirror HoverPlugin 在 mousedown 时不关闭 tooltip，
  且 hover tooltip 无 pointer-events 限制——Cmd+Click / 双击事件被 tooltip
  DOM 截获，jump handler 收不到。
- **双倍 LSP 往返**：显式跳转 `skipPending: true` 绕过 pending 去重——双击
  与在途 probe 同位时仍发全新请求。
- **静默失败**：项目外文件被后端路径安全校验拒绝（read_file_content 的
  outside-root），navigateToLocation 的 catch 只有 console.error。

## Implemented（2026-08-29/30）

### P0
1. **Cmd/Ctrl 按住抑制 hover docs**：新增 `features/lsp/modKeyState.ts`（模块级
   单例、import 即监听、幂等）；`useCmdHeld` 重构为消费共享状态；hover source
   在 Cmd 按住时 resolve(null)（VSCode 同款行为）。
2. **mousedown 收起 docs**：`createLspHoverTooltips` 增加 domEventHandlers
   mousedown → `closeHoverTooltips` effect（不吞事件）。
3. **跳转失败可见**：`navigateToLocation` 失败路径全部走
   `showNavigationFailure` toast，按原因分类（outside-root → info /
   read-failed → error）。
4. **jump 共享新鲜 pending**：`getOrFetchDefinition` 的 skipPending 改为
   `sharePendingWithinMs` 窗口语义——probe 长窗口（15s，原行为），jump 短
   窗口（1s，同位双击场景消除双倍请求），未传=永不共享（保守缺省）。

### P1
5. **跳转 loading 反馈**：`lspStore.isDefinitionJumping` 由
   `useLspDefinition`（所有显式跳转的收敛点）驱动；FileEditor 容器
   `lsp-jumping` → `cursor: progress`。

### P2
6. **项目外定义只读查看（预授权模型）**：
   - 后端 `lsp/preauth.rs`：definition 响应中的目标 uri 记录为授权表
     （(project, language) 分桶、容量 64 FIFO + LRU 刷新）；新命令
     `lsp_read_preauthorized_file`（授权校验 + canonicalize + 512KB 上限 +
     spawn_blocking）——前端无法伪造任意路径，路径安全红线的白名单式扩展。
   - 前端 `api/definitionTarget.ts`：`loadDefinitionTargetContent` 策略
     （project-file / external-readonly / unavailable{reason}）；
     `FileTabData/FileTab` 增加 `readOnly`，FileEditor canEdit 联动——
     项目外定义以只读 tab 打开。
7. **死代码清理**：删除无消费方的 `useLspExtensions.ts`（含其测试）。

## 验证

- `pnpm lint:fe` / `pnpm type-check` / `pnpm test:run` 全绿
- `cargo test --lib lsp::preauth` 5 用例通过
- 真实环境待验证：Cmd+Click 不再被 docs 挡、双击卡顿减轻、项目外定义
  出现只读 tab、失败场景有明确提示

## Out of Scope

- 远程/WSL 项目的项目外文件读取（read_file_content_shell 错误语义不同，
  预授权命令仅覆盖本地分支）
- 只读 tab 的视觉徽标（tab 标题加图标）
