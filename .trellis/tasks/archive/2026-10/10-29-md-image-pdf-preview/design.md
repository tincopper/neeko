# 设计：Markdown 图片渲染与 PDF 预览（第一性原理推导）

> 本文档只做技术设计。需求与验收见 `prd.md`，执行序见 `implement.md`。

## 0. 第一性原理：这个问题本质上是什么

本应用的一切「文件内容呈现」都发生在 **webview（浏览器引擎）** 内，而文件字节存在于
另一侧（本机磁盘 / WSL / SSH 远程机器）。因此**任何预览能力 = 字节搬运 × 引擎内渲染**，
没有第三件事。图片不显示、PDF 不支持，都不是「少了某个组件」，而是这条链路上某一环缺失。

把问题拆到不可再分，得到三个**正交轴**：

| 轴 | 取值 | 决定什么 |
| --- | --- | --- |
| A. 字节来源 | Local 磁盘 / WSL / SSH | 搬运通道（asset 协议够不够得着） |
| B. 字节规模 | KB 级（图片）～ 数十 MB（PDF） | 传输载体（红线 4：JSON ≤ 2MB ⇒ 大字节永不进 JSON） |
| C. 引擎渲染能力 | WKWebView / WebView2 / WebKitGTK 三引擎异构 | 只允许使用三者**交集**内的 Web 能力 |

**根因归纳**：现状缺失的不是某个功能点，而是统一的「字节搬运」抽象 ——
每个渲染点各自临时拼通道（`convertFileSrc` 直连、手写路径正则、basePath 时传时不传），
于是四个断点分别出现：

1. agent-chat 自建 ReactMarkdown 未接管 `img` → 路径原样输出、全部 404（渲染点各自拼通道的直接后果）；
2. 三个渲染点不传 basePath → 相对路径无法解析（解析逻辑没有唯一入口，参数传递靠自觉）；
3. `resolveImageSrc` 正则把 `data:` URI 在有 basePath 时误拼进 `convertFileSrc`（手写解析的必然缺陷）；
4. 远程项目全挂（通道只建了 Local 一条，抽象层缺位所以没有地方补）。

**结论**：正确切面是先建抽象（解析入口 + 字节通道），渲染点只是抽象的消费者。
逐点修补（给每个组件各打一个补丁）会把同样的断点复制到 PDF 预览和未来的视频预览上。

## 1. 三条推导（决策来自约束，不来自偏好）

### 推论 1：PDF 渲染器必须是 JS 解码（pdf.js → canvas），不能用内嵌查看器

- 三引擎交集内的能力：HTML/CSS、`<img>`、Canvas、blob URL、ArrayBuffer、Web Worker。
- `<iframe src=...pdf>` / `<object>` / PDF 插件**不在交集内**：
  WebKitGTK 无内嵌 PDF 渲染；WKWebView / WebView2 行为依赖宿主环境且不可控。
- 因此 PDF 必须在 JS 侧解码到 canvas —— 即 `pdfjs-dist`。这是约束推出来的唯一解，不是口味选择。

### 推论 2：传输载体按「消费者类型」分流，不搞单一通道

- 消费者一：`<img>` 标签。Local 文件用 `convertFileSrc` 的 asset URL 直接喂给 `<img>` ——
  标签加载不走 CORS、服务端零拷贝、无 IPC 开销。Local 图片走这条最优路径。
- 消费者二：需要 `fetch`/Worker 随机访问字节的代码（pdf.js）。asset URL 在三引擎上的
  fetch 行为存在差异（CORS 头不一致）；而 IPC 二进制流返回的 `ArrayBuffer` →
  `URL.createObjectURL` 是标准平台能力，行为一致。
- 消费者三：远程（WSL/SSH）字节。asset 协议物理上够不着远程磁盘，**只能**走 IPC。
- 归纳：**Local 图片 = asset URL；PDF 与远程一切 = IPC 二进制流 → blob URL**。
  消费者只认标准 Web 载体（`http(s):` / `data:` / `blob:` / `asset:`），不感知后端通道。

### 推论 3：红线 4 是 IPC 序列化成本的直接表达，二进制必须走 `Response::new(Vec<u8>)`

