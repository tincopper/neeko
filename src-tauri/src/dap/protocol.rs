//! DAP base protocol framing (Content-Length headers, same family as LSP).

use serde_json::Value;

/// Encode a JSON body as a DAP/LSP framed message.
pub fn encode_message(body: &Value) -> Vec<u8> {
    let content = body.to_string();
    let header = format!("Content-Length: {}\r\n\r\n", content.len());
    let mut out = header.into_bytes();
    out.extend_from_slice(content.as_bytes());
    out
}

/// Try to parse one full message from `buffer`. On success removes bytes and
/// returns the JSON body.
pub fn try_decode(buffer: &mut Vec<u8>) -> Option<Value> {
    let header_end = find_header_end(buffer)?;
    let header = std::str::from_utf8(&buffer[..header_end]).ok()?;
    let mut content_length: Option<usize> = None;
    for line in header.split("\r\n") {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line
            .strip_prefix("Content-Length:")
            .or_else(|| line.strip_prefix("content-length:"))
        {
            content_length = rest.trim().parse().ok();
        }
    }
    let len = content_length?;
    let body_start = header_end + 4; // \r\n\r\n
    if buffer.len() < body_start + len {
        return None;
    }
    let body_bytes = buffer[body_start..body_start + len].to_vec();
    let value = serde_json::from_slice(&body_bytes).ok()?;
    let drain = body_start + len;
    buffer.drain(..drain);
    Some(value)
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|w| w == b"\r\n\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn should_roundtrip_framed_message() {
        let body = json!({"seq": 1, "type": "request", "command": "initialize"});
        let encoded = encode_message(&body);
        let mut buf = encoded;
        let decoded = try_decode(&mut buf).expect("decode");
        assert_eq!(decoded["command"], "initialize");
        assert!(buf.is_empty());
    }

    #[test]
    fn should_wait_for_full_body() {
        let body = json!({"a": 1});
        let encoded = encode_message(&body);
        let mut buf = encoded[..encoded.len() - 1].to_vec();
        assert!(try_decode(&mut buf).is_none());
        buf.push(encoded[encoded.len() - 1]);
        assert!(try_decode(&mut buf).is_some());
    }
}
