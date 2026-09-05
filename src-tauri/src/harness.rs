use std::collections::VecDeque;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::settings::{runtime_settings, settings_path, AgentRuntimeSettings};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Clone, Default)]
pub struct HarnessState {
    process: Arc<Mutex<Option<HarnessProcess>>>,
}

struct HarnessProcess {
    child: Child,
    stdin: ChildStdin,
    frames: Receiver<Value>,
    pending: VecDeque<Value>,
    next_id: u64,
    session_id: String,
    owned_home: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HarnessRun {
    #[serde(rename = "finalResponse")]
    final_response: String,
    events: Vec<Value>,
}

#[derive(Debug, Serialize)]
pub struct AgentConnectionResult {
    message: String,
}

impl Drop for HarnessProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(home) = self.owned_home.take() {
            let _ = fs::remove_dir_all(home);
        }
    }
}

impl HarnessState {
    pub fn shutdown(&self, graceful: bool) -> Result<(), String> {
        let mut guard = self
            .process
            .lock()
            .map_err(|_| "DeepSeek Harness 状态锁不可用。".to_string())?;
        if graceful {
            if let Some(process) = guard.as_mut() {
                let _ = request(process, "shutdown", json!({}));
            }
        }
        guard.take();
        Ok(())
    }
}

fn existing_path(value: impl AsRef<Path>) -> Option<PathBuf> {
    let path = value.as_ref();
    path.exists().then(|| path.to_path_buf())
}

fn resolve_harness_root(configured: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(root) = configured {
        return existing_path(root);
    }
    let current = env::current_dir().ok()?;
    [
        current.join("../deepseek-harness"),
        current.join("../../deepseek-harness"),
        PathBuf::from("/Users/jiachen/workspace/deepseek-harness"),
        PathBuf::from("/workspace/deepseek-harness"),
    ]
    .into_iter()
    .find_map(existing_path)
}

/// Resolve the Harness persistence directory. A caller-provided path belongs
/// to the caller; the generated path is explicitly owned by this bridge and
/// is removed with the child process.
fn harness_home(
    configured: Option<&str>,
    process_id: u32,
    nonce: u128,
) -> Result<(PathBuf, bool), String> {
    if let Some(value) = configured {
        if value.trim().is_empty() {
            return Err("CITROAM_HARNESS_HOME 不能是空路径。".to_string());
        }
        return Ok((PathBuf::from(value), false));
    }
    let path = env::temp_dir().join(format!("citroam-harness-{process_id}-{nonce}"));
    fs::create_dir_all(&path).map_err(|error| format!("无法创建 Harness 临时目录：{error}"))?;
    Ok((path, true))
}

fn harness_patch_path() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("CITROAM_HARNESS_PATCH") {
        return existing_path(&value).ok_or_else(|| format!("找不到 Harness patch：{value}"));
    }
    let mut candidates = Vec::new();
    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join("agent/citroam.cordis.patch.yml"));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources/agent/citroam.cordis.patch.yml"));
            candidates.push(parent.join("../Resources/agent/citroam.cordis.patch.yml"));
            candidates.push(parent.join("agent/citroam.cordis.patch.yml"));
        }
    }
    candidates
        .into_iter()
        .find_map(existing_path)
        .ok_or_else(|| "找不到 citroam Harness patch 资源。".to_string())
}

fn apply_model_environment(command: &mut Command, settings: &AgentRuntimeSettings) {
    if let Some(api_key) = settings.api_key.as_deref() {
        command.env("DEEPSEEK_API_KEY", api_key);
    }
}

