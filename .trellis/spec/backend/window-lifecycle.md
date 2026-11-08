# 窗口生命周期与快捷键指南

> 本文件记录 Neeko 中窗口关闭、菜单快捷键（Cmd+W / Ctrl+W）、跨平台事件的交互模式与踩坑记录。

---

## 核心模式：Cmd+W 只关标签，不关窗口

### 架构概览

```
Cmd+W / Ctrl+W
    │
    ├─ macOS: 菜单加速器拦截 → on_menu_event → emit "close-tab"
    │         CloseRequested 也会触发 → prevent_close() 兜底
    │
    └─ Windows/Linux: 菜单加速器拦截 → on_menu_event → emit "close-tab"
                      CloseRequested 不触发 (Ctrl+W 不是关闭窗口的快捷键)

关闭按钮
    └─ 所有平台: WindowControls → .destroy() → 绕开 CloseRequested
```

### 三层协作

```
┌── Rust (app/close.rs + app_menu.rs) ────────────────────┐
│                                                          │
│  .menu(CmdOrCtrl+W)  →  on_menu_event → emit "close-tab" │
│                         （CloseTabFlag::mark 置位）       │
│  CloseRequested     →  platform::close_tab 判别 →        │
│                         prevent_close()（静默/询问二选一）│
│                                                          │
├── Frontend (useAppShell.ts) ───────────────────────────┤
│                                                         │
│  listen("close-tab") → handleCloseTab(tabId)           │
│  只关标签，永不调用 .destroy()                          │
│                                                         │
├── Frontend (WindowControls.tsx) ───────────────────────┤
│                                                         │
│  关闭按钮 → .destroy()  (不是 .close())                 │
│  绕开 CloseRequested，直接触发 Destroyed → shutdown     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 关键约束

### 1. macOS 的 Cmd+W 双重触发

macOS 中，**即使有菜单项注册了 `Cmd+W` 快捷键，`CloseRequested` 仍可能触发**。这是 NSWindow 的默认行为，菜单消耗键事件不一定阻止 `performClose:`。

**后果**：`on_menu_event` 和 `CloseRequested` 会同时触发，且**顺序不保证**。

**正确做法**：
- 菜单处理器负责发出 `close-tab` 事件
- `CloseRequested` 中调用 `#[cfg(target_os = "macos")] prevent_close()` 兜底
- 关闭按钮走 `.destroy()` 而非 `.close()`，不触发 `CloseRequested`

### 2. 不要用 AtomicBool 标记区分来源

以下模式**不可靠**，已在实践中验证失败：

```rust
// ❌ 不可靠 — 事件顺序不保证
let from_menu = Arc::new(AtomicBool::new(false));

on_menu_event: from_menu.store(true);
CloseRequested:  if from_menu.load() { prevent_close(); }
```

`CloseRequested` 可能在标记设置之前触发，导致 `prevent_close` 被跳过。

### 3. 不要用 prevent_close() + 前端 destroy() 做"关标签后关窗"

以下模式在实践中也会导致窗口意外关闭：

```rust
// ❌ 竞态 — close-window 可能在 close-tab 之前到达前端
CloseRequested → prevent_close() + emit "close-window"
```

当 macOS Cmd+W 同时触发菜单和 CloseRequested 时，前端可能先收到 `close-window`（无条件 `destroy()`），导致窗口直接消失，标签关闭失效。

---

## 平台差异速查表

| 触发源 | macOS | Windows/Linux |
|---|---|---|
| Cmd+W / Ctrl+W | `on_menu_event` + `CloseRequested` (prevented) | 仅 `on_menu_event` |
| 关闭按钮 (WindowControls) | `.destroy()` → `Destroyed` | `.destroy()` → `Destroyed` |
| Alt+F4 | N/A (无原生标题栏) | `CloseRequested` → 正常关窗 |
| Cmd+Q (macOS Quit) | 系统级别，不触发 CloseRequested | N/A |

---

## 常见坑

### 坑 1：菜单消失
清空 `.menu()` 或移除 CmdOrCtrl+W 菜单项后，macOS 仍可能由系统 `Window` 菜单触发 `CloseRequested` → 窗口直接关闭，前端完全无感知。

### 坑 2：infinite close loop
早期方案中前端收到事件后调用 `.close()` → 再次触发 `CloseRequested` → `prevent_close()` → emit 事件 → 前端 `.close()` → 死循环。

