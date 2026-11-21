//! The desktop app. The window shows the person's own dashboard (hosted or
//! self-hosted) and the app adds what a browser tab can't. This first part: pick a
//! dashboard, remember it, and come back to it on the next start.
//!
//! Security: the dashboard's pages are a remote site, so they get no access to the app's
//! commands (see capabilities/default.json, which only covers the app's own pages).

/// The product's name, from apps/desktop/product.json (set in build.rs), so a rename
/// is one change.
pub const NAME: &str = env!("PRODUCT_NAME");

pub mod address;
pub mod links;
pub mod saved;

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";
const SWITCH: &str = "switch-server";
const RELOAD: &str = "reload";

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
    window
        .navigate(url)
        .map_err(|_| format!("{NAME} couldn't open that page."))
}

fn go_home(app: &AppHandle) {
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
        .invoke_handler(tauri::generate_handler![
            saved_servers,
            forget_server,
            open_server
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.set_menu(menu(&handle)?)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                SWITCH => go_home(app),
                RELOAD => {
                    if let Some(window) = app.get_webview_window(MAIN) {
                        let _ = window.eval("location.reload()");
                    }
                }
                _ => {}
            });
            let window = main_window(&handle)?;
            let mut home = window.url()?;
            home.set_fragment(None);
            app.manage(Places {
                home,
                current: Mutex::new(None),
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the desktop app couldn't start");
}
