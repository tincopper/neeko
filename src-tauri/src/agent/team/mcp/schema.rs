//! MCP 工具清单 —— **单一源**（design §4.2）。
//!
//! 工具的名字、名字的字面量、描述、入参 Schema 全部只在这里出现一次：
//! 路由注册（P2 的 axum 组）、stdio bridge（`neeko-team-mcp.mjs`）、授权矩阵、
//! dispatch 的入参校验都必须从这里取，禁止各自硬编码（红线 5 的同族问题）。
//!
//! # 为什么 Schema 存成字符串字面量而不是 `serde_json::Value`
//!
//! `Value` 不是 `const` 可构造的，用 `Lazy`/`OnceLock` 会把「工具清单」变成运行期才
//! 存在的表 —— 那样连「变体是否被清单覆盖」这种编译期就能问的问题都要靠测试兜。
//! 代价是字面量可能写坏，所以有一条**逐条 `serde_json::from_str` 解析**的护栏测试
//! （`every_input_schema_parses_as_a_json_object`）代替类型系统。

use crate::agent::team::types::TeamTaskState;

/// 工具名（编译期闭集）。
///
/// 新增变体会让 `tools_cover_every_tool_name_exactly_once` 直接红 —— 这也是
/// `TOOLS` 与 `ALL_TOOL_NAMES` 必须同时维护的原因（两份清单不一致是唯一能
/// 让「工具存在但不可调用」的静默缺陷）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ToolName {
    /// 读团队状态（成员 + 板摘要）。
    TeamStatus,
    /// 列**这台机器上**的全部团队（跨队只读；重启后重开自己的队靠它）。
    TeamList,
    /// 读**这个队**的可选项：允许谁当成员、还能加几个、缺省值是什么（只读）。
    TeamOptions,
    /// 建成员（P2.5a：准入 + 落库，返回 `MemberCreated`；起进程在 2.5b）。
    TeamSpawn,
    /// 队内消息。
    TeamSend,
    /// 派活。
    TaskCreate,
    /// 认领任务。
    TaskClaim,
    /// 更新任务状态。
    TaskUpdate,
    /// 读任务板。
    TaskList,
    /// **后端阻塞**地等（P2.4）。
    TeamWait,
    /// 协商式关机。
    TeamClose,
}

/// 全部工具名（**遍历用**：护栏测试逐个断言恰好出现一次）。
///
/// 与 [`TOOLS`] 故意分成两份而不是由 `TOOLS` 派生：只有「两份独立清单」才能让
/// 「新增变体却忘了登记」变成测试失败，而不是被派生逻辑自动吞掉。
pub const ALL_TOOL_NAMES: [ToolName; 11] = [
    ToolName::TeamStatus,
    ToolName::TeamList,
    ToolName::TeamOptions,
    ToolName::TeamSpawn,
    ToolName::TeamSend,
    ToolName::TaskCreate,
    ToolName::TaskClaim,
    ToolName::TaskUpdate,
    ToolName::TaskList,
    ToolName::TeamWait,
    ToolName::TeamClose,
];

/// 一条工具的完整规格。
pub struct ToolSpec {
    /// 编译期身份（内部 match 用）。
    pub name: ToolName,
    /// wire 名（MCP 里传递的字面量，snake_case）。**改名即改协议**。
    pub wire: &'static str,
    /// 一句话描述（会出现在 MCP 的工具描述里，写给**模型**看）。
    pub summary: &'static str,
    /// 入参 JSON Schema（紧凑字面量，保持小到能塞进每次工具列表刷新）。
    pub input_schema: &'static str,
}