fn spawn_harness(settings: &AgentRuntimeSettings) -> Result<HarnessProcess, String> {
    let configured_root = settings.harness_root.clone();
    let root =
        resolve_harness_root(configured_root.clone()).ok_or_else(|| match configured_root {
            Some(path) => format!("找不到设置中的 DeepSeek Harness：{}", path.display()),
            None => {
                "找不到 DeepSeek Harness。请在应用设置中选择 deepseek-harness 目录。".to_string()
            }
        })?;
    let node = env::var("CITROAM_NODE").unwrap_or_else(|_| "node".to_string());
    let command_path = env::var("CITROAM_DSH_COMMAND").ok();
    let mut command = Command::new(&node);
    let cli = command_path
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("apps/cli/lib/bin.js"));
    command.arg(cli).args(["--profile", "sdk"]);
    let patch = harness_patch_path()?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法生成 Harness 临时目录标识：{error}"))?
        .as_nanos();
    let (home, owns_home) = harness_home(
        env::var("CITROAM_HARNESS_HOME").ok().as_deref(),
        std::process::id(),
        nonce,
    )?;
    command.args(["--patch", patch.to_string_lossy().as_ref()]);
    command
        .current_dir(&root)
        .env("CITROAM_HARNESS_ROOT", &root)
        .env(
            "NODE_PATH",
            env::var("NODE_PATH").unwrap_or_else(|_| {
                root.join("node_modules/.pnpm/node_modules")
                    .to_string_lossy()
                    .into_owned()
            }),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    command.env("DSH_HOME", &home);
    apply_model_environment(&mut command, settings);
    let mut child = command.spawn().map_err(|error| {
        if owns_home {
            let _ = fs::remove_dir_all(&home);
        }
        format!("无法启动 DeepSeek Harness：{error}")
    })?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            if owns_home {
                let _ = fs::remove_dir_all(&home);
            }
            return Err("DeepSeek Harness 没有可读取的 stdout。".to_string());
        }
    };
    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            if owns_home {
                let _ = fs::remove_dir_all(&home);
            }
            return Err("DeepSeek Harness 没有可写入的 stdin。".to_string());
        }
    };
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(frame) = serde_json::from_str::<Value>(&line) {
                if sender.send(frame).is_err() {
                    break;
                }
            }
        }
    });
    Ok(HarnessProcess {
        child,
        stdin,
        frames: receiver,
        pending: VecDeque::new(),
        next_id: 1,
        session_id: format!("citroam-{}", std::process::id()),
        owned_home: owns_home.then_some(home),
    })
}

fn build_agent_prompt(request: &str, context: &Value) -> String {
    format!(
        "你是 citroam 的日常任务 Agent。你只能通过一次 citroam_apply 工具提出一个结构化操作，不能直接声称已经修改本地数据。\n\
工具参数 intent 必须是 JSON 字符串，内容只能是以下 AgentIntent 之一：\n\
{{\"type\":\"create\",\"title\":string,\"timeConstraint\":TimeConstraint|null,\"notes\"?:string,\"priority\"?:\"high\"|\"normal\"|\"low\"|null}}；\n\
{{\"type\":\"schedule\",\"target\":{{\"kind\":\"id\",\"cardId\":string}}或{{\"kind\":\"query\",\"query\":string}},\"timeConstraint\":TimeConstraint|null}}；\n\
{{\"type\":\"set-status\",\"target\":...,\"status\":\"open\"|\"completed\"}}；\n\
{{\"type\":\"update\",\"target\":...,\"patch\":{{\"title\"?:string,\"notes\"?:string,\"priority\"?:string|null}}}}；\n\
{{\"type\":\"delete\",\"target\":...}}；或 {{\"type\":\"unsupported\",\"message\":string}}。\n\
日期格式必须是 YYYY-MM-DD，period 只能是 anytime/morning/afternoon/evening。不要编造 cardId；不确定时使用 query。工具返回后只给用户一句简短回执。\n\
当前 citroam 现场：{context}\n用户请求：{request}",
        context = context,
        request = request,
    )
}

fn next_frame(process: &mut HarnessProcess) -> Result<Value, String> {
    if let Some(frame) = process.pending.pop_front() {
        return Ok(frame);
    }
    match process.frames.recv_timeout(REQUEST_TIMEOUT) {
        Ok(frame) => Ok(frame),
        Err(RecvTimeoutError::Timeout) => Err("DeepSeek Harness 响应超时。".to_string()),
        Err(RecvTimeoutError::Disconnected) => Err("DeepSeek Harness 进程已经退出。".to_string()),
    }
}

fn request(process: &mut HarnessProcess, method: &str, params: Value) -> Result<Value, String> {
    let id = process.next_id;
    process.next_id += 1;
    let frame = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    serde_json::to_writer(&mut process.stdin, &frame)
        .map_err(|error| format!("无法发送 Harness 请求：{error}"))?;
    process
        .stdin
        .write_all(b"\n")
        .and_then(|_| process.stdin.flush())
        .map_err(|error| format!("无法刷新 Harness 请求：{error}"))?;
    loop {
        let incoming = next_frame(process)?;
        if incoming.get("id").and_then(Value::as_u64) == Some(id) {
            if let Some(error) = incoming.get("error") {
                return Err(format!("DeepSeek Harness 请求失败：{error}"));
            }
            return Ok(incoming.get("result").cloned().unwrap_or(Value::Null));
        }
        process.pending.push_back(incoming);
    }
}

fn initialize_payload(settings: &AgentRuntimeSettings, cwd: &str) -> Value {
    json!({ "cwd": cwd, "provider": settings.provider, "model": settings.model })
}

