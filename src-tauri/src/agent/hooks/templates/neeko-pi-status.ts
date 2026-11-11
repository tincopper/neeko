// Neeko 状态上报扩展（Pi）。由 Neeko 设置页安装/更新/卸载，请勿原地编辑。
// 事件面按 pi 1.5.0 实测：agent_settled（轮次稳定终点，旧版回落 agent_end）、
// tool_call(ask 类工具→等待审批)、ui_prompt_start（等待输入）。
// 无类型 import：与 orca 同款决策，避免依赖 pi 私有包类型。
//
// 三条**必须**成立的判据（各由一次实测事故定义，改任一条都要先看注释）：
//   ① 会话来源门：in-process 子 agent 会话复用本扩展，`NEEKO_SESSION_ID` 是进程级 env，
//      子会话的完成事件会带着**父会话**的 id 上报（见 isChildSession）。
//   ② 完成腿判据：pi 的稳定终点是 `agent_settled`，`agent_end` 在重试 / 压缩 / 队列续跑时
//      会先发一次（只认 agent_end 就会在子 agent 还在跑时把父会话判成已完成）。
//   ③ 后台子 agent 花名册：`run_in_background` 时主 agent 报完「已启动」就**真的**结束回合，
//      `agent_settled` 照发 —— 孩子没跑完就不能上报完成（见 activeChildren）。
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

