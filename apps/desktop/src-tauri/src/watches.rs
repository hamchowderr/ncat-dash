//! A folder on this computer as an automation's trigger. While the app is open, files
//! added to the folder (and its subfolders, such as one per creator) are sent to the
//! automation's folder in the team's storage, where its folder trigger starts runs as
//! usual. The automations still run on the server; the app only brings the files in.
//!
//! The dashboard asks every so often what is new; the app answers with files that have
//! not changed for a while (so a recording still being written is not sent half done),
//! and writes down each file once it is sent, so a restart never sends it twice. Files
//! already in the folder when it is picked are left alone.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// A file counts as finished once it hasn't changed for this long.
pub const SETTLED: Duration = Duration::from_secs(10);
/// How deep subfolders are looked into: enough for creator/hooks/take.mp4 and a little more.
const DEPTH: usize = 4;
/// At most this many files are looked at in one folder, so a huge folder can't stall the app.
const MOST_FILES: usize = 5000;

/// A local folder that feeds an automation's folder in the team's storage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Watch {
    pub automation_id: String,
    pub automation_name: String,
    pub organization_id: String,
    /// The automation's folder in the team's storage, such as "incoming/".
    pub prefix: String,
    /// The folder on this computer.
    pub folder: String,
    /// The dashboard that set it up; only that dashboard sees it.
    pub dashboard: String,
    /// Files (by path inside the folder, with their size) already there or already sent.
    #[serde(default)]
    pub known: Vec<String>,
}

/// A file that landed in a watched folder and is ready to send.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Landed {
    pub path: String,
    /// Where it is inside the watched folder, with "/" between folders, such as "Maya/hooks".
    /// Empty for a file at the top.
    pub folder: String,
    pub name: String,
    pub size: u64,
    pub content_type: String,
}

fn known_key(relative: &str, size: u64) -> String {
    format!("{relative}\u{0}{size}")
}

/// Hidden files, and files other apps are still writing, are never sent.
fn skipped(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.')
        || name.starts_with("~$")
        || [".part", ".crdownload", ".download", ".tmp", ".partial"]
            .iter()
            .any(|ending| lower.ends_with(ending))
        || lower == "desktop.ini"
        || lower == "thumbs.db"
}

/// Every file under `root`, with its path inside it, size and last change.
fn files_under(root: &Path) -> Vec<(PathBuf, String, u64, SystemTime)> {
    let mut found = Vec::new();
    let mut folders = vec![(root.to_path_buf(), String::new(), 0usize)];
    while let Some((folder, relative, depth)) = folders.pop() {
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            if found.len() >= MOST_FILES {
                return found;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if skipped(&name) {
                continue;
            }
            let inside = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            // Links are not followed, so a watched folder can't lead elsewhere on disk.
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                if depth + 1 < DEPTH {
                    folders.push((entry.path(), inside, depth + 1));
                }
            } else if kind.is_file() {
                if let Ok(meta) = entry.metadata() {
                    let changed = meta.modified().unwrap_or(UNIX_EPOCH);
                    found.push((entry.path(), inside, meta.len(), changed));
                }
            }
        }
    }
    found
}

/// What is in the folder now, written down as known, so only files added later are sent.
pub fn known_now(folder: &Path) -> Vec<String> {
    files_under(folder)
        .into_iter()
        .map(|(_, relative, size, _)| known_key(&relative, size))
        .collect()
}

/// Files added since the folder was picked, that haven't changed for `SETTLED`, and
/// haven't been sent.
pub fn landed(watch: &Watch, now: SystemTime) -> Vec<Landed> {
    let known: HashSet<&str> = watch.known.iter().map(String::as_str).collect();
    let mut landed: Vec<Landed> = files_under(Path::new(&watch.folder))
        .into_iter()
        .filter(|(_, relative, size, _)| !known.contains(known_key(relative, *size).as_str()))
        .filter(|(_, _, _, changed)| {
            now.duration_since(*changed)
                .map(|age| age >= SETTLED)
                .unwrap_or(false)
        })
        .map(|(path, relative, size, _)| {
            let (folder, name) = match relative.rsplit_once('/') {
                Some((folder, name)) => (folder.to_string(), name.to_string()),
                None => (String::new(), relative.clone()),
            };
            Landed {
                path: path.display().to_string(),
                content_type: crate::uploads::content_type(&name).to_string(),
                folder,
                name,
                size,
            }
        })
        .collect();
    landed.sort_by(|a, b| a.path.cmp(&b.path));
    landed
}

/// The watched folders, in watches.json in the app's settings folder.
pub struct Store {
    path: PathBuf,
    lock: Mutex<()>,
}

impl Store {
    pub fn new(folder: &Path) -> Self {
        Self {
            path: folder.join("watches.json"),
            lock: Mutex::new(()),
        }
    }

