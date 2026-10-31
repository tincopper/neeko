//! `/hook/{source}` 的 handler 与路由组（design §3.4）。
//!
//! # 这里没有 HTTP 实现
//!
//! 解析 / body 上限 / 超时 / panic 兜底 / 并发 / 鉴权都在 [`crate::server`] 引擎里。
//! 本文件只有：状态、handler、把两者装成 [`RouteGroup`] 的工厂。
//!
//! handler 与投递分离：handler 的契约是「恒定 204」，投递（[`super::dispatch`]）有副作用、
//! 会阻塞。混在一起会让测试被迫二选一：要么起真 `AppHandle`（集成测试做不到），要么放弃
//! 断言投递。故状态持一个投递闭包：生产实现走阻塞池，测试实现是记录型 sink。

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use tauri::AppHandle;

use crate::common::runtime::AppRuntime;
use crate::server::{FailurePolicy, RouteGroup};

use super::dispatch;
use super::event::HookEvent;
use super::validation;

/// 投递闭包：`(source, event) -> ()`，可跨线程共享。
pub type Deliver = dyn Fn(&str, HookEvent) + Send + Sync;

/// 路由组状态：**只放投递闭包**。token 不进路由组（校验唯一位置是鉴权门）。
#[derive(Clone)]
pub struct HookState {
    deliver: Arc<Deliver>,
}

/// 下游消费者**端口**：hooks 域只声明"还能再挂一个消费者"，不声明是谁。
///
/// # 为什么是端口而不是直接调 `team::deliver`
///
/// 直接把 `crate::agent::team::deliver::observe` 写在这里会让 `hooks` 域**反向依赖**团队域，
/// 而团队域本身又要读 `HookEvent`（消费生产者契约）—— 两个域就此成环，`hooks` 再也不能
/// 脱离团队编译。而 `hooks` 是 fail-open 的**常开路径**，不该因为下游域的重构而受影响。
///
/// 所以这条边由**组合根**（`app::boot`）接上：它本来就同时认识两个域。
/// 判据不是"代码放哪个目录"，而是"让谁依赖谁"。
///
/// # 为什么是 `Arc<Deliver>` 而不是另一个 `dyn Fn` 类型
///
/// 它就是"一个可共享的投递闭包"，和 [`Deliver`] 是**同一件事**，只是多要求一个 `Clone`。
/// 外层闭包会被反复调用，所以不能把 `Box` 移动出去 —— 必须是 `Arc`。
pub type ExtraConsumer = Arc<Deliver>;

/// 生产入口：构造 hooks 路由组（该组自己声明 fail-open）。
///
/// 本函数只做**一件事**：把通知消费者从 `AppHandle` 闭成 [`Deliver`]，然后交给
/// [`compose_consumers`]。装配规则（一次阻塞任务、通知在前）全在那一处，因此可测。
///
/// 契约：通知链路的**外部行为逐字不变**。额外消费者无论返回 `Err` 还是 panic，都动不到
/// 通知 —— 它签的是 `Fn`（不返回 `Result`），且通知在它之前投递。
#[must_use]
pub fn route_group(app: AppHandle, runtime: Arc<AppRuntime>, extra: ExtraConsumer) -> RouteGroup {
    // 唯一需要 `AppHandle` 的地方就在这一行：把通知消费者闭成 `Deliver`。
    let notify: Arc<Deliver> = Arc::new(move |source: &str, event: HookEvent| {
        dispatch::deliver_notification(&app, source, event);
    });
    route_group_with(compose_consumers(runtime, notify, extra))
}

