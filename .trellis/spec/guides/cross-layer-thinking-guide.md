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

## Per-Project 元数据扩展四步法

在 `Project` / `WSLProject` / `RemoteProject` 三种项目模型上加一条"每个项目一份"的元数据（如 `selected_agent`、`selected_ide`、`avatar_color`），在本仓库需要走完下面四步才不会落下半截。漏掉任何一步都会出现"重启丢字段、添加项目无值、UI 无法读"等典型 bug。

### 步骤 (a)：Rust struct 加字段

In-memory `Project`（`src-tauri/src/models/project.rs`）+ 三处持久化 session struct（`ProjectSession` / `WSLProjectSession` / `RemoteProjectSession`，均在 `src-tauri/src/models/session.rs`）必须同时加，**所有持久化字段都加 `#[serde(default)]`** 才能保证旧 sessions.json 反序列化不报错：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSession {
    // ...
    #[serde(default)]
    pub avatar_color: Option<String>,
}
```

### 步骤 (b)：双向 clone 走通持久化与启动加载

这一步最容易漏。本仓库的项目状态有两条数据路径：

- **保存路径**：`storage::create_session_from_projects(...)` 把内存 `Project[]` 转成 `ProjectSession[]` 落盘——必须 clone 新字段
- **加载路径**：`app.rs` / `project::add_project_from_session(...)` 把 `ProjectSession` 还原回内存 `Project`——必须读出新字段

只补一边的话，"保存了但启动后丢失"或反之。

### 步骤 (c)：三个对称 setter 命令

写入路径不能只走整批 `save_session`：UI 一般是改一个字段就要立即落盘，整批保存会带上其他用户没动的字段。需要三个对称命令：

| Setter | 写入策略 |
|--------|---------|
| `set_<field>` (Local) | `ProjectManager.set_<field>(id, value)` 改内存 → `StorageManager.save_session()` 落盘 |
| `wsl_set_project_<field>` | `load_session() → 改 wsl_entries[*].projects[*].<field> → save_session()` 整批模式（无 in-memory manager） |
| `remote_set_project_<field>` | 同 wsl，用 `remote_entries` |

三个都要在 `lib.rs` 的 `neeko_invoke_handler!` 注册，否则前端 `invoke` 会 404。

### 步骤 (d)：前端三处 TS interface + UI

- `src/types/project.ts` 加 `Project` 字段
- `src/types/connection.ts` 加 `WSLProject` / `RemoteProject` 字段
- store 透传：`useAppStore.projects` 系列直接消费新字段，无须额外切片
- 渲染组件接收新字段（如 `ProjectGroup` 的 `avatarColor` prop）
- 修改 UI 调对应 setter（`ProjectPanel.tsx` 的 `handleAvatarColorChange`）

### 漏步骤的症状对照表

| 漏掉哪一步 | 用户感知症状 |
|-----------|-------------|
| (a) 漏掉某个 session struct 的字段 | 该种项目（local / wsl / remote 之一）保存后字段丢失 |
| (a) 漏掉 `#[serde(default)]` | 旧 sessions.json 反序列化直接 panic，应用起不来 |
| (b) 漏掉 `create_session_from_projects` clone | 用 setter 改了字段→重启后丢失 |
| (b) 漏掉 `add_project_from_session` 读取 | 持久化里有值但启动后内存里是 None |
| (c) 漏掉 setter 之一 | 该种项目无法在 UI 即时改字段，必须等下次整批 save_session 顺路捎上 |
| (c) 漏掉 `neeko_invoke_handler!` 注册 | 前端 invoke 404，编译能过 |
| (d) 漏掉 TS interface 字段 | 前端 `project.<field>` 一直是 undefined，类型层不报错（因为是可选字段） |

### 实例参考

`avatar_color` 完整改动横跨：
- 后端：`src-tauri/src/models/project.rs:67`、`src-tauri/src/models/session.rs:13`、`src-tauri/src/project.rs`、`src-tauri/src/storage.rs`、`src-tauri/src/app.rs`、`src-tauri/src/commands/{project,wsl,remote}.rs`
- 前端：`src/types/project.ts`、`src/types/connection.ts`、`src/utils/projectAvatar.ts`、`src/components/project/ProjectGroup.tsx`、`src/components/settings/ProjectPanel.tsx`、`src/hooks/useLocalProjects.ts`、`src/components/connections/{WSLDialog,RemoteDialog}.tsx`

### 检查清单

- [ ] 内存 `Project` + 三处 session struct 都加了字段
- [ ] 持久化字段都标了 `#[serde(default)]`
- [ ] `create_session_from_projects` clone 该字段
- [ ] `add_project_from_session` 接收并填充该字段
- [ ] 三个对称 setter 命令实现并注册到 `neeko_invoke_handler!`
- [ ] `src/types/project.ts` 与 `src/types/connection.ts` 同步加字段（snake_case 镜像）
- [ ] UI 调用对应 setter
- [ ] 写 serde 往返单测验证缺字段反序列化为 None

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

