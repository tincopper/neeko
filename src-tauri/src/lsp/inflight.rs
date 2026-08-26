//! Single-flight tracking for cancelable LSP methods.
//!
//! Single-flight applies only to *ephemeral probe* requests whose result is
//! purely "latest wins" UI decoration (hover, link-highlight probing,
//! completion…): when a newer request of the same kind arrives, the previous
//! one is cancelled via `$/cancelRequest` so servers (especially gopls) are
//! not flooded.
//!
//! User-intent navigation (`textDocument/definition` for an explicit jump,
//! `typeDefinition`, `implementation`, `references`) is deliberately NOT
//! single-flight: its result is a real jump the user asked for, and cancelling
//! it because a decoration probe fired would silently swallow the jump.
//!
//! Decoration probes that reuse a navigation method (the link-highlight probe
//! issues `textDocument/definition`) are tracked under a dedicated
//! `definition#probe` bucket, so they cancel each other but can never cancel a
//! real jump. Requests are matched by id in the reader thread, so coexistence
//! is safe.

use std::collections::HashMap;

use lsp_server::RequestId;

/// Methods whose only consumer is best-effort UI decoration; a newer request
/// of the same method supersedes (cancels) the previous one.
fn is_probe_method(method: &str) -> bool {
    matches!(
        method,
        "textDocument/hover"
            | "textDocument/documentHighlight"
            | "textDocument/completion"
            | "textDocument/signatureHelp"
            | "textDocument/prepareCallHierarchy"
    )
}

/// The single-flight bucket for a request, or `None` if it must never be
/// cancelled by a newer request.
///
/// - Probe methods are single-flight under their own method name.
/// - A `textDocument/definition` issued as a *probe* (`is_probe = true`, the
///   link-highlight decoration path) is single-flight under the dedicated
///   `definition#probe` bucket, so probes never cancel an explicit jump.
/// - Everything else (explicit jumps, references, formatting…) has no bucket.
#[must_use]
pub fn singleflight_bucket(method: &str, is_probe: bool) -> Option<String> {
    if is_probe_method(method) {
        return Some(method.to_string());
    }
    if method == "textDocument/definition" && is_probe {
        return Some("textDocument/definition#probe".to_string());
    }
    None
}

/// Tracks the latest in-flight request id per single-flight bucket.
///
/// This is a deliberately dumb map: *which* requests are single-flight (and
/// under which bucket) is decided by [`singleflight_bucket`], not here.
#[derive(Debug, Default)]
pub struct InflightRequestTracker {
    by_bucket: HashMap<String, RequestId>,
}

impl InflightRequestTracker {
    /// Create a new empty inflight request tracker.
    #[must_use]
    pub fn new() -> Self {
        Self {
            by_bucket: HashMap::new(),
        }
    }

    /// Register `new_id` as the current in-flight request for `bucket`.
    ///
    /// Returns the previous id if one is still pending, so the caller can
    /// cancel it. Buckets are opaque — the caller owns the policy.
    pub fn register(&mut self, bucket: &str, new_id: RequestId) -> Option<RequestId> {
        self.by_bucket.insert(bucket.to_string(), new_id)
    }

    /// Clear tracking when a request completes (only if it is still current).
    pub fn complete(&mut self, bucket: &str, id: &RequestId) {
        if self.by_bucket.get(bucket) == Some(id) {
            self.by_bucket.remove(bucket);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_methods_are_singleflight_regardless_of_intent() {
        assert_eq!(
            singleflight_bucket("textDocument/hover", false),
            Some("textDocument/hover".to_string())
        );
        assert_eq!(
            singleflight_bucket("textDocument/completion", true),
            Some("textDocument/completion".to_string())
        );
        assert_eq!(singleflight_bucket("initialize", false), None);
    }

    #[test]
    fn definition_probe_uses_dedicated_bucket() {
        assert_eq!(
            singleflight_bucket("textDocument/definition", true),
            Some("textDocument/definition#probe".to_string())
        );
    }

    #[test]
    fn explicit_jump_definition_is_never_singleflight() {
        // Navigation is user intent — a newer request must never cancel it,
        // even if it is a probe.
        assert_eq!(singleflight_bucket("textDocument/definition", false), None);
        assert_eq!(
            singleflight_bucket("textDocument/typeDefinition", false),
            None
        );
        assert_eq!(
            singleflight_bucket("textDocument/implementation", false),
            None
        );
        assert_eq!(singleflight_bucket("textDocument/references", false), None);
        assert_eq!(singleflight_bucket("textDocument/formatting", false), None);
    }

    #[test]
    fn should_return_previous_id_when_registering_same_bucket() {
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
    fn distinct_buckets_never_cancel_each_other() {
        let mut tracker = InflightRequestTracker::new();
        let probe = RequestId::from(1i32);
        let jump = RequestId::from(2i32);
        // Probe in-flight under its own bucket…
        assert!(tracker
            .register("textDocument/definition#probe", probe.clone())
            .is_none());
        // …an explicit jump in the same method has a different bucket and is
        // not cancelled by the probe.
        assert!(tracker
            .register("textDocument/definition", jump.clone())
            .is_none());
        // A second probe still supersedes the first probe.
        let prev = tracker.register("textDocument/definition#probe", RequestId::from(3i32));
        assert_eq!(prev, Some(probe));
        // Completing the jump does not clear the probe bucket.
        tracker.complete("textDocument/definition", &jump);
        let prev = tracker.register("textDocument/definition#probe", RequestId::from(4i32));
        assert_eq!(prev, Some(RequestId::from(3i32)));
    }

    #[test]
    fn should_not_clear_when_older_request_completes_after_supersede() {
        let mut tracker = InflightRequestTracker::new();
        let first = RequestId::from(1i32);
        let second = RequestId::from(2i32);
        tracker.register("textDocument/hover", first.clone());
        tracker.register("textDocument/hover", second.clone());

        // Late completion of the cancelled request must not drop the current id
        tracker.complete("textDocument/hover", &first);
        // Registering a third should still cancel `second`
        let prev = tracker.register("textDocument/hover", RequestId::from(3i32));
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
