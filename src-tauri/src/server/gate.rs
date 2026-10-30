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
//! # 零 panic 是结构性要求
//!
//! 门装在全局层（组内 `CatchPanicLayer` 之外）：门自身 panic 没有任何兜底层可接，
//! hyper 会直接掐断连接（hooks 组因此漏出非 204）。故本文件所有路径对任意畸形请求头
//! 都必须零 panic —— 无索引、无锁、无分配失败路径。

use std::sync::Arc;

use axum::http::HeaderMap;
use subtle::ConstantTimeEq;

/// 凭证提取器：**只负责「从传输里取出候选凭证」**，不负责比较。
///
/// 新增凭证形状（Bearer scheme / cookie / query）＝新增一个 impl 并 push 进门的凭证列表；
/// 仲裁策略与代码零改动（A4）。
pub trait CredentialExt: Send + Sync {
    /// 从请求头取出候选凭证；`None` = 本请求没带这种凭证。
    fn extract<'a>(&self, headers: &'a HeaderMap) -> Option<&'a [u8]>;
}

/// 当前唯一实现：header token（形状与 shim / endpoint 文件契约同源）。
pub struct HeaderToken {
    /// header 名（hooks 组 = `x-neeko-agent-hook-token`，常量来自 kernel 模块）。
    pub name: &'static str,
}

impl CredentialExt for HeaderToken {
    fn extract<'a>(&self, headers: &'a HeaderMap) -> Option<&'a [u8]> {
        // `get` 对重复头名返回首值；非 ASCII 字节原样返回交给恒定时间比较
        // （hyper 已在解析期拒绝非法 header，这里不做二次校验 = 无 panic 路径）。
        headers
            .get(self.name)
            .map(axum::http::HeaderValue::as_bytes)
    }
}

/// 统一鉴权门：进程内唯一的能力裁决点（AC7）。
///
/// 一个实例 = 一个端点可接受的全部能力（token 集合）。hooks 组用 [`AuthGate::new`]
/// （单元素），团队 MCP 用 [`AuthGate::with_tokens`]（成员 token 集合）。
pub struct AuthGate {
    /// 本实例签发的能力（token）集合 —— **任一命中即通过**。
    expected: Vec<String>,
    /// 全部可接受的凭证形状（OR 语义：任一命中即通过）。
    credentials: Vec<Arc<dyn CredentialExt>>,
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

    /// 多 token 构造（design §3.1b）：团队 MCP 端点装载**该端点全部成员的 token**。
    ///
    /// **没有「本组免鉴权」构造路径**：`tokens` 为空时 `authorize` 恒 false
    /// （空集合上 `any` 为 false）—— 组合根把成员表清空后门会变成「谁都进不来」，
    /// 而**不是**「谁都能进」。
    #[must_use]
    pub fn with_tokens(tokens: Vec<String>, credentials: Vec<Arc<dyn CredentialExt>>) -> Self {
        Self {
            expected: tokens,
            credentials,
        }
    }

    /// 裁决：任一凭证提取成功**且**命中 token 集合中任意一个，即通过。
    ///
    /// 两层 `any`（凭证形状 × token）共用同一处比较实现；调用点因此仍然是 1
    /// （护栏：`constant_time_comparison_has_exactly_one_call_site`）。
    #[must_use]
    pub fn authorize(&self, headers: &HeaderMap) -> bool {
        let expected = &self.expected;
        self.credentials.iter().any(|credential| {
            credential.extract(headers).is_some_and(|candidate| {
                expected
                    .iter()
                    .any(|token| ct_eq(candidate, token.as_bytes()))
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
            fn extract<'a>(&self, _headers: &'a HeaderMap) -> Option<&'a [u8]> {
                Some(self.0.as_bytes())
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
