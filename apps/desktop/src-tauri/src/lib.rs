//! The desktop app. The window shows the person's own dashboard (hosted or
//! self-hosted) and the app adds what a browser tab can't: pick a dashboard and come
//! back to it, and alerts as system notifications with the unseen count on the tray.
//!
//! Security: the dashboard's pages are a remote site. capabilities/default.json covers
//! only the app's own pages; once someone connects, the dashboard's origin is given the
//! commands in `dashboard.rs` and nothing else, and each checks the caller is the
//! dashboard open now.

/// The product's name, from apps/desktop/product.json (set in build.rs), so a rename
/// is one change.
pub const NAME: &str = env!("PRODUCT_NAME");

pub mod address;
pub mod browser;
pub mod dashboard;
pub mod exports;
pub mod links;
pub mod machine;
pub mod saved;
pub mod stack;
pub mod uploads;
pub mod watches;

use std::sync::Mutex;

use tauri::ipc::CapabilityBuilder;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, State, Url, UserAttentionType, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
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

/// Where "Open in your editor" saves: a folder named after the app in the person's Videos
/// folder (or Documents, or home, on a computer without one).
fn exports_folder(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let paths = app.path();
    let base = paths
        .video_dir()
        .or_else(|_| paths.document_dir())
        .or_else(|_| paths.home_dir())
        .map_err(|_| "There is no folder to save into.".to_string())?;
    Ok(base.join(NAME))
}

/// Saves a run's files for an editor into one folder of their own, and says where.
#[tauri::command]
async fn save_export(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    folder: String,
    files: Vec<exports::TextFile>,
    downloads: Vec<exports::Download>,
) -> Result<exports::Saved, String> {
    from_dashboard(&window, &places)?;
    exports::save(&exports_folder(&app)?, &folder, &files, &downloads).await
}

/// A path the dashboard names, only when it is one the app saved.
fn saved_path(app: &AppHandle, path: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::PathBuf::from(path);
    if exports::is_inside(&exports_folder(app)?, &path) && path.exists() {
        Ok(path)
    } else {
        Err("Only files the app saved can be opened.".into())
    }
}

/// Opens a saved timeline in the editor the computer opens that kind of file with.
#[tauri::command]
fn open_export(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    path: String,
) -> Result<(), String> {
    from_dashboard(&window, &places)?;
    let path = saved_path(&app, &path)?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|_| "No app on this computer opens that file.".into())
}

/// Shows a saved file in its folder (Finder, Explorer or the file manager).
#[tauri::command]
fn show_export(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    path: String,
) -> Result<(), String> {
    from_dashboard(&window, &places)?;
    let path = saved_path(&app, &path)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| error.to_string())
}

fn uploads_store(app: &AppHandle) -> Result<uploads::Store, String> {
    let folder = app
        .path()
        .app_config_dir()
        .map_err(|_| format!("{NAME} couldn't find its settings folder."))?;
    Ok(uploads::Store::new(&folder))
}

/// The origin of the dashboard open now, which an upload is written down under.
fn current_dashboard(places: &Places) -> Result<String, String> {
    places
        .current
        .lock()
        .unwrap()
        .as_ref()
        .map(|url| url.origin().ascii_serialization() + "/")
        .ok_or_else(|| "No dashboard is open.".to_string())
}

/// Opens the computer's own file picker and says what was chosen. Only files chosen here
/// can be read and sent.
#[tauri::command]
async fn choose_files(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    allowed: State<'_, uploads::Allowed>,
) -> Result<Vec<uploads::Chosen>, String> {
    from_dashboard(&window, &places)?;
    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_files()
        .unwrap_or_default();
    Ok(picked
        .into_iter()
        .filter_map(|picked| picked.into_path().ok())
        .filter_map(|path| {
            let chosen = uploads::describe(&path)?;
            allowed.allow(&path);
            Some(chosen)
        })
        .collect())
}

