//! 成员身份：四件互不相关的事，各自一个文件。
//!
//! 拆开的判据是「**谁会因为什么理由改它**」—— 四者没有任何共同的变化理由：
//!
//! | 文件 | 职责 | 改它的理由 |
//! |---|---|---|
//! | [`env`] | 把身份**注入**成员 PTY | 加成员维度 / 改名（协议变更） |
//! | [`verdict`] | 裁决**上报**里的归因（同 cwd 防串台） | 归因规则变化 |
//! | [`token`] | 凭证签发与解析（sha256 → 查表） | 换哈希 / 换 token 格式 |
//! | [`preamble`] | 起进程时告诉它「你是队长 / 成员」的那段文本 | 协作协议变化（多一条硬规则 / 多一个工具） |
//!
//! 合并成单文件时的真实代价：`token` 会被迫依赖 `hooks::ingest::attribution::EnvHints`
//! （只有 `verdict` 需要它），于是「换 token 算法」这个改动会牵动一个毫不相关的跨域依赖。
//!
//! [`preamble`] 与 [`env`] 分开的理由同理：env 是**机器读的**（`/proc/<pid>/environ` 与
//! 上报归因），preamble 是**模型读的**（进 argv 与会话上下文）。改一条协作规则不该动注入
//! 机制的代码，反之亦然。

pub mod env;
pub mod preamble;
pub mod token;
pub mod verdict;

pub use env::{member_env, TEAM_ID_ENV, TEAM_MEMBER_ID_ENV, TEAM_SHARE_DIR_ENV, TEAM_TOKEN_ENV};
pub use preamble::{preamble, with_persona, MAX_PERSONA_CHARS, MAX_PREAMBLE_CHARS};
pub use token::{hash_token, new_token, resolve_principal};
pub use verdict::{attribution_verdict, AttributionVerdict};
