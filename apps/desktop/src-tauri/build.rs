fn main() {
    // The app's own commands need a permission in capabilities/default.json, so nothing
    // can call them unless it is listed there.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "saved_kontifis",
            "forget_kontifi",
            "open_kontifi",
        ]),
    ))
    .expect("failed to build the Kontifi desktop app");
}
