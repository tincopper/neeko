//! Pi rpc 进程层：spawn、NDJSON 行读写、请求/响应配对。
//!
//! # 三条通道
//!
//! ```text
//! ① 命令（我们 → pi）   {"type":"prompt","id":"<uuid>","message":"…"}
//! ② 响应（pi → 我们）   {"type":"response","id":"<uuid>","success":bool,"data":…}
//! ③ 事件（pi → 我们）   无 id 的其它 JSON
//! ```
//!
//! 判别只看两条：`type == "response"` **且** 有 `id` → 响应；否则 → 事件。
//! 响应按 id 配对后**不进事件流** —— 混进去会让前端把 `get_state` 的回包
//! 当成一条对话事件渲染出来。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::common::error::AppError;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;

/// 辅助命令（`get_state` 之类）的默认超时。
///
/// `prompt` 不用这个 —— 它等到 `agent_settled`，可能几分钟。
const AUX_TIMEOUT: Duration = Duration::from_secs(5);

/// 保留的 stderr 尾部上限（字节）。
///
/// 有界的原因：stderr 是**诊断信息**，不是数据通道。病态输出（循环报错、
/// 日志回显）不能让一个只用来解释失败的缓冲无限涨下去。2KB 够放
/// `No session found matching '<id>'` 这类原因文案。
const STDERR_TAIL_LIMIT: usize = 2048;

/// 进程已结束（stdout 关闭）时，在途/新发请求的统一错误文案。
///
/// 比 `response channel closed` 可读：用户能看出是**进程没了**而不是协议错误。
const PROCESS_ENDED: &str = "pi rpc: process ended before responding";

/// 一条已建立的 pi rpc 连接。
pub struct PiRpcProcess {
    /// 写通道：命令序列化后逐行写入。
    stdin: Arc<Mutex<crate::common::executor::BoxAsyncWrite>>,
    /// 响应等待者：id → 一次性发送端。
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    /// 事件出口（**一次取走**）。
    ///
    /// 不留在本结构里长期持有：`PiRpcProcess` 是 `Arc` 共享给请求 pump 的（它需要
    /// `&self` 发命令），但事件流的是**单消费者**语义（只有 `AgentSession::next` 读）。
    /// 把单消费者资源放在多所有者容器里，就必然要用锁跨 `await` 或依赖「调用方
    /// 恰好不并发」的隐式约定 —— 两者都是把正确性寄望于外部。
    ///
    /// 所以连接只做「交出一次」：[`Self::take_events`]，之后由 `PiSession` 独占。
    events: std::sync::Mutex<Option<mpsc::Receiver<Value>>>,
    /// 强制终止（`KillFn` 本身可重复调用；这里仍加一个布尔避免重复投递）。
    killed: std::sync::atomic::AtomicBool,
    kill_fn: crate::common::executor::KillFn,
    /// 读循环是否已停止（stdout 关闭 **或** 事件消费端离开，见 [`spawn_reader`]）。
    ///
    /// # 为什么光有 `pending.clear()` 不够
    ///
    /// `clear()` 只能救「进程退出**时**正在等」的那一批。pi 失败退出很快
    /// （`--session <不存在>` → 立即 exit 1），于是握手第一条请求可能在
    /// 读循环**已经结束之后**才发出 —— 它永远等不到有人来 drop 它的 sender，
    /// 只能等满 `AUX_TIMEOUT`(5s)，报一句假的「超时」。
    ///
    /// 这个标志让那条请求在注册之后立刻看到「进程已结束」并快速失败。
    ended: Arc<std::sync::atomic::AtomicBool>,
    /// stderr 尾部与「已排空」信号（见 [`StderrSink`]）。
    stderr: Arc<StderrSink>,
}

/// stderr 的**有界**尾部 + 排空状态。
///
/// 抽成独立结构而不是两个散字段：尾部内容与「排空完成」是同一件事的两个观测面，
/// 必须由同一个 task 成对维护 —— 分开后没人保证 `done` 置位时尾部已经写完。
#[derive(Default)]
struct StderrSink {
    /// 有界尾部（见 [`STDERR_TAIL_LIMIT`]）。**只用于解释错误**。
    tail: std::sync::Mutex<String>,
    /// stderr 已 EOF（进程的 stderr 关闭）。
    done: std::sync::atomic::AtomicBool,
    /// 与 `done` 配套的唤醒：`annotate` 在尾部为空时**有界**等它收尾。
    settled: tokio::sync::Notify,
}