/// Sends a small chosen file whole to the link the dashboard signed.
#[tauri::command]
async fn send_file(
    window: WebviewWindow,
    places: State<'_, Places>,
    allowed: State<'_, uploads::Allowed>,
    path: String,
    url: String,
    content_type: String,
) -> Result<(), String> {
    from_dashboard(&window, &places)?;
    let path = std::path::PathBuf::from(path);
    if !allowed.contains(&path) {
        return Err("Only files chosen in the app can be sent.".into());
    }
    let size = std::fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    uploads::put_range(
        &uploads::client()?,
        &path,
        0,
        size,
        &url,
        Some(&content_type),
    )
    .await
    .map(|_| ())
}

/// Writes down an upload going up in parts (or finds it again, to carry on) and says
/// which parts the bucket already has.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn begin_upload(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    allowed: State<'_, uploads::Allowed>,
    upload_id: String,
    path: String,
    plan: uploads::Plan,
) -> Result<uploads::Pending, String> {
    from_dashboard(&window, &places)?;
    let store = uploads_store(&app)?;
    let dashboard = current_dashboard(&places)?;
    if let Some(pending) = store.get(&upload_id) {
        if pending.dashboard != dashboard || pending.path != path {
            return Err("That upload belongs elsewhere.".into());
        }
        return Ok(pending);
    }
    let file = std::path::PathBuf::from(&path);
    if !allowed.contains(&file) {
        return Err("Only files chosen in the app can be sent.".into());
    }
    let chosen = uploads::describe(&file).ok_or("That file is no longer there.")?;
    let pending = uploads::Pending {
        upload_id,
        dashboard,
        path,
        name: chosen.name,
        size: chosen.size,
        content_type: chosen.content_type,
        plan,
        parts: vec![],
    };
    store.begin(pending.clone())?;
    Ok(pending)
}

/// Sends one part of an upload written down by `begin_upload`, read from its file, and
/// writes down the ETag the bucket answered with.
#[tauri::command]
async fn send_part(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    upload_id: String,
    part_number: u32,
    url: String,
) -> Result<Option<String>, String> {
    from_dashboard(&window, &places)?;
    let store = uploads_store(&app)?;
    let pending = store
        .get(&upload_id)
        .filter(|pending| Ok(&pending.dashboard) == current_dashboard(&places).as_ref())
        .ok_or("That upload isn't going up from this computer.")?;
    let (start, end) = uploads::part_range(pending.plan, pending.size, part_number)
        .ok_or("That part is outside the file.")?;
    let path = std::path::PathBuf::from(&pending.path);
    let etag = uploads::put_range(&uploads::client()?, &path, start, end, &url, None).await?;
    if let Some(etag) = &etag {
        store.sent(
            &upload_id,
            uploads::SentPart {
                part_number,
                etag: etag.clone(),
            },
        )?;
    }
    Ok(etag)
}

/// The open dashboard's uploads that stopped part way, to carry on from.
#[tauri::command]
fn stopped_uploads(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
) -> Result<Vec<uploads::Pending>, String> {
    from_dashboard(&window, &places)?;
    Ok(uploads_store(&app)?.stopped(&current_dashboard(&places)?))
}

/// Forgets an upload: it finished, or the person dropped it.
#[tauri::command]
fn forget_upload(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    upload_id: String,
) -> Result<(), String> {
    from_dashboard(&window, &places)?;
    let store = uploads_store(&app)?;
    let dashboard = current_dashboard(&places)?;
    match store.get(&upload_id) {
        Some(pending) if pending.dashboard != dashboard => {
            Err("That upload belongs elsewhere.".into())
        }
        _ => store.forget(&upload_id),
    }
}

/// Folders chosen in the app's folder picker this session.
#[derive(Default)]
struct ChosenFolders(uploads::Allowed);

fn watches_store(app: &AppHandle) -> Result<watches::Store, String> {
    let folder = app
        .path()
        .app_config_dir()
        .map_err(|_| format!("{NAME} couldn't find its settings folder."))?;
    Ok(watches::Store::new(&folder))
}

/// A watch as the dashboard sees it: without the list of files already known.
fn shown(mut watch: watches::Watch) -> watches::Watch {
    watch.known.clear();
    watch
}

/// Opens the computer's own folder picker. Null when nothing was chosen.
#[tauri::command]
async fn choose_folder(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    chosen: State<'_, ChosenFolders>,
) -> Result<Option<String>, String> {
    from_dashboard(&window, &places)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|error| error.to_string())?;
    chosen.0.allow(&path);
    Ok(Some(path.display().to_string()))
}

