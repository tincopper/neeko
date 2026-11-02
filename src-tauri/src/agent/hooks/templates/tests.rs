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
///
/// 团队身份两行是 2026-11-03 的**有意改动**（D2）：V1 已不再安装，但模板正文是全仓
/// 「上报契约」的一份，留着旧形态就会在下一个人重新启用它时再次静默丢成员身份。
#[test]
fn opencode_v1_template_stays_frozen() {
    use crate::agent::team::identity;

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
    for env in [identity::TEAM_ID_ENV, identity::TEAM_MEMBER_ID_ENV] {
        let read = format!("process.env.{env} || null");
        assert!(V1.contains(&read), "V1 模板缺少团队身份读取：{read:?}");
    }
}

/// **生产侧判据**：五份上报模板都必须把团队身份**真的**放进 `hints`（成员状态的唯一来源）。
///
/// # 事故复盘（2026-11-03，本用例的由来）
///
/// `EnvHints` 早就有 `team_id` / `team_member_id`，`attribution_verdict` 也靠它们判团队
/// 上下文；但**生产侧从来没填过它们** —— 五份模板都只发 `{neeko_session_id, project_id}`。
/// 于是每条成员 hook 都走 `NotTeamContext` → 静默跳过：成员 `state` 永远是 `spawned`、
/// `last_seq` 永远是 0、`team_wait` 只能超时。而 Rust 侧测试用的是**手搓的**
/// `HookEvent`（自带 hints），所以全绿 —— 典型的「生产者侧没有判据」：契约两端只有一端
/// 被测过。
///
/// # 断言的对象（三条缺一不可，任何一条松掉都会重新变成假护栏）
///
/// 1. **先剥行注释**（[`crate::common::testing::strip_line_comments`]）：`contains(读取形态)`
///    对一行**被 `//` 注释掉的**上报同样成立 —— 事故本体是「压根没写」，而「写了又注释掉」
///    是同一个缺口的第二种到达方式，判据必须一视同仁。剥的时候 `:` 后紧跟的 `//` 不算注释
///    （模板里有 `http://127.0.0.1`，否则那一行会被误删）。
/// 2. **必须落在 `hints: { … }` 块内**：hints 块**外**的一行读取（某个本地日志对象里、
///    某个调试分支里）不会进上报载荷，而整份文件 `contains` 会为它变绿。这条必须靠块范围
///    才能区分，是 2026-11-03 那次审计（把两行注释掉仍全绿）暴露的第二个洞。
/// 3. **恰好一次**：「一行真的 + 一行注释掉的」半残状态剥完注释后计数为 1 才通过；
///    出现两次同样红 —— 复制粘贴出来的第二份读取迟早与服务端字段漂移。
///
/// 另加两条与读取形态无关的：
///
/// - 断言 `identity::TEAM_ID_ENV` / `TEAM_MEMBER_ID_ENV` 的**值**：改名常量而漏改模板时
///   本用例必红（协议两端同源的前提是有人真的盯着）；
/// - **扫描目录**而不是手写清单：新增一份模板而忘了这两个字段会在这里被追着补。
///
/// # 已做过的变异验证（逐条改坏 → 红 → 还原）
///
/// 两行改成 `// …` → 红；删掉一行 → 红；两行挪到 `hints: {` 块外 → 红；去掉 `|| null` → 红。
#[test]
fn every_hook_template_forwards_the_team_identity_env() {
    use crate::agent::team::identity;
    use crate::common::testing::{enclosed_body, strip_line_comments};

    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src/agent/hooks/templates");
    let mut checked: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(dir).expect("read templates dir") {
        let path = entry.expect("dir entry").path();
        // 只扫脚本模板（`tests.rs` 自己也是本目录下的文件）。
        if !matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("js" | "mjs" | "ts")
        ) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .expect("template file name")
            .to_owned();
        let body = std::fs::read_to_string(&path).expect("read template");
        // 剥注释是第一步：后续每条断言都只对着**活代码**说话。
        let live = strip_line_comments(&body);
        let at = live.find("hints:").unwrap_or_else(|| {
            panic!("{name} 里没有 `hints:` —— 上报载荷没有 hints 字段，团队身份无处安放")
        });
        let open = at
            + live[at..]
                .find('{')
                .unwrap_or_else(|| panic!("{name} 的 `hints:` 后面没有对象字面量"));
        let hints = enclosed_body(&live, open);
        for env in [identity::TEAM_ID_ENV, identity::TEAM_MEMBER_ID_ENV] {
            let read = format!("process.env.{env} || null");
            let hits = live.matches(read.as_str()).count();
            assert_eq!(
                hits, 1,
                "{name} 里 `{read}` 在**活代码**中出现 {hits} 次，必须恰好一次：\
                 0 次 = 没转发（或只剩注释里那份）⇒ 成员身份丢失 ⇒ 每条 hook 都被判 \
                 `NotTeamContext` 并静默跳过（成员 state 永远 spawned、team_wait 只能超时）；\
                 2 次以上 = 复制粘贴出来的第二份读取，迟早与服务端字段漂移"
            );
            assert!(
                hints.contains(&read),
                "{name} 的 `{read}` 不在 `hints: {{ … }}` 块内 —— 块外的读取不会进上报载荷\
                 （它可能只是个本地日志/调试对象），而上报侧收不到就等于没上报"
            );
        }
        checked.push(name);
    }

    checked.sort();
    assert_eq!(
        checked,
        vec![
            "neeko-omp-status.ts",
            "neeko-opencode-status-v2.js",
            "neeko-opencode-status.js",
            "neeko-pi-status.ts",
            "neeko-report.mjs",
        ],
        "模板清单变了：新增/删除模板必须同步本用例（否则新模板可以静默不转发团队身份）"
    );
}
