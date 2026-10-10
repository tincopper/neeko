/**
 * Workspace 身份（`WorkspaceSession` 值对象 + `WorkspaceKey` 索引）—— git status / tab /
 * 命令寻址在前端的唯一身份词汇。
 *
 * **为什么 types 与 utils 同文件**：`WorkspaceSession` 的 `key` getter 需要分隔符材质
 * （`WORKSPACE_KEY_SEP`，护栏 `check_workspace_identity` 判据 6 的材质白名单只登记本文件）；
 * 拆回 `types/workspace.ts` 会形成 types↔utils 循环导入（ESLint `import/no-cycle` 是 error）。
 * 因此值对象本体住在这里，`@/shared/types/workspace` 只做 re-export（既有导入路径全部稳定）。
 *
 * **三形态词汇表（封闭，不存在第四种）**：
 * - `ProjectId` —— 项目身份品牌；铸造点唯一：api wrapper（后端 UUID 到达处 cast 一次）。
 * - `WorkspaceSession` —— Workspace 身份·**值**（class，私有构造；key 是它的只读投影）。
 *   铸造点：身份源（`activeWorkspaceSession` / 后端回显 / golden 测试）。
 * - `WorkspaceKey` —— Workspace 身份·**索引**（品牌 string）；铸造点唯一：`session.key`
 *   getter（内部 `mintWorkspaceKey`）。只允许出现在 map/record 的键位。
 *
 * **单一实现处**：key 的字符串形态与 Rust 侧 `crate::common/git/workspace_ref.rs::WorkspaceRef::key()`
 * 逐字对齐（双端各有一条 golden 测试钉住同一输入 → 同一输出）。除本文件外不得再手写
 * `{projectId}\0{wtPath}` 之类的拼接（那是同一份身份的第二种表示，会再次分叉）。
 *
 * **路径分量必须是后端产出的身份形态**：`WorkspaceRef::resolve` 在构造时归一，
 * 落在 `src-tauri/src/common/git/checkout_path.rs` 的 **identity 渲染**（平台无关字母表：
 * `/` 分隔、无 `\\?\` 前缀、盘符大写）。前端不做任何字符串归一 —— 归一化属路径身份判定
 * （红线 12），双向各归一必然漂移。
 */

/** 分隔符：NUL 在 POSIX 与 Windows 文件名里都不允许出现 → key 反解永无歧义。 */
export const WORKSPACE_KEY_SEP = '\u0000';

/** 品牌化字符串：禁止把任意字符串当 WorkspaceKey 传进 store / 命令。 */
export type WorkspaceKey = string & { readonly __workspaceKey: unique symbol };

/**
 * 项目身份品牌。铸造点唯一：api wrapper（后端返回 UUID 处 cast 一次）。
 * 与 `WorkspaceKey` 品牌互斥（不同 unique symbol）—— key 误入 id 槽位在编译期即报错。
 */
export type ProjectId = string & { readonly __projectId: unique symbol };

/** 键的唯一铸造实现（模块私有）。仅被 `WorkspaceSession#key` getter 调用。 */
function mintWorkspaceKey(projectId: string, worktreePath?: string | null): WorkspaceKey {
  const tail = worktreePath && worktreePath.trim() !== '' ? worktreePath : '';
  return `${projectId}${WORKSPACE_KEY_SEP}${tail}` as WorkspaceKey;
}

/**
 * `WorkspaceSession` —— 命令寻址用的 **Workspace 地址值对象**。
 *
 * **语义**：一次地址上下文 —— 「要在哪个 Workspace 上执行这次操作」。它是**值**，不含状态、
 * 不含生命周期，与 terminal/agent session、`SessionStore` 无关。
 *
 * **身份分量**：`projectId` + `worktreePath`。`worktreePath === null` ⟺ **主 checkout**
 * （local 分支）—— 这是**唯一**判别，不设独立 `kind` / `isWorktree` 字段（那会是同一事实的
 * 第二表示）。判别走单一谓词 `isMainCheckout`（同模块）。
 *
 * **key 是投影不是拼装**（≡ Rust `WorkspaceRef::key()`，模块注释：「生产代码持 WorkspaceRef
 * 本体，不从字符串逆向拼装身份」）：`session.key` 是属性（getter，构造后缓存）—— 分量错配
 * 与重复派生在构造上不可能；散件拼装 `workspaceKeyOf` / 反解 `parseWorkspaceKey` 已删除
 * （唯一 mint = `session.key`，唯一 codec = `fromKey` / `fromKeyOrId`）。
 *
 * **class + 私有构造**：interface 挡不住手搓字面量冒充 session；私有构造把「身份源单点」
 * 从纪律变成编译约束。getter 挂原型，不入 wire —— `JSON.stringify(session)` 只产出
 * `{ projectId, worktreePath }`，发给后端的载荷与改造前逐字节一致。
 *
 * **只携带身份**，不带解析后的根：根的权威在后端受信状态（`AppStateWrapper::resolve_workspace`），
 * 调用方无法伪造。
 */
export class WorkspaceSession {
  private constructor(
    readonly projectId: ProjectId,
    /** 后端回传的 canonical worktree 身份串；`null` = 主 checkout */
    readonly worktreePath: string | null,
  ) {}

  #key?: WorkspaceKey;

