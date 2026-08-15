# Design — macOS 编辑快捷键根治方案（复制/粘贴/全选）

> 关联 PRD：`prd.md`。本文是第一性原理推导的完整技术方案；**落地前先做 Phase 0 spike**。

---

## 1. 问题本质与正交拆解

目标：S1 主界面原生输入框 / S2 xterm 终端（canvas）/ S3 选择器 AI 输入框 /
S4 远程网页输入框，全部支持 Cmd+C/V/X/A。

两个**正交**维度，过去被揉成一条脆弱管道：

- **往哪路由（Routing）**：命令送达哪个 webview？当前靠菜单事件手动转发 + 前缀启发式。
- **怎么执行（Execution）**：如何真正执行？当前靠 `document.execCommand(...)` eval。

macOS 本身就有两者兼得的机制 —— **NSResponder chain**（标准 selector
`copy:`/`cut:`/`paste:`/`selectAll:`）：聚焦的 WKWebView 在**自己文档里原生处理**，
无需路由代码、无需 eval、无需聚焦位。

Tauri 2.10 + muda 0.17 已验证提供原生入口：

```
PredefinedMenuItem::copy/cut/paste/select_all
  → muda macOS: sel!(copy:) / sel!(cut:) / sel!(paste:) / sel!(selectAll:)
  → target: nil → responder chain（不经 on_menu_event，不经 Tauri）
  → 自动绑定 Cmd+C/X/V/A（muda src/items/predefined.rs accelerator()）
```

## 2. 各表面 × 命令的机制推演

### D0（目标态）：Edit = 4 个 PredefinedMenuItem，转发管道全删

| 命令 | 机制 | S1 | S2 终端 | S3 | S4 |
|---|---|---|---|---|---|
| Cmd+C | 原生 `copy:` | 原生 ✅ | xterm 将选区写入 DOM selection，原生复制 ✅ | 原生 ✅ | 原生 ✅ |
| Cmd+X | 原生 `cut:` | 原生 ✅ | 终端无剪切语义，无害 | 原生 ✅ | 原生 ✅ |
| Cmd+A | 原生 `selectAll:` | 原生 ✅ | 选中页面文本，无害 | 原生 ✅ | 原生 ✅ |
| Cmd+V | 原生 `paste:` | 原生，**无气泡** ✅ | xterm 隐藏 textarea 消费原生 paste 事件→shell ✅ | 原生，无气泡 ✅ | 原生，无气泡 ✅ |

**气泡问题的根因与消除**：WKWebView 只对**程序化**粘贴（`execCommand('paste')`）弹
原生确认气泡；**原生菜单粘贴**是 OS 判定"用户主动"的操作，直接放行。因此用 predefined
（而非保留转发）是消除气泡的唯一干净途径 —— 这正是 D0 相对方案 B 的硬优势。

### 终端（S2）为什么 D0 可行

- **复制**：xterm 选中文本时会 `document.getSelection().addRange(...)`，把选区反映为
  DOM selection → 原生 `copy:` 复制它（浏览器终端的标准做法）。
- **粘贴**：xterm 的隐藏 textarea（`.xterm-helper-textarea`）是真实 `<textarea>`，
  原生 `paste:` 落入其中 → 触发 xterm `onpaste` → 转发 shell。这正是现有
  `useMenuPaste.ts` 注释描述的机制（只是它当时用 `execCommand('paste')` 才弹气泡）。
- Cmd+C 终端中断语义：菜单已拦截 Cmd+C（现状亦如此），SIGINT 用 Ctrl+C，**无回退**。

## 3. D0 的三个待验证假设（Phase 0 spike 定生死）

> 唯一无法靠 CI 证明的部分，必须真机 `pnpm tauri dev` 实测：

1. **child WKWebView 聚焦时原生 `copy:`/`paste:` 能送达**（wry 子 webview 是窗口内
   普通 NSView，点击即 first responder —— 理论成立，须确认）。
2. **终端复制**：xterm 选区反映为 DOM selection，原生 `copy:` 能复制。
3. **终端粘贴**：原生 `paste:` 落入 xterm 隐藏 textarea → 触发其 `onpaste` → shell。

若 1/2/3 全过 → **D0 一步到位，管道彻底拆除**。