**解决**：用 `.destroy()` 替代 `.close()`，`destroy()` 不触发 `CloseRequested`。

### 坑 3：decorations: false 的影响
`tauri.conf.json` 中 `"decorations": false` 使窗口无边栏（关闭/最小化/最大化按钮隐藏），但不影响菜单栏（macOS 顶部菜单仍正常）。`CloseRequested` 的来源在无装饰窗口中减少到只剩快捷键触发。

---

## 启动期窗口状态：平台配置会整体替换 `app.windows` 数组

Tauri CLI（`helpers/config.rs`）用 `json_patch::merge`（RFC 7396 JSON Merge Patch）合并
`tauri.conf.json` 与 `tauri.<platform>.conf.json`：**对象深合并，数组整体替换**。
`tauri.macos.conf.json` 为了原生标题栏 / 透明 / Overlay 声明了自己的 `app.windows`，
于是主配置 `app.windows[0]` 中**没有在 macOS 配置里复写**的字段全部回落到 Tauri 默认值：
`maximized: true` → `false`、`width/height: 1200x800` → 默认尺寸。

**现象**：macOS 上应用冷启动 / 重启不是最大化；Windows / Linux 正常 —— 这两个平台配置
没有 `app.windows`，主配置原样生效。排查时不要误判为 macOS 的窗口状态恢复（Saved
Application State）：tao 未给窗口设置 `frameAutosaveName` / restoration class，不走
AppKit 自动窗口恢复。

**契约**（护栏 `check_tauri_platform_window_config` 只断言**合并后的有效配置**，
不检查配置文件形状 —— 形状只是手段，应用最终拿到什么才是事实）：

- 主配置 `app.windows` 是窗口集合与字段清单的唯一事实源；`maximized: true` 是唯一
  硬编码的产品约束（`REQUIRED_STARTUP_STATE`）；
- 护栏用纯函数 `merge_patch()` 复现 RFC 7396，算出 `merge_patch(main, platform_conf)`，
  要求每个平台的有效窗口集合与主配置同长度，且逐字段等于
  `主配置窗口 + PLATFORM_WINDOW_STATE[platform]`。缺字段、值漂移、`null` 删键、窗口
  被删/多出、平台覆盖整段消失，都在这一处显形；
- `PLATFORM_WINDOW_STATE` 是平台专属的**期望增量**（macOS 的 `title` / `decorations` /
  `transparent` / `titleBarStyle`），不是「允许差异」的许可表；它同时保证有专属契约的
  平台配置文件不得消失。新平台配置出现即自动纳入、默认继承主配置契约，新增显式窗口
  字段无需改护栏。

---

## 修改本逻辑时的检查清单

- [ ] `app/close.rs` 中 `CloseRequested` 无条件 `prevent_close()`，判别走 `platform::close_tab`（平台差异不得回到业务文件）？
- [ ] `WindowControls.tsx` 使用的是 `.destroy()` 而非 `.close()`？
- [ ] 前端 `close-tab` 监听**永远不会**调用 `getCurrentWindow().destroy()`？
- [ ] 菜单项 `CmdOrCtrl+W` 加速器已注册（`app_menu.rs`）？
- [ ] 新增关闭路径无需额外标记来区分来源？

---

## 诊断验证记录（2026-08-07：build 后 Cmd+W"完全无反应"排查）

**结论**：诊断日志证实三条链路（Rust 菜单 `on_menu_event`、前端 `close-tab` 事件监听、前端 keydown 兜底）在干净 release build 下**全部工作正常**，tab 正常关闭、窗口保持。"完全无反应"疑为旧构建产物/初始化时序偶发问题，**非代码逻辑缺陷**。未做移除 accelerator 等激进改造（有"坑 1"系统 Window 菜单接管风险）。

**经验**：
1. 排查此类"dev 正常 / build 失效"问题时，先加三处临时诊断日志确认断点，再决定是否改动代码：
   - `app_menu.rs` `handle_menu_event` 内 `log::info!`
   - `useAppShell.ts` `close-tab` 监听内 `console.log`
   - `useKeyboardShortcuts.ts` `closeTab` case 内 `console.log`
2. macOS 菜单 accelerator 与 webview keydown 的双路径兜底设计有效：即使菜单路径在异常情况下失效，前端 `Ctrl+W→⌘` 映射（`shortcutRegistry.ts` `modifiersMatch`）仍是可靠第二路径。
3. 诊断日志确认后必须移除，避免生产噪音。

