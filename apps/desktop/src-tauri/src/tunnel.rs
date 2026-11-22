//! Gives a copy running on this computer its https addresses through a Cloudflare Tunnel,
//! so teammates and webhooks reach it without opening ports on the router.
//!
//! With a Cloudflare token the person makes once, the app finds their domains, makes (or
//! finds again) a tunnel, tells it which name goes to which piece, and points each name at
//! it. The tunnel's own token goes into the stack's settings file as TUNNEL_TOKEN, where the
//! `tunnel` service in compose.yml runs cloudflared with it. The Cloudflare token itself is
//! used for this and never kept.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::stack::Addresses;
use crate::NAME;

pub const API: &str = "https://api.cloudflare.com/client/v4";

/// Where the person makes the token, and what it needs.
pub const TOKEN_PAGE: &str = "https://dash.cloudflare.com/profile/api-tokens";

/// A domain on the person's Cloudflare account.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Domain {
    pub id: String,
    pub name: String,
    pub account: String,
}

/// What the app keeps about the tunnel (tunnel.json beside the stack's settings). No
/// secrets: the tunnel's token is in .env, the Cloudflare token isn't kept at all.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub domain: Domain,
    pub name: String,
    pub tunnel: String,
}

/// Each piece, the start of its name, and where it listens inside Docker.
const PIECES: [(&str, &str); 5] = [
    ("", "http://web:3000"),
    ("-api", "http://convex:3210"),
    ("-actions", "http://convex:3211"),
    ("-agent", "http://agent:4111"),
    ("-toolkit", "http://toolkit:8080"),
];

/// The name the person picks becomes the first part of every address. One level under the
/// domain, so Cloudflare's free certificate covers each of them.
pub fn check_name(name: &str) -> Result<String, String> {
    let name = name.trim().to_ascii_lowercase();
    let fits = !name.is_empty()
        && name.len() <= 40
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !name.starts_with('-')
        && !name.ends_with('-');
    if fits {
        Ok(name)
    } else {
        Err(format!(
            "Use only letters, numbers and dashes for the name, such as {}.",
            NAME.to_lowercase()
        ))
    }
}

/// The host name of each piece, in the order of PIECES.
pub fn hosts(name: &str, domain: &str) -> [String; 5] {
    PIECES.map(|(suffix, _)| format!("{name}{suffix}.{domain}"))
}

pub fn addresses(name: &str, domain: &str) -> Addresses {
    let [dashboard, api, site, agent, toolkit] =
        hosts(name, domain).map(|host| format!("https://{host}"));
    Addresses {
        dashboard,
        api,
        site,
        agent,
        toolkit,
    }
}

/// The tunnel's routes: each name to its piece, and nothing for anything else.
pub fn ingress(name: &str, domain: &str) -> Value {
    let mut rules: Vec<Value> = hosts(name, domain)
        .into_iter()
        .zip(PIECES)
        .map(|(host, (_, service))| json!({ "hostname": host, "service": service }))
        .collect();
    rules.push(json!({ "service": "http_status:404" }));
    json!({ "config": { "ingress": rules } })
}

pub fn target(tunnel: &str) -> String {
    format!("{tunnel}.cfargotunnel.com")
}

pub struct Cloudflare {
    client: reqwest::Client,
    base: String,
    token: String,
}

#[derive(Deserialize)]
struct Reply<T> {
    success: bool,
    #[serde(default)]
    errors: Vec<Problem>,
    result: Option<T>,
}

