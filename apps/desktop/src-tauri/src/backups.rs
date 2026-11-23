//! Backs up a copy that runs on this computer, and brings a backup back: the database
//! (Convex, with its stored files and its settings, which hold the secrets saved keys are
//! locked with), the agent server's memory, and the app's settings file. Each backup is a
//! folder named by its time in the person's Documents, and the newest few are kept. The
//! bucket (videos) is not in it: that is the storage provider's to keep.
//!
//! The work happens in the setup image, which already has the Convex command line and the
//! admin key, so the computer needs nothing but Docker.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::stack::{Stack, SETUP, START};
use crate::NAME;

/// How many backups are kept; older ones are removed after a new one is made.
pub const KEEP: usize = 14;

/// How often one is made by itself, while the app is open.
pub const EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// The folder a backup is made in, by its time (UTC): "2026-11-22 0518".
pub fn stamp(time: SystemTime) -> String {
    let secs = time.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let days = (secs / 86_400) as i64;
    let (hour, minute) = ((secs % 86_400) / 3600, (secs % 3600) / 60);
    // Days since 1970 to a calendar date (Howard Hinnant's civil_from_days).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02} {hour:02}{minute:02}")
}

/// Whether a folder in the backups folder is one of ours.
fn is_backup(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() == 15
        && bytes.iter().enumerate().all(|(i, b)| match i {
            4 | 7 => *b == b'-',
            10 => *b == b' ',
            _ => b.is_ascii_digit(),
        })
}

/// The backups there are, newest first.
pub fn list(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| is_backup(name))
        .collect();
    names.sort_unstable_by(|a, b| b.cmp(a));
    names
}

/// Removes all but the newest `keep` backups. Nothing else in the folder is touched.
pub fn prune(root: &Path, keep: usize) {
    for old in list(root).into_iter().skip(keep) {
        let _ = fs::remove_dir_all(root.join(old));
    }
}

/// Whether one is due: none yet, or the newest is older than `EVERY`.
pub fn due(root: &Path, now: SystemTime) -> bool {
    match list(root).first() {
        None => true,
        Some(newest) => newest.as_str() <= stamp(now - EVERY).as_str(),
    }
}

/// The files a backup holds. CONVEX_SETTINGS came later, so a backup without it still
/// comes back (with the secrets the database has now).
pub const DATABASE: &str = "database.zip";
pub const AGENT_MEMORY: &str = "agent-memory.tgz";
pub const CONVEX_SETTINGS: &str = "convex-settings.env";
pub const SETTINGS: &str = "settings.env";

/// The agent server's volume (compose.yml's project name and volume).
const AGENT_VOLUME: &str = "takewon_agent-data";

/// What runs inside the setup image: the database with its files and its settings, then the
/// agent's memory. On Linux, Docker writes as root, so the files are handed back to the
/// person (OWNER).
pub const SCRIPT: &str = "set -e; \
    convex() { /app/node_modules/.bin/convex \"$@\"; }; \
    convex export --include-file-storage --path /backup/database.zip; \
    convex env list --include-values > /backup/convex-settings.env; \
    chmod 600 /backup/convex-settings.env; \
    tar czf /backup/agent-memory.tgz -C /agent .; \
    [ -z \"$OWNER\" ] || chown -R \"$OWNER\" /backup";

/// What brings a backup back, with the agent server stopped: the database replaced whole
/// (tables and files), its settings put back, then the agent's memory.
pub const RESTORE: &str = "set -e; \
    convex() { /app/node_modules/.bin/convex \"$@\"; }; \
    convex import --replace-all -y /backup/database.zip; \
    [ ! -s /backup/convex-settings.env ] || convex env set --force < /backup/convex-settings.env; \
    find /agent -mindepth 1 -delete; \
    tar xzf /backup/agent-memory.tgz -C /agent";

/// `docker compose run` in the setup image with the backup folder at /backup, the agent's
/// volume at /agent and these other arguments.
fn run(folder: &Path, writing: bool, extra: &[String], script: &str) -> Vec<String> {
    let mut args: Vec<String> = vec!["run".into(), "--rm".into(), "-T".into()];
    args.extend_from_slice(extra);
    // A backup is written to and its agent memory only read; bringing one back the other way.
    let (backup, agent) = if writing { ("", ":ro") } else { (":ro", "") };
    args.extend([
        "-v".into(),
        format!("{}:/backup{backup}", folder.display()),
        "-v".into(),
        format!("{AGENT_VOLUME}:/agent{agent}"),
        "--entrypoint".into(),
        "sh".into(),
        "setup".into(),
        "-c".into(),
        script.into(),
    ]);
    args
}

/// `docker compose` arguments for a backup into `into` (an absolute folder on this computer).
/// `owner` is "uid:gid" where Docker's files would otherwise belong to root.
pub fn args(into: &Path, owner: Option<&str>) -> Vec<String> {
    let extra: Vec<String> = owner
        .map(|owner| vec!["-e".into(), format!("OWNER={owner}")])
        .unwrap_or_default();
    run(into, true, &extra, SCRIPT)
}

