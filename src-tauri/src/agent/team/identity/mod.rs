//! 成员身份：三件互不相关的事，各自一个文件。
//!
//! 拆开的判据是「**谁会因为什么理由改它**」—— 三者没有任何共同的变化理由：
//!
//! | 文件 | 职责 | 改它的理由 |
//! |---|---|---|
//! | [`env`] | 把身份**注入**成员 PTY | 加成员维度 / 改名（协议变更） |
//! | [`verdict`] | 裁决**上报**里的归因（同 cwd 防串台） | 归因规则变化 |
//! | [`token`] | 凭证签发与解析（sha256 → 查表） | 换哈希 / 换 token 格式 |
//!
//! 合并成单文件时的真实代价：`token` 会被迫依赖 `hooks::ingest::attribution::EnvHints`
//! （只有 `verdict` 需要它），于是「换 token 算法」这个改动会牵动一个毫不相关的跨域依赖。

pub mod env;
pub mod token;
pub mod verdict;

pub use env::{member_env, TEAM_ID_ENV, TEAM_MEMBER_ID_ENV, TEAM_TOKEN_ENV};
pub use token::{hash_token, new_token, resolve_principal};
pub use verdict::{attribution_verdict, AttributionVerdict};