## 4. D1（兜底）：原生 + 仅粘贴留 JS

若假设 3（终端原生粘贴）失败：

- **Copy/Cut/SelectAll 仍用 PredefinedMenuItem**（原生，覆盖全部表面 + 终端复制）。
- **Paste 保留自定义项**（Cmd+V）→ `handle_menu_event` 按聚焦 webview 分发：
  - **浏览器 webview 聚焦** → Rust（arboard，已有依赖）读剪贴板 →
    `webview.eval("document.execCommand('insertText', false, <escaped>)")`
    （insertText 非 paste，无气泡；作用于该 webview 当前聚焦元素，覆盖 S3+S4；
    必须 `JSON.stringify` 转义，纯文本注入，杜绝脚本注入）。
  - **主 webview 聚焦** → 维持 `emit(menu-paste)` → `useMenuPaste`：
    终端 `xterm.paste(text)`（替换 `execCommand('paste')`，去气泡）/ 原生输入
    `readText() + insertText`。

**D1 的关键改进**（相对方案 B）：粘贴路由的聚焦判定升级为 **webview 级**
`BROWSER_WEBVIEW_FOCUSED` —— 在 `webview_ops.rs` 页面加载完成时注入常驻 focus/blur
上报脚本（走既有 neeko:// POST 管道，复用 `scripts.rs` 注入点），
不再用 `picker_input_focused` + `neeko-browser-` 前缀 find。多面板天然安全
（同一时刻只有一个 webview 有焦点），AC4 直接满足。

**D1 代价**：保留约 30 行 JS 粘贴管道 + 1 个焦点上报脚本；远程富文本编辑器
（拦截 paste 做格式处理）会被 insertText 绕过其格式化逻辑（记录为已知取舍，见 PRD Non-Goals）。

## 5. 完整改动清单（按 D0；D1 差异单列）

### D0 删除清单（减法）

| 文件 | 改动 |
|---|---|
| `app_menu.rs` | `build_edit_submenu` 换成 4 个 `PredefinedMenuItem`；删除 `EditMenuAction` / `resolve_edit_menu_action` / `handle_menu_event` 的 Edit 分支；Cmd+W 关标签 + DevTools 逻辑保留 |
| `uri_scheme.rs` | 删除 `PickerFocus` 消息 / `PICKER_INPUT_FOCUSED` / `picker_input_focused` / `reset_picker_focus` 及相关测试 |
| `picker_script.js` | 删除 `focusin/focusout → notify('picker-focused'/'picker-blurred')` |
| `commands.rs` | `browser_start/stop_picker` 删除 `reset_picker_focus()` 调用 |
| 前端 | 删除 `useMenuPaste` / `MENU_PASTE_EVENT` / 相关常量类型 |
| 测试 | 更新 `uri_scheme`、`app_menu`、`pickerScript` 相关断言 |

### D1 增量（仅当 D0 假设 3 失败）

- `scripts.rs`：新增常驻 focus/blur 上报脚本 + `build_focus_reporter_script`。
- `webview_ops.rs`：页面加载完成时 `webview.eval(focus_reporter_script)`。
- `uri_scheme.rs`：`browser-focused/browser-blurred` 消息 → `BROWSER_WEBVIEW_FOCUSED`。
- `app_menu.rs`：Paste 自定义项 + 按 `browser_webview_focused()` 分发（浏览器 → Rust 读
  剪贴板 eval insertText；main → `emit(menu-paste)`）。
- `useMenuPaste.ts`：终端分支改 `xterm.paste(text)`。

### Windows/Linux

无 Edit 菜单、不拦截，Ctrl+C/V/A 原生直达 —— **零改动、零回归**。
功能由平台原生提供（WebView2 / WebKitGTK），三平台终态一致（见 §8 跨平台一致性）。

## 6. 验证计划（Phase 0 spike → TDD）

**Phase 0 · Spike（~30 分钟，临时改、不提交）**：Edit 换成 4 个 predefined，实测
S1–S4 × 4 命令全矩阵 + 3 个假设 + 多面板共存 → 记录 D0/D1 决策到本文件。

**Phase 1 · 落地（TDD，Red-Green-Refactor）**：

1. Red：按所选设计先写/改回归测试（`app_menu` resolve 相关删除或替换、
   `uri_scheme` focus 测试调整、`pickerScript` 5 用例去 focus 断言、D1 时新增
   `scripts.rs` focus-reporter 测试）。