// 子会话判定：`pi-subagents` 用 `createAgentSession` + `bindExtensions` 在**同一个 pi 进程内**
// 起子 agent（agent 定义默认 `extensions: true`，本扩展因此被继承加载），子会话的
// sessionManager 头部带 `parentSession`。
//
// 为什么必须整条不上报（2026-11-06 实测）：`NEEKO_SESSION_ID` 由 Neeko 注入 **PTY 进程级**
// env，子会话继承同一个值 ⇒ 子 agent 的 `agent_end` 带着**父会话 id**到达服务端，
// `report_authoritative` 把父会话判成 `TurnFinished`（`Ready`）并置位权威门 —— 此后父会话的
// PTY 字节推断（`TurnStarted`）被永久吞掉，表现是「子 agent 还在跑，侧栏已显示完成」。
// 同一条通道还污染了父行的 `native_session_id`（first-writer-wins，指到子会话 transcript）
// 与标题（子 agent 的 prompt）。子会话自己的状态属于父会话的 `Running`，不该有独立上报。
//
// fail-open：判不出来（旧 pi 无 `getHeader` / `getSessionFile`）就按根会话上报 —— 宁多报不丢事件，
// 与整个 hook 的 fail-open 取向一致。
//
// 第二条判据（`getSessionFile`）：`pi-subagents` 的 `persistSession = nested ? false :
// rememberAgents`，为 false 时子会话走 `SessionManager.inMemory(cwd)`（**不传 options**）
// ⇒ header 里没有 `parentSession`，而 `isTopLevelAgent`（`parentAgentId !== undefined`）
// 又把 nested 孩子从花名册滤掉 ⇒ 前两道防线同时失效。inMemory 会话没有会话文件，
// 而 Neeko 用 `pi --mode rpc` 启动（不带 `--no-session`），用户可见的根会话必有文件。
// 能力检测不可省：不暴露 `getSessionFile` 的 CLI 会因「无文件」恒成立把**根会话**当子会话，
// 症状从「误判完成」变成「永不上报」（会话永久停在 Running）。
function isChildSession(ctx) {
  try {
    const sm = ctx && ctx.sessionManager;
    if (!sm) return false;
    const header = sm && typeof sm.getHeader === "function" ? sm.getHeader() : null;
    const parent = header && header.parentSession;
    if (typeof parent === "string" && parent.length > 0) return true;
    if (typeof sm.getSessionFile === "function") {
      return !sm.getSessionFile();
    }
    return false;
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
  // 本 pi 版本是否发 `agent_settled`。旧版没有该事件 ⇒ `agent_end` 仍是完成腿。
  let settledSupported = false;

  // **唯一的注册入口**：子会话门只此一处。
  //
  // 为什么是包装而不是每个 handler 自己加门：`pi.on` 有 5 个注册点，逐个加门时
  // 「第 N 个 handler 忘加」的表现是**静默污染父会话**（无报错、无日志），这正是本 bug
  // 的形态。收敛成一处后，漏门在模板里根本表达不出来（`pi.on` 只出现一次）。
  function onStatus(name, handler) {
    pi.on(name, (event, ctx) => {
      if (isChildSession(ctx)) return;
      return handler(event, ctx);
    });
  }

  function postCompletion(ctx) {
    void post("turn_completed", sessionIdOf(ctx) || lastSessionId, null, topicOf(ctx));
  }

  // ── ③ 后台子 agent 花名册 ────────────────────────────────────────────
  // 事实源：本机 `@tintinweb/pi-subagents@0.23.1` 在 `pi.events` 上发的
  // `subagents:started` / `subagents:completed` / `subagents:failed`（直读它的 dist/index.js），
  // 且一律先过 `isTopLevelAgent(record)` ⇒ nested / workflow 的孩子由各自 owner 报，
  // 不会重复计数。
  //
  // 为什么必须有（2026-11-06 真机反馈）：主 agent 用 `run_in_background: true` 派孩子时，
  // 它只负责「把任务交出去」，打印完 agent id 就结束回合 ⇒ pi 正常发 `agent_settled`。
  // 我们若立刻上报 `turn_completed`，后端会置位权威门，此后子 agent 的 spinner 帧再也推不动
  // 状态 —— 表现正是「侧栏显示已完成，实际还在跑」。
  //
  // id 键控的 Set 天然幂等：同一进程里父 / 子会话各绑一份本扩展时，同一条事件只会加一次；
  // 而子会话那份发不出任何东西 —— 它的 `lastSessionId` 被子会话门挡着，恒为 null。
  const activeChildren = new Set();
  // 「根已 settle、但被孩子拖住」的那次完成 —— 孩子清空时补发。
  let heldCompletion = null;
  // 本轮是否还没结（决定 started 走「拖住完成」还是走「重新开工」）。
  let turnOpen = false;
  // 已为「空闲期冒出来的孩子」上报过 `turn_started` ⇒ 孩子清空时必须补一次完成。
  let reopenedByChild = false;

  function childEventId(data) {
    const id = data && typeof data.id === "string" ? data.id.trim() : "";
    return id || null;
  }

  function resetRoster() {
    activeChildren.clear();
    heldCompletion = null;
    turnOpen = false;
    reopenedByChild = false;
  }

  // 结这一轮：有孩子在跑就拖住，等清空再发（发出去那一刻权威门才置位，语义才对）。
  function completeTurn(ctx) {
    turnOpen = false;
    if (activeChildren.size > 0) {
      if (ctx) heldCompletion = ctx;
      return;
    }
    heldCompletion = null;
    reopenedByChild = false;
    postCompletion(ctx);
  }

  function onChildrenDrained() {
    if (activeChildren.size > 0) return;
    const held = heldCompletion;
    heldCompletion = null;
    if (held) {
      completeTurn(held);
      return;
    }
    // 没有拖住的完成 ⇒ 只可能是「空闲期为孩子重新开过工」，收尾必须把它结掉。
    if (reopenedByChild) {
      reopenedByChild = false;
      void post("turn_completed", lastSessionId, null, null);
    }
  }

  function onChildStarted(data) {
    const id = childEventId(data);
    if (!id) return;
    const fresh = !activeChildren.has(id);
    activeChildren.add(id);
    if (!fresh) return;
    // 回合内派出的孩子不需额外上报 —— 那一轮还没结束，状态本来就是 Running。
    // 空闲期冒出来的（定时任务 / ctrl+b 转后台）必须报一条「还在干活」：那时后端已按上一次
    // 完成置了权威门，字节推断再也不会把会话推回 Running。
    if (!turnOpen && heldCompletion === null) {
      reopenedByChild = true;
      void post("turn_started", lastSessionId, null, null);
    }
  }

  function onChildFinished(data) {
    const id = childEventId(data);
    if (!id || !activeChildren.delete(id)) return;
    onChildrenDrained();
  }

  // 花名册订阅不属于 `onStatus`：`pi.events` 的回调没有 ctx，无从判会话来源。
  // 子会话那份实例因此不会误发（`lastSessionId` 恒 null ⇒ post 直接 return）。
  // 无 bus（旧版 / 未装 pi-subagents）⇒ 完全不订，行为退回「没有孩子信息」。
  const bus = pi && pi.events;
  if (bus && typeof bus.on === "function") {
    bus.on("subagents:started", onChildStarted);
    bus.on("subagents:completed", onChildFinished);
    bus.on("subagents:failed", onChildFinished);
  }

  onStatus("agent_start", (_event, ctx) => {
    // 身份兼底在这里也刷新一次：花名册回调没有 ctx，只能靠 `lastSessionId` 上报
    // （「空闲期孩子起来」那条路径）。只靠 `session_start` 会把这条腿绑在
    // 「session_start 必然已到」上 —— 那是对运行时的多余假设。
    lastSessionId = sessionIdOf(ctx) || lastSessionId;
    turnOpen = true;
    // 新一轮开始 ⇒ 旧的「拖住的完成」已被取代（用户已发下一条消息）。留着它会在孩子清空时
    // 把一个**正在跑**的回合判成完成 —— 症状与本次 bug 完全同形。新回合自己会产出完成。
    heldCompletion = null;
    reopenedByChild = false;
  });

  onStatus("session_start", (_event, ctx) => {
    const id = sessionIdOf(ctx) || lastSessionId;
    // 子会话不得改写 `lastSessionId`（身份兜底不能被子 agent 抢走）。
    // 换了会话（/new、resume 到别的文件）：上一代孩子的完成事件再也不会来了，
    // 花名册必须清空 —— 否则新会话会被一次「拖住的完成」永久卡在 Running。
    if (id && id !== lastSessionId) resetRoster();
    lastSessionId = id;
  });

  // 一轮结束（turn 完成）。`agent_settled` 是 pi 的**稳定终点**：
  // `agent_end` 之后还可能有自动重试 / 压缩重试 / 队列续跑（官方文档原文：
  // "agent_end is therefore not a final-idle signal; use agent_settled for that"）。
  // 还有孩子在跑时 `completeTurn` 会拖住这次上报（判据 ③）。
  onStatus("agent_settled", (_event, ctx) => {
    settledSupported = true;
    completeTurn(ctx);
  });

  // 旧版 pi（< 0.80.4）没有 `agent_settled`：完成腿回落到 `agent_end`。
  // 一旦见过 `agent_settled` 就永久让位 —— 否则重试中间那次 `agent_end` 会先报完成。
  onStatus("agent_end", (_event, ctx) => {
    if (settledSupported) return;
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

  // UI 提问（等待用户行动）：pi 1.1.0 的 `ui_prompt_start` 载荷是
  // `{reason:"ui_prompt", kind:"select|confirm|input|editor|custom", title?}` ——
  // 没有 `text`/`message` 字段（早期按 orca 猜测的字段名取不到值，detail 恒为 null）。
  //
  // `kind:"confirm"` 是「是否继续」类询问（=审批语义），映射到 approval_requested，
  // 与 opencode 的 permission.asked 同键；其余 kind 是索取输入，映射 input_requested。
  // 两者同属 ActionRequired 类别，差别只在事件键（用户可分别开关 + 文案不同）。
  onStatus("ui_prompt_start", (event, ctx) => {
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