/// Has a folder on this computer feed an automation's folder in the team's storage.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn watch_folder(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    chosen: State<'_, ChosenFolders>,
    organization_id: String,
    automation_id: String,
    automation_name: String,
    prefix: String,
    folder: String,
) -> Result<watches::Watch, String> {
    from_dashboard(&window, &places)?;
    let dashboard = current_dashboard(&places)?;
    let store = watches_store(&app)?;
    let already = store
        .get(&dashboard, &automation_id)
        .is_some_and(|watch| watch.folder == folder);
    if !already && !chosen.0.contains(std::path::Path::new(&folder)) {
        return Err("Only folders chosen in the app can be watched.".into());
    }
    if !std::path::Path::new(&folder).is_dir() {
        return Err("That folder is no longer there.".into());
    }
    store
        .set(watches::Watch {
            automation_id,
            automation_name,
            organization_id,
            prefix,
            folder,
            dashboard,
            known: vec![],
        })
        .map(shown)
}

/// The open dashboard's watched folders.
#[tauri::command]
fn watched_folders(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
) -> Result<Vec<watches::Watch>, String> {
    from_dashboard(&window, &places)?;
    Ok(watches_store(&app)?
        .list(&current_dashboard(&places)?)
        .into_iter()
        .map(shown)
        .collect())
}

#[tauri::command]
fn unwatch_folder(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    automation_id: String,
) -> Result<(), String> {
    from_dashboard(&window, &places)?;
    watches_store(&app)?.remove(&current_dashboard(&places)?, &automation_id)
}

/// Files that landed in an automation's watched folder and are ready to send. Each may
/// then be sent like a file chosen in the picker.
#[tauri::command]
fn landed_files(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    allowed: State<'_, uploads::Allowed>,
    automation_id: String,
) -> Result<Vec<watches::Landed>, String> {
    from_dashboard(&window, &places)?;
    let Some(watch) = watches_store(&app)?.get(&current_dashboard(&places)?, &automation_id) else {
        return Ok(vec![]);
    };
    let landed = watches::landed(&watch, std::time::SystemTime::now());
    for file in &landed {
        allowed.allow(std::path::Path::new(&file.path));
    }
    Ok(landed)
}

/// Writes down a landed file as sent, so it is never sent again.
#[tauri::command]
fn landed_sent(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    automation_id: String,
    path: String,
) -> Result<(), String> {
    from_dashboard(&window, &places)?;
    watches_store(&app)?.sent(
        &current_dashboard(&places)?,
        &automation_id,
        std::path::Path::new(&path),
    )
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
    let builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()));
    #[cfg(windows)]
    let builder = {
        let extra = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").ok();
        let builder = builder.additional_browser_args(&browser::args(extra.as_deref()));
        // The Edge driver gives the web view its own folder and looks there for it.
        match std::env::var_os("WEBVIEW2_USER_DATA_FOLDER") {
            Some(folder) => builder.data_directory(folder.into()),
            None => builder,
        }
    };
    let window = builder
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

/// Refuses anything but the app's own pages: running the stack is never the dashboard's
/// to ask for (it also isn't in the dashboard's capability).
fn from_home(window: &WebviewWindow, places: &Places) -> Result<(), String> {
    let caller = window.url().map_err(|_| "Unknown page.".to_string())?;
    // Or the page the window started on (the dev server while working on the app), compared
    // by parts: tauri://localhost has an opaque origin, which never equals another. On
    // Windows the window can start on about:blank, which never counts.
    let home = &places.home;
    if links::is_app_page(&caller)
        || home.scheme() != "about"
            && caller.scheme() == home.scheme()
            && caller.host_str() == home.host_str()
            && caller.port_or_known_default() == home.port_or_known_default()
    {
        Ok(())
    } else {
        Err(format!("Only {NAME}'s own pages can do that."))
    }
}

fn stack_folder(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|folder| folder.join("stack"))
        .map_err(|_| format!("{NAME} couldn't find its data folder."))
}

fn this_stack(app: &AppHandle) -> Result<stack::Stack, String> {
    let docker = machine::docker_command().ok_or_else(|| "Docker isn't installed.".to_string())?;
    Ok(stack::Stack::new(&stack_folder(app)?, docker))
}

