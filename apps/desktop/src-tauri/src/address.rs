//! Turning what someone types into the address of the person's dashboard, and checking
//! that the dashboard really answers there.

use std::net::IpAddr;
use std::time::Duration;

use url::{Host, Url};

use crate::NAME;

/// The path every dashboard web app answers on, so the desktop app can tell it
/// from any other site. Served by `src/app/api/desktop/route.ts` in the web app.
pub const CHECK_PATH: &str = "/api/desktop";

/// Reads an address the way people type it ("app.example.com", "https://app.example.com/home",
/// "192.168.1.20:3000") and gives back just the origin the dashboard lives at.
///
/// Plain `http` is only allowed on this computer and on a home or office network, where a
/// Mac Mini often has no certificate. Anywhere else the address must use HTTPS, because the
/// sign-in cookie would otherwise cross the internet unprotected.
pub fn normalize(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(format!("Enter the address of your {NAME}."));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else if looks_local(trimmed) {
        format!("http://{trimmed}")
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&with_scheme)
        .map_err(|_| "That doesn't look like a web address.".to_string())?;
    match url.scheme() {
        "https" => {}
        "http" if is_local_host(&url) => {}
        "http" => {
            return Err(
                "Use an https:// address. Plain http:// only works on this computer or your own network."
                    .into(),
            )
        }
        _ => return Err("Use an address that starts with https://.".into()),
    }
    if url.host().is_none() {
        return Err("That doesn't look like a web address.".into());
    }
    let mut origin = Url::parse(&url.origin().ascii_serialization())
        .map_err(|_| "That doesn't look like a web address.".to_string())?;
    origin.set_path("/");
    Ok(origin)
}

/// The address shown to people: no scheme for HTTPS, no trailing slash.
pub fn display(url: &Url) -> String {
    let text = url.as_str().trim_end_matches('/');
    text.strip_prefix("https://").unwrap_or(text).to_string()
}

fn looks_local(text: &str) -> bool {
    let host = text.split(['/', '?', '#']).next().unwrap_or(text);
    match Url::parse(&format!("http://{host}")) {
        Ok(url) => is_local_host(&url),
        Err(_) => false,
    }
}

/// This computer, a private network address, or a `.local` name (how Macs find each other).
pub fn is_local_host(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(name)) => {
            let name = name.to_ascii_lowercase();
            name == "localhost" || name.ends_with(".localhost") || name.ends_with(".local")
        }
        Some(Host::Ipv4(ip)) => {
            let ip = IpAddr::V4(ip);
            ip.is_loopback() || is_private(&ip)
        }
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
        IpAddr::V6(_) => false,
    }
}

/// What the dashboard may say it is on [`CHECK_PATH`]. Dashboards from before the rename to
/// Takewon say "ncat-dash", and so do current ones until every installed app accepts
/// "takewon"; this list takes both.
const ANSWERS: [&str; 2] = ["takewon", "ncat-dash"];

/// What the dashboard answers on [`CHECK_PATH`].
#[derive(Debug, serde::Deserialize)]
struct CheckReply {
    app: String,
}

