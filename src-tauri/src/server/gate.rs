//! 统一鉴权门（设计 §3.2）。
//!
//! # 唯一性
//!
//! 进程内只有 [`AuthGate::authorize`] 一处调用恒定时间比较（AC7 判据：调用点 = 1）。
//! [`CredentialExt`] 的实现体**只提取候选字节、不返回布尔** —— 结构上无法各自实现比较逻辑，
//! 这比「约定不要重复写比较」强得多。
//!
//! # 多 token（design §3.1b）
//!
//! 团队 MCP 走**独立 listener + 独立门实例**，一个实例装载该端点全部成员的 token
//! （[`AuthGate::with_tokens`]）。多 token 用嵌套 `any` 表达（凭证形状 OR × token OR），
//! 比较逻辑仍然只有那一处 —— 这两个 `any` 是同一个谓词的两次遍历，不是两份实现。
//! hooks 组的单 token 构造器 [`AuthGate::new`] 保留且行为逐字不变。
//!
//! # 期望集合的存储形态（[`ExpectedTokens`]）
//!
//! hooks 的门是 `Fixed`：token 在进程启动时签发，之后不变，所以**仍然零锁**（守卫
//! `constant_time_comparison_has_exactly_one_call_site` 之外，另有一条"hooks 路径不加锁"
//! 的意图）。团队的门是 `Shared`：成员会被 spawn / 轮换 / 关闭，期望集合必须能**在
//! serve 之后**更新 —— 否则 listener 一启动就过时（而重建 listener 会换端口，
//! 已下发到成员 MCP 配置里的 URL 全部失效）。
//!
//! 读锁只在 `Shared` 路径上取，且 `parking_lot` 不中毒（无 `PoisonError`）——
//! 「零 panic」这条不变量仍然成立。
//!
//! # 零 panic 是结构性要求
//!
//! 门装在全局层（组内 `CatchPanicLayer` 之外）：门自身 panic 没有任何兜底层可接，
//! hyper 会直接掐断连接（hooks 组因此漏出非 204）。故本文件所有路径对任意畸形请求头
//! 都必须零 panic —— 无索引、无锁、无分配失败路径。

use std::borrow::Cow;
use std::sync::Arc;

use axum::http::{header, HeaderMap};
use parking_lot::RwLock;
use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq;

/// 凭证提取器：**只负责「从传输里取出候选凭证」**，不负责比较。
///
/// 新增凭证形状（Bearer scheme / cookie / query）＝新增一个 impl 并 push 进门的凭证列表；
/// 仲裁策略与代码零改动（A4）。
pub trait CredentialExt: Send + Sync {
    /// 从请求头取出候选凭证；`None` = 本请求没带这种凭证。
    ///
    /// 返回 `Cow` 而不是 `&[u8]`：门的团队形态要在比较前对候选值做摘要，而摘要产物是
    /// owned。用 `Cow` 让"不需要摘要"的路径（hooks）仍然是零拷贝。
    fn extract<'a>(&self, headers: &'a HeaderMap) -> Option<Cow<'a, [u8]>>;
}

/// 当前唯一实现：header token（形状与 shim / endpoint 文件契约同源）。
pub struct HeaderToken {
    /// header 名（hooks 组 = `x-neeko-agent-hook-token`，常量来自 kernel 模块）。
    pub name: &'static str,
}

impl CredentialExt for HeaderToken {
    fn extract<'a>(&self, headers: &'a HeaderMap) -> Option<Cow<'a, [u8]>> {
        // `get` 对重复头名返回首值；非 ASCII 字节原样返回交给恒定时间比较
        // （hyper 已在解析期拒绝非法 header，这里不做二次校验 = 无 panic 路径）。
        headers
            .get(self.name)
            .map(|value| Cow::Borrowed(value.as_bytes()))
    }
}