impl StderrSink {
    /// 往有界尾部追加一行。
    ///
    /// 归属在 `StderrSink` 上（而不是收一个 `&Mutex<String>`）：内容与它的上限是
    /// 同一件事的两个面，把锁字段穿过函数边界等于把「怎么存」泄给调用方。
    fn append(&self, line: &str) {
        let mut buf = self
            .tail
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !buf.is_empty() {
            buf.push('\n');
        }
        buf.push_str(line);
        let tail = tail_of(&buf, STDERR_TAIL_LIMIT).to_string();
        *buf = tail;
    }
}

impl PiRpcProcess {
    /// Spawn `pi --mode rpc --no-themes` 并开始读循环。
    ///
    /// `extra` 是用户在 agent 配置里写的 `args`（如 `--provider foo`），原样透传 ——
    /// 忽略等于用户的配置静默不生效，与 `AcpAdapter` / `DeepSeekHarnessAdapter` 一致。
    ///
    /// # 顺序：适配器参数放**最后**
    ///
    /// pi 解析重复选项是**后写者胜**（实测：`--mode json --mode rpc` → rpc；
    /// `--mode rpc --mode json` → json）。用户在启动参数里写 `--mode json`
    /// 就会把整条通道从 rpc 切成 json，协议层直接失效且没有任何报错。
    /// 所以我们自己的 `--mode rpc` 必须压在用户参数**之后**。
    ///
    /// 其余参数不受影响（pi 的 `[options]` 之间不敏感），用户照常能传
    /// `--provider` 之类。
    ///
    /// `--no-themes`：rpc 模式拿不到主题，加载它只是拖慢启动。
    pub async fn spawn(
        command: &str,
        cwd: &str,
        extra: &[&str],
        env: &[(&str, &str)],
    ) -> Result<Self, AppError> {
        let args = launch_args(extra);
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

        let child = exec::spawn(
            &ExecTarget::Local,
            command,
            &arg_refs,
            exec::SpawnSpec::new()
                .with_cwd(Some(cwd))
                .with_env(env)
                .kill_tree(),
        )
        .await
        .map_err(|e| {
            // ENOENT 时给可操作的提示，而不是让后面某次写 stdin 报 EPIPE。
            AppError::Io(format!(
                "failed to start `{command} --mode rpc`: {e}. \
                 Is pi installed and on PATH? (npm i -g @earendil-works/pi-coding-agent)"
            ))
        })?;

        let mut child = child;
        let (stdin, stdout, stderr) = child.take_stdio();
        let stdin = stdin.ok_or_else(|| AppError::Io("pi rpc: no stdin".into()))?;
        let stdout = stdout.ok_or_else(|| AppError::Io("pi rpc: no stdout".into()))?;

        // `into_wait_and_kill` 给出**可重复调用**的 kill 句柄。wait 必须有归属，
        // 否则进程退出后无人 reap（僵尸）。这里后台驱动它即可 —— 退出码对
        // NDJSON 协议没有用处，stdout 关闭已经是「进程没了」的信号。
        let (wait, kill_fn) = child.into_wait_and_kill();
        tokio::spawn(async move {
            let _ = wait.await;
        });

        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, events) = mpsc::channel(256);

        let ended = Arc::new(std::sync::atomic::AtomicBool::new(false));
        spawn_reader(stdout, Arc::clone(&pending), Arc::clone(&ended), event_tx);

        // stderr 不再丢弃：pi 把**失败原因**写在这里（`No session found matching
        // '<id>'`、auth 缺失、参数写错），而 NDJSON 通道只有 stdout。
        let stderr_sink = Arc::new(StderrSink::default());
        if let Some(stderr) = stderr {
            spawn_stderr_reader(stderr, Arc::clone(&stderr_sink));
        } else {
            stderr_sink
                .done
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }

        Ok(Self {
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            events: std::sync::Mutex::new(Some(events)),
            killed: std::sync::atomic::AtomicBool::new(false),
            kill_fn,
            ended,
            stderr: stderr_sink,
        })
    }

    /// 测试夹具：用现成的流构造连接，不起真进程。
    ///
    /// `stdout` 是被读取的一侧（模拟 pi 的输出），返回的 `PiRpcProcess`
    /// 事件来源就是它。`stdin` 侧用 `sink()` 丢弃写入 —— 测试不关心发出的命令。
    #[cfg(test)]
    pub fn from_split(stdout: tokio::io::DuplexStream, stdin: tokio::io::DuplexStream) -> Self {
        Self::from_split_with_stderr(stdout, stdin, None)
    }

    /// 同 [`Self::from_split`]，额外接管一条假 stderr 流（用来验证错误装饰）。
    #[cfg(test)]
    pub fn from_split_with_stderr(
        stdout: tokio::io::DuplexStream,
        stdin: tokio::io::DuplexStream,
        stderr: Option<tokio::io::DuplexStream>,
    ) -> Self {
        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, events) = mpsc::channel(64);
        let ended = Arc::new(std::sync::atomic::AtomicBool::new(false));
        spawn_reader(
            Box::pin(stdout),
            Arc::clone(&pending),
            Arc::clone(&ended),
            event_tx,
        );
        let stderr_tail = Arc::new(StderrSink::default());
        if let Some(stderr) = stderr {
            spawn_stderr_reader(Box::pin(stderr), Arc::clone(&stderr_tail));
        } else {
            stderr_tail
                .done
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        Self {
            stdin: Arc::new(Mutex::new(
                Box::pin(stdin) as crate::common::executor::BoxAsyncWrite
            )),
            pending,
            events: std::sync::Mutex::new(Some(events)),
            killed: std::sync::atomic::AtomicBool::new(false),
            kill_fn: Arc::new(|| Box::pin(async { Ok(()) }) as crate::common::executor::KillFuture),
            ended,
            stderr: stderr_tail,
        }
    }

    /// 保留的 stderr 尾部（无内容时为空串）。
    ///
    /// 消费点是 [`Self::annotate`] —— 握手失败时把 pi 自己的原因附在错误上。
    pub fn stderr_tail(&self) -> String {
        self.stderr
            .tail
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// 把 pi 的 stderr 尾部附在错误上（无可附内容时原样返回）。
    ///
    /// # 为什么是 `async` 且有界等待
    ///
    /// 进程退出时 stdout 与 stderr **同时** EOF，但两个读循环是两个独立 task，
    /// 谁先被调度是不确定的。若在 stdout 先 EOF、stderr 尚未读到的瞬间就取尾部，
    /// 错误信息会**随机**丢掉 pi 的真实原因（`No session found matching '<id>'`），
    /// 而我们正是为了让原因可见才保留 stderr。
    ///
    /// 因此：尾部为空且进程已结束 → 有界等待 stderr 排空（进程已死，EOF 随即到来；
    /// 300ms 只是防病态情况挂住调用方的上限）。
    pub async fn annotate(&self, err: AppError) -> AppError {
        let mut tail = self.stderr_tail();
        if tail.trim().is_empty() && self.ended.load(std::sync::atomic::Ordering::Relaxed) {
            // **同步注册**唤醒再查标志：只创建 `notified()` 而不 poll **不算注册**，
            // 那时写入方的 `notify_waiters()` 会被丢弃 —— 于是白等满 300ms
            // （尾部其实早已写好）。`enable()` 让注册在 await 之前完成，配合写入方
            // 「先置 done、后 notify」的顺序，两种交错都不丢唤醒：
            // 注册先 → 被唤醒；置位先 → 下面的 `done` 检查直接跳过等待。
            let notified = self.stderr.settled.notified();
            tokio::pin!(notified);
            let _ = notified.as_mut().enable();
            if !self.stderr.done.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = tokio::time::timeout(Duration::from_millis(300), notified.as_mut()).await;
            }
            tail = self.stderr_tail();
        }
        append_stderr(err, &tail)
    }

    /// 取走事件流的所有权（**只能成功一次**）。
    ///
    /// 调用方（`PiSession`）之后用 `&mut` 独占消费，因此 `next()` 不需要任何锁。
    /// 第二次调用返回 `None` —— 那意味着有人在重复取同一个流，属编程错误。
    pub fn take_events(&self) -> Option<mpsc::Receiver<Value>> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
    }

    /// 发一条命令并等它的响应。
    ///
    /// 超时后会把 id 从 pending 表移除 —— 否则迟到的响应会二次 settle
    ///（`oneshot::Sender` 已 drop，`send` 静默失败，但表项会一直堆积）。
    pub async fn request(
        &self,
        mut cmd: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        if let Some(obj) = cmd.as_object_mut() {
            obj.insert("id".into(), json!(id));
        }
        let line = format!("{cmd}\n");

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);

        {
            use tokio::io::AsyncWriteExt;
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| AppError::Io(format!("pi rpc write: {e}")))?;
            stdin
                .flush()
                .await
                .map_err(|e| AppError::Io(format!("pi rpc flush: {e}")))?;
        }

        // 读循环若**已经**结束（进程比我们写得还快），`pending.clear()` 早已跑过，
        // 刚注册的 sender 没人会 drop —— 不能等超时，得立刻失败。
        if self.ended.load(std::sync::atomic::Ordering::Relaxed) {
            self.pending.lock().await.remove(&id);
            return Err(AppError::Agent(PROCESS_ENDED.into()));
        }

        let wait = async move { rx.await.map_err(|_| AppError::Agent(PROCESS_ENDED.into())) };

        let timeout = timeout.unwrap_or(AUX_TIMEOUT);
        match tokio::time::timeout(timeout, wait).await {
            Ok(Ok(resp)) => Self::unwrap_response(resp),
            Ok(Err(e)) => Err(e),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(AppError::Agent(format!(
                    "pi rpc command timed out after {timeout:?}"
                )))
            }
        }
    }

    /// 发一条命令但**不等响应**（`prompt` 用：完成由 `agent_settled` 决定）。
    ///
    /// `id` 只在**缺省时**补 —— `extension_ui_response` 必须回携带 pi 自己发的
    /// 请求 id（`extension_ui_request.id`），那个值由协议规定，不是我们的 uuid。
    /// 无条件覆盖会让 pi 收到一个它不认识 id 的响应，审批永远无法完成
    ///（工具卡在等回答上，表现为「点了允许没反应」）。
    pub async fn send(&self, mut cmd: Value) -> Result<(), AppError> {
        if let Some(obj) = cmd.as_object_mut() {
            obj.entry("id")
                .or_insert_with(|| json!(uuid::Uuid::new_v4().to_string()));
        }
        use tokio::io::AsyncWriteExt;
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(format!("{cmd}\n").as_bytes())
            .await
            .map_err(|e| AppError::Io(format!("pi rpc write: {e}")))?;
        stdin
            .flush()
            .await
            .map_err(|e| AppError::Io(format!("pi rpc flush: {e}")))
    }

    /// pi 把失败放在 `success: false` + `error` 里，不是 JSON-RPC error。
    fn unwrap_response(resp: Value) -> Result<Value, AppError> {
        let ok = resp
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if ok {
            return Ok(resp.get("data").cloned().unwrap_or(Value::Null));
        }
        let err = resp
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        Err(AppError::Agent(format!("pi rpc command failed: {err}")))
    }

    /// 终止进程（幂等，不阻塞）。
    pub fn dispose(&self) {
        if self.killed.swap(true, std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        // kill 返回 future，必须 poll 才生效；丢到后台驱动，dispose 立刻返回。
        let fut = (self.kill_fn)();
        tokio::spawn(async move {
            let _ = fut.await;
        });
    }
}

