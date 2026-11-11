//! 受管模板的**契约锚点测试**：`include_str!` 嵌入的模板正文必须含关键行为锚点。
//!
//! # 为什么在 `templates/` 而不是 `writers/`
//!
//! 这些断言的对象是**模板正文内容**（坐标扫描、token 头、loopback、事件注册形态），
//! 与「文件怎么落盘、怎么合并用户配置」毫无关系。此前它们住在 `writers/tests.rs`，
//! 使得「改 writers 的落盘逻辑」要读 177 行模板断言才能找到相关用例 —— 归属错位
//! 的直接代价是读者的检索成本。
//!
//! 断言一律引用**常量本身**（`endpoint::ENDPOINTS_DIR_NAME` / `validation::TOKEN_HEADER` …）
//! 而非复写字面量：任一侧改名，测试立刻红。

use crate::agent::hooks::targets::{InstallShape, HOOK_TARGETS};

/// 模板正文的**行尾归一化视图**（`\r\n` → `\n`；已是 LF 时零拷贝）。
///
/// `include_str!` 嵌入的是**宿主工作区的字节**：Windows 上 `core.autocrlf=true` 的 checkout
/// 把模板落成 CRLF，于是「跨行契约锚点」里的 `\n` 永远匹配不上 —— 本地（LF）绿、CI（CRLF）红。
/// 2026-11-05 实测：`templates_gate_child_sessions_at_a_single_registration_point` 在
/// `windows-latest` 报「pi 模板的 onStatus 包装器缺子会话门」，而模板正文一字不差。
///
/// 红线 11 的边界正是这条：断言**文本内容**可以，赌**工作区换行**不行。
/// `.gitattributes` 同时把 `templates/` 钉成 `eol=lf`（嵌入二进制的字节三端一致）——
/// 这里是第二道：断言不依赖 clone 的换行状态（旧 clone / 编辑器改写也能过）。
fn template_text(template: &str) -> std::borrow::Cow<'_, str> {
    if template.contains("\r\n") {
        std::borrow::Cow::Owned(template.replace("\r\n", "\n"))
    } else {
        std::borrow::Cow::Borrowed(template)
    }
}

/// 会话身份的 env 键是**双端契约**：PTY 侧注入（`live_sessions::SESSION_ID_ENV`）、
/// 模板侧读取。任一侧改名都会让 hook 归因静默失效（表现是「侧栏标题不再跟随 CLI」），
/// 故断言模板正文含**常量本身**而不是复写字面量。
#[test]
fn embedded_templates_read_the_session_id_env_key() {
    for target in HOOK_TARGETS {
        if target.shapes.is_empty() {
            continue; // 自供源的上报代码在 CLI 自己的插件里（同上方用例的理由）
        }
        let read = format!("process.env.{}", crate::live_sessions::SESSION_ID_ENV);
        assert!(
            target.template.contains(&read),
            "{} 模板未读取会话身份 {read:?}（hook 归因会静默失效）",
            target.source
        );
    }
}

