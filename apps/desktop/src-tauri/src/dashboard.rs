//! What the dashboard's own pages may ask of the app once someone has connected to it:
//! show an alert as a system notification, keep the number of unseen alerts on the tray
//! and the Dock or taskbar, save a run for a video editor, send files chosen in the app's
//! file picker, and bring in files from a folder on this computer chosen in its folder
//! picker. Nothing else, and only for the dashboard that is open.

use tauri::Url;

use crate::NAME;

/// The commands the dashboard may call (see `capability_for`). Everything else the app
/// does stays with its own pages.
pub const COMMANDS: [&str; 17] = [
    "allow-notify",
    "allow-set-unseen",
    "allow-save-export",
    "allow-open-export",
    "allow-show-export",
    "allow-choose-files",
    "allow-send-file",
    "allow-begin-upload",
    "allow-send-part",
    "allow-stopped-uploads",
    "allow-forget-upload",
    "allow-choose-folder",
    "allow-watch-folder",
    "allow-watched-folders",
    "allow-unwatch-folder",
    "allow-landed-files",
    "allow-landed-sent",
];

/// The address pattern the dashboard's pages match: every page of that one origin.
pub fn remote_pattern(dashboard: &Url) -> String {
    format!("{}/*", dashboard.origin().ascii_serialization())
}

/// A capability name unique to the dashboard, so connecting to a second one adds its own.
pub fn capability_id(dashboard: &Url) -> String {
    let origin = dashboard.origin().ascii_serialization();
    let safe: String = origin
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    format!("dashboard-{safe}")
}

/// Whether a page (the caller) belongs to the dashboard that is open now.
pub fn is_current(caller: &Url, current: Option<&Url>) -> bool {
    current.is_some_and(|dashboard| dashboard.origin() == caller.origin())
}

/// The line the tray shows for the unseen alerts.
pub fn tray_text(unseen: u32) -> String {
    match unseen {
        0 => NAME.to_string(),
        1 => format!("{NAME}: 1 new alert"),
        n => format!("{NAME}: {n} new alerts"),
    }
}

/// The Dock or taskbar badge: hidden at zero.
pub fn badge(unseen: u32) -> Option<i64> {
    (unseen > 0).then_some(i64::from(unseen))
}

/// Keeps a notification readable: one line of title, a few of text.
pub fn clip(text: &str, limit: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let kept: String = text.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", kept.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn matches_every_page_of_the_one_dashboard() {
        assert_eq!(
            remote_pattern(&url("https://app.example.com/")),
            "https://app.example.com/*"
        );
        assert_eq!(
            remote_pattern(&url("http://192.168.1.20:3000/")),
            "http://192.168.1.20:3000/*"
        );
    }

    #[test]
    fn names_each_dashboard_apart() {
        assert_eq!(
            capability_id(&url("https://app.example.com/")),
            "dashboard-https---app-example-com"
        );
        assert_ne!(
            capability_id(&url("http://localhost:3000/")),
            capability_id(&url("http://localhost:3001/"))
        );
    }

    #[test]
    fn listens_only_to_the_open_dashboard() {
        let open = url("https://app.example.com/");
        assert!(is_current(
            &url("https://app.example.com/inbox"),
            Some(&open)
        ));
        assert!(!is_current(&url("https://other.example.com/"), Some(&open)));
        assert!(!is_current(&url("http://app.example.com/"), Some(&open)));
        assert!(!is_current(&url("https://app.example.com/"), None));
    }

    #[test]
    fn says_how_many_alerts_are_new() {
        assert_eq!(tray_text(0), NAME);
        assert_eq!(tray_text(1), format!("{NAME}: 1 new alert"));
        assert_eq!(tray_text(4), format!("{NAME}: 4 new alerts"));
        assert_eq!(badge(0), None);
        assert_eq!(badge(4), Some(4));
    }

    #[test]
    fn keeps_notifications_short() {
        assert_eq!(clip("  Weekly clips failed  ", 40), "Weekly clips failed");
        assert_eq!(clip("abcdefghij", 5), "abcd…");
    }
}
