# 执行计划：会话标题观测通道编排重构

## 1. 第一性原理与最终结构

目标不是「修好三个 adapter」，而是让**同一类问题不可能再静默发生**。因此验收对象是结构属性，
不是单点行为：

1. 「怎么拿到标题」的知识只有 1（判据）+ 1（descriptor 表）+ N（数据行），不再有 5×N 个副本。
2. 「没有标题」不可表示 —— 任一会话的标签非空，可见性不再由标题决定。
3. 观测通道腐坏必须可测（夹具探针）可见（健康度）。

三步按「症状 → 结构 → 治理」递进，每步独立可交付、可回滚。

## 2. 关键决策（为什么这样）

- **先 P0 再 P1**：P0 只动判据与渲染层，1-2 个文件，立刻消掉用户可见的空洞；若先做 P1，用户在
  中途仍然看不到标题，且无法用「侧栏是否列出」做验收反馈。
- **descriptor 放 `common/agent/`**（design §5 D1）：避免 hook ↔ conversation 反向依赖。
- **shim 保留内联数据表 + 一致性测试**（design §5 D2）：不引入运行期表注入，保持 shim 是静态文件。
- **不为历史索引做 backfill**：旧兜底串由下次扫描自然覆盖，写盘迁移会把错误数据固化。
- **夹具用真实样本 + `≥` 断言**（`unit-test/real-source-determinism.md`）：断言「至少 1 条真标题」，
  不断言精确集合，否则真实源一变化就假红。

## 3. 三步执行清单

### M0 · 标题永不空（消症状）✅ 已完成

- [x] `live_sessions/title/placeholder.rs`：`placeholder_label` + 用例（agent·cwd / 纯 shell / 根路径 / 多字节 id / 永不空）
- [x] `view.rs`：`SessionView::from_entry` 在 wire 边界补齐标签；`snapshot_view` 对同单元重复标签追加 `#2`
- [x] **变异验证**：把 `placeholder_label` 改成返回 `String::new()` → 10 条用例转红（确认用例承重）
- [x] `isListedSession` = `hasUserInput && titleSource ≠ 'placeholder'`（**最终定案**）。
      两轮修订都记在这里：① M0 整条删掉标题门（当时为了绕过三源拿不到标题）；
      ② 恢复标题门，判据从「非空」改成看 `titleSource`，并**删掉**「首轮已结束」与
      `native|user` 直通特例 —— 「拿到标题就出现」不需要回合数，特例随之消失
- [x] 删掉前端 4 处兜底：`isNamedSession`（整函数）/ `SessionListRow.fallbackLabel` /
      `resolveTabTitle` 的名字判据 / `conversationTabTitle` 的 `agentId ?? 'Conversation'` / `sessionRowActions` 的 `|| sessionId`
- [x] `pnpm check:quick` 绿
- [x] 手工验证（2026-11-10，用户确认符合预期）：提交指令后侧栏出现带标题的行、打开 tab 不出行

### M1 · 身份脊柱（结构主体）✅ 已完成

**已落地（用户可见的三源修复）**

- [x] `qoder.rs`：根改 `~/.qoder/projects` + `**/*.jsonl`，**委派** `ClaudeCodeAdapter`（实测同形，
      含 `ai-title`）；真机扫描从 0 条 → 43 个 jsonl
- [x] `codebuddy.rs`：根改 `~/.codebuddy/projects` + `**/*.jsonl`，按实测行形态（顶层 `role`/`content`）
      重写解析，标题取 `ai-title`；真机 17 个 jsonl；`message_count == parse_messages().len()` 已断言
- [x] `claude_code.rs`：首条 user 若为 harness 注入（`<local-command-caveat>` 等）**顺延下一条**
      （词表复用 `normalize::is_harness_injected_user_turn`），修掉索引里那 11 条噪声标题
- [x] `CLAUDE_COMPAT_ENTRIES` 3 → 4：新增 `UserPromptSubmit`（`matcher: None`，`event_key: "turn_started"`）
- [x] shim topic 链新增 `firstLine(input.prompt)`（shim 仍不含任何原生事件名，护栏用例守住）
- [x] `registry` 删除能力台账：codebuddy `Unsupported` → `Storage`
- [x] `cargo test --lib` 2688 passed；`pnpm check:quick` 绿

**结构收敛（已完成：字面量收进一张表）**

- [x] `src-tauri/src/common/agent/descriptor.rs`：`AGENTS` 表（10 + 1 自供源行）——
      `id` / `hook_source` / `config_root` / `transcripts{root, pattern}`。
      `TranscriptRoot::UnderConfig("projects")` 把「hooks 装这儿、会话也在同一根下」写进类型
