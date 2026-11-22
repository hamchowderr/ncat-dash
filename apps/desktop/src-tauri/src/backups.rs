//! Backs up a copy that runs on this computer: the database (Convex, with its stored files),
//! the agent server's memory, and the settings file with the secrets a restore needs. Each
//! backup is a folder named by its time in the person's Documents, and the newest few are
//! kept. The bucket (videos) is not in it: that is the storage provider's to keep.
//!
//! The work happens in the setup image, which already has the Convex command line and the
//! admin key, so the computer needs nothing but Docker.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::stack::Stack;
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

/// What runs inside the setup image: the database with its files, then the agent's memory.
/// On Linux, Docker writes as root, so the files are handed back to the person (OWNER).
pub const SCRIPT: &str = "set -e; \
    /app/node_modules/.bin/convex export --include-file-storage --path /backup/database.zip; \
    tar czf /backup/agent-memory.tgz -C /agent .; \
    [ -z \"$OWNER\" ] || chown -R \"$OWNER\" /backup";

/// `docker compose` arguments for a backup into `into` (an absolute folder on this computer).
/// `owner` is "uid:gid" where Docker's files would otherwise belong to root.
pub fn args(into: &Path, owner: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec!["run".into(), "--rm".into(), "-T".into()];
    if let Some(owner) = owner {
        args.extend(["-e".into(), format!("OWNER={owner}")]);
    }
    args.extend([
        "-v".into(),
        format!("{}:/backup", into.display()),
        "-v".into(),
        "takewon_agent-data:/agent:ro".into(),
        "--entrypoint".into(),
        "sh".into(),
        "setup".into(),
        "-c".into(),
        SCRIPT.into(),
    ]);
    args
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

/// Makes one backup now and gives back its folder.
pub fn make(stack: &Stack, root: &Path) -> Result<PathBuf, String> {
    let problem = |_| format!("{NAME} couldn't make a folder in {}.", root.display());
    let folder = root.join(stamp(SystemTime::now()));
    fs::create_dir_all(&folder).map_err(problem)?;
    let failed = |why: String| {
        let _ = fs::remove_dir_all(&folder);
        why
    };
    let output = stack
        .compose(
            &args(&folder, owner(&folder).as_deref())
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
        )
        .output()
        .map_err(|_| failed("Docker couldn't be started.".into()))?;
    if !output.status.success() {
        let said = String::from_utf8_lossy(&output.stderr);
        let last = said.lines().rfind(|l| !l.trim().is_empty()).unwrap_or("");
        return Err(failed(format!("The backup stopped with: {last}")));
    }
    // A restore needs the secrets too. The folder is the person's own, on their computer.
    let settings = folder.join("settings.env");
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
    prune(root, KEEP);
    Ok(folder)
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
