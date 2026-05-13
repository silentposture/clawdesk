use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;
#[cfg(all(windows, test))]
use windows_sys::Win32::Security::Cryptography::CryptUnprotectData;
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
};

const MOCK_PORT: u16 = 18890;
const BUILD_PROFILE: Option<&str> = option_env!("CLAWDESK_BUILD_PROFILE");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayInfo {
    base_url: String,
    ws_url: String,
    mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionResult {
    request_id: String,
    allowed: bool,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegalConsentRecord {
    version: String,
    accepted_at: String,
    document_hash: String,
    documents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCredentialInput {
    provider_id: String,
    auth_mode: String,
    secret: Option<String>,
    account_email: Option<String>,
    endpoint: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCredentialRecord {
    provider_id: String,
    auth_mode: String,
    encrypted_secret: Option<String>,
    secret_label: Option<String>,
    account_email: Option<String>,
    endpoint: Option<String>,
    model: Option<String>,
    updated_at_epoch_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCredentialSummary {
    provider_id: String,
    auth_mode: String,
    has_secret: bool,
    secret_label: Option<String>,
    account_email: Option<String>,
    endpoint: Option<String>,
    model: Option<String>,
    storage: String,
    updated_at_epoch_ms: u128,
}

#[derive(Default)]
struct GatewayState {
    child: Option<Child>,
    info: Option<GatewayInfo>,
}

impl Drop for GatewayState {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

type SharedGatewayState = Mutex<GatewayState>;

fn default_gateway_info(mode: &str) -> GatewayInfo {
    GatewayInfo {
        base_url: format!("http://127.0.0.1:{MOCK_PORT}"),
        ws_url: format!("ws://127.0.0.1:{MOCK_PORT}/events"),
        mode: mode.to_string(),
    }
}

fn gateway_info_from_base_url(
    base_url: &str,
    ws_url_override: Option<&str>,
    mode: &str,
) -> Result<GatewayInfo, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Gateway base URL cannot be empty".to_string());
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Gateway base URL must start with http:// or https://".to_string());
    }

    let ws_url = match ws_url_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value.trim_end_matches('/').to_string(),
        None if trimmed.starts_with("https://") => {
            format!("wss://{}/events", trimmed.trim_start_matches("https://"))
        }
        None => format!("ws://{}/events", trimmed.trim_start_matches("http://")),
    };

    Ok(GatewayInfo {
        base_url: trimmed.to_string(),
        ws_url,
        mode: mode.to_string(),
    })
}

fn configured_gateway_info_from_env() -> Result<Option<GatewayInfo>, String> {
    match std::env::var("CLAWDESK_GATEWAY_BASE_URL") {
        Ok(base_url) => gateway_info_from_base_url(
            &base_url,
            std::env::var("CLAWDESK_GATEWAY_WS_URL").ok().as_deref(),
            "external",
        )
        .map(Some),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(format!("Failed to read CLAWDESK_GATEWAY_BASE_URL: {error}")),
    }
}

fn mock_gateway_allowed() -> bool {
    let runtime_disabled = std::env::var("CLAWDESK_DISABLE_MOCK_GATEWAY")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false);

    mock_gateway_allowed_for(BUILD_PROFILE, runtime_disabled)
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

fn write_smoke_log(message: &str) {
    if let Ok(path) = std::env::var("CLAWDESK_SMOKE_GATEWAY_LOG") {
        let line = format!("{message}\n");
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut file| {
                use std::io::Write;
                file.write_all(line.as_bytes())
            });
    }
}

fn mock_gateway_allowed_for(build_profile: Option<&str>, runtime_disabled: bool) -> bool {
    let build_profile_is_production = build_profile == Some("production");
    !build_profile_is_production && !runtime_disabled
}

fn gateway_health_url(base_url: &str) -> String {
    format!("{}/health", base_url.trim_end_matches('/'))
}

fn gateway_health_ok_for(base_url: &str) -> bool {
    let url = gateway_health_url(base_url);
    ureq::get(&url)
        .timeout(Duration::from_millis(450))
        .call()
        .map(|response| response.status() == 200)
        .unwrap_or(false)
}

fn gateway_health_ok() -> bool {
    gateway_health_ok_for(&default_gateway_info("external").base_url)
}

fn permission_result_payload(result: &PermissionResult) -> serde_json::Value {
    serde_json::json!({
        "type": "permission.result",
        "requestId": result.request_id,
        "allowed": result.allowed,
        "reason": result.reason,
    })
}

fn initial_project_directory(initial_path: Option<String>) -> Option<PathBuf> {
    let path = initial_path?.trim().to_string();
    if path.is_empty() {
        return None;
    }

    let candidate = PathBuf::from(path);
    candidate.exists().then_some(candidate)
}

fn legal_consent_path_from_config_dir(config_dir: PathBuf) -> PathBuf {
    config_dir.join("legal-consent.json")
}

fn legal_consent_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve app config dir: {error}"))?;
    Ok(legal_consent_path_from_config_dir(config_dir))
}

fn provider_credentials_path_from_config_dir(config_dir: PathBuf) -> PathBuf {
    config_dir.join("provider-credentials.json")
}

fn provider_credentials_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve app config dir: {error}"))?;
    Ok(provider_credentials_path_from_config_dir(config_dir))
}