/// 模板自校验：每个受管 CLI 的嵌入模板必须含坐标目录扫描、token 头与 loopback 锚点
/// （防手改丢关键行为）。断言引用**常量本身** —— 任一侧改名，测试立刻红。
#[test]
fn embedded_templates_keep_contract_anchors() {
    use crate::agent::hooks::ingest::endpoint;
    use crate::agent::hooks::ingest::validation;
    for target in HOOK_TARGETS {
        // **自供源没有 Neeko 嵌入的模板** —— 上报代码在 CLI 自己的插件里
        // （DSH 的是 `packages/dsh-neeko/src/notify-*.ts`，由它的 `prepublishOnly` 门禁）。
        // 这里对它断言「模板含锚点」永远不可能成立，故跳过；它的契约由
        // `targets/tests.rs::self_supplied_sources_are_not_installable` 钉住。
        if target.shapes.is_empty() {
            continue;
        }
        // Structured 行共用 shim 模板，其锚点由下方 `report_shim_keeps_contract_anchors`
        // 单独钉死（避免同一断言重复两次）。
        if target
            .shapes
            .iter()
            .any(|s| matches!(s, InstallShape::Structured { .. }))
        {
            continue;
        }
        for anchor in [
            // v5 多实例：坐标是目录扫描（不是单文件），扫描 + fan-out 是两个独立失活面。
            endpoint::ENDPOINTS_DIR_NAME,
            "readdirSync",
            "Promise.allSettled",
            endpoint::ENV_KEY_PORT,
            endpoint::ENV_KEY_TOKEN,
            validation::TOKEN_HEADER,
            "127.0.0.1",
        ] {
            assert!(
                target.template.contains(anchor),
                "{} 模板缺少契约锚点 {anchor:?}（坐标目录扫描 / fan-out / token / loopback）",
                target.source
            );
        }
        // 单文件覆盖保留（调试/夹具）：env 键名是双端契约，丢了会静默退回目录扫描。
        // 断言带 `||` 的**读取形态**而非裸键名 —— 裸键名是 plural 目录键
        // （`NEEKO_AGENT_HOOK_ENDPOINTS_DIR`）的子串，会被后者替身通过（非承重锚点）。
        let override_read = format!("{} ||", endpoint::ENV_KEY_OVERRIDE);
        assert!(
            target.template.contains(&override_read),
            "{} 模板缺少单文件覆盖读取 {override_read:?}",
            target.source
        );
        // 主题上报（R7.5）：双模板都必须带 title 字段，否则副标题整条链静默失效。
        assert!(
            target.template.contains("title:"),
            "{} 模板未上报 title（会话主题链路断裂）",
            target.source
        );
    }
    // 主题的**原生来源**各 CLI 不同，锚点分别钉死：opencode 靠 created/execution 携带
    // 的 title + 上报时的 session.get 懒回查（2.x 无 session.updated，标题后到只能现取）；
    // pi / OMP 靠 session_info 命名 + 首条用户消息回退。
    let opencode = HOOK_TARGETS
        .iter()
        .find(|t| t.source == "opencode")
        .expect("opencode target");
    assert!(
        opencode.template.contains("session.execution"),
        "opencode 模板缺少 session.execution 订阅（2.x 生命周期，任务完成通知断流）"
    );
    // 「等待用户行动」在 opencode 2.x 走权限门（permission.asked，2.0.28 二进制仍在发射）；
    // V1 的 question.asked 在 2.x 无对应事件（ask 阻塞走权限族统一上报）。
    assert!(
        opencode.template.contains("permission.asked"),
        "opencode 模板缺少 permission.asked 订阅（等待用户行动的通知会静默丢失）"
    );
    for source in ["pi", "omp"] {
        let t = HOOK_TARGETS
            .iter()
            .find(|t| t.source == source)
            .unwrap_or_else(|| panic!("{source} target"));
        for anchor in ["getSessionName", "getEntries"] {
            assert!(
                t.template.contains(anchor),
                "{source} 模板缺少主题锚点 {anchor:?}（原生名 / 首条用户消息回退）"
            );
        }
    }
    // pi 的 ui_prompt_start 载荷只有 `{kind, title?}`（无 text/message）：
    // 缺 kind/title 读取时 detail 恒为 null，通知正文退化成类别兜底。
    // OMP 无此事件（spike U1），故只对 pi 断言。
    let pi = HOOK_TARGETS
        .iter()
        .find(|t| t.source == "pi")
        .expect("pi target");
    for anchor in ["ui_prompt_start", "event.title", "event.kind"] {
        assert!(
            pi.template.contains(anchor),
            "pi 模板缺少 {anchor:?}（等待输入的详情会静默丢失）"
        );
    }
}

