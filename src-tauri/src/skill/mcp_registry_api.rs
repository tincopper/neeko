//! MCP Registry HTTP client: search/fetch server.json listings and generate
//! launch configuration templates.
//!
//! Registry API (read-only, no auth):
//!   GET https://registry.modelcontextprotocol.io/v0.1/servers
//!       ?version=latest&search=<q>&limit=<n>&cursor=<c>
//! Returns `{ servers: [{ server: {...server.json}, _meta: {...} }], metadata: { nextCursor, count } }`.
//!
//! Pure parsing functions (`generate_config`, `derive_transports`) are separated
//! from network functions so they can be unit-tested without a live registry.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

/// Base URL for the official MCP Registry v0.1 API.
const REGISTRY_BASE_URL: &str = "https://registry.modelcontextprotocol.io/v0.1/servers";
/// HTTP timeout for registry requests.
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// A summary row in the marketplace listing (what a card needs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRegistryServerSummary {
    /// Registry-unique name, e.g. "com.pulsemcp/remote-filesystem".
    pub name: String,
    /// Display name (falls back to last path segment of `name`).
    pub title: String,
    /// One-line server description.
    pub description: Option<String>,
    /// Latest published version.
    pub version: Option<String>,
    /// Derived transport strings: "stdio" / "http" / "sse" (deduped).
    pub transports: Vec<String>,
    /// Source repository URL, when provided.
    pub repository: Option<String>,
    /// GitHub stars (populated by the command layer; None when unavailable/failed).
    #[serde(default)]
    pub stars: Option<u64>,
    /// Package downloads count (populated by the command layer; None when unavailable/failed).
    #[serde(default)]
    pub downloads: Option<u64>,
    /// Server-declared configuration inputs (Argument schema) — drives dynamic
    /// config-form rendering on the frontend.
    #[serde(default)]
    pub inputs: Vec<McpRegistryInput>,
    /// Registry lifecycle status: "active" | "deprecated" | "deleted".
    #[serde(default)]
    pub status: Option<String>,
    /// Registry last-updated timestamp (RFC3339).
    #[serde(rename = "updatedAt", default)]
    pub updated_at: Option<String>,
    /// Package registry keys `(registryType, identifier)` for downloads lookup.
    /// Internal only — not serialized to the frontend.
    #[serde(default, skip_serializing)]
    pub package_keys: Vec<(String, String)>,
}

/// A declared configuration input exposed to the frontend (Argument schema).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryInput {
    /// Input name.
    pub name: String,
    /// "positional" | "named" (argument type).
    pub input_type: Option<String>,
    /// "string" | "number" | "boolean" | "filepath".
    pub format: Option<String>,
    /// Whether the input is required before the server can start.
    pub is_required: bool,
    /// Whether the value is a secret (never auto-filled).
    pub is_secret: bool,
    /// Whether the input can be provided multiple times.
    pub is_repeated: bool,
    /// Optional default value supplied by the server declaration.
    pub default: Option<serde_json::Value>,
    /// Placeholder / guidance text for the configuration UI.
    pub placeholder: Option<String>,
    /// Allowed values when the input is a fixed-choice select.
    pub choices: Vec<String>,
    /// Positional-arg hint (used in remote URL variable substitution).
    pub value_hint: Option<String>,
}

impl McpRegistryInput {
    fn from_json(input: &InputJson) -> Self {
        McpRegistryInput {
            name: input.name.clone(),
            input_type: input.r#type.clone(),
            format: input.format.clone(),
            is_required: input.is_required,
            is_secret: input.is_secret,
            is_repeated: input.is_repeated,
            default: input.default.clone(),
            placeholder: input.placeholder.clone(),
            choices: input.choices.clone(),
            value_hint: input.value_hint.clone(),
        }
    }
}

/// Parse the GitHub owner/repo pair from a repository URL.
/// Supports `https://github.com/owner/repo` and `https://github.com/owner/repo/tree/...`.
pub fn github_repo_from_url(url: &str) -> Option<(String, String)> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("github.com/"))?;
    let mut segs = rest.split('/').filter(|s| !s.is_empty());
    let owner = segs.next()?;
    let repo = segs.next()?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

