//! Runs the whole stack on this computer: the same deploy/compose.yml a server uses
//! (built into the app), with its settings file written for the person. Everything lives
//! in one folder in the app's data: compose.yml, .env and nothing else; Docker keeps the
//! data in its volumes.
//!
//! The settings file is the record of this copy. Secrets are made once and kept on every
//! later save: a new CONVEX_INSTANCE_SECRET or MASTRA_JWT_SECRET would lock the dashboard
//! out of its own backend. Only what the person typed (bucket, model key, addresses) is
//! replaced.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::NAME;

/// deploy/compose.yml at the version this app was built from.
pub const COMPOSE: &str = include_str!("../../../../deploy/compose.yml");

/// Made by the app, never typed, never replaced once there.
pub const SECRETS: [&str; 4] = [
    "CONVEX_INSTANCE_SECRET",
    "TOOLKIT_API_KEY",
    "AGENT_APP_SECRET",
    "MASTRA_JWT_SECRET",
];

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub endpoint: String,
    pub access_key: String,
    pub secret_key: String,
    pub name: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub public_url: String,
}

/// The public address of each piece (see deploy/.env.example).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Addresses {
    pub dashboard: String,
    pub api: String,
    pub site: String,
    pub agent: String,
    pub toolkit: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub bucket: Bucket,
    /// The Anthropic key the agent uses.
    pub model_key: String,
    pub addresses: Addresses,
}

/// How much of the machine the toolkit may take, leaving the rest for everything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Share {
    pub cpus: usize,
    pub memory_gb: u64,
}

pub fn share(cores: usize, docker_memory: Option<u64>) -> Share {
    let cpus = cores.saturating_sub(2).max(2).min(cores.max(1));
    // Convex, the agent and the web app need about 1 GB together, Redis a little.
    let memory_gb = docker_memory
        .map(|bytes| bytes / 1_000_000_000)
        .map_or(8, |gb| gb.saturating_sub(3).clamp(3, 64));
    Share { cpus, memory_gb }
}

