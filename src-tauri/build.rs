fn main() {
    tauri_build::build();
    // Tauri embeds Common Controls v6 into app binaries. Scope tests build a
    // real Tauri mock app too, so link the same generated resource into tests.
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows"
        && std::env::var("CARGO_CFG_TARGET_ENV").unwrap() == "msvc"
    {
        let out_dir = std::env::var("OUT_DIR").unwrap();
        let resource = std::path::PathBuf::from(out_dir).join("resource.lib");
        println!("cargo:rustc-link-arg-tests={}", resource.display());
    }
}