fn initialize(process: &mut HarnessProcess, settings: &AgentRuntimeSettings) -> Result<(), String> {
    let cwd = env::current_dir()
        .map_err(|error| format!("无法确定 citroam 工作目录：{error}"))?
        .to_string_lossy()
        .into_owned();
    request(process, "initialize", initialize_payload(settings, &cwd))?;
    Ok(())
}

fn is_receipt(frame: &Value, message_id: &str) -> bool {
    frame.get("method").and_then(Value::as_str) == Some("session.event")
        && frame.pointer("/params/event/type").and_then(Value::as_str)
            == Some("agent/inbox/spliced")
        && frame
            .pointer("/params/event/data/inserted")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .any(|item| item.get("id").and_then(Value::as_str) == Some(message_id))
            })
            .unwrap_or(false)
}

fn is_idle(frame: &Value, session_id: &str) -> bool {
    frame.get("method").and_then(Value::as_str) == Some("session.status")
        && frame.pointer("/params/sessionId").and_then(Value::as_str) == Some(session_id)
        && frame.pointer("/params/status").and_then(Value::as_str) == Some("idle")
}

fn final_response(events: &[Value]) -> String {
    events
        .iter()
        .rev()
        .find(|event| event.get("type").and_then(Value::as_str) == Some("assistant/message"))
        .and_then(|event| {
            event
                .pointer("/data/message/content")
                .and_then(Value::as_array)
        })
        .map(|content| {
            content
                .iter()
                .filter_map(|block| {
                    (block.get("type").and_then(Value::as_str) == Some("text")).then(|| {
                        block
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                    })
                })
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn run_prompt(
    process: &mut HarnessProcess,
    request_text: &str,
    context: Value,
) -> Result<HarnessRun, String> {
    let result = request(
        process,
        "session/prompt",
        json!({
            "sessionId": process.session_id,
            "contentBlocks": [{ "type": "text", "text": build_agent_prompt(request_text, &context) }],
        }),
    )?;
    let message_id = result
        .get("messageId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Harness 没有返回有效的消息 id。".to_string())?
        .to_string();
    let mut received = false;
    let mut events = Vec::new();
    loop {
        let frame = next_frame(process)?;
        if frame.get("method").and_then(Value::as_str) == Some("session.event")
            && frame.pointer("/params/sessionId").and_then(Value::as_str)
                == Some(process.session_id.as_str())
        {
            if is_receipt(&frame, &message_id) {
                received = true;
            }
            if let Some(event) = frame.pointer("/params/event").cloned() {
                events.push(event);
            }
        }
        if received && is_idle(&frame, &process.session_id) {
            break;
        }
    }
    Ok(HarnessRun {
        final_response: final_response(&events),
        events,
    })
}

fn agent_prompt_blocking(
    app: AppHandle,
    state: &HarnessState,
    request_text: String,
    context: Value,
) -> Result<HarnessRun, String> {
    let mut guard = state
        .process
        .lock()
        .map_err(|_| "DeepSeek Harness 状态锁不可用。".to_string())?;
    if guard.is_none() {
        let settings = runtime_settings(&settings_path(&app)?)?;
        let mut process = spawn_harness(&settings)?;
        initialize(&mut process, &settings)?;
        *guard = Some(process);
    }
    match run_prompt(
        guard.as_mut().expect("process initialized"),
        &request_text,
        context,
    ) {
        Ok(run) => Ok(run),
        Err(error) => {
            guard.take();
            Err(error)
        }
    }
}

/// Run the synchronous JSON-RPC bridge away from Tauri's webview/IPC thread.
/// Harness prompts may wait on model I/O and session events for minutes; doing
/// that work inline would make the native window appear frozen and block input.
#[tauri::command]
pub async fn agent_prompt(
    app: AppHandle,
    state: State<'_, HarnessState>,
    request_text: String,
    context: Value,
) -> Result<HarnessRun, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        agent_prompt_blocking(app, &state, request_text, context)
    })
    .await
    .map_err(|error| format!("DeepSeek Harness 后台任务失败：{error}"))?
}

#[tauri::command]
pub fn agent_shutdown(state: State<'_, HarnessState>) -> Result<(), String> {
    state.shutdown(true)
}

