//! 集成测试共享基建：确定性 Git 测试仓库 + 行尾无关的内容断言。
//!
//! ## 为什么需要确定性仓库
//!
//! Neeko 是 Git 客户端，测试必须同时面对 git 的两个内容视图：
//!
//! - **git 归一化视图**（blob / diff / status）：受 `text`/`core.autocrlf` 影响时统一为 LF，
//!   平台无关、确定；
//! - **工作区物化字节**：由平台 + git 配置（`core.autocrlf`，Windows 默认 `true`）共同决定，
//!   **不确定**。
//!
//! 任何「写 LF 文件 → 让 git 处理（stash / checkout / discard / apply）→ 回读工作区字节并精确
//! 断言」的测试，本质上在断言一个测试无法控制的环境变量，在 Windows CI（`autocrlf=true`）
//! 下必然因 CRLF 挂掉（回归样例：`git_test::stash_apply_restores_changes_keeps_entry`）。
//!
//! 因此测试仓库统一钉死换行语义：仓库级 `core.autocrlf=false` + 提交 `.gitattributes * -text`
//! 双保险，保证跨平台、跨全局配置下工作区换行确定。
//!
//! ## 断言纪律
//!
//! - 优先用 git 归一化视图（status / diff）做 oracle，行尾天然无关；
//! - 必须断言工作区字节时，用 [`assert_content_eq`]（内部归一化 `\r\n` → `\n`），
//!   禁止对工作区换行做字节级精确断言。
//!
//! ## 结构性约束
//!
//! Rust 集成测试链接的是非 test 构建的 lib，因此 lib 内 `#[cfg(test)]` 的 helper
//! 集成测试用不了；lib 侧测试各自收敛到同一套实现与注释（见 `operations.rs::init_repo`）。

use git2::{Repository, Signature};
use std::path::Path;
use tempfile::TempDir;

/// 确定性 Git 测试仓库：一次初始提交 + 换行语义钉死。
pub struct TestRepo {
    dir: TempDir,
    repo: Repository,
}

impl TestRepo {
    /// 创建含一次初始提交的确定性临时仓库。
    ///
    /// - 仓库级 `core.autocrlf=false`：关闭 Windows 默认的 LF→CRLF 检出转换（CLI 路径）；
    /// - 提交 `.gitattributes * -text`：现代属性级钉死，随仓库走、抵抗全局配置与环境注入。
    pub fn init() -> Self {
        let dir = TempDir::new().expect("create temp dir");
        let repo = Repository::init(dir.path()).expect("init git repo");

        // Windows 上 git 默认 autocrlf=true 会把检出内容转成 CRLF，
        // 导致 stash/checkout/discard 等 git 写操作后工作区内容与写入的 `\n` 不一致。
        // 仓库级关闭 + 提交 `.gitattributes * -text` 双保险，保证跨平台一致。
        repo.config()
            .expect("repo config")
            .set_bool("core.autocrlf", false)
            .expect("set core.autocrlf=false");
        std::fs::write(dir.path().join(".gitattributes"), "* -text\n")
            .expect("write .gitattributes");

        let sig = Signature::now("Test", "test@test.com").expect("signature");
        std::fs::write(dir.path().join("README.md"), "# Test\n").expect("write README");
        {
            let mut index = repo.index().expect("index");
            index
                .add_path(Path::new("README.md"))
                .expect("add README to index");
            index
                .add_path(Path::new(".gitattributes"))
                .expect("add .gitattributes to index");
            index.write().expect("write index");
            let tree_id = index.write_tree().expect("write tree");
            let tree = repo.find_tree(tree_id).expect("find tree");
            repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .expect("initial commit");
        }

        Self { dir, repo }
    }

    /// 仓库工作目录。
    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    /// 仓库工作目录（字符串形式，便于传给 git 命令层）。
    pub fn path_str(&self) -> String {
        self.dir.path().to_string_lossy().to_string()
    }

    /// git2 仓库句柄。
    pub fn repo(&self) -> &Repository {
        &self.repo
    }

    /// 拆分为 `(TempDir, Repository)`，兼容既有 `create_test_repo` 风格的调用方。
    pub fn into_parts(self) -> (TempDir, Repository) {
        (self.dir, self.repo)
    }
}

/// 行尾无关地断言工作区文件内容与期望一致（`\r\n` 归一化为 `\n`）。
///
/// git 的 smudge（检出 / apply）会把 blob 按平台与全局 autocrlf 转成 CRLF，
/// 工作区字节是不透明平台数据；语义断言必须先归一化换行，否则 Windows 上必挂。
pub fn assert_content_eq(root: &Path, rel: &str, expected: &str) {
    let full = root.join(rel);
    let content =
        std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("read worktree {rel}: {e}"));
    assert_eq!(
        content.replace("\r\n", "\n"),
        expected,
        "worktree content mismatch: {rel}"
    );
}