/// 工具清单 —— **恰好 11 条**，与 [`ALL_TOOL_NAMES`] 一一对应
/// （design §4.2 的 9 条 + `team_options` + `team_list`）。
///
/// `input_schema` 只声明本层**真的会读**的字段：Schema 里写一个 dispatch 不校验的参数，
/// 就是向模型声明一个「传了也没用」的能力（红线 14 的同族违规）。
///
/// `team_spawn` 随 P2.5a 进表：它的**决策部分**（三档准入、成员落库）已经在本层实现，
/// `MemberCreated` 把「起 PTY / 注入 env / 写 MCP 配置」留给 2.5b 的接线段 ——
/// 声明与实现同 diff，所以不再是「调了会失败的能力」。
///
/// 注意 `team_spawn` 的入参**没有** `prompt` / `channel`：
///
/// - 派活走任务板（`task_create`），不是在 spawn 时塞一段 prompt；
/// - 档位与通道由准入表推导，**调用方不可声明**（design §4.4），所以连参数都不给。
pub static TOOLS: &[ToolSpec] = &[
    ToolSpec {
        name: ToolName::TeamStatus,
        wire: "team_status",
        summary: "Read the team roster and a board summary (id/name/state/lease only, no transcripts).",
        input_schema: r#"{"type":"object","properties":{},"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TeamList,
        wire: "team_list",
        summary: "List the teams on this machine (id/name/state/root/member+task counts) so an existing team can be reopened after a restart. Read-only and cross-team.",
        input_schema: r#"{"type":"object","properties":{},"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TeamOptions,
        wire: "team_options",
        summary: "Read this team's spawn options: which CLIs may become members, how many more fit, and the defaults a spawn would inherit.",
        input_schema: r#"{"type":"object","properties":{},"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TeamSpawn,
        wire: "team_spawn",
        summary: "Add one worker member (lead only). Returns the new member id, its derived admission tier and any capability that is still unverified.",
        input_schema: r#"{"type":"object","properties":{"agent_id":{"type":"string","minLength":1},"name":{"type":"string","minLength":1},"workspace":{"type":"object","properties":{"kind":{"type":"string","enum":["shared","read_only","worktree"]},"path":{"type":"string","minLength":1}},"required":["kind"],"additionalProperties":false},"approval_policy":{"type":"string","enum":["interactive","queue","bypass"]},"model":{"type":"string","minLength":1},"persona":{"type":"string","minLength":1}},"required":["agent_id","name"],"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TeamSend,
        wire: "team_send",
        summary: "Send a message to one member of this team. Fails with target_blocked when that member is waiting for a human.",
        input_schema: r#"{"type":"object","properties":{"to":{"type":"string","minLength":1},"message":{"type":"string","minLength":1}},"required":["to","message"],"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TaskCreate,
        wire: "task_create",
        summary: "Create a task on the shared board (lead only). `assignee` is REQUIRED: name the member who should do it (\"<name>@<team_id>\"); the member may still be only planned. It does not claim the task for them.",
        input_schema: r#"{"type":"object","properties":{"title":{"type":"string","minLength":1},"body":{"type":"string","minLength":1},"workspace":{"type":"string","enum":["shared","read_only"]},"depends_on":{"type":"array","items":{"type":"string","minLength":1}},"lease_ttl":{"type":"integer","minimum":1},"assignee":{"type":"string","minLength":1}},"required":["title","body","assignee"],"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TaskClaim,
        wire: "task_claim",
        summary: "Claim a pending task; returns the task with you as its owner.",
        input_schema: r#"{"type":"object","properties":{"task_id":{"type":"string","minLength":1}},"required":["task_id"],"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TaskUpdate,
        wire: "task_update",
        summary: "Declare progress on a task you own: done, failed, or blocked.",
        input_schema: r#"{"type":"object","properties":{"task_id":{"type":"string","minLength":1},"state":{"type":"string","enum":["done","failed","blocked"]},"summary":{"type":"string"}},"required":["task_id","state"],"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TaskList,
        wire: "task_list",
        summary: "List the task board, optionally filtered by state.",
        input_schema: r#"{"type":"object","properties":{"state":{"type":"string","enum":["pending","claimed","in_progress","awaiting_approval","done","failed","blocked","proposed"]}},"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TeamWait,
        wire: "team_wait",
        summary: "Block until the members you name are done/idle, or the tasks you name settle. Returns a small snapshot; timing out is a result, not an error.",
        input_schema: r#"{"type":"object","properties":{"on":{"type":"object","properties":{"members":{"type":"array","items":{"type":"string","minLength":1}},"tasks":{"type":"array","items":{"type":"string","minLength":1}}},"additionalProperties":false},"until":{"type":"string","enum":["declared","idle","any"]},"timeout_s":{"type":"integer","minimum":1,"maximum":1800}},"required":["on"],"additionalProperties":false}"#,
    },
    ToolSpec {
        name: ToolName::TeamClose,
        wire: "team_close",
        summary: "Request a graceful shutdown of one member (lead only); the caller performs the shutdown.",
        input_schema: r#"{"type":"object","properties":{"member_id":{"type":"string","minLength":1},"graceful":{"type":"boolean"}},"additionalProperties":false}"#,
    },
];