- JSON 序列化对大字节有 O(n) 编码成本 + 33% base64 膨胀 + 2MB 上限；
  `tauri::ipc::Response::new(Vec<u8>)` 是零编码的原生二进制通道（仓库已有先例：
  `src-tauri/src/terminal/router.rs` 的终端 drain）。
- 远程字节经 shell 通道用 `base64 -w0` 传输后 decode（argv 直传，不经 shell，红线 1/2）。

### 推论 4：大文件轴的正确解是「range 读取」，不是「调大上限」

- PDF 格式的第一性约束：交叉引用表（xref）在文件尾部，打开文件本质上是**随机访问**，
  不是顺序读。这意味着「先把整个文件搬到前端」既不必要也不可能（大文件内存装不下）。
- pdf.js 对此的原生答案是 `PDFDataRangeTransport`：宿主实现 `requestDataRange(begin, end)`，
  pdf.js 只拉取 xref 与可见页所需的对象块。**这是标准接口，不是黑科技**。
- 因此二进制通道的契约必须从一开始就带 **offset/len 语义**（整读 = 不传 offset 的特例），
  小文件（图片）整读、大文件（PDF）分片共用同一入口：
  - Local：`std::fs` seek + read（`spawn_blocking`，红线 3）；
  - WSL/SSH：`dd if=<f> iflag=skip_bytes,count_bytes skip=<off> count=<len>` + base64
    （WSL/SSH 均为 Linux/GNU coreutils，argv 直传经统一 exec 通道，红线 1/2）；
  - 单分片上界（建议 1MB，与 pdf.js `rangeChunkSize` 对齐）：每次 IPC 载荷有界，
    红线 4 的精神（载荷有界）从「整文件 ≤ 上限」修正为「**单次载荷 ≤ 分片上界，
    总量不设硬上限**」——500MB PDF 只在需要时拉需要的块。
- 前端内存有界还需另一半：渲染侧虚拟化（只渲染可视页）——见 §2.3。

## 2. 核心抽象与契约

### 2.1 前端：资源解析唯一入口

```
src/shared/utils/localAsset.ts        （纯函数层，可 100% 单测）
  resolveAssetUrl(src, basePath?): string
    - 通用 scheme 判定 /^[a-z][a-z0-9+.-]*:/i → 直通（http/https/data/blob/asset）
    - 绝对路径 → convertFileSrc；相对路径 → basePath 拼接后 convertFileSrc
    - 无 basePath 且相对路径 → 原样返回（并由调用方显示兜底）
  isRemoteProject(projectId): boolean        （经 projectStore 环境类型）

src/shared/hooks/useAssetUrl.ts        （异步取字节，生命周期管理）
  useAssetUrl(absPath, projectId) → { url, loading, error }
    - Local 项目：同步返回 convertFileSrc 结果
    - WSL/SSH 项目：invoke('read_file_bytes') → ArrayBuffer → URL.createObjectURL
      （useEffect cleanup 时 revoke；缓存策略：组件级即可，不做全局缓存 —— YAGNI）
```

`MarkdownPreview.ImageBlock`、`ImageFileView` 全部改为该入口的消费者；
agent-chat / 会话 / PR 的 markdown 渲染统一接管 `img`（抽 `src/ui/MarkdownImage.tsx`）。

### 2.2 后端：统一二进制读取通道（扩展 `common/file/reader.rs`）

```rust
// 与现有 read_file 同构：同 scope、同 ExecTarget 分派、同 join_path 拼接规则
pub struct FileBytesRequest { pub target: ExecTarget, pub base: String, pub path: String,
                              pub offset: Option<u64>, pub len: Option<u64>,  // range 语义（推论 4）
                              pub max_chunk: u64 }                            // 单分片上界（1MB）
pub async fn read_file_bytes(scope: FileAccessScope, req: FileBytesRequest)
    -> Result<Vec<u8>, AppError>     // offset=None = 整读（小文件/图片）；超 max_chunk 报错
pub async fn read_file_size(scope: FileAccessScope, req: /* 同上前三字段 */)
    -> Result<u64, AppError>         // stat 通道，PDF 打开时先探长度
```

