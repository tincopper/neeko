# Agent Hooks 域（外部 Agent CLI 状态上报）

> `src-tauri/src/agent/hooks/` 与嵌入模板（`templates/neeko-pi-status.ts` /
> `templates/neeko-opencode-status-v2.js`）、`platform/private_file/` 的坐标发布契约。
> 任务源：`10-12-agent-notify`（Phase B 建立，Phase F 多实例修订）；
> `InstallShape` 三种形态与多面模型来自 `10-16-notify-claude-compat` / `10-16-notify-codex`
> （两者均已归档，实测证据摘要已内联到下文各节 —— 不必回查任务目录）。
>
> 与[质量指南](./quality-guidelines.md)的红线互补：本文件只记录本域**特有**的跨层契约
> （Rust 写坐标 ↔ TS 模板读坐标 ↔ 用户终端里的 CLI 进程），通用规则不在此重复。

---

## 场景：多实例坐标共存（endpoint 目录 + 上报端 fan-out）

### 1. Scope / Trigger

- **Trigger**：用户**必须**同时运行打包版 Neeko 与 `pnpm tauri dev`（调试需要）。旧的全局单文件
  坐标 `~/.neeko/agent-hooks/endpoint.env` 在结构上无法同时表示 N 个活实例：后启动者覆写它，
  先退出者留下**死坐标**（端口无监听）；CLI 侧上报前重读该文件 → 全部打到死端口 → fail-open
  静默吞掉 → 症状「刚启动能通知、运行着就不通知」。代码无 single-instance 约束，而工作流要求
  多开 ⇒ 单实例假设被证伪。
- **Scope**：`agent/hooks/endpoint.rs`（发布）、`agent/hooks/server.rs`（spawn + 迁移）、
  `agent/hooks/templates/*`（读取 + fan-out）、`platform/private_file/{unix,default}.rs`（私有目录/文件）、
  `agent/hooks/writers.rs`（模板锚点测试）。

### 2. Signatures

```rust
// endpoint.rs —— 每实例一个坐标文件
pub const ENV_KEY_PORT: &str = "NEEKO_AGENT_HOOK_PORT";
pub const ENV_KEY_TOKEN: &str = "NEEKO_AGENT_HOOK_TOKEN";
pub const ENV_KEY_OVERRIDE: &str = "NEEKO_AGENT_HOOK_ENDPOINT"; // 单文件覆盖（调试/夹具）
pub const ENDPOINTS_DIR_NAME: &str = "endpoints";

pub struct EndpointPublication { pub instance_id: String, pub path: PathBuf, pub port: u16, pub token: String }
impl EndpointPublication {
    pub fn endpoints_dir(neeko_dir: &Path) -> PathBuf;      // {neeko_dir}/agent-hooks/endpoints
    pub fn legacy_endpoint_file(neeko_dir: &Path) -> PathBuf; // 旧单文件路径（仅用于清理）
    pub fn new(neeko_dir: &Path, instance_id: String, port: u16, token: String) -> Self;
    pub fn render(&self) -> String;
    pub fn publish(&self) -> std::io::Result<()>;           // 目录 0700 + 文件 0600 原子写
}
pub fn remove_legacy_endpoint(neeko_dir: &Path) -> std::io::Result<()>; // 幂等一次性迁移

// platform/private_file
pub fn create_private_dir(path: &Path) -> std::io::Result<()>; // unix 0700 / windows no-op
pub fn write_private_atomic(path: &Path, content: &str) -> std::io::Result<()>; // unix 0600 原子替换
```

模板侧（TS/JS，双端同契约）：

```ts
const ENDPOINTS_DIR = process.env.NEEKO_AGENT_HOOK_ENDPOINTS_DIR
  || join(homedir(), ".neeko", "agent-hooks", "endpoints");
// coords() → 扫 endpoints/*.env，返回坐标数组（目录 mtime 缓存；单文件覆盖走 f: 前缀键）
// post()   → Promise.allSettled 对每个坐标各 POST 一次，逐个 fail-open（800ms 超时）
```

### 3. Contracts

- **坐标根目录** `~/.neeko/agent-hooks/endpoints/`（POSIX **0700**），每实例一个文件
  `endpoints/<instance_id>.env`（POSIX **0600**，原子替换）。`instance_id` = 进程启动随机 uuid，
  仅内存持有、仅作文件名。
- **文件格式不变**（`KEY=value` 行 + 尾换行）：
  ```
  NEEKO_AGENT_HOOK_PORT=53124
  NEEKO_AGENT_HOOK_TOKEN=<uuid-v4>
  ```
- **旧单文件 `agent-hooks/endpoint.env` 在启动时删除一次**（`remove_legacy_endpoint`，幂等）——
  避免上报端同时读到新旧两种形态。上报端**只**支持目录形态。
- **退出不删除本实例坐标文件**：删除会制造「重启窗口期回调失败」；死坐标由上报端 fail-open 跳过。
- **上报端 fan-out**：读全部 `*.env` → 逐坐标 POST；单坐标失败（连接拒绝/超时/403）不影响其余
  坐标，也不影响 CLI（`Promise.allSettled` + 每项 `try/catch`）。缓存键 = **目录 mtime**
  （增删/替换文件都会改目录 mtime），不是单文件 inode。
- **单文件覆盖保留**：`NEEKO_AGENT_HOOK_ENDPOINT` 指向单个文件时只读它、不扫目录（调试/测试夹具）。
- **目录权限是威胁模型的一半**：文件 0600 只挡内容；目录若可列（0755），攻击者可枚举实例文件名。
  故目录 0700，经 `platform::private_file` 统一落位（业务码零 `#[cfg]`，红线 10）。

### 4. Validation & Error Matrix

| 场景 | 预期 |
|------|------|
| 两实例先后 publish | 各自 `endpoints/<id>.env` 并存，互不覆写（R6.8 核心不变量） |
| 同实例重复 publish | 覆盖自身文件，无 `.tmp-` 残留 |
| 旧单文件存在 | 启动删除；不存在也成功（幂等）；不触碰 `endpoints/` 新坐标 |
| 坐标目录不存在 | 上报端 `coords()` 返回空数组，零 fetch、不抛错（Neeko 未运行） |
| 某坐标端口已死 | 该坐标 `fetch` 失败被吞掉，其余坐标照常投递 |
| 目录 mtime 未变（内容被替换） | 走 `write_private_atomic` 的 rename → 目录 mtime 变化 → 缓存失效 |

### 5. Good/Base/Bad Cases

- **Good**：打包版 + dev 同开 → pi 触发一次完成/审批 → **两个实例都收到通知**（AC18）；
  关闭 dev 后，打包版继续收到（dev 的死坐标被跳过）。
- **Base**：只开一个实例 → 目录里一个坐标文件，行为与旧单文件等价。
- **Bad**：重新引入全局单文件坐标（`endpoint.env` 作会合点）；上报端只读一个文件；
  目录用默认权限创建（0755）；退出时删除自己的坐标文件。

### 6. Tests Required

- `endpoint.rs`（tempdir 夹具，红线 13）：
  - `two_publications_coexist_without_overwrite`：两实例文件并存、内容互不覆盖（承重用例）。
  - `publish_overwrites_own_file_atomically`：同实例幂等、无 tmp 残留。
  - `remove_legacy_endpoint_is_idempotent_and_keeps_new_coords`：旧文件删、新坐标留、二次调用成功。
  - `publish_sets_owner_only_permissions_on_unix` / `endpoints_dir_is_owner_only_on_unix`：0600 / 0700。
- `writers.rs::embedded_templates_keep_contract_anchors`：模板必须含坐标目录扫描锚点
  （`endpoint::ENDPOINTS_DIR_NAME` + `readdirSync` + `Promise.allSettled`）与单文件覆盖的
  **读取形态**（`"NEEKO_AGENT_HOOK_ENDPOINT ||"`）。**锚点必须承重** —— 裸键名是 plural 目录键
  （`NEEKO_AGENT_HOOK_ENDPOINTS_DIR`）的子串，会被替身通过。
- 真实模板 Node harness（人工/脚本）：两坐标文件 → 两个 POST（死坐标 ECONNREFUSED 静默）；
  目录缺失 → 零 fetch 不抛错；单文件覆盖 → 恰好一个 POST。

