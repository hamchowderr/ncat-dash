//! Checks this computer can run the whole stack (deploy/compose.yml): enough processor,
//! memory and disk, and Docker with Compose, running. The numbers are the minimums in
//! docs/self-hosting.md, The Machine. `judge` turns what was found into the list the Run
//! screen shows; finding it is kept apart so `judge` can be tested on any machine.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::NAME;

const GB: u64 = 1_000_000_000;
/// Memory is counted in 1024s, the way it is sold and the way the system shows it.
const GIB: u64 = 1 << 30;
/// Memory as the system reports it is a little under the label (8 GB shows as ~7.8).
const MEMORY_SLACK: u64 = 400 * (1 << 20);
pub const LEAST_CORES: usize = 4;
pub const LEAST_MEMORY: u64 = 8 * GIB;
pub const LEAST_DISK: u64 = 60 * GB;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Docker {
    /// No `docker` command anywhere we looked.
    Missing,
    /// The command is there but Docker isn't running (Docker Desktop closed).
    Stopped,
    /// Docker runs, but without the Compose plugin.
    NoCompose { version: String },
    Ready {
        version: String,
        compose: String,
        /// The memory Docker may use (Docker Desktop and WSL cap it below the machine's).
        memory: Option<u64>,
    },
}

#[derive(Debug, Clone)]
pub struct Facts {
    pub cores: usize,
    pub memory: u64,
    pub free_disk: u64,
    pub docker: Docker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Ok,
    /// Works, but slowly or needs a setting changed.
    Warn,
    /// Can't run until this is fixed.
    Fail,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: &'static str,
    pub status: Status,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub items: Vec<Item>,
    /// Nothing failed, so the stack can start.
    pub ready: bool,
}

fn gb(bytes: u64) -> String {
    let value = bytes as f64 / GB as f64;
    if value >= 10.0 {
        format!("{value:.0} GB")
    } else {
        format!("{value:.1} GB")
    }
}

/// Memory by the size on its label: a 16 GB machine reports about 15.4, and says 16.
fn memory_gb(bytes: u64) -> String {
    format!("{:.0} GB", (bytes as f64 / GIB as f64).ceil())
}

/// Where Docker's memory is set on each system.
fn docker_memory_setting(os: &str) -> &'static str {
    match os {
        "windows" => "Docker's memory comes from WSL: set memory=8GB or more under [wsl2] in .wslconfig in your user folder, then restart Docker Desktop.",
        "linux" => "Docker on Linux uses the machine's memory, so give the machine more.",
        _ => "Raise it in Docker Desktop, Settings, Resources, then press Apply.",
    }
}

fn docker_download(os: &str) -> &'static str {
    match os {
        "linux" => "Install Docker Engine with the Compose plugin (docs.docker.com/engine/install), then check again.",
        "windows" => "Install Docker Desktop (docker.com/products/docker-desktop) with WSL 2, its default, then check again.",
        _ => "Install Docker Desktop (docker.com/products/docker-desktop), open it once, then check again.",
    }
}

/// What the Run screen shows for these facts. `os` is std::env::consts::OS.
pub fn judge(facts: &Facts, os: &str) -> Check {
    let mut items = Vec::new();

    items.push(if facts.cores >= LEAST_CORES {
        Item {
            id: "cores",
            status: Status::Ok,
            title: format!("{} processor cores", facts.cores),
            detail: "Enough for video work. More cores mean more jobs at once.".into(),
        }
    } else {
        Item {
            id: "cores",
            status: Status::Warn,
            title: format!("{} processor cores", facts.cores),
            detail: format!(
                "{NAME} runs, but videos take a long time. {LEAST_CORES} or more are better."
            ),
        }
    });

    items.push(if facts.memory + MEMORY_SLACK >= LEAST_MEMORY {
        Item {
            id: "memory",
            status: Status::Ok,
            title: format!("{} of memory", memory_gb(facts.memory)),
            detail: "Enough to run every piece.".into(),
        }
    } else {
        Item {
            id: "memory",
            status: Status::Fail,
            title: format!("{} of memory", memory_gb(facts.memory)),
            detail: format!("{NAME} needs 8 GB or more."),
        }
    });

    items.push(if facts.free_disk >= LEAST_DISK {
        Item {
            id: "disk",
            status: Status::Ok,
            title: format!("{} free on the disk", gb(facts.free_disk)),
            detail: "Room for the programs, work files and the database.".into(),
        }
    } else {
        Item {
            id: "disk",
            status: Status::Fail,
            title: format!("{} free on the disk", gb(facts.free_disk)),
            detail: "60 GB free is needed: about 9 GB of programs, plus work files and the database. Finished videos go to your bucket.".into(),
        }
    });

    items.push(match &facts.docker {
        Docker::Missing => Item {
            id: "docker",
            status: Status::Fail,
            title: "Docker isn't installed".into(),
            detail: docker_download(os).into(),
        },
        Docker::Stopped => Item {
            id: "docker",
            status: Status::Fail,
            title: "Docker isn't running".into(),
            detail: if os == "linux" {
                "Start it (sudo systemctl start docker), then check again.".into()
            } else {
                "Open Docker Desktop and wait until it says it's running, then check again.".into()
            },
        },
        Docker::NoCompose { version } => Item {
            id: "docker",
            status: Status::Fail,
            title: format!("Docker {version}, without Compose"),
            detail: "Install the Docker Compose plugin (docs.docker.com/compose/install), then check again.".into(),
        },
        Docker::Ready {
            version, compose, ..
        } => Item {
            id: "docker",
            status: Status::Ok,
            title: format!("Docker {version} with Compose {compose}"),
            detail: "Running.".into(),
        },
    });

    if let Docker::Ready {
        memory: Some(memory),
        ..
    } = facts.docker
    {
        if memory + MEMORY_SLACK < LEAST_MEMORY {
            items.push(Item {
                id: "docker-memory",
                status: Status::Fail,
                title: format!("Docker may use {} of memory", memory_gb(memory)),
                detail: format!("It needs 8 GB or more. {}", docker_memory_setting(os)),
            });
        }
    }

    let ready = items.iter().all(|item| item.status != Status::Fail);
    Check { items, ready }
}