/// 会话来源门 + 完成腿判据（两个模板都必须有）。
///
/// # 为什么这是承重锚点（2026-11-06 实测事故）
///
/// `pi-subagents` 用 `createAgentSession` + `bindExtensions` 在**同一个 pi 进程内**起子 agent，
/// agent 定义默认 `extensions: true` ⇒ 本扩展被继承加载。而 `NEEKO_SESSION_ID` 由 Neeko 注入
/// **PTY 进程级** env，子会话继承同一个值 ⇒ 子 agent 的完成事件带着**父会话 id**到达服务端，
/// `report_authoritative` 把父会话判成 `Ready` 并置位权威门，之后的字节推断被永久吞掉。
/// 表现：**子 agent 还在跑，侧栏已显示完成**；同时父行的 `native_session_id`（first-writer-wins）
/// 与标题被写成子会话的。
///
/// 完成腿是同一形态的另一半：`agent_end` 在重试 / 压缩 / 队列续跑时会先发一次，只有
/// `agent_settled`（pi）与 `agent_end.willContinue === true`（OMP）才是稳定判据。
///
/// # 为什么判据是「`pi.on` 只出现一次」而不是「每个 handler 都有门」
///
/// 初版写成每个 `pi.on` 自己加 `isChildSession` 门，变异验证立刻暴露问题：删掉任意一处门，
/// 本用例仍全绿 —— `contains` 数不清「第 N 个 handler 漏了」。而「第 N 个 handler 忘加门」
/// 的表现正是**静默污染父会话**（无报错、无日志），与本次事故同形。
/// 收敛成单个 `onStatus` 包装后，漏门在模板里**根本表达不出来**：`pi.on` 只允许出现一次。
///
/// 反证：把任一模板里的 `onStatus("…"` 改回 `pi.on("…"`（或删掉 `isChildSession`），
/// 本用例必红。
#[test]
fn templates_gate_child_sessions_at_a_single_registration_point() {
    for source in ["pi", "omp"] {
        let t = HOOK_TARGETS
            .iter()
            .find(|t| t.source == source)
            .unwrap_or_else(|| panic!("{source} target"));
        // 跨行锚点必须看归一化视图：工作区换行由 checkout 决定，不得进判据（红线 11）。
        let template = template_text(t.template);
        // ① 来源门：读 sessionManager 的 header.parentSession。
        for anchor in ["getHeader", "parentSession", "onStatus"] {
            assert!(
                template.contains(anchor),
                "{source} 模板缺少 {anchor:?}（子会话上报会污染父会话的状态与标题）"
            );
        }
        // ①b 门必须**在包装器内**。取连续形态而非裸名：`isChildSession(ctx)` 也出现在
        // 函数定义里，裸名会被「函数还在、门被删」的实现替身通过（变异实测：删掉门 0 红）。
        assert!(
            template
                .contains("if (isChildSession(ctx)) return;\n      return handler(event, ctx);"),
            "{source} 模板的 onStatus 包装器缺子会话门（子 agent 的完成事件会挂到父会话 id 上）"
        );
        // ② 门必须只在一处：`pi.on` 的注册点唯一（否则新加 handler 会绕过门）。
        assert_eq!(
            template.matches("pi.on(").count(),
            1,
            "{source} 模板出现多个 `pi.on(` 注册点（新 handler 会绕过子会话门；\
             改用 onStatus 包装）"
        );
        // ③ 每个事件都经 onStatus 注册（判据取注册形态，不取裸事件名）。
        for event in ["session_start", "agent_end", "tool_call"] {
            let registered = format!("onStatus(\"{event}\"");
            assert!(
                template.contains(&registered),
                "{source} 模板的 {event} 未经 onStatus 注册（子会话会上报该事件）"
            );
        }
        // ④ 稳定终点：两个模板都注册 agent_settled，并把 agent_end 降为兼容腿。
        // 取**连续形态**而非裸名：`settledSupported` 也在赋值处出现，裸名会被
        // 「声明还在、早退被删」的实现替身通过（变异实测：删掉早退 0 红）。
        assert!(
            template.contains("onStatus(\"agent_settled\""),
            "{source} 模板未注册 agent_settled（完成腿会在重试 / 压缩中途误报）"
        );
        assert!(
            template.contains("    if (settledSupported) return;\n"),
            "{source} 模板的 agent_end 未让位给 agent_settled（重试中间那次会先报完成）"
        );
    }
    // pi 额外注册 ui_prompt_start；OMP 无此事件（spike U1）故不要求。
    let pi = HOOK_TARGETS
        .iter()
        .find(|t| t.source == "pi")
        .expect("pi target");
    assert!(
        pi.template.contains("onStatus(\"ui_prompt_start\""),
        "pi 模板的 ui_prompt_start 未经 onStatus 注册（子会话会上报该事件）"
    );
    // OMP 无 agent_settled（18.14.1 二进制 0 命中），完成腿只能靠 willContinue。
    // 取**连续形态**而非裸名：`willContinue` 也出现在注释里，裸名会被注释替身通过
    // （变异实测：删掉判据 0 红）。
    let omp = HOOK_TARGETS
        .iter()
        .find(|t| t.source == "omp")
        .expect("omp target");
    assert!(
        omp.template
            .contains("if (event && event.willContinue === true) return;"),
        "OMP 模板缺 willContinue 判据（重试 / 压缩中间那次 agent_end 会先报完成）"
    );
}