### 7. Wrong vs Correct

#### Wrong

```rust
// 全局唯一会合点：多实例互相覆写，退出留死坐标
let path = neeko_dir.join("agent-hooks").join("endpoint.env");
write_private_atomic(&path, &render)?;   // 后启动者覆盖先启动者
```

```ts
// 上报端只读一个文件：读到死坐标 → 全部丢失
const text = readFileSync(ENDPOINT_FILE, "utf8");
await fetch(`http://127.0.0.1:${port}/hook/pi`, { ... });
```

#### Correct

```rust
// 每实例一个文件，退出不删；旧单文件启动时清理一次
let publication = EndpointPublication::new(&neeko_dir, uuid::Uuid::new_v4().to_string(), port, token);
publication.publish()?;                   // {neeko_dir}/agent-hooks/endpoints/<id>.env
```

```ts
// 扫全部坐标，逐个 fail-open
await Promise.allSettled(coords().map(async (c) => {
  try { await fetch(`http://127.0.0.1:${c.port}/hook/pi`, { signal: AbortSignal.timeout(800), ... }); }
  catch { /* fail-open */ }
}));
```

---

## 场景：受管 hook 文件的标记键必须内容寻址（D13）

### 1. Scope / Trigger

- **Trigger**：受管 hook 文件（`~/.pi/agent/extensions/neeko-status.ts` 等）首行带归属标记
  `// @neeko-managed-hook v{...}`；启动收敛 `reconcile_action` 只比这个标记判「是否过期」。
  早期标记键 = `v{CARGO_PKG_VERSION}`（**发布版本**）—— 把「发布版本」与「已装文件是否过期」
  两个生命周期不同的东西绑在一起：只改模板必须手碰发布版本（→ 三处版本漂移），忘了碰
  则已装机器**静默不更新**。
- **Scope**：`agent/hooks/writers.rs`（`content_token` / `render` / `ownership_of`）。

### 2. Signatures

```rust
fn content_token(template: &str) -> String; // "v{应用版本}+{fnv1a_u64:016x}"
fn fnv1a(bytes: &[u8]) -> u64;              // 跨 Rust 版本稳定的内容哈希
fn ownership_of(path: &Path, expected_token: &str) -> Ownership; // 三条路径同口径
```

### 3. Contracts

- 标记键**从被缓存的内容本身派生**（内容寻址）：`v{CARGO_PKG_VERSION}+{hash(模板正文)}`。
  hash 算法必须**跨 Rust 版本/平台稳定**——**禁用 `std::hash::DefaultHasher`**（输出不稳定，
  会让同一模板在不同构建下算出不同键，每次升级误判过期）；用自实现 FNV-1a（无新依赖）。
- 应用版本仍保留在标记里，供人眼辨识；机器比较的是整串。
- 旧标记（无 `+hash`，如 `v1.0.9`）与当前期望键不匹配 → 首启自动重装一次（迁移方向安全）。
- 代价与取舍：内容寻址会覆盖用户对受管文件的手改 —— 但受管文件首行本就写「请勿原地编辑」，
  语义上更正确。

### 4. Validation & Error Matrix

| 场景 | 预期 |
|------|------|
| 同一模板两次 `render()` | 标记键恒等（无随机/时间成分） |
| 模板改一个字节（版本号不变） | 键变 → `version_current=false` → `reconcile_action(want=true)` = `Install` |
| 已装旧纯版本标记（`v1.0.9`） | 不匹配 → 自动重装（迁移） |
| 内容与期望完全一致 | `install_at` = `Unchanged`（幂等，无 mtime 抖动） |
| 无归属标记 / 非 UTF-8 | `Foreign` —— 绝不覆盖 |
| 模板改动（含版本不变） | **不再需要**改 `Cargo.toml` 版本；三处版本保持同步 |

### 5. Good/Base/Bad Cases

- **Good**：改模板正文 → 下次 Neeko 启动自动重装，`Cargo.toml` 不动。
- **Base**：模板未变 → 键一致 → `Unchanged`，不重写。
- **Bad**：标记键用发布版本（漏碰版本 = 静默不更新）；用 `DefaultHasher`（跨版本不稳定）；
  `ownership_of` 不带 `expected_token`（无法算出内容键，退回比版本）。

### 6. Tests Required

- `writers.rs`：`content_token_is_stable_and_content_addressed`（同内容稳定 / 内容变则变 /
  带版本前缀）、`template_body_change_marks_install_stale_without_version_bump`（**反证钉子**：
  把 `content_token` 退回 `v{CARGO_PKG_VERSION}` 本用例必红）、`legacy_version_marker_triggers_reinstall`
  （旧纯版本标记判过期）、`fnv1a(b"") == 0xcbf2_9ce4_8422_2325`（钉死算法向量）、
  `install_is_idempotent` / `foreign_file_is_never_touched`（既有不变量不回归）。

### 7. Wrong vs Correct

#### Wrong

```rust
// 发布版本当内容缓存键：改模板必须手碰版本，否则静默不更新
fn version_token() -> String { format!("v{}", env!("CARGO_PKG_VERSION")) }
```

#### Correct

```rust
// 内容寻址：模板字节变 → 键变 → 自动重装；版本号不动
fn content_token(template: &str) -> String {
    format!("v{}+{:016x}", env!("CARGO_PKG_VERSION"), fnv1a(template.as_bytes()))
}
```

---

## 已知遗留（登记未实施）

- **坐标文件无界累积**：文件退出不删、`instance_id` 每次随机 ⇒ `endpoints/` 随每次启动单调增长，
  上报端 fan-out 数无上限。短期无感（每文件约 60B、死坐标即时失败），长期会让每次上报并发
  fetch 数无界增长，极端触发 CLI 侧 EMFILE（与「绝不阻塞 CLI」相抵）。
  **推荐修法**：坐标文件增写 `NEEKO_AGENT_HOOK_PID` + host，启动时按「同 host 且 pid 已死」剪除
  （pid 存活判定只会误留死文件、不会误删活实例，方向安全）；可选 fan-out 上限兜底。

---

## 场景：受管 CLI 的两种接入形态（`InstallShape`）

> 任务源：`10-16-notify-claude-compat`（2026-10-16）。此前本域只覆盖「独立文件即插拔」一种形态。

### 1. Scope / Trigger

- **Trigger**：要接入的 CLI 把 hook 面放在**用户既有配置文件**里（`~/.claude/settings.json` 的
  `hooks` 键），而不是「一个独立文件就是全部」。此时「只写自己的文件」这条客人义务不够用了。
- **Scope**：`agent/hooks/targets.rs`（形态数据）、`agent/hooks/merger.rs`（JSON 纯函数）、
  `agent/hooks/writers.rs`（按形态分派）、`agent/hooks/templates.rs`（模板门面）、
  `platform/hook_command/`（命令渲染）、`agent/hooks/settings.rs`（逐 CLI 开关）。

### 2. Signatures

```rust
// targets.rs —— 接入形态是**数据**，不是通用模块里的 CLI 分支
pub enum InstallShape {
    /// 独立文件即插拔：只写一个受管文件，绝不碰用户既有配置（opencode / pi / omp）。
    Standalone,
    /// 独立 shim 文件 + 结构化插入点：shim 仍是独立文件，
    /// 但需把 hook 条目插入用户既有的 `settings_file`（claude / codebuddy / qoder / codex）。
    Structured { settings_file: &'static str, entries: &'static [HookEntry] },
}

/// 一条结构化插入点：CLI 原生事件名 → 语义 event_key 的纯数据映射。
pub struct HookEntry {
    pub native_event: &'static str,
    /// `None` = **不写该字段**（不是写空串 —— 语义不同）。
    pub matcher: Option<&'static str>,
    pub event_key: &'static str,
}

// merger.rs —— 纯 JSON 变换，零 IO（IO / 原子写 / 权限在 writers 外层）
pub enum MergeAction { Insert, Remove }
pub enum MergeOutcome { Changed, Unchanged, Removed, Noop }
pub fn apply(config: &mut serde_json::Value, native_event: &str,
             matcher: Option<&str>, command: &str, action: MergeAction) -> MergeOutcome;

// writers.rs —— 按形态分派
pub fn install_selected(enabled: impl Fn(&str) -> bool) -> Vec<HookApplyOutcome>;
pub fn uninstall_selected(enabled: impl Fn(&str) -> bool) -> Vec<HookApplyOutcome>;

// platform/hook_command/ —— shim 启动命令的平台渲染（红线 2/10）
pub fn render_report_command(shim: &Path, source: &str, event_key: &str) -> Option<String>;
pub fn resolve_node() -> Option<String>;
```