/// GitHub API URL for a repository (unauthenticated read; rate-limited ~60/hr).
pub fn github_repo_api_url(owner: &str, repo: &str) -> String {
    format!("https://api.github.com/repos/{owner}/{repo}")
}

/// Fetch GitHub stars for a repository URL (unauthenticated, no auth header).
/// Returns `Ok(None)` on non-GitHub URL, rate-limit, or any network/parse failure.
pub fn fetch_github_stars(
    repository: &str,
    client: &reqwest::blocking::Client,
) -> Result<Option<u64>> {
    let Some((owner, repo)) = github_repo_from_url(repository) else {
        return Ok(None);
    };
    let url = github_repo_api_url(&owner, &repo);
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "neeko")
        .send()
        .context("Failed to fetch GitHub repo stats")?;
    if !resp.status().is_success() {
        // 403 = rate limited, 404 = not found — degrade silently.
        return Ok(None);
    }
    let json: serde_json::Value = resp
        .json()
        .context("Failed to parse GitHub repo response")?;
    Ok(json
        .get("stargazers_count")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            json.get("stargazers_count")
                .and_then(|v| v.as_i64())
                .and_then(|v| u64::try_from(v).ok())
        }))
}

/// Build the downloads lookup URL for a package registry (npm/pypi).
pub fn package_downloads_url(registry_type: &str, identifier: &str) -> Option<String> {
    match registry_type {
        // npm: last-month downloads from the public downloads API
        "npm" => Some(format!(
            "https://api.npmjs.org/downloads/point/last-month/{identifier}"
        )),
        // pypi: last-month downloads via pypistats
        "pypi" => Some(format!(
            "https://pypistats.org/api/packages/{identifier}/recent"
        )),
        _ => None,
    }
}

/// Fetch package downloads count for a registry type + identifier.
/// Returns `Ok(None)` for unsupported registries or any failure.
pub fn fetch_package_downloads(
    registry_type: &str,
    identifier: &str,
    client: &reqwest::blocking::Client,
) -> Result<Option<u64>> {
    let Some(url) = package_downloads_url(registry_type, identifier) else {
        return Ok(None);
    };
    let resp = client
        .get(&url)
        .header("User-Agent", "neeko")
        .send()
        .context("Failed to fetch package downloads")?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let json: serde_json::Value = resp.json().context("Failed to parse package downloads")?;
    // npm: { downloads: <n> }; pypi: { data: { last_month: <n> } }
    let value = json
        .get("downloads")
        .or_else(|| json.get("data").and_then(|d| d.get("last_month")));
    Ok(value.and_then(|v| v.as_u64()))
}

/// Fetch both metrics (GitHub stars + package downloads) for a summary.
/// Network only — the caller is responsible for caching. Both degrade to `None`.
pub fn fetch_server_metrics(
    summary: &McpRegistryServerSummary,
    client: &reqwest::blocking::Client,
) -> (Option<u64>, Option<u64>) {
    let stars = summary
        .repository
        .as_deref()
        .and_then(|repo| fetch_github_stars(repo, client).ok().flatten());
    let downloads = summary
        .package_keys
        .first()
        .and_then(|(rt, id)| fetch_package_downloads(rt, id, client).ok().flatten());
    (stars, downloads)
}

/// Full detail for a single server (fetched when installing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRegistryServerDetail {
    /// Reusable listing summary for this server.
    pub summary: McpRegistryServerSummary,
    /// Generated launch-config template (None when parsing degrades).
    pub generated: Option<McpRegistryGeneratedConfig>,
    /// Raw server.json for frontend fallback display.
    pub raw: serde_json::Value,
}

/// Launch configuration template prefilling the MCP editor dialog.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRegistryGeneratedConfig {
    /// Display name for the generated MCP server entry.
    pub name: String,
    /// One-line description from server.json.
    pub description: Option<String>,
    /// Executable command (empty for remote transports).
    pub command: String,
    /// Command-line arguments (excluding the command itself).
    pub args: Vec<String>,
    /// Environment variables from server.json (secret values never filled).
    pub env: Vec<McpRegistryEnvVar>,
    /// "stdio" | "http" | "sse".
    pub transport: String,
    /// Remote URL when transport is http/sse.
    pub url: Option<String>,
    /// Server-declared configuration inputs — drive dynamic form rendering.
    #[serde(default)]
    pub inputs: Vec<McpRegistryInput>,
}