- Local：seek + read 包 `spawn_blocking`（红线 3）；
- WSL/SSH：`collect(target, "dd", &["if=…", "iflag=skip_bytes,count_bytes", "skip=…", "count=…"])`
  → base64 decode（整读时直接 `base64 -w0 <file>`）；
- scope：`canonicalize` + `InProject` 校验复用 `apply_scope`（红线 8）；
- 命令层（`file/commands.rs`）薄封装：参数校验 + 调度 + `Ok(tauri::ipc::Response::new(bytes))`（红线 4/6）。

> 为什么扩展 reader.rs 而不是新开模块：三个历史读取入口已在此统一，
> 「读字节」与「读文本」只有序列化形态差异，新开模块会制造第二套 scope/拼接/环境分派逻辑（DRY）。

### 2.3 PDF 预览组件

```
src/features/editor/components/PdfFileView.tsx
  数据源：PdfDataTransport（implements pdf.js PDFDataRangeTransport）
    - length ← read_file_size；requestDataRange(begin, end) ← read_file_bytes(offset, len)
      → onDataRange 回填，pdf.js 只拉 xref + 可见页所需块（getDocument({ range: transport,
      rangeChunkSize: 1MB, disableAutoFetch: true })）
  渲染：动态 import('pdfjs-dist')（照 MarkdownPreview.MermaidBlock 的懒加载模式）→ canvas
  两种浏览模式（可切换，默认连续滚动）：
    - 连续滚动：页高累加的滚动容器，虚拟化只渲染可视页（复用 @tanstack/react-virtual，
      已是现有依赖；离屏页销毁 canvas，内存有界）
    - 单页翻页：上/下一页、页码输入、←/→ 键盘翻页
  缩放（适应宽度 / 百分比）、加载/错误态
分发：fileEditorFallbackKind 增加 'pdf' 分支（isPdfFile 判定 .pdf 扩展名）
```

> 连续滚动与单页共用同一 pdf.js 文档实例与 transport，只是可视页窗口不同 ——
> 切换模式不重新拉字节。

## 3. 数据流（按场景）

| 场景 | 通道 | 载体 | 渲染器 |
| --- | --- | --- | --- |
| md 图片 · Local | asset 协议（convertFileSrc） | `asset:` URL | `<img>` |
| md 图片 · WSL/SSH | `read_file_bytes` 整读 | `blob:` URL | `<img>` |
| md 图片 · http(s)/data | 原样直通 | 原 URL | `<img>` |
| 图片文件 · Local | asset 协议 | `asset:` URL | `<img>`（现有 ImageFileView） |
| 图片文件 · WSL/SSH | `read_file_bytes` 整读 | `blob:` URL | `<img>`（解除 useBinaryImagePreview 的 Local 限制） |
| PDF · Local/WSL/SSH | `read_file_size` + `read_file_bytes` **range 分片** | `PDFDataRangeTransport` | pdf.js → canvas（虚拟化可视页） |

## 4. 落点清单（文件级）

**后端（src-tauri）**
- `src-tauri/src/common/file/reader.rs`：+ `FileBytesRequest`（offset/len）/ `read_file_bytes` / `read_file_size` + 单测（tempdir 夹具）
- `src-tauri/src/file/commands.rs`：+ `read_file_bytes` / `read_file_size` 命令（薄层）+ 注册进 `lib.rs`

