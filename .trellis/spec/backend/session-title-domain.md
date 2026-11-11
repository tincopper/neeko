# 会话标题域（live-sessions 标题的事实层与观测层）

> 唯一正文：本文件回答「一个会话的标题从哪来、谁来判、永远为空可不可以」。
> 相关正文：`.trellis/spec/backend/conversation-adapter.md` §4.6.5 / §4.6.7（标题素材净化、
> conversation → live 的纯内存回落）、`.trellis/spec/backend/agent-hooks-domain.md`（hook 面）。
> 红线引用：15（CLI 差异落数据）、17（禁止影子副本）。

## 1. 第一性原理

标题是**用户意图的一次投影**，真相在用户脑子里。系统能做的只有「不丢掉已经观测到的那次投影」，
所以质量上限 = 观测通道的覆盖与保真，而不是标题算法。

三条推论（违反任一条都会重新长出「静默丢标题」这一类 bug）：

1. **事实与观测分层**：阶梯 + 唯一判据是稳定层；per-CLI 的载荷字段、存储布局是易腐层，
   只允许以**数据**出现。
2. **空标题不可表示**：空串把「还没观测到」变成不可渲染状态，下游必然各编兜底。
3. **可见性与命名正交**：能不能进侧栏不得由「有没有标题」决定 —— 否则一次观测缺口
   直接变成「会话消失」。

## 2. 阶梯与判据（稳定层）

```
User（用户改名） > Native（CLI 自述 / conversation provider title）
                 > Prompt（首条用户意图行：chat prompt / 纯 shell 首条输入 / hook 的 prompt 字段）
                 > Placeholder（身份标签，**非空**）
```

- 准入 + 覆盖序只有一个落点：`common::agent::title::{admit, should_upgrade}`
  （`live_sessions::title` / `live_sessions::entry::TitleSource` 都是 re-export，保持既有路径）。
  放在中立域的理由：判据有**两个消费者** —— 实时侧栏（`live_sessions`）与历史列表
  （`conversation`），而后者不能反向依赖前者。
- 适配器只产出**原始候选**：`ParsedMeta.title` → `TitleCandidate::CliNative`、
  `first_user_message` → `TitleCandidate::Prompt`（由 `ParsedMeta::title_candidates()` 给出，
  按质量序排列）。历史列表与实时侧栏都经 `admit_candidates` 取值，**不得自己挑一条**。
  回归钉子：`manager::tests::history_and_live_paths_share_one_verdict`
  （同一串 `claude` / `Terminal 3` / cwd / 状态词在两条路径上都必须判负）。
- 净化与判决分两步：`common::agent::title::clean`（标题特有的 markdown 标记 + 对
  `common::agent::transcript_noise` 的编排）→ 来源策略。`User` 来源两者都不套（用户说了算）。
  「哪些字节不是语义」的词表与剥离实现**只有一份**（`transcript_noise`，预览管线消费同一份）；
  两份手抄曾导致 panic：手写扫描器把 `to_lowercase()` 的字节偏移用在原文上，遇到 `İ` / `ẞ`
  这类小写展开改变长度的字符会越界（2026-11-10 实测，已由正则实现取代）。
- `Placeholder` 的文本由 `live_sessions::title::placeholder_label` 合成
  （`<agent> · <cwd 末段>` / 纯 shell 用 cwd 名 / 退化 `<agent> <短id>`），
  **不猜测主题**，因此不构成红线 17 的影子副本 —— 它就是该会话的显示身份。
- wire 形态（`SessionView.title`）**永远非空**；`SessionEntry.title` 仍只在有真标题时非空
  （持久化不变量 `Placeholder ⟺ title == ""` 不动）。

## 3. 观测通道（易腐层，全部是数据）

| 通道 | 时机 | 落点 |
| --- | --- | --- |
| 用户改名 | 点击改名 | `Registry::set_title(User)`（自动来源永不覆盖） |
| Neeko 发出的 prompt | chat / prompt 参数 | `TitleSource::Prompt` |
| CLI hook | CLI 生命周期事件 | shim → `/hook/{source}` → `wiring::hooks::project`（来源由载荷声明） |
| 转录扫描 | 打开 History / 后台扫描 | adapter `parse_meta` → conversation 缓存（**机会性回落**） |

三条硬约束：

1. **推送优先**：实时标题必须来自事件。转录扫描只做历史富化 —— 让实时标题依赖「用户先打开过
   History」就是把标题寄托在运气上（`cached_title_for_native` 的 hydrate 时机，见
   conversation-adapter.md §4.6.7）。
2. **Claude 兼容面的 prompt 字段是 `prompt`**：`UserPromptSubmit` 事件是 claude / codebuddy /
   qoder 唯一携带主题文本的事件（载荷字段名三家相同，故 shim 里是一条数据而非分支）。
   没有它，三源的 `topic` 恒为 `null`，标题只剩占位。
