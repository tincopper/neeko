# 业界实现调研（VS Code / Zed / IDEA）

> 置信度声明：LSP 协议机制（additionalTextEdits / publishDiagnostics / applyEdit /
> codeAction）为 LSP 规范定义的稳定面——**确定**。各编辑器行为细节为中高置信（本调研
> 基于 2026-09 之前的公开资料与实现知识；撰写当日 web 检索被反爬拦截，未能逐条在线复核，
> 实现期如遇与本文冲突的实测现象，以实测为准并回填本文）。

## 1. 共同本质（第一性原理收敛）

三家没有一家把「自动导入」实现为独立特性。它都是两条通用管道的自然产物：

```
管道 A（主动补全）：用户输入 → 补全请求 → LS 返回补全项 { 主编辑, 附加编辑(import) }
                     → 接受时【原子】应用全部编辑
管道 B（被动提示）：LS 诊断推送 → 编辑器可视化（squiggle + 问题列表）
                     → 诊断驱动的修正入口（quickfix → applyEdit）
```

**编辑器不拥有任何语言知识**。标识符→包路径的绑定、错误判定、修正方案，全部由语言
服务器计算。编辑器的职责边界 = 传输完备性 + 原子应用 + 呈现 + 交互策略。

## 2. VS Code（LSP 路线，与 Neeko 架构同构）

| 能力 | 机制 |
|---|---|
| 自动导入 | 补全项 `additionalTextEdits`。tsserver（TS/JS）与 gopls（Go）都把「插入 import」作为补全项附加编辑返回；接受补全时客户端原子应用。无任何专用代码路径 |
| 触发 | `editor.suggest` 管道：输入触发 + 手动 Ctrl+Space；`.` 等 trigger characters 由 server 在 initialize 时声明 |
| 错误/警告 | `publishDiagnostics` 推送 → squiggle（severity 着色）+ Problems 面板（聚合 + 快速导航） |
| 手动修正 | 诊断驱动的 quickfix：`textDocument/codeAction`（lightbulb）→ server 返回 WorkspaceEdit → `workspace/applyEdit` 或客户端直接应用 |
| 教训 | 三通道（补全接受 / 诊断推送 / codeAction）互相独立、互为冗余。缺任何一条，用户就少一条到达路径——但主通道（A）覆盖 90% 场景 |

## 3. Zed（LSP 路线，手写 client，最接近 Neeko 的目标形态）

- 自研 Rust LSP client：补全接受内建应用 `additionalTextEdits`；诊断推送内建渲染到
  Project Diagnostics 缓冲区；`workspace/applyEdit` server→client 请求内建处理。
- 交互差异：Zed 对 unimported 符号同样走补全建议（gopls 的 unimported completions）。
- **对本项目的参照价值最高**：Zed 证明「完备的传输 + 少量呈现策略」即可达到一线 IDE
  的自动导入体验，无需理解任何语言。

## 4. IDEA / JetBrains（非 LSP 路线，参考价值在 UX 策略）

- 自家 PSI 索引引擎 + 补全管道内建 auto-import，不走 LSP。
- **导入策略三态**：`Ask（弹选择框）/ Auto（自动加）/ Never`——用户可控（对 Go/Java
  的多候选 import 场景，Ask 防误加）。
- Alt+Enter quickfix 走自家 inspection 体系。
- **借鉴点**：仅 UX 策略层（三态设置）。引擎形态不可移植，也正因如此反衬 LSP 路线的
  架构优势——Neeko 接 17 个 LS 不用写 17 份导入逻辑。

## 5. gopls 特性确认（Go 场景直接相关）

- gopls 默认提供 **unimported completions**：输入 `Println`（未导入 fmt）时补全列表
  出现 `fmt.Println` 项，携带 additionalTextEdits 插入 `import "fmt"`。
- `fmt.` 成员补全（fmt 已可解析）走常规补全；import 缺失时同样携带附加编辑。
- 诊断推送：`imported and not used` / `undefined: X` 等，保存与输入时推送。
- 配置面：`gopls` 的 analyses/completion 设置多数有合理默认——**M0 实测时用默认配置**，
  禁止预先加配置项（YAGNI，先证伪再调参）。

## 6. 对 Neeko 设计的直接推论

1. 主通道（管道 A）的实现主体 = 补全接受时应用 additionalTextEdits——**lsp-client 包
   已实现**（见 lsp-capability-matrix.md），不需要新写。
2. 需要新建的只有：诊断聚合呈现（Problems）、server→client 请求转发（applyEdit）、
   会话健康度信号。
3. 语言无关性是验收项：任何遵循 LSP 的 LS 接入后，三通道能力自动成立。