/// Looks at this computer for running the whole stack here.
#[tauri::command]
async fn check_machine(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
) -> Result<machine::Check, String> {
    from_home(&window, &places)?;
    let folder = stack_folder(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        machine::judge(&machine::facts(&folder), std::env::consts::OS)
    })
    .await
    .map_err(|_| "The check stopped part way. Try again.".to_string())
}

/// What is saved for the stack here, without its secrets.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StackSaved {
    saved: bool,
    addresses: stack::Addresses,
    bucket_endpoint: String,
    bucket_name: String,
    has_admin_key: bool,
}

#[tauri::command]
fn stack_saved(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
) -> Result<StackSaved, String> {
    from_home(&window, &places)?;
    let values = stack::Stack::new(&stack_folder(&app)?, "docker".into()).values();
    let get = |name: &str| values.get(name).cloned().unwrap_or_default();
    Ok(StackSaved {
        saved: !values.is_empty(),
        addresses: stack::Addresses {
            dashboard: get("SITE_URL"),
            api: get("CONVEX_URL"),
            site: get("CONVEX_SITE_URL"),
            agent: get("AGENT_URL"),
            toolkit: get("TOOLKIT_URL"),
        },
        bucket_endpoint: get("S3_ENDPOINT_URL"),
        bucket_name: get("S3_BUCKET_NAME"),
        has_admin_key: !get("CONVEX_ADMIN_KEY").is_empty(),
    })
}

/// Writes the stack's settings, sizing the toolkit to this machine.
#[tauri::command]
async fn save_stack(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    settings: stack::Settings,
) -> Result<(), String> {
    from_home(&window, &places)?;
    let stack = this_stack(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let facts = machine::facts(&stack.folder);
        let docker_memory = match facts.docker {
            machine::Docker::Ready { memory, .. } => memory,
            _ => None,
        };
        stack.save(&settings, stack::share(facts.cores, docker_memory))
    })
    .await
    .map_err(|_| "Saving stopped part way. Try again.".to_string())?
}

/// The last lines a failed command printed, for the person and for support.
fn tail(text: &str) -> String {
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    lines[lines.len().saturating_sub(6)..].join("\n")
}

/// Runs one step of starting the stack: "pull", "start", "adminKey", "setup" or "stop".
#[tauri::command]
async fn run_stack_step(
    app: AppHandle,
    window: WebviewWindow,
    places: State<'_, Places>,
    step: String,
) -> Result<(), String> {
    from_home(&window, &places)?;
    let stack = this_stack(&app)?;
    let args = match step.as_str() {
        "pull" => stack::PULL,
        "start" => stack::START,
        "adminKey" => stack::ADMIN_KEY,
        "setup" => stack::SETUP,
        "stop" => stack::STOP,
        _ => return Err("Unknown step.".into()),
    };
    if step == "adminKey"
        && stack
            .values()
            .get("CONVEX_ADMIN_KEY")
            .is_some_and(|key| !key.is_empty())
    {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let output = stack
            .compose(args)
            .output()
            .map_err(|_| "Docker couldn't be started.".to_string())?;
        let said = String::from_utf8_lossy(&output.stdout).into_owned();
        if !output.status.success() {
            let problem = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Docker stopped with: {}",
                tail(&format!("{said}\n{problem}"))
            ));
        }
        if step == "adminKey" {
            let key =
                stack::admin_key_from(&said).ok_or("Convex didn't give back an admin key.")?;
            stack.keep_admin_key(&key)?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "That step stopped part way. Try again.".to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(uploads::Allowed::default())
        .manage(ChosenFolders::default())
        .invoke_handler(tauri::generate_handler![
            saved_servers,
            forget_server,
            open_server,
            notify,
            set_unseen,
            save_export,
            open_export,
            show_export,
            choose_files,
            send_file,
            begin_upload,
            send_part,
            stopped_uploads,
            forget_upload,
            choose_folder,
            watch_folder,
            watched_folders,
            unwatch_folder,
            landed_files,
            landed_sent,
            check_machine,
            stack_saved,
            save_stack,
            run_stack_step
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
