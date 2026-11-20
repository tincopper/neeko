# P0 准入矩阵（实测产物）

日期：2026-10-30 · 主机：macOS (arm64) · 方法：只读探测（**未修改任何 CLI 配置**）
证据等级：**A** = 本机 CLI `--help` / 磁盘配置实测 · **B** = 配置已装但未跑一轮验证上报

---

## 1. 环境清单

| CLI | 版本 | 安装路径 |
| --- | --- | --- |
| claude | 2.1.308 | `/opt/homebrew/bin/claude` |
| codex | 0.163.0 | `/opt/homebrew/bin/codex` |
| opencode | 2.1.4 | `~/.opencode/bin/opencode` |
| pi | 1.4.0 | fnm node bin |
| omp | 18.12.4 | `/opt/homebrew/bin/omp` |
| grok | 1.0.52 | `~/.grok/bin/grok` |
| codebuddy | 2.164.0 | fnm node bin |
| qoder | 1.1.79 | `~/.qoder/entry/qoder` |
| dsh | (hook-only) | fnm node bin |
| gemini | **未安装** | — |

---

## 2. 矩阵

| CLI | ① 完成信号 | ② MCP 配置面 | ③ MCP 传输 | ④ 审批旁路开关 | **档** |
| --- | --- | --- | --- | --- | --- |
| **claude** | ✅ `Stop`（neeko 已装，B） | **`--mcp-config <file\|string>`**（spawn 期注入）或 `~/.claude.json → projects[path].mcpServers` | **HTTP**（`-H header`）+ **stdio** | `--dangerously-skip-permissions` | **A** |
| **codex** | ✅ `Stop` + `notify agent-turn-complete`（已装，B） | `codex mcp add`→ `config.toml [mcp_servers]`；`-c key=value` 覆盖 | **streamable HTTP** + `--bearer-token-env-var` + stdio | `--approve-for-me`；完整旁路待复核 | **A** |
| **qoder** | ✅ `Stop` / `PermissionRequest` / `StopFailure`（已装，B） | **`--mcp-config`** + `--strict-mcp-config` + `--allowed-mcp-server-names` | 由 `--mcp-config` 的 JSON 决定 | `--dangerously-skip-permissions` / `--permission-mode bypass_permissions` | **A** |
| **codebuddy** | ✅ `Stop` / `PermissionRequest` / `StopFailure`（已装，B） | **`--mcp-config <fileOrString>`** | 由 JSON 决定（待验） | `-y, --dangerously-skip-permissions` / `--permission-mode bypassPermissions` | **A** |
| **pi** | ✅ `agent_end`（extension 已装，B） | `pi mcp add --url` → `~/.pi/agent/mcp.json` + 项目 `.pi/mcp.json` | **URL** + stdio | `--approve, -a`（信任项目文件；非全跳过，待验） | **A** |
| **opencode** | ⚠️ plugin v2 模板存在，但配置 `plugin: []` ⇒ **未安装** | `opencode mcp add --url/--header`（project 或 `--global`） | **HTTP + header** + stdio | `--auto` | **A（装插件后）** |
| **omp** | ✅ `agent_end`（extension 已装，B） | **无 MCP 表面**：无 `mcp` 子命令，`config.yml` 无 mcp 键 | — | `--auto-approve` / `--approval-mode yolo` | **B** |
| **grok** | ❌ Neeko 无 hook 目标 | `grok mcp add --transport http\|stdio\|sse` + `-H` | **http / sse / stdio** | `--always-approve` | **C**，但 `channel=Mcp` |
| **dsh** | 自带上报（hook-only） | 无 `AgentConfig`，无法 spawn | — | — | 不可选中 |
| **gemini** | 未安装 | — | — | — | 未测 |

---

## 3. 四个改变设计的发现

### 3.1 ⚠️ Neeko 现在的 `DeploySpec.mcp_config` 对 claude 是错的

实测 `~/.claude/settings.json` 的顶层键 = `env / hooks / model / modelPicker / statusLine / theme`
—— **没有 `mcpServers`**。而 MCP 实际在 `~/.claude.json` 的 `projects[<path>].mcpServers`（本机 3 个项目全有）。

⇒ `resource_deployer.deploy_mcp` 把 MCP 配置写进 `~/.claude/settings.json` 这条路，**对 claude 从来没生效过**。
（对 codebuddy / qoder 是否同样错位，需按各自 schema 复核。）