/// 拼装 `pi` 的启动参数：用户参数在前，适配器契约在后。
///
/// 抽成纯函数是为了能直测顺序 —— `spawn` 要起真进程，在它内部拼装的话
/// 测试只能复制一遍逻辑，实现被改坏时测试仍绿（本项目踩过这个坑）。
#[must_use]
fn launch_args(user_args: &[&str]) -> Vec<String> {
    let mut args: Vec<String> = user_args.iter().map(|s| (*s).to_string()).collect();
    // 后写者胜：这两项必须在用户参数之后，见 `spawn` 的文档。
    args.extend([
        "--mode".to_string(),
        "rpc".to_string(),
        "--no-themes".to_string(),
    ]);
    args
}

/// 读循环：按行解析，响应进 pending，其余进事件通道。
fn spawn_reader(
    stdout: crate::common::executor::BoxAsyncRead,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    ended: Arc<std::sync::atomic::AtomicBool>,
    event_tx: mpsc::Sender<Value>,
) {
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut lines = BufReader::new(stdout).lines();

        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                // 实测 pi 1.3.0 不产生非 JSON 行；容错到 warn 即可，不做单独收集
                //（为一条从不触发的路径写收集+展示链路是没有验证手段的死重量）。
                log::warn!(
                    "[pi-rpc] non-JSON stdout line: {}",
                    trimmed.chars().take(200).collect::<String>()
                );
                continue;
            };

            // 响应：有 id 且 type=="response" → 按 id 配对，**不进事件流**。
            if value.get("type").and_then(Value::as_str) == Some("response") {
                if let Some(id) = value.get("id").and_then(Value::as_str) {
                    if let Some(tx) = pending.lock().await.remove(id) {
                        let _ = tx.send(value);
                    }
                }
                continue;
            }

            if event_tx.send(value).await.is_err() {
                break; // 消费端已 drop
            }
        }

        log::debug!("[pi-rpc] stdout closed");
        // 读循环结束 → 在途请求**立刻**失败，而不是退化成 `AUX_TIMEOUT`(5s) 超时。
        //
        // 两种成因共用这个标志（也共用同一条错误文案）：
        // 1. stdout EOF（进程没了）—— 生产上的唯一常见成因；
        // 2. 事件消费端 drop（见上方 `break`）—— 此时**没人再读本连接的事件**，
        //    请求也就注定答不出来（留看它的只会是一个已废弃的会话）。
        //
        // 先置 `ended` 再 `clear()`：否则「clear 之后、请求注册之前」的窗口里
        // 新发的请求会等满超时（见 `request` 的同名检查）。
        ended.store(true, std::sync::atomic::Ordering::Relaxed);
        pending.lock().await.clear();
    });
}