/// Apps opened from the Dock or Start menu don't get the terminal's PATH, so look where
/// Docker installs itself too.
fn docker_candidates(os: &str, home: Option<&Path>) -> Vec<PathBuf> {
    let mut found = vec![PathBuf::from(if os == "windows" {
        "docker.exe"
    } else {
        "docker"
    })];
    match os {
        "macos" => {
            found.push("/usr/local/bin/docker".into());
            found.push("/opt/homebrew/bin/docker".into());
            found.push("/Applications/Docker.app/Contents/Resources/bin/docker".into());
            if let Some(home) = home {
                found.push(home.join(".docker/bin/docker"));
            }
        }
        "windows" => {
            found.push(r"C:\Program Files\Docker\Docker\resources\bin\docker.exe".into());
        }
        _ => {
            found.push("/usr/bin/docker".into());
            found.push("/usr/local/bin/docker".into());
        }
    }
    found
}

/// How long a Docker command may take before it counts as not answering.
const WAIT: Duration = Duration::from_secs(20);

fn run(program: &Path, args: &[&str]) -> Option<Result<String, String>> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let until = Instant::now() + WAIT;
    // A Docker that hangs (starting up, stuck) must not hold the screen forever.
    while child.try_wait().ok()?.is_none() {
        if Instant::now() > until {
            let _ = child.kill();
            let _ = child.wait();
            return Some(Err("Docker didn't answer.".into()));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = child.wait_with_output().ok()?;
    let text = |bytes: &[u8]| String::from_utf8_lossy(bytes).trim().to_string();
    Some(if output.status.success() {
        Ok(text(&output.stdout))
    } else {
        Err(text(&output.stderr))
    })
}

/// The `docker` command to use, if any answers.
pub fn docker_command() -> Option<PathBuf> {
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    docker_candidates(std::env::consts::OS, home.as_deref())
        .into_iter()
        .find(|candidate| run(candidate, &["--version"]).is_some_and(|answer| answer.is_ok()))
}

fn find_docker() -> Docker {
    let Some(docker) = docker_command() else {
        return Docker::Missing;
    };
    let version = match run(&docker, &["version", "--format", "{{.Server.Version}}"]) {
        Some(Ok(version)) if !version.is_empty() => version,
        _ => return Docker::Stopped,
    };
    let compose = match run(&docker, &["compose", "version", "--short"]) {
        Some(Ok(compose)) if !compose.is_empty() => compose,
        _ => return Docker::NoCompose { version },
    };
    let memory = run(&docker, &["info", "--format", "{{.MemTotal}}"])
        .and_then(Result::ok)
        .and_then(|bytes| bytes.parse().ok());
    Docker::Ready {
        version,
        compose,
        memory,
    }
}

/// Looks at this computer. `folder` is where the stack's data would live.
pub fn facts(folder: &Path) -> Facts {
    use sysinfo::{Disks, System};
    let mut system = System::new();
    system.refresh_memory();
    let disks = Disks::new_with_refreshed_list();
    // The disk holding the folder: the longest mount point it sits under.
    let free_disk = disks
        .iter()
        .filter(|disk| folder.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .map(|disk| disk.available_space())
        .unwrap_or(0);
    Facts {
        cores: std::thread::available_parallelism().map_or(1, |n| n.get()),
        memory: system.total_memory(),
        free_disk,
        docker: find_docker(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good() -> Facts {
        Facts {
            cores: 8,
            memory: 16 * GIB,
            free_disk: 200 * GB,
            docker: Docker::Ready {
                version: "29.1.0".into(),
                compose: "2.40.0".into(),
                memory: Some(12 * GIB),
            },
        }
    }

    fn item<'a>(check: &'a Check, id: &str) -> &'a Item {
        check.items.iter().find(|item| item.id == id).unwrap()
    }

    #[test]
    fn a_comfortable_machine_is_ready() {
        let check = judge(&good(), "macos");
        assert!(check.ready);
        assert!(check.items.iter().all(|item| item.status == Status::Ok));
        assert_eq!(
            item(&check, "docker").title,
            "Docker 29.1.0 with Compose 2.40.0"
        );
        assert_eq!(item(&check, "memory").title, "16 GB of memory");
    }

    #[test]
    fn an_eight_gigabyte_machine_counts_as_eight() {
        let mut facts = good();
        facts.memory = 7_800 * (1 << 20);
        let check = judge(&facts, "macos");
        assert_eq!(item(&check, "memory").status, Status::Ok);
        assert_eq!(item(&check, "memory").title, "8 GB of memory");
        // A 16 GB Windows PC reports 15.4 usable; it once showed as "17 GB".
        facts.memory = 16_535_000_000;
        assert_eq!(item(&judge(&facts, "windows"), "memory").title, "16 GB of memory");
    }

    #[test]
    fn few_cores_only_warn_but_little_memory_or_disk_stop_it() {
        let mut facts = good();
        facts.cores = 2;
        let check = judge(&facts, "linux");
        assert_eq!(item(&check, "cores").status, Status::Warn);
        assert!(check.ready);

        facts.memory = 4 * GIB;
        facts.free_disk = 20 * GB;
        let check = judge(&facts, "linux");
        assert_eq!(item(&check, "memory").status, Status::Fail);
        assert_eq!(item(&check, "disk").status, Status::Fail);
        assert!(!check.ready);
    }

    #[test]
    fn says_how_to_get_docker_going_on_each_system() {
        let mut facts = good();
        facts.docker = Docker::Missing;
        let mac = judge(&facts, "macos");
        assert!(!mac.ready);
        assert!(item(&mac, "docker").detail.contains("Docker Desktop"));
        assert!(item(&judge(&facts, "linux"), "docker")
            .detail
            .contains("Docker Engine"));

        facts.docker = Docker::Stopped;
        assert!(item(&judge(&facts, "windows"), "docker")
            .detail
            .contains("Open Docker Desktop"));
        assert!(item(&judge(&facts, "linux"), "docker")
            .detail
            .contains("systemctl"));

        facts.docker = Docker::NoCompose {
            version: "24.0.0".into(),
        };
        let check = judge(&facts, "linux");
        assert_eq!(
            item(&check, "docker").title,
            "Docker 24.0.0, without Compose"
        );
        assert!(!check.ready);
    }

    #[test]
    fn docker_held_to_too_little_memory_says_where_to_raise_it() {
        let mut facts = good();
        facts.docker = Docker::Ready {
            version: "29.1.0".into(),
            compose: "2.40.0".into(),
            memory: Some(4 * GIB),
        };
        let windows = judge(&facts, "windows");
        assert!(!windows.ready);
        assert!(item(&windows, "docker-memory")
            .detail
            .contains(".wslconfig"));
        assert!(item(&judge(&facts, "macos"), "docker-memory")
            .detail
            .contains("Settings, Resources"));
    }

    #[test]
    fn looks_for_docker_where_it_installs_itself() {
        let mac = docker_candidates("macos", Some(Path::new("/Users/sam")));
        assert!(mac.contains(&PathBuf::from("/Users/sam/.docker/bin/docker")));
        assert!(mac.contains(&PathBuf::from("/opt/homebrew/bin/docker")));
        let windows = docker_candidates("windows", None);
        assert_eq!(windows[0], PathBuf::from("docker.exe"));
        assert!(windows[1]
            .to_string_lossy()
            .ends_with(r"resources\bin\docker.exe"));
    }

    #[test]
    fn this_machine_can_be_looked_at() {
        let found = facts(&std::env::temp_dir());
        assert!(found.cores >= 1);
        assert!(found.memory > 0);
    }
}
