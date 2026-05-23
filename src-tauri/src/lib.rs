use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use std::path::PathBuf;

fn find_node() -> String {
    let standard_paths = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for path in &standard_paths {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    "node".to_string()
}

fn get_home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| {
        if let Ok(user) = std::env::var("USER") {
            format!("/Users/{}", user)
        } else {
            "/Users/username".to_string()
        }
    })
}

fn get_budgeting_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(path_str) = std::env::var("BUDGETING_DIR") {
        let p = PathBuf::from(path_str);
        if p.exists() {
            return p;
        }
    }

    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled = res_dir.join("budgeting");
        if bundled.exists() {
            return bundled;
        }
        let bundled_up = res_dir.join("_up_").join("budgeting");
        if bundled_up.exists() {
            return bundled_up;
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let config_path = std::path::Path::new(&home).join(".concierge-config.json");
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(config_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(dir_str) = json.get("budgeting_dir").and_then(|v| v.as_str()) {
                        let p = PathBuf::from(dir_str);
                        if p.exists() {
                            return p;
                        }
                    }
                }
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let internal = cwd.join("budgeting");
        if internal.exists() {
            return internal;
        }
        let sibling = cwd.join("..").join("budgeting");
        if sibling.exists() {
            return sibling;
        }
    }

    let home = get_home_dir();
    let default_path = PathBuf::from(home).join("Documents").join("budgeting");
    if default_path.exists() {
        return default_path;
    }

    PathBuf::from(".")
}