---

### Bug 3：IME 事件重复建模导致重复输入与延迟

**场景**：macOS 使用微信输入法时，先输入中文再切换英文，会出现卡顿、重复提交（如 `啊啊啊啊啊 a啊啊啊啊啊 a`）等不稳定现象。

**问题链路**：
```
应用层自己实现 composition 状态机（isComposing/compositionPendingText）
与 xterm.js 内部 CompositionHelper 并行存在
→ 两套状态机在异步 setTimeout(0) 链路上不同步
→ 一端提前清理去重标记，另一端仍在发送组合文本
→ 出现重复输入、输入延迟、偶发卡住
```

**根因**：
1. **跨层契约冲突**：应用层重写了本应由 xterm.js 统一处理的 IME 生命周期（`compositionstart/update/end`）。
2. **异步时序竞争**：xterm.js 在 `compositionend` 后通过 `setTimeout(0)` 读取 textarea 并发射数据；应用层同步清理标记会破坏去重逻辑。
3. **错误修复方向**：通过更多超时、fake event、额外状态变量补丁式修复，放大了 race condition，而非消除重复职责。

**最终修复原则**：
1. **单一事实源**：IME 组合输入只由 xterm.js 处理。
2. **应用层最小化职责**：仅监听 `term.onData` 并转发到 PTY，不再自行维护 composition 状态。
3. **避免伪造事件**：不再派发 fake `compositionend` 干预 xterm.js 内部状态。

**落地方式**（`src/components/terminal/terminalInput.ts`）：
```typescript
export function setupTerminalInput({ term, sendInput }: { term: Terminal; sendInput: (text: string) => void }) {
  const disposable = term.onData((data) => {
    sendInput(data);
  });

  return {
    dispose: () => {
      disposable.dispose();
    },
  };
}
```

**教训**：
1. 对第三方输入组件（xterm、编辑器、WebView）要先确认“谁拥有输入状态机”，避免重复建模。
2. 遇到 IME bug 时优先减少自定义干预层，而不是叠加更多事件补丁。
3. 涉及 `composition*` + `setTimeout(0)` 的路径应默认按“异步竞争”问题看待。

---

### Bug 4：前端硬编码列表与后端注册表漂移

**场景**：设置面板"Built-in Agents"区块从前端常量 `BUILTIN_AGENTS` 渲染，与后端 `agent.rs::add_default_agents` 注册的真实列表分叉：
- 后端 7 个内置 agent（`opencode/claude-code/gemini/codex/qoder/codebuddy/pi`）
- 前端常量只有 6 个（缺 `pi`），且 `qoder` 的默认 command 在前端写成 `qoder`，后端实际是 `qodercli`

用户每次新增/重命名内置 agent 都要手工同步两边，漂移只是时间问题。

**问题链路**：
```
后端 add_default_agents 增加 pi → 前端 BUILTIN_AGENTS 常量没人改 → 设置面板缺一项
后端 qoder.command 改成 qodercli → 前端常量保留旧值 → 设置面板显示的"默认命令"与实际执行不一致
```

**根因**：把"内置注册表"这种**单一权威来源**复制了一份在前端，没有用 IPC 拉取。当一份内容存在两个 source-of-truth，迟早漂移。

**教训**：
1. **凡是后端已有注册表（agents、IDE 预设、shell 预设...），前端必须 fetch，不得维护并行的硬编码列表。**
2. 如果某些纯展示元数据（如默认 skill 路径、icon 文件名）确实只对前端有意义，**也应放进后端 struct + serde 字段**而不是另起一份前端常量；通过加 `is_builtin: bool` 这类区分字段让前端按需过滤。
3. 类型字段加在后端时同步给 `src/types/agent.ts`，并保持 snake_case（与项目其他字段一致，参见 `backend/type-safety.md`）。
4. 改完后用 `cargo test` + `pnpm test` 双跑，确认前端测试中 `expect(invoke).toHaveBeenCalledWith('list_agents')` 一类断言仍生效。

**正确模式**：
```typescript
// ✅ 前端只 fetch，不硬编码
const [builtins, setBuiltins] = useState<AgentConfig[]>([]);
useEffect(() => {
  invoke<AgentConfig[]>("list_agents")
    .then((list) => setBuiltins(list.filter((a) => a.is_builtin === true)));
}, []);
```

```typescript
// ❌ 错误：前端维护并行常量
export const BUILTIN_AGENTS = [
  { id: "opencode", name: "opencode", command: "opencode", ... },
  // ...每次后端改都得记得改这里
];
```

**配套防御**：信任字段（`is_builtin`、`default_skill_path`）必须在后端所有入口清零，详见 [backend/type-safety.md → 信任标识字段与防御层](../backend/type-safety.md#信任标识字段与防御层)。
