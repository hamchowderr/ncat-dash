//! Settings for the system web view on Windows (WebView2).

/// What wry passes to WebView2 by default: no mini menu and no SmartScreen.
pub const DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// The web view's command-line switches. The app passes its own switches, and WebView2 then
/// ignores `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, so switches set there (the Edge driver
/// sets one to attach the click-through tests) are added here instead.
pub fn args(from_environment: Option<&str>) -> String {
    match from_environment.map(str::trim) {
        Some(extra) if !extra.is_empty() => format!("{DEFAULT_ARGS} {extra}"),
        _ => DEFAULT_ARGS.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_defaults_alone_without_extra_switches() {
        assert_eq!(args(None), DEFAULT_ARGS);
        assert_eq!(args(Some("  ")), DEFAULT_ARGS);
    }

    #[test]
    fn adds_switches_from_the_environment() {
        assert_eq!(
            args(Some("--remote-debugging-port=0")),
            format!("{DEFAULT_ARGS} --remote-debugging-port=0")
        );
    }
}
