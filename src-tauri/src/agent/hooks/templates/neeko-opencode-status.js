// Neeko 状态上报插件（OpenCode）。由 Neeko 设置页安装/更新/卸载，请勿原地编辑。
// 事件面按 opencode 1.19.0 实测：session.created / session.updated / session.status(idle) /
// permission.asked（权限门）/ question.asked（ask 类工具阻塞等待）。后两者是**两个独立事件族**，
// 都投影为「等待用户行动」—— 只订阅 permission.asked 时 question 类阻塞不会有任何通知（实测）。
// 硬约束（design T5）：
// - 每次上报前重读 endpoint 文件（mtime+ino 缓存）→ Neeko 重启换端口后自动跟上；
// - 800ms 超时 + 全异常吞掉（fail-open）→ 绝不阻塞或拖慢 OpenCode；
// - 未知事件一律忽略；Neeko 未运行（endpoint 缺失）静默。
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENDPOINT_FILE =
  process.env.NEEKO_AGENT_HOOK_ENDPOINT ||
  join(homedir(), ".neeko", "agent-hooks", "endpoint.env");
const REPORT_TIMEOUT_MS = 800;

let cacheKey = "";
let cachedCoords = null;

function coords() {
  try {
    const st = statSync(ENDPOINT_FILE);
    const key = st.mtimeMs + ":" + st.ino;
    if (key !== cacheKey) {
      const text = readFileSync(ENDPOINT_FILE, "utf8");
      const get = (name) => {
        const m = text.match(new RegExp("^" + name + "=(.+)$", "m"));
        return m ? m[1].trim() : undefined;
      };
      const port = get("NEEKO_AGENT_HOOK_PORT");
      const token = get("NEEKO_AGENT_HOOK_TOKEN");
      cacheKey = key;
      cachedCoords = port && token ? { port, token } : null;
    }
  } catch {
    cacheKey = "";
    cachedCoords = null; // Neeko 未运行 → 静默
  }
  return cachedCoords;
}

async function post(event, agentSessionId, cwd, detail, title) {
  const c = coords();
  if (!c || !agentSessionId) return;
  try {
    await fetch(`http://127.0.0.1:${c.port}/hook/opencode`, {
      method: "POST",
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "x-neeko-agent-hook-token": c.token,
      },
      body: JSON.stringify({
        agent_session_id: String(agentSessionId),
        event,
        cwd: cwd || process.cwd(),
        detail: typeof detail === "string" ? detail.slice(0, 500) : null,
        // 会话主题（Neeko R7）：opencode 的 Session.title（AI 命名或用户命名）。
        // 占位形态（`New session - <ISO>`）由服务端过滤 —— 模板只如实上报。
        title: typeof title === "string" && title ? title.slice(0, 200) : null,
        hints: {
          // Neeko 自有终端启动的 OpenCode 才带有这两个 env（外部终端为 null → cwd 归属）。
          neeko_session_id: process.env.NEEKO_SESSION_ID || null,
          project_id: process.env.NEEKO_PROJECT_ID || null,
          // 团队身份（成员 PTY 注入）：缺这两条时上报会被判成「非团队上下文」并静默跳过，
          // 成员状态永不推进（判据：templates::tests 的 team identity env 守卫）。
          team_id: process.env.NEEKO_TEAM_ID || null,
          team_member_id: process.env.NEEKO_TEAM_MEMBER_ID || null,
        },
      }),
    });
  } catch {
    // fail-open：Neeko 不在/超时/被拒 —— 与 OpenCode 会话无关，静默。
  }
}

// ask 类工具（question）：`properties.questions` 是 `{header, question, options, multiple}[]`。
// 取首条的 header（短标签）优先、回落 question 正文 —— 两者都缺 → null（核心域落空 detail）。
function questionDetail(props) {
  try {
    const first = Array.isArray(props && props.questions) ? props.questions[0] : null;
    if (!first || typeof first !== "object") return null;
    if (typeof first.header === "string" && first.header.trim()) return first.header;
    if (typeof first.question === "string" && first.question.trim()) return first.question;
  } catch {
    // fail-open：详情拿不到不影响「等待用户行动」这一事实的上报。
  }
  return null;
}

// sessionID → directory（session.created 提供；缺失回退 process.cwd()）。
// 常驻进程防无界增长：超过上限整体清空（丢的只是冷会话目录，回退 cwd 无害）。
const MAX_TRACKED_SESSIONS = 200;
const sessionDirs = new Map();

// sessionID → title（session.created / session.updated 提供；缺失则不上报 title）。
// 与 sessionDirs 同生命周期与上限：标题在会话创建时可能还是占位串，AI 命名后会经
// session.updated 覆盖，故这里必须**每次都更新**（update 语义，非 set-if-absent）。
const sessionTitles = new Map();

export default async () => ({
  event: async ({ event }) => {
    try {
      const type = event && event.type;
      const p = (event && event.properties) || {};
      if (type === "session.created" && p.info && p.info.id) {
        if (sessionDirs.size > MAX_TRACKED_SESSIONS) {
          sessionDirs.clear();
          sessionTitles.clear();
        }
        sessionDirs.set(p.info.id, p.info.directory || "");
        if (typeof p.info.title === "string") sessionTitles.set(p.info.id, p.info.title);
        return;
      }
      // 标题可能后到（AI 命名）：created 时是 `New session - <时间戳>`，updated 才变真名。
      if (type === "session.updated" && p.info && p.info.id) {
        if (sessionDirs.size > MAX_TRACKED_SESSIONS) {
          sessionDirs.clear();
          sessionTitles.clear();
        }
        if (typeof p.info.directory === "string") {
          sessionDirs.set(p.info.id, p.info.directory);
        }
        if (typeof p.info.title === "string") sessionTitles.set(p.info.id, p.info.title);
        return;
      }
      if (type === "session.status" && p.sessionID && p.status && p.status.type === "idle") {
        void post(
          "turn_completed",
          p.sessionID,
          sessionDirs.get(p.sessionID),
          null,
          sessionTitles.get(p.sessionID),
        );
        return;
      }
      if (type === "permission.asked" && p.sessionID) {
        const detail = p.permission ? "权限请求：" + p.permission : null;
        void post(
          "approval_requested",
          p.sessionID,
          sessionDirs.get(p.sessionID),
          detail,
          sessionTitles.get(p.sessionID),
        );
        return;
      }
      // 1.19 的另一条阻塞路径：ask 类工具（question/`que_` id）。与 permission.asked 是
      // 两个独立事件族（前者=权限门，后者=向用户提问），都必须算「等待用户行动」。
      // 缺这一条时的实测症状：Neeko 里只看到任务完成通知，权限提示从不出现在系统通知里。
      //
      // **只订阅 `asked`**：`question.rejected` 是「用户已关闭该提问」的**结果态**
      // （二进制里的文案：The user dismissed this question），此时无人等待，通知即误报。
      if (type === "question.asked" && p.sessionID) {
        void post(
          "approval_requested",
          p.sessionID,
          sessionDirs.get(p.sessionID),
          questionDetail(p),
          sessionTitles.get(p.sessionID),
        );
      }
    } catch {
      // fail-open：本处理器任何异常不得抛回 OpenCode 运行时。
    }
  },
});