/// 按编译期身份取规格。
///
/// panic 的前提是「`TOOLS` 漏了某个变体」，而这正是
/// `tools_cover_every_tool_name_exactly_once` 拦的那条缺陷 —— 有测试兜底，
/// 所以这里用 `expect` 而不是返回 `Option`（让调用方的 match 保持穷尽可读）。
#[must_use]
pub fn spec_for(name: ToolName) -> &'static ToolSpec {
    match TOOLS.iter().find(|spec| spec.name == name) {
        Some(spec) => spec,
        // 不可达：`tools_cover_every_tool_name_exactly_once` 保证 `TOOLS` 覆盖全部变体。
        // 用 `panic!` 而不是 `expect` —— 后者在本仓是 deny（生产码禁止对 `Option` 断言）。
        None => panic!("TOOLS 必须覆盖每一个 ToolName 变体，缺少 {name:?}"),
    }
}

/// 按 wire 名查工具（未知 wire 返回 `None`，由 dispatch 翻译成 `NotFound`）。
#[must_use]
pub fn lookup(wire: &str) -> Option<ToolName> {
    TOOLS
        .iter()
        .find(|spec| spec.wire == wire)
        .map(|spec| spec.name)
}

/// 已知 wire 名的可读列表（给 `NotFound` 的错误信息用）。
#[must_use]
pub fn known_wires() -> String {
    TOOLS
        .iter()
        .map(|spec| spec.wire)
        .collect::<Vec<_>>()
        .join(", ")
}

/// `task_update` 允许外部写入的任务状态 —— **工具层的能力边界**。
///
/// 与 `TeamTaskState` 的 8 个变体刻意不同：`pending` / `claimed` / `in_progress` /
/// `awaiting_approval` / `proposed` 是系统迁移或队长路径产出的内部态，工具直接写会
/// 绕过状态机（`blocked` 名义上可写，但冻结的真正裁决在 manager/lease —— 见
/// `dispatch::parse_updatable_state` 的说明）。
pub const UPDATABLE_STATES: [TeamTaskState; 3] = [
    TeamTaskState::Done,
    TeamTaskState::Failed,
    TeamTaskState::Blocked,
];

#[cfg(test)]
mod tests {
    use super::*;

    /// 护栏：`TOOLS` 与 `ALL_TOOL_NAMES` 必须一一对应（长度 + 每个变体恰好一次）。
    ///
    /// 保护的不变量：「清单里的工具都能被调用，能调用的工具都在清单里」。
    /// 漏登记 = 那个工具的授权格 / Schema 全部失效，而它仍然可被 wire 名调到。
    #[test]
    fn tools_cover_every_tool_name_exactly_once() {
        assert_eq!(
            TOOLS.len(),
            ALL_TOOL_NAMES.len(),
            "TOOLS 必须与 ToolName 变体数相同"
        );
        for name in ALL_TOOL_NAMES {
            let hits = TOOLS.iter().filter(|spec| spec.name == name).count();
            assert_eq!(hits, 1, "{name:?} 必须恰好出现一次，实际 {hits} 次");
        }
    }