/// 子会话门的**第二条判据**：拿不到 `parentSession` 的进程内子会话也不得冒充父会话。
///
/// # 事故形态（第 39 轮的残留口子）
///
/// `@tintinweb/pi-subagents@0.23.2` 的 `agent-runner.js`：
/// `persistSession = agentConfig?.persistSession ?? (options.nested ? false : rememberAgents)`，
/// 而 `nested: options.parentAgentId !== undefined`（`agent-manager.js` 的 spawn 入参）。
/// 为 false 时子会话走 `SessionManager.inMemory(cwd)` —— **不传 options**，所以 header 里
/// 没有 `parentSession`（header 的该字段只在 `create` / `forkFrom` 的 options 里取值），
/// 第一条判据因此失明；同一条记录又被 `isTopLevelAgent`（`parentAgentId !== undefined`）
/// 从花名册里滤掉 ⇒ **两道防线同时失效**，子 agent 的 `agent_settled` 直接落到父会话
/// ⇒ `report_authoritative` 把父会话判成 `Ready` 并置位权威门 ⇒「主 agent 还在跑，侧栏已退出」。
///
/// inMemory 的会话**没有会话文件**，这是唯一还剩下的可判事实：Neeko 以 `pi --mode rpc`
/// 启动（`pi_rpc/process.rs::launch_args`，不带 `--no-session`），用户可见的根会话必有文件。
///
/// # 为什么判据必须带能力检测
///
/// OMP / 旧 CLI 的 `sessionManager` 未必暴露 `getSessionFile`。此时「无文件」恒成立会把
/// **根会话**判成子会话 ⇒ 整条上报消失 ⇒ 会话永远停在 Running。所以能力缺失时退回第一条
/// 判据（`false`），宁可漏挡也不误挡。
///
/// 反证：删掉能力检测段，或改成无条件的 `return !sm.getSessionFile()`，本用例必红。
#[test]
fn templates_treat_a_fileless_session_as_a_child() {
    for source in ["pi", "omp"] {
        let t = HOOK_TARGETS
            .iter()
            .find(|t| t.source == source)
            .unwrap_or_else(|| panic!("{source} target"));
        let template = template_text(t.template);
        // 取连续三行形态：`getSessionFile` 也出现在注释里，裸名会被「注释还在、判据被删」
        // 的实现替身通过（与本文件其它锚点同一取向）。
        assert!(
            template.contains(
                "    if (typeof sm.getSessionFile === \"function\") {\n      return !sm.getSessionFile();\n    }"
            ),
            "{source} 模板缺「无会话文件 ⇒ 子会话」判据：nested 子会话\
             （`persistSession: false` ⇒ `SessionManager.inMemory`）没有 parentSession，\
             会让子 agent 的完成事件把父会话判成 Ready"
        );
    }
}

/// 行尾归一化本身就是判据（2026-11-05 Windows CI 事故的回归钉）。
///
/// 反证：把 `template_text` 改回直接读 `t.template`，下一个用例在 CRLF 形态下必红。
#[test]
fn template_text_normalises_a_crlf_materialisation() {
    let crlf = "function onStatus() {\r\n      if (gate) return;\r\n    }\r\n";
    assert!(
        template_text(crlf).contains("if (gate) return;\n"),
        "CRLF 形态必须被归一化成 LF（否则跨行锚点在 Windows 上永远匹配不上）"
    );
    assert!(!template_text(crlf).contains('\r'), "归一化后不得残留 CR");
    // 已是 LF 时零拷贝，不引入新的分配
    assert!(matches!(
        template_text("a\nb"),
        std::borrow::Cow::Borrowed(_)
    ));
}

/// 反证：**同一份模板正文在 CRLF 形态下仍要通过跨行契约锚点**。
///
/// 这条用例是 CI 事故的本体：`include_str!` 嵌的是宿主工作区字节，Windows checkout
/// 给的是 CRLF，而锚点里写的是 `\n`。归一化后两种形态同判，断言不再赌 clone 的换行状态
/// （红线 11）。
#[test]
fn contract_anchors_hold_for_a_crlf_materialisation() {
    for source in ["pi", "omp"] {
        let t = HOOK_TARGETS
            .iter()
            .find(|t| t.source == source)
            .unwrap_or_else(|| panic!("{source} target"));
        // 先归一再转 CRLF：对已经是 CRLF 的正文直接再替一次会得到 CRCRLF（那是测试自己的 bug）。
        let crlf = template_text(t.template).replace('\n', "\r\n");
        assert!(
            template_text(&crlf)
                .contains("if (isChildSession(ctx)) return;\n      return handler(event, ctx);"),
            "{source} 模板在 CRLF 形态下丢了子会话门锚点（断言不得依赖 checkout 换行）"
        );
    }
}

