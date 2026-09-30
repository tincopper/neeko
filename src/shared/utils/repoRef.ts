/**
 * 仓库单元身份（`RepoKey`）—— git status 在前端的唯一寻址单位。
 *
 * **为什么需要**：`git status = f(HEAD, index, workdir)`，而 linked worktree 的这三者
 * 全都独立（只共享 object DB）。一个 Neeko project 因此在 git 语义下是 `1 + N` 个仓库
 * 单元。此前前端只有一个 per-project 的 `changed_files` 槽、后端只有一 per-project 的
 * 快照与 version 计数，worktree 视图于是既没有权威生产者、又与主仓互相覆盖。
 *
 * **单一实现处**：key 的字符串形态与 Rust 侧 `crate::common::git::RepoRef::key()` 逐字
 * 对齐（双端各有一条 golden 测试钉住同一输入 → 同一输出）。除本文件外不得再手写
 * `{projectId}:{wtPath}` 之类的拼接（那是同一份身份的第二种表示，会再次分叉）。
 *
 * **路径分量必须是 canonical 形态**：由后端产出（`RepoRef::resolve` 在构造时就
 * canonicalize，见 `path_guard::canonicalize_worktree_path`）。前端不做任何字符串归一 ——
 * 归一化属路径身份判定（红线 12），双向各归一必然漂移。
 */

/** 分隔符：NUL 在 POSIX 与 Windows 文件名里都不允许出现 → key 反解永无歧义。 */
export const REPO_KEY_SEP = '\u0000';

/** 品牌化字符串：禁止把任意字符串当 RepoKey 传进 store / 命令。 */
export type RepoKey = string & { readonly __repoKey: unique symbol };

/**
 * 构造仓库单元 key。
 *
 * @param projectId 项目 ID
 * @param worktreePath 后端回传的 canonical worktree 路径；主仓传 `null` / `undefined` / `''`
 */
export function repoKeyOf(projectId: string, worktreePath?: string | null): RepoKey {
  const tail = worktreePath && worktreePath.trim() !== '' ? worktreePath : '';
  return `${projectId}${REPO_KEY_SEP}${tail}` as RepoKey;
}

/** 反解 key。仅用于日志/分组渲染；生产代码应直接持有 RepoKey 与分量。 */
export function parseRepoKey(key: string): { projectId: string; worktreePath: string | null } {
  const idx = key.indexOf(REPO_KEY_SEP);
  if (idx < 0) return { projectId: key, worktreePath: null };
  const tail = key.slice(idx + 1);
  return { projectId: key.slice(0, idx), worktreePath: tail === '' ? null : tail };
}

/** 是否主仓单元（项目根本身）。 */
export function isMainUnit(key: string): boolean {
  return parseRepoKey(key).worktreePath === null;
}

/**
 * 日志 / 提示用的可读标签：`p1 (main)` / `p1 → /wt/a`。
 *
 * **只用于展示，禁止反解回去当 key 用** —— 它是有损的（路径里出现 `→` 时无法还原）。
 * 形态刻意与 `RepoKey` 不像（空格 + 箭头，而非「两段拼接」），因为护栏只拦 `:` / `|` 形态的
 * 手拼 key（`check_repo_unit_identity` 的第 6 类判据），对展示形态没有约束力 —— 防误用只能靠
 * 形态自证 + 这条禁令。
 *
 * 存在理由是 `String(repoKey)` 会把分隔符 NUL（`REPO_KEY_SEP`）带进日志：实测一次挂载失败
 * 日志就让日志文件被 `file(1)` 判成 `data`（二进制），日志检索与轮转工具一并失效。凡是
 * 「把 RepoKey 写进日志/用户提示」的地方都走本函数。
 */
export function repoKeyLabel(key: RepoKey | string): string {
  const { projectId, worktreePath } = parseRepoKey(String(key));
  return worktreePath === null ? `${projectId} (main)` : `${projectId} → ${worktreePath}`;
}

/**
 * 单元相对路径的**基准目录**（= 该单元的工作树根，与 Rust `RepoRef::work_dir()` 同义）。
 *
 * `file-changed` / `file-tree-changed` 的 `paths` / `dirs`、以及 status 快照条目的 path，都是
 * 相对**该单元工作树根**的 —— watcher 挂在单元上（Rust 侧 `strip_prefix(repo.work_dir())`），
 * 所以消费侧还原绝对路径、做同文件判定时，基准必须与产出侧同源。
 *
 * 用项目根去拼 worktree 相对路径会得到**主仓里的另一个同名文件**（`src/a.ts` 在两个工作树里
 * 同形不同义）⇒ 判定恒漏配。主仓单元（key 尾段为空）回落到项目登记路径。
 */
export function unitWorkDir(repoKey: string, projectRoot: string): string {
  return parseRepoKey(repoKey).worktreePath ?? projectRoot;
}