/// `Authorization: Bearer <token>` 形态（codex 的 `bearer_token_env_var`）。
///
/// 与 [`HeaderToken`] 并列：**只提取、不比较** —— 恒定时间比较仍然只有
/// [`AuthGate::authorize`] 里那一处（`constant_time_comparison_has_exactly_one_call_site`）。
///
/// # 为什么只认一种拼法
///
/// 这里不是给人用的输入框，是**我们下发的配置的回声**：`bearer_token_env_var` 这一族发出来的
/// 就是 `Bearer <token>`（单空格、大小写固定）。宽容一条谁也没写过的形状（`bearer` /
/// 多空格 / 大小写不敏感），等于给「另一条鉴权路径」开一个没人会去审计的缝 —— 而它
/// **不会**让任何今天可用的成员变得可用。
///
/// 前缀不匹配或前缀后为空时返回 `None`（本请求没带这种凭证），而不是空候选值：空值会拿去
/// 和 token 集合比一次，虽然通常必不相等，但那是在为「空凭证」留一个可达路径。
pub struct BearerToken;

impl CredentialExt for BearerToken {
    fn extract<'a>(&self, headers: &'a HeaderMap) -> Option<Cow<'a, [u8]>> {
        let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
        let token = value.strip_prefix("Bearer ")?;
        if token.is_empty() {
            return None;
        }
        Some(Cow::Owned(token.as_bytes().to_vec()))
    }
}

/// 统一鉴权门：进程内唯一的能力裁决点（AC7）。
///
/// 一个实例 = 一个端点可接受的全部能力（token 集合）。hooks 组用 [`AuthGate::new`]
/// （单元素），团队 MCP 用 [`AuthGate::with_tokens`]（成员 token 集合）。
pub struct AuthGate {
    /// 本实例签发的能力（token）集合 —— **任一命中即通过**。
    ///
    /// 装的是明文还是 sha256 十六进制由变体本身决定 —— 不可能出现「集合形态」与「比较前
    /// 要不要摘要」各说各话的组合（那会让下一个接入方挑错构造器，表现为「所有成员恒拒」）。
    expected: ExpectedTokens,
    /// 全部可接受的凭证形状（OR 语义：任一命中即通过）。
    credentials: Vec<Arc<dyn CredentialExt>>,
}

/// 期望集合的存储形态 —— **一个字段表达两件事**（锁行为 + 编码），不可组合出非法状态。
///
/// 原来的 `expected` + `digest` 两个字段能拼出 4 种组合，其中「活集合 + 明文」无意义、
/// 「定值 + hash」生产零调用：非法状态在类型上就不该存在。
enum ExpectedTokens {
    /// 定值**明文**集合（hooks）：启动时签发、之后不变 ⇒ **零锁**。
    Plain(Vec<String>),
    /// **明文摘要**的活集合（团队）：成员会被增删 / 轮换 ⇒ 集合必须在 serve 之后可更新。
    ///
    /// 团队端点的期望值只能是 hash：`issue_token` 落库只存 hash，门拿不到明文。
    Sha256HexShared(SharedTokenSet),
}

/// **活跃的** token 集合（团队端点用）。
///
/// # 为什么需要它
///
/// `serve()` 按值拿走门 —— 门里的期望集合如果在启动时固定，团队**先 promote、后 spawn**
/// 的成员就永远进不来（而重建 listener 会换端口，已下发的 MCP URL 全部失效）。
/// 这个类型把「集合」与「门的实例」解耦：门持有它的克隆，组合根在成员变动后调
/// [`SharedTokenSet::replace`]。
///
/// # 为什么不是 `Vec<String>` + 重建门
///
/// 门的实例被 `serve` 之后不可替换；能替换的只有它读的那份数据。
#[derive(Clone)]
pub struct SharedTokenSet(Arc<RwLock<Vec<String>>>);

impl SharedTokenSet {
    /// 用初始集合构造（通常是「库里已签发凭证的 hash」）。
    #[must_use]
    pub fn new(tokens: Vec<String>) -> Self {
        Self(Arc::new(RwLock::new(tokens)))
    }

