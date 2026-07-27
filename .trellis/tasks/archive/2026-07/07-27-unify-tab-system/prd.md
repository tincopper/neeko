# 统一 Tab 系统协议与交互

## Goal

统一 editor tabs（`editorStore`）与 dock panels（`dockStore`）两套 tab 系统的「打开 / 关闭 / 排序 / 激活」操作与交互层，消除拖拽排序后关闭错乱的 bug，建立可复用的 `TabBar` / `TabItem` 纯展示组件 + adapter 模式。统一操作协议与 UI，但**不合并底层数据模型**。

## Background

当前存在两套并行的 tab 实现：

| 维度 | editor tabs | dock panels |
|---|---|---|
| store | `editorStore`（tabs + editorLayout） | `dockStore`（zones + panels） |
| 展示组件 | `TabBar` / `TabItem`（@dnd-kit） | `DockZoneTabs`（shadcn Tabs + HTML5 drag） |
| 关闭 | `closeTab(projectId, tabId)` | `closePanel(panelId)` |
| 排序 | `reorderTab`（@dnd-kit，同 group） | 无同 zone 排序，仅 `movePanel` 跨 zone（HTML5 drag） |
| 关闭副作用 | 销毁 PTY / 未保存确认 | 仅隐藏视图 |

已定位的真实缺陷：

1. **pointer 通道共享导致拖拽劫持关闭**：`TabItem` 根 div 同时挂载 dnd-kit `listeners` 与关闭按钮 `×`，`×` 上 pointerdown 冒泡被 PointerSensor 捕获，轻微移动（≥5px）触发拖拽而非关闭，用户感知为「关错了 / 没关成」。
2. **`DockZoneTabs` 使用 HTML5 drag**：违反 `interaction-patterns.md` spec（Windows/Tauri 与 `data-tauri-drag-region` 冲突，已于 2026-06-02 在项目列表处弃用）。
3. **关闭逻辑分散三处**：`EditorGroupPane.handleCloseTab`（未保存确认）、`useTabManagement.handleCloseTab`（全表扫描所有 tabKey 找 tabId）、`terminalTabCleanup.closeEditorTab`（PTY 回收）。
4. **`useTabManagement.handleCloseTab` 全表扫描**：依赖「tabId 全局唯一」隐式契约，无 tabKey 上下文。

## Requirements

- **R1 统一展示组件**：`TabBar` / `TabItem` 泛型化，editor 与 dock 共用同一份；纯展示，不直接读 store，通过 props + 回调注入（符合 `component-guidelines.md` 展示组件 + adapter 模式）。
- **R2 修复 pointer 劫持**：关闭按钮 `×` 与 dnd-kit 拖拽监听隔离，`×` 上的 pointerdown 不触发拖拽。
- **R3 DockZoneTabs 迁移 @dnd-kit**：移除 HTML5 drag，用 @dnd-kit 实现同 zone 排序，符合 `interaction-patterns.md`。
- **R4 关闭逻辑收敛**：`useTabManagement.handleCloseTab` 使用 tabKey 上下文，删除全表扫描；未保存确认逻辑保留单一入口。
- **R5 关闭基于 ID 不变**：所有关闭/排序/激活路径继续基于字符串 ID，不引入 index-based 操作。
- **R6 数据模型不合并**：`editorStore` 与 `dockStore` 各自保留（生命周期、布局模型、副作用不同）。

## Constraints

- 不改变现有 tab 功能行为：终端 PTY 回收、文件未保存确认、pinned tab、split left/right、跨 zone 移动 panel。
- 不引入新依赖（@dnd-kit 已存在）。
- 遵循 spec：展示组件不读 store、@dnd-kit 拖拽、`React.memo` + `interface` Props。
- 保持回归集通过：`pnpm lint` / `pnpm type-check` / `pnpm test:run` / `cargo test`。

## Acceptance Criteria

- [ ] AC1 拖拽排序后点击 `×`，关闭的是被点击 tab 对应的 ID（回归测试覆盖）。
- [ ] AC2 在 `×` 按钮上 pointerdown 后轻微移动（<5px 或任意距离）不触发拖拽排序。
- [ ] AC3 editor 与 dock 共用同一 `TabBar` / `TabItem` 组件实例（无并行实现）。
- [ ] AC4 `DockZoneTabs` 使用 @dnd-kit，支持同 zone 内 panel 排序；HTML5 `draggable` / `onDragStart` 移除。
- [ ] AC5 `useTabManagement.handleCloseTab` 不再遍历 `state.tabs` 全表，使用 tabKey 定位。
- [ ] AC6 `pnpm lint` / `pnpm type-check` / `pnpm test:run` 通过。
- [ ] AC7 手动验证：`pnpm tauri dev` 下拖动 editor tab 排序后关闭、dock panel 排序后关闭，行为正确。

## Out of Scope

- 跨 group（editor left↔right）拖拽、跨 zone（dock）拖拽--留作未来扩展。
- `editorStore` 与 `dockStore` 数据模型合并--明确不做（见 design.md 权衡）。
- `editorStore.closeTab` 内激活策略上移到 layout 层--标注为已知技术债，本次不处理（基于 ID 当前工作正常）。
- 新增 tab / panel 类型。

## Notes

- 规划依据见 `design.md`（技术设计、边界、权衡）与 `implement.md`（执行计划、验证、回滚）。
- 现状证据（文件:行号）记录在 `design.md` 的「现状基线」节。