2. Green：删/改代码使测试通过。
3. 全量门禁：`cargo test` / `pnpm test:run` / `pnpm lint` / `pnpm lint:fe` /
   `node --check`。
4. 真机回归：
   - macOS：全量矩阵（S1–S4 × 4 命令 + 假设 1/2/3 + 无气泡验证 + 多面板 + 大剪贴板
     粘贴，D1 时定上限/兜底如 >1MB 截断或回退 `execCommand('paste')`）。
   - Windows / Linux：冒烟矩阵（S1–S4 × 4 命令，确认原生可用、无回退）。
   - CI 无法覆盖 GUI，跨平台一致性靠**三平台真机冒烟矩阵**保障（见 §8）。

## 7. 为什么这次是根治

- **制造 bug 的机制被删除**：自定义 Edit 转发管道（hardcode main → 补浏览器 →
  加聚焦位 → 加前缀查找）整条不复存在，路由交给 OS responder chain。
- **每个表面自动获得正确行为**：S3/S4 不需要任何专项代码，是原生能力的自然结果。
- **再无"加一个表面就打一个补丁"的结构性缺陷**：未来新增 webview，D0 零改动。

## 8. 跨平台一致性（parity，硬性要求）

本项目是跨平台应用，S1–S4 的复制/粘贴/剪切/全选在 macOS / Windows / Linux 三平台
**必须行为一致**。CI 无法覆盖 GUI，一致性由设计原则 + 三平台真机冒烟矩阵共同保障。

**一致性原则**：三平台终态都收敛到「**平台原生编辑**」这一条路径 ——
- macOS：D0 用 `PredefinedMenuItem` 走原生 responder chain；
- Windows：WebView2 原生（无菜单拦截，Ctrl+C/V/A 直达）；
- Linux：WebKitGTK 原生（无菜单拦截，Ctrl+C/V/A 直达）。

即 D0 的本质是把 macOS 拉回与 Win/Linux 相同的原生路径，**不是给 macOS 特制一套行为**；
三平台功能由各自平台的原生编辑能力提供，行为一致是自然结果。

**护栏（防止未来破坏一致性）**：
- Edit 菜单必须保持 `#[cfg(target_os = "macos")]`；**禁止**在 Windows/Linux 添加带
  Ctrl+C/V/X/A 加速键的菜单项 —— Win32 / GTK 加速键同样会先于 webview 截获按键，
  一旦加上，就会把 macOS 的 bug 原样复制到 Win/Linux。
- 任何新编辑表面（未来新增 webview / 编辑器）一律走「**原生优先**」判定：
  原生能力能覆盖的，就不加 JS / 菜单转发管道。

**验收**：三平台各自跑 S1–S4 × 4 命令冒烟矩阵（见 §6）；Win/Linux 不因本任务产生
任何代码改动或行为回退（R7 / AC7）。

## 9. 实施期追加：Esc 退出选择器修复（真机验证发现，与 D0 正交）

D0 真机验证通过（A1–A3），但用户报告 **Esc 无法退出选择器**（设计文档明示
"Esc 在无 Composer 打开时退出整个选择模式"）。两条独立根因：

1. **前端把 `picker-cancelled` 误处理为 re-inject**（`useBrowserPicker.ts` 原来
   `useTauriEvent(BROWSER_PICKER_CANCELLED_EVENT, reinjectPicker)`）：浏览器 webview
   内 Esc → `picker-cancelled` → 前端**重新注入**选择器 → 从用户视角"Esc 无效"。
   修复：改为 `stopPicker`（退出整个选择模式），re-inject 仅保留给导航/周期刷新路径。
2. **键盘焦点不在浏览器 webview**（仅悬停、未点击进页面时）：Esc 落在主 webview，
   picker 的 `document` 级 `onKey`（在浏览器 webview）听不到。修复：`isPicking` 激活时
   主 webview 捕获 Esc → `stopPicker`（兜底）。

另：`picker_script.js` 的 `closeComposer()` 隐藏聚焦 textarea 后把焦点留在
`document.body`（`tabIndex=-1; focus()`），避免 WKWebView 因无聚焦元素丢失
first responder、第二次 Esc 到不了浏览器 webview 的 `onKey`（加固，非主因）。