/// Reads a .env file: NAME=value lines, comments and blanks skipped.
pub fn parse(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (name, value) = line.split_once('=')?;
            Some((name.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

fn address(label: &str, value: &str) -> Result<String, String> {
    let url = url::Url::parse(value.trim()).map_err(|_| {
        format!("The {label} address isn't a full address, such as https://app.example.com.")
    })?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!("The {label} address must start with https://."));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn needed(label: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("Enter the {label}."));
    }
    // One line each, and nothing that would end the value early in the file.
    if value.contains(['\n', '\r', '#', '"', '\'', ' ']) {
        return Err(format!("The {label} has a character it can't hold."));
    }
    Ok(value.to_string())
}

/// The settings file for these settings, keeping every secret `existing` already has.
/// `make_secret` makes a new one (random in the app, fixed in tests).
pub fn render(
    settings: &Settings,
    share: Share,
    existing: &BTreeMap<String, String>,
    mut make_secret: impl FnMut() -> String,
) -> Result<String, String> {
    let bucket = &settings.bucket;
    let addresses = &settings.addresses;
    let mut values: Vec<(&str, String)> = vec![
        ("CONVEX_URL", address("Convex API", &addresses.api)?),
        (
            "CONVEX_SITE_URL",
            address("Convex HTTP actions", &addresses.site)?,
        ),
        ("SITE_URL", address("dashboard", &addresses.dashboard)?),
        ("AGENT_URL", address("agent", &addresses.agent)?),
        ("TOOLKIT_URL", address("toolkit", &addresses.toolkit)?),
        ("CONVEX_INSTANCE_NAME", "takewon".into()),
        (
            "S3_ENDPOINT_URL",
            address("bucket endpoint", &bucket.endpoint)?,
        ),
        (
            "S3_ACCESS_KEY",
            needed("bucket access key", &bucket.access_key)?,
        ),
        (
            "S3_SECRET_KEY",
            needed("bucket secret key", &bucket.secret_key)?,
        ),
        ("S3_BUCKET_NAME", needed("bucket name", &bucket.name)?),
        (
            "S3_REGION",
            if bucket.region.trim().is_empty() {
                "auto".into()
            } else {
                needed("bucket region", &bucket.region)?
            },
        ),
        (
            "S3_PUBLIC_URL",
            if bucket.public_url.trim().is_empty() {
                String::new()
            } else {
                address("bucket's public", &bucket.public_url)?
            },
        ),
        ("TOOLKIT_CPUS", share.cpus.to_string()),
        ("TOOLKIT_MEMORY", format!("{}g", share.memory_gb)),
        (
            "ANTHROPIC_API_KEY",
            needed("Anthropic key", &settings.model_key)?,
        ),
        ("SIGN_UPS", "invite-only".into()),
    ];
    for name in SECRETS {
        let kept = existing
            .get(name)
            .filter(|value| !value.is_empty())
            .cloned();
        values.push((name, kept.unwrap_or_else(&mut make_secret)));
    }
    // Made after the first start (generate_admin_key.sh); kept once there.
    values.push((
        "CONVEX_ADMIN_KEY",
        existing
            .get("CONVEX_ADMIN_KEY")
            .cloned()
            .unwrap_or_default(),
    ));

    let mut text = format!(
        "# Written by the {NAME} app for the stack on this computer (compose.yml beside it).\n\
         # Change settings in the app; secrets here are made once and must not change.\n"
    );
    for (name, value) in values {
        text.push_str(&format!("{name}={value}\n"));
    }
    Ok(text)
}

/// A new secret: 32 random bytes as hex, like `openssl rand -hex 32`.
pub fn secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("the system has no random source");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The stack's folder and the `docker` command that runs it.
pub struct Stack {
    pub folder: PathBuf,
    pub docker: PathBuf,
}

impl Stack {
    pub fn new(folder: &Path, docker: PathBuf) -> Self {
        Stack {
            folder: folder.to_path_buf(),
            docker,
        }
    }

    fn env_path(&self) -> PathBuf {
        self.folder.join(".env")
    }

    pub fn values(&self) -> BTreeMap<String, String> {
        fs::read_to_string(self.env_path())
            .map(|text| parse(&text))
            .unwrap_or_default()
    }

    /// Writes compose.yml and the settings file (readable only by this user).
    pub fn save(&self, settings: &Settings, share: Share) -> Result<(), String> {
        let text = render(settings, share, &self.values(), secret)?;
        self.write(&text)
    }

    fn write(&self, env: &str) -> Result<(), String> {
        let problem = |_| {
            format!(
                "{NAME} couldn't write its settings to {}.",
                self.folder.display()
            )
        };
        fs::create_dir_all(&self.folder).map_err(problem)?;
        fs::write(self.folder.join("compose.yml"), COMPOSE).map_err(problem)?;
        let path = self.env_path();
        let part = self.folder.join(".env.part");
        fs::write(&part, env).map_err(problem)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&part, fs::Permissions::from_mode(0o600)).map_err(problem)?;
        }
        fs::rename(&part, &path).map_err(problem)
    }

    /// Keeps the admin key Convex made for this copy.
    pub fn keep_admin_key(&self, key: &str) -> Result<(), String> {
        let key = key.trim();
        if !key.contains('|') {
            return Err("Convex didn't give back an admin key.".into());
        }
        let text = fs::read_to_string(self.env_path())
            .map_err(|_| "No settings saved yet.".to_string())?;
        let mut lines: Vec<String> = text
            .lines()
            .filter(|line| !line.starts_with("CONVEX_ADMIN_KEY="))
            .map(String::from)
            .collect();
        lines.push(format!("CONVEX_ADMIN_KEY={key}"));
        self.write(&(lines.join("\n") + "\n"))
    }

    /// `docker compose` for this stack, with these arguments after it.
    pub fn compose(&self, args: &[&str]) -> Command {
        let mut command = Command::new(&self.docker);
        command
            .current_dir(&self.folder)
            .args(["compose", "-f", "compose.yml", "--env-file", ".env"])
            .args(args);
        command
    }
}

/// The steps, in order, each a `docker compose` command. Pulling comes first and alone,
/// as it is the long one (about 9 GB the first time).
pub const PULL: &[&str] = &["pull", "--quiet"];
pub const START: &[&str] = &["up", "-d", "--wait"];
pub const ADMIN_KEY: &[&str] = &["exec", "-T", "convex", "./generate_admin_key.sh"];
pub const SETUP: &[&str] = &["run", "--rm", "setup"];
pub const STOP: &[&str] = &["stop"];

