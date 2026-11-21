//! Which pages may load in the app's window, and where links that open a new tab go.

use tauri::Url;

/// The window loads web pages (the dashboard, and sign-in or payment pages it sends people to)
/// and the app's own pages. Files and other schemes never load in it.
pub fn may_load(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "tauri" | "about")
}

#[derive(Debug, PartialEq, Eq)]
pub enum NewWindow {
    /// One of the dashboard's pages: open it in the app's window.
    Here,
    /// Anything else on the web, or an email link: the person's own browser or mail app.
    Browser,
    /// A blank tab a page fills in itself.
    Allow,
    Refuse,
}

pub fn new_window(url: &Url, current: Option<&Url>) -> NewWindow {
    if url.as_str() == "about:blank" {
        return NewWindow::Allow;
    }
    match url.scheme() {
        "http" | "https" => {
            if current.is_some_and(|ours| ours.origin() == url.origin()) {
                NewWindow::Here
            } else {
                NewWindow::Browser
            }
        }
        "mailto" => NewWindow::Browser,
        _ => NewWindow::Refuse,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn loads_web_pages_and_its_own_pages_only() {
        assert!(may_load(&url("https://app.example.com/automations")));
        assert!(may_load(&url("http://localhost:3000/")));
        assert!(may_load(&url("tauri://localhost/index.html")));
        assert!(may_load(&url("http://tauri.localhost/index.html")));
        assert!(!may_load(&url("file:///etc/passwd")));
        assert!(!may_load(&url("javascript:alert(1)")));
        assert!(!may_load(&url("data:text/html,hi")));
    }

    #[test]
    fn keeps_its_own_pages_in_the_window() {
        let ours = url("https://app.example.com/");
        assert_eq!(
            new_window(&url("https://app.example.com/runs/1"), Some(&ours)),
            NewWindow::Here
        );
    }

    #[test]
    fn sends_other_sites_to_the_browser() {
        let ours = url("https://app.example.com/");
        assert_eq!(
            new_window(&url("https://docs.example.org/"), Some(&ours)),
            NewWindow::Browser
        );
        assert_eq!(
            new_window(&url("http://app.example.com/"), Some(&ours)),
            NewWindow::Browser
        );
        assert_eq!(
            new_window(&url("https://app.example.com/"), None),
            NewWindow::Browser
        );
        assert_eq!(
            new_window(&url("mailto:hi@example.com"), Some(&ours)),
            NewWindow::Browser
        );
    }

    #[test]
    fn lets_a_page_fill_in_a_blank_tab_and_refuses_the_rest() {
        assert_eq!(new_window(&url("about:blank"), None), NewWindow::Allow);
        assert_eq!(new_window(&url("file:///tmp/x"), None), NewWindow::Refuse);
    }
}
