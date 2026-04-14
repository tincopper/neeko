# 跨层思维指南

> **目的**：在实现功能之前，梳理清楚跨层的数据流。

---

## 问题描述

**大多数 bug 发生在层间边界**，而非层内部。

常见的跨层 bug：
- API 返回格式 A，前端期望格式 B
- 数据库存储 X，Service 转换为 Y，但丢失了数据
- 多层分别实现了相同逻辑，但行为不一致

---

## 实现跨层功能之前

### 第一步：绘制数据流

画出数据的流动路径：

```
数据源 → 转换 → 存储 → 读取 → 转换 → 展示
```

对于每个箭头，问自己：
- 数据是什么格式？
- 可能出什么问题？
- 谁负责校验？

### 第二步：识别边界

| 边界 | 常见问题 |
|------|---------|
| API ↔ Service | 类型不匹配、缺少字段 |
| Service ↔ 数据库 | 格式转换、null 处理 |
| 后端 ↔ 前端 | 序列化、日期格式 |
| 组件 ↔ 组件 | Props 结构变更 |

### 第三步：定义契约

对于每个边界：
- 精确的输入格式是什么？
- 精确的输出格式是什么？
- 可能发生哪些错误？

---

## 常见的跨层错误

### 错误 1：隐式的格式假设

**错误做法**：不检查就假设日期格式

**正确做法**：在边界处进行显式的格式转换

### 错误 2：分散的校验

**错误做法**：在多层重复校验同一件事

**正确做法**：在入口点校验一次

### 错误 3：泄漏的抽象

**错误做法**：组件知道数据库 schema

**正确做法**：每一层只了解其相邻层

---

## 跨层功能检查清单

实现之前：
- [ ] 绘制了完整的数据流
- [ ] 识别了所有层间边界
- [ ] 定义了每个边界的数据格式
- [ ] 决定了校验发生在哪一层

实现之后：
- [ ] 用边界情况测试过（null、空值、无效值）
- [ ] 验证了每个边界的错误处理
- [ ] 检查了数据能否完整地往返传递

---

## 何时需要创建流程文档

以下情况需要创建详细的流程文档：
- 功能跨越 3 个以上层级
- 涉及多个团队
- 数据格式复杂
- 该功能以前出过 bug

---

## 已知 Bug 模式（经验积累）

### Bug 1：共享 loading 状态导致 UI 闪烁

**场景**：文件面板中，`openFile()` 和 `loadFileTree()` 共用同一个 `isLoading` state。

**问题**：`openFile()` 设置 `isLoading=true` 会让 FilesPanel 瞬间渲染 Loading 状态，导致文件树闪烁消失再出现。

**教训**：不同业务操作应使用**独立的 loading 状态**，按用途命名（如 `fileTreeLoading` vs `fileContentLoading`）。不要用单一的 `isLoading` 代表整个 hook 的加载状态。

```typescript
// ❌ 错误：共享 loading
const [isLoading, setIsLoading] = useState(false);

// ✅ 正确：分离 loading
const [fileTreeLoading, setFileTreeLoading] = useState(false);
// openFile() 完全不触碰 fileTreeLoading
```

---

### Bug 2：组件级 ref 在 unmount/remount 后丢失状态

**场景**：TerminalView 使用 `useRef<Set<string>>` 记录已执行过的 agent cacheKey。当 FileViewer 打开时 TerminalView 被条件渲染 unmount，关闭 FileViewer 后 TerminalView remount，ref 重置为空，导致 agent 命令被重复执行。

**问题链路**：
```
打开 FileViewer → showFileViewer=true → TerminalView unmount → executedAgentsRef 销毁
关闭 FileViewer → showFileViewer=false → TerminalView remount → ref 为空 Set → agent 重新执行
```

**教训**：需要跨 unmount/remount 持久的状态，应放在**模块级变量**（而非组件 ref），并与 cache 生命周期同步清理。

```typescript
// ❌ 错误：组件 ref，随 unmount 销毁
const executedAgentsRef = useRef<Set<string>>(new Set());

// ✅ 正确：模块级，生命周期与 terminalCache 绑定
export const executedAgentKeys = new Set<string>();

// 销毁 cache 时同步清理
export function destroyTerminalCache(cacheKey: string) {
  terminalCache.delete(cacheKey);
  executedAgentKeys.delete(cacheKey); // ← 同步清理
}
```
