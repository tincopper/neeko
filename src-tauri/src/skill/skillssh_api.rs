use anyhow::{Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsShSkill {
    pub id: String,
    pub skill_id: String,
    pub name: String,
    pub source: String,
    pub installs: u64,
}

#[derive(Debug, Clone, Copy)]
pub enum LeaderboardType {
    AllTime,
    Trending,
    Hot,
}

impl LeaderboardType {
    pub fn as_str(&self) -> &'static str {
        match self {
            LeaderboardType::AllTime => "alltime",
            LeaderboardType::Trending => "trending",
            LeaderboardType::Hot => "hot",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "trending" => LeaderboardType::Trending,
            "hot" => LeaderboardType::Hot,
            _ => LeaderboardType::AllTime,
        }
    }
}

pub fn build_http_client(
    proxy_url: Option<&str>,
    timeout_secs: u64,
) -> Result<reqwest::blocking::Client> {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent("neeko/1.0");

    if let Some(proxy) = proxy_url {
        builder = builder.proxy(reqwest::Proxy::all(proxy)?);
    }

    Ok(builder.build()?)
}

pub fn fetch_leaderboard(
    board: LeaderboardType,
    proxy_url: Option<&str>,
) -> Result<Vec<SkillsShSkill>> {
    let client = build_http_client(proxy_url, 30)?;
    let url = match board {
        LeaderboardType::AllTime => "https://skills.sh/".to_string(),
        LeaderboardType::Hot => "https://skills.sh/hot".to_string(),
        LeaderboardType::Trending => "https://skills.sh/trending".to_string(),
    };

    let html = client
        .get(&url)
        .send()
        .context("Failed to fetch leaderboard")?
        .text()
        .context("Failed to read response body")?;

    parse_skills_from_html(&html)
}

pub fn search_skills(
    query: &str,
    _limit: usize,
    proxy_url: Option<&str>,
) -> Result<Vec<SkillsShSkill>> {
    let client = build_http_client(proxy_url, 30)?;
    let encoded_query = urlencoding::encode(query);
    let url = format!("https://skills.sh/?q={}", encoded_query);

    let html = client
        .get(&url)
        .send()
        .context("Failed to search skills")?
        .text()
        .context("Failed to read response body")?;

    parse_skills_from_html(&html)
}

fn parse_skills_from_html(html: &str) -> Result<Vec<SkillsShSkill>> {
    // Try parsing RSC initialSkills payload first (skills.sh uses RSC format)
    if let Ok(skills) = parse_rsc_initial_skills(html) {
        if !skills.is_empty() {
            return Ok(skills);
        }
    }

    // Fallback to regex-based RSC parsing
    parse_rsc_payload(html)
}

/// Intermediate struct for deserializing skills.sh RSC JSON entries.
/// The RSC payload uses `skillId` (camelCase) while our public struct uses `skill_id`.
#[derive(Deserialize)]
struct RscSkillEntry {
    source: String,
    #[serde(alias = "skillId", alias = "skill_id", alias = "id")]
    skill_id: String,
    name: String,
    installs: u64,
}