/// 两个消费者的**唯一**组合点：一次阻塞任务、通知在前。
///
/// # 并发形状（红线 3）
///
/// 通知（[`dispatch::deliver_notification`]）与 [`ExtraConsumer`] 读同一份 [`HookEvent`]、
/// 同一个 [`crate::AppStateWrapper`]，而且必须**一起完成**：两次 `spawn_blocking` 会让每条
/// hook 占两个阻塞 worker（在途 hook 上限 16 ⇒ 两倍占用，恰是红线 3 要挡的那类
/// "把 worker 当私有线程用"），还会让两个消费者可能看到不同的中间状态。
///
/// # 为什么参数是「两个 `Deliver`」而不是「两个 `FnOnce`」（[`route_group`] 曾如此）
///
/// 因为**会错的正是装配本身**：`&str` 的拥有化、事件快照的分发、两个闭包的先后顺序，
/// 都发生在这一层。收 `FnOnce` 的助手只能证明"顺序可以这样写"，证明不了"生产装配确实
/// 这样写"—— 后者才是回归防线。收 `Arc<Deliver>` 后，测试注入记录型 / 抛错型消费者，
/// 走的就是生产路径本身（`route_group` 只多一次 `AppHandle` → `Deliver` 的闭包）。
///
/// 四条不变量（各有用例）：
///
/// 1. **一次**阻塞任务（两个消费者不得并行 —— 否则可能读到不同的中间状态）；
/// 2. 通知**先**投递（下游的 panic 挡不住已经投递完的通知）；
/// 3. 反过来也成立：通知侧 panic 不得让下游消费者整条消失（见 [`run_guarded`]）；
/// 4. 两个消费者拿到**同一个** source 与**同一份**事件快照。
fn compose_consumers(
    runtime: Arc<AppRuntime>,
    notify: Arc<Deliver>,
    extra: ExtraConsumer,
) -> impl Fn(&str, HookEvent) + Send + Sync + 'static {
    move |source: &str, event: HookEvent| {
        // `&str` 不能跨线程移动：先拥有化（一次分配，两个消费者共享同一份）。
        let source: Arc<str> = Arc::from(source);
        // 外层闭包是 `Fn`（会被反复调用），所以每次调用 clone 一份 `Arc` 交给内层
        // `FnOnce` —— 这是 `Arc` 而不是 `Box` 的原因。
        let notify = Arc::clone(&notify);
        let extra = Arc::clone(&extra);
        // `event` 归第二个消费者；通知那份 clone —— 两边读的是**同一份**事件快照。
        let notify_event = event.clone();
        let notification_source = Arc::clone(&source);
        let extra_source = Arc::clone(&source);
        runtime.spawn_blocking(move || {
            // 顺序固定：通知在前。但**顺序不等于依赖** —— 每个消费者各自被隔离，
            // 见 `run_guarded` 的文档。
            run_guarded("notification", move || {
                notify(notification_source.as_ref(), notify_event);
            });
            run_guarded("extra", move || {
                extra(extra_source.as_ref(), event);
            });
        });
    }
}

/// 执行一个消费者并**吞掉它的 panic**（fail-open 的最后一环）。
///
/// # 为什么不靠「panic 会落进被丢弃的 `JoinHandle`」那层保护
///
/// 两个消费者跑在**同一个**阻塞任务里。没有这层时，通知侧的一个 panic 会让下游消费者
/// 整条消失 —— 而它读的是同一份事件快照、本来完全能处理。事件的收件人之间**没有依赖**，
/// 所以「一个死掉」不该等于「另一个没收到」。
///
/// 默认 panic hook 仍会打印 backtrace（那对排查有用）；本函数只负责让控制流继续走到下一个
/// 消费者，并把「谁挂了」写进日志。
fn run_guarded(name: &'static str, consumer: impl FnOnce()) {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(consumer));
    if outcome.is_err() {
        log::error!(
            "[agent-hooks] consumer `{name}` panicked; the hook was already acked (fail-open)"
        );
    }
}

