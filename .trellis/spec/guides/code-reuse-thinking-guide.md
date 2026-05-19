# 代码复用思维指南

> **目的**：在写新代码之前先停下来想想——是否已经有现成的实现？

---

## 问题描述

**重复代码是不一致性 bug 的头号来源。**

当你复制粘贴或重写现有逻辑时：
- Bug 修复无法自动传播
- 行为随时间逐渐分化
- 代码库变得更难理解

---

## 编写新代码之前

### 第一步：先搜索

```bash
# 搜索相似的函数名
grep -r "functionName" .

# 搜索相似的逻辑
grep -r "keyword" .
```

### 第二步：问自己这些问题

| 问题 | 如果答案是"是"... |
|------|-----------------|
| 是否存在类似的函数？ | 使用或扩展它 |
| 这个模式是否在其他地方用过？ | 遵循现有模式 |
| 这段逻辑能否作为共享工具？ | 在正确的位置创建它 |
| 我是否在从其他文件复制代码？ | **停下来** —— 提取为共享模块 |

---

## 常见的重复模式

### 模式 1：复制粘贴函数

**错误做法**：将验证函数复制到另一个文件

**正确做法**：提取到共享工具模块，在需要的地方导入

### 模式 2：相似的组件

**错误做法**：创建一个与现有组件 80% 相似的新组件

**正确做法**：通过 props/variants 扩展现有组件

### 模式 3：重复的常量

**错误做法**：在多个文件中定义相同的常量

**正确做法**：单一数据源，到处导入

### 模式 4：跨域几乎相同的实现并行

**症状**：两个文件 90%+ 重复，差异仅在调用的 IPC 命令名称或回调名。

**实例**：`WorktreeList`（local，`src/components/project/WorktreeList.tsx`）与 `ConnectionWorktreeList`（wsl/ssh，`src/components/connections/ConnectionWorktreeList.tsx`），~92% 同源，差异主要在 `invoke("get_worktree_changed_files")` vs `invoke("wsl_get_worktree_changed_files")` 等命令名。

**为什么发生**：
- 早期只有 local 路径，加 wsl/ssh 时直接 fork 一份"复用不动"
- IPC 命令名不同就当成天然分支
- 没有 callback 接口先行抽象

**正确做法**：用 callback 接口注入 IPC，让 local 与 connection 都走同一组件：

```tsx
// Bad —— 两份并行实现
function WorktreeList({ projectId }) {
  await invoke("get_worktree_changed_files", { projectId, ... });
}
function ConnectionWorktreeList({ entryId }) {
  await invoke("wsl_get_worktree_changed_files", { entryId, ... });
}
```

```tsx
// Good —— callback 接口 + invoke 注入
interface WorktreeListProps {
  worktrees: Worktree[];
  onGetChangedFiles(path: string): Promise<FileChange[]>;
  onIsDirty(path: string): Promise<boolean>;
  onRemoveWorktree(path: string): void;
}

// adapter（local）
<WorktreeList
  onGetChangedFiles={(p) =>
    invoke("get_worktree_changed_files", { projectId, worktreePath: p })
  }
/>;
// adapter（wsl）
<WorktreeList
  onGetChangedFiles={(p) =>
    invoke("wsl_get_worktree_changed_files", { distro, worktreePath: p })
  }
/>;
```

**触发清单**：
- [ ] 两个文件的 import 列表只差 1~2 行（IPC 命令）？
- [ ] 两份的 JSX 结构几乎完全一致？
- [ ] 改一边的视觉/交互时容易忘了改另一边？

→ 提取 callback 接口、合并实现。详见 [组件指南 - 展示组件 + 数据 adapter 跨域复用模式](../frontend/component-guidelines.md#展示组件--数据-adapter-跨域复用模式)。

---

## 何时进行抽象

**应该抽象的情况**：
- 相同代码出现 3 次以上
- 逻辑复杂到足以产生 bug
- 多人可能需要使用

**不应该抽象的情况**：
- 只使用一次
- 简单的一行代码
- 抽象本身比重复更复杂

---

## 批量修改之后

当你对多个文件做了类似的修改后：

1. **回顾**：是否覆盖了所有实例？
2. **搜索**：运行 grep 检查是否有遗漏
3. **思考**：是否应该进行抽象？

---

## 陷阱：产生相同输出的非对称机制

**问题**：当两种不同的机制需要产生相同的文件集时（例如：初始化用递归目录复制 vs. 更新用手动 `files.set()`），结构性变更（重命名、移动、添加子目录）只会通过自动机制传播。手动机制会悄悄偏离。

**症状**：初始化完美运行，但更新在错误路径创建文件或完全遗漏文件。

**预防清单**：
- [ ] 迁移目录结构时，搜索所有引用旧结构的代码路径
- [ ] 如果一条路径是自动推导的（glob/copy），另一条是手动列举的，手动列举的需要更新
- [ ] 添加回归测试，比较两种机制的输出

---

## 提交前检查清单

- [ ] 已搜索现有的相似代码
- [ ] 没有应该共享的复制粘贴逻辑
- [ ] 常量只在一个地方定义
- [ ] 相似的模式遵循相同的结构