    /// 整体替换（成员 spawn / 轮换 / 关队之后调用）。
    ///
    /// 整体替换而不是增删单条：调用方本来就持有「完整的一份表」（`principals_from` 的输出），
    /// 增量接口只会让两侧的状态容易走岔。
    pub fn replace(&self, tokens: Vec<String>) {
        *self.0.write() = tokens;
    }

    /// 当前快照（调试 / 测试用；门内直接读锁，不经过这里）。
    #[must_use]
    pub fn snapshot(&self) -> Vec<String> {
        self.0.read().clone()
    }
}

/// 明文 → 小写十六进制 sha256（与团队域 `identity::hash_token` 的**同一种编码**）。
///
/// 编码必须逐字一致（小写 / 无前缀 / 32 字节全量）：两侧各写一份时，大写或裸字节会让门
/// 对**所有**成员恒拒，而现象看起来像「token 错了」。已知向量由单测钉住。
fn sha256_hex(candidate: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(candidate);
    hex_lower(&hasher.finalize())
}

/// 小写十六进制编码。
///
/// 不引第三方 hex 依赖：32 字节的编码不值得多一个 crate，且这里必须与落库侧逐字一致 ——
/// 自己实现反而是可见的（两侧都在本仓，改一处必然被测试抓到）。
fn hex_lower(bytes: &[u8]) -> Vec<u8> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = Vec::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[usize::from(byte >> 4)]);
        out.push(HEX[usize::from(byte & 0x0f)]);
    }
    out
}

impl AuthGate {
    /// 单 token 构造（hooks 组的原形状，**行为逐字不变**）。
    ///
    /// **没有「本组免鉴权」构造路径** —— 门对每个路由组强制生效（A4）。
    ///
    /// 空 token 集合时 `authorize` 恒 false（结构性证明：不存在「什么都不用带」的配置）。
    #[must_use]
    pub fn new(expected: String, credentials: Vec<Arc<dyn CredentialExt>>) -> Self {
        // 单一实现：`new` 只是 `with_tokens(vec![expected])` 的别名 ——
        // 两个构造器因此不可能漂移成两套裁决语义。
        Self::with_tokens(vec![expected], credentials)
    }

    /// 多 token 构造（hooks 形态）：期望值是**明文**，集合在 serve 之后不变 ⇒ 零锁。
    ///
    /// **没有「本组免鉴权」构造路径**：`tokens` 为空时 `authorize` 恒 false
    /// （空集合上 `any` 为 false）—— 组合根把成员表清空后门会变成「谁都进不来」，
    /// 而**不是**「谁都能进」。
    #[must_use]
    pub fn with_tokens(tokens: Vec<String>, credentials: Vec<Arc<dyn CredentialExt>>) -> Self {
        Self {
            expected: ExpectedTokens::Plain(tokens),
            credentials,
        }
    }

    /// 团队 MCP 端点的构造器：期望值是**明文 token 的 sha256 十六进制**，且集合是**活**的
    /// （可在 `serve` 之后由 [`SharedTokenSet::replace`] 更新）。
    ///
    /// # 为什么只认 hash
    ///
    /// `TeamManager::issue_token` 落库只存 hash（明文只在 spawn 时下发一次），所以门**拿不到
    /// 明文**，只能拿 hash 集合裁决：候选值先摘要再比较，落库的 hash 本身不是可用凭证。
    ///
    /// # 为什么没有「定值 + hash」构造器
    ///
    /// 它只会被测试用 —— 而测试用活集合构造器一样能构造门。多一个 `pub` 构造器就多一个
    /// 被生产代码选错的机会（选错的症状是「所有成员恒拒」）。
    ///
    /// 空集合同样恒拒（与 [`Self::new`] 的结构性保证相同）。
    #[must_use]
    pub fn with_shared_hashed_tokens(
        tokens: SharedTokenSet,
        credentials: Vec<Arc<dyn CredentialExt>>,
    ) -> Self {
        Self {
            expected: ExpectedTokens::Sha256HexShared(tokens),
            credentials,
        }
    }