    /// 护栏：wire 名唯一、非空、snake_case。
    ///
    /// 保护的不变量：wire 名是**协议**（CLI 的 MCP 配置 + bridge 脚本都按它匹配）。
    /// 重复或大小写混排会造成「工具存在但模型永远调不到」。
    #[test]
    fn wire_names_are_unique_non_empty_snake_case() {
        let mut seen = std::collections::BTreeSet::new();
        for spec in TOOLS {
            let wire = spec.wire;
            assert!(!wire.is_empty(), "{:?} 的 wire 名不得为空", spec.name);
            assert!(seen.insert(wire), "wire 名重复：{wire}");
            assert!(
                wire.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "{wire} 不是 snake_case"
            );
            assert!(
                !wire.starts_with('_') && !wire.ends_with('_'),
                "{wire} 不得以下划线开头或结尾"
            );
            assert!(!spec.summary.is_empty(), "{wire} 的 summary 不得为空");
        }
    }

    /// 护栏：每个 `input_schema` 都必须能被解析成 JSON **object**。
    ///
    /// 保护的不变量：字面量写坏 = MCP 客户端在工具列表刷新时整批拒绝，
    /// 现象是「所有团队工具凭空消失」。这条测试把那个失败提前到 `cargo test`。
    #[test]
    fn every_input_schema_parses_as_a_json_object() {
        for spec in TOOLS {
            let value: serde_json::Value = serde_json::from_str(spec.input_schema)
                .unwrap_or_else(|e| panic!("{} 的 input_schema 不是合法 JSON：{e}", spec.wire));
            assert!(
                value.is_object(),
                "{} 的 input_schema 必须是 object",
                spec.wire
            );
            assert_eq!(
                value.get("type").and_then(|t| t.as_str()),
                Some("object"),
                "{} 的 input_schema 必须声明 type=object",
                spec.wire
            );
        }
    }

    /// §4.2 一致性：9 条工具**全部**在清单里（含 `team_spawn`）。
    ///
    /// 这条测试的前身断言 `team_spawn` **缺席**（P2.1/P2.4 期间：提前登记 = 向模型
    /// 声明一个「调了会失败」的能力，红线 14 的同族违规）。P2.5a 把它的决策部分
    /// 落地了（准入表 + 成员落库），所以护栏**翻转**：现在缺了它才是
    /// 缺陷 —— 「工具存在但不可调用」与「能力已落地但清单里没有」同样致命。
    ///
    /// 真正起进程的那一步（PTY/env 注入）仍是 P2.5b，但那是**执行**，不是能力声明：
    /// `team_spawn` 返回 `MemberCreated`（成员已落库）而非「进程已就绪」。
    #[test]
    fn every_documented_tool_is_in_the_catalogue_including_team_spawn() {
        for wire in [
            "team_status",
            "team_list",
            "team_spawn",
            "team_send",
            "task_create",
            "task_claim",
            "task_update",
            "task_list",
            "team_wait",
            "team_close",
        ] {
            assert!(lookup(wire).is_some(), "{wire} 必须可查");
        }
        assert_eq!(
            TOOLS.len(),
            11,
            "design §4.2 的 9 条 + `team_options`（团队组成配置的只读面）+ `team_list`\
             （重启后重开自己的队 / 关队前的清点）"
        );
        assert_eq!(lookup("team_spawn"), Some(ToolName::TeamSpawn));
        // 反向：清单里不得有形如 `team_*` 的遗留别名（wire 名是协议）。
        assert!(lookup("spawn").is_none(), "wire 名只能是 team_spawn");
    }

