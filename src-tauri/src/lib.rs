mod harness;
mod settings;

use harness::{agent_prompt, agent_shutdown, HarnessState};
use settings::{AgentSettingsView, SaveAgentSettingsInput};
use tauri::{AppHandle, Manager, RunEvent, State};

#[tauri::command]
fn settings_get_agent(app: AppHandle) -> Result<AgentSettingsView, String> {
    settings::get_agent_settings(&settings::settings_path(&app)?)
}

#[tauri::command]
fn settings_save_agent(
    app: AppHandle,
    state: State<'_, HarnessState>,
    input: SaveAgentSettingsInput,
) -> Result<AgentSettingsView, String> {
    let saved = settings::save_agent_settings(&settings::settings_path(&app)?, &input)?;
    state.shutdown(false)?;
    Ok(saved)
}

#[tauri::command]
fn settings_test_agent(
    app: AppHandle,
    state: State<'_, HarnessState>,
) -> Result<harness::AgentConnectionResult, String> {
    harness::test_connection(&app, &state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(HarnessState::default())
        .invoke_handler(tauri::generate_handler![
            agent_prompt,
            agent_shutdown,
            settings_get_agent,
            settings_save_agent,
            settings_test_agent,
        ])
        .plugin(tauri_plugin_store::Builder::new().build())
        .build(tauri::generate_context!())
        .expect("failed to build citroam")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<HarnessState>() {
                    let _ = state.shutdown(false);
                }
            }
        });
}
