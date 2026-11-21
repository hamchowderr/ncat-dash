//! Kontifi on the desktop. The window shows the person's own Kontifi (hosted or
//! self-hosted) and the app adds what a browser tab can't. This first part: pick a
//! Kontifi, remember it, and come back to it on the next start.
//!
//! Security: the Kontifi pages are a remote site, so they get no access to the app's
//! commands (see capabilities/default.json, which only covers the app's own pages).

pub mod address;
pub mod links;
pub mod saved;

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";
const SWITCH: &str = "switch-kontifi";
const RELOAD: &str = "reload";

/// Where the app's own pages live (differs by platform), and the Kontifi now open.
struct Places {
    home: Url,
    current: Mutex<Option<Url>>,
}

fn store(app: &AppHandle) -> Result<saved::Store, String> {
    let folder = app
        .path()
        .app_config_dir()
        .map_err(|_| "Kontifi couldn't find its settings folder.".to_string())?;
    Ok(saved::Store::new(&folder))
}

#[tauri::command]
fn saved_kontifis(app: AppHandle) -> Result<Vec<saved::Saved>, String> {
    Ok(store(&app)?.list())
}

#[tauri::command]
fn forget_kontifi(app: AppHandle, address: String) -> Result<Vec<saved::Saved>, String> {
    store(&app)?.forget(&address)
}

/// Checks the address answers as a Kontifi, remembers it and shows it in the window.
#[tauri::command]
async fn open_kontifi(
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
        .map_err(|_| "Kontifi couldn't open that page.".to_string())
}

fn go_home(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let places = app.state::<Places>();
    *places.current.lock().unwrap() = None;
    let mut home = places.home.clone();
    // Tells the page not to open the last Kontifi again by itself.
    home.set_fragment(Some("switch"));
    let _ = window.navigate(home);
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let switch = MenuItem::with_id(
        app,
        SWITCH,
        "Switch Kontifi…",
        true,
        Some("CmdOrCtrl+Shift+K"),
    )?;
    let reload = MenuItem::with_id(app, RELOAD, "Reload", true, Some("CmdOrCtrl+R"))?;
    let kontifi = Submenu::with_items(
        app,
        "Kontifi",
        true,
        &[
            &switch,
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit Kontifi"))?,
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
    Menu::with_items(app, &[&kontifi, &edit, &window])
}

fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();
    let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Kontifi")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 680.0)
        .center()
        // Only web pages and the app's own pages load in the window, never files or other schemes.
        .on_navigation(links::may_load)
        // Links that open a new tab: Kontifi's own pages stay in the window, the rest open
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
            saved_kontifis,
            forget_kontifi,
            open_kontifi
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
        .expect("Kontifi couldn't start");
}