fn now_epoch_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn validate_provider_credential_input(input: &ProviderCredentialInput) -> Result<(), String> {
    let provider_id = input.provider_id.trim();
    if provider_id.is_empty() || provider_id.len() > 80 {
        return Err("Provider id is required".to_string());
    }
    if !provider_id
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err("Provider id contains unsupported characters".to_string());
    }
    match input.auth_mode.trim() {
        "api-key" | "oauth" | "local-endpoint" | "mock" => Ok(()),
        _ => Err("Unsupported provider auth mode".to_string()),
    }
}

fn mask_secret(secret: &str) -> String {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let prefix: String = trimmed.chars().take(4).collect();
    let suffix_chars: Vec<char> = trimmed.chars().rev().take(4).collect();
    let suffix: String = suffix_chars.into_iter().rev().collect();
    if trimmed.chars().count() <= 8 {
        format!("{prefix}…")
    } else {
        format!("{prefix}…{suffix}")
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    let trimmed = value.trim();
    if trimmed.len() % 2 != 0 {
        return Err("Encrypted secret has invalid hex length".to_string());
    }
    let mut bytes = Vec::with_capacity(trimmed.len() / 2);
    for index in (0..trimmed.len()).step_by(2) {
        let byte = u8::from_str_radix(&trimmed[index..index + 2], 16)
            .map_err(|error| format!("Encrypted secret has invalid hex: {error}"))?;
        bytes.push(byte);
    }
    Ok(bytes)
}

#[cfg(windows)]
fn protect_secret(secret: &str) -> Result<String, String> {
    let mut secret_bytes = secret.as_bytes().to_vec();
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: secret_bytes.len() as u32,
        pbData: secret_bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Windows DPAPI failed to protect provider credential".to_string());
    }
    let encrypted = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let encoded = hex_encode(encrypted);
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(encoded)
}

#[cfg(windows)]
#[cfg(test)]
fn unprotect_secret(encrypted_hex: &str) -> Result<String, String> {
    let mut encrypted = hex_decode(encrypted_hex)?;
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Windows DPAPI failed to unprotect provider credential".to_string());
    }
    let plain = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let value = String::from_utf8(plain.to_vec())
        .map_err(|error| format!("Provider credential is not valid UTF-8: {error}"))?;
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(value)
}

#[cfg(not(windows))]
fn protect_secret(secret: &str) -> Result<String, String> {
    Ok(hex_encode(secret.as_bytes()))
}

#[cfg(not(windows))]
#[cfg(test)]
fn unprotect_secret(encrypted_hex: &str) -> Result<String, String> {
    String::from_utf8(hex_decode(encrypted_hex)?)
        .map_err(|error| format!("Provider credential is not valid UTF-8: {error}"))
}

fn read_provider_credentials_from_path(
    path: PathBuf,
) -> Result<Vec<ProviderCredentialRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read provider credentials: {error}"))?;
    serde_json::from_str::<Vec<ProviderCredentialRecord>>(&raw)
        .map_err(|error| format!("Failed to parse provider credentials: {error}"))
}