### 3. Contracts

**为什么用 `command` hook + shim，而不用 `{"type":"http"}` hook**（`10-16` design T8）：

> **坐标是动态的（`bind :0` 随机端口 × N 个活实例），配置是静态的（写死在用户文件里）。
> 二者不可调和 ⇒ 必须有运行时解析坐标的中间层。**

http hook 的 URL 无法表达多实例（`10-12` R6.8），故一律走 `command` + 稳定路径的 shim。

**shim 契约（Rust ↔ JS 是同一契约的两端，改一端必须同步另一端）**：

```
argv:  <source> <event_key>      ← 语义键由 argv 传入，shim 零 per-CLI 事件名知识
stdin: CLI 的 hook input JSON（Claude Code 规范；Codex 字段名同形）
env:   NEEKO_AGENT_HOOK_ENDPOINT / NEEKO_AGENT_HOOK_ENDPOINTS_DIR（调试/夹具覆盖）
出站:  POST http://127.0.0.1:{port}/hook/{source}   header: x-neeko-agent-hook-token
退出:  永远 0（非零退出会被 CLI 当作阻断/失败，违反「绝不阻塞用户 agent」）
```

**关键不变量：shim 不得认识任何 CLI 原生事件名** —— `(原生名 → event_key)` 的翻译
全部落在 `HookEntry` 数据表。护栏：`report_shim_keeps_contract_anchors_and_knows_no_native_events`。

**结构化合并的四条不变量**（`merger.rs`，各一个单测）：

1. **他人条目逐字保留**（同事件下 orca / clawd / superset 的条目不受影响，含 `http` 型）；
2. **fail-safe**：配置非对象 / `hooks` 非对象 / 事件值非数组 → `Noop` 且原样保留，
   调用方据此**跳过写盘**（不留「shim 已装但条目没进去」的半成品）；
3. **幂等 + 收敛**：同 command 重复插入 → `Unchanged`；多条自家条目 → 收敛到恰好一条；
4. **空数组删键**：移除后 `hooks.<event>` 为空则删该键，不留空壳。

**自家条目识别**：`command` 里的 shim **路径段**（`SHIM_MARKER`，需被 `/` `\` `'` `"` 前置）。
判据是路径段而非裸子串 —— 否则 `node neeko-status.mjs`（相对路径、非 Neeko 生成）会被误判，
导致我们去删改别人的 hook。**不往 CLI schema 里塞私有字段**（会被 CLI 拒载）。

**权限继承**：改写用户既有配置文件必须**保留原权限位**
（`platform::private_file::write_atomic_preserving_mode`）。无条件写 0600 会把用户的 0644
静默降权；无条件写 0644 会把用户的 0600 静默泄漏。

**两个开关的分工**（勿合并）：

| 开关 | 位置 | 语义 |
| --- | --- | --- |
| `cli_hooks` | `NotificationSettings`（通知核心域） | **主开关**：「用户是否同意 Neeko 装 hook」。默认 `false` |
| `agentHookSources` | `config.json`（agent 域） | **逐 CLI 覆盖**：`{"claude": false}`；键缺失 ⇒ 跟随主开关 |

生效判定：`effective(cli) = master && sources.get(cli).unwrap_or(true)`。
**业务身份（CLI 名字）必须归业务域** —— 写进通知核心域会让核心域出现 CLI 分支
（`10-16` 父任务 T4 禁止），且与「核心域零改动」验收冲突。

### 4. Validation & Error Matrix

| 场景 | 预期 |
|------|------|
| 用户配置不存在 | `Skipped`，**不创建** CLI 的配置目录（客人不喧宾） |
| 用户配置非 JSON / `hooks` 非对象 | `Skipped`，**两个文件都不写**（fail-safe） |
| 同名他人文件（`Standalone`） | `Skipped`，绝不覆盖 |
| 解析不到 `node` | `Skipped("cannot resolve node executable")` |
| `source` / `event_key` 含非法字符 | `render_report_command` 返回 `None`（token 白名单，防注入） |
| 只有 shim 无条目 / 只有条目无 shim | `installed == false`（不生效才诚实） |
| 用户配置 0600 | 改写后仍 0600（权限继承） |

### 5. Good/Base/Bad Cases

- **Good**：`HOOK_TARGETS` 加一行 `Structured { settings_file, entries }` 即接入一个新
  Claude 兼容 fork；`entries` 复用 `CLAUDE_COMPAT_ENTRIES`（`&` 取址，指针判据可断言共享）。
- **Base**：`Standalone` 形态完全沿用旧路径（`install_at` 分派后行为零漂移）。
- **Bad**：把 `{"claude": false}` 写进 `NotificationSettings`（核心域出现 CLI 名字）；
  用 `{"type":"http"}` hook（静态 URL 无法表达多实例）；在通用模块写
  `if target.source == "codex"`（违反红线 15，应作为数据/形态声明）。

### 6. Tests Required

- `merger.rs`：四条不变量各一（`insert_preserves_foreign_entries_verbatim` /
  `malformed_config_is_never_destroyed` / `insert_is_idempotent` + `insert_converges_duplicate_own_entries` /
  `remove_prunes_event_key_when_only_ours`）+ `ownership_detection_covers_both_shapes`（路径段判据）。
- `writers.rs`：`structured_install_writes_shim_and_entry_preserving_others` /
  `structured_install_leaves_everything_untouched_on_malformed_config`（**反证钉子**：先写 shim 再 merge 本用例必红）/
  `structured_install_preserves_settings_permissions`（Unix）/ `structured_status_requires_both_shim_and_entry` /
  `structured_uninstall_removes_entry_and_shim` / `report_shim_keeps_contract_anchors_and_knows_no_native_events`。
- `targets.rs`：`claude_compat_sources_share_one_entries_table`（**指针相等**，防复制三份漂移）/
  `claude_compat_entries_never_map_notification`（U4 反证钉子）/
  `omp_variant_omits_ui_prompt_and_keeps_other_legs`（U1 反证钉子）。
- `platform/hook_command/`：`unsafe_tokens_are_rejected` / `quote_handles_spaces_and_single_quotes`。
- `settings.rs`：`master_off_disables_everything` / `per_cli_override_disables_only_that_one` /
  `override_true_does_not_bypass_master` / `malformed_overrides_are_tolerated`。

### 7. Wrong vs Correct

#### Wrong

```rust
// ❌ 把 CLI 身份与形态分支写进通用模块
if target.source == "claude" {
    merge_into_settings_json(...)
} else {
    write_standalone_file(...)
}
```

#### Correct

```rust
// ✅ 形态是数据；writers 只按形态分派，零 CLI 名字
match &target.shape {
    InstallShape::Standalone => install_standalone(target, dir),
    InstallShape::Structured { settings_file, entries } =>
        install_structured(target, dir, settings_file, entries),
}
```

---

## 已知遗留（`10-16-notify-claude-compat` 登记）

- **Claude 系无「等待输入」事件**：`Notification` 事件的 `matcher` 在 Claude Code 规范里
  **不生效**（规范原文：`UserPromptSubmit, Notification, Stop, SubagentStop: matcher is not used`），
  映射它会让所有空闲提示误报为 `input_requested`。故不映射 ——
  「等待用户行动」由 `PermissionRequest` 覆盖。若未来某 CLI 提供可靠的「等待输入」事件，
  加一行 `HookEntry` 即可。
- **OMP 无 `ui_prompt_start`**：OMP 与 pi 同扩展 API 但少此事件（二进制 0 命中
  `withUIPrompt` / `emitUIPromptEvent` / `UIPromptStartEvent`），故 OMP 用 pi 模板的**派生变体**
  （`templates/neeko-omp-status.ts`）。OMP 升级若补上该事件，删变体改引 pi 模板即可。