/// stderr 读循环：按行累积**有界**尾部。
///
/// 逐行而非逐字节：错误原因都是行文本，按行切能让尾部从一条完整的原因开始
///（而不是从半个 UTF-8 字符/半个单词）。
fn spawn_stderr_reader(stderr: crate::common::executor::BoxAsyncRead, sink: Arc<StderrSink>) {
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            sink.append(&line);
        }
        // 先置标志再唤醒：`annotate` 用「先注册 notified、后查标志」的顺序读取，
        // 两者配合才不丢唤醒。
        sink.done.store(true, std::sync::atomic::Ordering::Relaxed);
        sink.settled.notify_waiters();
    });
}

/// 取 `s` 的尾部（至多 `limit` 字节，且从字符边界开始）。
///
/// `&str` 切片必须落在字符边界上 —— 病态输出里可能有 CJK，按字节硬切会 panic。
#[must_use]
fn tail_of(s: &str, limit: usize) -> &str {
    if s.len() <= limit {
        return s;
    }
    let mut start = s.len() - limit;
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}

/// 把 stderr 尾部附在错误上。尾部为空（或只有空白）时原样返回。
///
/// # 为什么是纯函数
///
/// 「何时装饰」是策略，「装饰成什么形状」是格式 —— 后者要能被直测，不靠起进程。
/// 两者的分界线恰好是 `&self`：格式在这里，取尾部值在 [`PiRpcProcess::annotate`]。
#[must_use]
fn append_stderr(err: AppError, tail: &str) -> AppError {
    let tail = tail.trim();
    if tail.is_empty() {
        return err;
    }
    AppError::Agent(format!("{err} — pi stderr: {tail}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// 读循环测试夹具：`(客户端写端, 事件接收端, pending 表)`。
    type Harness = (
        tokio::io::DuplexStream,
        mpsc::Receiver<Value>,
        Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    );

    fn ended_flag() -> Arc<std::sync::atomic::AtomicBool> {
        Arc::new(std::sync::atomic::AtomicBool::new(false))
    }

    /// 等一个进程级标志置位：轮询 + `yield_now`，**不用 sleep**。
    ///
    /// 用它替代「sleep 几十毫秒，赌读循环已经跑过」：那种写法在慢机上会让用例退化成
    /// 走另一条分支，于是变异（删掉被测判据）仍然绿 —— 见两个 `*_fails_fast` 用例的注释。
    async fn wait_for(flag: &std::sync::atomic::AtomicBool) {
        while !flag.load(std::sync::atomic::Ordering::Relaxed) {
            tokio::task::yield_now().await;
        }
    }

    /// **顺序护栏**：适配器参数必须排在用户参数之后。
    ///
    /// pi 对重复选项是后写者胜。用户在启动参数里写了 `--mode json` 时，
    /// 若 `--mode rpc` 排在它前面就会被覆盖 —— 通道切成 json，整个 rpc 协议
    /// 失效且没有任何报错（表现为「Pi 连上了但永远没有回复」）。
    ///
    /// 变异验证：把 `spawn` 里的顺序换回来 → 本用例红。
    #[test]
    fn adapter_flags_come_after_user_args() {
        let extra = ["--provider", "x", "--mode", "json"];
        let args = launch_args(&extra);

        let mode_positions: Vec<usize> = args
            .iter()
            .enumerate()
            .filter(|(_, a)| **a == "--mode")
            .map(|(i, _)| i)
            .collect();
        assert_eq!(mode_positions.len(), 2, "user + adapter each provide one");
        // 最后一个 --mode 必须是 rpc
        let last = *mode_positions.last().unwrap();
        assert_eq!(
            args[last + 1],
            "rpc",
            "adapter --mode must be the last one so it wins"
        );
    }

    /// 用户参数原样出现在前面，不被丢弃也不被改写。
    #[test]
    fn user_args_are_preserved_verbatim() {
        let args = launch_args(&["--provider", "foo", "--session", "abc"]);
        assert_eq!(
            &args[..4],
            &["--provider", "foo", "--session", "abc"],
            "user args must survive"
        );
    }

    /// 空用户参数 → 只有适配器契约。
    #[test]
    fn empty_user_args_yield_only_adapter_flags() {
        assert_eq!(launch_args(&[]), vec!["--mode", "rpc", "--no-themes"]);
    }

    /// 用 duplex 管道驱动读循环，不起真进程。
    fn make_harness() -> Harness {
        let (client, server) = tokio::io::duplex(64 * 1024);
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (tx, rx) = mpsc::channel(64);
        spawn_reader(Box::pin(server), Arc::clone(&pending), ended_flag(), tx);
        (client, rx, pending)
    }

    #[tokio::test]
    async fn response_is_routed_to_pending_and_not_broadcast() {
        let (mut pi_side, mut events, pending) = make_harness();
        let (resp_tx, resp_rx) = oneshot::channel();
        pending.lock().await.insert("abc".into(), resp_tx);

        {
            use tokio::io::AsyncWriteExt;
            pi_side
                .write_all(
                    br#"{"type":"response","id":"abc","success":true,"data":{"ok":1}}
"#,
                )
                .await
                .unwrap();
        }

        let got = resp_rx.await.expect("response must be routed by id");
        assert_eq!(got["data"]["ok"], 1);
        assert!(
            events.try_recv().is_err(),
            "响应不得广播到事件流（否则前端会把回包渲染成对话事件）"
        );
    }

    #[tokio::test]
    async fn messages_without_id_are_broadcast_as_events() {
        let (mut pi_side, mut events, _pending) = make_harness();
        {
            use tokio::io::AsyncWriteExt;
            pi_side
                .write_all(
                    br#"{"type":"agent_start"}
"#,
                )
                .await
                .unwrap();
        }
        let ev = events.recv().await.expect("event");
        assert_eq!(ev["type"], "agent_start");
    }

    /// 非 JSON 行不能让读循环崩 —— 后续合法行还要能读到。
    #[tokio::test]
    async fn non_json_line_is_skipped_and_does_not_kill_the_loop() {
        let (mut pi_side, mut events, _pending) = make_harness();
        {
            use tokio::io::AsyncWriteExt;
            pi_side
                .write_all(b"Context: something human readable\n")
                .await
                .unwrap();
            pi_side
                .write_all(
                    br#"{"type":"agent_start"}
"#,
                )
                .await
                .unwrap();
        }
        let ev = events.recv().await.expect("still alive");
        assert_eq!(ev["type"], "agent_start");
    }

    /// 迟到的响应不得二次 settle：表项已被超时移除，读循环只能丢弃。
    #[tokio::test]
    async fn late_response_after_removal_is_dropped() {
        let (mut pi_side, _events, pending) = make_harness();
        // 模拟「超时后已移除」
        let (tx, _rx) = oneshot::channel::<Value>();
        drop(_rx); // 接收端已走
        pending.lock().await.insert("late".into(), tx);

        {
            use tokio::io::AsyncWriteExt;
            pi_side
                .write_all(
                    br#"{"type":"response","id":"late","success":true}
"#,
                )
                .await
                .unwrap();
        }
        // 读到后应当移除表项且不 panic
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            pending.lock().await.is_empty(),
            "迟到响应处理后应从 pending 移除"
        );
    }

    /// 保证测试夹具本身没被误用（StdMutex 只在此处占位）。
    #[allow(dead_code)]
    fn _assert_types() {
        let _ = StdMutex::new(());
    }

    /// **失败要快**：进程结束（stdout 关闭）后，**在途**请求不能退化成 5s 超时。
    ///
    /// 实测 `pi --session <不存在>` → 立即 exit 1（stderr 里写原因），stdout 一条
    /// 响应都没有。旧实现在读循环结束时只 `log::debug!`，于是握手那条请求只能
    /// 等满 `AUX_TIMEOUT`，报 `timed out after 5s` —— 慢 5 秒且原因完全错误（AC3）。
    ///
    /// 构造上故意**先确认请求已注册**（读到它写出的命令行）再让进程退出：
    /// 这样只有 `pending.clear()` 能 settle 它，`ended` 检查帮不上忙。
    ///
    /// 变异验证：删掉读循环末尾的 `pending.clear()` → 本用例卡到 5s 超时变红。
    #[tokio::test]
    async fn in_flight_request_fails_fast_when_the_process_ends() {
        use tokio::io::AsyncReadExt;

        let (pi_out, session_in) = tokio::io::duplex(64 * 1024);
        let (mut cmd_out, our_in) = tokio::io::duplex(64 * 1024);
        let proc = Arc::new(PiRpcProcess::from_split(session_in, our_in));

        let started = std::time::Instant::now();
        let req = {
            let proc = Arc::clone(&proc);
            tokio::spawn(async move {
                proc.request(json!({"type": "get_available_models"}), None)
                    .await
            })
        };

        // 读到写出的命令 = 请求已进 pending（注册发生在写之前）。
        let mut buf = [0u8; 64];
        let n = cmd_out.read(&mut buf).await.unwrap();
        assert!(n > 0, "请求必须真的发出去了");

        // 现在 pi 退出（stdout EOF）—— 在途请求必须立即失败。
        drop(pi_out);
        let err = req
            .await
            .expect("request task must not panic")
            .expect_err("process is gone");

        assert!(
            started.elapsed() < Duration::from_secs(1),
            "不得等满 AUX_TIMEOUT（{:?}）",
            started.elapsed()
        );
        assert!(
            err.to_string().contains("process ended before responding"),
            "文案得能看出是进程没了: {err}"
        );
    }

    /// 进程**已经死掉之后**才发出的请求也必须立即失败。
    ///
    /// 场景：pi 在 `--session <不存在>` 上瞬间 exit，握手第一条请求可能落在
    /// 「读循环已 `clear()` 完」之后 —— 那条 sender 永远不会被人 drop，只能等
    /// 满 5s。`ended` 标志就是为这个窗口存在的。
    ///
    /// 变异验证：删掉 `request` 里的 `ended` 检查 → 本用例卡到 5s 超时变红。
    #[tokio::test]
    async fn request_after_the_process_ended_fails_fast() {
        let (pi_out, session_in) = tokio::io::duplex(64 * 1024);
        let (_cmd_out, our_in) = tokio::io::duplex(64 * 1024);
        let proc = PiRpcProcess::from_split(session_in, our_in);
        drop(pi_out);
        // 确定性地等到读循环真的置了 `ended`：这里若用「sleep 一点」，慢机上读循环可能
        // 还没跑到 `clear()`，于是请求走的是 `clear()` 分支 —— 删掉 `ended` 检查本用例
        // 仍然绿（假护栏）。
        wait_for(&proc.ended).await;

        let started = std::time::Instant::now();
        let err = proc
            .request(json!({"type": "get_state"}), None)
            .await
            .expect_err("process is gone");

        assert!(
            started.elapsed() < Duration::from_secs(1),
            "不得等满 AUX_TIMEOUT（{:?}）",
            started.elapsed()
        );
        assert!(
            err.to_string().contains("process ended before responding"),
            "{err}"
        );
    }

    /// `append_stderr`：空 / 全空白的尾部原样返回（不凭空造一个 ` — pi stderr:`）。
    #[test]
    fn append_stderr_without_tail_returns_the_error_untouched() {
        for tail in ["", "   ", "\n\n"] {
            let err = append_stderr(AppError::Agent("boom".into()), tail);
            assert_eq!(err.to_string(), "Agent error: boom");
        }
    }

    /// 有尾部时附在后面（前端 `⚠ 恢复会话失败: …` 会原样显示出来）。
    #[test]
    fn append_stderr_carries_the_tail() {
        let err = append_stderr(
            AppError::Agent("pi rpc: process ended before responding".into()),
            "No session found matching 'abc'\n",
        );
        let msg = err.to_string();
        assert!(msg.contains("No session found matching 'abc'"), "{msg}");
        assert!(msg.contains("process ended before responding"), "{msg}");
    }

    /// `tail_of`：短串不动，长串取尾部，且起点落在字符边界上（CJK 不能 panic）。
    #[test]
    fn tail_of_keeps_the_last_bytes_on_a_char_boundary() {
        assert_eq!(tail_of("abc", 8), "abc");
        assert_eq!(tail_of("abcdef", 3), "def");
        // 每个汉字 3 字节；limit=4 落在一个字符中间，必须向后续边界对齐。
        let chinese = "恢复失败";
        let tail = tail_of(chinese, 4);
        assert!(chinese.ends_with(tail));
        assert!(tail.len() <= 4);
    }

    /// stderr 尾部是**有界**的：病态输出不能把内存涨下去。
    #[test]
    fn stderr_tail_is_bounded() {
        let sink = StderrSink::default();
        for i in 0..500 {
            sink.append(&format!("line {i} {}", "x".repeat(40)));
        }
        let buf = sink
            .tail
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        assert!(
            buf.len() <= STDERR_TAIL_LIMIT,
            "尾部必须 ≤ {STDERR_TAIL_LIMIT} 字节，实际 {}",
            buf.len()
        );
        assert!(buf.contains("line 499"), "必须保留最新输出: {buf}");
    }

    /// `annotate` 读的是**这个进程自己的** stderr（夹具注入路径与生产一致）。
    #[tokio::test]
    async fn annotate_appends_the_captured_stderr() {
        let (pi_out, session_in) = tokio::io::duplex(64 * 1024);
        let (_we_write, our_in) = tokio::io::duplex(64 * 1024);
        let (mut err_out, err_in) = tokio::io::duplex(4 * 1024);
        let proc = PiRpcProcess::from_split_with_stderr(session_in, our_in, Some(err_in));
        drop(pi_out);

        {
            use tokio::io::AsyncWriteExt;
            err_out
                .write_all(b"No session found matching 'abc'\n")
                .await
                .unwrap();
        }
        // 关掉写端 = stderr EOF：确定性地等读循环把尾部写完（不 sleep）。
        drop(err_out);
        wait_for(&proc.stderr.done).await;

        let err = proc.annotate(AppError::Agent("boom".into())).await;
        assert!(err.to_string().contains("No session found matching 'abc'"));
    }

    /// **公平性护栏**：stderr 的 EOF 比 stdout 晚到时，`annotate` 必须**等一下**。
    ///
    /// 真实场景：`pi --session <不存在>` 立即 exit 1。stdout 与 stderr **同时** EOF，
    /// 但两个读循环是独立 task，谁先被调度不确定。若 stdout 先 EOF（`ended = true`）
    /// 的瞬间就取尾部，尾部还是空的 —— 错误信息**随机**丢掉真实原因，
    /// 而保留 stderr 的全部目的就是让原因可见（AC3）。
    ///
    /// 构造上保证「等」真的被测到（而不是碰巧尾部已写好）：`annotate` 先起成 task 并让出
    /// 一次调度（此时它必然停在等待上），**之后**才喂 stderr。
    ///
    /// 变异验证：把 `annotate` 里的有界等待删掉 → `annotate` 在喂 stderr 之前就返回空尾部，
    /// 本用例红。
    #[tokio::test]
    async fn annotate_waits_for_stderr_to_settle_after_the_process_ends() {
        let (pi_out, session_in) = tokio::io::duplex(64 * 1024);
        let (_we_write, our_in) = tokio::io::duplex(64 * 1024);
        let (mut err_out, err_in) = tokio::io::duplex(4 * 1024);
        let proc = Arc::new(PiRpcProcess::from_split_with_stderr(
            session_in,
            our_in,
            Some(err_in),
        ));

        // stdout 先 EOF（进程「已结束」），并确定性等到 `ended` 置位 —— `annotate` 只有
        // 在 `ended` 为真时才会等 stderr 排空。
        drop(pi_out);
        wait_for(&proc.ended).await;

        let annotating = {
            let proc = Arc::clone(&proc);
            tokio::spawn(async move { proc.annotate(AppError::Agent("boom".into())).await })
        };
        // 让出一次调度：`annotate` 跑到等待点（stderr 还没人写）。
        tokio::task::yield_now().await;

        {
            use tokio::io::AsyncWriteExt;
            err_out
                .write_all(b"No session found matching 'late'\n")
                .await
                .unwrap();
        }
        drop(err_out);

        let err = annotating.await.expect("annotate task must not panic");
        assert!(
            err.to_string().contains("No session found matching 'late'"),
            "必须等 stderr 收尾后再取尾部: {err}"
        );
    }
}
