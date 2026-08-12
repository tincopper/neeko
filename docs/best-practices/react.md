# React 最佳实践

> 业界通用的 React / TypeScript 开发最佳实践。项目特有约定见 [前端开发指南](../.trellis/spec/frontend/index.md)。

---

## 1. 类型安全

- 严禁 `any`，必须定义严格 `interface` / `type`；props 用 `interface` 显式声明。
- 需要宽松类型时用 `unknown` 配合类型收窄，而非 `any`。

## 2. 组件边界

- 组件职责单一，单文件 ≤300 行；超过则拆分（容器/展示、子组件）。
- 逻辑下沉到 hooks，组件只负责渲染。

## 3. 数据流

- UI 层不裸写 `useEffect` 触发 `invoke`，统一收拢到自定义 hooks / Zustand actions。
- 单向数据流：子组件通过回调通知父组件，禁止直接修改父级状态。

## 4. Hook 规范

- 自定义 hook 以 `use` 前缀命名。
- 副作用在 effect 内清理（`unlisten`、定时器、订阅）。

## 5. 渲染性能

- 昂贵计算用 `useMemo`，跨组件回调用 `useCallback`，列表项用 `React.memo`。
- 避免 JSX 内联对象。

## 6. key 稳定性

- 列表渲染使用稳定且唯一的 `key`，禁止用数组 index（重排时状态错乱）。

## 7. 受控组件

- 表单输入使用受控组件，避免非受控 + 手动 DOM 操作。

---

## 相关主题

- [前端质量指南](../.trellis/spec/frontend/quality-guidelines.md) — Neeko 特有质量门禁与禁止模式
- [前端组件指南](../.trellis/spec/frontend/component-guidelines.md) — 组件模式、Props、组合方式
- [前端 Hook 指南](../.trellis/spec/frontend/hook-guidelines.md) — 自定义 Hooks、数据获取模式