- ~~**Codex 未接入**~~ → **已由 `10-16-notify-codex` 实施**（双面：`notify` + `hooks.json`）。
  原判据（「Rust 二进制 + 配置跨 JSON/TOML + 有信任门」）成立但结论已过时 ——
  信任门通过只读探针处理，见下方两节。
- **四家 Claude 兼容 CLI 的实机通知未逐个验证**（`10-16-notify-claude-compat` AC6）：
  OMP / Claude / CodeBuddy / Qoder 各家需登录态才能跑真实轮次，自动化不可达。
  e2e 通道本身已由 Codex 侧打通（真 CLI → shim → ingest POST）。

---

## 场景：`InstallShape::NotifyArgv`（Codex 的 `notify` 通道）

> 任务源：`10-16-notify-codex`（2026-10-16）。同一子任务推翻了原「`hooks.json` + 信任哈希」设计，
> 依据与证据已内联到下方 §3/§8（信任哈希不可反推、信任门是执行级硬门、`notify` 绕过信任门）。

### 1. Scope / Trigger

- **Trigger**：要接入的 CLI 有「一条命令 + 一串 argv」形态的**通知钩子**（Codex 的 `notify`），
  而不是「按事件名分组的 hook 对象」。它既不是 `Standalone`（不是独立文件即插拔），
  也不是 `Structured`（不是嵌套对象 + matcher），故需要第三种形态。
- **Scope**：`agent/hooks/targets.rs`（形态数据）、`agent/hooks/toml_merger.rs`（TOML 纯函数）、
  `agent/hooks/writers.rs`（第三分支）、`platform/hook_command`（argv 形态渲染）、
  `agent/hooks/templates/neeko-report.mjs`（双来源载荷）。

### 2. Signatures

```rust
// targets.rs
NotifyArgv { config_file: &'static str, key: &'static str }   // codex: ("config.toml", "notify")

// toml_merger.rs —— 纯字符串变换，零 IO
pub enum TomlMergeAction { Insert, Remove }
pub enum TomlMergeOutcome { Changed, Unchanged, Removed, Noop }
pub fn apply_notify(text: &str, key: &str, entry: &[String], action: TomlMergeAction)
    -> (String, TomlMergeOutcome);
pub fn read_notify(text: &str, key: &str) -> Option<Vec<String>>;
pub fn notify_is_current(text: &str, key: &str, entry: &[String]) -> bool;
pub fn entry_targets_shim(entry: &str) -> bool;   // 路径段判据（与 merger 同源）

// platform/hook_command —— argv 形态（不经 shell）
pub fn report_argv(shim: &Path, source: &str, event_key: &str) -> Option<Vec<String>>;
```

### 3. Contracts

**形态语义**：`notify` 是「**一条命令的 argv**」，不是「命令列表」——
`notify = [exe, arg1, ...]`，CLI 执行 `exe arg1 ... <json>`（JSON 追加为**最后一个参数**）。

**由此推出一条硬结论**：**不能把自家 argv 追加到用户已有的 `notify` 后面** ——
那会变成 `用户的exe 用户的args 我们的exe 我们的args`（垃圾命令）。
故用户已有**非自家** `notify` 时一律 `Noop`（不覆盖、不追加）：宁可不装。

**`notify` 与 `Structured` 的四处差异**（不可共用一个变体）：

| | `Structured`（Claude 系） | `NotifyArgv`（Codex） |
| --- | --- | --- |
| 格式 | JSON 嵌套对象 | TOML 数组键 |
| 语义 | 按事件名分组，一个配置可携带多条 | **一条 argv**，只能有一条 |
| 载荷投递 | stdin | **argv[last]** |
| 合并算法 | 逐事件 merge + matcher | 单键整体替换 / 删除 |

**`status` 语义差异**：`NotifyArgv` 指向的是 **shim 路径**而非嵌入内容，
故**没有「文件过期」概念**（shim 内容变了行为自然跟着变）—— `version_current` 只比 argv。

**shim 载荷双来源**（两种 CLI 投递形态不同，同一个 shim 都支持）：

```
Claude 面：argv = [shim, source, event_key]          载荷来自 stdin
Codex  面：argv = [shim, source, event_key, <json>]   载荷来自 argv[3]
```

解析顺序：**先试 argv，再回退 stdin**（顺序不可交换 —— Claude 面 argv[4] 恒 undefined，
自然落到 stdin；Codex 面 stdin 可能是 TTY/已关闭）。`source` / `event_key` 两路取法一致
⇒ shim 仍零 per-CLI 知识。

**⚠️ TOML 表作用域**（实施期实测踩坑，最易错的一条）：

> **在新键插入 `[table]` 之前，绝不能追加到文件末尾。**

TOML 的**表作用域延续到下一个表头**。用户 `~/.codex/config.toml` 末尾通常是
`[hooks.state."…"]` —— 在末尾追加的 `notify` 会落在**那个表内部**，不是顶层键。
症状极隐蔽：**文件看起来写对了**（字符串包含成立），但解析后顶层没有该键
（Codex 因此从不调用 shim）。`tomllib` 实证：

```
notify at EOF        → 顶层有 notify? False   （实际落在 hooks.state.<key>.notify）
notify before tables → 顶层有 notify? True
```

故 `top_level_insert_offset()` 的判据是**第一个 `[` 开头的行（允许前导空白）之前**；
无表头时文件末尾即顶层键区。

**→ 测试形态要求（两条，缺一不可）**：

1. **oracle 用解析器回读**，不是字符串包含 ——
   `toml::from_str` 后断言顶层键存在、且不落进任何子表。
   用 `contains("notify = ")` 会漏掉表作用域错误。
2. **同时断言两个面**：配置条目 **与** 落盘的 shim 文件。
   2026-10-16 用户实测「装了但没通知」的根因是 `install_notify_argv` **只写配置不写 shim** ——
   而当时三条测试全都只断言配置文本，**没有一个看 shim 是否存在**。
   → 安装/卸载/状态三处都必须覆盖两个面（见下方 Error Matrix 与 Tests Required）。

**文本级而非解析-重序列化**（同「权限继承」的理由）：`config.toml` 含用户敏感内容与个人格式，
`toml::to_string` 会重排键序、丢注释、改引号风格 → AC4「逐字不变」无法保证。
文本级只插入/删除**那一行**，其余字节原样搬运（测试判据：删掉新增行后与原文逐字节相等）。

### 4. Validation & Error Matrix

| 场景 | 预期 |
|------|------|
| 键不存在 | Insert 在**第一个表头之前**插入一行（语义回读验证属于顶层） |
| 值是自家 argv 且完全一致 | `Unchanged`（零改写） |
| 值是自家 argv 但不一致（如 shim 路径变） | 整条替换（收敛，不留两条） |
| 值是**非自家** argv | `Noop` + 原样（不覆盖 —— 见 §3 硬结论） |
| 空数组 `notify = []` | 视为「没有命令」→ 填上我们的 |
| 值非数组（字符串 / 内联表 / 整数） | `Noop` + 原样（fail-safe） |
| 跨行数组 / 单引号字面量 / 数组后跟杂项 | `Noop` + 原样（不支持就不改） |
| 行内注释（`notify = [] # 备注`） | 解析容忍，正常填充 |
| 注释行 / `xnotify` / `notify_extra` | 不匹配（判据是行首为键名且后接 `=`） |
| 移除时本就没有 / 非自家 | `Noop`（不产生噪音回执行） |
| 移除自家 | 整行删除（留 `notify = []` 会让 Codex 执行空命令） |
| 配置不存在 | `Skipped` + **不创建** |
| **配置条目在但 shim 文件缺失** | `installed == false`（不撒谎）；`install` 必须**补写 shim**（不能因配置 merge 得 `Unchanged` 就提前返回） |
| 卸载 | **两个面都清**（删条目 + 删 shim），任一有动作即报 `Removed`，不留孤儿 |

### 5. Good/Base/Bad Cases

