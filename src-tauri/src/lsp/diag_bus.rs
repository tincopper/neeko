use std::sync::{Arc, RwLock};

use serde::Serialize;

/// A single diagnostic event published by the DiagnosticBus.
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
        match self.listeners.write() {
            Ok(mut guard) => {
                if self.index < guard.len() {
                    let _ = guard.remove(self.index);
                }
            }
            Err(poisoned) => {
                log::warn!("[LSP] DiagnosticBus lock poisoned, recovering");
                let mut guard = poisoned.into_inner();
                if self.index < guard.len() {
                    let _ = guard.remove(self.index);
                }
            }
        }
    }
}

/// Pub/sub diagnostic event bus.
#[derive(Clone)]
pub struct DiagnosticBus {
    listeners: Arc<RwLock<Vec<Listener>>>,
}

impl DiagnosticBus {
    /// Create a new empty diagnostic bus.
    #[must_use]
    pub fn new() -> Self {
        Self {
            listeners: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Subscribe to all diagnostic events.
    pub fn subscribe<F>(&self, f: F) -> DiagnosticSubscription
    where
        F: Fn(&DiagnosticEvent) + Send + Sync + 'static,
    {
        let (index, listeners) = match self.listeners.write() {
            Ok(mut guard) => {
                let index = guard.len();
                guard.push(Box::new(f));
                (index, Arc::clone(&self.listeners))
            }
            Err(poisoned) => {
                log::warn!("[LSP] DiagnosticBus lock poisoned, recovering");
                let mut guard = poisoned.into_inner();
                let index = guard.len();
                guard.push(Box::new(f));
                (index, Arc::clone(&self.listeners))
            }
        };
        DiagnosticSubscription { listeners, index }
    }

    /// Publish a diagnostic event to all active subscribers.
    pub fn publish(&self, event: DiagnosticEvent) {
        match self.listeners.read() {
            Ok(guard) => {
                for listener in guard.iter() {
                    listener(&event);
                }
            }
            Err(poisoned) => {
                log::warn!("[LSP] DiagnosticBus lock poisoned, recovering");
                for listener in poisoned.into_inner().iter() {
                    listener(&event);
                }
            }
        }
    }

    /// Number of active subscription slots (including dead ones).
    #[must_use]
    pub fn subscriber_count(&self) -> usize {
        self.listeners.read().map(|g| g.len()).unwrap_or(0)
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

    #[test]
    fn test_subscribe_and_publish() {
        let bus = DiagnosticBus::new();
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count_clone = Arc::clone(&count);
        let _sub = bus.subscribe(move |_| {
            count_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
        bus.publish(DiagnosticEvent {
            project_path: "/test".into(),
            uri: "file:///test/main.rs".into(),
            language_id: "rust".into(),
            diagnostics: serde_json::json!([]),
        });
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn test_unsubscribe_on_drop() {
        let bus = DiagnosticBus::new();
        {
            let _sub = bus.subscribe(|_| {});
            assert_eq!(bus.subscriber_count(), 1);
        }
        assert_eq!(bus.subscriber_count(), 0);
    }
}