    /// 裁决：任一凭证提取成功**且**命中 token 集合中任意一个，即通过。
    ///
    /// 两层 `any`（凭证形状 × token）共用同一处比较实现；调用点因此仍然是 1
    /// （护栏：`constant_time_comparison_has_exactly_one_call_site`）。
    #[must_use]
    pub fn authorize(&self, headers: &HeaderMap) -> bool {
        // 活集合路径取一次读锁（`parking_lot` 不中毒）；定值路径无锁无分配。
        let shared_guard;
        let (expected, digest): (&[String], bool) = match &self.expected {
            ExpectedTokens::Plain(fixed) => (fixed, false),
            ExpectedTokens::Sha256HexShared(shared) => {
                shared_guard = shared.0.read();
                (&shared_guard, true)
            }
        };
        self.credentials.iter().any(|credential| {
            credential.extract(headers).is_some_and(|candidate| {
                // 摘要只在需要的路径上算（hooks 的明文比较仍零拷贝）。
                let comparable: Cow<'_, [u8]> = if digest {
                    Cow::Owned(sha256_hex(candidate.as_ref()))
                } else {
                    candidate
                };
                expected
                    .iter()
                    .any(|token| ct_eq(comparable.as_ref(), token.as_bytes()))
            })
        })
    }
}