/// The admin key is the last line generate_admin_key.sh prints.
pub fn admin_key_from(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .rev()
        .find(|line| line.contains('|'))
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Settings {
        Settings {
            bucket: Bucket {
                endpoint: "https://acct.r2.cloudflarestorage.com".into(),
                access_key: "access".into(),
                secret_key: "secret".into(),
                name: "videos".into(),
                region: String::new(),
                public_url: String::new(),
            },
            model_key: "sk-ant-key".into(),
            addresses: Addresses {
                dashboard: "https://app.example.com/".into(),
                api: "https://api.example.com".into(),
                site: "https://site.example.com".into(),
                agent: "https://agent.example.com".into(),
                toolkit: "https://toolkit.example.com".into(),
            },
        }
    }

    fn counter() -> impl FnMut() -> String {
        let mut n = 0;
        move || {
            n += 1;
            format!("made{n}")
        }
    }

    const SHARE: Share = Share {
        cpus: 6,
        memory_gb: 9,
    };

    #[test]
    fn writes_everything_compose_needs() {
        let values = parse(&render(&settings(), SHARE, &BTreeMap::new(), counter()).unwrap());
        // Every value compose.yml insists on (${NAME:?...}) is there and not empty.
        for required in COMPOSE.split("${").skip(1) {
            if let Some((name, rest)) = required.split_once(":?") {
                if !rest.starts_with('}')
                    && name.chars().all(|c| c.is_ascii_uppercase() || c == '_')
                {
                    assert!(
                        values.get(name).is_some_and(|value| !value.is_empty()),
                        "{name} is required by compose.yml"
                    );
                }
            }
        }
        assert_eq!(values["SITE_URL"], "https://app.example.com");
        assert_eq!(values["S3_REGION"], "auto");
        assert_eq!(values["TOOLKIT_CPUS"], "6");
        assert_eq!(values["TOOLKIT_MEMORY"], "9g");
        assert_eq!(values["SIGN_UPS"], "invite-only");
        assert_eq!(values["CONVEX_ADMIN_KEY"], "");
    }

    #[test]
    fn keeps_every_secret_once_made() {
        let first = parse(&render(&settings(), SHARE, &BTreeMap::new(), counter()).unwrap());
        let made: Vec<_> = SECRETS.iter().map(|name| first[*name].clone()).collect();
        assert_eq!(made, ["made1", "made2", "made3", "made4"]);

        let mut existing = first.clone();
        existing.insert("CONVEX_ADMIN_KEY".into(), "takewon|abc".into());
        let mut changed = settings();
        changed.bucket.name = "other".into();
        let again = parse(&render(&changed, SHARE, &existing, || "new".into()).unwrap());
        for name in SECRETS {
            assert_eq!(again[name], first[name], "{name} changed");
        }
        assert_eq!(again["CONVEX_ADMIN_KEY"], "takewon|abc");
        assert_eq!(again["S3_BUCKET_NAME"], "other");
    }

    #[test]
    fn refuses_what_would_break_the_file_or_the_stack() {
        let mut bad = settings();
        bad.bucket.secret_key = "has space".into();
        assert!(render(&bad, SHARE, &BTreeMap::new(), secret)
            .unwrap_err()
            .contains("bucket secret key"));
        let mut bad = settings();
        bad.addresses.api = "api.example.com".into();
        assert!(render(&bad, SHARE, &BTreeMap::new(), secret)
            .unwrap_err()
            .contains("Convex API"));
        let mut bad = settings();
        bad.model_key = " ".into();
        assert_eq!(
            render(&bad, SHARE, &BTreeMap::new(), secret).unwrap_err(),
            "Enter the Anthropic key."
        );
    }

    #[test]
    fn secrets_are_long_random_hex() {
        let (a, b) = (secret(), secret());
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn leaves_room_for_the_rest_of_the_machine() {
        assert_eq!(
            share(8, Some(12_000_000_000)),
            Share {
                cpus: 6,
                memory_gb: 9
            }
        );
        assert_eq!(
            share(4, Some(8_000_000_000)),
            Share {
                cpus: 2,
                memory_gb: 5
            }
        );
        assert_eq!(
            share(2, Some(4_000_000_000)),
            Share {
                cpus: 2,
                memory_gb: 3
            }
        );
        assert_eq!(
            share(1, None),
            Share {
                cpus: 1,
                memory_gb: 8
            }
        );
    }

    #[test]
    fn saves_a_private_file_beside_compose_and_keeps_the_admin_key() {
        let dir = tempfile::tempdir().unwrap();
        let stack = Stack::new(&dir.path().join("stack"), "docker".into());
        stack.save(&settings(), SHARE).unwrap();
        assert_eq!(
            fs::read_to_string(stack.folder.join("compose.yml")).unwrap(),
            COMPOSE
        );
        let first = stack.values();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(stack.folder.join(".env"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        stack.keep_admin_key("takewon|0123\n").unwrap();
        stack.save(&settings(), SHARE).unwrap();
        let again = stack.values();
        assert_eq!(again["CONVEX_ADMIN_KEY"], "takewon|0123");
        assert_eq!(again["MASTRA_JWT_SECRET"], first["MASTRA_JWT_SECRET"]);
        assert!(stack.keep_admin_key("nothing").is_err());
    }

    #[test]
    fn runs_compose_in_its_folder_with_its_settings() {
        let stack = Stack::new(Path::new("/data/stack"), "/usr/bin/docker".into());
        let command = stack.compose(SETUP);
        assert_eq!(command.get_program(), "/usr/bin/docker");
        assert_eq!(command.get_current_dir(), Some(Path::new("/data/stack")));
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "compose",
                "-f",
                "compose.yml",
                "--env-file",
                ".env",
                "run",
                "--rm",
                "setup"
            ]
        );
    }

    #[test]
    fn reads_the_admin_key_from_what_convex_prints() {
        assert_eq!(
            admin_key_from("Admin key:\ntakewon|01abc\n").as_deref(),
            Some("takewon|01abc")
        );
        assert_eq!(admin_key_from("error\n"), None);
    }
}