/// shim 契约锚点：坐标扫描 / fan-out / token / loopback / 永不非零退出。
///
/// **T9 的核心不变量**：shim **不得**认识任何 CLI 原生事件名 ——
/// 语义键由 argv 传入，翻译表在 Rust 数据（`HookEntry`）。
/// 反证：若有人把「原生事件名 → event_key」的 if/switch 写回 shim，本用例必红。
#[test]
fn report_shim_keeps_contract_anchors_and_knows_no_native_events() {
    use crate::agent::hooks::ingest::endpoint;
    use crate::agent::hooks::ingest::validation;
    let shim = crate::agent::hooks::templates::REPORT_SHIM;
    for anchor in [
        endpoint::ENDPOINTS_DIR_NAME,
        "readdirSync",
        "Promise.allSettled",
        endpoint::ENV_KEY_PORT,
        endpoint::ENV_KEY_TOKEN,
        validation::TOKEN_HEADER,
        "127.0.0.1",
        "process.exit(0)",
        // argv 契约：source 与 event_key 从命令行取。
        "process.argv",
        // 主题来源随文本一起上报（判据的输入，见下一个用例）。
        "title_source: topic.source",
    ] {
        assert!(shim.contains(anchor), "shim 缺少契约锚点 {anchor:?}");
    }
    // 原生事件名必须**不存在**于 shim（零 per-CLI 知识）。
    for native in [
        "PermissionRequest",
        "StopFailure",
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
    ] {
        assert!(
            !shim.contains(native),
            "shim 不得包含 CLI 原生事件名 {native:?}（T9：翻译必须在 Rust 数据表里）"
        );
    }
}