/// Asks the address whether it is the dashboard. The error is written for the person, not for logs.
pub async fn check(url: &Url) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|_| format!("{NAME} couldn't start a connection on this computer."))?;
    let check_url = url
        .join(CHECK_PATH.trim_start_matches('/'))
        .map_err(|_| "That doesn't look like a web address.".to_string())?;
    let reply = client.get(check_url).send().await.map_err(|error| {
        if error.is_timeout() {
            format!(
                "{} took too long to answer. Check the address and that the server is on.",
                display(url)
            )
        } else {
            format!(
                "Couldn't reach {}. Check the address and your connection.",
                display(url)
            )
        }
    })?;
    let not_ours = || {
        format!(
            "{} answered, but it isn't {NAME}. Use the address you sign in to {NAME} at.",
            display(url)
        )
    };
    if !reply.status().is_success() {
        return Err(not_ours());
    }
    match reply.json::<CheckReply>().await {
        Ok(body) if ANSWERS.contains(&body.app.as_str()) => Ok(()),
        _ => Err(not_ours()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_https_to_a_bare_name() {
        assert_eq!(
            normalize("app.example.com").unwrap().as_str(),
            "https://app.example.com/"
        );
    }

    #[test]
    fn keeps_only_the_origin() {
        let url = normalize("  https://app.example.com/automations/abc?tab=runs#x ").unwrap();
        assert_eq!(url.as_str(), "https://app.example.com/");
    }

    #[test]
    fn keeps_a_port() {
        assert_eq!(
            normalize("https://app.example.com:8443/").unwrap().as_str(),
            "https://app.example.com:8443/"
        );
    }

    #[test]
    fn uses_http_for_this_computer_and_the_home_network() {
        assert_eq!(
            normalize("localhost:3000").unwrap().as_str(),
            "http://localhost:3000/"
        );
        assert_eq!(
            normalize("192.168.1.20:3000").unwrap().as_str(),
            "http://192.168.1.20:3000/"
        );
        assert_eq!(
            normalize("mac-mini.local:3000").unwrap().as_str(),
            "http://mac-mini.local:3000/"
        );
        assert_eq!(
            normalize("http://127.0.0.1:3000").unwrap().as_str(),
            "http://127.0.0.1:3000/"
        );
    }

    #[test]
    fn refuses_plain_http_across_the_internet() {
        let error = normalize("http://app.example.com").unwrap_err();
        assert!(error.contains("https://"), "{error}");
        assert!(normalize("http://8.8.8.8").is_err());
    }

    #[test]
    fn refuses_other_kinds_of_address() {
        assert!(normalize("").is_err());
        assert!(normalize("   ").is_err());
        assert!(normalize("file:///etc/passwd").is_err());
        assert!(normalize("javascript:alert(1)").is_err());
        assert!(normalize("ftp://app.example.com").is_err());
    }

    #[test]
    fn shows_addresses_the_way_people_type_them() {
        assert_eq!(
            display(&normalize("app.example.com").unwrap()),
            "app.example.com"
        );
        assert_eq!(
            display(&normalize("localhost:3000").unwrap()),
            "http://localhost:3000"
        );
    }

    /// A one-request web server on this computer that answers with `reply`.
    async fn serve_once(reply: &'static str) -> Url {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 1024];
            let _ = socket.read(&mut buffer).await;
            socket.write_all(reply.as_bytes()).await.unwrap();
        });
        normalize(&format!("127.0.0.1:{port}")).unwrap()
    }

    #[tokio::test]
    async fn accepts_our_reply() {
        let url = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 19\r\nconnection: close\r\n\r\n{\"app\":\"ncat-dash\"}",
        )
        .await;
        assert_eq!(check(&url).await, Ok(()));
    }

    #[tokio::test]
    async fn accepts_the_new_name() {
        let url = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 17\r\nconnection: close\r\n\r\n{\"app\":\"takewon\"}",
        )
        .await;
        assert_eq!(check(&url).await, Ok(()));
    }

    #[tokio::test]
    async fn turns_away_another_site() {
        let url = serve_once(
            "HTTP/1.1 404 Not Found\r\ncontent-length: 9\r\nconnection: close\r\n\r\nnot found",
        )
        .await;
        let error = check(&url).await.unwrap_err();
        assert!(error.contains(&format!("isn't {NAME}")), "{error}");
    }

    #[tokio::test]
    async fn turns_away_a_page_that_answers_with_something_else() {
        let url = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: 13\r\nconnection: close\r\n\r\n<html></html>",
        )
        .await;
        assert!(check(&url)
            .await
            .unwrap_err()
            .contains(&format!("isn't {NAME}")));
    }

    #[tokio::test]
    async fn says_when_nothing_answers() {
        // Bind and drop, so the port is very likely closed.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let url = normalize(&format!("127.0.0.1:{port}")).unwrap();
        assert!(check(&url).await.unwrap_err().starts_with("Couldn't reach"));
    }
}