fn write_provider_credentials_to_path(
    path: PathBuf,
    records: &[ProviderCredentialRecord],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create app config dir: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(records)
        .map_err(|error| format!("Failed to serialize provider credentials: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("Failed to write provider credentials: {error}"))
}

fn summarize_provider_credential(record: &ProviderCredentialRecord) -> ProviderCredentialSummary {
    ProviderCredentialSummary {
        provider_id: record.provider_id.clone(),
        auth_mode: record.auth_mode.clone(),
        has_secret: record.encrypted_secret.is_some(),
        secret_label: record.secret_label.clone(),
        account_email: record.account_email.clone(),
        endpoint: record.endpoint.clone(),
        model: record.model.clone(),
        storage: if cfg!(windows) {
            "windows-dpapi"
        } else {
            "portable-dev"
        }
        .to_string(),
        updated_at_epoch_ms: record.updated_at_epoch_ms,
    }
}

fn write_provider_credential_to_path(
    path: PathBuf,
    input: ProviderCredentialInput,
) -> Result<ProviderCredentialSummary, String> {
    validate_provider_credential_input(&input)?;
    let mut records = read_provider_credentials_from_path(path.clone())?;
    let secret = input
        .secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let encrypted_secret = match secret {
        Some(value) => Some(protect_secret(value)?),
        None => None,
    };
    let secret_label = secret.map(mask_secret);
    let record = ProviderCredentialRecord {
        provider_id: input.provider_id.trim().to_string(),
        auth_mode: input.auth_mode.trim().to_string(),
        encrypted_secret,
        secret_label,
        account_email: input
            .account_email
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        endpoint: input
            .endpoint
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        model: input
            .model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        updated_at_epoch_ms: now_epoch_ms(),
    };

    records.retain(|item| item.provider_id != record.provider_id);
    records.push(record.clone());
    records.sort_by(|a, b| a.provider_id.cmp(&b.provider_id));
    write_provider_credentials_to_path(path, &records)?;
    Ok(summarize_provider_credential(&record))
}

fn read_provider_credential_summaries_from_path(
    path: PathBuf,
) -> Result<Vec<ProviderCredentialSummary>, String> {
    read_provider_credentials_from_path(path).map(|records| {
        records
            .iter()
            .map(summarize_provider_credential)
            .collect::<Vec<_>>()
    })
}

fn read_legal_consent_from_path(path: PathBuf) -> Result<Option<LegalConsentRecord>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read legal consent record: {error}"))?;
    serde_json::from_str::<LegalConsentRecord>(&raw)
        .map(Some)
        .map_err(|error| format!("Failed to parse legal consent record: {error}"))
}

fn write_legal_consent_to_path(path: PathBuf, record: &LegalConsentRecord) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create app config dir: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("Failed to serialize legal consent record: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("Failed to write legal consent record: {error}"))
}

fn write_legal_export_to_path(path: PathBuf, contents: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| format!("Legal export must be valid JSON: {error}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create export directory: {error}"))?;
    }
    fs::write(path, contents).map_err(|error| format!("Failed to write legal export: {error}"))
}

fn sidecar_script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Failed to resolve resource dir: {error}"))?;
    let packaged = resource_dir
        .join("sidecars")
        .join("mock-gateway")
        .join("server.mjs");
    if packaged.exists() {
        return Ok(packaged);
    }

    let dev_path = std::env::current_dir()
        .map_err(|error| format!("Failed to resolve cwd: {error}"))?
        .join("sidecars")
        .join("mock-gateway")
        .join("server.mjs");

    Ok(dev_path)
}

