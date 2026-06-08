#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn backend_status() -> &'static str {
    "Backend integration pending"
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![backend_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