    /// `team_spawn` 的入参 Schema 必须与 dispatch 真的会读的字段逐字对齐（红线 14）。
    ///
    /// 保护的不变量：Schema 里多一个 `prompt` 而 dispatch 不读，就是向模型声明
    /// 「传了也没用」；少一个 `workspace` 则会让成员静默落到共享 cwd（同 cwd 多成员
    /// ⇒ 归因只能靠 env，design §5.4）。
    ///
    /// `workspace` 从 `required` 移到可选是**方案 C 的一部分**：缺省值来自团队配置
    /// （`Team.default_workspace`），而不是「不传 = shared」这种常量。它的 shape
    /// （对象 + `kind` + `path`）一个字段都没变。
    #[test]
    fn team_spawn_schema_matches_the_documented_shape() {
        let spec = spec_for(ToolName::TeamSpawn);
        assert_eq!(spec.wire, "team_spawn");
        let schema: serde_json::Value = serde_json::from_str(spec.input_schema).unwrap();

        // `workspace` **不在** required 里（团队配置按方案 C）：它在缺省时取团队的
        // `default_workspace`，所以「必须传」既不必要也会让队长多写一次它不知道的值。
        // `agent_id` / `name` 仍是必填：一个是「选谁」（池子校验的输入），一个是成员 id 的
        // 前半段（`{name}@{team}`，落库前 sanitize）。
        assert_eq!(schema["required"], serde_json::json!(["agent_id", "name"]));
        assert_eq!(schema["additionalProperties"], serde_json::json!(false));

        let properties = schema["properties"]
            .as_object()
            .expect("team_spawn 必须有 properties");
        let mut declared: Vec<&str> = properties.keys().map(String::as_str).collect();
        declared.sort_unstable();
        // 只有这 6 个参数：多一个都是「传了也没用」的声明。
        assert_eq!(
            declared,
            [
                "agent_id",
                "approval_policy",
                "model",
                "name",
                "persona",
                "workspace"
            ]
        );

        assert_eq!(
            properties["approval_policy"]["enum"],
            serde_json::json!(["interactive", "queue", "bypass"]),
            "approval_policy 的 enum 必须与 `ApprovalPolicy` 的 snake_case 口径一致"
        );
        assert_eq!(
            properties["workspace"]["required"],
            serde_json::json!(["kind"])
        );
        assert_eq!(
            properties["workspace"]["properties"]["kind"]["enum"],
            serde_json::json!(["shared", "read_only", "worktree"])
        );
        assert_eq!(
            properties["workspace"]["additionalProperties"],
            serde_json::json!(false)
        );
    }

    /// `task_create` 的入参 Schema 必须与 dispatch **真的会读**的字段逐字对齐（红线 14）。
    ///
    /// `assignee` 是 v24 引入、第 3 轮起**必填**的参数：写在 Schema 里而 `dispatch::create`
    /// 不读，就是向模型声明一个「传了也没用」的能力（而它看起来像已经把活派出去了）；
    /// 反过来只有代码不声明，队长永远不知道可以用它。两边同 diff 才算兑现。
    #[test]
    fn task_create_schema_matches_the_documented_shape() {
        let spec = spec_for(ToolName::TaskCreate);
        assert_eq!(spec.wire, "task_create");
        let schema: serde_json::Value = serde_json::from_str(spec.input_schema).unwrap();

        // `assignee` 在 required 里：参与人数由任务板上的指派决定，没有指派的任务
        // 无法为任何人提供 spawn 的依据（见 `dispatch::tests::spawn_requires_an_assignment`）。
        assert_eq!(
            schema["required"],
            serde_json::json!(["title", "body", "assignee"])
        );
        assert_eq!(schema["additionalProperties"], serde_json::json!(false));

        let properties = schema["properties"]
            .as_object()
            .expect("task_create 必须有 properties");
        let mut declared: Vec<&str> = properties.keys().map(String::as_str).collect();
        declared.sort_unstable();
        // 只有这 6 个参数：多一个都是「传了也没用」的声明。
        assert_eq!(
            declared,
            [
                "assignee",
                "body",
                "depends_on",
                "lease_ttl",
                "title",
                "workspace"
            ]
        );
        assert_eq!(
            properties["assignee"],
            serde_json::json!({"type": "string", "minLength": 1}),
            "assignee 是成员 id（`name@team_id`），空串不是合法寻址"
        );
    }

