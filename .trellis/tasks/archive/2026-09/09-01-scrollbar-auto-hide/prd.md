# App scrollbar auto-hide on scroll with 3s delay

## Goal

应用全局滚动条行为统一为：**仅滚动时显示，最后一次滚动 3s 后自动隐藏**。替代当前常驻显示的多套滚动条体系。

## Decisions（grill-me 会话确认 + 实机验证修订）

1. **架构**：原生滚动条 + 全局 `.is-scrolling` 类（零依赖）；显隐瞬时切换，无渐隐动画（已接受）。
2. **CSS 载体（实机验证后修订）**：~~`::-webkit-scrollbar` 伪元素~~ → **标准属性 `scrollbar-color` 切换**。
   原因：macOS WKWebView 对伪元素样式的动态 class 切换**不重绘滚动条**（Chromium 会），
   首版实施后真实窗口滚动条永久不可见。标准属性走普通样式重算，两端可靠；
   且设置标准属性后两端都禁用伪元素样式，行为统一。
   **接受的代价**：宽度为 UA `thin`（无法精确 6px）；滚动条区域 hover 无法重新显示
   （标准属性不能对滚动条部件用 `:hover`）——原 Q2 决策作废。
3. **计时语义**：capture + passive 委托监听；所有 scroll 事件（含程序化滚动）重置 3s 计时器；持续滚动期间常显。
4. **Radix ScrollArea 退场**：PRDetailView 改为普通 overflow 容器；删除 `src/ui/ScrollArea.tsx` 与 `ui/index.ts` 导出。
5. **宽度统一**：~~全局 6px~~ → UA `thin`；删除 `.thin-scrollbar` 变体并清理 19 处类名。

## Requirements

- 新增 `src/shared/utils/scrollAutoHide.ts`：`initScrollAutoHide(delay = 3000): () => void`
  - `document` 上单份 capture + passive 委托 `scroll` 监听
  - 滚动元素加 `.is-scrolling`；WeakMap 存每元素定时器；最后一次 scroll 后 3s 移除类
  - 非 Element target 忽略；返回 dispose 供 HMR/卸载清理
- `base.css`：
  - 删除 `* { scrollbar-width/color }` 标准属性（Chromium 121+ 下会禁用 `::-webkit-scrollbar` 伪元素）
  - 全局 6px、track/corner 透明、thumb 默认 transparent、`.is-scrolling`/`:hover` 显示、`:active` 加深
  - 删除 `.thin-scrollbar` 整块
- `useAppShell` 挂载一次 `initScrollAutoHide`
- 清理 17 处 `thin-scrollbar` 类名
- PRDetailView 去 Radix ScrollArea 化

## Exclusions（不动）

- 主终端 `.terminal-wrapper`（本来无滚动条）
- Console `.xterm-themed-scrollbar`（xterm overlay 滑块自带隐藏）
- `no-scrollbar` 类（永久隐藏）
- `theme.css` 的 `color-scheme`

## Acceptance Criteria

- [x] 任意原生滚动容器：静止时滚动条不可见；滚动时 thumb 出现（UA thin）；停止 3s 后消失
      （Tauri macOS WKWebView 实机截图验证：滚动时出现 / 3.5s 后隐藏）
- [x] CodeMirror 编辑器、侧栏、设置等全部容器行为一致（LSP 弹层 / completionTheme 局部规则同步对齐）
- [x] 布局无位移（`scrollbar-width: thin` 槽位保留；macOS overlay 滚动条本身不占布局）
- [x] `ui/ScrollArea.tsx` 删除且无引用残留（`@radix-ui/react-scroll-area` 依赖一并移除）
- [x] `.thin-scrollbar` 全仓清零（19 处类名清理）
- [x] `pnpm lint` / `pnpm type-check` / `pnpm test:run` 通过（306 文件 / 2426 tests）

## Implementation Notes

- 新增 `src/shared/utils/scrollAutoHide.ts`：document 级 capture + passive 委托，Map 管理每元素定时器，dispose 时清理监听 + 未触发定时器 + 显示态；测试 7 例（fake timers）。
- 挂载点：`useAppGlobalEffects`（`useEffect(() => initScrollAutoHide(), [])`）。
- `base.css`：`* { scrollbar-width: thin; scrollbar-color: transparent transparent }` + `.is-scrolling { scrollbar-color: var(--bg-hover) transparent }`；补齐 `no-scrollbar` 定义（TabBar 原引用但无定义，属于既有遗漏）。
- `lsp.css`（hover 卡片/签名弹窗/代码块 3 处）与 `completionTheme.ts`（cm-tooltip）局部滚动条同步改为标准属性方案。
- **WebKit 陷阱（重要经验）**：`::-webkit-scrollbar` 伪元素样式在 WKWebView 中于布局时缓存绘制，
  JS 动态切 class 不会触发滚动条重绘；Chromium 会重绘（导致 Chromium 里验证通过是假阳性）。
  涉及滚动条显隐切换时必须用标准属性 `scrollbar-color`。