- **Good**：`HOOK_TARGETS` 加一行 `NotifyArgv { config_file, key }` 即接入同类 CLI；
  `report_argv` 与 `render_report_command` 共用 node 解析与 token 校验（只差交付形态）。
- **Base**：用户 `config.toml` 无 `notify` → 插入到顶层键区，其余内容逐字节不变。
- **Bad**：追加到文件末尾（落入最后一个表 —— 本任务实测的 bug）；
  把自家 argv 追加到用户已有 `notify` 后面（垃圾命令）；
  用解析-重序列化改用户配置（丢格式）；
  测试用字符串包含断言（抓不住表作用域错误）。

### 6. Tests Required

- `toml_merger.rs`（19 条）：`insert_lands_at_top_level_even_when_file_ends_with_a_table`
  （**关键回归钉子** —— 反证：退回「追加末尾」必红）、`inserted_key_sits_before_the_first_table_header`、
  `insert_into_flat_file_without_tables`、`insert_skips_when_user_has_own_notify`、
  `insert_is_idempotent`、`insert_converges_stale_own_entry`、`non_array_value_is_untouched`、
  `unsupported_shapes_are_untouched`、`comments_and_similar_keys_are_not_matched`、
  `remove_prunes_the_whole_line`、`escape_round_trips_backslashes_and_quotes`、
  `append_handles_missing_trailing_newline`、`inline_comment_after_array_is_tolerated`。
- `writers.rs`（**两个面都要断言**）：
  `notify_install_writes_both_shim_file_and_config_entry`（**反证钉子**：删掉 shim 写入必红）、
  `notify_install_repairs_missing_shim_when_config_already_correct`（**反证钉子**：
  只在 merge `Changed` 时写盘必红）、`notify_status_requires_shim_file_too`、
  `notify_uninstall_removes_shim_file_too`、
  `notify_install_writes_argv_entry_preserving_rest` /
  `notify_install_is_idempotent` / `notify_install_skips_when_config_absent` /
  `notify_install_skips_when_user_has_own_notify` / `notify_install_preserves_config_permissions`（Unix）/
  `notify_status_tracks_entry_presence_and_argv` / `notify_uninstall_removes_own_entry_only` /
  `notify_uninstall_leaves_user_own_notify`。
- `targets.rs`：`codex_has_both_notify_and_hooks_json_faces`（**AC1 反证钉子**：缺任一面必红）
  / `codex_dir_honors_codex_home_env`。
- `platform/hook_command`：`report_argv_shapes_plain_array_without_quoting` /
  `report_argv_rejects_unsafe_tokens`（两形态共用白名单）。
- shim：`report_shim_keeps_contract_anchors_and_knows_no_native_events`（含 `process.argv` 锚点）。
- **e2e（人工）**：真机 Codex → shim → ingest 收到 `turn_completed`（2026-10-16 已打通一次）。

### 7. Wrong vs Correct

#### Wrong

```rust
// ❌ 只写配置面、不写 shim 文件（2026-10-16 实测的 bug）：
// config.toml 指向不存在的脚本 → CLI 每次调用都失败，而回执却是 Applied
let (updated, merge) = toml_merger::apply_notify(&text, key, &entry, Insert);
if merge == Changed {
    write_atomic_preserving_mode(&config_path, &updated)?;   // ← shim 从未落盘
}
```

```rust
// ❌ 追加到文件末尾：TOML 表作用域会让它落进最后一个 [table] 内部
out.push_str(text);
out.push_str(&format!("notify = [...]\n"));
```

```rust
// ❌ 用户已有 notify 时追加自家 argv → 变成垃圾命令
// 用户的: notify = ["/their/tool.sh", "--flag"]
// 追加后: notify = ["/their/tool.sh", "--flag", "/usr/bin/node", "/a/neeko-status.mjs", ...]
```

```rust
// ❌ 测试用字符串包含（抓不住上面的表作用域 bug）
assert!(after.contains("notify = "));
```

#### Correct

```rust
// ✅ 两个面都落盘：先 shim（配置指向它），再配置；
//    且「配置已对但 shim 缺失」也要补写（否则早期故障态永不修复）
let shim_current = read(&shim_path).is_ok_and(|c| c == render(target.template));
match merge {
    Unchanged if shim_current => Unchanged,
    Unchanged => { write_shim()?; Applied }        // 只补文件面
    Changed => { if !shim_current { write_shim()?; } write_config()?; Applied }
}
```

```rust
// ✅ 插入到第一个表头之前（无表头则末尾）
let at = top_level_insert_offset(text);
out.push_str(&text[..at]);
out.push_str(&render_key_line(key, entry));
out.push_str(&text[at..]);
```

```rust
// ✅ 用户已有非自家 notify → 不动
if !ours && !items.is_empty() {
    return (text.to_string(), TomlMergeOutcome::Noop);
}
```

```rust
// ✅ oracle = 解析器回读（语义层）
let parsed: toml::Value = toml::from_str(&after).expect("valid TOML");
assert!(parsed.get("notify").is_some(), "必须在顶层");
```

### 8. 探测安全（本次事故的固化教训）

**任何会写 CLI 配置的探测必须先设 `CODEX_HOME=<tempdir>`**。
实测：`codex exec -c <key>=<value>` 的 `-c` 覆盖**会被写回** `~/.codex/config.toml`
（配置持久化，不是纯内存）—— 本任务期间两次探测因此污染了用户真实配置
（多了一个 `[projects."…"]` 块与一行 `notify`），已恢复。

同类风险适用于任何「CLI 会自动持久化其配置」的场景：探测前先确认
「这个环境变量能否把配置重定向到沙箱」，不能则先备份并在探测后逐字核对。

---

## 场景：一个 CLI 可以有**多个接入面**（`HookTarget::shapes`）

> 任务源：`10-16-notify-codex`（2026-10-16 A 方案）。**修正了本文件上一节「一个 CLI 一个 `shape`」的隐含假设。**

### 1. Scope / Trigger

- **Trigger**：Codex 有**两条互不替代**的通知通道：
  1. `notify`（`config.toml` 数组键）→ 只报**轮次完成**，**零交互即装即用**；
  2. `hooks.json` 的 `PermissionRequest`/`Stop`/`StopFailure` → **审批/失败**，但受**信任门**约束。

  只接其一会**功能性缺失**：只接 (1) 拿不到审批通知；只接 (2) 在用户未确认信任时
  **一条都收不到**（连完成通知都没有）。
- **Scope**：`agent/hooks/targets.rs`（`HookTarget::shapes`）、`agent/hooks/writers.rs`
  （`shape_status` / `install_at` / `uninstall_at` / `combine_outcomes` / `trust_probe`）。

### 2. Signatures

```rust
pub struct HookTarget {
    pub source: &'static str,
    pub file_name: &'static str,
    pub template: &'static str,
    pub dir: fn() -> Option<PathBuf>,
    /// 该 CLI 的**全部接入面**（一个 CLI 可有多条通道）。
    pub shapes: &'static [InstallShape],
}

// writers.rs —— 面聚合
fn shape_status(target, dir) -> (bool, bool);          // installed = 所有面都在位
fn install_at(target, dir) -> HookApplyOutcome;        // 遍历面 → combine_outcomes
fn uninstall_at(target, dir) -> Option<HookApplyOutcome>;
fn combine_outcomes(target, outcomes) -> HookApplyOutcome;  // Failed > Applied > Skipped > Removed > Unchanged
fn trust_probe(target, dir) -> Option<bool>;           // None=不适用 / Some(true)=已确认 / Some(false)=待确认
fn camel_to_snake(name: &str) -> String;               // Codex 信任键用 snake_case 事件名
```

**`HookInstallStatus` 新增字段**：

```rust
pub trusted: Option<bool>,   // None = 该 CLI 无信任概念；false = 已装但用户未确认（功能不生效）
```

### 3. Contracts

**为什么不能代写信任哈希**（spike 实测结论，别重走这条路）：

| 尝试 | 结果 |
| --- | --- |
| 枚举 45 个候选 hash 输入格式 | **全部不匹配** 真实 `trusted_hash` |
| `-c bypass_hook_trust=true` / `-c hooks.bypass_hook_trust=true` | ❌ 探针未触发 |
| `--dangerously-bypass-hook-trust` | ❌ 未触发 |

