# Journal - tincopper (Part 1)

> AI development session journal
> Started: 2026-04-07

---



## Session 1: IME candidate window position fix

**Date**: 2026-04-08
**Task**: IME candidate window position fix

### Summary

Analyzed and fixed IME candidate window not appearing at cursor position in terminal. Root cause: xterm.js 6.0.0 textarea position not synced before composition start (upstream fix in 7.0.0 PR #5759). Added syncTextareaToCursor() workaround.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `98632ff` | (see git log) |
| `61f6bf0` | (see git log) |
| `d4fab6c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Fix Rust compilation errors

**Date**: 2026-04-08
**Task**: Fix Rust compilation errors

### Summary

Fixed 12 Rust compilation errors: crate::git::wsl:: → crate::git:: (pub re-export), added mut to cmd for creation_flags() calls in local.rs, wsl.rs, wsl.rs (commands)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ec7149a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Fix IDE icon display in add project dialog

**Date**: 2026-04-08
**Task**: Fix IDE icon display in add project dialog

### Summary

Fixed IDE icon not rendering in the add project dropdown — was showing raw filename text instead of the actual icon image.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `21cdbcc` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Replace branch list with searchable dropdown

**Date**: 2026-04-08
**Task**: Replace branch list with searchable dropdown

### Summary

Fixed IDE icon display bug in add project dialog (filename text -> img tag). Replaced expandable branch list with searchable dropdown triggered by clicking the branch badge in project header.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `21cdbcc` | (see git log) |
| `645ba87` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Implement multi side terminal with tile layout

**Date**: 2026-04-10
**Task**: Implement multi side terminal with tile layout

### Summary

Added support for multiple side terminal windows (max 4) with tile layout, focus tracking, and improved resize handling

### Main Changes



### Git Commits

| Hash | Message |
|------|---------|
| `b5517f2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: Refactor App.tsx — extract 4 orchestration hooks

**Date**: 2026-04-11
**Task**: Refactor App.tsx — extract 4 orchestration hooks

### Summary

Extracted useSessionPersistence, useAppRefSync, useSideTerminalState, useAppCallbacks from App.tsx. Reduced from 575 to 419 lines. Updated hook-guidelines.md with orchestration hook pattern docs. All 189 tests pass.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2f64520` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Quick worktree creation and deletion improvements

**Date**: 2026-04-11
**Task**: Quick worktree creation and deletion improvements

### Summary

(Add summary)

### Main Changes

| Feature | Description |
|---------|-------------|
| Quick worktree creation | Add Quick/Custom toggle in GitDialog, default path `.neeko/worktrees/{name}`, branch auto-created with same name |
| Worktree deletion | Dirty check + confirm dialog + PTY session cleanup + branch deletion + spinner/fade-out animation |
| Auto terminal switch | When active worktree is deleted, auto-switch back to main terminal |
| Toast notifications | Replace `alert()` with `onShowToast` for Tauri v2 compatibility |

**Backend**:
- `src-tauri/src/git/local.rs`: `is_worktree_dirty`, `delete_branch` functions
- `src-tauri/src/commands/git.rs`: Tauri commands for above
- `src-tauri/src/lib.rs`: Command registration

**Frontend**:
- `GitDialog.tsx`: Quick/Custom mode toggle, path preview
- `ProjectItem.tsx`: Delete flow (close PTY ??remove worktree ??delete branch), spinner animation, toast errors
- `RemoteItems.tsx`: Confirm dialog + spinner for WSL/SSH
- `App.tsx`: Auto-switch to main terminal on worktree deletion, pass `showToast`
- `ProjectSidebar.tsx`: `onShowToast` prop threading
- `styles.css`: Toggle switch, spinner, fade-out animation, confirm dialog styles

**Bug fixes**:
- Permission denied on worktree delete: caused by PTY shell holding directory lock
- Tauri v2 dialog.message permission: replaced alert() with toast


### Git Commits

| Hash | Message |
|------|---------|
| `fa5c275` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: Worktree file diff preview

**Date**: 2026-04-12
**Task**: Worktree file diff preview

### Summary

Implemented worktree file diff preview feature. Added Tauri commands for getting worktree changed files and file diffs. Created WorktreeList component extracted from ProjectItem. Fixed changes section spacing and collapsible styling.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8cd938d` | (see git log) |
| `dadd9e7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 新增 One Dark Pro & Claude 主题

**Date**: 2026-04-13
**Task**: 新增 One Dark Pro & Claude 主题

### Summary

(Add summary)

### Main Changes

| ??? | ??? |
|------|------|
| AppTheme ?????? | ??? "one-dark-pro" ??"claude" ????????? |
| One Dark Pro ??? | ??? VS Code ???????????#282c34?????#abb2bf?????? #61afef |
| Claude ??? | Claude ??????????????#f5f0e8?????#2d1e14?????? #c96442?????? |
| ????????| useAppConfig ????????????????????????????????|
| UI ?????? | Appearance ????????One Dark Pro ??Claude ???????????? |

**??????**??- src/types.ts ??AppTheme ??? "one-dark-pro" | "claude"
- src/styles/theme.css ???????? [data-theme] CSS ???
- src/hooks/useAppConfig.ts ??????????????
- src/components/SettingsPanel.tsx ??4 ?????????Dark / One Dark Pro / Claude / Light??


### Git Commits

| Hash | Message |
|------|---------|
| `ca5997f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: feat: Files Panel - multi-tab editor with syntax highlighting

**Date**: 2026-04-14
**Task**: feat: Files Panel - multi-tab editor with syntax highlighting

### Summary

完成 Files Panel 功能：文件树、多 Tab 编辑器、CodeMirror 语法高亮、Markdown 预览。修复了共享 loading 状态导致闪烁、组件 unmount 后 agent 命令重复执行等关键 Bug。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `37ab639` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: Settings字体大小三分 + 全局字体变量修复

**Date**: 2026-04-14
**Task**: Settings字体大小三分 + 全局字体变量修复

### Summary

(Add summary)

### Main Changes

## ??????

### 1. Settings ???????????eat??
??`AppConfig` ???????`fontSize` ??????????????????

| ??? | ?????| ?????? |
|------|--------|---------|
| `appearanceFontSize` | 12px | ??? UI??????????????ab ??? |
| `editorFontSize` | 14px | CodeMirror ??????FileViewer??|
| `terminalFontSize` | 14px | xterm.js ??? + ??? Tab/Agent ??? |

- Settings ????????ppearance / Editor / Terminal????????Font Size ?????0??4px??- ??? `--terminal-font-size` CSS ?????theme.css` `--font-size` ????????12px
- ??`fontSize` ??????????????? `terminalFontSize`??- ?????????????MainContent??emoteProjectView??SLTerminalView??orktreeTerminalView??seAppCallbacks??seWslActions??pp.tsx

### 2. ?????? CSS ????????ix ? ?????
?????????????? `text-sm` / `text-xs` ??UI ???????????CSS ?????
**??? `--font-size`??ppearance??*??- `ProjectItem.tsx` ??????????????
- `FileTree.tsx` ??????????????????- `RemoteItems.tsx` ??WSL ???????istro ????SH ??????
- `WorktreeList.tsx` ??Worktree ?????- `FilesPanel.tsx` ??????????????????????????????- `FileViewer.tsx` ????? Tab ?????- `TitleBar.tsx` ?????????????????

**??? `--terminal-font-size`??erminal??*??- `TerminalTab.tsx` ??Tab ???????????????????????- `MainContent.tsx` ??Gear ?????anage Presets ????????gent ??????

### 3. FilesPanel ?????????????ix??
- ??lucide Folder/FolderOpen + Chevron ?????`/icons/_folder.svg` / `/icons/_folder_open.svg`??? Projects ???????????- ?????????????????spacer??? `depth * 12` paddingLeft ???

### 4. Settings ?????????feat??
- Diff View Mode ??Editor ?????? Git ???

### 5. Spec ??????

- `component-guidelines.md`????????CSS ?????????????????? text-xs/sm ????????- `hook-guidelines.md`?????AppConfig ???????????????????SS ????????????

## ??????

- TypeScript?? ???
- Vitest??00 passed, 4 skipped


### Git Commits

| Hash | Message |
|------|---------|
| `3f89314` | (see git log) |
| `6fcf489` | (see git log) |
| `04268d4` | (see git log) |
| `33d2b32` | (see git log) |
| `b18af72` | (see git log) |
| `38bbdfd` | (see git log) |
| `76087ae` | (see git log) |
| `a681f54` | (see git log) |
| `e604f70` | (see git log) |
| `aa0b61d` | (see git log) |
| `bf5e2b0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: 实现 MarkdownPreview 组件：GFM + Mermaid + PlantUML + SVG 支持

**Date**: 2026-04-15
**Task**: 实现 MarkdownPreview 组件：GFM + Mermaid + PlantUML + SVG 支持

### Summary

创建独立的 MarkdownPreview 组件，从 FileViewer 中解耦，支持 GFM、代码高亮、Mermaid（懒加载）、PlantUML、SVG、HTML 渲染，4 个主题的排版和高亮配色

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7d3f663` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 13: Terminal split pane styling fix + PR#01 complete

**Date**: 2026-04-19
**Task**: Terminal split pane styling fix + PR#01 complete
**Branch**: `main`

### Summary

Fixed terminal split pane active border to use theme border-color. Completed and archived Skill PR#01 data model task.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f57f563` | (see git log) |
| `b524232` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: Complete Skill PR#02 skill store

**Date**: 2026-04-19
**Task**: Complete Skill PR#02 skill store
**Branch**: `main`

### Summary

Marked PR#02 SkillStore SQLite CRUD as completed and archived.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c293db4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: Improve Agent Skill Path config UI

**Date**: 2026-04-19
**Task**: Improve Agent Skill Path config UI
**Branch**: `main`

### Summary

Optimized Agent Skill Path config UI in SettingsPanel. Added dedicated row with label, path display, FolderGitIcon/TrashIcon buttons, clear functionality.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `73d42a4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 16: Agent Skill Path UI

**Date**: 2026-04-19
**Task**: Agent Skill Path UI
**Branch**: `main`

### Summary

Optimized SettingsPanel Agent Skill Path configuration UI - Added Skill Path row under built-in and custom agents, default skill paths for 7 built-in agents, new Skill Path input when creating custom agents

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3d2f538` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: Fix Skill Scan Issue + Refactor Dialogs

**Date**: 2026-04-22
**Task**: Fix Skill Scan Issue + Refactor Dialogs
**Branch**: `feature/git-commit-panel`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a0f130d` | (see git log) |
| `7b40a5d` | (see git log) |
| `4133826` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 18: Implement Marketplace Backend for Skills.sh

**Date**: 2026-04-22
**Task**: Implement Marketplace Backend for Skills.sh
**Branch**: `feature/git-commit-panel`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a3f360b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 19: Implement Marketplace UI

**Date**: 2026-04-22
**Task**: Implement Marketplace UI
**Branch**: `feature/git-commit-panel`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `42c9e93` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 20: WSL/SSH worktree support and branch switching fix

**Date**: 2026-04-23
**Task**: WSL/SSH worktree support and branch switching fix
**Branch**: `main`

### Summary

Fixed branch switching for WSL/SSH projects and added worktree support

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `011303f` | (see git log) |
| `256d899` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 21: fix: SSH auth restore on restart + file tree .trellis visibility

**Date**: 2026-04-29
**Task**: fix: SSH auth restore on restart + file tree .trellis visibility
**Branch**: `main`

### Summary

Fixed two issues: (1) .trellis directory not visible in file tree panel by removing it from EXCLUDED_DIRS in Rust backend, (2) SSH authentication not restoring from saved credentials on app restart by making restoreAuthFromEntries use synchronous useAppStore.setState and optimizing effect dependencies to avoid Map reference re-triggers. Also fixed unused TerminalInputController import causing build failure.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0530425` | (see git log) |
| `9fc3075` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 22: Refactor command execution functions and sync OpenCode theme for WSL

**Date**: 2026-05-05
**Task**: Refactor command execution functions and sync OpenCode theme for WSL
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `36a5306` | (see git log) |
| `3e043af` | (see git log) |
| `a72bb8a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 23: feat: project drag-and-drop sorting with cursor following

**Date**: 2026-05-07
**Task**: feat: project drag-and-drop sorting with cursor following
**Branch**: `main`

### Summary

Replace HTML5 Drag API with Pointer Events for drag-and-drop sorting. Add DraggableProjectItem wrapper and useProjectItemDrag hook with real-time dragOffset tracking (transform: translate). Support WSL and SSH remote project list sorting. Add unit tests (250 pass). Create interaction-patterns.md spec doc.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `fdc7edf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 24: 统一Tab系统 + 修复项目切换PTY泄漏

**Date**: 2026-05-08
**Task**: 统一Tab系统 + 修复项目切换PTY泄漏
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f168600` | (see git log) |
| `b801923` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 25: unified tab system + fix PTY leak on project switch

**Date**: 2026-05-08
**Task**: unified tab system + fix PTY leak on project switch
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f168600` | (see git log) |
| `b801923` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 26: Dock Layout Design & Git Log Viewer

**Date**: 2026-05-10
**Task**: Dock Layout Design & Git Log Viewer
**Branch**: `feature/dock-layout-design`

### Summary

feat(git): add git log viewer with commit detail panel, fix UI consistency across panels

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0567e22` | (see git log) |
| `b5c93eb` | (see git log) |
| `fbfbbea` | (see git log) |
| `545e1c3` | (see git log) |
| `5590d1d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 27: Markdown 图片预览修复 + 代码质量修复

**Date**: 2026-05-15
**Task**: Markdown 图片预览修复 + 代码质量修复
**Branch**: `main`

### Summary

归档 05-14-task-runner 任务；修复 rustfmt 格式问题和 SettingsPanel 测试失败；实现 markdown 图片本地路径解析（通过 Tauri asset 协议）

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `047fc42` | (see git log) |
| `75be856` | (see git log) |
| `6273e22` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 28: Terminal Links Browser + Element Picker + URI Scheme Refactor

**Date**: 2026-05-16
**Task**: Terminal Links Browser + Element Picker + URI Scheme Refactor
**Branch**: `feature/terminal-links-browser`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0da8530` | (see git log) |
| `a93d03c` | (see git log) |
| `89f9002` | (see git log) |
| `5e97fcc` | (see git log) |
| `e175a5f` | (see git log) |
| `fdd177e` | (see git log) |
| `e924a20` | (see git log) |
| `e637ce4` | (see git log) |
| `579b67a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 29: 架构优化 Phase 1 实施：SSH 认证整合 + Theme 模块化

**Date**: 2026-05-21
**Task**: 架构优化 Phase 1 实施：SSH 认证整合 + Theme 模块化
**Branch**: `refactor/architecture-optimization`

### Summary

Phase 1A: 创建 ssh_auth.rs，消除 remote.rs 和 ssh.rs 中 4 处重复 SSH 认证块。Phase 1B: 创建 theme/ 子模块（common.rs + opencode.rs + pi.rs），提取共享工具函数，原文件改为 re-export wrapper。所有测试通过（前端 562 + Rust 78），类型检查零 error。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a8f3fad` | (see git log) |
| `9ee8855` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 30: Phase 1B Theme 编排收尾 + 策略模式重构

**Date**: 2026-05-25
**Task**: Phase 1B Theme 编排收尾 + 策略模式重构
**Branch**: `refactor/architecture-optimization`

### Summary

完成 Phase 1B 收尾：\n- 合并 strategy.rs 到 service.rs\n- mod.rs 只保留模块声明\n- 使用 Enum 策略模式替代重复 if-else\n- 同时在 config.rs/remote.rs/theme/mod.rs 应用\n- 删除旧 opencode_theme.rs 和 pi_theme.rs\n- 更新 spec 文档

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a8775fe` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 31: Phase 2A: Prop 塌缩 EditorGroupPane (30+ → 13 props)

**Date**: 2026-05-25
**Task**: Phase 2A: Prop 塌缩 EditorGroupPane (30+ → 13 props)
**Branch**: `refactor/architecture-optimization`

### Summary

Phase 2A 前端 prop 塌缩：\n- EditorGroupPane Props 从 30+ 降至 13\n- 移除 9 项 Phase 1 props（死代码 + Context 直取）\n- 移除 8 项 Phase 2 props（useEditorGroupLayout + useAppStore 直取）\n- 同步清理 EditorGroupLayout Props/SharedPaneProps/MainContent\n- npx tsc 零 error，pnpm test:run 562 passed

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0b185bc` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 32: Phase 2B: useAppContainer 拆分 (757→689, 3个新hook)

**Date**: 2026-05-25
**Task**: Phase 2B: useAppContainer 拆分 (757→689, 3个新hook)
**Branch**: `refactor/architecture-optimization`

### Summary

Phase 2B 前端 hook 拆分：\n- 新建 useAppLayoutProps.ts (26行, Bag 3)\n- 新建 useTitleBarProps.ts (91行, Bag 1)\n- 新建 useAppModalsProps.ts (60行, Bag 4)\n- useAppContainer 757→689 (-68行)\n- 依赖注入模式，避免子hook实例重复\n- post-add git refresh 改为 wrapper callback\n- npx tsc 零error，pnpm test:run 562 passed

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `08a6564` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 33: Phase 3A: Terminal 视图合并 (WSL/Remote 策略模式)

**Date**: 2026-05-25
**Task**: Phase 3A: Terminal 视图合并 (WSL/Remote 策略模式)
**Branch**: `refactor/architecture-optimization`

### Summary

Phase 3A 终端视图合并：\n- 新建 TerminalViewBase (206行)：统一 xterm 生命周期\n- 新建 strategies/ 目录：types/wsl/remote 策略接口与实现\n- WSLTerminalView: 262→30 (-89%)\n- RemoteTerminalView: 269→70 (-74%)\n- TerminalView(local) 暂不迁移 (factory+task terminal 差异大)\n- 5处重复代码统一为1处：xterm初始化/attach/ResizeObserver/agent/cleanup\n- npx tsc 零error，pnpm test:run 562 passed

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `74ef587` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