  /** 唯一的 key 铸造点（≡ Rust WorkspaceRef::key()，golden 测试双端钉住）。惰性缓存。 */
  get key(): WorkspaceKey {
    return (this.#key ??= mintWorkspaceKey(this.projectId, this.worktreePath));
  }

  /**
   * 构造只发生在身份源（`activeWorkspaceSession` / 后端回显 / golden 测试）。
   * 空串 / 空白 worktree 与 `null` 同归主仓（与 `mintWorkspaceKey` 的归一规则同源，
   * 否则 key 判主仓而 `isMainCheckout` 判 worktree —— 同一事实两种结论）。
   */
  static of(projectId: string, worktreePath: string | null): WorkspaceSession {
    const wt = worktreePath && worktreePath.trim() !== '' ? worktreePath : null;
    // 入场铸型：`of` 是身份源构造点（与 api wrapper 同类）—— 唯一一处把 project 分量收敛为
    // `ProjectId` 品牌；下游槽位（`session.projectId` / `tabProjectId`）因此恒为品牌类型，
    // 复合 WorkspaceKey 再也无法作为裸 string 混入项目身份。
    return new WorkspaceSession(projectId as ProjectId, wt);
  }

  /**
   * 反解：仅日志 / golden 测试 / **wire 边界**（事件载荷只携带 `workspace_key` 字符串、
   * 消费侧确需分量时，这是唯一 codec）。**禁止**在已持分量处逆向重建身份 —— 生产代码持
   * 本体（`WorkspaceSession`），不从字符串逆向拼装。非法输入（不含分隔符）返回 null。
   */
  static fromKey(key: string): WorkspaceSession | null {
    if (key.indexOf(WORKSPACE_KEY_SEP) < 0) return null; // 无分隔符 = 非法（旧裸 id 走 fromKeyOrId）
    const { projectId, worktreePath } = decodeWorkspaceKey(key);
    return new WorkspaceSession(projectId as ProjectId, worktreePath);
  }

  /**
   * 宽容反解（wire 兼容）：canonical key → session；**无分隔符的裸 id（旧形态载荷）→ 主仓**。
   *
   * 与 `fromKey` 的分工：`fromKey` 是严格 codec（非法返回 null）；本方法是**唯一**的
   * 「wire 只给字符串、消费侧要分量」桥 —— 旧的裸 `projectId` 载荷按主仓单元处理（与旧
   * 旧 `parseWorkspaceKey` 行为一致）。反解逻辑只此一处，消费侧不得再各自 `?? of(key, null)`。
   */
  static fromKeyOrId(key: string): WorkspaceSession {
    return WorkspaceSession.fromKey(key) ?? new WorkspaceSession(key as ProjectId, null);
  }
}

/**
 * 反解 key（**模块私有**）。仅供本模块的展示/工具函数（`isMainCheckout` / `workspaceKeyLabel`
 * / `workspaceRootOf`）内部使用；对外反解的唯一入口是 `WorkspaceSession.fromKey` / `fromKeyOrId`。
 */
function decodeWorkspaceKey(key: string): { projectId: ProjectId; worktreePath: string | null } {
  const idx = key.indexOf(WORKSPACE_KEY_SEP);
  // key 由本模块 mint，前段必为 projectId；解码仅供展示，不构成新的铸造点
  if (idx < 0) return { projectId: key as ProjectId, worktreePath: null };
  const tail = key.slice(idx + 1);
  return { projectId: key.slice(0, idx) as ProjectId, worktreePath: tail === '' ? null : tail };
}

/** 是否主仓单元（项目根本身）。接受 key 或已构造的 [`WorkspaceSession`]。 */
export function isMainCheckout(keyOrSession: string | WorkspaceSession): boolean {
  const wt =
    typeof keyOrSession === 'string'
      ? decodeWorkspaceKey(keyOrSession).worktreePath
      : keyOrSession.worktreePath;
  return wt === null;
}

/**
 * 日志 / 提示用的可读标签：`p1 (main)` / `p1 → /wt/a`。
 *
 * **只用于展示，禁止反解回去当 key 用** —— 它是有损的（路径里出现 `→` 时无法还原）。
 * 形态刻意与 `WorkspaceKey` 不像（空格 + 箭头，而非「两段拼接」），因为护栏只拦 `:` / `|` 形态的
 * 手拼 key（`check_workspace_identity` 的第 6 类判据），对展示形态没有约束力 —— 防误用只能靠
 * 形态自证 + 这条禁令。
 *
 * 存在理由是 `String(workspaceKey)` 会把分隔符 NUL（`WORKSPACE_KEY_SEP`）带进日志：实测一次挂载失败
 * 日志就让日志文件被 `file(1)` 判成 `data`（二进制），日志检索与轮转工具一并失效。凡是
 * 「把 WorkspaceKey 写进日志/用户提示」的地方都走本函数。
 */
export function workspaceKeyLabel(key: WorkspaceKey | string): string {
  const { projectId, worktreePath } = decodeWorkspaceKey(String(key));
  return worktreePath === null ? `${projectId} (main)` : `${projectId} → ${worktreePath}`;
}

/**
 * 单元相对路径的**基准目录**（= 该单元的工作树根，与 Rust `WorkspaceRef::work_dir()` 同义）。
 *
 * `file-changed` / `file-tree-changed` 的 `paths` / `dirs`、以及 status 快照条目的 path，都是
 * 相对**该单元工作树根**的 —— watcher 挂在单元上（Rust 侧 `strip_prefix(repo.work_dir())`），
 * 所以消费侧还原绝对路径、做同文件判定时，基准必须与产出侧同源。
 *
 * 用项目根去拼 worktree 相对路径会得到**主仓里的另一个同名文件**（`src/a.ts` 在两个工作树里
 * 同形不同义）⇒ 判定恒漏配。主仓单元（key 尾段为空）回落到项目登记路径。
 */
export function workspaceRootOf(workspaceKey: string, projectRoot: string): string {
  return decodeWorkspaceKey(workspaceKey).worktreePath ?? projectRoot;
}