二进制只暗示输入是「normalized hook identity 的 TOML 序列化」——**内部实现、非稳定契约**。
故只能是**只读探针**：探测状态、如实向用户展示，代用户决策走 TUI 一次性确认。

**面聚合**：`installed` 是**所有面**的与（缺任一 = 未安装）。
理由：只报部分面就位 = 撒谎，且会掩盖「审批通知没生效」—— 又一次「装了但没通知」。

**回执聚合优先级**：`Failed` > `Applied` > `Skipped` > `Removed` > `Unchanged`；
多面时 `detail` 汇总各面非空说明（用户需要知道**哪个面**出了问题）。

**`trust_probe` 的判据必须精确到「我们自己的条目」**（**这是本轮抓到的第二个真 bug**）：

> `hooks.json` 是**共享文件**。用户机实测（2026-10-16）它同时被 superset 等他人工具占用，
> 且**他人的 hook 已被信任**（`[hooks.state]` 里有 `<path>:stop:0:0`、
> `<path>:session_start:0:0` 等键）。若只判「有没有以我们 `hooks.json` 路径开头的键」，
> 会命中**他人的**键 → 谎报「已确认」→ 用户看到「已安装」却收不到审批通知。

正确判据：算出**我们每条条目**的期望键并逐个检查 ——
`<abs path>:<event_snake>:<group_idx>:<hook_idx>`，
其中 `group_idx`/`hook_idx` 是条目在 `hooks.<Event>[]` 数组里的位置（用
`merger::command_targets_shim` 定位自家条目）。
**只读**：绝不代写 hash（不可反推，且是 Codex 内部契约）。

**`settings_file` 缺失时的三态区分**（**本轮抓到的第三个真 bug**）：

`read_settings` 的 `None` 涵盖三种语义完全不同的情况，必须分开：

| 状态 | 行为 | 理由 |
| --- | --- | --- |
| 文件**不存在** 且 **CLI 目录在** | **创建**空壳 `{"hooks":{}}` 并继续 | 实测：Codex 的 `~/.codex/` 通常存在（`config.toml`/`auth.json`/`sessions/` 都在），而 **`hooks.json` 往往不存在**。沿用「文件不在就 `Skipped`」→ 审批面**静默缺失**且设置页看不出 |
| 文件**存在但不可解析** | `Skipped` + 原样保留 | **绝不覆盖用户内容**（fail-safe） |
| **CLI 目录不存在** | `Skipped`，不代建目录 | 客人不喧宾（既有契约） |

### 4. Validation & Error Matrix

| 场景 | 预期 |
|------|------|
| 双面 CLI（Codex）首次安装 | 两个面都落盘；`installed=true`；`trusted=Some(false)` |
| 缺任一面的文件/条目 | `installed=false`（不撒谎） |
| 他人信任键存在、我们的不存在 | `trusted=Some(false)`（**不得**因他人的键谎报 true） |
| `hooks.json` 不存在但 `.codex/` 存在 | **创建**并安装（非 `Skipped`） |
| `hooks.json` 存在但非法 JSON | `Skipped` + 逐字保留 |
| `.codex/` 不存在 | `Skipped`，不建目录 |
| 卸载 | 两个面都清；任一有动作即 `Removed` |
| 无 `hooks.json` 面的 CLI | `trusted=None`（UI 不展示信任态） |

### 5. Good/Base/Bad Cases

- **Good**：Codex 的 `shapes` = `[NotifyArgv, Structured{hooks.json}]`。
  设置页显示「已安装 — needs confirmation in the CLI」直到用户确认。
- **Base**：只有一个面的 CLI（claude/pi/omp）→ 行为与单 `shape` 时代完全等价。
- **Bad**：把一个 CLI 建模成单 `shape`（会丢通道）；
  信任判据用「路径前缀」（会被他人键命中）；
  把「文件不存在」与「不可解析」归到同一个分支（会覆盖用户坏文件）。

### 6. Tests Required

- `writers.rs`：`dual_face_install_writes_every_face`（**反证**：只处理第一个面必红）、
  `dual_face_uninstall_clears_every_face`、`partial_faces_report_not_installed`、
  `combine_outcomes_uses_strictest_status`、
  `trust_probe_requires_our_own_entry_keys`（**反证钉子**：只判路径前缀必红）、
  `camel_to_snake_matches_codex_key_format`、
  `structured_install_creates_missing_settings_file_when_dir_exists`（**反证**：缺失即 Skipped 必红）、
  `structured_install_never_overwrites_unparseable_existing_file`（**反证**：不区分三态必红）。
- `targets.rs`：`codex_has_both_notify_and_hooks_json_faces`（**反证**：缺任一面必红）。
- 前端：`describeHookStatus`（`trusted: false` → 必须显示「needs confirmation」）。

### 7. Wrong vs Correct

#### Wrong

```rust
// ❌ 单 shape：Codex 只能接一条通道（丢完成或丢审批）
pub shape: InstallShape,

// ❌ 信任判据用路径前缀：会被他人的信任键命中（hooks.json 是共享文件）
let prefix = format!("[hooks.state.\"{}", hooks_json.display());
Some(state.lines().any(|l| l.starts_with(&prefix)))

// ❌ 把「不存在」与「不可解析」归到一起：会覆盖用户的坏文件
let Some(config) = read_settings(&path) else { return Skipped };
```

#### Correct

```rust
// ✅ 多面 + 面聚合（installed = 所有面都在位）
pub shapes: &'static [InstallShape],

// ✅ 信任判据精确到自家条目的期望键
state.contains(&format!("[hooks.state.\"{path}:{snake}:{gi}:{hi}\"]"))

// ✅ 三态区分：不存在→创建（目录在时）；不可解析→保留；目录不在→跳过
match read_settings(&path) {
    Some(c) => c,
    None if !path.exists() && dir.is_dir() => json!({ "hooks": {} }),
    None => return Skipped,
}
```

---

## 场景：ingest 传输层已迁到进程内 HTTP 网关（`crate::server`）

> 任务源：`10-17-cs-http-gateway`（2026-10-17）。**wire 契约逐字节不变**，变的是谁在做 HTTP。

### 1. Scope / Trigger

- **Trigger**：C/S 化——进程内常驻一个 HTTP 服务端，后续任何客户端形态（本机 CLI / Web / 其他端）
  经同一套「鉴权门 → 路由组 → 内核」接入，不再各自造服务与鉴权。hooks ingest 是这套架构的
  **第一个落脚点**，不是它的定义域。
- **Scope**：`src-tauri/src/server/`（引擎 + 门 + 路由组契约）、
  `agent/hooks/ingest/`（8 文件，按「一次请求经过的顺序」+ 正交关注点分层：
  `handlers` 路由组 + 消费者装配 / `validation` 准入校验 / `event` 事件契约 /
  `notify` 通知投影 / `dispatch` 通知消费者（投递链的唯一有副作用实现）/
  `attribution` 归属 / `endpoint` 坐标）、
  `agent/hooks/boot.rs`（bind → 建门 → 建组 → serve 接线）。
  **文件命名判据**：文件名必须回答「它做什么」，而不是「它属于哪个抽象层」——
  「kernel」是 OS 术语、「contract」是抽象分类词，两者都不描述行为，故不用作文件名。

### 2. Signatures

