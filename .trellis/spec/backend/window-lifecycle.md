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
┌── Rust (app.rs) ──────────────────────────────────────┐
│                                                         │
│  .menu(CmdOrCtrl+W)  →  on_menu_event → emit "close-tab"│
│  CloseRequested     →  #[cfg(macos)] prevent_close()   │
│                                                         │
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

## 修改本逻辑时的检查清单

- [ ] `app.rs` 中 `CloseRequested` 对 macOS 调用了 `prevent_close()`？
- [ ] `WindowControls.tsx` 使用的是 `.destroy()` 而非 `.close()`？
- [ ] 前端 `close-tab` 监听**永远不会**调用 `getCurrentWindow().destroy()`？
- [ ] 菜单项 `CmdOrCtrl+W` 加速器已注册？
- [ ] 新增关闭路径无需额外标记来区分来源？
