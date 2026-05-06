# Task: frontend-optimization

## Overview

对 Neeko 前端代码进行全面优化，消除架构重复、移除死代码与未使用依赖、改进构建配置。

## Requirements

### Phase 1: 消除终端层重复代码 (~400 行可消除)

1. 统一三个终端缓存模块：`terminalCache.ts`、`wslTerminalCache.ts`、`remoteTerminalCache.ts`
   - 三者 ~80% 逻辑重复，仅 key 前缀、invoke 命令名、连接标识不同
   - 方案：创建参数化的 `GenericTerminalCache<TAdapter>`，通过 `TerminalBackendAdapter` 接口抽象差异

2. 统一三个终端视图组件：`TerminalView.tsx`、`WSLTerminalView.tsx`、`RemoteTerminalView.tsx`
   - 三者 ~70% 逻辑重复，生命周期、事件监听、ResizeObserver 完全一致
   - 方案：创建 `GenericTerminalView` 组件，props 中包含 backend adapter 配置

3. 统一 Agent 切换/启动逻辑
   - `terminalCommands.ts` 的 `switchAgentInTerminal` / `launchAgentInTerminal` 与 WSL/Remote cache 中对应函数完全重复
   - 方案：抽取为通用函数，参数化 invoke 命令

### Phase 2: 消除连接层重复代码 (~180 行可消除)

4. 合并项目卡片组件：`WSLProjectCard.tsx` + `RemoteProjectCard.tsx` → `ConnectionProjectCard.tsx`
   - 两个文件 ~95% 结构重复，都是 `ProjectItemCard` 的包装器
   - 差异仅在于 git invoke 命令名和连接标识符类型
   - 方案：通过 `source: { type: "wsl" | "remote", id: string }` + CommandStrategy 模式统一

5. 简化连接类型定义 `connections/types.ts`（200行）
   - `WSLProjectCardProps` / `RemoteProjectCardProps` 和 `WSLItemProps` / `RemoteItemProps` 各 ~85% 重复
   - 方案：抽象为 `ConnectionProjectCardProps<TConn>` 泛型接口

### Phase 3: 架构卫生

6. 删除死代码
   - `useUnifiedProjects.ts`（308行）：已在 `useAppContainer` 中被三独立 hook 替代，无任何消费者
   - `adapters/` 目录（5个文件）：仅被 `useUnifiedProjects` 引用
   - 确认后可安全移除，约 400 行

7. 拆解 `useAppContainer.ts`（653行 God Hook）
   - 编排 18 个子 hook，构造 5 个巨型 props 对象，含 45+ `useCallback`
   - 方案：将 props 构造逻辑拆分为独立工厂函数，或拆分为 2-3 个中间协调 hook

8. 修复 `useSyncToStore.ts` 闭包过期风险
   - `selectProject`、`selectWslProject` 等回调直接存入 Zustand store，存在 stale closure 窗口
   - 方案：使用 `zustand.getState()` 或事件总线模式替代 store 内回调

### Phase 4: 依赖优化

9. 移除未使用 npm 依赖
   - `@codemirror/theme-one-dark` — 无任何 import（项目用 `@uiw/codemirror-themes`）
   - `@tauri-apps/plugin-fs` — 无代码引用，capabilities 中也无权限
   - `@lezer/highlight` — 作为直接依赖冗余（已是传遖依赖）

10. 优化 highlight.js 双重加载问题
    - `MarkdownPreview.tsx` 通过 `rehype-highlight` 引入全量 highlight.js
    - `diff/highlight.ts` 已实现按需语言懒加载
    - 方案：替换 rehype-highlight 为自定义插件，复用按需加载逻辑

### Phase 5: 构建优化

11. 添加 CodeMirror 生态到 `vite.config.ts` 的 `manualChunks`
    - 30+ 个 `@codemirror/*` / `@lezer/*` / `@uiw/*` 包未分组，分散在多个小 chunk

12. 消除 CSS hljs 颜色样式重复
    - `index.css:155-171` 和 `theme.css:99-165` 中颜色定义重复
    - 方案：通过 CSS 变量统一

## Acceptance Criteria

- [ ] 终端缓存从 3 个文件合并为 1 个通用实现，功能等价
- [ ] 终端视图从 3 个组件合并为 1 个参数化组件，功能等价
- [ ] 项目卡片从 2 个组件合并为 1 个，功能等价
- [ ] `useUnifiedProjects.ts` 和 `adapters/` 目录已移除或评估确认保留
- [ ] `useAppContainer.ts` 拆分为更小的协调单元
- [ ] `useSyncToStore.ts` 不再将回调存入 Zustand store
- [ ] 3 个未使用 npm 依赖已从 `package.json` 移除
- [ ] rehype-highlight 替换方案已实施（或评估决定保留）
- [ ] CodeMirror 包已加入 `manualChunks`
- [ ] CSS hljs 样式重复已消除
- [ ] `pnpm type-check` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 全部通过（如有修改影响现有测试则更新测试）
- [ ] 无功能回退 — 所有交互行为与优化前一致

## Technical Notes

- 终端层统一的关键抽象是 `TerminalBackendAdapter` 接口，封装 (1) cache key 前缀 (2) invoke 命令名 (3) 连接标识符
- 项目卡片统一使用 Strategy 模式：WSL 用 `DirectInvokeStrategy`，SSH 用 `RemoteInvokeStrategy`
- 移除 adapter 目录前需确认 `useUnifiedProjects` 确实是计划弃用而非未完成迁移
- `useSyncToStore` 重构需保持 store 响应式，可考虑在 action creator 中调用 `getState()`

## Out of Scope

- 后端 Rust 代码优化（`git/local.rs` 拆分等）
- mermaid 懒加载优化（已是最优）
- lucide-react tree-shaking 改善（需升级版本，涉及破坏性变更）
- 任何功能性新需求
- 后端 WSL/Remote 命令重复消除（单独的 backend 优化任务）