**前端（src）**
- `src/features/file/api/fileApi.ts`：+ `readFileBytes(workspace, path, offset?, len?)` / `readFileSize(workspace, path)`（`invoke<ArrayBuffer>`；护栏 `check_file_io_scope` 要求原始 invoke 只在 fileApi.ts）
- `src/shared/utils/localAsset.ts`：新建（纯函数 + 单测）
- `src/shared/hooks/useAssetUrl.ts`：新建（远程 blob 生命周期管理）
- `src/ui/MarkdownImage.tsx`：从 `MarkdownPreview.tsx` 抽出 `ImageBlock`，改用统一入口
- `src/ui/MarkdownPreview.tsx`：`resolveImageSrc` 替换为 `resolveAssetUrl`（修 data URI bug）
- `src/features/agent-chat/components/MessageContent.tsx`：接管 `img`（接 MarkdownImage）
- `src/features/conversation/components/MessageBlocks.tsx`、`src/features/git/components/pr-detail/PRDescription.tsx`：补传 basePath
- `src/features/editor/components/PdfFileView.tsx`：新建
- `src/features/editor/components/pdf/PdfDataTransport.tsx`（或 `utils/pdfDataTransport.ts`）：pdf.js `PDFDataRangeTransport` 适配（range → readFileBytes）
- `src/features/editor/components/FileEditorFallback.tsx`：+ `'pdf'` 分支
- `src/features/editor/hooks/useBinaryImagePreview.ts`：解除 `Local` 限制（远程走 blob）
- `src/shared/utils/fileTree.ts`：+ `isPdfFile`
- `package.json`：+ `pdfjs-dist`（唯一新依赖）

## 5. 决策记录（为什么不用 X）

| 备选 | 否决理由 |
| --- | --- |
| `<iframe src=asset://...pdf>` 内嵌查看器 | 引擎异构：WebKitGTK 无内嵌 PDF；WKWebView/WebView2 不可控。违反推论 1 |
| PDF 转 base64 塞进 JSON | 违反红线 4；33% 膨胀；序列化成本 O(n) |
| 引入 `@tauri-apps/plugin-fs` 直读文件 | 绕过统一 exec 通道（红线 1 精神）；远程不可达；制造第二套读取路径 |
| 每个渲染点各自修图片 bug | 根因是抽象缺位；断点会复制到 PDF/未来预览类型上（本设计的出发点） |
| 全局 blob 缓存（跨组件复用远程图片） | YAGNI；先以组件级生命周期解决，出现真实性能问题再立项 |
| pdf 完整查看器（缩略图/搜索/文本层） | 超出 MVP；MVP 只做翻页 + 缩放，留扩展点 |
| 「50MB 上限 + 超限拒载」代替 range 加载 | 上限只是把大文件问题变成「不能用」；PDF xref 本质随机访问（推论 4），range 分片才是根治 |
| Local PDF 用 asset URL + HTTP Range 优化 | asset 协议对 Range 的支持三引擎不一致；统一走 IPC range 通道一种实现（Local/远程同构），先正确后优化 |
| 连续滚动一次性渲染全部页 | 大 PDF 下内存无界；虚拟化可视页（react-virtual）是推论 4 的必要另一半 |

## 6. 兼容性、风险与回滚

- **兼容**：`MarkdownPreview` 对外 props 不变（`basePath` 语义不变）；`FileEditorFallbackKind`
  是新增枚举分支，不改既有分支语义；`read_file_bytes` 是新增命令，不改任何既有命令契约。
- **风险 1 · pdfjs-dist 体积**（~1MB gzip）：动态 import 隔离，不进首屏；worker 资源需在
  `pnpm tauri build` 后验证路径（vite `?url` 引入）。→ 实施 P3 时以构建产物验证兜底。
- **风险 2 · 远程 range 传输效率**：每分片一次 exec 往返（base64 +33%）；以 1MB `rangeChunkSize`
  对齐 pdf.js，可见页通常只拉少数分片；滚动快进时预取交由 pdf.js 调度。若实测慢，
  后续可加大分片或并行预取 —— 契约（offset/len）不变。
- **风险 3 · `dd iflag=skip_bytes,count_bytes` 依赖 GNU coreutils**：WSL/SSH 目标均为 Linux，
  满足；实现时以 `dd --version` 探测兜底（或退化 `tail -c +N | head -c M` 脚本形态）不入 MVP。
- **风险 3 · Windows asset URL 形态差异**（`http://asset.localhost/...`）：`<img>` 标签加载
  无 CORS 问题（既有 ImageFileView 已验证）；pdf.js 不消费 asset URL（走 IPC），规避差异。
- **回滚**：三阶段（P1 修复 / P2 通道 / P3 PDF）彼此独立可回滚 —— 各阶段独立提交，
  P3 依赖 P2 但 P1 不依赖任何新后端代码；单阶段回滚只需 revert 对应提交。
