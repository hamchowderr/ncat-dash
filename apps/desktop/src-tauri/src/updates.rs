//! Keeps the app itself up to date. A few seconds after it opens, and every few hours after,
//! it asks the release feed (tauri.conf.json, plugins.updater) for a newer version, downloads
//! it in the background and checks its signature. Then it says so once, and the tray offers
//! to restart into it. Nothing is installed without the person choosing to restart.
//!
//! Updates are signed with the app's own update key (not Apple's or Microsoft's), so they
//! work while the builds themselves are unsigned.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How long after opening the first check waits, so it never slows the start.
pub const FIRST: Duration = Duration::from_secs(30);

/// How often it looks again while the app is open.
pub const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// A new version, downloaded and checked, waiting for a restart.
#[derive(Default)]
pub struct Ready(Mutex<Option<(Update, Vec<u8>)>>);

impl Ready {
    /// The waiting version's number, if one is waiting.
    pub fn version(&self) -> Option<String> {
        self.0
            .lock()
            .ok()?
            .as_ref()
            .map(|(update, _)| update.version.clone())
    }

    fn keep(&self, update: Update, bytes: Vec<u8>) {
        if let Ok(mut ready) = self.0.lock() {
            *ready = Some((update, bytes));
        }
    }

    fn take(&self) -> Option<(Update, Vec<u8>)> {
        self.0.lock().ok()?.take()
    }
}

/// The tray item that installs it.
pub fn restart_label(version: &str) -> String {
    format!("Restart to update to {version}")
}

/// What the one notification says.
pub fn ready_note(name: &str, version: &str) -> (String, String) {
    (
        format!("{name} {version} is ready"),
        format!("Restart {name} from its tray menu to update. Your work and settings stay."),
    )
}

/// Whether `found` should replace a version already waiting (a newer one may come out
/// before the person restarts).
pub fn is_newer(found: &str, waiting: Option<&str>) -> bool {
    waiting != Some(found)
}

/// Looks for a new version once. Gives back its number when one was downloaded just now.
pub async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|why| why.to_string())?;
    let Some(update) = updater.check().await.map_err(|why| why.to_string())? else {
        return Ok(None);
    };
    let ready = app.state::<Ready>();
    if !is_newer(&update.version, ready.version().as_deref()) {
        return Ok(None);
    }
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|why| why.to_string())?;
    let version = update.version.clone();
    ready.keep(update, bytes);
    Ok(Some(version))
}

/// Installs the waiting version and restarts into it. On Windows the installer closes the
/// app itself.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let (update, bytes) = app
        .state::<Ready>()
        .take()
        .ok_or_else(|| "No update is waiting.".to_string())?;
    update.install(bytes).map_err(|why| why.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offers_the_version_by_its_number() {
        assert_eq!(restart_label("0.1.42"), "Restart to update to 0.1.42");
        let (title, body) = ready_note("Takewon", "0.1.42");
        assert_eq!(title, "Takewon 0.1.42 is ready");
        assert!(body.contains("Restart Takewon from its tray menu"));
    }

    #[test]
    fn downloads_each_version_once() {
        assert!(is_newer("0.1.42", None));
        assert!(!is_newer("0.1.42", Some("0.1.42")));
        assert!(is_newer("0.1.43", Some("0.1.42")));
        assert_eq!(Ready::default().version(), None);
    }

    #[test]
    fn checks_soon_after_opening_then_a_few_times_a_day() {
        assert!(FIRST < Duration::from_secs(120));
        assert_eq!(EVERY, Duration::from_secs(6 * 60 * 60));
    }
}