/// Parse skills from the RSC flight data format used by skills.sh (Next.js 15).
///
/// The HTML contains inline `<script>` tags with `self.__next_f.push([1,"..."])` calls.
/// The skill data lives in an `initialSkills` JSON array embedded in these push blocks.
fn parse_rsc_initial_skills(html: &str) -> Result<Vec<SkillsShSkill>> {
    // The RSC payload uses escaped quotes: \" inside JavaScript string literals.
    // Pattern: initialSkills":[  or  initialSkills\":[  (escaped quote)
    let re = Regex::new(r#"initialSkills\\?":\[(.*?)\]"#)?;
    let caps = re.captures(html).context("No initialSkills found in RSC payload")?;
    let raw_array = caps.get(1).context("No skills array content")?.as_str();

    // Parse individual skill objects from the JSON array.
    // The content has escaped quotes like {\"source\":\"owner/repo\",...}
    // serde_json handles \" -> " natively.
    // Hot page entries have extra fields: "installsYesterday":N,"change":N
    let skill_re = Regex::new(
        r#"\{\\?"source\\?":\\?"[^"]+\\?",\\?"skillId\\?":\\?"[^"]+\\?",\\?"name\\?":\\?"[^"]+\\?",\\?"installs\\?":\d+(?:,\\?"installsYesterday\\?":\d+,\\?"change\\?":\d+)?\}"#
    )?;

    let mut skills = Vec::new();
    for cap in skill_re.captures_iter(raw_array) {
        let json_str = cap.get(0).unwrap().as_str();
        // Unescape \" -> " for JSON parsing
        let unescaped = json_str.replace("\\\"", "\"");
        if let Ok(entry) = serde_json::from_str::<RscSkillEntry>(&unescaped) {
            skills.push(SkillsShSkill {
                id: format!("{}/{}", entry.source, entry.skill_id),
                skill_id: entry.skill_id,
                name: entry.name,
                source: entry.source,
                installs: entry.installs,
            });
        }
    }

    Ok(skills)
}

/// Fallback regex-based parser for RSC payload skill data.
fn parse_rsc_payload(html: &str) -> Result<Vec<SkillsShSkill>> {
    let mut skills = Vec::new();

    // Regex patterns for parsing RSC payload (handles both escaped and unescaped quotes)
    let re_source = Regex::new(r#"\\?"source\\?":\\?"([^"]+)\\?""#)?;
    let re_skill_id = Regex::new(r#"\\?"skillId\\?":\\?"([^"]+)\\?""#)?;
    let re_name = Regex::new(r#"\\?"name\\?":\\?"([^"]+)\\?""#)?;
    let re_installs = Regex::new(r#"\\?"installs\\?":(\d+)"#)?;

    // Find all skill blocks with new format
    let re_block = Regex::new(
        r#"\{\\?"source\\?":\\?"[^"]+\\?",\\?"skillId\\?":\\?"[^"]+\\?",\\?"name\\?":\\?"[^"]+\\?",\\?"installs\\?":\d+[^}]*\}"#,
    )?;

    for cap in re_block.captures_iter(html) {
        let block = cap.get(0).unwrap().as_str();

        let source = re_source
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        let skill_id = re_skill_id
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        let name = re_name
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        let installs = re_installs
            .captures(block)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);

        if !source.is_empty() && !skill_id.is_empty() {
            skills.push(SkillsShSkill {
                id: format!("{}/{}", source, skill_id),
                skill_id,
                name,
                source,
                installs,
            });
        }
    }

    Ok(skills)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rsc_initial_skills_test() {
        // Simulated RSC flight data with initialSkills array (standard format)
        let html = r#"
        <script>self.__next_f.push([1,"16:[\"$\",\"$L1e\",null,{\"initialSkills\":[{\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"find-skills\",\"installs\":1164942},{\"source\":\"anthropics/skills\",\"skillId\":\"pdf\",\"name\":\"pdf\",\"installs\":82400}]}"])</script>
        "#;

        let skills = parse_rsc_initial_skills(html).unwrap();
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].source, "vercel-labs/skills");
        assert_eq!(skills[0].skill_id, "find-skills");
        assert_eq!(skills[0].id, "vercel-labs/skills/find-skills");
        assert_eq!(skills[0].installs, 1164942);
        assert_eq!(skills[1].source, "anthropics/skills");
        assert_eq!(skills[1].skill_id, "pdf");
        assert_eq!(skills[1].installs, 82400);
    }

    #[test]
    fn parse_rsc_hot_format_test() {
        // Hot page has extra installsYesterday and change fields
        let html = r#"
        <script>self.__next_f.push([1,"18:[\"$\",\"$L20\",null,{\"initialSkills\":[{\"source\":\"sentry/dev\",\"skillId\":\"sentry-cli\",\"name\":\"sentry-cli\",\"installs\":88,\"installsYesterday\":29,\"change\":59},{\"source\":\"intellectronica/agent-skills\",\"skillId\":\"notion-api\",\"name\":\"notion-api\",\"installs\":61,\"installsYesterday\":11,\"change\":50}]}"])</script>
        "#;

        let skills = parse_rsc_initial_skills(html).unwrap();
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].source, "sentry/dev");
        assert_eq!(skills[0].skill_id, "sentry-cli");
        assert_eq!(skills[0].installs, 88);
        assert_eq!(skills[1].source, "intellectronica/agent-skills");
        assert_eq!(skills[1].skill_id, "notion-api");
        assert_eq!(skills[1].installs, 61);
    }

    #[test]
    fn parse_skills_from_html_integration_test() {
        // Test the full pipeline with RSC format
        let html = r#"<!DOCTYPE html><html><body>
        <script>(self.__next_f=self.__next_f||[]).push([0])</script>
        <script>self.__next_f.push([1,"0:\"$Sreact.fragment\""])</script>
        <script>self.__next_f.push([1,"16:[\"$\",\"$L1e\",null,{\"initialSkills\":[{\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"find-skills\",\"installs\":1164942}]}"])</script>
        </body></html>"#;

        let skills = parse_skills_from_html(html).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "vercel-labs/skills/find-skills");
        assert_eq!(skills[0].name, "find-skills");
    }

    #[test]
    fn parse_empty_html_returns_empty() {
        let html = "<html><body>No skills here</body></html>";
        let skills = parse_skills_from_html(html).unwrap();
        assert_eq!(skills.len(), 0);
    }

    #[test]
    fn leaderboard_type_conversion() {
        assert_eq!(LeaderboardType::AllTime.as_str(), "alltime");
        assert_eq!(LeaderboardType::Trending.as_str(), "trending");
        assert_eq!(LeaderboardType::Hot.as_str(), "hot");

        match LeaderboardType::from_str("trending") {
            LeaderboardType::Trending => {}
            _ => panic!("Expected Trending"),
        }
    }
}