/// **测试缝（AC2）**：注入投递闭包，引擎 / 门 / 策略 / handler / 校验与生产入口完全同源。
///
/// 集成测试是独立 crate、无 `tauri::test` feature、构造不出 `AppHandle` —— 用本入口
/// + 记录型 sink 断言「投递 / 不投递」，走真引擎真 socket。
#[must_use]
pub fn route_group_with(deliver: impl Fn(&str, HookEvent) + Send + Sync + 'static) -> RouteGroup {
    let state = HookState {
        deliver: Arc::new(deliver),
    };
    let router = Router::new()
        .route("/hook/{source}", post(ingest_hook))
        .with_state(state);
    RouteGroup {
        name: "hooks",
        policy: FailurePolicy::FailOpen,
        router,
    }
}

/// `POST /hook/{source}` —— wire 契约见 design §6。
///
/// 只做三件事：取 path 与 body（axum 已解析，含 body 上限）→ 调校验 → 恒 204。
/// **没有 403 分支**：拒绝发生在鉴权门；handler 若能返回 403，就等于允许某些组绕过门。
async fn ingest_hook(
    State(state): State<HookState>,
    Path(source): Path<String>,
    body: Bytes,
) -> Response {
    validation::validate(&source, &body, |registered, event| {
        (state.deliver)(registered, event);
    });
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::hooks::ingest::attribution::EnvHints;
    use crate::agent::hooks::ingest::event::HookEvent;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    /// 组声明：fail-open + 稳定的组名（日志/测试用）。
    #[test]
    fn route_group_declares_fail_open_and_stable_name() {
        let group = route_group_with(|_, _| {});
        assert_eq!(group.name, "hooks");
        assert_eq!(group.policy, FailurePolicy::FailOpen);
    }

    /// 一条最小 hook 事件（只填断言会用到的字段）。
    fn hook_event(key: &str) -> HookEvent {
        HookEvent {
            agent_session_id: "agent-1".into(),
            event: key.into(),
            cwd: None,
            detail: None,
            title: None,
            seq: None,
            hints: EnvHints::default(),
        }
    }

    /// 测试用 runtime：`compose_consumers` 只需要一个能 `spawn_blocking` 的句柄。
    fn runtime() -> Arc<AppRuntime> {
        Arc::new(AppRuntime::from_handle(tokio::runtime::Handle::current()))
    }

    /// 投递等待：阻塞池上的任务与测试线程并行，用 channel 收「账」而非 sleep。
    fn recv<T>(rx: &mpsc::Receiver<T>) -> T {
        rx.recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|err| panic!("投递没有发生: {err:?}"))
    }

    /// 不变量①②：两个消费者在**同一次**阻塞任务里顺序执行，且通知在前。
    ///
    /// 顺序：通知入账 → 团队入账（`recv` 两次）。
    /// 不并行：通知持 150ms 才结束，团队侧记录的 `Instant::now()` 必须**晚于**通知结束
    /// —— 退回“两次 `spawn_blocking`”时阻塞池会把两者放到不同线程并行执行，
    /// 团队侧的时间戳会落在通知结束之前，本断言必红。
    #[tokio::test]
    async fn consumers_run_in_one_task_notify_first() {
        let (tx, rx) = mpsc::channel::<&'static str>();
        let notify_done_at = Arc::new(std::sync::Mutex::new(None::<Instant>));
        let observe_started_at = Arc::clone(&notify_done_at);

        let notify_tx = tx.clone();
        let notify: Arc<Deliver> = Arc::new(move |_source, _event| {
            std::thread::sleep(Duration::from_millis(150));
            *notify_done_at.lock().expect("lock") = Some(Instant::now());
            notify_tx.send("notify").expect("record notify");
        });
        let extra: ExtraConsumer = Arc::new(move |_source, _event| {
            let started = Instant::now();
            let earlier = observe_started_at
                .lock()
                .expect("lock")
                .expect("notify must have finished first");
            assert!(
                started >= earlier,
                "下游消费者在通知结束前就开跑了 —— 说明两个消费者不在同一次阻塞任务里"
            );
            tx.send("extra").expect("record extra consumer");
        });

        compose_consumers(runtime(), notify, extra)("claude", hook_event("turn_completed"));

        assert_eq!(recv(&rx), "notify");
        assert_eq!(
            recv(&rx),
            "extra",
            "下游消费者必须也跑（一次任务两个消费者）"
        );
    }

    /// 不变量③：下游消费者 panic 也不影响通知投递。
    ///
    /// 这里钉住最坏的形态：下游消费者 **panic** 时通知已经投递完 —— 即"通知先行"这个
    /// 顺序本身就是保护。真实消费者的错误处理由它自己的单测覆盖。
    ///
    /// ⚠️ 本用例故意让下游消费者 panic，输出里那行 panic 信息是**预期产物**（阻塞任务里的 panic
    /// 被 tokio 收进 `JoinHandle`，而句柄是 fire-and-forget 丢掉的，不会传播到测试）。
    #[tokio::test]
    async fn a_panicking_extra_consumer_does_not_stop_the_notification() {
        let (tx, rx) = mpsc::channel::<&'static str>();

        let notify: Arc<Deliver> = Arc::new(move |_source, _event| {
            tx.send("notify").expect("record notify");
        });
        let extra: ExtraConsumer =
            Arc::new(|_source, _event| panic!("extra consumer exploded (expected by this test)"));

        compose_consumers(runtime(), notify, extra)("claude", hook_event("turn_completed"));

        assert_eq!(recv(&rx), "notify", "下游消费者 panic 不得吞掉通知");
    }

    /// 不变量③反向：**通知侧** panic 也不得让下游消费者消失。
    ///
    /// 顺序不等于依赖：两个收件人读同一份事件、彼此之间没有任何依赖，所以「通知挂了」
    /// 不该等于「团队侧没收到」。这条与上一条（下游 panic 不吞通知）合起来才是
    /// fail-open 的对称形态。
    #[tokio::test]
    async fn a_panicking_notification_does_not_starve_the_extra_consumer() {
        let (tx, rx) = mpsc::channel::<&'static str>();

        let notify: Arc<Deliver> =
            Arc::new(|_source, _event| panic!("notification exploded (expected by this test)"));
        let extra: ExtraConsumer = Arc::new(move |_source, _event| {
            tx.send("extra").expect("record extra");
        });

        compose_consumers(runtime(), notify, extra)("claude", hook_event("turn_completed"));

        assert_eq!(
            recv(&rx),
            "extra",
            "通知侧 panic 不得饿死下游消费者（两个收件人之间没有依赖）"
        );
    }

    /// 不变量：两个消费者拿到的是**同一个** source 与**同一份**事件快照。
    ///
    /// 能挡的错：某个消费者**根本没被调用**、`source` 只喂给了一方、或事件被换成了
    /// 别的值（空串 / 另一个键）。挡不住的错：两个事件参数互换 —— 它们本来就是同一份
    /// 快照的两个句柄，换了也等价（所以那不是缺陷）。
    ///
    /// 这类错只在**装配层**可见：收 `FnOnce` 的助手单测证明不了它，因为那里的闭包是
    /// 测试自己写的。
    #[tokio::test]
    async fn consumers_share_the_same_source_and_event() {
        let (tx, rx) = mpsc::channel::<(String, String)>();

        let notify_tx = tx.clone();
        let notify: Arc<Deliver> = Arc::new(move |source: &str, event: HookEvent| {
            notify_tx
                .send((format!("notify:{source}"), event.event))
                .expect("record notify");
        });
        let extra_tx = tx.clone();
        let extra: ExtraConsumer = Arc::new(move |source: &str, event: HookEvent| {
            extra_tx
                .send((format!("extra:{source}"), event.event))
                .expect("record extra");
        });

        compose_consumers(runtime(), notify, extra)("claude", hook_event("turn_completed"));

        assert_eq!(
            recv(&rx),
            ("notify:claude".to_owned(), "turn_completed".to_owned())
        );
        assert_eq!(
            recv(&rx),
            ("extra:claude".to_owned(), "turn_completed".to_owned()),
            "两个消费者必须看到同一个 source 与同一个事件键"
        );
    }
}
