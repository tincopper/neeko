//! Single-flight tracking for cancelable LSP methods.
//!
//! When a new hover/definition request is sent while a previous one is still
//! in flight for the same method, the previous request should be cancelled via
//! `$/cancelRequest` so servers (especially gopls) are not flooded.

use std::collections::HashMap;

use lsp_server::RequestId;

/// Methods for which only the latest in-flight request is useful.
/// A newer request of the same method cancels the previous one.
pub fn is_singleflight_method(method: &str) -> bool {
    matches!(
        method,
        "textDocument/hover"
            | "textDocument/definition"
            | "textDocument/typeDefinition"
            | "textDocument/implementation"
            | "textDocument/references"
            | "textDocument/documentHighlight"
            | "textDocument/completion"
            | "textDocument/signatureHelp"
            | "textDocument/prepareCallHierarchy"
    )
}

/// Tracks the latest in-flight request id per LSP method for a session.
#[derive(Debug, Default)]
pub struct InflightRequestTracker {
    by_method: HashMap<String, RequestId>,
}

impl InflightRequestTracker {
    /// Create a new empty inflight request tracker.
    pub fn new() -> Self {
        Self {
            by_method: HashMap::new(),
        }
    }

    /// Register `new_id` as the current in-flight request for `method`.
    ///
    /// Returns the previous id if the method is single-flight and a previous
    /// request should be cancelled. Non-singleflight methods never cancel.
    pub fn register(&mut self, method: &str, new_id: RequestId) -> Option<RequestId> {
        if !is_singleflight_method(method) {
            return None;
        }
        self.by_method.insert(method.to_string(), new_id)
    }

    /// Clear tracking when a request completes (only if it is still current).
    pub fn complete(&mut self, method: &str, id: &RequestId) {
        if self.by_method.get(method) == Some(id) {
            self.by_method.remove(method);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_identify_hover_and_definition_as_singleflight() {
        assert!(is_singleflight_method("textDocument/hover"));
        assert!(is_singleflight_method("textDocument/definition"));
        assert!(!is_singleflight_method("initialize"));
        assert!(!is_singleflight_method("textDocument/formatting"));
    }

    #[test]
    fn should_return_previous_id_when_registering_new_singleflight_request() {
        let mut tracker = InflightRequestTracker::new();
        let first = RequestId::from(10i32);
        let second = RequestId::from(11i32);

        assert!(tracker
            .register("textDocument/hover", first.clone())
            .is_none());
        let prev = tracker.register("textDocument/hover", second);
        assert_eq!(prev, Some(first));
    }

    #[test]
    fn should_not_cancel_non_singleflight_methods() {
        let mut tracker = InflightRequestTracker::new();
        assert!(tracker
            .register("textDocument/formatting", RequestId::from(1i32))
            .is_none());
        assert!(tracker
            .register("textDocument/formatting", RequestId::from(2i32))
            .is_none());
    }

    #[test]
    fn should_not_clear_when_older_request_completes_after_supersede() {
        let mut tracker = InflightRequestTracker::new();
        let first = RequestId::from(1i32);
        let second = RequestId::from(2i32);
        tracker.register("textDocument/definition", first.clone());
        tracker.register("textDocument/definition", second.clone());

        // Late completion of the cancelled request must not drop the current id
        tracker.complete("textDocument/definition", &first);
        // Registering a third should still cancel `second`
        let prev = tracker.register("textDocument/definition", RequestId::from(3i32));
        assert_eq!(prev, Some(second));
    }

    #[test]
    fn should_clear_current_id_on_complete() {
        let mut tracker = InflightRequestTracker::new();
        let id = RequestId::from(5i32);
        tracker.register("textDocument/hover", id.clone());
        tracker.complete("textDocument/hover", &id);

        // Next register has nothing to cancel
        assert!(tracker
            .register("textDocument/hover", RequestId::from(6i32))
            .is_none());
    }
}
