# S4 文件树窗口虚拟化

> 调研文档 S4：「默认 depth=1 或 2 展开，深度懒加载；树组件窗口虚拟化 → 万级节点渲染 O(可见行数)」。

## Goal

文件树从「全量渲染已展开节点」切换为「窗口化只渲染可见行」；初始扫描深度 3→2。

## Requirements

- R1: `flattenFileTreeView(viewTree)` 纯函数：嵌套视图树 → 有序扁平行
  （node / renaming / creating 三种行；renaming 替换本行、creating 位于子列表首位）
- R2: FilesPanel 用共享 `VirtualList`（@tanstack/react-virtual，动态测量）渲染扁平行；
  initialRect 兜底保证 jsdom 测试与首帧
- R3: FileTreeNode 拆为无递归 `FileTreeRow`（行渲染 + 拖拽 + 定位滚动 effect）；
  memo 比较器保留指纹（扁平行天然免除父子元素断供问题）
- R4: 定位（tab 切换/手动）经 VirtualListHandle.scrollToIndex 对齐目标行
  （虚拟化后目标行可能未挂载，scrollIntoView 不再可靠）
- R5: DEFAULT_TREE_DEPTH 3→2（根初始扫描减半，第三层走懒加载）
- R6: 渲染计数 harness 与 FilesPanel 测试适配新结构；行为语义不变

## Non-Goals
- 树/列表拖拽重排、S2 排除式监听、fsmonitor 引导（各自独立）

## AC
- [ ] flatten 纯函数单测（顺序 / renaming / creating / depth）
- [ ] 渲染计数场景在新结构下全部保持语义
- [ ] FilesPanel 既有测试全绿；大列表仅渲染可见窗口（单测断言挂载行数）
- [ ] cargo/pnpm 全量回归绿