```rust
// server/mod.rs —— 基础设施层（零业务、零 tauri）
pub use engine::{serve, ServerConfig, ServerHandle};
pub use gate::{AuthGate, CredentialExt, HeaderToken};
pub use group::{FailurePolicy, RouteGroup};

pub fn serve(runtime: &AppRuntime, config: ServerConfig,
             gate: Arc<AuthGate>, groups: Vec<RouteGroup>) -> std::io::Result<ServerHandle>;

// agent/hooks/ingest/validation.rs —— 准入边界：白名单 → JSON → 会话身份（纯函数、无 IO）
pub const TOKEN_HEADER: &str;                                  // wire 契约常量（模板锚点测试消费）
pub fn validate(source: &str, body: &[u8], sink: impl FnMut(&str, HookEvent));

// agent/hooks/ingest/event.rs     —— HookEvent：上报事件契约（公共数据资产）
// agent/hooks/ingest/handlers.rs  —— handler + RouteGroup 声明 + 投递隔离
// extra = 下游消费者端口（组合根注入；hooks 域不认识它是什么域）
pub type Deliver = dyn Fn(&str, HookEvent) + Send + Sync;
pub type ExtraConsumer = Arc<Deliver>;
pub fn route_group(app: AppHandle, runtime: Arc<AppRuntime>, extra: ExtraConsumer) -> RouteGroup;
pub fn route_group_with(deliver: impl Fn(&str, HookEvent) + Send + Sync + 'static) -> RouteGroup; // 测试缝

// agent/hooks/ingest/dispatch.rs  —— 投递链（唯一有副作用的投影；被下面两个消费者之一调用）
pub(crate) fn deliver_notification(app: &AppHandle, source: &str, event: HookEvent); // 通知消费者
```

### 3. Contracts

- **分层位置是契约**（不是风格）：必须被失败策略改写的三层由引擎装在**组内、归一化层内侧**——
  tower 中间件只能改写**来自内层**的响应，装到全局外层则 `panic→500` / `timeout→408` /
  `body→413` 不经过组内归一化，fail-open 组会向 CLI 漏出 5xx（违背 B1）。
  洋葱序（外→内）：`access_log → gate(403) → concurrency(503) → [normalize → catch-panic →
  timeout(408) → body-limit(413) → routes]`。
- **`axum` 的 `.layer()` 后加者在外**（`docs/routing/layer.md`：middleware executes bottom to top）
  —— 写反即静默失效。
- **门在并发限制之外**：未鉴权请求在门处即 403、**不占并发槽位**；403 同时在组归一化之外，
  不被 fail-open 改写（错 token 必须见 403）。
- **并发上限自写 semaphore 中间件**：tower-http **没有**并发限制层（实测 0.6.8），
  `tower::limit::ConcurrencyLimitLayer` 是 `poll_ready` 排队语义（会堆积到超时），
  与「超限立即拒绝」相反。
- **`TimeoutLayer::new` 自 0.6.7 起 deprecated 且默认 408**：必须用
  `TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, …)`（`-D warnings` 会拦旧 API）。
- **投递必须隔离（红线 3）**：`deliver_notification`（`dispatch.rs`）同步持
  `project_manager` / `notification.policy` 两把 std `Mutex`；handler 跑在 Tauri 共享 runtime
  worker 上，必须经 `AppRuntime::spawn_blocking` fire-and-forget 投递（唯一装配点 =
  `handlers.rs::compose_consumers`）。204 不依赖投递结果，响应不再含锁等待。
- **一次 `spawn_blocking`，N 个消费者**：每个消费者各开一个阻塞任务会让每条 hook 占 N 个
  worker（在途上限 16 ⇒ N 倍占用）；两个消费者读的还是同一份事件快照，分开投递会让它们
  可能看到不同的中间状态。所以消费者一律**顺序**跑在同一次阻塞任务里，**通知在前**（下游
  的失败 / panic 只能毁掉它自己：`Fn` 不返回 `Result`，panic 落进被丢弃的 `JoinHandle`）。
  **每个消费者各自被 `catch_unwind` 隔离**（`run_guarded`）：顺序不等于依赖，通知侧一个
  panic 不该让下游消费者整条消失，反之亦然。新增消费者的正确做法是往这个组合点里加一个
  闭包（它会自动被隔离），**不是**再调一次 `spawn_blocking`。
- **下游消费者经端口注入，不反向依赖**：`hooks` 只声明 `ExtraConsumer`（`Arc<Deliver>`），
  由组合根（`app::boot`）接到具体域（今天是 `team::deliver::observe`）。依赖边因此是
  `consumer_domain → hooks`，`hooks` 可脱离任何消费方编译 —— 它是 fail-open 的常开路径，
  不该因为下游域的重构而受影响。
- **token 校验唯一位置是门**：准入层（`validation`）不再持有 token、不做比较（`ct_eq` 调用点 = 1，AC7）。
- **访问日志用自写 `log` 中间件**：`tower_http::TraceLayer` 发 `tracing` 事件，本仓日志是
  `log` crate、无 subscriber → 生产静默 no-op。

### 4. Validation & Error Matrix

| 输入 | 产出 |
|---|---|
| 合法 token + 已注册 source + 合法 JSON | 204，投递 1 次 |
| token 不符 / 缺失 | 403（门产出，不经归一化） |
| 未知 source | 204 + `log::warn`，不投递 |
| 非法 JSON / 空 session_id / 缺必填 | 204，不投递 |
| body > 64KB | 引擎 413 → 组内归一 → 204 |
| 请求超时 | 408 → 组内归一 → 204 |
| handler panic | 500 → 组内归一 → 204 |
| 并发超上限 | 503（组外，shim 忽略 status） |
| **未知路径 / 方法不符** | **404 / 405 原样透出，不被归一化** |
| 裸非 HTTP 字节 / 超长头 | 400 / 431（**已记录偏差**：真实 shim 只发 fetch 生成的合法 HTTP） |

**归一化的范围是契约，不是「所有 4xx/5xx」**（2026-10-17 复审修正）：只覆盖三个**框架级异常**
（`catch-panic` 的 500 / `timeout` 的 408 / `body-limit` 的 413）。路由层自产的 404 / 405 必须透出 ——
「请求没打对」不是「我们失败了」，吞掉它会让客户端打错地址与内部 panic 在 wire 上不可区分，
且与「门在归一化之外、错 token 必须见 403」自相矛盾。

判据与层产出码共用 `engine::framework_status` 常量（**单一事实源**）：若两处各写字面量，
改超时码会静默打破归一化 —— 层产 504 而判据只认 408 → fail-open 组漏出 5xx 且无测试变红。

### 5. Tests Required

- `server::gate::tests`：凭证提取 / 恒定时间匹配 / OR 语义 / 空列表恒拒 /
  **任意畸形头零 panic**（门在组内 catch-panic 之外，panic 无人兜底）。
- `server::engine::tests`：bind loopback / 403 不被归一化 / panic、timeout、body 超限三态各验
  FailOpen 与 FailClosed / 并发 503 / **未鉴权不占槽位** / `stop()` 收敛（**必须经独立 OS 线程**：
  `block_on_shutdown` 在 runtime 线程内 panic）/
  **404 与 405 不被归一化**（`routing_errors_are_not_normalized_by_failure_policy`）/
  **归一化判据与层产出码同源**（`framework_exception_codes_are_recognized_by_the_policy`）。

  **历史教训（2026-10-17 复审）**：曾有三条 panic/timeout/未鉴权用例用 `request()`（默认 POST）
  打 `get()` 路由 → 恒 405。旧归一化判据是「所有 4xx/5xx」，405 被吞成 204，**三条用例因此假绿** ——
  panic 路径根本没被执行过。收窄判据后它们立刻转红，暴露了这个持续整个开发周期的覆盖空洞。
  教训有两条：① 用例必须断言「真的打到了目标」（`panic_path_really_reaches_the_handler` 即为此而加）；
  ② 归一化范围越宽，越容易把测试失误转成假绿。
- `tests/unit/http_gateway_test.rs`：真引擎 + 真 socket + `route_group_with` 注入 sink，
  **状态码 + 投递记录双断言**（AC2）。集成测试是独立 crate、无 `tauri::test` feature，
  构造不出 `AppHandle` —— 不得为此给 tauri 加 `test` feature。
- **真机端到端**（2026-10-17 已确认）：真实 CLI POST → 204 → 系统通知送达；
  日志 `[http] POST /hook/pi -> 204 (182µs)` 同时证明 204 不含锁等待（H4）。

### 6. Wrong vs Correct

#### Wrong

```rust
// ❌ 三层装在全局外层：panic/超时/413 不经过组内归一化，fail-open 组漏出 5xx
Router::new().merge(mount_all(groups)).layer(CatchPanicLayer::default())
    .layer(TimeoutLayer::new(d)).layer(ConcurrencyLimitLayer::new(16));

// ❌ handler 里同步投递：std Mutex 占住共享 runtime worker，前端 IPC 一起停摆
//   （`deliver_notification` 是 dispatch.rs 的 private 实现，只允许出现在 spawn_blocking 闭包内）
validate(&source, &body, |s, e| deliver_notification(&app, s, e));

// ❌ 为了测试投递给 tauri 开 test feature（污染生产依赖面）
```