/// 恒定时间比较（AC7 的唯一实现）。
///
/// 长度不等直接 false：长度不是秘密（token 是定长 uuid），而 `ConstantTimeEq` 对不等长
/// 切片本就无法定长比较。内容比较走 `subtle`，避免时序侧信道。
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && bool::from(a.ct_eq(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "tok-abc-123";

    fn gate() -> AuthGate {
        AuthGate::new(
            TOKEN.to_string(),
            vec![Arc::new(HeaderToken {
                name: "x-neeko-token",
            })],
        )
    }

    fn headers(name: &'static str, value: &'static str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(name, value.parse().expect("valid header value"));
        map
    }

    #[test]
    fn correct_token_is_authorized() {
        assert!(gate().authorize(&headers("x-neeko-token", TOKEN)));
    }

    #[test]
    fn wrong_or_missing_token_is_rejected() {
        let gate = gate();
        assert!(!gate.authorize(&headers("x-neeko-token", "stale")));
        assert!(!gate.authorize(&headers("x-neeko-token", "tok-abc-12"))); // 前缀不得通过
        assert!(!gate.authorize(&headers("x-neeko-token", "tok-abc-1234"))); // 超长不得通过
        assert!(!gate.authorize(&HeaderMap::new()));
    }

    /// 摘要门：注册 hash，**明文**能过 —— 门在不持有明文的前提下完成裁决。
    ///
    /// 这正是团队端点的形态：`issue_token` 落库只存 hash，明文只在 spawn 时下发一次。
    #[test]
    fn hashed_gate_accepts_the_plaintext_behind_a_registered_hash() {
        let plain = "tok-abc-123";
        let hash = String::from_utf8(sha256_hex(plain.as_bytes())).expect("hex is utf8");
        let gate = AuthGate::with_shared_hashed_tokens(
            SharedTokenSet::new(vec![hash.clone()]),
            vec![Arc::new(HeaderToken {
                name: "x-neeko-token",
            })],
        );

        assert!(gate.authorize(&headers("x-neeko-token", plain)));
        assert!(!gate.authorize(&headers("x-neeko-token", "tok-abc-124")));
        // 把握在手里的 hash 本身当 token 送进来必须失败 —— 证明候选值确实过了摘要，
        // 而不是"拿 hash 直接比字符串"（后者等于把 DB 里的值变成可用凭证）。
        let leaked: &'static str = Box::leak(hash.into_boxed_str());
        assert!(!gate.authorize(&headers("x-neeko-token", leaked)));
    }

    /// 活集合（团队端点）：`serve` 之后替换集合**立即生效**，旧凭证立即失效。
    ///
    /// 反例（本用例挡的正是它）：门在构造时把集合拍成快照 —— 那样先 promote、后 spawn 的
    /// 成员永远进不来，而重建 listener 会换端口，已下发的 MCP URL 全部失效。
    #[test]
    fn a_shared_token_set_takes_effect_after_the_gate_is_built() {
        let hash_of = |plain: &str| String::from_utf8(sha256_hex(plain.as_bytes())).expect("hex");

        let tokens = SharedTokenSet::new(vec![hash_of("first")]);
        let gate = AuthGate::with_shared_hashed_tokens(
            tokens.clone(),
            vec![Arc::new(HeaderToken {
                name: "x-neeko-token",
            })],
        );
        assert!(gate.authorize(&headers("x-neeko-token", "first")));
        assert!(!gate.authorize(&headers("x-neeko-token", "second")));

        tokens.replace(vec![hash_of("second")]);
        assert!(
            !gate.authorize(&headers("x-neeko-token", "first")),
            "轮换后旧明文必须立即失效（同一个门实例）"
        );
        assert!(
            gate.authorize(&headers("x-neeko-token", "second")),
            "新集合必须立即生效（门不需要重建）"
        );
        assert_eq!(tokens.snapshot(), vec![hash_of("second")]);
    }

    /// 摘要编码要与落库侧同口径：`sha256("abc")` 的已知十六进制。
    ///
    /// 两侧各写一份实现时，编码不一致（大写 / 裸字节 / 加前缀）会让门对**所有**成员恒拒，
    /// 而且看起来像"token 错了"。用已知向量钉住编码本身。
    #[test]
    fn sha256_hex_matches_the_known_digest() {
        assert_eq!(
            String::from_utf8(sha256_hex(b"abc")).expect("hex is utf8"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    /// `Bearer` 后面什么都没有不是一种凭证：提取器返回 `None`，空候选值不进比较。
    ///
    /// 反例（本用例挡住它）：「前缀匹配 ⇒ Some(空)」会让门多出一个空凭证的可达状态，
    /// 而它**不是**「没带凭证」，不该走到裁决那一步。
    #[test]
    fn bearer_without_a_token_is_not_a_credential() {
        let mut empty = HeaderMap::new();
        empty.insert(
            header::AUTHORIZATION,
            "Bearer ".parse().expect("valid header value"),
        );
        assert!(BearerToken.extract(&empty).is_none());

        // 正例对照：正常形态仍然提取得出（否则上面的断言会因「恒 None」假绿）。
        let mut ok = HeaderMap::new();
        ok.insert(
            header::AUTHORIZATION,
            "Bearer tok".parse().expect("valid header value"),
        );
        assert_eq!(BearerToken.extract(&ok).as_deref(), Some(b"tok".as_slice()));
    }

    /// header 名大小写由 HTTP 规范保证（`HeaderMap` 内部小写归一），此处钉住该前提。
    #[test]
    fn header_name_matching_is_case_insensitive() {
        assert!(gate().authorize(&headers("X-Neeko-Token", TOKEN)));
    }

    /// 空凭证列表恒拒 —— 「免鉴权」配置在结构上不存在（A4）。
    #[test]
    fn empty_credential_list_always_rejects() {
        let gate = AuthGate::new(TOKEN.to_string(), Vec::new());
        assert!(!gate.authorize(&headers("x-neeko-token", TOKEN)));
    }

    /// 多凭证 OR 语义：任一形状命中即通过，且不会因为前一个不匹配而短路成拒绝。
    #[test]
    fn multiple_credentials_use_or_semantics() {
        struct Fixed(&'static str);
        impl CredentialExt for Fixed {
            fn extract<'a>(&self, _headers: &'a HeaderMap) -> Option<Cow<'a, [u8]>> {
                Some(Cow::Borrowed(self.0.as_bytes()))
            }
        }

        let gate = AuthGate::new(
            TOKEN.to_string(),
            vec![
                Arc::new(HeaderToken {
                    name: "x-neeko-token",
                }),
                Arc::new(Fixed("other-shape")),
                Arc::new(Fixed(TOKEN)),
            ],
        );
        // 第一条不匹配、第三条匹配 → 通过。
        assert!(gate.authorize(&HeaderMap::new()));
    }

    /// 门在组内 `CatchPanicLayer` 之外：任意畸形头都不得 panic（design §3.2）。
    ///
    /// 构造手段：非 ASCII 字节值（hyper 在真实链路上会在解析期拒绝，但门不能依赖
    /// 「上游一定挡住」）、超长值、重复头名（`HeaderMap` 保留首个）、空值。
    #[test]
    fn malformed_headers_never_panic() {
        let gate = gate();

        let mut non_ascii = HeaderMap::new();
        non_ascii.insert(
            "x-neeko-token",
            axum::http::HeaderValue::from_bytes(&[0xff, 0xfe, 0xfd]).expect("opaque bytes allowed"),
        );
        assert!(!gate.authorize(&non_ascii));

        let mut long = HeaderMap::new();
        let value = "a".repeat(64 * 1024);
        long.insert(
            "x-neeko-token",
            value.parse().expect("long ascii header value"),
        );
        assert!(!gate.authorize(&long));

        let mut duplicate = HeaderMap::new();
        duplicate.append("x-neeko-token", "wrong".parse().expect("valid"));
        duplicate.append("x-neeko-token", TOKEN.parse().expect("valid"));
        // 首值不匹配 → 拒绝（不 panic、不跨值拼接）。
        assert!(!gate.authorize(&duplicate));

        let mut empty = HeaderMap::new();
        empty.insert("x-neeko-token", "".parse().expect("empty allowed"));
        assert!(!gate.authorize(&empty));
    }

    // ───────────────────────────────────────────────────────────────
    // 多 token（design §3.1b：团队 MCP 的独立 listener 用 `with_tokens` 装成员 token 集合）
    // ───────────────────────────────────────────────────────────────

    fn header(name: &'static str) -> Vec<Arc<dyn CredentialExt>> {
        vec![Arc::new(HeaderToken { name })]
    }

    /// `new(单 token)` 与 `with_tokens(单元素)` 是**同一行为**（向后兼容的加法）。
    ///
    /// 保护的不变量：hooks 组的门**一个字都不用改** —— `new` 只是
    /// `with_tokens(vec![expected])` 的别名，两个构造器不可能漂移成两套裁决语义。
    #[test]
    fn new_and_with_tokens_are_equivalent() {
        let legacy = AuthGate::new(TOKEN.to_string(), header("x-neeko-token"));
        let modern = AuthGate::with_tokens(vec![TOKEN.to_string()], header("x-neeko-token"));

        // 命中 / 未命中 / 没带 / 前缀 / 超长：同一请求必须同结论。
        for value in [TOKEN, "stale", "tok-abc-12", "tok-abc-1234", ""] {
            let map = headers("x-neeko-token", value);
            assert_eq!(
                legacy.authorize(&map),
                modern.authorize(&map),
                "两个构造器对 {value:?} 的结论必须一致"
            );
        }
        let missing = HeaderMap::new();
        assert_eq!(
            legacy.authorize(&missing),
            modern.authorize(&missing),
            "没带凭证时两者都必须拒绝"
        );
        // 正例对照：`new` 没有退化成恒拒绝（否则上面的相等断言会因「都 false」假绿）。
        assert!(modern.authorize(&headers("x-neeko-token", TOKEN)));
    }

    /// 多 token OR 语义：集合里任意一个命中即通过。
    ///
    /// 保护的不变量：design §3.1b 的 `AuthGate::with_tokens(成员 token 集合)` ——
    /// 一个团队里每个成员各有 token，门的裁决单位是「是不是本端点的合法主体之一」，
    /// 不是「唯一进程 token」。
    #[test]
    fn any_of_several_tokens_is_accepted() {
        let gate = AuthGate::with_tokens(
            vec!["tok-a".to_string(), TOKEN.to_string(), "tok-c".to_string()],
            header("x-neeko-token"),
        );
        for token in ["tok-a", TOKEN, "tok-c"] {
            assert!(
                gate.authorize(&headers("x-neeko-token", token)),
                "{token} 在集合里必须通过"
            );
        }
    }

    /// 集合里全都不匹配 → 拒绝（不是「命中最后一个才通过」）。
    #[test]
    fn no_matching_token_is_rejected() {
        let gate = AuthGate::with_tokens(
            vec!["tok-a".to_string(), "tok-b".to_string()],
            header("x-neeko-token"),
        );
        assert!(!gate.authorize(&headers("x-neeko-token", "tok-c")));
        // 前缀 / 超长仍按字节全等裁决（长度不等直接 false，不进内容比较）。
        assert!(!gate.authorize(&headers("x-neeko-token", "tok-")));
        assert!(!gate.authorize(&headers("x-neeko-token", "tok-a-plus")));
    }

    /// 空 token 集合恒拒 —— 「免鉴权」的构造路径在结构上仍然不存在（A4）。
    ///
    /// 保护的不变量：组合根把成员表清空后（团队关闭）门必须变成「谁都进不来」，
    /// **不得**退化成「谁都能进」。
    #[test]
    fn empty_token_set_always_rejects() {
        let gate = AuthGate::with_tokens(Vec::new(), header("x-neeko-token"));
        assert!(!gate.authorize(&headers("x-neeko-token", TOKEN)));
        assert!(!gate.authorize(&headers("x-neeko-token", "")));
        assert!(!gate.authorize(&HeaderMap::new()));
    }

    /// 源码级护栏（AC7）：`ct_eq` 调用点必须保持为 **1**（加上定义共 2 处落点）。
    ///
    /// 多 token 的裁决用嵌套 `any` 表达（`credentials` OR × `tokens` OR），**不复制**
    /// 比较逻辑；任何「为多 token 再写一个比较」的改动都会让本测试红。
    ///
    /// # 计数口径
    ///
    /// 被计数的字串是「`ct_eq` + 左括号」**且前面不是 `.`**：`subtle::ConstantTimeEq`
    /// 的 trait 方法也叫这个名字，它在 [`ct_eq`] 的唯一实现体里被调用一次
    /// —— 那是**比较本身的底层**，不是第二个比较落点。
    /// 计数口径因此是「比较落点」，而不是「名字出现的次数」。下面另有一条反向断言
    /// 钉住那个点前缀的底层调用**恰好一次**（否则「把比较搬到别处」可以靠改名绕过本护栏）。
    ///
    /// 用 `concat!` 拼接被禁字面量，是为了让**本测试自身的源码**不包含被计数的字符串
    /// （否则断言会命中自己）。同理，本文档里也不写「名字 + 左括号」的完整形式，
    /// 也不写带点前缀的完整调用形式。
    #[test]
    fn constant_time_comparison_has_exactly_one_call_site() {
        let source = include_str!("gate.rs");
        let needle = concat!("ct", "_eq(");

        let mut sites = 0;
        for (pos, _) in source.match_indices(needle) {
            // 点前缀 = trait 方法调用（唯一实现体内部那一行），不是比较落点。
            if source[..pos].ends_with('.') {
                continue;
            }
            sites += 1;
        }
        assert_eq!(
            sites, 2,
            "AC7：调用点必须保持为 1（1 处定义 + 1 处调用 = 2 处落点），实际 {sites} 处"
        );
        // 反向断言：底层 `ConstantTimeEq` 调用恰好一次（实现体没有被拆成两份）。
        assert_eq!(
            source.match_indices(needle).count() - sites,
            1,
            "`subtle` 的底层调用必须恰好一次（AC7：比较只能有一份实现）"
        );
        assert!(
            source.contains("fn ") && source.len() > 1024,
            "源码读取异常"
        );
    }
}
