# 全局搜索功能支持（Find in Files 多模式统一搜索面板）

## Goal

为 Neeko 提供面向 IDE 的全局搜索能力：以侧边栏 Dock 面板为统一入口，支持跨文件**内容全文搜索**与**文件名搜索**，覆盖 local / WSL / SSH 三种项目环境。搜索结果即导航 —— 点击命中行在编辑器中定位打开。参考 VS Code 全局搜索（Ctrl+Shift+F）与 JetBrains Find in Files 的产品设计理念。

## Requirements

### 功能需求

1. **统一搜索面板（Dock 面板）**
   - 侧边栏左侧 Dock 面板（位于 Projects 之后），可通过快捷键与 Command Palette 打开/聚焦。
   - 面板为**多模式容器**：首版实现「内容」与「文件名」两个模式，通过 ModeTab 切换。
   - 面板状态（query、filters、开合）在应用重启后恢复（sessions.json）。

2. **内容全文搜索（Content 模式）**
   - 跨文件搜索文件内容，支持：
     - 大小写敏感切换（默认不敏感）
     - 全词匹配切换
     - 正则 / 字面切换
     - include / exclude glob 过滤（自定义 + 默认忽略 node_modules、.git、dist 等）
   - 结果按文件分组，展示命中行号、行列定位、命中行文本。
   - 点击命中行 → 编辑器打开对应文件并定位到行/列。
   - 分页加载更多（IPC 2MB 边界内），有总结果数上限保护。
   - 搜索过程中可取消（连续输入时旧请求被新请求取代，不产生乱序覆盖）。

3. **文件名搜索（File 模式）**
   - 复用现有 Quick Open 的 fuzzy 匹配、文件索引与打开能力（不新建模糊引擎）。
   - 零额外 IPC（前端本地过滤已有文件树索引）。

4. **多环境支持**
   - local：本地 ripgrep 库实时扫描。
   - WSL / SSH：通过统一 Executor 执行远程 grep，参数数组传递防注入，带超时与取消。
   - **一致性契约**：远程模式 MVP 仅承诺「字面子串 + 大小写 + 全词」；正则输入在远程降级为字面搜索并在响应标注 `degraded`。排序统一「文件路径字典序 + 行号」，保证分页稳定。

### 非功能需求

- **架构合规**：后端命令层极薄、`mod.rs` 极薄、统一执行接口（红线 #1/#6/#9）。
- **安全**：路径 `canonicalize` + `validate_within_root`；远程参数数组防注入；不放开 capabilities 全允许（红线 #8）。
- **性能**：本地引擎多线程并行；单次 IPC 返回不超 2MB；阻塞 I/O 包裹 `spawn_blocking`（红线 #3）。
- **TDD**：Red → Green → Refactor，测试先于实现。

## Acceptance Criteria

- [ ] 后端 `search_in_files` 命令注册进 `neeko_invoke_handler!`，返回 `SearchPage`（items/total/has_more）。
- [ ] 本地内容搜索：tempfile 项目内匹配大小写/全词/正则/glob，命中行号与行列正确；二进制文件跳过。
- [ ] 远程内容搜索：WSL/SSH 路径走统一 Executor，参数数组传递，15s 超时返回已收集部分 + `truncated` 标记。
- [ ] 取消语义：连续输入仅最后一个请求生效，旧请求被取消且不覆盖新结果。
- [ ] 文件名模式复用 Quick Open fuzzy 基础设施，前端本地过滤，无新增 IPC。
- [ ] Dock 面板注册（panelMeta + registry + wrapper），默认左侧 order 1，lucide Search 图标。
- [ ] 快捷键 `Ctrl+Shift+F`（含 IDEA preset）打开/聚焦面板；Command Palette 有「Search in Files…」入口。
- [ ] 结果点击 → `openProjectFile` 定位到行/列。
- [ ] 结果树虚拟滚动（复用 gitlog virtualScroll 模式），大结果集不卡顿。
- [ ] 面板状态会话恢复：query/filters/开合写入并读回 sessions.json。
- [ ] 全量回归：`cargo test`、`pnpm test:run`、`pnpm type-check`、`pnpm lint` 全绿。
- [ ] 无 `any`、无硬编码 event 字符串、无命令层平铺业务逻辑、无 deprecated `local::exec` 调用。

## Out of Scope

- 全局替换 Replace（二期）。
- 符号 / 会话模式收编（架构预留 mode 插槽，不在本期实现）。
- 搜索历史 / 收藏。
- 跨项目聚合搜索。
- 持久化索引（ripgrep 库实时扫描已满足性能要求）。
