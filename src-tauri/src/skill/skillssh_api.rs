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
    let url = format!("https://skills.sh/leaderboard/{}", board.as_str());

    let html = client
        .get(&url)
        .send()
        .context("Failed to fetch leaderboard")?
        .text()
        .context("Failed to read response body")?;

    parse_leaderboard_html(&html)
}

pub fn search_skills(
    query: &str,
    limit: usize,
    proxy_url: Option<&str>,
) -> Result<Vec<SkillsShSkill>> {
    let client = build_http_client(proxy_url, 30)?;
    let encoded_query = urlencoding::encode(query);
    let url = format!(
        "https://skills.sh/search?q={}&limit={}",
        encoded_query, limit
    );

    let html = client
        .get(&url)
        .send()
        .context("Failed to search skills")?
        .text()
        .context("Failed to read response body")?;

    parse_search_html(&html)
}

fn parse_leaderboard_html(html: &str) -> Result<Vec<SkillsShSkill>> {
    // Try parsing __NEXT_DATA__ JSON first
    if let Ok(skills) = parse_next_data(html) {
        return Ok(skills);
    }

    // Fallback to regex parsing
    parse_rsc_payload(html)
}

fn parse_search_html(html: &str) -> Result<Vec<SkillsShSkill>> {
    // Try parsing __NEXT_DATA__ JSON first
    if let Ok(skills) = parse_next_data(html) {
        return Ok(skills);
    }

    // Fallback to regex parsing
    parse_rsc_payload(html)
}

fn parse_next_data(html: &str) -> Result<Vec<SkillsShSkill>> {
    let re = Regex::new(r#"__NEXT_DATA__[^>]*>(.*?)</script>"#)?;
    let caps = re.captures(html).context("No __NEXT_DATA__ found")?;
    let json_str = caps.get(1).context("No JSON content")?.as_str();

    let data: serde_json::Value = serde_json::from_str(json_str)?;

    let mut skills = Vec::new();

    if let Some(items) = data
        .pointer("/props/pageProps/skills")
        .and_then(|v| v.as_array())
    {
        for item in items {
            if let Some(skill) = parse_skill_from_json(item) {
                skills.push(skill);
            }
        }
    } else if let Some(items) = data
        .pointer("/props/pageProps/results")
        .and_then(|v| v.as_array())
    {
        for item in items {
            if let Some(skill) = parse_skill_from_json(item) {
                skills.push(skill);
            }
        }
    }

    Ok(skills)
}

fn parse_skill_from_json(item: &serde_json::Value) -> Option<SkillsShSkill> {
    let source = item.get("source").and_then(|v| v.as_str())?.to_string();
    let skill_id = item
        .get("id")
        .or_else(|| item.get("skill_id"))?
        .as_str()?
        .to_string();
    let name = item
        .get("name")
        .or_else(|| item.get("title"))?
        .as_str()?
        .to_string();
    let installs = item
        .get("installs")
        .or_else(|| item.get("downloads"))?
        .as_u64()
        .unwrap_or(0);

    Some(SkillsShSkill {
        id: format!("{}/{}", source, skill_id),
        skill_id,
        name,
        source,
        installs,
    })
}

fn parse_rsc_payload(html: &str) -> Result<Vec<SkillsShSkill>> {
    let mut skills = Vec::new();

    // Regex patterns for parsing RSC payload
    let re_source = Regex::new(r#""source":"([^"]+)""#)?;
    let re_id = Regex::new(r#""(?:skill_)?id":"([^"]+)""#)?;
    let re_name = Regex::new(r#""(?:name|title)":"([^"]+)""#)?;
    let re_installs = Regex::new(r#""(?:installs|downloads)":(\d+)"#)?;

    // Find all skill blocks
    let re_block = Regex::new(
        r#"\{"source":"[^"]+","(?:skill_)?id":"[^"]+","(?:name|title)":"[^"]+"[^}]*\}"#,
    )?;

    for cap in re_block.captures_iter(html) {
        let block = cap.get(0).unwrap().as_str();

        let source = re_source
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        let skill_id = re_id
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
    fn parse_next_data_test() {
        let html = r#"
        <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"skills":[
            {"source":"antfu/skills","id":"vite","name":"Vite","installs":12345},
            {"source":"anthropics/skills","id":"claude","name":"Claude","installs":6789}
        ]}}}
        </script>
        "#;

        let skills = parse_next_data(html).unwrap();
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].source, "antfu/skills");
        assert_eq!(skills[0].skill_id, "vite");
        assert_eq!(skills[0].installs, 12345);
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
