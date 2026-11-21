//! The desktop app. The window shows the person's own dashboard (hosted or
//! self-hosted) and the app adds what a browser tab can't: pick a dashboard and come
//! back to it, and alerts as system notifications with the unseen count on the tray.
//!
//! Security: the dashboard's pages are a remote site. capabilities/default.json covers
//! only the app's own pages; once someone connects, the dashboard's origin is given two
//! commands and nothing else (see `dashboard.rs`), and each checks the caller is the
//! dashboard open now.

/// The product's name, from apps/desktop/product.json (set in build.rs), so a rename
/// is one change.
pub const NAME: &str = env!("PRODUCT_NAME");

pub mod address;
pub mod dashboard;
pub mod links;
pub mod saved;

use std::sync::Mutex;

use tauri::ipc::CapabilityBuilder;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, State, Url, UserAttentionType, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";
const SWITCH: &str = "switch-server";
const RELOAD: &str = "reload";
const SHOW: &str = "show";
const TRAY: &str = "tray";

/// Where the app's own pages live (differs by platform), and the dashboard now open.
struct Places {
    home: Url,
    current: Mutex<Option<Url>>,
}

fn store(app: &AppHandle) -> Result<saved::Store, String> {
    let folder = app
        .path()
        .app_config_dir()
        .map_err(|_| format!("{NAME} couldn't find its settings folder."))?;
    Ok(saved::Store::new(&folder))
}

#[tauri::command]
fn saved_servers(app: AppHandle) -> Result<Vec<saved::Saved>, String> {
    Ok(store(&app)?.list())
}

#[tauri::command]
fn forget_server(app: AppHandle, address: String) -> Result<Vec<saved::Saved>, String> {
    store(&app)?.forget(&address)
}

/// Checks the address answers as the dashboard, remembers it and shows it in the window.
#[tauri::command]
async fn open_server(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    address: String,
) -> Result<(), String> {
    let url = address::normalize(&address)?;
    address::check(&url).await?;
    store(&app)?.opened(url.as_str(), &address::display(&url))?;
    *places.current.lock().unwrap() = Some(url.clone());
    allow_dashboard(&app, &url);
    window
        .navigate(url)
        .map_err(|_| format!("{NAME} couldn't open that page."))
}

/// Gives the dashboard's pages the two commands in `dashboard::COMMANDS`. Adding the same
/// dashboard again is refused by Tauri as a repeat, which is fine.
fn allow_dashboard(app: &AppHandle, dashboard_url: &Url) {
    let mut capability = CapabilityBuilder::new(dashboard::capability_id(dashboard_url))
        .remote(dashboard::remote_pattern(dashboard_url))
        .local(false)
        .window(MAIN);
    for permission in dashboard::COMMANDS {
        capability = capability.permission(permission);
    }
    let _ = app.add_capability(capability);
}

/// Refuses anything but the dashboard open now, even if it once had the commands.
fn from_dashboard(window: &WebviewWindow, places: &Places) -> Result<(), String> {
    let caller = window.url().map_err(|_| "Unknown page.".to_string())?;
    let current = places.current.lock().unwrap().clone();
    if dashboard::is_current(&caller, current.as_ref()) {
        Ok(())
    } else {
        Err("Only the open dashboard can do that.".into())
    }
}

/// Shows an alert as a system notification, unless the window is in front (the page
/// shows it itself then). Returns whether it was shown.
#[tauri::command]
fn notify(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    title: String,
    body: String,
) -> Result<bool, String> {
    from_dashboard(&window, &places)?;
    if window.is_focused().unwrap_or(false) && window.is_visible().unwrap_or(false) {
        return Ok(false);
    }
    // Notifications switched off for the app, or no notification service (some Linux
    // desktops): the page's own notice and the unseen count still show.
    let shown = app
        .notification()
        .builder()
        .title(dashboard::clip(&title, 80))
        .body(dashboard::clip(&body, 240))
        .show()
        .is_ok();
    let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    Ok(shown)
}

/// Puts the number of unseen alerts on the tray and the Dock or taskbar.
#[tauri::command]
fn set_unseen(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    count: u32,
) -> Result<(), String> {
    from_dashboard(&window, &places)?;
    let _ = window.set_badge_count(dashboard::badge(count));
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_tooltip(Some(dashboard::tray_text(count)));
    }
    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The tray icon. Closing the window keeps the app here, so alerts keep coming.
fn tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let show = MenuItem::with_id(app, SHOW, format!("Open {NAME}"), true, None::<&str>)?;
    let switch = MenuItem::with_id(app, SWITCH, format!("Switch {NAME}…"), true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some(&format!("Quit {NAME}")))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &switch, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY)
        .tooltip(NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)
}

fn go_home(app: &AppHandle) {
    show_window(app);
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let places = app.state::<Places>();
    *places.current.lock().unwrap() = None;
    let mut home = places.home.clone();
    // Tells the page not to open the last address again by itself.
    home.set_fragment(Some("switch"));
    let _ = window.navigate(home);
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let switch = MenuItem::with_id(
        app,
        SWITCH,
        format!("Switch {NAME}…"),
        true,
        Some("CmdOrCtrl+Shift+K"),
    )?;
    let reload = MenuItem::with_id(app, RELOAD, "Reload", true, Some("CmdOrCtrl+R"))?;
    let app_menu = Submenu::with_items(
        app,
        NAME,
        true,
        &[
            &switch,
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&format!("Quit {NAME}")))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();
    let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title(NAME)
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 680.0)
        .center()
        // Only web pages and the app's own pages load in the window, never files or other schemes.
        .on_navigation(links::may_load)
        // Links that open a new tab: the dashboard's own pages stay in the window, the rest open
        // in the person's browser.
        .on_new_window(move |url, _features| {
            let current = handle
                .try_state::<Places>()
                .and_then(|places| places.current.lock().unwrap().clone());
            match links::new_window(&url, current.as_ref()) {
                links::NewWindow::Here => {
                    if let Some(window) = handle.get_webview_window(MAIN) {
                        let _ = window.navigate(url);
                    }
                    NewWindowResponse::Deny
                }
                links::NewWindow::Browser => {
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                }
                links::NewWindow::Allow => NewWindowResponse::Allow,
                links::NewWindow::Refuse => NewWindowResponse::Deny,
            }
        })
        .build()?;
    Ok(window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            saved_servers,
            forget_server,
            open_server,
            notify,
            set_unseen
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.set_menu(menu(&handle)?)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                SWITCH => go_home(app),
                SHOW => show_window(app),
                RELOAD => {
                    if let Some(window) = app.get_webview_window(MAIN) {
                        let _ = window.eval("location.reload()");
                    }
                }
                _ => {}
            });
            let window = main_window(&handle)?;
            // Closing the window hides it; the app stays in the tray and alerts keep coming.
            // Quit is in the menu and the tray.
            let hide = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hide.hide();
                }
            });
            tray(&handle)?;
            let mut home = window.url()?;
            home.set_fragment(None);
            app.manage(Places {
                home,
                current: Mutex::new(None),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the desktop app couldn't start")
        .run(|app, event| {
            // Clicking the app in the Dock (or opening it again) brings the window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_window(app);
            }
            let _ = (app, event);
        });
}