/// An environment variable entry from server.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRegistryEnvVar {
    /// Environment variable name.
    pub name: String,
    /// Whether the value is a secret (left empty in the template).
    pub is_secret: bool,
    /// Whether the variable must be filled before saving.
    pub is_required: bool,
    /// Optional default value supplied by server.json.
    pub default: Option<String>,
}

// ── Wire types (matching the registry HTTP envelope) ─────────────────────────

#[derive(Deserialize)]
struct RegistryEnvelope {
    servers: Vec<RegistryEntry>,
    #[serde(default)]
    metadata: RegistryMetadata,
}

#[derive(Deserialize)]
struct RegistryEntry {
    server: ServerJson,
    /// Registry-managed metadata (lifecycle status / timestamps).
    #[serde(rename = "_meta", default)]
    meta: RegistryEntryMeta,
}

#[derive(Deserialize, Default)]
struct RegistryEntryMeta {
    #[serde(rename = "io.modelcontextprotocol.registry/official", default)]
    official: RegistryOfficialMeta,
}

#[derive(Deserialize, Default)]
struct RegistryOfficialMeta {
    /// "active" | "deprecated" | "deleted".
    #[serde(default)]
    status: Option<String>,
    #[serde(rename = "updatedAt", default)]
    updated_at: Option<String>,
}

