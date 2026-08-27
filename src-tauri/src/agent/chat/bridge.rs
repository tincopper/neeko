//! Agent Chat — session bridge (event pump + resume).
//!
//! Drives an [`AgentSession`]: pulls `session.next()` → assigns a monotonic
//! sequence number → batched `emit` as [`SequencedEvent`]s. The session owns its
//! own pump task (reading JSON-Lines from the child process, translating to
//! [`StreamEvent`], forwarding to an internal channel); the bridge is
//! transport-agnostic (C3) and protocol-agnostic.

use std::time::Duration;

use crate::agent::chat::adapter::AgentSession;
use crate::agent::chat::events::{ErrorKind, SequencedEvent, StreamEvent};
use crate::common::error::AppError;

/// 合帧窗口：与终端 pump 的 `flush_interval` 对齐（16ms → emit 频率 ≤60Hz）。
///
/// 方案 B1（去 eval 化）：macOS 上 Tauri 事件送达 = 每次 `evaluateJavaScript`，
/// WebKit 无条件对完成值克隆+stringify，agent 流式输出（TextDelta/
/// ReasoningDelta/ToolOutput 每增量一事件）每秒数十~数百次 emit 时，
/// WebContent RSS 只增不减（与终端唤醒事件同构的引擎层内存累积，实测
/// 22GB+ 且 JS live 堆零增长）。按窗口聚合 emit 数组，eval 次数降
/// 10~100 倍。
const BATCH_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
/// 单批最大条数：极端高频下防 batch 无界（16ms 内 agent 通常 <100 条）。
const BATCH_MAX_LEN: usize = 256;

/// Drives a session: pulls `session.next()` → assigns sequence → batched `emit`.
///
/// The session owns its own pump task (reading + translating + forwarding to an
/// internal channel); the bridge is transport-agnostic (C3) and protocol-agnostic.
pub struct AgentChatBridge;

impl AgentChatBridge {
    /// Start driving `session`, emitting batched events to `emit`.
    ///
    /// `emit: impl Fn(Vec<SequencedEvent>) + Send + 'static` lets the desktop
    /// shape use `app_handle.emit(...)` (one eval per batch) while the web
    /// shape uses an SSE writer.
    ///
    /// `session_id` is used to tag error events so the frontend can display them.
    pub async fn run(
        session_id: String,
        mut session: Box<dyn AgentSession>,
        emit: impl Fn(Vec<SequencedEvent>) + Send + 'static,
    ) -> Result<(), AppError> {
        // Per-session monotonic sequence counter（run 内单线程，无需原子）。
        let mut seq: u64 = 0;
        let mut batch: Vec<SequencedEvent> = Vec::new();

        let mut interval = tokio::time::interval(BATCH_FLUSH_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                // 定时 flush：低流量下也保证事件不滞留超过一个窗口。
                _ = interval.tick() => {
                    if !batch.is_empty() {
                        emit(std::mem::take(&mut batch));
                    }
                }
                next = session.next() => {
                    match next {
                        Some(Ok(event)) => {
                            batch.push(SequencedEvent { seq, event });
                            seq += 1;
                            if batch.len() >= BATCH_MAX_LEN {
                                emit(std::mem::take(&mut batch));
                            }
                        }
                        Some(Err(e)) => {
                            log::error!("[AgentChatBridge] Session {} error: {}", session_id, e);
                            // 错误即终止：先冲刷已累积的正常事件（保持 seq 到达
                            // 顺序），错误事件随后单独成批发出（seq 接续）。
                            if !batch.is_empty() {
                                emit(std::mem::take(&mut batch));
                            }
                            emit(vec![SequencedEvent {
                                seq,
                                event: StreamEvent::Error {
                                    session_id: session_id.clone(),
                                    kind: ErrorKind::Agent,
                                    code: "E_SESSION".into(),
                                    message: e.to_string(),
                                },
                            }]);
                            break;
                        }
                        None => break,
                    }
                }
            }
        }
        // 尾部 flush：剩余事件不丢失（seq 连续性由 push 顺序保证）。
        if !batch.is_empty() {
            emit(batch);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::chat::events::SessionRequest;
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};