#[derive(Deserialize)]
struct Problem {
    #[serde(default)]
    code: u64,
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct Zone {
    id: String,
    name: String,
    account: ZoneAccount,
}

#[derive(Deserialize)]
struct ZoneAccount {
    id: String,
}

#[derive(Deserialize)]
struct Tunnel {
    id: String,
    #[serde(default)]
    deleted_at: Option<String>,
}

#[derive(Deserialize)]
struct Record {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    content: String,
}

fn needs() -> String {
    format!("Make a token at {TOKEN_PAGE} with Zone: Read, DNS: Edit and Cloudflare Tunnel: Edit.")
}

impl Cloudflare {
    pub fn new(base: &str, token: &str) -> Result<Self, String> {
        let token = token.trim();
        if token.is_empty() {
            return Err(format!("Enter your Cloudflare token. {}", needs()));
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| format!("{NAME} couldn't start a connection on this computer."))?;
        Ok(Cloudflare {
            client,
            base: base.trim_end_matches('/').to_string(),
            token: token.to_string(),
        })
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<T, String> {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| {
            "Couldn't reach Cloudflare. Check this computer's connection.".to_string()
        })?;
        let status = response.status();
        let reply: Reply<T> = response
            .json()
            .await
            .map_err(|_| format!("Cloudflare gave an answer {NAME} didn't understand."))?;
        if let (true, Some(result)) = (reply.success, reply.result) {
            return Ok(result);
        }
        let refused = status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
            || reply
                .errors
                .iter()
                .any(|problem| matches!(problem.code, 9109 | 10000 | 10001));
        if refused {
            return Err(format!(
                "Cloudflare didn't allow that with this token. {}",
                needs()
            ));
        }
        let said = reply
            .errors
            .iter()
            .map(|problem| problem.message.trim())
            .filter(|message| !message.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        Err(if said.is_empty() {
            "Cloudflare refused that. Try again.".to_string()
        } else {
            format!("Cloudflare said: {said}")
        })
    }

    /// The active domains this token can change.
    pub async fn domains(&self) -> Result<Vec<Domain>, String> {
        let zones: Vec<Zone> = self
            .call(
                reqwest::Method::GET,
                "/zones?status=active&per_page=50",
                None,
            )
            .await?;
        if zones.is_empty() {
            return Err(
                "This Cloudflare account has no active domain yet. Add your domain to Cloudflare first."
                    .into(),
            );
        }
        Ok(zones
            .into_iter()
            .map(|zone| Domain {
                id: zone.id,
                name: zone.name,
                account: zone.account.id,
            })
            .collect())
    }

    /// The tunnel to use: the one made before if it's still there, else one by this name,
    /// else a new one. Gives back its id and the token cloudflared runs with.
    pub async fn tunnel(
        &self,
        account: &str,
        name: &str,
        before: Option<&str>,
    ) -> Result<(String, String), String> {
        let tunnels = format!("/accounts/{account}/cfd_tunnel");
        let mut found = None;
        if let Some(id) = before {
            if let Ok(tunnel) = self
                .call::<Tunnel>(reqwest::Method::GET, &format!("{tunnels}/{id}"), None)
                .await
            {
                if tunnel.deleted_at.is_none() {
                    found = Some(tunnel.id);
                }
            }
        }
        if found.is_none() {
            let named: Vec<Tunnel> = self
                .call(
                    reqwest::Method::GET,
                    &format!("{tunnels}?name={name}&is_deleted=false"),
                    None,
                )
                .await?;
            found = named.into_iter().next().map(|tunnel| tunnel.id);
        }
        let id = match found {
            Some(id) => id,
            None => {
                let made: Tunnel = self
                    .call(
                        reqwest::Method::POST,
                        &tunnels,
                        Some(json!({ "name": name, "config_src": "cloudflare" })),
                    )
                    .await?;
                made.id
            }
        };
        let token: String = self
            .call(reqwest::Method::GET, &format!("{tunnels}/{id}/token"), None)
            .await?;
        Ok((id, token))
    }

    pub async fn route(&self, account: &str, tunnel: &str, routes: Value) -> Result<(), String> {
        self.call::<Value>(
            reqwest::Method::PUT,
            &format!("/accounts/{account}/cfd_tunnel/{tunnel}/configurations"),
            Some(routes),
        )
        .await
        .map(|_| ())
    }

    /// Points `host` at the tunnel. A name already used for something else is left alone:
    /// it could be the person's own website.
    pub async fn point(&self, zone: &str, host: &str, tunnel: &str) -> Result<(), String> {
        let records = format!("/zones/{zone}/dns_records");
        let existing: Vec<Record> = self
            .call(
                reqwest::Method::GET,
                &format!("{records}?name={host}"),
                None,
            )
            .await?;
        let want = target(tunnel);
        let record = json!({ "type": "CNAME", "name": host, "content": want, "proxied": true });
        match existing.first() {
            None => self
                .call::<Value>(reqwest::Method::POST, &records, Some(record))
                .await
                .map(|_| ()),
            Some(found) if found.kind == "CNAME" && found.content.ends_with(".cfargotunnel.com") => {
                if found.content == want {
                    return Ok(());
                }
                self.call::<Value>(
                    reqwest::Method::PATCH,
                    &format!("{records}/{}", found.id),
                    Some(record),
                )
                .await
                .map(|_| ())
            }
            Some(_) => Err(format!(
                "{host} already points somewhere else. Pick another name so {NAME} doesn't replace it."
            )),
        }
    }
}

/// Makes everything for `name` on `domain` and gives back what to keep and the tunnel's token.
pub async fn make(
    cloudflare: &Cloudflare,
    domain: &Domain,
    name: &str,
    before: Option<&Saved>,
) -> Result<(Saved, String), String> {
    let name = check_name(name)?;
    let earlier = before
        .filter(|saved| saved.domain.account == domain.account)
        .map(|saved| saved.tunnel.as_str());
    let (tunnel, token) = cloudflare
        .tunnel(&domain.account, &format!("{name}-{}", domain.name), earlier)
        .await?;
    cloudflare
        .route(&domain.account, &tunnel, ingress(&name, &domain.name))
        .await?;
    for host in hosts(&name, &domain.name) {
        cloudflare.point(&domain.id, &host, &tunnel).await?;
    }
    Ok((
        Saved {
            domain: domain.clone(),
            name,
            tunnel,
        },
        token,
    ))
}

pub fn saved_path(folder: &Path) -> PathBuf {
    folder.join("tunnel.json")
}

pub fn load(folder: &Path) -> Option<Saved> {
    let text = fs::read_to_string(saved_path(folder)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn keep(folder: &Path, saved: &Saved) -> Result<(), String> {
    let problem = |_| format!("{NAME} couldn't write to {}.", folder.display());
    fs::create_dir_all(folder).map_err(problem)?;
    let text = serde_json::to_string_pretty(saved).expect("tunnel settings are plain values");
    fs::write(saved_path(folder), text).map_err(problem)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    type Log = Arc<Mutex<Vec<String>>>;

    /// A stand-in for Cloudflare's API: `answer` gets "METHOD /path" and the body, and
    /// gives back the status and JSON. Every request is logged as "METHOD /path body".
    async fn fake(answer: fn(&str, &Value) -> (u16, Value)) -> (String, Log) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let log: Log = Arc::default();
        let kept = log.clone();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let log = kept.clone();
                tokio::spawn(async move {
                    let mut buffer = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (head, body) = loop {
                        let read = socket.read(&mut chunk).await.unwrap_or(0);
                        if read == 0 {
                            return;
                        }
                        buffer.extend_from_slice(&chunk[..read]);
                        let text = String::from_utf8_lossy(&buffer).to_string();
                        if let Some((head, body)) = text.split_once("\r\n\r\n") {
                            let length = head
                                .lines()
                                .find_map(|line| {
                                    let (name, value) = line.split_once(':')?;
                                    name.eq_ignore_ascii_case("content-length")
                                        .then(|| value.trim().parse::<usize>().ok())?
                                })
                                .unwrap_or(0);
                            if body.len() >= length {
                                break (head.to_string(), body.to_string());
                            }
                        }
                    };
                    let first = head.lines().next().unwrap_or_default();
                    let mut parts = first.split(' ');
                    let request = format!(
                        "{} {}",
                        parts.next().unwrap_or_default(),
                        parts.next().unwrap_or_default()
                    );
                    let authorized = head
                        .lines()
                        .any(|line| line.eq_ignore_ascii_case("authorization: Bearer cf-token"));
                    let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                    log.lock().unwrap().push(format!("{request} {body}"));
                    let (status, reply) = if authorized {
                        answer(&request, &body)
                    } else {
                        (
                            403,
                            json!({ "success": false, "errors": [{ "code": 10000, "message": "Authentication error" }] }),
                        )
                    };
                    let reply = reply.to_string();
                    let text = format!(
                        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                        reply.len()
                    );
                    let _ = socket.write_all(text.as_bytes()).await;
                });
            }
        });
        (format!("http://{address}"), log)
    }

