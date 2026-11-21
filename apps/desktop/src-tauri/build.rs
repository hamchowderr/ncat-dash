fn main() {
    // The product's name lives in one place, ../product.json, so a rename is one change.
    println!("cargo:rerun-if-changed=../product.json");
    let product = std::fs::read_to_string("../product.json").expect("apps/desktop/product.json");
    let name = product
        .split("\"name\"")
        .nth(1)
        .and_then(|rest| rest.split('"').nth(1))
        .expect("product.json has a name");
    println!("cargo:rustc-env=PRODUCT_NAME={name}");

    // The app's own commands need a permission in capabilities/default.json, so nothing
    // can call them unless it is listed there.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "saved_servers",
            "forget_server",
            "open_server",
        ]),
    ))
    .expect("failed to build the desktop app");
}
