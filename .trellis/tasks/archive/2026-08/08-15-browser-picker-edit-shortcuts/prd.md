# 优化浏览器选择器 AI 输入框 macOS 编辑快捷键（复制/粘贴/全选）

## Goal

让 Neeko 里**所有**文本编辑表面在 macOS 下支持标准编辑命令（Cmd+C/V/X/A），一次根治、
不再打补丁。重点：浏览器子 webview 中的选择器 AI 输入框与远程网页输入框。

## Background（根因，已源码验证）

macOS 约束链：

1. 任何带 `Cmd+C/V/X/A` key equivalent 的菜单项会在 **OS 层截获按键**，原始 keydown
   到不了任何 webview，菜单 action 是唯一入口。
2. Tauri 自定义 `MenuItem`（带 id）→ `handle_menu_event`（Rust），需手动转发。
3. 转发曾硬编码到 `get_webview_window("main")` → 浏览器子 webview（`neeko-browser-{projectId}`）
   永远收不到。
4. 即使转对 webview，`document.execCommand(...)` 不可靠：`selectAll` 作用于文档选区、
   `paste` 被 WKWebView 判定为"程序化粘贴"而弹原生确认气泡。
5. 终端是 xterm.js **canvas**，原生编辑命令够不到其内部模型，必须走 JS。

应用"原罪"：因终端需要 JS 处理，为**所有**表面建了"自定义菜单 + 菜单事件转发 + eval"
的全局管道，把「往哪路由」与「怎么执行」两个正交问题揉成一个脆弱机制，每加一个表面
就要打一个补丁。

上一轮已处理（commit `e843bed3`，方案 B 基线，待本任务替换/清理）：
- 注入脚本 `focusin/focusout` → neeko:// POST `picker-focused/picker-blurred` →
  Rust `PICKER_INPUT_FOCUSED` 静态位。
- `app_menu.rs`：聚焦时按 `neeko-browser-` 前缀找浏览器 webview，
  eval `execCommand('copy'/'cut'/'selectAll')` 与 `execCommand('paste')`；未聚焦走 main。
- 已知残留：粘贴走 `execCommand('paste')` 可能弹原生粘贴确认；webview 定位靠前缀 find
  第一个（多浏览器面板可能转发错）；聚焦位为异步缓存的标记（毫秒级竞态）。

## Requirements

### R1 全表面编辑命令（macOS）

| 表面 | Cmd+C 复制 | Cmd+X 剪切 | Cmd+A 全选 | Cmd+V 粘贴 |
|---|---|---|---|---|
| S1 主界面原生输入框 | ✅ | ✅ | ✅ | ✅（无气泡） |
| S2 终端（xterm canvas） | ✅ | 无语义 | 无语义 | ✅（转发到 shell） |
| S3 选择器 AI 输入框（子 webview） | ✅ | ✅ | ✅ | ✅（尽量无气泡） |
| S4 远程网页输入框（子 webview） | ✅ | ✅ | ✅ | ✅ |

### R2 平台

- 仅 macOS 需要特殊处理（`#[cfg(target_os = "macos")]`）。
- Windows/Linux 无 Edit 菜单、不拦截，Ctrl+C/V/A 原生直达 —— **零改动、零回归**。

### R3 无回退

- 主应用输入框 / 终端 / 设置等既有 Cmd+C/V/A 行为不回退。
- 终端 Ctrl+C（SIGINT）行为不受影响（沿用现有语义）。

### R4 结构性要求

- 优先采用「机制替换」而非「继续打补丁」：路由交给 OS responder chain，仅保留系统
  原生能力覆盖不到的极少数 JS 出口。
- 多浏览器面板共存时编辑命令必须落在**正确**的 webview（同一时刻只有一个焦点）。

### R5 安全

- 若向浏览器 webview eval 注入剪贴板文本，只能以纯文本 `insertText` 形式插入
  （禁止以 HTML 注入），必须 JSON 转义，杜绝脚本注入。

### R6 质量门禁

- 新增/更新回归测试（TDD）；`cargo test` / `pnpm test:run` / `pnpm lint` /
  `pnpm lint:fe` / `node --check` 全绿；真机手测全表面矩阵。

### R7 跨平台功能一致性（硬性要求）

- 本任务属于跨平台项目：复制/粘贴/剪切/全选在 macOS / Windows / Linux **三平台行为
  一致**（S1–S4 全矩阵）。
- 一致性路径：三平台终态都收敛到「**平台原生编辑**」——
  macOS 经 D0（PredefinedMenuItem → responder chain）回到原生；Windows / Linux
  本就没有菜单拦截、原生直达。D0 的本质是把 macOS 拉回与 Win/Linux 相同的原生路径，
  而非给 macOS 特制一套行为。
- Win/Linux 不做额外逻辑，但**必须纳入一致性验收**（三平台冒烟矩阵），保证不因本任务
  产生行为差异或回退。

## Acceptance Criteria

- [ ] **AC1** 选择器 AI 输入框（S3）内 Cmd+A 全选、Cmd+C 复制选中、Cmd+V 粘贴可用，
      粘贴**无原生确认气泡**（或按 D1 约定降级并有明确记录）。
- [ ] **AC2** 远程网页输入框（S4）内编辑命令可用。
- [ ] **AC3** 终端（S2）复制选中文本、粘贴到 shell 可用；主界面原生输入框（S1）行为不回退。
- [ ] **AC4** 多浏览器面板共存时命令落到正确 webview。
- [ ] **AC5** 方案 B 基线残留被清理：自定义 Edit 转发管道 / `picker_input_focused` /
      前缀启发式按所选设计（D0/D1）删除或替换。
- [ ] **AC6** 全量质量门禁通过，回归测试覆盖 S1–S4 关键路径。
- [ ] **AC7** 三平台一致性：Windows / Linux 上 S1–S4 编辑命令原生可用、无回退
      （冒烟矩阵）；macOS 达到 D0/D1 目标；三平台行为一致。

## Non-Goals

- 不为 Windows/Linux 添加额外逻辑（原生即可），但纳入一致性验收（三平台冒烟矩阵，
  见 R7 / AC7）。
- 不做 macOS firstResponder 的 objc 内省式聚焦判定（脆、版本相关），除非设计评审一致否决
  脚本上报方案。
- 不为"远程页面富文本编辑器拦截 paste 做格式处理"做专项适配（D0 原生天然支持；
  D1 接受 insertText 绕过其格式化逻辑这一取舍，记录即可）。

## Notes

- 完整技术方案见 `design.md`（第一性原理推导 + D0 目标态 / D1 兜底 + spike 验证清单 +
  删除清单 + TDD 落地计划）。
- 关键决策点：先做 **Phase 0 spike**（真机临时换 predefined 菜单，验证三个假设），
  再按 D0/D1 结论走 TDD。