/// `docker compose` arguments that bring back the backup in `from`.
pub fn restore_args(from: &Path) -> Vec<String> {
    run(from, false, &[], RESTORE)
}

/// Who owns the backups folder, where Docker runs as root (Linux).
fn owner(folder: &Path) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        let meta = fs::metadata(folder).ok()?;
        Some(format!("{}:{}", meta.uid(), meta.gid()))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = folder;
        None
    }
}

/// One backup or restore at a time: the daily one waits its turn behind the person's.
static WORKING: Mutex<()> = Mutex::new(());

fn one_at_a_time() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    WORKING
        .try_lock()
        .or_else(|error| match error {
            std::sync::TryLockError::Poisoned(poisoned) => Ok(poisoned.into_inner()),
            std::sync::TryLockError::WouldBlock => Err(()),
        })
        .map_err(|()| "A backup is being made or brought back. Try again when it's done.".into())
}

/// The last line Docker said, for an error.
fn last_said(output: &std::process::Output) -> String {
    let said = String::from_utf8_lossy(&output.stderr);
    said.lines()
        .rfind(|l| !l.trim().is_empty())
        .unwrap_or("")
        .to_string()
}

/// Runs `docker compose` for the stack and says what went wrong, if anything.
fn compose(stack: &Stack, args: &[impl AsRef<str>], what: &str) -> Result<(), String> {
    let output = stack
        .compose(&args.iter().map(AsRef::as_ref).collect::<Vec<_>>())
        .output()
        .map_err(|_| "Docker couldn't be started.".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("{what} stopped with: {}", last_said(&output)))
    }
}

/// Makes one backup now and gives back its folder.
pub fn make(stack: &Stack, root: &Path) -> Result<PathBuf, String> {
    let _turn = one_at_a_time()?;
    let folder = make_one(stack, root)?;
    prune(root, KEEP);
    Ok(folder)
}

fn make_one(stack: &Stack, root: &Path) -> Result<PathBuf, String> {
    let problem = |_| format!("{NAME} couldn't make a folder in {}.", root.display());
    let folder = root.join(stamp(SystemTime::now()));
    fs::create_dir_all(&folder).map_err(problem)?;
    let failed = |why: String| {
        let _ = fs::remove_dir_all(&folder);
        why
    };
    compose(
        stack,
        &args(&folder, owner(&folder).as_deref()),
        "The backup",
    )
    .map_err(failed)?;
    // A restore needs the secrets too. The folder is the person's own, on their computer.
    let settings = folder.join(SETTINGS);
    fs::copy(stack.folder.join(".env"), &settings).map_err(|_| {
        failed(format!(
            "{NAME} couldn't copy its settings into the backup."
        ))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&settings, fs::Permissions::from_mode(0o600));
    }
    Ok(folder)
}

/// The backup called `name` in `root`, if it is one and has what a restore needs.
pub fn find(root: &Path, name: &str) -> Result<PathBuf, String> {
    let folder = root.join(name);
    if !is_backup(name) || !folder.is_dir() {
        return Err(format!("There is no backup called {name}."));
    }
    for file in [DATABASE, AGENT_MEMORY] {
        if !folder.join(file).is_file() {
            return Err(format!(
                "The backup {name} has no {file}, so it can't be brought back."
            ));
        }
    }
    Ok(folder)
}