fn spawn_mock_gateway(app: &tauri::AppHandle) -> Result<Child, String> {
    let script = sidecar_script_path(app)?;
    if !script.exists() {
        return Err(format!(
            "Mock gateway script not found at {}",
            script.display()
        ));
    }

    let script_arg = script
        .to_string_lossy()
        .strip_prefix(r"\\?\")
        .map(str::to_string)
        .unwrap_or_else(|| script.to_string_lossy().to_string());

    write_smoke_log(&format!("spawning mock gateway: {script_arg}"));
    Command::new("node")
        .arg(script_arg)
        .env("OPENCLAW_MOCK_PORT", MOCK_PORT.to_string())
        .env("NODE_ENV", "production")
        .env("NODE_OPTIONS", "--max-old-space-size=128")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to spawn mock gateway: {error}"))
}

fn cleanup_gateway(app: &tauri::AppHandle) {
    let state = app.state::<SharedGatewayState>();
    if let Ok(mut guard) = state.lock() {
        if let Some(mut child) = guard.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        guard.info = None;
    };
}

#[tauri::command]
fn get_gateway_info(state: tauri::State<'_, SharedGatewayState>) -> Result<GatewayInfo, String> {
    let guard = state
        .lock()
        .map_err(|_| "Gateway state is poisoned".to_string())?;
    Ok(guard
        .info
        .clone()
        .unwrap_or_else(|| default_gateway_info("external")))
}

#[tauri::command]
fn ensure_gateway(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedGatewayState>,
) -> Result<GatewayInfo, String> {
    ensure_gateway_for_app(&app, &state)
}

fn ensure_gateway_for_app(
    app: &tauri::AppHandle,
    state: &SharedGatewayState,
) -> Result<GatewayInfo, String> {
    write_smoke_log("ensure_gateway_for_app started");
    if let Some(info) = configured_gateway_info_from_env()? {
        if gateway_health_ok_for(&info.base_url) {
            let mut guard = state
                .lock()
                .map_err(|_| "Gateway state is poisoned".to_string())?;
            guard.info = Some(info.clone());
            return Ok(info);
        }

        return Err(format!(
            "Configured production gateway is not healthy: {}",
            gateway_health_url(&info.base_url)
        ));
    }

    if !mock_gateway_allowed() {
        return Err(
            "Production Gateway is required. Set CLAWDESK_GATEWAY_BASE_URL; mock Gateway fallback is disabled."
                .to_string(),
        );
    }

    if gateway_health_ok() {
        let info = default_gateway_info("external");
        let mut guard = state
            .lock()
            .map_err(|_| "Gateway state is poisoned".to_string())?;
        guard.info = Some(info.clone());
        return Ok(info);
    }

    {
        let guard = state
            .lock()
            .map_err(|_| "Gateway state is poisoned".to_string())?;
        if guard.child.is_some() {
            return Ok(guard
                .info
                .clone()
                .unwrap_or_else(|| default_gateway_info("sidecar")));
        }
    }

    let child = spawn_mock_gateway(app)?;
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(100));
        if gateway_health_ok() {
            let info = default_gateway_info("sidecar");
            let mut guard = state
                .lock()
                .map_err(|_| "Gateway state is poisoned".to_string())?;
            guard.child = Some(child);
            guard.info = Some(info.clone());
            write_smoke_log("mock gateway healthy");
            return Ok(info);
        }
    }

    write_smoke_log("mock gateway did not become healthy");
    Err("Mock gateway did not become healthy in time".to_string())
}

#[tauri::command]
fn resolve_permission(
    result: PermissionResult,
    state: tauri::State<'_, SharedGatewayState>,
) -> Result<(), String> {
    let base_url = state
        .lock()
        .map_err(|_| "Gateway state is poisoned".to_string())?
        .info
        .as_ref()
        .map(|info| info.base_url.clone())
        .unwrap_or_else(|| default_gateway_info("external").base_url);
    let url = format!("{}/permission-result", base_url.trim_end_matches('/'));
    let body = permission_result_payload(&result);

    ureq::post(&url)
        .timeout(Duration::from_secs(2))
        .send_json(body)
        .map(|_| ())
        .map_err(|error| format!("Failed to send permission result: {error}"))
}

#[tauri::command]
fn pick_project_folder(initial_path: Option<String>) -> Result<String, String> {
    let mut dialog = FileDialog::new().set_title("選擇專案資料夾");
    if let Some(fallback) = initial_project_directory(initial_path) {
        dialog = dialog.set_directory(&fallback);
    }

    match dialog.pick_folder() {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("未選取資料夾".to_string()),
    }
}

#[tauri::command]
fn read_legal_consent(app: tauri::AppHandle) -> Result<Option<LegalConsentRecord>, String> {
    read_legal_consent_from_path(legal_consent_path(&app)?)
}

