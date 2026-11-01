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