    fn read(&self) -> Vec<Watch> {
        fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn change<T>(&self, edit: impl FnOnce(&mut Vec<Watch>) -> T) -> Result<T, String> {
        let _held = self.lock.lock().unwrap();
        let mut watches = self.read();
        let answer = edit(&mut watches);
        if let Some(folder) = self.path.parent() {
            fs::create_dir_all(folder).map_err(|error| error.to_string())?;
        }
        let bytes = serde_json::to_vec_pretty(&watches).map_err(|error| error.to_string())?;
        let part = self.path.with_extension("json.part");
        fs::write(&part, bytes).map_err(|error| error.to_string())?;
        fs::rename(&part, &self.path).map_err(|error| error.to_string())?;
        Ok(answer)
    }

    /// A damaged or missing file reads as no watched folders.
    pub fn list(&self, dashboard: &str) -> Vec<Watch> {
        let _held = self.lock.lock().unwrap();
        self.read()
            .into_iter()
            .filter(|watch| watch.dashboard == dashboard)
            .collect()
    }

    pub fn get(&self, dashboard: &str, automation_id: &str) -> Option<Watch> {
        self.list(dashboard)
            .into_iter()
            .find(|watch| watch.automation_id == automation_id)
    }

    /// Sets an automation's folder. Picking the same folder again keeps what was sent;
    /// a new folder starts from what is in it now.
    pub fn set(&self, mut watch: Watch) -> Result<Watch, String> {
        self.change(|watches| {
            let same = |each: &Watch| {
                each.dashboard == watch.dashboard && each.automation_id == watch.automation_id
            };
            match watches.iter().position(same) {
                Some(at) if watches[at].folder == watch.folder => {
                    watch.known = std::mem::take(&mut watches[at].known);
                    watches[at] = watch.clone();
                }
                Some(at) => {
                    watch.known = known_now(Path::new(&watch.folder));
                    watches[at] = watch.clone();
                }
                None => {
                    watch.known = known_now(Path::new(&watch.folder));
                    watches.push(watch.clone());
                }
            }
            watch
        })
    }

    pub fn remove(&self, dashboard: &str, automation_id: &str) -> Result<(), String> {
        self.change(|watches| {
            watches.retain(|watch| {
                !(watch.dashboard == dashboard && watch.automation_id == automation_id)
            })
        })
    }

    /// Writes down a file as sent, so it is never sent again.
    pub fn sent(&self, dashboard: &str, automation_id: &str, path: &Path) -> Result<(), String> {
        self.change(|watches| {
            let Some(watch) = watches
                .iter_mut()
                .find(|watch| watch.dashboard == dashboard && watch.automation_id == automation_id)
            else {
                return;
            };
            let Ok(relative) = path.strip_prefix(&watch.folder) else {
                return;
            };
            let relative = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            let size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
            let key = known_key(&relative, size);
            if !watch.known.contains(&key) {
                watch.known.push(key);
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch(folder: &Path) -> Watch {
        Watch {
            automation_id: "a1".into(),
            automation_name: "Weekly clips".into(),
            organization_id: "team".into(),
            prefix: "incoming/".into(),
            folder: folder.display().to_string(),
            dashboard: "https://app.example/".into(),
            known: vec![],
        }
    }

    fn later() -> SystemTime {
        SystemTime::now() + Duration::from_secs(60)
    }

    #[test]
    fn sends_only_files_added_after_the_folder_was_picked() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("Recordings");
        fs::create_dir_all(folder.join("Maya/hooks")).unwrap();
        fs::write(folder.join("old.mp4"), b"old").unwrap();
        let store = Store::new(&root.path().join("settings"));
        store.set(watch(&folder)).unwrap();

        fs::write(folder.join("talk.mp4"), b"new").unwrap();
        fs::write(folder.join("Maya/hooks/take 1.mov"), b"hook").unwrap();
        fs::write(folder.join(".DS_Store"), b"x").unwrap();
        fs::write(folder.join("export.mp4.part"), b"x").unwrap();

        let saved = store.get("https://app.example/", "a1").unwrap();
        let landed = landed(&saved, later());
        let found: Vec<(&str, &str)> = landed
            .iter()
            .map(|file| (file.folder.as_str(), file.name.as_str()))
            .collect();
        assert_eq!(found, vec![("Maya/hooks", "take 1.mov"), ("", "talk.mp4")]);
        assert_eq!(landed[0].content_type, "video/quicktime");

        // Not yet: it changed a moment ago and may still be being written.
        assert!(super::landed(&saved, SystemTime::now()).is_empty());

        // Sent once, never again, even after a restart.
        store
            .sent("https://app.example/", "a1", &folder.join("talk.mp4"))
            .unwrap();
        let again = Store::new(&root.path().join("settings"));
        let saved = again.get("https://app.example/", "a1").unwrap();
        assert_eq!(super::landed(&saved, later()).len(), 1);

        // Picking the same folder again (a new storage folder, say) keeps what was sent.
        let mut moved = watch(&folder);
        moved.prefix = "clips/".into();
        again.set(moved).unwrap();
        let saved = again.get("https://app.example/", "a1").unwrap();
        assert_eq!(saved.prefix, "clips/");
        assert_eq!(super::landed(&saved, later()).len(), 1);
    }

    #[test]
    fn a_file_replaced_by_a_new_one_of_another_size_is_sent() {
        let root = tempfile::tempdir().unwrap();
        let settings = tempfile::tempdir().unwrap();
        fs::write(root.path().join("talk.mp4"), b"first").unwrap();
        let store = Store::new(settings.path());
        store.set(watch(root.path())).unwrap();
        fs::write(root.path().join("talk.mp4"), b"second take").unwrap();
        let saved = store.get("https://app.example/", "a1").unwrap();
        assert_eq!(landed(&saved, later()).len(), 1);
    }

    #[test]
    fn each_dashboard_sees_only_its_own_folders() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path());
        store.set(watch(root.path())).unwrap();
        assert_eq!(store.list("https://app.example/").len(), 1);
        assert!(store.list("https://elsewhere.example/").is_empty());
        store.remove("https://app.example/", "a1").unwrap();
        assert!(store.list("https://app.example/").is_empty());
    }
}
