// Neeko 状态上报扩展（Pi）。由 Neeko 设置页安装/更新/卸载，请勿原地编辑。
// 事件面按 pi 1.1.0 实测：agent_end（轮次完成）、tool_call(ask 类工具→等待审批)、
// ui_prompt_start（等待输入）。无类型 import：与 orca 同款决策，避免依赖 pi 私有包类型。
// 硬约束（design T5）：坐标每次上报前重扫（目录 mtime 缓存）；800ms 超时；
// 一切异常吞掉（fail-open）——pi 会 await 扩展 handler，投递必须永不拖慢/阻塞会话。
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

async function post(event, agentSessionId, detail, title) {
  const list = coords();
  if (!list.length || !agentSessionId) return;
  const body = JSON.stringify({
    agent_session_id: String(agentSessionId),
    event,
    // pi 扩展运行在 CLI 进程内，process.cwd() 即用户启动 pi 的目录。
    cwd: process.cwd(),
    detail: typeof detail === "string" ? detail.slice(0, 500) : null,
    // 会话主题（Neeko R7）：原生名（用户显式命名）优先，无则首条用户消息。
    title: typeof title === "string" && title ? title.slice(0, 200) : null,
    hints: {
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
        await fetch(`http://127.0.0.1:${c.port}/hook/pi`, {
          method: "POST",
          signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            "x-neeko-agent-hook-token": c.token,
          },
          body,
        });
      } catch {
        // fail-open：静默。
      }
    }),
  );
}

function sessionIdOf(ctx) {
  const id = ctx && ctx.sessionManager && ctx.sessionManager.getSessionId
    ? ctx.sessionManager.getSessionId()
    : null;
  return typeof id === "string" && id ? id : null;
}

// 首条用户消息 -> 主题：message.content 可能是 string 或 (TextContent|ImageContent)[]，
// 只取首个文本块的首个非空行（副标题是单行展示位）。
function messageTopic(content) {
  const texts = typeof content === "string"
    ? [content]
    : Array.isArray(content)
      ? content.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text)
      : [];
  for (const text of texts) {
    const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    if (line) return line.slice(0, 200);
  }
  return null;
}

// 首条用户消息的缓存只增不减（会话 append-only，首次命中即终值）；仅缓存成功值，
// 避免在 prompt 尚未落盘时把 null 定死。上限与 opencode 模板同口径。
const MAX_CACHED_TOPICS = 200;
const firstMessageTopics = new Map();

// 会话主题（R7.5）：pi 原生名（用户命名）优先 → 首条用户消息 → null（服务端落空副标题）。
// 一切异常吞掉：主题是锦上添花，不能影响上报本身。
function topicOf(ctx) {
  try {
    const sm = ctx && ctx.sessionManager;
    if (!sm) return null;
    const name = typeof sm.getSessionName === "function" ? sm.getSessionName() : undefined;
    if (typeof name === "string" && name.trim()) return name.trim().slice(0, 200);

    const sid = sessionIdOf(ctx);
    if (!sid) return null;
    if (firstMessageTopics.has(sid)) return firstMessageTopics.get(sid);

    const entries = typeof sm.getEntries === "function" ? sm.getEntries() : [];
    for (const entry of entries) {
      const msg = entry && entry.type === "message" ? entry.message : null;
      if (!msg || msg.role !== "user") continue;
      const topic = messageTopic(msg.content);
      if (!topic) continue; // 首条用户消息可能只有图片 → 顺延到下一条
      if (firstMessageTopics.size > MAX_CACHED_TOPICS) firstMessageTopics.clear();
      firstMessageTopics.set(sid, topic);
      return topic;
    }
  } catch {
    // fail-open：拿不到主题不影响上报。
  }
  return null;
}

// ask 类工具名判定（归一化后比较，对齐 orca 实测的两个名字）。
function isAskTool(toolName) {
  const k = String(toolName || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return k === "askuserquestion" || k === "requestuserinput";
}

export default function (pi) {
  let lastSessionId = null;

  pi.on("session_start", (_event, ctx) => {
    lastSessionId = sessionIdOf(ctx) || lastSessionId;
  });

  // 一轮结束（turn 完成）。
  pi.on("agent_end", (_event, ctx) => {
    void post("turn_completed", sessionIdOf(ctx) || lastSessionId, null, topicOf(ctx));
  });

  // ask 类工具发起 = 等待用户行动。
  pi.on("tool_call", (event, ctx) => {
    if (isAskTool(event && event.toolName)) {
      const question = event && event.input && event.input.question;
      void post(
        "approval_requested",
        sessionIdOf(ctx) || lastSessionId,
        typeof question === "string" ? question : null,
        topicOf(ctx),
      );
    }
  });

  // UI 提问（等待用户行动）：pi 1.1.0 的 `ui_prompt_start` 载荷是
  // `{reason:"ui_prompt", kind:"select|confirm|input|editor|custom", title?}` ——
  // 没有 `text`/`message` 字段（早期按 orca 猜测的字段名取不到值，detail 恒为 null）。
  //
  // `kind:"confirm"` 是「是否继续」类询问（=审批语义），映射到 approval_requested，
  // 与 opencode 的 permission.asked 同键；其余 kind 是索取输入，映射 input_requested。
  // 两者同属 ActionRequired 类别，差别只在事件键（用户可分别开关 + 文案不同）。
  pi.on("ui_prompt_start", (event, ctx) => {
    const kind = event && typeof event.kind === "string" ? event.kind : null;
    const title = event && typeof event.title === "string" ? event.title : null;
    const detail = title || (kind ? `等待${kind}输入` : null);
    void post(
      kind === "confirm" ? "approval_requested" : "input_requested",
      sessionIdOf(ctx) || lastSessionId,
      detail,
      topicOf(ctx),
    );
  });
}