- [x] 9 个 adapter 的 `session_root()` / `file_pattern()` 改为读表（`descriptor::transcript_root` /
      `file_pattern`），删掉 `codex_home_dir()` 与 `DB_PATTERN` 两处重复字面量；`omp` 保留夹具根优先
- [x] `agent/hooks/targets/dirs.rs` 的四个配置根改为 re-export `descriptor::*_config_root`
      （hook 安装面与转录面共用同一份实现 —— qoder 漂移的根因正是这里有两份）
- [x] 护栏三条：表自洽 / hook 表与 descriptor 表双向一致 / 每个注册 adapter 有 descriptor 行
- [x] 变异验证：把 qoder 的转录根改成 `Elsewhere("/tmp/.qodercli/projects")` →
      `lookup_helpers_agree_with_the_table` 转红（记录了「该护栏拦什么、不拦什么」）

**曾列在下面、但已确认无需做**

- ~~`PromptHookSpec`（按 CLI 声明 prompt 字段名）~~：Claude 兼容三家的字段名**相同**（`prompt`），
  再引入一张 per-CLI 字段表就是给一个恒定事实加一层间接。护栏改成「shim 不认原生事件名」
  + 「hook 表与 descriptor 表一致」两条（见 design §5 D2 的修订说明）

**原清单的去向（逐条对账，避免「看起来还有活」）**

| 原计划项 | 结论 |
| --- | --- |
| `descriptor/tests.rs` 表自洽 | ✅ 已实现（`common/agent/descriptor.rs` 的 `tests`，含 id/source 唯一、转录根归属） |
| `templates/tests.rs` 校验 `prompt_hooks.field` | ⛔ 取消：三家字段名同为 `prompt`，改由「shim 不含原生事件名」+「hook 表与 descriptor 表双向一致」两条护栏守住 |
| qoder / codebuddy 真实样本夹具 | ✅ 已实现（`adapters/fixtures/*-real.jsonl` + `real_transcripts_still_resolve_a_human_title`） |
| 实现 `AgentDescriptor` | ✅ 已实现（`AGENTS` 表 + 9 个 adapter 读表 + dirs.rs re-export） |
| 修三源数据（qoder / codebuddy / 三家补 prompt 事件） | ✅ 已实现（qoder 委派 Claude 解析、codebuddy 自解析、`CLAUDE_COMPAT_ENTRIES` 加 `UserPromptSubmit`） |
| 收敛判据（`TitleCandidate` + 单一 admit） | ✅ 已实现（2026-11-10 收尾期补）：判据与 `TitleSource` 上移到 `common::agent::title`（conversation 不能依赖 live_sessions）；`ParsedMeta::title_candidates()` 给出候选，`resolve_title` 改走 `admit_candidates`；`conversation::normalize` 的 Title 目标与其专属净化（markdown 标记）一并迁入 `title/clean.rs`。变异验证：把 `resolve_title` 退回「自己挑第一条非空」→ `history_and_live_paths_share_one_verdict` 转红 |
| `cargo test` + 重装 hook | ✅ 已做（`cargo test --lib` 2696 绿；hook 按内容寻址标记在下次启动自动重装） |

### M2 · 漂移可发现（治理）— 主体已完成

- [x] 写红 + 实现：`prompt_event_names_the_session_without_peeking_at_history`
      （空缓存 + 带 prompt 的 `turn_started` 事件 → 标题 == prompt 首行、`has_user_input` 置位）
- [x] **确认「标题落库」原本已成立**：`set_title` 与权威事件两条路径都经 `finish` →
      `persist_entry` → `session_store`（`title` / `title_source` 列）。因此本里程碑不再新增列，
      只记下这条事实，避免后人重复实现一遍
- [x] `ScanReport` 增 `transcript_root` + `root_exists`；**根不存在时进 `errors` 并 `log::warn`**
      （此前安静返回 0 条 —— qoder 半年无人发现的直接机制）。前端 `ScanReport` 同步为 camelCase
- [x] 真实样本探针：`conversation/adapters/fixtures/{qoder,codebuddy,claude}-real.jsonl`
      + `real_transcripts_still_resolve_a_human_title`（`≥` 口径，断言不是兜底串、不含 harness 注入）
- [x] 变异验证：根不存在分支改回 `errors: Vec::new()` → `should_report_a_missing_scan_root_instead_of_failing_silently` 转红
- [ ] **登记未实施**：拒绝原因 top-N（`admit` 判负原因直方图）与设置页那一行展示
      —— `ScanReport` 已能表达「根在不在 / 扫到几条」，细分原因需要在标题热路径上挂收集器，
      属另一次结构性改动
