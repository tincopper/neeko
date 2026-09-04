# StatusBar registry 扩展化（左右簇统一；lsp 互斥为槽位直写）

## Goal

`StatusBar.tsx` 硬编码 JSX 改为静态 registry 机制：左右簇同渲染器，互斥语义由
`exclusiveGroup` 表达，数据监听迁入常驻 bridge。行为零变化，后续新增状态栏
功能只需加 registry entry。

## Requirements

2. 新增 `src/features/status-bar/registry.ts`：左簇（branch、lsp 槽位、
   conflicts）+ 右簇（Console、Debug、光标、Notification、Prompts）。
   order 稀疏（10/20/30…），冲突时按 id 兜底保证确定性。lsp 槽位内部
   优先级直写（install > sessions > profile），不设跨组件认领机制
   （render 期可变认领表被 react-hooks/immutability 禁止；且仅此一组互斥）。
3. 渲染器：按 side 分组、order 排序，全渲染；可见性由组件自守卫 return
   null 表达（hooks 无条件调用）。`return null` 不占 flex 布局。
4. 数据桥（常驻 render null，住 status-bar feature 内）：
   - `LspSubscriptionBridge`：原 `StatusBar.tsx:63-103` session 订阅 effect
    （先订阅后拉取防丢语义保留）。
   - `InstallProgressBridge`：原 `106-129` 的 `lsp-install-progress` 监听 +
     2000/5000ms 清除 timer；`installProgress` state 迁入 `lspStore` 小切片。
   - 禁止把监听搬进互斥 item 组件（unmount 会丢 listener，见 design）。
5. `LspStatusSection` 改内部自订阅（activeProject*、sessionEntries 不再由
   StatusBar 传参），成为标准 item。
6. 可见性不进 registry：沿用组件自守卫（无 activeProjectId 返回 null）。

## Acceptance Criteria

- [ ] StatusBar 视觉与交互与迁移前一致（左三态优先级、右簇按钮、徽标、弹窗）
- [ ] registry 快照单测：side/order 确定性、同组首个非空语义
- [ ] 既有 status-bar/lsp 单测全绿；新增 bridge/item 单测覆盖互斥切换
- [ ] `pnpm lint`、`pnpm type-check`、`pnpm test:run` 通过

## Non-goals

- 动态 register/unregister API；prompt CRUD；行为/文案变更