3. **来源必须随文本一起上报**（`HookEvent::title_source`：`"native"` / `"prompt"`）。判据按来源
   定质量序，服务端猜不出「这串字是 CLI 自述还是用户敲的」：猜错就是同一句
   `Can you please fix X` 在侧栏（Native，不剥包装）与历史列表（Prompt，剥成 `fix X`）拿到
   两种判决。缺字段（旧 shim 未重装）一律按 `Native` 解释，不丢标题。
   prompt 是**逐轮**事件，所以 `wiring::hooks::project` 只让它给**还没有真标题**的会话命名 ——
   否则侧栏标题会随每条消息跳一次。

**已知缺口（登记，不是缺陷）**：`gemini` / `grok` / `reasonix` 没有 hook 上报面
（`descriptor.hook_source = None`），而缓存回落本身由 hook 事件驱动 ⇒ 它们的实时标题只能来自
用户改名，会话在侧栏停在占位标签。修法不是放宽标题门，而是给这些 CLI 加一条上报面。

## 4. 身份脊柱：一个 CLI 一行数据

`src-tauri/src/common/agent/descriptor.rs` 的 `AGENTS` 表是**唯一**声明处：

```rust
AgentDescriptor {
    id: "qoder",                                  // AgentConfig.id / adapter.agent_id / 缓存键
    hook_source: Some("qoder"),                    // /hook/{source} 路由段
    config_root: qoder_config_root,                // hook 落地 + 转录根的锚点
    transcripts: Some(TranscriptSpec {
        root: TranscriptRoot::UnderConfig("projects"),  // 「与配置同根」这条关系写进类型
        pattern: "**/*.jsonl",
    }),
}
```

- **为什么 `UnderConfig` 是枚举变体而不是字符串**：qoder / codebuddy / claude 的会话就在
  `<配置根>/projects/` 下 —— 「hooks 装这儿、会话在别处」曾经是两个独立字面量，漂移后
  表现为「扫到 0 条会话」（合法结果，无人报警）。
- 新增一个 CLI = **加一行** + 一个真实样本夹具；判据函数、shim 主体、前端组件零改动。
- 三个护栏（缺一则表会退化）：
  - `descriptor::tests`：`id` / `hook_source` 唯一；每行要么声明 transcripts、要么显式声明
    为自供源（DSH）；转录根必须在配置根之下或显式 `Elsewhere`；
  - `agent::hooks::targets::tests::hook_targets_and_descriptors_agree_on_hook_sources`
    （两表双向一致）；
  - `conversation::adapters::registry::tests::every_adapter_has_a_descriptor_row`
    （注册的 adapter 必须有行，且 `session_root` / `file_pattern` 非空）。

## 5. 漂移必须可见（否则同类问题还会活半年）

- `ScanReport` 带 `transcript_root` + `root_exists`；根不存在时**进 `errors` 并 `log::warn`**。
  此前「根不存在」安静返回 0 条 —— 这是 qoder 丢失全部历史却无人发现的直接原因。
- `real_transcripts_still_resolve_a_human_title`（`conversation/adapters/registry.rs`）：
  用真实落盘样本（截断正文、保留形态）断言仍解析出人类可读标题，口径是 `≥`（存在一条真标题），
  不断言具体文字（见 `unit-test/real-source-determinism.md`）。

## 6. 前端约束

- 渲染层**只消费**后端字符串：不得出现 `title || agentId || 'Conversation'`、
  「无标题就只画图标」这类兜底（红线 17 的影子副本，且让「后端没给」永远看不见）。
- `titleSource` **是 UI 的判据**（`isNamedSession`：`≠ placeholder` = 有真标题），不是展示字段。
  文档里「不进 UI」的旧说法已废止 —— 它与代码互斥，而互斥的文档比没有文档更糟。
- **两套界面用两个判据，不要混用**：
  - **tab / 历史列表**：永远有字可读 → 直接用 wire 上的 `title`（没有真标题时就是占位标签）；
  - **侧栏行**：`hasUserInput && titleSource ≠ placeholder`。
  即「打开 CLI 不出行；用户提交指令、标题到手的那一帧出现」。
  占位标签**不是**进列表的许可，否则一条没有信息量的行会常驻侧栏（第 35 轮的教训）。
- **不拿回合数当门槛**（2026-11-10 定案「拿到标题就出现」）：`turn_count` 不落盘，
  按它判会逼出「native|user 直通」特例，而特例让判据分叉。删掉依赖后特例一起消失，
  回填的历史行也不再需要任何特殊待遇。

## 7. 不做

- 不做标题「生成」（模型摘要）：它会把「丢观测」伪装成「有标题」，与可见性冲突。
  将来要做，它是阶梯上新增一级 + 独立的采样预算，不是替换判据。
- 不恢复 OSC 标题通道（第 35/37 轮已证伪）。
