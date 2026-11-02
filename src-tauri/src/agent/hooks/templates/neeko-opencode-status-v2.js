// Neeko 状态上报插件（OpenCode 2.x, Promise API）。由 Neeko 设置页安装/更新/卸载，请勿原地编辑。
// V1 模板（templates/neeko-opencode-status.js，`export default async () => ({event})`）冻结存档；
// 本文件为 V2 重写：`export default { id, setup }` + `ctx.event.subscribe`，否则 2.x loader
// 直接拒载（`Plugin must export a default definition with an id and an effect or setup function`）。
// 事件面按 opencode 2.0.28 实测 + 二进制事件名字符串核对：
// - 生命周期：session.execution.started / .succeeded / .failed / .interrupted
//  （V1 的 created 事件仍在，updated 与 idle 事件已消失）。
// - 权限门：permission.asked（仍在）/ permission.replied；V1 的 ask 提问事件在 2.x
//   无对应事件（ask 阻塞走权限族统一上报，未覆盖到即记 follow-up，不在此静默捏造）。
// - 包络是 `{ type, data }`（V1 是 `{ type, properties }`），读 `data ?? properties` 双兼容。
// 语义与 V1 对齐：仅 completed 上报 turn_completed（failed/interrupted 不报，用户主动停不通知）；
// 硬约束（design T5）不变：
// - 每次上报前重扫坐标（目录 mtime 缓存）→ Neeko 重启换端口 / 多实例并存都自动跟上；
// - 800ms 超时 + 全异常吞掉（fail-open）→ 绝不阻塞或拖慢 OpenCode；
// - 未知事件一律忽略；Neeko 未运行（坐标缺失）静默。
// v5 多实例（R6.8）：坐标是 `~/.neeko/agent-hooks/endpoints/*.env`（每实例一个文件），
// 逐个 POST；死坐标连接失败静默跳过，不影响其余实例与 CLI。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 单文件覆盖（调试/测试夹具）：设置后只读该文件，不扫目录。
const ENDPOINT_FILE = process.env.NEEKO_AGENT_HOOK_ENDPOINT || null;
// v5 多实例：每实例一个坐标文件，上报前扫全部并逐个投递。
const ENDPOINTS_DIR =
  process.env.NEEKO_AGENT_HOOK_ENDPOINTS_DIR ||
  join(homedir(), ".neeko", "agent-hooks", "endpoints");
const REPORT_TIMEOUT_MS = 800;

let cacheKey = "";
let cachedCoords = [];

function parseCoords(text) {
  const get = (name) => {
    const m = text.match(new RegExp("^" + name + "=(.+)$", "m"));
    return m ? m[1].trim() : undefined;
  };
  const port = get("NEEKO_AGENT_HOOK_PORT");
  const token = get("NEEKO_AGENT_HOOK_TOKEN");
  return port && token ? { port, token } : null;
}

