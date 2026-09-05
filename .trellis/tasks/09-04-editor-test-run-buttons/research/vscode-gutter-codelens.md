# VS Code — gutter / CodeLens / decorations 渲染管线

> 一手来源：`vscode.d.ts`（microsoft/vscode `main`，2026-09-05 拉取，本地 `/tmp/vscode.d.ts`，21238 行）。
> 公共搜索不可用，全部结论来自 API 定义原文；行为语义页（docs/testing）未逐行验证处已标注。

## 1. 三个正交机制（关键：CodeLens 不在 gutter 里）

| 机制 | 位置 | 可交互 | 用途 |
|---|---|---|---|
| Breakpoint gutter 列 | 行号左侧，**core 所有** | 点击 toggle breakpoint（core 行为） | 断点/调试 |
| Decoration `gutterIconPath` / `gutterIconSize`（`vscode.d.ts:1090`） | 同一 gutter 列叠加图标 | **不可点击**（纯渲染，无点击路由） | 错误/警告/测试状态图标等只读标记 |
| `CodeLens` | **源码行之间的独立横行**（"shown as dedicated horizontal lines in between the source text"） | 点击 → 执行其 `command`（经 `commands.executeCommand` 路由） | Run Test / Debug、引用计数等可执行入口 |

原文（`vscode.d.ts:2830` 起）：

> "A code lens represents a `Command` that should be shown along with source text, like the number of references, **a way to run tests**, etc."
> "A code lens provider adds `Command` commands to source text. The commands will be shown as **dedicated horizontal lines in between the source text**."

## 2. CodeLensProvider 契约（`vscode.d.ts:2875`）

```ts
interface CodeLensProvider<T extends CodeLens = CodeLens> {
  onDidChangeCodeLenses?: Event<void>;                       // 刷新信号（推）
  provideCodeLenses(document, token): ProviderResult<T[]>;   // 快：只给 range，不解析命令
  resolveCodeLens?(codeLens, token): ProviderResult<T>;      // 懒：每个可见 lens 逐个 resolve
}
```

- **两阶段是性能设计**：`provide` 必须尽快返回（只定行），昂贵的命令构造推迟到 `resolve`（只对可见行调用，滚动时触发）。
- 注册：`languages.registerCodeLensProvider(selector: DocumentSelector, provider)`（`vscode.d.ts:14892`）——按**语言选择器**作用域（≈ `when` 门控的语言维度）；同一语言可注册多个 provider，core 汇总各自数组展示（**无去重语义**，冲突靠各自 `selector` 收窄避免）。
- 点击路由：`CodeLens.command: Command { title, command, arguments? }` → core 调 `commands.executeCommand`。provider 不碰 DOM、不处理鼠标事件。

## 3. 断点与执行按钮如何共存

- **断点列归 core**：点击空白 gutter 即 toggle breakpoint；decorations（`gutterIconPath`）只能在同一列**叠加只读图标**，不能拦截点击。
- **可执行入口（Run/Debug）走 CodeLens 横行**，天然与断点列零冲突：两者不在同一渲染通道。
- 所有权映射：测试用例发现归 testing 域（`TestController`），编辑器内联 Run/Debug 由 testing 域统一贡献；语言扩展提供用例数据，不直接画按钮（[INFERENCE] 未逐行核对 docs/testing 页，实现期复核）。

## 4. 对 Neeko 的启示

1. **渲染通道分离是最彻底的冲突解决**：VS Code 用"列（只读图标）vs 行间横块（可点击）"把断点与执行按钮物理隔离。Neeko 当前单列合并是列宽约束下的合理取舍，但要意识到这是把两个通道压进一个 DOM，合并器必须显式处理命中判定。
2. **provide/resolve 两阶段**值得抄：用例行检测（快，纯文本扫描）vs 命令/菜单构造（懒，点击时）分离；当前 `parseTestCases` 已是快路径，`onMenuRequest` 的菜单构造已是懒路径——形态已对齐，只缺接口显式化。
3. **`onDidChangeCodeLenses` 即推式刷新**：provider 持有刷新事件，core 订阅。对应 CM6 形态就是 `StateEffect`（当前 `refreshTestCodelensEffect` 已是该语义）。
4. **注册作用域用语言选择器**：对应推荐方案里的 `when(ctx)` 门控（`isTestFile`/`*.rs`/可编辑性）。

来源：
- https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts（`CodeLens`/`CodeLensProvider`/`gutterIconPath`/`registerCodeLensProvider`）
- https://code.visualstudio.com/api/references/vscode-api