    struct MockSession {
        events: Vec<StreamEvent>,
        idx: usize,
        fail_at: Option<usize>,
    }

    #[async_trait]
    impl AgentSession for MockSession {
        async fn next(&mut self) -> Option<Result<StreamEvent, AppError>> {
            if let Some(f) = self.fail_at {
                if self.idx == f {
                    return Some(Err(AppError::Unknown("mock failure".into())));
                }
            }
            if self.idx < self.events.len() {
                let ev = self.events[self.idx].clone();
                self.idx += 1;
                Some(Ok(ev))
            } else {
                None
            }
        }
        async fn send(&mut self, _req: SessionRequest) -> Result<(), AppError> {
            Ok(())
        }
        async fn cancel(&mut self) {}
        fn resume_id(&self) -> Option<String> {
            None
        }
    }

    fn text_delta(session_id: &str, delta: &str) -> StreamEvent {
        StreamEvent::TextDelta {
            session_id: session_id.to_string(),
            delta: delta.to_string(),
        }
    }

    fn collector() -> (
        Arc<Mutex<Vec<Vec<SequencedEvent>>>>,
        impl Fn(Vec<SequencedEvent>) + Send + 'static,
    ) {
        let emitted: Arc<Mutex<Vec<Vec<SequencedEvent>>>> = Arc::new(Mutex::new(Vec::new()));
        let clone = emitted.clone();
        (emitted, move |batch| {
            clone.lock().unwrap().push(batch);
        })
    }

    #[tokio::test]
    async fn batches_high_frequency_events_and_preserves_seq() {
        // 1000 个 TextDelta 快速产出：合帧后 emit 次数远小于事件数，
        // 且全部 seq 连续（0..1000），无丢无乱序。
        let events = (0..1000)
            .map(|i| text_delta("s-batch", &i.to_string()))
            .collect();
        let session = MockSession {
            events,
            idx: 0,
            fail_at: None,
        };
        let (emitted, emit) = collector();
        AgentChatBridge::run("s-batch".into(), Box::new(session), emit)
            .await
            .unwrap();

        let batches = emitted.lock().unwrap();
        assert!(
            batches.len() < 100,
            "coalescing failed: {} emits for 1000 events",
            batches.len()
        );
        let all: Vec<u64> = batches.iter().flatten().map(|e| e.seq).collect();
        assert_eq!(all.len(), 1000);
        for (i, s) in all.iter().enumerate() {
            assert_eq!(*s, i as u64, "seq discontinuity at {i}");
        }
    }

    #[tokio::test]
    async fn flushes_remaining_on_session_end() {
        // 会话正常结束（None）：尾部 flush 不丢事件，seq 连续。
        let events = vec![
            text_delta("s-tail", "a"),
            text_delta("s-tail", "b"),
            text_delta("s-tail", "c"),
        ];
        let session = MockSession {
            events,
            idx: 0,
            fail_at: None,
        };
        let (emitted, emit) = collector();
        AgentChatBridge::run("s-tail".into(), Box::new(session), emit)
            .await
            .unwrap();

        let batches = emitted.lock().unwrap();
        let all: Vec<u64> = batches.iter().flatten().map(|e| e.seq).collect();
        assert_eq!(all, vec![0, 1, 2]);
    }

    #[tokio::test]
    async fn error_terminates_and_emits_error_event_with_contiguous_seq() {
        // 会话出错：错误事件单独成批发出（seq 接续），随后终止。
        let events = vec![text_delta("s-err", "x"), text_delta("s-err", "y")];
        let session = MockSession {
            events,
            idx: 0,
            fail_at: Some(2),
        };
        let (emitted, emit) = collector();
        AgentChatBridge::run("s-err".into(), Box::new(session), emit)
            .await
            .unwrap();

        let batches = emitted.lock().unwrap();
        let all: Vec<&SequencedEvent> = batches.iter().flatten().collect();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].seq, 0);
        assert_eq!(all[1].seq, 1);
        assert_eq!(all[2].seq, 2);
        assert!(matches!(
            all[2].event,
            StreamEvent::Error {
                kind: ErrorKind::Agent,
                ..
            }
        ));
    }
}