#[tauri::command]
fn write_legal_consent(
    app: tauri::AppHandle,
    record: LegalConsentRecord,
) -> Result<LegalConsentRecord, String> {
    write_legal_consent_to_path(legal_consent_path(&app)?, &record)?;
    Ok(record)
}

#[tauri::command]
fn save_legal_export(
    default_file_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let file_name = if default_file_name.trim().is_empty() {
        "clawdesk-legal-summary.json".to_string()
    } else {
        default_file_name
    };
    let selected = FileDialog::new()
        .set_title("匯出 ClawDesk 法務摘要")
        .set_file_name(&file_name)
        .add_filter("JSON", &["json"])
        .save_file();

    match selected {
        Some(path) => {
            write_legal_export_to_path(path.clone(), &contents)?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn write_provider_credential(
    app: tauri::AppHandle,
    credential: ProviderCredentialInput,
) -> Result<ProviderCredentialSummary, String> {
    write_provider_credential_to_path(provider_credentials_path(&app)?, credential)
}

#[tauri::command]
fn read_provider_credential_summaries(
    app: tauri::AppHandle,
) -> Result<Vec<ProviderCredentialSummary>, String> {
    read_provider_credential_summaries_from_path(provider_credentials_path(&app)?)
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(SharedGatewayState::default())
        .invoke_handler(tauri::generate_handler![
            ensure_gateway,
            get_gateway_info,
            resolve_permission,
            pick_project_folder,
            read_legal_consent,
            write_legal_consent,
            save_legal_export,
            write_provider_credential,
            read_provider_credential_summaries
        ])
        .setup(|app| {
            if env_flag("CLAWDESK_SMOKE_BOOT_GATEWAY") {
                write_smoke_log("smoke setup boot requested");
                ensure_gateway_for_app(app.handle(), &app.state::<SharedGatewayState>())
                    .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                cleanup_gateway(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building ClawDesk");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            cleanup_gateway(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_gateway_info_uses_mock_gateway_contract() {
        let info = default_gateway_info("sidecar");

        assert_eq!(info.base_url, "http://127.0.0.1:18890");
        assert_eq!(info.ws_url, "ws://127.0.0.1:18890/events");
        assert_eq!(info.mode, "sidecar");
    }

    #[test]
    fn gateway_info_from_base_url_builds_ws_contract() {
        let info =
            gateway_info_from_base_url("https://gateway.example.test/root/", None, "external")
                .expect("https gateway should be valid");

        assert_eq!(info.base_url, "https://gateway.example.test/root");
        assert_eq!(info.ws_url, "wss://gateway.example.test/root/events");
        assert_eq!(info.mode, "external");
    }

    #[test]
    fn gateway_info_from_base_url_uses_ws_override() {
        let info = gateway_info_from_base_url(
            "http://127.0.0.1:18891",
            Some("ws://127.0.0.1:18891/custom-events/"),
            "external",
        )
        .expect("gateway should accept ws override");

        assert_eq!(info.base_url, "http://127.0.0.1:18891");
        assert_eq!(info.ws_url, "ws://127.0.0.1:18891/custom-events");
    }

    #[test]
    fn gateway_info_from_base_url_rejects_invalid_base_url() {
        let result = gateway_info_from_base_url("file:///tmp/gateway.sock", None, "external");

        assert!(result.is_err());
    }

    #[test]
    fn gateway_health_url_normalizes_trailing_slash() {
        assert_eq!(
            gateway_health_url("http://127.0.0.1:18891/"),
            "http://127.0.0.1:18891/health"
        );
    }

    #[test]
    fn mock_gateway_allowed_by_default_in_test_builds() {
        assert!(mock_gateway_allowed_for(None, false));
    }

    #[test]
    fn mock_gateway_is_disabled_for_production_profile_or_runtime_flag() {
        assert!(!mock_gateway_allowed_for(Some("production"), false));
        assert!(!mock_gateway_allowed_for(None, true));
        assert!(mock_gateway_allowed_for(Some("mock-candidate"), false));
    }

    #[test]
    fn permission_payload_preserves_frontend_contract() {
        let payload = permission_result_payload(&PermissionResult {
            request_id: "perm-123".to_string(),
            allowed: false,
            reason: Some("人工拒絕".to_string()),
        });

        assert_eq!(payload["type"], "permission.result");
        assert_eq!(payload["requestId"], "perm-123");
        assert_eq!(payload["allowed"], false);
        assert_eq!(payload["reason"], "人工拒絕");
    }

    #[test]
    fn permission_payload_keeps_null_reason_when_absent() {
        let payload = permission_result_payload(&PermissionResult {
            request_id: "perm-456".to_string(),
            allowed: true,
            reason: None,
        });

        assert!(payload["reason"].is_null());
    }

    #[test]
    fn initial_project_directory_accepts_existing_directory() {
        let cwd = std::env::current_dir().expect("cwd should exist");
        let resolved = initial_project_directory(Some(cwd.to_string_lossy().to_string()));

        assert_eq!(resolved, Some(cwd));
    }

    #[test]
    fn initial_project_directory_rejects_empty_or_missing_path() {
        assert_eq!(initial_project_directory(None), None);
        assert_eq!(initial_project_directory(Some("   ".to_string())), None);
        assert_eq!(
            initial_project_directory(Some("__clawdesk_missing_test_dir__".to_string())),
            None
        );
    }

    #[test]
    fn legal_consent_persistence_round_trip() {
        let base = std::env::temp_dir().join(format!(
            "clawdesk-legal-consent-test-{}",
            std::process::id()
        ));
        let path = base.join("record.json");
        let record = LegalConsentRecord {
            version: "2026-05-13.install-terms.v1".to_string(),
            accepted_at: "2026-05-13T00:00:00.000Z".to_string(),
            document_hash: "fnv1a-test".to_string(),
            documents: vec!["INSTALLER_TERMS.md".to_string()],
        };

        write_legal_consent_to_path(path.clone(), &record).expect("record should write");
        let stored = read_legal_consent_from_path(path.clone())
            .expect("record should read")
            .expect("record should exist");

        assert_eq!(stored.version, record.version);
        assert_eq!(stored.document_hash, record.document_hash);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn legal_export_requires_valid_json() {
        let base =
            std::env::temp_dir().join(format!("clawdesk-legal-export-test-{}", std::process::id()));
        let path = base.join("legal-summary.json");

        write_legal_export_to_path(path.clone(), r#"{"product":"ClawDesk"}"#)
            .expect("valid json should export");
        assert!(path.exists());

        let invalid = write_legal_export_to_path(base.join("invalid.json"), "not json");
        assert!(invalid.is_err());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn provider_credential_persistence_masks_and_protects_secret() {
        let base = std::env::temp_dir().join(format!(
            "clawdesk-provider-credential-test-{}",
            std::process::id()
        ));
        let path = base.join("provider-credentials.json");
        let input = ProviderCredentialInput {
            provider_id: "openai-api".to_string(),
            auth_mode: "api-key".to_string(),
            secret: Some("sk-test-1234567890".to_string()),
            account_email: None,
            endpoint: None,
            model: Some("gpt-5.2".to_string()),
        };

        let summary = write_provider_credential_to_path(path.clone(), input)
            .expect("provider credential should write");
        assert_eq!(summary.provider_id, "openai-api");
        assert!(summary.has_secret);
        assert_eq!(summary.secret_label.as_deref(), Some("sk-t…7890"));

        let raw = fs::read_to_string(path.clone()).expect("credential file should exist");
        assert!(!raw.contains("sk-test-1234567890"));
        let records =
            read_provider_credentials_from_path(path.clone()).expect("records should read");
        let encrypted = records[0]
            .encrypted_secret
            .as_deref()
            .expect("encrypted secret should exist");
        assert_eq!(
            unprotect_secret(encrypted).expect("secret should unprotect"),
            "sk-test-1234567890"
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn provider_credential_rejects_invalid_provider_id() {
        let base = std::env::temp_dir().join(format!(
            "clawdesk-provider-credential-invalid-test-{}",
            std::process::id()
        ));
        let path = base.join("provider-credentials.json");
        let input = ProviderCredentialInput {
            provider_id: "../openai".to_string(),
            auth_mode: "api-key".to_string(),
            secret: Some("sk-test".to_string()),
            account_email: None,
            endpoint: None,
            model: None,
        };

        assert!(write_provider_credential_to_path(path, input).is_err());
    }
}
