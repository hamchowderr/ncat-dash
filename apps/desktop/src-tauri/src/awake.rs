//! Keeps a computer that runs the whole stack awake, and opens the app when the person signs
//! in, so automations keep running at night. Both are on once the stack has started here,
//! and the tray menu turns each off. A laptop with its lid closed still sleeps.
//!
//! Windows ties "stay awake" to the thread that asked for it, so one thread holds it for the
//! app's whole life and takes orders over a channel.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};

use serde::{Deserialize, Serialize};

use crate::NAME;

/// The person's choices, kept beside the stack's settings (stack/awake.json).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub keep_awake: bool,
    pub open_at_login: bool,
}

/// Both on: what a computer that runs the stack needs.
pub const STARTED: Prefs = Prefs {
    keep_awake: true,
    open_at_login: true,
};

fn path(folder: &Path) -> PathBuf {
    folder.join("awake.json")
}

/// None until the stack has been started here.
pub fn load(folder: &Path) -> Option<Prefs> {
    serde_json::from_str(&fs::read_to_string(path(folder)).ok()?).ok()
}

pub fn save(folder: &Path, prefs: Prefs) -> Result<(), String> {
    let problem = |_| format!("{NAME} couldn't write to {}.", folder.display());
    fs::create_dir_all(folder).map_err(problem)?;
    let text = serde_json::to_string_pretty(&prefs).expect("plain values");
    fs::write(path(folder), text).map_err(problem)
}

/// The first time the stack has started here, both come on; after that the person's choice
/// stands. Gives back the choices and whether they were just made.
pub fn after_start(folder: &Path) -> Result<(Prefs, bool), String> {
    match load(folder) {
        Some(prefs) => Ok((prefs, false)),
        None => {
            save(folder, STARTED)?;
            Ok((STARTED, true))
        }
    }
}

/// Holds "stay awake" on its own thread.
pub struct Awake {
    orders: Sender<bool>,
}

impl Awake {
    pub fn start() -> Self {
        let (orders, inbox) = channel::<bool>();
        std::thread::Builder::new()
            .name("keep-awake".into())
            .spawn(move || {
                let mut held = None;
                for on in inbox {
                    if on && held.is_none() {
                        // Without a power manager to ask (some Linux setups) there's nothing to
                        // hold, and nothing the person can do about it here.
                        held = keepawake::Builder::default()
                            .idle(true)
                            .reason(format!("{NAME} runs automations on this computer"))
                            .app_name(NAME)
                            .app_reverse_domain("io.otakusolutions.desktop")
                            .create()
                            .ok();
                    } else if !on {
                        held = None;
                    }
                }
            })
            .expect("the system can't start a thread");
        Awake { orders }
    }

    pub fn set(&self, on: bool) {
        let _ = self.orders.send(on);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stays_off_until_the_stack_has_started_then_both_come_on_once() {
        let folder = tempfile::tempdir().unwrap();
        assert_eq!(load(folder.path()), None);
        assert_eq!(after_start(folder.path()).unwrap(), (STARTED, true));
        assert_eq!(load(folder.path()), Some(STARTED));

        let chosen = Prefs {
            keep_awake: false,
            open_at_login: true,
        };
        save(folder.path(), chosen).unwrap();
        // Starting again never undoes what the person turned off.
        assert_eq!(after_start(folder.path()).unwrap(), (chosen, false));
    }

    #[test]
    fn takes_orders_without_blocking_or_failing() {
        let awake = Awake::start();
        awake.set(true);
        awake.set(true);
        awake.set(false);
    }
}