#### Correct

```rust
// ✅ 组内：normalize 在最外，三层在它内侧
group.router
    .layer(RequestBodyLimitLayer::new(max_bytes))
    .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, timeout))
    .layer(CatchPanicLayer::custom(panic_response))
    .layer(FailurePolicyLayer::new(name, policy));

// ✅ handler 只调注入的闭包；生产闭包走阻塞池
route_group_with(move |source, envelope| {
    let source = source.to_owned();
    runtime.spawn_blocking(move || deliver_notification(&app, &source, envelope));
})

// ✅ 测试缝注入记录型 sink，走真引擎真 socket
route_group_with(move |s, e| recorded.lock().unwrap().push((s.to_owned(), e)));
```

---

## 场景：**自供源**（`shapes` 为空 —— 收上报，但不提供安装腿）

> 任务源：`10-16-notify-dsh`（2026-10-27）。

### 1. Scope / Trigger

- **Trigger**：要接入的 CLI **自己就有进程内插件**能上报，Neeko 既不该也不需要往它的用户目录
  写文件。DSH 是第一个：上报由 `packages/dsh-neeko`（DSH 自己的 cordis 插件）完成。
- **Scope**：`agent/hooks/targets/data.rs`（数据行）、`agent/hooks/install/status.rs`
  （`self_supplied` 字段）、`src/features/settings/components/CliHooksSection.tsx`（隐藏开关行）。

### 2. Contracts

`HOOK_TARGETS` 同时驱动**两件不同的事**，这是本形态存在的全部理由：

| 用途 | 需要的条件 |
| --- | --- |
| `/hook/{source}` 的**接收白名单**（`ingest/validation.rs::hook_source`） | 只要在表里 |
| 设置页「Neeko 能装哪些 CLI」+ `apply_selection` 安装遍历 | `shapes` 非空 |

**自供源 = `shapes: &[]` + `dir: || None`**，表达「接收上报，但不安装、不展示开关」。

- 若把 DSH 建模成「有 shapes 但 dir 恒 None」：设置页的 `hookStatus.map` **无条件渲染**，
  会多出一行「dsh — not installed」+ 拨动无效果的开关 —— 正是本任务要避免的「看起来有、实际没有」。
- 若不把 DSH 放进 `HOOK_TARGETS`：`/hook/dsh` 返回 **204 但事件被静默丢弃**
  （`hook_source` 的 fail-open 出口），表现为「装了但没通知」。

### 3. `self_supplied` 不是 `path.is_empty()`

`HookInstallStatus::self_supplied` 是**显式字段**。UI 判据必须是它，不能是 `path === ''`：

| 情况 | `path` | `self_supplied` | 应否展示开关 |
| --- | --- | --- | --- |
| 自供源（dsh） | `""` | `true` | **否**（装了也没用） |
| 正常 CLI，目录定位不到（本机没装 pi） | `""` | `false` | **是**（用户可能要装它） |

把两者压进一个字段 = 「未初始化的 pi」从列表里消失，用户再也装不上。

### 3b. 收敛路径必须显式跳过自供源（不只是「不展示」）

`apply_selection_over` 的 `dir_of(target) == None` 分支返回
`Failed("cannot locate user config directory")`。自供源的 `dir()` 恒 `None` ——
若只在 UI 上过滤而忘了收敛腿，每次开机都会记一条 `dsh:Failed`，让开机日志谎报
「改了什么」（`boot::reconcile` 的 `changed` 过滤器**包含 `Failed`**）。

**代价面**：设置页在 `getCliHookStatus()` 失败（回 `[]`）时 `enabledSourcesFor` 返回
`null`，Rust 侧谓词退化成 `|_| true` → 自供源走 `dir_of` None → `Failed` →
前端弹 **error** toast。用户看到的是「CLI hooks 失败了」，而什么都没失败。

护栏：`install/selection.rs::self_supplied_targets_produce_no_outcome`
（两个 `master` 取值各断言一次；变异验证：删掉 filter 立刻红）。

### 4. Tests Required

- `targets/tests.rs::self_supplied_sources_are_not_installable` —— 自供源清单的**唯一登记处**
  （新增自供源必须同步改这条断言，否则说明有人漏填 `shapes`）。
- `targets/tests.rs::self_supplied_sources_are_still_accepted_by_ingest`
- `targets/tests.rs::self_supplied_sources_have_no_directory`
- `tests/unit/http_gateway_test.rs::dsh_source_is_accepted_by_ingest` —— **断言「投递了」**
  而非「204」（204 假绿灯是本形态的主要陷阱）。反证：删掉 `dsh` 行必红。
- `CliHooksSection.test.tsx::installableHookRows` —— 含反证钉子
  「`path === ''` 的正常 CLI 不得被过滤」。
- `templates/tests.rs::embedded_templates_keep_contract_anchors` 必须**跳过**空 shapes
  （自供源没有 Neeko 嵌入的模板）。
- `install/selection.rs::self_supplied_targets_produce_no_outcome` —— 收敛回执里不得出现
  自供源，**尤其不得是 `Failed`**（见 §3b）。

### 4b. 上报端住在 CLI 自己的包里时，跨栈契约仍需护栏

自供源的上报代码不在 `agent/hooks/templates/`，而在 `packages/dsh-neeko/src/notify-*.ts`
（`packages/` 不纳入根门禁）。于是**没有任何测试把两侧的字符串绑在一起** ——
改 Rust 的 `ENV_KEY_PORT` / `TOKEN_HEADER` / `event_keys` 或 `/hook/{source}` 路由段，
包侧静默断裂，两侧测试各自全绿。

护栏：`packages/dsh-neeko/tests/notify-contract.spec.ts`（5 条）**读 Rust 源码取常量**
再断言本包行为。已做变异验证（改路由段 / 改 token 头 / 改 event_key 各变红一条）。

判据与红线 5 同源：名字只允许来自单一源、改一端必须红。红线字面只覆盖 Tauri
Event 名，此处把同一判据用在 hook wire 契约上。

### 5. Wrong vs Correct

#### Wrong

```rust
// ❌ 忘了加白名单 → 204 但事件被丢弃（Step 0 P6b 实测形态）
// ❌ 或者：有 shapes 但 dir 恒 None → 设置页多一行死开关
HookTarget { source: "dsh", dir: || None, shapes: &[InstallShape::Standalone] }
```

```ts
// ❌ 用 path 空判自供源 → 把「本机没装 pi」也过滤掉
rows.filter((r) => r.path !== '')
```

#### Correct

```rust
// ✅ 空 shapes = 自供源（唯一标记，由 targets/tests.rs 登记）
HookTarget { source: "dsh", dir: || None, shapes: &[] }
```

```ts
// ✅ 显式字段
rows.filter((r) => !r.selfSupplied)
```

## 消费者投影文件的位置（例外：团队观察者）

`ingest/mod.rs` 的既定约定是「新增消费者时读 `HookEvent`，**自己写一个投影文件**」，
暗示投影落在 `agent/hooks/ingest/` 下。

**已知例外**：Agent Team 的观察者（`agent/team/observe.rs`）**故意放在消费方域内**，不在 `ingest/`。

判据是依赖方向：

| 放法 | 依赖边 | 后果 |
| --- | --- | --- |
| 放 `ingest/team.rs`（照文档） | `hooks → team` | hooks 是 **fail-open 常开路径**（承载 8 个 CLI 上报、与用户终端里的 agent 生死相关），认识团队域后，团队域的任何编译错误/语义变更都会波及上报链路 |
| 放 `team/observe.rs`（现状） | `team → hooks` | hooks 保持对消费方无知；团队域整体可删而不影响上报 |

所以判据不是「投影文件放生产者还是消费者」，而是「**让谁依赖谁**」。
新增消费者时按此判定；若你选择把投影放进 `ingest/`，必须在同一 diff 里说明为什么它值得
让 hooks 依赖你的域。
