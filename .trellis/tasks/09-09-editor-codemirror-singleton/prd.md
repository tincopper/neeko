# 编辑器滚动后点击光标错位（CodeMirror 双实例 + WebKit focus 滚动漂移）

## Goal

修复编辑器滚动（拖滚动条/滚轮）后点击代码区光标错位。根因分两层，均已修复并验证：

1. **双实例**（护栏静默失效的帮凶）：Vite 预打包产出两份 `@codemirror/view`——`@uiw/react-codemirror` 链经 `@codemirror/lint@6.9.5` 拉起 nested 6.43.9，源码走顶层 6.43.11，分属两个 chunk。`mouseClickGuard` 的 facet 注册在 6.43.11 上，live `EditorView`（6.43.9）读不到 → **静默失效，无任何报错**。`f4b725dc`（升级 6.43.11）没到达运行时。
2. **真实根因**（单实例化后复现）：**WebKit focus 滚动漂移**。拖滚动条 blur 编辑器 → 点击代码区，CM mousedown 顺序是 `startMouseSelection` → `focusPreventScroll`（同步 focus）→ `mouseSel.start()`（dispatch 新 selection）。WebKit 下 `focusPreventScroll` 失效，focus 把视图滚到「旧 caret」所在位置 → scrollTop 漂移（浏览器原生，无 JS 赋值）→ 后续映射基于错误 scrollTop，光标落错 + 视图被拖回。
3. **简化**：移除针对未证实假设（「posAtCoords 滚动失准」）的 `caretRangeFromPoint` 自建命中测试层，映射走 CM 原生 `posAndSideAtCoords`（与 `basicMouseSelection` 同路径）。

## Requirements

- R1 单实例化：`vite.config.ts` `resolve.dedupe` + `pnpm-workspace.yaml` `overrides` 消灭重复 `@codemirror/view`（pnpm v11 不读 package.json 顶层 overrides，必须放 workspace yaml）。
- R2 单实例门禁：`.trellis/scripts/check_codemirror_singleton.py` 断言 lockfile 单版本，接入 `pnpm lint`。
- R3 修复 focus 滚动漂移：guard 焦点锚定（CM focus 前 dispatch selection 到点击处）+ 静止点击分支恢复 scrollTop（mousedown 同步完成，无闪烁）。
- R4 不破坏拖拽语义：scrollTop 恢复仅限 `moved < 10px && !extend`；拖拽/auto-scroll 不恢复。
- R5 移除误诊层：mapPoint 走 `posAndSideAtCoords`，guard 内无 `caretRangeFromPoint` 引用。
- R6 spec 记录：`.trellis/spec/frontend/quality-guidelines.md` §8（多实例）/§9（focus 滚动漂移）。

## Acceptance Criteria

- [x] lockfile 单 `@codemirror/view@6.43.11`；`check_codemirror_singleton.py` 红→绿（修复前报 `['6.43.11','6.43.9']`，修复后 `ok`）
- [x] dev 优化产物单实例：`@uiw_react-codemirror.js` 与 `@codemirror_view.js` 同 import 一个 chunk；`EditorView` 定义全 deps 仅 1 处
- [x] 探针实证根因：`cm-scroll-probe` 栈显示 scrollTop 恢复在 `start()`（mousedown 同步阶段）执行；`cm-click-probe` mapped/event scrollTop 一致（767/1289/0）；`viewId:1 connected:true`（view 未重建）
- [x] 用户 dev 验证：拖滚动条后点击光标落在鼠标处、视图不被拖回、状态栏显示正确
- [x] 回归测试（`codemirrorMouseClickGuard.test.ts` 11 用例）：静止点击恢复 scrollTop / 拖拽不恢复 / 原生 posAndSideAtCoords 映射，各真实 RED
- [x] 门禁全绿：vitest（guard 11 + codemirror 3 文件 22）+ tsc + eslint
- [x] `/neeko-check` 独立审查 PASS（0 blocker / 0 mustFix，仅 1 死代码 minor 已清）
- [x] spec §8/§9 已记录（含判别特征、修复要点、回归测试名）

## Notes

- **变更文件**：`src/shared/utils/codemirrorMouseClickGuard.ts`（333→112 行，简化后）+ 测试；`vite.config.ts`；`pnpm-workspace.yaml`；`package.json`（lint 接线）；新 `check_codemirror_singleton.py`；spec §8/§9。guard/测试仍在未提交工作树（与并发的 09-04 test-run-buttons 共存）。
- **上游根因未修**：WebKit `focusPreventScroll` 失效是 CM/WebKit 行为，应用层做适配（锚定 + 恢复）；上游修复后 scrollTop 恢复分支可删。
- **探针记录**：`cm-click-probe` / `cm-scroll-probe` 已全部移除（TEMP-PROBE 清理），分析见会话 journal。
- **提醒**：`/Applications/Neeko.app` 为旧构建，需 `pnpm tauri build` 重装才含修复。