**这一条要单独立 issue**：它不只影响团队功能，也影响现有 MCP 市场（`features/library` 的"安装 MCP"）。

### 3.2 ✅ 首选 `--mcp-config` 传参，而不是写配置文件

`claude` / `codebuddy` / `qoder` 三家都支持 **spawn 期用命令行参数注入 MCP 配置**（file 或 string）。

这比写配置文件严格更好：

| | 写配置文件 | `--mcp-config` 传参 |
| --- | --- | --- |
| 需要知道各家路径/格式 | ✅ 需要（且 claude 已经写错） | ❌ 不需要 |
| 凭据副本数 | N 份落盘 | N 份，但只存在于进程 argv |
| 每成员独立 token | 要争抢同一文件 | **天然成立** |
| 清理 | 要还原用户配置 | **零清理** |
| 并存（多团队） | 互相覆盖 | 互不影响 |

⇒ **设计改为**：优先探测该 agent 是否支持启动参数注入；支持则走参数，不支持才落配置文件。
`AgentConfig` 需要新增一个描述字段（如 `mcp_injection: Argv | ConfigFile | None`）。

### 3.3 ✅ HTTP 传输覆盖广，stdio bridge 可能只需给少数

- `claude`：`--transport http` + `-H header` ✅
- `codex`：`--url` = streamable HTTP + **`--bearer-token-env-var`**（直接从环境变量读 token —— 与"spawn 时注入 env"完美契合）✅
- `opencode`：`--url` + `--header key=value` ✅
- `pi`：`--url` ✅
- `grok`：`--transport http|sse` + `-H` ✅

⇒ Neeko 的 axum 服务端可以直接当 MCP endpoint。**stdlib bridge 降级为"仅当某 CLI 既不支持 HTTP 也不支持 `--mcp-config`"时的兜底**，不再是主路径。

### 3.4 ✅ channel 与 result_channel 必须分离 —— grok 就是反例

`grok` 有完整 MCP（能收消息、能被 `team_wait` 观测？不能 —— 无 hook），但 Neeko **没有** grok 的 hook 目标。

所以 grok 的真实形态是：**`channel = Mcp`（能收） + `result_channel = Sentinel`（只能靠打印报）**。

这正是 design §2 把两个维度分开的理由。如果合并成一个 `WorkerChannel`，grok 会被迫降级到 `None`，白白丢掉它可用的 MCP 面。

---

## 4. 顺带确认的两件事

### 4.1 `TeammateIdle` hook 确实存在

`~/.claude/settings.json` 里有 `TeammateIdle` 事件键（Claude Code 2.1.308）——证实
「hook 可以否决 agent 进入空闲」在技术上可行。

我们仍选择**不用**（决策 3：保持 `neeko-report.mjs` 永远 exit 0）。现在这条决策有了实物依据，
不是猜"它可能支持"。

### 4.2 opencode 的 Neeko 插件当前未安装

`~/.config/opencode/{opencode,config}.json` 的 `plugin` 均为 `[]`。
⇒ opencode 现处于"可接入但未接"状态。P0 记为已知缺口，不阻塞设计。

---

## 5. 仍需实测（B → A）的项

① 列的 claude / codex / qoder / codebuddy / pi / omp 目前是**配置已装**，不是**跑一轮确认上报**。
要做 A 级证据，需在 `team_spawn` 实现后跑一次真实成员会话，抓 `/hook/{source}` 的 payload。

② 列里 codex 的完整旁路开关、pi 的 `--approve` 语义、codebuddy/qoder 的 `--mcp-config` JSON 形状，
需要各跑一次最小样例。

这些都可以在 P1/P2 实现过程中顺手补齐，**不阻塞 P1 开工**。

---

## 6. 对文档的影响（已同步）

- `prd.md` R0 表格 → 用实测结果替换"待实测"
- `prd.md` R0.2 增补：**MCP 注入优先走启动参数**（`mcp_injection: Argv | ConfigFile | None`）
- `design.md` §5.5 → stdio bridge 降级为兜底，HTTP 为主
- `design.md` §2 → `TeamMember.channel` / `result_channel` 的分离有了 grok 这个反例，保留
- 新增独立 issue：`DeploySpec.mcp_config` 对 claude 指向错误文件（影响现有 MCP 市场）