**改动**：`useBrowserPicker.ts`（2 处）、`picker_script.js`（closeComposer）。
**测试**：`pickerScript.test.ts` 增「Esc 两段式 + 焦点保留在 body」；新增
`useBrowserPicker.test.ts`（主 webview Esc 兜底 × 未激活不触发 × picker-cancelled→stop）。
全量门禁绿（cargo 724+91、FE 1720、lint:fe 无错误）。
**真机复测清单**：① 选择器激活→选中元素→Esc（关 Composer）→再 Esc（退出）；
② 选择器激活→仅悬停（不点击）→Esc（直接退出）；③ Esc 后工具栏按钮回到 "Pick element"。

## 10. 实施期追加：Cmd+W「关闭标签」语义确认（无代码改动）

真机验证中用户报告 Cmd+W 无响应。代码取证：Cmd+W 链路（File 菜单 "Close Tab" →
`handle_menu_event` → `close-tab` 事件 → 主 webview `useAppShellData` 监听 →
`handleCloseTab(activeTabId)`）与 D0 完全无关、未改动。根因是**语义**：

- 浏览器是 **dock 面板**（`BROWSER_PANEL_ID='browser'`），**不是编辑器 tab**；
- Cmd+W 的 `close-tab` 只关闭**编辑器 tab**（会话/终端），从不关闭浏览器面板；
- 用户按 Cmd+W 期望"关浏览器"时，要么关闭的是编辑器 tab、要么无活动 tab 时无任何效果。

**用户决策（选项 2）**：Cmd+W 只关编辑器 tab 为**预期行为**，浏览器面板用 dock
图标/面板内关闭按钮关闭。→ **不产生代码改动**，本决策记入设计文档。
若未来希望 Cmd+W 关闭激活的浏览器面板，需单独任务实现（接入 dock 面板关闭逻辑）。

## 11. 实施期追加：Cmd+W 关 tab 间歇性失效 — 根治（竞态 + 状态脱节）

真机插桩确诊：菜单加速键→`handle_menu_event`→emit `close-tab` 全通（日志
`[menu] close-tab item fired`）；成功样本显示 store 内 tab 正常关闭
（`before=1 after=0`）。**故障是间歇性的**，两个独立根因：

1. **监听器重订阅竞态**：原 `useAppShellData` 的 close-tab 监听 effect 依赖
   `[activeTabId, handleCloseTab, tabKey]`，每次 tab 切换/新增都会先 unlisten 旧的、
   再异步 listen 新的 —— 中间存在「无监听器 / 旧监听器带过期 activeTabId」的窗口，
   此时按 Cmd+W 即失效。
2. **全局 `activeTabId` 脱节**：项目/worktree 切换路径
   （`setActiveProjectId`/`updateWtPath` 等）用 `tabs[projectId]?.activeTabId ?? null`
   覆盖全局值 —— 主槽为空/worktree 场景下被置 null，而 UI 高亮用的是布局
   per-group activeTabId，两者脱节。

**根治方案**（`src/app/hooks/closeActiveTabCommand.ts`）：
- 监听器**只订阅一次**（`[]` deps），事件到达时由 `closeActiveTabCommand()`
  现取项目/worktree/tab 最新状态 —— 消除重订阅竞态；
- 关闭目标改用 **`tabs[tabKey].activeTabId`**（per-tabKey 激活位，与 UI 高亮同源，
  addTab/activateTab/closeTab 均同步），不再依赖会被置空/错位的全局 activeTabId；
- `resolveCurrentTabKey()`：现取 `activeProjectId` + `activeWorktreePath` →
  `resolveTabKey`（worktree 专属 tab 空间），无项目回落 `__app__`。

**测试**：`closeActiveTabCommand.test.ts` 9 用例 —— 无项目回落 / worktree 空间 /
关闭指定激活 tab / 空激活位不关 / 槽缺失不关 / 全链路现取 / **全局 activeTabId 被
置空仍按 per-tabKey 关闭** / worktree 场景关对槽。全量门禁绿（cargo 724+91、
FE 1729）。
**复测**：真机多次 Cmd+W（含 tab 切换、worktree、项目切换后）应稳定关闭当前激活 tab。