function readCoords(file) {
  try {
    return parseCoords(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// 坐标发现（每次上报前调用，缓存避免重复读盘）：
// - 单文件覆盖：cache key = 文件 mtime+ino；
// - 多实例目录：cache key = **目录** mtime（增删实例文件会改目录 mtime）。
// 任何失败 → 空数组（Neeko 未运行 → 静默）；数组天然兼容 0..N 个坐标。
function coords() {
  if (ENDPOINT_FILE) {
    try {
      const st = statSync(ENDPOINT_FILE);
      const key = "f:" + st.mtimeMs + ":" + st.ino;
      if (key !== cacheKey) {
        cacheKey = key;
        const c = readCoords(ENDPOINT_FILE);
        cachedCoords = c ? [c] : [];
      }
    } catch {
      cacheKey = "";
      cachedCoords = [];
    }
    return cachedCoords;
  }
  try {
    const st = statSync(ENDPOINTS_DIR);
    const key = "d:" + st.mtimeMs;
    if (key !== cacheKey) {
      const list = [];
      for (const name of readdirSync(ENDPOINTS_DIR)) {
        if (!name.endsWith(".env")) continue;
        const c = readCoords(join(ENDPOINTS_DIR, name));
        if (c) list.push(c);
      }
      cacheKey = key;
      cachedCoords = list;
    }
  } catch {
    cacheKey = "";
    cachedCoords = []; // Neeko 未运行 / 目录不存在 → 静默
  }
  return cachedCoords;
}

async function post(event, agentSessionId, cwd, detail, title) {
  const list = coords();
  if (!list.length || !agentSessionId) return;
  const body = JSON.stringify({
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
  });
  // fan-out：每个坐标一次 POST，逐个 fail-open（单坐标失败不影响其余，也不影响 CLI）。
  await Promise.allSettled(
    list.map(async (c) => {
      try {
        await fetch(`http://127.0.0.1:${c.port}/hook/opencode`, {
          method: "POST",
          signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            "x-neeko-agent-hook-token": c.token,
          },
          body,
        });
      } catch {
        // fail-open：Neeko 不在/超时/被拒 —— 与 OpenCode 会话无关，静默。
      }
    }),
  );
}

// 取首个非空字符串（V2 各事件载荷字段位置不一，多候选直读，缺失即 undefined）。
function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

// sessionID → directory/title（started/created 事件携带；缺失回退 process.cwd()/null）。
// 常驻进程防无界增长：超过上限整体清空（丢的只是冷会话目录，回退无害）。
const MAX_TRACKED_SESSIONS = 200;
const sessionDirs = new Map();
const sessionTitles = new Map();

function trackSession(id, directory, title) {
  if (!id) return;
  if (sessionDirs.size > MAX_TRACKED_SESSIONS) {
    sessionDirs.clear();
    sessionTitles.clear();
  }
  if (directory) sessionDirs.set(id, directory);
  // 标题可能后到（AI 命名）：每次都更新（update 语义，非 set-if-absent）。
  if (title) sessionTitles.set(id, title);
}

// 事件未带目录/标题时的懒回查（2.x 无标题增量事件，标题后到只能现取）。
// fail-open：查不到即 undefined，调用方回退。
async function sessionField(ctx, sessionID, field) {
  try {
    const res = await ctx.session.get({ sessionID });
    const info = res?.data ?? res ?? {};
    return pick(info, [field]);
  } catch {
    return undefined;
  }
}

export default {
  id: "neeko-status",
  setup: async (ctx) => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            const type = event && event.type;
            // V2 包络 `{type, data}`，兼读 V1 `{type, properties}` 以便跨版本不断流。
            const d = (event && (event.data ?? event.properties)) || {};
            const info = d.info && typeof d.info === "object" ? d.info : d;

            if (type === "session.created") {
              const id = pick(info, ["id"]);
              trackSession(id, pick(info, ["directory"]), pick(info, ["title"]));
              continue;
            }
            if (type === "session.deleted") {
              const id = pick(d, ["sessionID", "sessionId", "session_id"]) ?? pick(info, ["id"]);
              if (id) {
                sessionDirs.delete(id);
                sessionTitles.delete(id);
              }
              continue;
            }
            if (type === "session.execution.started") {
              const id =
                pick(d, ["sessionID", "sessionId", "session_id"]) ?? pick(info, ["id"]);
              trackSession(
                id,
                pick(d, ["directory"]) ?? pick(info, ["directory"]) ?? sessionDirs.get(id),
                pick(d, ["title"]) ?? pick(info, ["title"]) ?? sessionTitles.get(id),
              );
              continue;
            }
            // 仅 completed 上报（failed/interrupted 不报 —— 对齐 V1“用户主动停不通知”语义；
            // hook 上报的失败类事件服务端 classify 本来也会丢弃）。
            if (type === "session.execution.succeeded") {
              const id =
                pick(d, ["sessionID", "sessionId", "session_id"]) ?? pick(info, ["id"]);
              if (!id) continue;
              const dir =
                sessionDirs.get(id) ?? (await sessionField(ctx, id, "directory"));
              const title =
                sessionTitles.get(id) ?? (await sessionField(ctx, id, "title"));
              if (dir) sessionDirs.set(id, dir);
              if (title) sessionTitles.set(id, title);
              void post("turn_completed", id, dir, null, title);
              continue;
            }
            if (type === "permission.asked") {
              const id =
                pick(d, ["sessionID", "sessionId", "session_id"]) ?? pick(info, ["id"]);
              if (!id) continue;
              const rawPermission = d.permission ?? info.permission;
              const detail =
                typeof rawPermission === "string" && rawPermission
                  ? "权限请求：" + rawPermission
                  : null;
              const dir =
                sessionDirs.get(id) ?? (await sessionField(ctx, id, "directory"));
              const title =
                sessionTitles.get(id) ?? (await sessionField(ctx, id, "title"));
              if (dir) sessionDirs.set(id, dir);
              if (title) sessionTitles.set(id, title);
              void post("approval_requested", id, dir, detail, title);
              continue;
            }
            // 其余事件（step/tool 进展、permission.replied、compaction 等）与通知无关，忽略。
          } catch {
            // fail-open：本处理器任何异常不得抛回 OpenCode 运行时。
          }
        }
      } catch {
        // 订阅结束（abort）—— 忽略。
      }
    })();
    return () => controller.abort();
  },
};