    fn ok(result: Value) -> (u16, Value) {
        (
            200,
            json!({ "success": true, "errors": [], "result": result }),
        )
    }

    fn domain() -> Domain {
        Domain {
            id: "zone1".into(),
            name: "example.com".into(),
            account: "acct1".into(),
        }
    }

    /// A Cloudflare account with nothing made yet, where app.example.com is the person's site.
    fn empty_account(request: &str, _body: &Value) -> (u16, Value) {
        match request {
            r if r.starts_with("GET /zones?") => ok(json!([
                { "id": "zone1", "name": "example.com", "account": { "id": "acct1" } }
            ])),
            r if r.starts_with("GET /accounts/acct1/cfd_tunnel?") => ok(json!([])),
            "POST /accounts/acct1/cfd_tunnel" => ok(json!({ "id": "t1", "token": "ignored" })),
            "GET /accounts/acct1/cfd_tunnel/t1/token" => ok(json!("run-token")),
            "PUT /accounts/acct1/cfd_tunnel/t1/configurations" => ok(json!({})),
            "GET /zones/zone1/dns_records?name=app.example.com" => ok(json!([
                { "id": "r9", "type": "A", "content": "203.0.113.7" }
            ])),
            r if r.starts_with("GET /zones/zone1/dns_records?") => ok(json!([])),
            "POST /zones/zone1/dns_records" => ok(json!({ "id": "new" })),
            _ => (
                404,
                json!({ "success": false, "errors": [{ "code": 7003, "message": "No route" }] }),
            ),
        }
    }