#[derive(Deserialize, Default)]
struct RegistryMetadata {
    #[serde(rename = "nextCursor")]
    next_cursor: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ServerJson {
    name: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    repository: Option<RepositoryJson>,
    #[serde(default)]
    packages: Vec<PackageJson>,
    #[serde(default)]
    remotes: Vec<RemoteJson>,
    /// Server-declared configuration inputs (Argument schema) — powers dynamic
    /// config-form rendering on the frontend.
    #[serde(default)]
    inputs: Vec<InputJson>,
    /// Official project website URL.
    #[serde(rename = "websiteUrl", default)]
    website_url: Option<String>,
}

/// A declared configuration input (matches the registry Argument schema).
#[derive(Serialize, Deserialize)]
struct InputJson {
    name: String,
    /// "positional" | "named" (argument type).
    #[serde(default)]
    r#type: Option<String>,
    /// "string" | "number" | "boolean" | "filepath".
    #[serde(default)]
    format: Option<String>,
    #[serde(rename = "isRequired", default)]
    is_required: bool,
    #[serde(rename = "isSecret", default)]
    is_secret: bool,
    #[serde(rename = "isRepeated", default)]
    is_repeated: bool,
    #[serde(default)]
    default: Option<serde_json::Value>,
    #[serde(default)]
    placeholder: Option<String>,
    #[serde(default)]
    choices: Vec<String>,
    /// Positional-arg hint (used in remote URL variable substitution).
    #[serde(rename = "valueHint", default)]
    value_hint: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct RepositoryJson {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct PackageJson {
    #[serde(rename = "registryType", default)]
    registry_type: String,
    #[serde(default)]
    identifier: Option<String>,
    #[serde(default)]
    runtime_hint: Option<String>,
    #[serde(default)]
    transport: Option<TransportJson>,
    #[serde(rename = "runtimeArguments", default)]
    runtime_arguments: Vec<ArgJson>,
    #[serde(rename = "packageArguments", default)]
    package_arguments: Vec<ArgJson>,
    #[serde(rename = "environmentVariables", default)]
    environment_variables: Vec<EnvVarJson>,
}

#[derive(Serialize, Deserialize)]
struct TransportJson {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Serialize, Deserialize)]
struct ArgJson {
    value: String,
    /// Optional flag name for named arguments (e.g. `-t` before `stdio`).
    #[serde(default)]
    name: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct EnvVarJson {
    name: String,
    #[serde(rename = "isSecret", default)]
    is_secret: bool,
    #[serde(rename = "isRequired", default)]
    is_required: bool,
    #[serde(default)]
    default: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
struct RemoteJson {
    #[serde(rename = "type")]
    kind: String,
    url: String,
}

/// Build a blocking HTTP client (reuses the skills.sh client builder).
pub fn build_http_client(proxy_url: Option<&str>) -> Result<reqwest::blocking::Client> {
    super::skillssh_api::build_http_client(proxy_url, REQUEST_TIMEOUT_SECS)
}

/// Search the registry for servers matching `query` (empty = all listings).
///
/// Returns the summary list plus the next pagination cursor when more pages exist.
pub fn search_registry(
    query: &str,
    limit: usize,
    cursor: Option<&str>,
    proxy_url: Option<&str>,
) -> Result<(Vec<McpRegistryServerSummary>, Option<String>)> {
    let client = build_http_client(proxy_url)?;
    let mut url = format!("{REGISTRY_BASE_URL}?version=latest&limit={limit}");
    if !query.is_empty() {
        url.push_str(&format!("&search={}", urlencoding::encode(query)));
    }
    if let Some(cursor) = cursor {
        url.push_str(&format!("&cursor={}", urlencoding::encode(cursor)));
    }

    let body = client
        .get(&url)
        .send()
        .context("Failed to fetch MCP registry listings")?
        .text()
        .context("Failed to read MCP registry response body")?;

    let envelope: RegistryEnvelope =
        serde_json::from_str(&body).context("Failed to parse MCP registry listings response")?;

    let summaries = envelope.servers.iter().map(summary_from_entry).collect();
    Ok((summaries, envelope.metadata.next_cursor))
}

/// Fetch a single server's full server.json by its registry name.
///
/// The registry has no direct lookup endpoint, so this searches by the exact
/// name and falls back to the last path segment when the exact search misses.
pub fn fetch_server(name: &str, proxy_url: Option<&str>) -> Result<McpRegistryServerDetail> {
    let client = build_http_client(proxy_url)?;

    let (json, raw) = match fetch_server_json(&client, name, name)? {
        Some(found) => found,
        None => {
            let fallback = name.rsplit('/').next().unwrap_or(name).to_string();
            if fallback == name {
                bail!("MCP registry server not found: {name}");
            }
            fetch_server_json(&client, &fallback, name)?
                .ok_or_else(|| anyhow::anyhow!("MCP registry server not found: {name}"))?
        }
    };

    let summary = summary_from_json(&json);
    let generated = generate_config(&raw).unwrap_or(None);
    Ok(McpRegistryServerDetail {
        summary,
        generated,
        raw,
    })
}

/// Search the registry and return the first server whose name equals `target`.
/// Preserves the raw JSON alongside the parsed struct for frontend fallback.
fn fetch_server_json(
    client: &reqwest::blocking::Client,
    query: &str,
    target: &str,
) -> Result<Option<(ServerJson, serde_json::Value)>> {
    let url = format!(
        "{REGISTRY_BASE_URL}?version=latest&search={}&limit=50",
        urlencoding::encode(query)
    );
    let body = client
        .get(&url)
        .send()
        .context("Failed to fetch MCP registry server")?
        .text()
        .context("Failed to read MCP registry server response")?;
    let envelope: RegistryEnvelope =
        serde_json::from_str(&body).context("Failed to parse MCP registry server response")?;
    Ok(envelope
        .servers
        .into_iter()
        .map(|entry| {
            let raw = serde_json::to_value(&entry.server).unwrap_or_default();
            (entry.server, raw)
        })
        .find(|(s, _)| s.name == target))
}

/// Build a display summary from a parsed server.json.
fn summary_from_json(json: &ServerJson) -> McpRegistryServerSummary {
    let name = json.name.clone();
    let title = json
        .title
        .clone()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| last_segment(&name));
    McpRegistryServerSummary {
        name,
        title,
        description: json.description.clone(),
        version: json.version.clone(),
        transports: derive_transports_json(json),
        repository: json.repository.as_ref().and_then(|r| r.url.clone()),
        stars: None,
        downloads: None,
        inputs: json
            .inputs
            .iter()
            .map(McpRegistryInput::from_json)
            .collect(),
        status: None,
        updated_at: None,
        package_keys: json
            .packages
            .iter()
            .filter_map(|p| {
                p.identifier
                    .clone()
                    .filter(|i| !i.trim().is_empty())
                    .map(|id| (p.registry_type.clone(), id))
            })
            .collect(),
    }
}

/// Build a display summary from a registry entry, carrying `_meta` lifecycle info.
fn summary_from_entry(entry: &RegistryEntry) -> McpRegistryServerSummary {
    let mut summary = summary_from_json(&entry.server);
    summary.status = entry.meta.official.status.clone();
    summary.updated_at = entry.meta.official.updated_at.clone();
    summary
}

/// Last path segment of a registry name (e.g. "filesystem" from "io.github.x/filesystem").
fn last_segment(name: &str) -> String {
    name.rsplit('/').next().unwrap_or(name).to_string()
}

/// Derive the transport strings present on a server ("stdio" from packages,
/// "http"/"sse" from remotes), deduped in stable order.
#[must_use]
pub fn derive_transports(json: &serde_json::Value) -> Vec<String> {
    match serde_json::from_value::<ServerJson>(json.clone()) {
        Ok(parsed) => derive_transports_json(&parsed),
        Err(_) => Vec::new(),
    }
}

fn derive_transports_json(json: &ServerJson) -> Vec<String> {
    let mut transports = Vec::new();
    for pkg in &json.packages {
        if let Some(transport) = &pkg.transport {
            push_unique(&mut transports, normalize_transport(&transport.kind));
        }
    }
    for remote in &json.remotes {
        push_unique(&mut transports, normalize_transport(&remote.kind));
    }
    transports
}

/// Map a registry transport kind to our frontend union.
fn normalize_transport(kind: &str) -> String {
    match kind {
        "stdio" => "stdio".to_string(),
        "streamable-http" => "http".to_string(),
        "sse" => "sse".to_string(),
        other => other.to_string(),
    }
}

fn push_unique(v: &mut Vec<String>, s: String) {
    if !v.contains(&s) {
        v.push(s);
    }
}

/// Flatten a registry argument into CLI tokens. Named args become `[name, value]`.
fn flatten_arg(arg: &ArgJson) -> Vec<String> {
    let mut out = Vec::with_capacity(2);
    if let Some(name) = &arg.name {
        if !name.is_empty() {
            out.push(name.clone());
        }
    }
    out.push(arg.value.clone());
    out
}

/// Render an env default value as a plain string (unquoted).
fn default_value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Generate a launch-config template from a parsed server.json.
///
/// Returns `Ok(None)` when the JSON cannot be parsed or has no usable
/// package/remote (graceful degradation, never panics).
pub fn generate_config(json: &serde_json::Value) -> Result<Option<McpRegistryGeneratedConfig>> {
    let parsed: ServerJson = match serde_json::from_value(json.clone()) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(None),
    };
    Ok(generate_from_parsed(&parsed))
}

fn generate_from_parsed(json: &ServerJson) -> Option<McpRegistryGeneratedConfig> {
    if let Some(pkg) = pick_package(&json.packages) {
        return Some(config_from_package(json, pkg));
    }
    if let Some(remote) = json.remotes.first() {
        return Some(config_from_remote(json, remote));
    }
    None
}

/// Select the package to prefer: npm > pypi > nuget > other (first parseable).
fn pick_package(packages: &[PackageJson]) -> Option<&PackageJson> {
    let rank = |p: &PackageJson| match p.registry_type.as_str() {
        "npm" => 0,
        "pypi" => 1,
        "nuget" => 2,
        _ => 3,
    };
    packages
        .iter()
        .filter(|p| p.identifier.as_deref().is_some_and(|i| !i.is_empty()))
        .min_by_key(|p| rank(p))
}

/// Build a stdio launch template from an npm/pypi/nuget package.
fn config_from_package(json: &ServerJson, pkg: &PackageJson) -> McpRegistryGeneratedConfig {
    let identifier = pkg.identifier.clone().unwrap_or_default();
    let command = pkg
        .runtime_hint
        .clone()
        .filter(|c| !c.trim().is_empty())
        .unwrap_or_else(|| default_command(&pkg.registry_type));

    let mut args: Vec<String> = pkg.runtime_arguments.iter().flat_map(flatten_arg).collect();
    // npm packages conventionally need -y for npx; inject when not already present.
    if command == "npx" && !args.contains(&"-y".to_string()) {
        args.insert(0, "-y".to_string());
    }
    args.push(identifier);
    args.extend(pkg.package_arguments.iter().flat_map(flatten_arg));

    let env = pkg
        .environment_variables
        .iter()
        .map(|e| McpRegistryEnvVar {
            name: e.name.clone(),
            is_secret: e.is_secret,
            is_required: e.is_required,
            default: e.default.as_ref().map(default_value_to_string),
        })
        .collect();

    McpRegistryGeneratedConfig {
        name: json
            .title
            .clone()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| last_segment(&json.name)),
        description: json.description.clone(),
        command,
        args,
        env,
        transport: "stdio".to_string(),
        url: None,
        inputs: json
            .inputs
            .iter()
            .map(McpRegistryInput::from_json)
            .collect(),
    }
}

/// Default launcher command per registry type.
fn default_command(registry_type: &str) -> String {
    match registry_type {
        "pypi" => "uvx".to_string(),
        "nuget" => "dotnet".to_string(),
        _ => "npx".to_string(),
    }
}

/// Build a remote launch template from a streamable-http/sse remote.
fn config_from_remote(json: &ServerJson, remote: &RemoteJson) -> McpRegistryGeneratedConfig {
    McpRegistryGeneratedConfig {
        name: json
            .title
            .clone()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| last_segment(&json.name)),
        description: json.description.clone(),
        command: String::new(),
        args: Vec::new(),
        env: Vec::new(),
        transport: normalize_transport(&remote.kind),
        url: Some(remote.url.clone()),
        inputs: json
            .inputs
            .iter()
            .map(McpRegistryInput::from_json)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NPM_SAMPLE: &str = r#"{
        "name": "com.pulsemcp/remote-filesystem",
        "description": "MCP server for remote filesystem operations on cloud storage.",
        "repository": { "url": "https://github.com/pulsemcp/mcp-servers", "source": "github" },
        "version": "0.1.5",
        "packages": [{
            "registryType": "npm",
            "identifier": "remote-filesystem-mcp-server",
            "version": "0.1.5",
            "runtimeHint": "npx",
            "transport": { "type": "stdio" },
            "runtimeArguments": [ { "value": "-y", "type": "positional" } ],
            "environmentVariables": [
                { "description": "Bucket name.", "isRequired": true, "name": "GCS_BUCKET" },
                { "description": "Private key.", "isSecret": true, "name": "GCS_PRIVATE_KEY" },
                { "description": "Public flag.", "default": "false", "name": "GCS_MAKE_PUBLIC" }
            ]
        }]
    }"#;

