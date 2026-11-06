// Neeko 状态上报扩展（OMP）。由 Neeko 设置页安装/更新/卸载，请勿原地编辑。
//
// 这是 pi 扩展模板（`neeko-pi-status.ts`）的**派生变体**：OMP 与 pi 共用同一扩展 API
// （本机 ~/.omp/agent/extensions/orca-agent-status.ts 为证，其注释明写
// "Pi and OMP expose the same extension API"），但 OMP **不发射 `ui_prompt_start`**
// （2026-10-16 实测：OMP 二进制内 withUIPrompt / emitUIPromptEvent / UIPromptStartEvent
// 均 0 命中，而 pi 的 ExtensionEvent union 含 UIPromptStartEvent/UIPromptEndEvent）。
// 故本变体 = pi 模板 **减去** ui_prompt_start 段，保留：
//   agent_settled / agent_end（轮次完成，见下）、tool_call（ask 类工具 → 等待审批）、
//   session_start（会话身份）。
//
// 完成腿与 pi 模板**判据不同**（实测 omp 18.14.1 二进制：`agent_settled` 0 命中，
// `willContinue` 38 命中）：OMP 不发 `agent_settled`，而是用 `agent_end.willContinue` 标出
// 「这一轮还会继续」（重试 / 压缩 / 队列续跑）。两条腿同时注册，`agent_settled` 一旦出现
// 就永久让位 —— 与 pi 同形，但 OMP 上永远不会置位。
//
// 会话来源门与 pi 模板同因（in-process 子 agent 会话继承本扩展 + `NEEKO_SESSION_ID` 是
// 进程级 env）：见 `isChildSession`。
//
// 为什么不写成一个模板 + 运行时分支：模板必须零 CLI 分支（红线 15 精神），
// 差异靠「独立文件」承载（与 writers 的 Standalone 形态一致）。
//
// 硬约束（design T5）：坐标每次上报前重扫（目录 mtime 缓存）；800ms 超时；
// 一切异常吞掉（fail-open）—— 扩展 handler 会被 await，投递必须永不拖慢/阻塞会话。
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
    },
  });
  // fan-out：每个坐标一次 POST，逐个 fail-open（单坐标失败不影响其余，也不影响 CLI）。
  await Promise.allSettled(
    list.map(async (c) => {
      try {
        await fetch(`http://127.0.0.1:${c.port}/hook/omp`, {
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

// 子会话判定：与 pi 模板同一判据（同一个 pi 扩展 API，`sessionManager.getHeader()`
// 的 `parentSession` 是唯一可靠来源）。为什么必须整条不上报见 pi 模板同名函数的注释：
// `NEEKO_SESSION_ID` 是 **PTY 进程级** env，子会话的完成事件会把父会话判成已完成。
// fail-open：判不出来就按根会话上报。
function isChildSession(ctx) {
  try {
    const sm = ctx && ctx.sessionManager;
    const header = sm && typeof sm.getHeader === "function" ? sm.getHeader() : null;
    const parent = header && header.parentSession;
    return typeof parent === "string" && parent.length > 0;
  } catch {
    return false;
  }
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
  // OMP 目前不发 `agent_settled`（二进制实测 0 命中），但保留该腿：新版若补上则自动生效。
  let settledSupported = false;

  // **唯一的注册入口**：子会话门只此一处（与 pi 模板同形，理由见 isChildSession 注释）。
  // 逐个 handler 加门时，「第 N 个 handler 忘加」的表现是静默污染父会话。
  function onStatus(name, handler) {
    pi.on(name, (event, ctx) => {
      if (isChildSession(ctx)) return;
      return handler(event, ctx);
    });
  }

  function postCompletion(ctx) {
    void post("turn_completed", sessionIdOf(ctx) || lastSessionId, null, topicOf(ctx));
  }

  onStatus("session_start", (_event, ctx) => {
    // 子会话不得改写 `lastSessionId`（身份兜底不能被子 agent 抢走）。
    lastSessionId = sessionIdOf(ctx) || lastSessionId;
  });

  // 稳定终点（OMP 18.x 不发；旧版 / 未来版兼容腿）。
  onStatus("agent_settled", (_event, ctx) => {
    settledSupported = true;
    postCompletion(ctx);
  });

  // 一轮结束：`willContinue === true` 是**非终态**（重试 / 压缩 / 队列续跑）。
  // 不加这条判据时，子 agent 并行期间的主 agent 重试会先报一次完成 —— 与「只认 agent_end」
  // 的 pi 事故同一形态。
  onStatus("agent_end", (event, ctx) => {
    if (settledSupported) return;
    if (event && event.willContinue === true) return;
    postCompletion(ctx);
  });

  // ask 类工具发起 = 等待用户行动。
  onStatus("tool_call", (event, ctx) => {
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

}