    #[test]
    fn names_every_piece_one_level_under_the_domain() {
        assert_eq!(
            hosts("takewon", "example.com"),
            [
                "takewon.example.com",
                "takewon-api.example.com",
                "takewon-actions.example.com",
                "takewon-agent.example.com",
                "takewon-toolkit.example.com",
            ]
        );
        let addresses = addresses("takewon", "example.com");
        assert_eq!(addresses.dashboard, "https://takewon.example.com");
        assert_eq!(addresses.site, "https://takewon-actions.example.com");
        assert_eq!(addresses.toolkit, "https://takewon-toolkit.example.com");
    }

    #[test]
    fn routes_each_name_to_its_piece_inside_docker() {
        let rules = ingress("studio", "example.com");
        let rules = rules["config"]["ingress"].as_array().unwrap();
        assert_eq!(rules.len(), 6);
        assert_eq!(
            rules[0],
            json!({ "hostname": "studio.example.com", "service": "http://web:3000" })
        );
        assert_eq!(rules[2]["service"], "http://convex:3211");
        assert_eq!(rules[4]["service"], "http://toolkit:8080");
        assert_eq!(rules[5], json!({ "service": "http_status:404" }));
    }

    #[test]
    fn takes_a_plain_name_only() {
        assert_eq!(check_name(" Takewon ").unwrap(), "takewon");
        assert_eq!(check_name("my-studio2").unwrap(), "my-studio2");
        for bad in ["", "-x", "x-", "a.b", "a b", "ok/../x", &"x".repeat(41)] {
            assert!(check_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn keeps_what_it_made_without_secrets() {
        let folder = tempfile::tempdir().unwrap();
        assert_eq!(load(folder.path()), None);
        let saved = Saved {
            domain: domain(),
            name: "takewon".into(),
            tunnel: "t1".into(),
        };
        keep(folder.path(), &saved).unwrap();
        assert_eq!(load(folder.path()), Some(saved));
        let text = fs::read_to_string(saved_path(folder.path())).unwrap();
        assert!(!text.contains("token"));
    }

    #[tokio::test]
    async fn lists_the_domains_a_token_can_change() {
        let (base, _) = fake(empty_account).await;
        let cloudflare = Cloudflare::new(&base, "cf-token").unwrap();
        assert_eq!(cloudflare.domains().await.unwrap(), vec![domain()]);
    }

    #[tokio::test]
    async fn says_what_a_token_needs_when_cloudflare_refuses_it() {
        let (base, _) = fake(empty_account).await;
        let problem = Cloudflare::new(&base, "wrong")
            .unwrap()
            .domains()
            .await
            .unwrap_err();
        assert!(problem.contains("didn't allow"), "{problem}");
        assert!(problem.contains("Cloudflare Tunnel: Edit"), "{problem}");
        assert!(Cloudflare::new(&base, "  ").is_err());
    }

    #[tokio::test]
    async fn makes_the_tunnel_routes_and_names() {
        let (base, log) = fake(empty_account).await;
        let cloudflare = Cloudflare::new(&base, "cf-token").unwrap();
        let (saved, token) = make(&cloudflare, &domain(), "takewon", None).await.unwrap();
        assert_eq!(token, "run-token");
        assert_eq!(saved.tunnel, "t1");
        assert_eq!(saved.name, "takewon");
        let log = log.lock().unwrap().clone();
        assert!(log.iter().any(|line| line
            .starts_with("POST /accounts/acct1/cfd_tunnel {\"config_src\":\"cloudflare\",\"name\":\"takewon-example.com\"}")));
        assert!(log.iter().any(|line| line
            .starts_with("PUT /accounts/acct1/cfd_tunnel/t1/configurations")
            && line.contains("takewon-agent.example.com")));
        let made: Vec<&String> = log
            .iter()
            .filter(|line| line.starts_with("POST /zones/zone1/dns_records"))
            .collect();
        assert_eq!(made.len(), 5);
        assert!(made
            .iter()
            .all(|line| line.contains("\"content\":\"t1.cfargotunnel.com\"")
                && line.contains("\"proxied\":true")));
    }

    #[tokio::test]
    async fn never_replaces_a_name_the_person_already_uses() {
        let (base, log) = fake(empty_account).await;
        let cloudflare = Cloudflare::new(&base, "cf-token").unwrap();
        let problem = make(&cloudflare, &domain(), "app", None).await.unwrap_err();
        assert!(
            problem.contains("app.example.com already points somewhere else"),
            "{problem}"
        );
        assert!(!log
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.starts_with("PATCH")));
    }

    /// The tunnel made last time is still there and its names point at an older tunnel.
    fn made_before(request: &str, _body: &Value) -> (u16, Value) {
        match request {
            "GET /accounts/acct1/cfd_tunnel/t1" => ok(json!({ "id": "t1", "deleted_at": null })),
            "GET /accounts/acct1/cfd_tunnel/t1/token" => ok(json!("run-token")),
            "PUT /accounts/acct1/cfd_tunnel/t1/configurations" => ok(json!({})),
            "GET /zones/zone1/dns_records?name=takewon.example.com" => ok(json!([
                { "id": "r1", "type": "CNAME", "content": "t1.cfargotunnel.com" }
            ])),
            r if r.starts_with("GET /zones/zone1/dns_records?") => ok(json!([
                { "id": "r2", "type": "CNAME", "content": "old.cfargotunnel.com" }
            ])),
            "PATCH /zones/zone1/dns_records/r2" => ok(json!({})),
            _ => (
                404,
                json!({ "success": false, "errors": [{ "code": 7003, "message": "No route" }] }),
            ),
        }
    }

    #[tokio::test]
    async fn uses_the_same_tunnel_again_and_fixes_names_that_moved() {
        let (base, log) = fake(made_before).await;
        let cloudflare = Cloudflare::new(&base, "cf-token").unwrap();
        let before = Saved {
            domain: domain(),
            name: "takewon".into(),
            tunnel: "t1".into(),
        };
        let (saved, _) = make(&cloudflare, &domain(), "takewon", Some(&before))
            .await
            .unwrap();
        assert_eq!(saved, before);
        let log = log.lock().unwrap().clone();
        assert!(!log.iter().any(|line| line.starts_with("POST")));
        assert_eq!(
            log.iter().filter(|line| line.starts_with("PATCH")).count(),
            4
        );
    }
}