    /// `team_wait` 的入参 Schema 必须与「实现真的会读的字段」逐字对齐（红线 14）。
    ///
    /// 保护的不变量：`until` 的 enum 与 [`crate::agent::team::wait::WAIT_UNTILS`] 同源 ——
    /// 两处各写一份的话，schema 里多一个 `finished` 会让模型反复试一个必被拒的值，
    /// 少一个 `declared` 则让队长无法表达「等真完成」。
    #[test]
    fn team_wait_schema_matches_the_documented_shape() {
        let spec = spec_for(ToolName::TeamWait);
        assert_eq!(spec.wire, "team_wait");
        let schema: serde_json::Value = serde_json::from_str(spec.input_schema).unwrap();

        let declared: Vec<&str> = schema["properties"]["until"]["enum"]
            .as_array()
            .expect("team_wait 必须有 until.enum")
            .iter()
            .filter_map(|value| value.as_str())
            .collect();
        let expected: Vec<&str> = crate::agent::team::wait::WAIT_UNTILS
            .iter()
            .map(|until| until.wire())
            .collect();
        assert_eq!(declared, expected);

        // `on` 是唯一必填项；members / tasks 二选一（dispatch 对「同时给」直接拒绝）。
        assert_eq!(schema["required"], serde_json::json!(["on"]));
        assert_eq!(schema["additionalProperties"], serde_json::json!(false));
        assert_eq!(
            schema["properties"]["on"]["additionalProperties"],
            serde_json::json!(false)
        );
        assert_eq!(
            schema["properties"]["timeout_s"]["maximum"],
            serde_json::json!(1800),
            "timeout_s 上限是 30 分钟（dispatch 会把超出的值截到上限，不报错）"
        );
        assert_eq!(
            schema["properties"]["timeout_s"]["minimum"],
            serde_json::json!(1)
        );
    }

    /// `lookup` 与 `spec_for` 必须互逆（含 wire 字面量本身）。
    #[test]
    fn lookup_and_spec_for_are_inverse() {
        for name in ALL_TOOL_NAMES {
            let spec = spec_for(name);
            assert_eq!(spec.name, name);
            assert_eq!(lookup(spec.wire), Some(name), "{} 反查失败", spec.wire);
        }
        // 未知 wire 一律 None（大小写不同也算未知：协议不做大小写折叠）。
        assert_eq!(lookup("team_Status"), None);
        assert_eq!(lookup(""), None);
        // wire 字面量钉死：改名会让 CLI 侧 MCP 配置里的工具名对不上。
        assert_eq!(spec_for(ToolName::TeamStatus).wire, "team_status");
        assert_eq!(spec_for(ToolName::TeamList).wire, "team_list");
        assert_eq!(spec_for(ToolName::TeamSpawn).wire, "team_spawn");
        assert_eq!(spec_for(ToolName::TeamSend).wire, "team_send");
        assert_eq!(spec_for(ToolName::TaskCreate).wire, "task_create");
        assert_eq!(spec_for(ToolName::TaskClaim).wire, "task_claim");
        assert_eq!(spec_for(ToolName::TaskUpdate).wire, "task_update");
        assert_eq!(spec_for(ToolName::TaskList).wire, "task_list");
        assert_eq!(spec_for(ToolName::TeamWait).wire, "team_wait");
        assert_eq!(spec_for(ToolName::TeamClose).wire, "team_close");
    }

    /// `task_update` 的 state 枚举必须与 [`UPDATABLE_STATES`] 逐字对齐（同源）。
    ///
    /// 保护的不变量：Schema 里多写一个 `in_progress` 会让模型反复试一个必被拒的值，
    /// 少写一个 `failed` 则让成员永远报不上失败。枚举值走 serde 的 snake_case
    /// （`types::tests::enum_wire_names_are_the_documented_snake_case` 已钉住）。
    #[test]
    fn task_update_state_enum_matches_the_updatable_states() {
        let spec = spec_for(ToolName::TaskUpdate);
        let schema: serde_json::Value = serde_json::from_str(spec.input_schema).unwrap();
        let values = schema["properties"]["state"]["enum"]
            .as_array()
            .expect("task_update 必须有 state.enum");
        let declared: Vec<&str> = values.iter().filter_map(|v| v.as_str()).collect();
        let expected: Vec<String> = UPDATABLE_STATES
            .iter()
            .map(|s| {
                serde_json::to_value(s)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        let expected: Vec<&str> = expected.iter().map(String::as_str).collect();
        assert_eq!(declared, expected);
    }
}
