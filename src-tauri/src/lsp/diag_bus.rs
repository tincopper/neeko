use std::sync::{Arc, RwLock};

use serde::Serialize;

/// A single diagnostic event published by the DiagnosticBus.
///
/// The `diagnostics` field carries the raw JSON array from the LSP
/// `textDocument/publishDiagnostics` notification params — no
/// intermediate parsing to structs, avoiding a serialize→parse→serialize
/// round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticEvent {
    pub project_path: String,
    pub uri: String,
    pub language_id: String,
    pub diagnostics: serde_json::Value,
}

type Listener = Box<dyn Fn(&DiagnosticEvent) + Send + Sync>;

/// Subscriber handle returned by `DiagnosticBus::subscribe()`.
/// Dropping this handle unsubscribes the listener.
pub struct DiagnosticSubscription {
    listeners: Arc<RwLock<Vec<Listener>>>,
    index: usize,
}

impl Drop for DiagnosticSubscription {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.listeners.write() {
            if let Some(slot) = guard.get_mut(self.index) {
                // Replace with no-op to mark slot as dead
                *slot = Box::new(|_| {});
            }
        }
    }
}

/// Pub/sub diagnostic event bus.
///
/// Decouples LSP session diagnostic push from frontend event emission.
/// Multiple subscribers can listen independently; the bus itself
/// doesn't know about Tauri events — transport adapters bridge that gap.
#[derive(Clone)]
pub struct DiagnosticBus {
    listeners: Arc<RwLock<Vec<Listener>>>,
}

impl DiagnosticBus {
    pub fn new() -> Self {
        Self {
            listeners: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Subscribe to all diagnostic events.
    ///
    /// Returns a handle; dropping it unsubscribes.
    pub fn subscribe<F>(&self, f: F) -> DiagnosticSubscription
    where
        F: Fn(&DiagnosticEvent) + Send + Sync + 'static,
    {
        let mut guard = self.listeners.write().expect("infallible");
        let index = guard.len();
        guard.push(Box::new(f));
        DiagnosticSubscription {
            listeners: Arc::clone(&self.listeners),
            index,
        }
    }

    /// Publish a diagnostic event to all active subscribers.
    pub fn publish(&self, event: DiagnosticEvent) {
        let guard = self.listeners.read().expect("infallible");
        for listener in guard.iter() {
            listener(&event);
        }
    }

    /// Number of active subscription slots (including dead ones).
    pub fn subscriber_count(&self) -> usize {
        self.listeners.read().expect("infallible").len()
    }
}

impl Default for DiagnosticBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn test_publish_reaches_subscriber() {
        let bus = DiagnosticBus::new();
        let counter = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&counter);

        let _sub = bus.subscribe(move |_event| {
            c.fetch_add(1, Ordering::SeqCst);
        });

        bus.publish(DiagnosticEvent {
            project_path: "/test".into(),
            uri: "file:///test.rs".into(),
            language_id: "rust".into(),
            diagnostics: serde_json::json!([]),
        });

        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_multiple_subscribers() {
        let bus = DiagnosticBus::new();
        let counter = Arc::new(AtomicUsize::new(0));
        let c1 = Arc::clone(&counter);
        let c2 = Arc::clone(&counter);

        let _s1 = bus.subscribe(move |_| {
            c1.fetch_add(1, Ordering::SeqCst);
        });
        let _s2 = bus.subscribe(move |_| {
            c2.fetch_add(1, Ordering::SeqCst);
        });

        bus.publish(DiagnosticEvent {
            project_path: "/test".into(),
            uri: "file:///test.rs".into(),
            language_id: "rust".into(),
            diagnostics: serde_json::json!([]),
        });

        assert_eq!(counter.load(Ordering::SeqCst), 2);
    }
}
