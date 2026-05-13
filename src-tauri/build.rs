fn main() {
    println!("cargo:rerun-if-env-changed=CLAWDESK_BUILD_PROFILE");
    if let Ok(profile) = std::env::var("CLAWDESK_BUILD_PROFILE") {
        println!("cargo:rustc-env=CLAWDESK_BUILD_PROFILE={profile}");
    }
    tauri_build::build();
}
