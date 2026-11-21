//! The dashboard addresses this computer has opened, most recent first, kept in a small JSON file in
//! the app's settings folder.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::NAME;

/// How many addresses are remembered. Most people have one; agencies may have a few.
pub const LIMIT: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    /// The origin, always ending in `/` (from [`crate::address::normalize`]).
    pub address: String,
    /// The address as people read it.
    pub label: String,
    /// Seconds since 1970 when it was last opened.
    pub last_opened: u64,
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(folder: &Path) -> Self {
        Self {
            path: folder.join("servers.json"),
        }
    }

    /// Everything remembered, most recent first. A missing or damaged file reads as empty,
    /// so a bad file never stops the app from opening.
    pub fn list(&self) -> Vec<Saved> {
        let mut saved: Vec<Saved> = fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        saved.sort_by_key(|entry| std::cmp::Reverse(entry.last_opened));
        saved
    }

    /// Remembers `address` as just opened, moving it to the top.
    pub fn opened(&self, address: &str, label: &str) -> Result<Vec<Saved>, String> {
        self.opened_at(address, label, now())
    }

    fn opened_at(&self, address: &str, label: &str, at: u64) -> Result<Vec<Saved>, String> {
        let mut saved = self.list();
        saved.retain(|entry| entry.address != address);
        saved.insert(
            0,
            Saved {
                address: address.to_string(),
                label: label.to_string(),
                last_opened: at,
            },
        );
        saved.truncate(LIMIT);
        self.write(&saved)?;
        Ok(saved)
    }

    pub fn forget(&self, address: &str) -> Result<Vec<Saved>, String> {
        let mut saved = self.list();
        saved.retain(|entry| entry.address != address);
        self.write(&saved)?;
        Ok(saved)
    }

    fn write(&self, saved: &[Saved]) -> Result<(), String> {
        if let Some(folder) = self.path.parent() {
            fs::create_dir_all(folder)
                .map_err(|_| format!("{NAME} couldn't save its settings."))?;
        }
        let bytes = serde_json::to_vec_pretty(saved).expect("saved addresses always serialize");
        // Write beside the file, then swap, so a crash never leaves half a file.
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, bytes).map_err(|_| format!("{NAME} couldn't save its settings."))?;
        fs::rename(&temporary, &self.path)
            .map_err(|_| format!("{NAME} couldn't save its settings."))
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let folder = tempfile::tempdir().unwrap();
        let store = Store::new(folder.path());
        (folder, store)
    }

    #[test]
    fn starts_empty() {
        let (_folder, store) = store();
        assert!(store.list().is_empty());
    }

    #[test]
    fn puts_the_latest_first_without_repeats() {
        let (_folder, store) = store();
        store
            .opened_at("https://a.example.com/", "a.example.com", 1)
            .unwrap();
        store
            .opened_at("https://b.example.com/", "b.example.com", 2)
            .unwrap();
        store
            .opened_at("https://a.example.com/", "a.example.com", 3)
            .unwrap();
        let addresses: Vec<_> = store.list().into_iter().map(|s| s.address).collect();
        assert_eq!(
            addresses,
            ["https://a.example.com/", "https://b.example.com/"]
        );
    }

    #[test]
    fn remembers_at_most_ten() {
        let (_folder, store) = store();
        for n in 0..(LIMIT as u64 + 3) {
            store
                .opened_at(&format!("https://{n}.example.com/"), "x", n)
                .unwrap();
        }
        let saved = store.list();
        assert_eq!(saved.len(), LIMIT);
        assert_eq!(
            saved[0].address,
            format!("https://{}.example.com/", LIMIT + 2)
        );
    }

    #[test]
    fn forgets_one() {
        let (_folder, store) = store();
        store.opened_at("https://a.example.com/", "a", 1).unwrap();
        store.opened_at("https://b.example.com/", "b", 2).unwrap();
        let left = store.forget("https://b.example.com/").unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(store.list()[0].address, "https://a.example.com/");
    }

    #[test]
    fn reads_a_damaged_file_as_empty() {
        let (folder, store) = store();
        fs::write(folder.path().join("servers.json"), b"{not json").unwrap();
        assert!(store.list().is_empty());
        store.opened_at("https://a.example.com/", "a", 1).unwrap();
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn creates_the_settings_folder() {
        let folder = tempfile::tempdir().unwrap();
        let store = Store::new(&folder.path().join("not").join("yet"));
        store.opened_at("https://a.example.com/", "a", 1).unwrap();
        assert_eq!(store.list().len(), 1);
    }
}