/// Brings back the backup called `name`, after backing up what is there now (given back, so
/// the person can go back to it). The agent server is stopped while its memory is replaced,
/// then the stack is started and set up again, so the backend matches this version.
pub fn restore(stack: &Stack, root: &Path, name: &str) -> Result<PathBuf, String> {
    let _turn = one_at_a_time()?;
    let from = find(root, name)?;
    // Not pruned now: that could remove the very backup being brought back.
    let before = make_one(stack, root)
        .map_err(|why| format!("Nothing was changed. Backing up what's there now failed: {why}"))?;
    compose(stack, &["stop", "agent"], "Stopping the agent")?;
    let brought = compose(stack, &restore_args(&from), "Bringing it back");
    // Started again either way, so a failed restore doesn't leave the agent off.
    let started = compose(stack, START, "Starting it again")
        .and_then(|()| compose(stack, SETUP, "Setting it up again"));
    let undo = format!(
        " What was there before is backed up in {}.",
        before.display()
    );
    brought.map_err(|why| why + &undo)?;
    started.map_err(|why| why + &undo)?;
    Ok(before)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    #[test]
    fn names_each_backup_by_its_time() {
        assert_eq!(stamp(at(0)), "1970-01-01 0000");
        // 2026-11-22 05:18:30 UTC
        assert_eq!(stamp(at(1_795_324_710)), "2026-11-22 0518");
        // A leap day.
        assert_eq!(stamp(at(1_709_208_000)), "2024-02-29 1200");
        assert!(is_backup(&stamp(SystemTime::now())));
        assert!(!is_backup("2026-11-22 05:18"));
        assert!(!is_backup("notes"));
    }

    #[test]
    fn keeps_the_newest_and_never_touches_anything_else() {
        let root = tempfile::tempdir().unwrap();
        for day in 1..=5 {
            fs::create_dir(root.path().join(format!("2026-11-0{day} 0300"))).unwrap();
        }
        fs::create_dir(root.path().join("Keep me")).unwrap();
        fs::write(root.path().join("2026-11-09 0300"), "a file, not a backup").unwrap();
        prune(root.path(), 2);
        assert_eq!(list(root.path()), ["2026-11-05 0300", "2026-11-04 0300"]);
        assert!(root.path().join("Keep me").exists());
        assert!(root.path().join("2026-11-09 0300").exists());
    }

    #[test]
    fn is_due_once_a_day() {
        let root = tempfile::tempdir().unwrap();
        let now = at(1_795_324_710);
        assert!(due(root.path(), now));
        fs::create_dir(root.path().join(stamp(now - Duration::from_secs(3600)))).unwrap();
        assert!(!due(root.path(), now));
        assert!(due(root.path(), now + EVERY));
    }

    #[test]
    fn backs_up_the_database_with_its_files_and_the_agent_memory() {
        let args = args(
            Path::new("/home/me/Documents/Backups/2026-11-22 0518"),
            None,
        );
        assert_eq!(args[..3], ["run", "--rm", "-T"]);
        assert!(!args.iter().any(|arg| arg.starts_with("OWNER=")));
        assert!(args.contains(&"/home/me/Documents/Backups/2026-11-22 0518:/backup".to_string()));
        assert!(args.contains(&"takewon_agent-data:/agent:ro".to_string()));
        let script = args.last().unwrap();
        assert!(script.contains("convex export --include-file-storage --path /backup/database.zip"));
        assert!(script.contains("tar czf /backup/agent-memory.tgz -C /agent ."));
    }

    #[test]
    fn keeps_the_database_settings_where_only_the_person_can_read_them() {
        let script = args(Path::new("/b"), None).pop().unwrap();
        assert!(script.contains("convex env list --include-values > /backup/convex-settings.env"));
        assert!(script.contains("chmod 600 /backup/convex-settings.env"));
    }

    #[test]
    fn brings_a_backup_back_without_writing_to_it() {
        let args = restore_args(Path::new("/home/me/Documents/Backups/2026-11-22 0518"));
        assert_eq!(args[..3], ["run", "--rm", "-T"]);
        assert!(args.contains(&"/home/me/Documents/Backups/2026-11-22 0518:/backup:ro".to_string()));
        assert!(args.contains(&"takewon_agent-data:/agent".to_string()));
        let script = args.last().unwrap();
        assert!(script.contains("convex import --replace-all -y /backup/database.zip"));
        assert!(script.contains("convex env set --force < /backup/convex-settings.env"));
        // A backup made before its database settings were kept still comes back.
        assert!(script.contains("[ ! -s /backup/convex-settings.env ] ||"));
        // The memory there now goes before the backup's is unpacked.
        let (clear, unpack) = (
            script.find("find /agent -mindepth 1 -delete").unwrap(),
            script
                .find("tar xzf /backup/agent-memory.tgz -C /agent")
                .unwrap(),
        );
        assert!(clear < unpack);
    }

    #[test]
    fn only_brings_back_a_whole_backup_from_the_backups_folder() {
        let root = tempfile::tempdir().unwrap();
        let name = "2026-11-22 0518";
        assert!(find(root.path(), name)
            .unwrap_err()
            .contains("no backup called"));
        assert!(find(root.path(), "../elsewhere").is_err());
        fs::create_dir(root.path().join(name)).unwrap();
        fs::write(root.path().join(name).join(DATABASE), "zip").unwrap();
        assert!(find(root.path(), name).unwrap_err().contains(AGENT_MEMORY));
        fs::write(root.path().join(name).join(AGENT_MEMORY), "tgz").unwrap();
        assert_eq!(find(root.path(), name).unwrap(), root.path().join(name));
    }

    #[test]
    fn makes_or_brings_back_one_at_a_time() {
        let turn = one_at_a_time().unwrap();
        assert!(one_at_a_time().unwrap_err().contains("Try again"));
        drop(turn);
        assert!(one_at_a_time().is_ok());
    }

    #[test]
    fn hands_the_files_back_where_docker_writes_as_root() {
        let args = args(Path::new("/b"), Some("1000:1000"));
        assert_eq!(args[3..5], ["-e", "OWNER=1000:1000"]);
        assert!(args.last().unwrap().contains("chown -R \"$OWNER\" /backup"));
        #[cfg(target_os = "linux")]
        {
            let folder = tempfile::tempdir().unwrap();
            assert!(owner(folder.path()).unwrap().contains(':'));
        }
    }
}