- [ ] **登记未实施**：探针进 `tools/guards/checks/`（已以 Rust 单测形式落地、CI 会跑，
      但未接入护栏框架的 24 条清单）

### M3 · 收尾评审修复（2026-11-10，neeko-check 增量审核）

审核发现两类真缺陷（判据对了、输入与实现没跟上），修复如下：

- **净化崩溃（Block）**：`title::clean` 的手写隐藏块扫描器在 `to_lowercase()` 的字节索引上切
  原文 —— `İ` / `ẞ` 这类「小写展开改变字节数」的字符会 panic 或静默吃正文（实测
  `İİİİİİİİİİ <thinking>x</thinking>` 越界）。修法不是打补丁：词表与剥离实现下沉
  `common::agent::transcript_noise`（正则实现，索引天然安全），`normalize` 与 `title::clean`
  共用同一份，两份手抄与两份实现同时消失。
- **来源分类分叉（Block）**：hook 的 `prompt` 被统一记成 `Native`，与 spec §2/§3 及 design §3.1
  冲突 —— 同一句 `Can you please fix X` 在侧栏（Native，不剥包装）与历史列表（Prompt，剥成
  `fix X`）拿到两种判决。修法：`HookEvent.title_source` 由 shim 的**数据表**（字段 → 来源，
  零 per-CLI 分支）随文本上报，`project` 按它选来源；缺字段按 `Native`（旧 shim 语义）。
  顺带补上「prompt 是逐轮事件」的时序判据：先到者胜，后续 prompt 不改名。
- **契约/数据一致性**：`MAX_TITLE_CHARS` 移出 `mod.rs`（红线 9）；`pi` / `omp` 扩展目录改为由
  descriptor 派生；`descriptor` 去掉 `~` 假路径哨兵与两个无消费者的 `pub fn`；`resolve_title`
  兜底串复用 `placeholder_label`（消掉第二份 `[..8]` 字节切片）；Claude 系目录反解统一一份
  `adapters::shared::unsanitize_project_dir`；codebuddy 首条用户行先按 role 过滤（10MB 转录上
  不再逐行重包 JSON）；视图编号改两趟（`&str` 键，零 clone）；前端 `titleSource` / `ScanReport`
  文档与 mock 对齐 wire。
- **登记未实施（不变）**：拒绝原因 top-N、探针进护栏框架、hook-less CLI（gemini / grok /
  reasonix）的实时标题通道 —— 后者已写进 `session-title-domain.md` §3 的「已知缺口」。

验证：`cargo test --lib` 2712 绿；`pnpm lint` 40 条护栏通过；`pnpm vitest run`（改动相关 40 个
测试文件）285 绿。

## 4. 验证命令

```bash
pnpm check:quick                       # 收尾唯一门禁（静态检查 + 相关单测）
cargo test -p neeko live_sessions      # 红绿反馈时单独跑（观察，不是门禁）
cargo test -p neeko conversation
pnpm vitest related src/shared/selectors/liveSessionSelectors.ts
```

## 5. 风险与回滚

- **风险 1：放空标题门后侧栏噪声变多**（空 tab 被列出）。缓解：M0 只放「标题」这一个前提，
  保留 `hasUserInput` + 首轮结束；若实测仍有噪声，把 `placeholder_label` 的序号形态换成
  「项目名 · 时间」并在一轮内观察。
- **风险 2：`UserPromptSubmit` 在旧版 CLI 上不存在**。缓解：事件表按 descriptor 逐 CLI 声明，
  旧版就是少一条数据；缺失时退回 M2 的落库快照，不 panic。
- **风险 3：codebuddy 格式与实测样本不同（版本差异）**。缓解：CodebuddyLike 布局解析失败时
  健康度记一条拒绝原因，不静默；夹具取自用户真实文件。
- **回滚点**：M0 / M1 / M2 各一个 commit，可各自 revert；M1 的 descriptor 是新增模块，
  回滚不影响 M0。

## 6. 不做

- 不做 AI 生成标题（design D4）。
- 不恢复 OSC 标题通道。
- 不改终端/侧栏的视觉与布局。
- 不 backfill 历史索引（等下次扫描自然覆盖）。
- 不接管 Codex `hooks.json` 的信任哈希。

## 7. 收尾约定

- 完成后更新 `.trellis/spec/backend/conversation-adapter.md`（标题候选契约）与新增
  `.trellis/spec/backend/session-title-domain.md`（阶梯 + 判据 + descriptor 派生规则）。
- 本任务三个里程碑全部完成后一次性 archive（不拆子任务）。
- 会话日志用 `add_session.py` 记录，不自动提交代码。