    const SNYK_SAMPLE: &str = r#"{
        "name": "io.snyk/mcp",
        "description": "MCP server provided by the Snyk CLI",
        "version": "1.1298.0",
        "packages": [{
            "registryType": "npm",
            "identifier": "snyk",
            "transport": { "type": "stdio" },
            "packageArguments": [
                { "value": "mcp", "type": "positional" },
                { "value": "stdio", "type": "named", "name": "-t" }
            ]
        }]
    }"#;

    const PYPI_SAMPLE: &str = r#"{
        "name": "io.github.benseverndev-oss/goldenpipe",
        "title": "GoldenPipe",
        "description": "Chain GoldenCheck + Flow + Match.",
        "version": "1.4.0",
        "packages": [{
            "registryType": "pypi",
            "identifier": "goldenpipe",
            "version": "1.4.0",
            "runtimeHint": "uvx",
            "transport": { "type": "stdio" }
        }]
    }"#;

    const REMOTE_HTTP_SAMPLE: &str = r#"{
        "name": "ac.inference.sh/mcp",
        "description": "Inference MCP gateway",
        "version": "1.0.0",
        "remotes": [ { "type": "streamable-http", "url": "https://api.inference.sh/mcp" } ]
    }"#;

    const REMOTE_SSE_SAMPLE: &str = r#"{
        "name": "io.github.humanjesse/textarttools-mcp",
        "remotes": [ { "type": "sse", "url": "https://humanjesse.github.io/textarttools-mcp/sse" } ]
    }"#;

    const MALFORMED: &str = r#"{"name": "broken", "packages": "not-an-array"}"#;

    fn parse(v: &str) -> serde_json::Value {
        serde_json::from_str(v).unwrap()
    }

    #[test]
    fn derive_transports_npm_package_is_stdio() {
        assert_eq!(derive_transports(&parse(NPM_SAMPLE)), vec!["stdio"]);
    }

    #[test]
    fn derive_transports_remote_maps_http_and_sse() {
        assert_eq!(derive_transports(&parse(REMOTE_HTTP_SAMPLE)), vec!["http"]);
        assert_eq!(derive_transports(&parse(REMOTE_SSE_SAMPLE)), vec!["sse"]);
    }

    #[test]
    fn derive_transports_malformed_is_empty() {
        assert!(derive_transports(&parse(MALFORMED)).is_empty());
    }

    #[test]
    fn generate_config_npm_package() {
        let cfg = generate_config(&parse(NPM_SAMPLE)).unwrap().unwrap();
        assert_eq!(cfg.name, "remote-filesystem");
        assert_eq!(cfg.command, "npx");
        assert_eq!(cfg.args, vec!["-y", "remote-filesystem-mcp-server"]);
        assert_eq!(cfg.transport, "stdio");
        assert!(cfg.url.is_none());
    }

    #[test]
    fn generate_config_npm_with_package_arguments() {
        let cfg = generate_config(&parse(SNYK_SAMPLE)).unwrap().unwrap();
        assert_eq!(cfg.command, "npx");
        assert_eq!(cfg.args, vec!["-y", "snyk", "mcp", "-t", "stdio"]);
        assert_eq!(cfg.name, "mcp");
    }

    #[test]
    fn generate_config_pypi_uses_runtime_hint() {
        let cfg = generate_config(&parse(PYPI_SAMPLE)).unwrap().unwrap();
        assert_eq!(cfg.command, "uvx");
        assert_eq!(cfg.args, vec!["goldenpipe"]);
        assert_eq!(cfg.name, "GoldenPipe");
    }

    #[test]
    fn generate_config_remote_http() {
        let cfg = generate_config(&parse(REMOTE_HTTP_SAMPLE))
            .unwrap()
            .unwrap();
        assert_eq!(cfg.transport, "http");
        assert_eq!(cfg.url.as_deref(), Some("https://api.inference.sh/mcp"));
        assert!(cfg.command.is_empty());
        assert!(cfg.args.is_empty());
    }

    #[test]
    fn generate_config_remote_sse() {
        let cfg = generate_config(&parse(REMOTE_SSE_SAMPLE)).unwrap().unwrap();
        assert_eq!(cfg.transport, "sse");
        assert_eq!(
            cfg.url.as_deref(),
            Some("https://humanjesse.github.io/textarttools-mcp/sse")
        );
    }

    #[test]
    fn generate_config_env_vars_keep_secret_and_required_flags() {
        let cfg = generate_config(&parse(NPM_SAMPLE)).unwrap().unwrap();
        let bucket = cfg.env.iter().find(|e| e.name == "GCS_BUCKET").unwrap();
        assert!(bucket.is_required);
        assert!(!bucket.is_secret);
        let key = cfg
            .env
            .iter()
            .find(|e| e.name == "GCS_PRIVATE_KEY")
            .unwrap();
        assert!(key.is_secret);
        assert!(!key.is_required);
        let public = cfg
            .env
            .iter()
            .find(|e| e.name == "GCS_MAKE_PUBLIC")
            .unwrap();
        assert_eq!(public.default.as_deref(), Some("false"));
    }

    #[test]
    fn generate_config_malformed_degrades_to_none() {
        assert!(generate_config(&parse(MALFORMED)).unwrap().is_none());
    }

    #[test]
    fn generate_config_never_panics_on_missing_fields() {
        let minimal = parse(r#"{"name":"x/y"}"#);
        let cfg = generate_config(&minimal).unwrap();
        assert!(cfg.is_none());
    }
}
