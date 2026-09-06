# S3 Implement: 执行顺序与验证计划

> 机制以 design.md 为准（组装期 Join + 字段等值 memo）。本文只记录执行顺序与验证点。

## 实现顺序（TDD：Red → Green → Refactor）

### Step 1 — Red：新纯函数测试先行

- `gitFileDecoration.test.ts`：新增 `resolveNodeStatus` describe（精确命中 / 目录聚合 /
  折叠后代继承 / ignored 祖先上行 / 状态-忽略共存 / 与 resolveDecoration parity）
  与 `statusToNameColorClass` describe（优先级链 7 态）
- `fileTree.test.ts`：新增 `buildFileTreeView` 盖章 describe（decorate 注入字段落节点 /
  无 decorate 向后兼容 / 折叠目录同样被装饰）
- 运行确认失败（导出不存在）

### Step 2 — Green：类型 + 纯函数层

- `shared/types/file.ts`：`FileTreeGitStatus` / `FileTreeViewNode`
- `shared/utils/gitFileDecoration.ts`：提取 `resolveNodeStatus`（`resolveDecoration`
  重构为其上的呈现投影，行为零变化）；新增 `statusToNameColorClass`；
  resolver 单例暂留（FilesPanel 未迁移前保编译）
- `shared/utils/fileTree.ts`：`buildFileTreeView` +decorate 参数；子树指纹
  （Merkle，模块私有 WeakMap + `viewNodeFingerprint` 访问器——不可见、不污染
  toEqual/序列化）
- 验证：Step 1 测试全绿；既有 gitFileDecoration 测试不动全绿（重构零变化硬门）

### Step 3 — Green：组件迁移 + 比较器

- 新文件 `features/file/components/fileTreeNodeProps.ts`：`FileTreeNodeProps`
  接口 + `areFileTreeNodePropsEqual`（逐节点投影 + 子树指纹；scoped
  creating/renaming；回调身份比较——churn 型回调仅在命中节点可达，安全性论证见
  design.md §4）
- `FileTreeNode.tsx`：node 改 `FileTreeViewNode`；删 `decoration` /
  `resolveDecorationFor` props；`statusToNameColorClass` 内聚呈现；
  `React.memo(FileTreeNode, areFileTreeNodePropsEqual)`
- `FilesPanel.tsx`：删 publish/resolve 用法；decorate useCallback 接
  `resolveNodeStatus`；viewTree deps +decorate
- `FileTreeNodeRenderCount.test.tsx`：替身改读节点字段 + 复用真实比较器；
  既有 3 用例期望值不变；新增 3 场景（桶重载内容不变=0 / tab 切换=仅激活节点 /
  击键=仅输入行所在节点）
- 新增 `fileTreeNodeProps.test.ts`：比较器纯函数单测（指纹等值 / 投影等值 /
  回调身份）
- 删除 resolver：`getSharedDecorationResolver` / `createDecorationResolver` /
  `ResolveNodeDecoration` + 对应测试 describes（gitFileDecoration.test.ts 尾部两段）

### Step 4 — 回归

```bash
pnpm type-check
pnpm test:run
pnpm lint:fe
```

- PR ChangeFileTree 零改动（只消费 buildFileSummaryMap/resolveDecoration —— 已验证）
- readDirTree 剪枝链路零改动（useFileTreeSync 不动）

### Step 5 — 文档同步

- design.md §4 比较器规格按最终实现（子树指纹机制）修订
- `add_session.py` 会话记录（不主动提交代码）

## 验证矩阵

| 验证点 | 方式 |
|---|---|
| 语义 parity（色/徽标/继承/优先级） | 既有 FilesPanel/gitFileDecoration/realPayload 测试全绿 |
| 渲染隔离 6 场景 | FileTreeNodeRenderCount 渲染计数断言 |
| 比较器正确性 | fileTreeNodeProps 纯函数单测 |
| 组装盖章 | fileTree.test.ts 新 describe |
| 类型安全 | pnpm type-check |