/// 主题来源必须随文本一起上报：判据（`should_upgrade` / `admit`）按来源定质量序。
///
/// 反证：删掉 `title_source`，或把 `prompt` 字段错标成 `native`，本用例红 ——
/// 后果是同一句用户 prompt 在实时侧栏（Native：不剥客套包装、单 token 路径判负）与
/// 历史列表（Prompt：剥包装、接受）拿到两种判决。
#[test]
fn report_shim_declares_where_the_topic_came_from() {
    let shim = crate::agent::hooks::templates::REPORT_SHIM;
    for anchor in [
        "const TOPIC_SOURCES",
        "function pickTopic",
        "title_source: topic.source",
    ] {
        assert!(shim.contains(anchor), "shim 缺少主题来源锚点 {anchor:?}");
    }

    // 字段 → 来源的绑定关系：`input.prompt` 必须是 `prompt`（最近的一个 `source:` 声明）。
    let prompt_at = shim
        .find("firstLine(input.prompt)")
        .expect("shim 未从 prompt 字段取主题（UserPromptSubmit 的主题链断裂）");
    let before = &shim[..prompt_at];
    let last_source = before
        .rfind(r#"source: ""#)
        .expect("prompt 字段没有对应的 source 声明");
    assert!(
        before[last_source..].starts_with(r#"source: "prompt""#),
        "prompt 字段被标成了别的来源（用户敲的字必须是 Prompt）"
    );
}

/// V2 模板契约（opencode 2.x loader 只认 `{id, setup}` + `ctx.event.subscribe`）：
/// 形状锚点 + V2 生命周期事件 + 上报硬约束锚点（endpoint 重读 / 超时 / loopback / title）。
#[test]
fn opencode_v2_template_keep_contract_anchors() {
    const V2: &str = include_str!("../templates/neeko-opencode-status-v2.js");
    for anchor in [
        "neeko-status",      // Plugin id（storage 隔离 + 诊断辨识）
        "setup",             // setup(ctx) 入口
        "event.subscribe",   // V2 事件订阅（替代 V1 的 event 回调）
        "session.execution", // V2 生命周期族（started/succeeded/failed/interrupted）
        "permission.asked",  // 权限门（2.0.28 二进制仍在发射）
        "readdirSync",       // v5 多实例：坐标目录扫描 + fan-out
        "Promise.allSettled",
        "127.0.0.1", // loopback 锚点
        "title:",    // 主题上报（R7.5）
    ] {
        assert!(V2.contains(anchor), "V2 模板缺少契约锚点 {anchor:?}");
    }
    // V1 已死形态不得出现在 V2 模板 —— 否则 loader 拒载或事件静默丢失。
    for dead in [
        "session.status",
        "session.updated",
        "question.asked",
        "event: async",
    ] {
        assert!(
            !V2.contains(dead),
            "V2 模板含 V1 已死形态 {dead:?}（loader 拒载 / 静默无通知的根源）"
        );
    }
}

/// V1 模板冻结钉子：1.x 保持现状，任何改动必须显式有意（改了这里就红）。
#[test]
fn opencode_v1_template_stays_frozen() {
    const V1: &str = include_str!("../templates/neeko-opencode-status.js");
    for anchor in [
        "export default async ()",
        "event.properties",
        "question.asked",
    ] {
        assert!(
            V1.contains(anchor),
            "V1 模板被改动（冻结契约破坏）：缺少 {anchor:?}"
        );
    }
}

/// 后台子 agent 花名册：**根会话已 settle，孩子还在跑**时不得上报完成。
///
/// # 事故（2026-11-06 真机反馈，与上一轮是**两个不同**的根因）
///
/// 上一轮修的是「子会话冒充父会话」（`isChildSession`）。这次的现象同一个，
/// 但机制完全不同：主 agent 用 `run_in_background: true` 派孩子时**只负责把任务交出去**，
/// 打印完 agent id 就结束回合 ⇒ pi 正常发 `agent_settled`。模板照常上报 `turn_completed`
/// ⇒ 后端置位权威门 ⇒ 子 agent 的 spinner 帧再也推不动状态 ⇒「侧栏显示已完成，实际还在跑」。
///
/// # 事实源（直读装在本机的包，不是推测）
///
/// `@tintinweb/pi-subagents@0.23.1` 的 `dist/index.js`：
/// - `pi.events.emit("subagents:started", { id, type, description })`；
/// - `pi.events.emit("subagents:completed" | "subagents:failed", buildEventData(record))`，
///   载荷含 `id` / `status`；
/// - 三条都先过 `isTopLevelAgent(record)` ⇒ nested / workflow 的孩子由各自 owner 报，不重复计数。
///
/// 反证：删掉 `activeChildren` 的增删或 `heldCompletion` 分支，`cargo test` 必红。
#[test]
fn templates_hold_completion_while_background_children_run() {
    use crate::live_sessions::wiring::hooks::EVENT_TURN_STARTED;

    let template = HOOK_TARGETS
        .iter()
        .find(|t| t.source == "pi")
        .expect("pi target")
        .template;

    // ① 订阅三条实测通道（裸名锚点足够：通道名不可能出现在函数名里，且拼错就是静默失效）。
    for channel in [
        "subagents:started",
        "subagents:completed",
        "subagents:failed",
    ] {
        assert!(
            template.contains(channel),
            "pi 模板未订阅 {channel:?}（后台子 agent 的花名册整条失效）"
        );
    }

    // ② 完成腿必须经「拖住」判据而非直发。
    assert!(
        template.contains("if (activeChildren.size > 0) {"),
        "pi 模板的完成腿没有「有孩子在跑就拖住」的判据（主 agent 交完任务就报完成 = 本次 bug）"
    );
    assert!(
        template.contains("heldCompletion"),
        "pi 模板缺 heldCompletion（拖住的完成没有补发路径，会话会卡在 Running）"
    );
    assert!(
        template.contains("activeChildren.delete(id)"),
        "pi 模板只在 started 加、不在 finished 减（花名册永不清空 ⇒ 永远不报完成）"
    );

    // ③ 「空闲期孩子起来」必须补一条开工信号，否则后端权威门让会话永久停在 Ready。
    //    锚点引用 Rust 侧常量本身：任一端改名都会静默失效，故双端必须同一份字面量。
    let reopen = format!("post(\"{EVENT_TURN_STARTED}\"");
    assert!(
        template.contains(&reopen),
        "pi 模板缺 {reopen:?}（空闲期冒出的子 agent 永远推不动会话状态）"
    );
}