pub fn test_connection(
    app: &AppHandle,
    state: &HarnessState,
) -> Result<AgentConnectionResult, String> {
    state.shutdown(false)?;
    let settings = runtime_settings(&settings_path(app)?)?;
    if settings.api_key.is_none() {
        return Err("请先填写 DeepSeek API Key。".to_string());
    }
    let mut process = spawn_harness(&settings)?;
    initialize(&mut process, &settings)?;
    let _ = request(&mut process, "shutdown", json!({}));
    Ok(AgentConnectionResult {
        message: "Harness 已启动，模型配置已载入。".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        apply_model_environment, build_agent_prompt, harness_home, initialize_payload,
        resolve_harness_root, HarnessRun,
    };
    use crate::settings::AgentRuntimeSettings;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn assert_future<T: std::future::Future<Output = Result<super::HarnessRun, String>>>(
        _future: T,
    ) {
    }

    fn unreachable_value<T>() -> T {
        panic!("type-check helper must not execute");
    }

    #[test]
    fn agent_prompt_is_an_async_command() {
        if false {
            let app: tauri::AppHandle = unreachable_value();
            let state: tauri::State<'static, super::HarnessState> = unreachable_value();
            assert_future(super::agent_prompt(
                app,
                state,
                String::new(),
                serde_json::Value::Null,
            ));
        }
    }

    fn runtime_settings() -> AgentRuntimeSettings {
        AgentRuntimeSettings {
            provider: "deepseek-official".to_string(),
            model: "deepseek-v4-flash".to_string(),
            harness_root: None,
            api_key: None,
        }
    }

    #[test]
    fn configured_harness_root_wins_over_automatic_discovery() {
        let root = std::env::temp_dir();
        assert_eq!(resolve_harness_root(Some(root.clone())), Some(root));
        assert_eq!(
            resolve_harness_root(Some(PathBuf::from("/path/that/does/not/exist"))),
            None
        );
    }

    #[test]
    fn initialize_payload_uses_the_saved_provider_and_model() {
        let mut settings = runtime_settings();
        settings.model = "deepseek-chat".to_string();
        assert_eq!(
            initialize_payload(&settings, "/workspace/citroam"),
            json!({
                "cwd": "/workspace/citroam",
                "provider": "deepseek-official",
                "model": "deepseek-chat",
            })
        );
    }

    #[test]
    fn saved_key_is_injected_only_into_the_child_harness_environment() {
        let mut command = Command::new("node");
        let mut settings = runtime_settings();
        settings.api_key = Some("sk-system-credential".to_string());
        apply_model_environment(&mut command, &settings);

        let key = command
            .get_envs()
            .find(|(name, _)| *name == "DEEPSEEK_API_KEY")
            .and_then(|(_, value)| value)
            .map(|value| value.to_string_lossy().into_owned());
        assert_eq!(key.as_deref(), Some("sk-system-credential"));
    }

    #[test]
    fn prompt_keeps_workspace_context_and_requires_the_citroam_tool() {
        let prompt = build_agent_prompt(
            "把买牛奶放到明天",
            &json!({"currentPage":"2026-09-04","workspace":{"cards":[]}}),
        );
        assert!(prompt.contains("citroam_apply"));
        assert!(prompt.contains("把买牛奶放到明天"));
        assert!(prompt.contains("2026-09-04"));
    }

    #[test]
    fn default_harness_home_is_a_unique_owned_temp_directory() {
        let (path, owned) = harness_home(None, 1234, 5678).expect("temp home");
        assert!(owned);
        assert!(path.starts_with(std::env::temp_dir()));
        assert!(path.ends_with("citroam-harness-1234-5678"));
        assert!(path.is_dir());
        fs::remove_dir_all(path).expect("cleanup temp home");
    }

    #[test]
    fn configured_harness_home_is_reused_and_never_marked_owned() {
        let (path, owned) = harness_home(Some("/tmp/citroam-configured-home"), 1234, 5678)
            .expect("configured home");
        assert_eq!(path, PathBuf::from("/tmp/citroam-configured-home"));
        assert!(!owned);
    }

    #[test]
    fn bundled_citroam_tool_loads_without_an_inherited_node_path() {
        let root = resolve_harness_root(None).expect("deepseek-harness workspace");
        let tool = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agent/citroam-tool.mjs");
        let node = std::env::var("CITROAM_NODE").unwrap_or_else(|_| "node".to_string());
        let output = Command::new(node)
            .current_dir(root)
            .env_remove("NODE_PATH")
            .arg(tool)
            .output()
            .expect("run bundled citroam tool");
        assert!(
            output.status.success(),
            "citroam tool should load without NODE_PATH; stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn harness_run_keeps_sdk_camel_case_response_field() {
        let encoded = serde_json::to_value(HarnessRun {
            final_response: "已处理".to_string(),
            events: Vec::new(),
        })
        .expect("serialize harness run");
        assert_eq!(
            encoded
                .get("finalResponse")
                .and_then(|value| value.as_str()),
            Some("已处理")
        );
        assert!(encoded.get("final_response").is_none());
    }
}
