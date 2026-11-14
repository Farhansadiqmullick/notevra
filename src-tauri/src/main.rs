// no extra console window behind the app on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // must be registered first so a second launch is caught before anything else starts
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            // macOS registers the scheme from the bundle; Windows/Linux need it at runtime in dev
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = _app.deep_link().register_all();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notevra");
}