#[tauri::command]
async fn run_bank_sync(app: tauri::AppHandle) -> Result<String, String> {
    let budgeting_dir = get_budgeting_dir(&app);
    let node_bin = find_node();
    let script_path = budgeting_dir.join("scripts").join("sync-only.js");
    if !script_path.exists() {
        return Err(format!("Sync script not found at: {}. Please verify the installation.", script_path.display()));
    }
    
    let working_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !working_dir.exists() {
        std::fs::create_dir_all(&working_dir).map_err(|e| e.to_string())?;
    }

    let output = std::process::Command::new(&node_bin)
        .arg(&script_path)
        .current_dir(&working_dir)
        .env("HOME", get_home_dir())
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("BUDGET_CACHE_DIR", working_dir.join(".actual-cache"))
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
async fn get_suggestions(app: tauri::AppHandle) -> Result<String, String> {
    let budgeting_dir = get_budgeting_dir(&app);
    let node_bin = find_node();
    let script_path = budgeting_dir.join("scripts").join("categorize.js");
    if !script_path.exists() {
        return Err(format!("Suggestions script not found at: {}. Please verify the installation.", script_path.display()));
    }
    
    let working_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !working_dir.exists() {
        std::fs::create_dir_all(&working_dir).map_err(|e| e.to_string())?;
    }

    let output = std::process::Command::new(&node_bin)
        .arg(&script_path)
        .current_dir(&working_dir)
        .env("HOME", get_home_dir())
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("BUDGET_CACHE_DIR", working_dir.join(".actual-cache"))
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
async fn apply_categories(app: tauri::AppHandle, json: String) -> Result<String, String> {
    use std::io::Write;
    let budgeting_dir = get_budgeting_dir(&app);
    let node_bin = find_node();
    let script_path = budgeting_dir.join("scripts").join("apply-categories.js");
    if !script_path.exists() {
        return Err(format!("Apply categories script not found at: {}. Please verify the installation.", script_path.display()));
    }
    
    let working_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !working_dir.exists() {
        std::fs::create_dir_all(&working_dir).map_err(|e| e.to_string())?;
    }

    let mut child = std::process::Command::new(&node_bin)
        .arg(&script_path)
        .current_dir(&working_dir)
        .env("HOME", get_home_dir())
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("BUDGET_CACHE_DIR", working_dir.join(".actual-cache"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
async fn get_uncategorized_count(app: tauri::AppHandle) -> Result<u32, String> {
    let budgeting_dir = get_budgeting_dir(&app);
    let node_bin = find_node();
    let script_path = budgeting_dir.join("scripts").join("count-uncategorized.js");
    if !script_path.exists() {
        return Err(format!("Count script not found at: {}. Please verify the installation.", script_path.display()));
    }
    
    let working_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !working_dir.exists() {
        std::fs::create_dir_all(&working_dir).map_err(|e| e.to_string())?;
    }

    let output = std::process::Command::new(&node_bin)
        .arg(&script_path)
        .current_dir(&working_dir)
        .env("HOME", get_home_dir())
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("BUDGET_CACHE_DIR", working_dir.join(".actual-cache"))
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    stdout.parse::<u32>().map_err(|_| "parse error".to_string())
}

#[tauri::command]
async fn run_export(app: tauri::AppHandle) -> Result<String, String> {
    let budgeting_dir = get_budgeting_dir(&app);
    let node_bin = find_node();
    let script_path = budgeting_dir.join("scripts").join("export.js");
    if !script_path.exists() {
        return Err(format!("Export script not found at: {}. Please verify the installation.", script_path.display()));
    }
    
    let working_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !working_dir.exists() {
        std::fs::create_dir_all(&working_dir).map_err(|e| e.to_string())?;
    }

    let output = std::process::Command::new(&node_bin)
        .arg(&script_path)
        .current_dir(&working_dir)
        .env("HOME", get_home_dir())
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("BUDGET_CACHE_DIR", working_dir.join(".actual-cache"))
        .output()
        .map_err(|e| format!("Failed to start: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
async fn get_weekly_brief(app: tauri::AppHandle) -> Result<String, String> {
    let budgeting_dir = get_budgeting_dir(&app);
    let node_bin = find_node();
    let script_path = budgeting_dir.join("scripts").join("weekly-brief.js");
    if !script_path.exists() {
        return Err(format!("Weekly brief script not found at: {}. Please verify the installation.", script_path.display()));
    }
    
    let working_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !working_dir.exists() {
        std::fs::create_dir_all(&working_dir).map_err(|e| e.to_string())?;
    }

    let output = std::process::Command::new(&node_bin)
        .arg(&script_path)
        .current_dir(&working_dir)
        .env("HOME", get_home_dir())
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("BUDGET_CACHE_DIR", working_dir.join(".actual-cache"))
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
async fn launch_dashboard(app: tauri::AppHandle) -> Result<String, String> {
    let budgeting_dir = get_budgeting_dir(&app);
    let node_bin = find_node();
    let script_path = budgeting_dir.join("scripts").join("dashboard-server.js");
    if !script_path.exists() {
        return Err(format!("Dashboard script not found at: {}. Please verify the installation.", script_path.display()));
    }
    
    // Kill any existing dashboard server on port 5008
    let _ = std::process::Command::new("lsof")
        .args(["-ti", ":5008"])
        .output()
        .and_then(|output| {
            let pids = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !pids.is_empty() {
                std::process::Command::new("kill").arg(&pids).output()
            } else {
                Ok(output)
            }
        });

    std::thread::sleep(std::time::Duration::from_millis(500));

    let working_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !working_dir.exists() {
        std::fs::create_dir_all(&working_dir).map_err(|e| e.to_string())?;
    }

    // Spawn dashboard server as a detached background process
    std::process::Command::new(&node_bin)
        .arg(&script_path)
        .current_dir(&working_dir)
        .env("HOME", get_home_dir())
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("BUDGET_CACHE_DIR", working_dir.join(".actual-cache"))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start dashboard server: {}", e))?;

    // Wait for server to be ready
    std::thread::sleep(std::time::Duration::from_millis(3000));

    // Open in browser
    let _ = std::process::Command::new("open")
        .arg("http://localhost:5008")
        .spawn();

    Ok("Dashboard launched".to_string())
}

#[tauri::command]
fn load_ai_config() -> String {
    let config_path = PathBuf::from(get_home_dir()).join(".concierge").join("ai-provider.json");
    std::fs::read_to_string(config_path)
        .unwrap_or_else(|_| r#"{"provider":"claude","ollama":{"model":"gemma4:e4b","baseUrl":"http://localhost:11434"}}"#.to_string())
}

#[tauri::command]
fn save_ai_config(json: String) -> Result<(), String> {
    let config_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    let config_path = config_dir.join("ai-provider.json");
    std::fs::write(config_path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_env_config() -> Result<serde_json::Value, String> {
    let env_path = PathBuf::from(get_home_dir()).join(".concierge").join(".env");
    
    let mut config = serde_json::Map::new();
    config.insert("actual_url".to_string(), serde_json::Value::String("http://localhost:5007".to_string()));
    config.insert("actual_password".to_string(), serde_json::Value::String("".to_string()));
    config.insert("actual_sync_id".to_string(), serde_json::Value::String("".to_string()));
    config.insert("gdrive_folder_id".to_string(), serde_json::Value::String("".to_string()));
    
    if env_path.exists() {
        if let Ok(content) = std::fs::read_to_string(env_path) {
            for line in content.lines() {
                let parts: Vec<&str> = line.splitn(2, '=').collect();
                if parts.len() == 2 {
                    let key = parts[0].trim();
                    let val = parts[1].trim();
                    match key {
                        "ACTUAL_SERVER_URL" => { config.insert("actual_url".to_string(), serde_json::Value::String(val.to_string())); },
                        "ACTUAL_PASSWORD" => { config.insert("actual_password".to_string(), serde_json::Value::String(val.to_string())); },
                        "ACTUAL_SYNC_ID" => { config.insert("actual_sync_id".to_string(), serde_json::Value::String(val.to_string())); },
                        "GDRIVE_FOLDER_ID" => { config.insert("gdrive_folder_id".to_string(), serde_json::Value::String(val.to_string())); },
                        _ => {}
                    }
                }
            }
        }
    }
    
    Ok(serde_json::Value::Object(config))
}

#[tauri::command]
fn save_env_config(
    actual_url: String,
    actual_password: String,
    actual_sync_id: String,
    gdrive_folder_id: String,
) -> Result<(), String> {
    let config_dir = PathBuf::from(get_home_dir()).join(".concierge");
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    let env_path = config_dir.join(".env");
    
    let content = format!(
        "ACTUAL_SERVER_URL={}\nACTUAL_PASSWORD={}\nACTUAL_SYNC_ID={}\nGDRIVE_FOLDER_ID={}\n",
        actual_url, actual_password, actual_sync_id, gdrive_folder_id
    );
    
    std::fs::write(env_path, content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Regular);

                // Kill any other running instances before taking over
                // Use exact binary name match (-x) to avoid killing cargo/npm dev processes
                let current_pid = std::process::id();
                if let Ok(output) = std::process::Command::new("pgrep")
                    .args(["-x", "concierge"])
                    .output()
                {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    for pid_str in stdout.lines() {
                        if let Ok(pid) = pid_str.trim().parse::<u32>() {
                            if pid != current_pid {
                                let _ = std::process::Command::new("kill")
                                    .args(["-9", &pid.to_string()])
                                    .spawn();
                            }
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(300));
                }
            }

            let quit = MenuItem::with_id(app, "quit", "Quit Concierge", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Concierge")
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                if let Ok(Some(monitor)) = window.primary_monitor() {
                                    let scale = monitor.scale_factor();
                                    let screen_w = monitor.size().width as f64 / scale;
                                    let screen_h = monitor.size().height as f64 / scale;
                                    let win_w = 320.0_f64;
                                    let win_h = 480.0_f64;
                                    let x = (screen_w - win_w) / 2.0;
                                    let y = (screen_h - win_h) * 0.45;
                                    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Auto-hide window when it loses focus (standard macOS menu bar app behavior)
            if let Some(win) = app.get_webview_window("main") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![run_bank_sync, run_export, get_uncategorized_count, get_suggestions, apply_categories, launch_dashboard, get_weekly_brief, load_ai_config, save_ai_config, load_env_config, save_env_config])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_home_dir() {
        let home = get_home_dir();
        assert!(!home.is_empty());
    }

    #[test]
    fn test_save_and_load_env_config() {
        let env_path = PathBuf::from(get_home_dir()).join(".concierge").join(".env");
        let backup = if env_path.exists() {
            std::fs::read_to_string(&env_path).ok()
        } else {
            None
        };

        let test_url = "http://test-server-url:5007".to_string();
        let test_password = "test_password_123".to_string();
        let test_sync_id = "test-sync-id-abc".to_string();
        let test_gdrive_id = "test-gdrive-id-xyz".to_string();

        // Test save
        let save_res = save_env_config(
            test_url.clone(),
            test_password.clone(),
            test_sync_id.clone(),
            test_gdrive_id.clone(),
        );
        assert!(save_res.is_ok());

        // Test load
        let load_res = load_env_config();
        assert!(load_res.is_ok());
        let val = load_res.unwrap();
        assert_eq!(val["actual_url"], serde_json::Value::String(test_url));
        assert_eq!(val["actual_password"], serde_json::Value::String(test_password));
        assert_eq!(val["actual_sync_id"], serde_json::Value::String(test_sync_id));
        assert_eq!(val["gdrive_folder_id"], serde_json::Value::String(test_gdrive_id));

        // Restore backup or clean up
        if let Some(backup_content) = backup {
            let _ = std::fs::write(&env_path, backup_content);
        } else {
            let _ = std::fs::remove_file(&env_path);
        }
    }
}
